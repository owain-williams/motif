'use strict';

const {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const TIERS = new Set(['free', 'basic', 'pro']);

function createHandler(services) {
  return async (event) => {
    const routeKey = event.routeKey || '';
    const rawPath = event.rawPath || event.requestContext?.http?.path || '/';
    // `/relay/ideas/{id}` carries both GET and DELETE, so those two branches
    // route on the method rather than the path alone — a DELETE answered by the
    // download branch would quietly leave the copy it was asked to release.
    const method = routeKey.split(' ')[0] || event.requestContext?.http?.method || '';

    if (routeKey === 'GET /health' || rawPath.endsWith('/health')) {
      return json(200, {
        status: 'ok',
        service: 'motif-backend',
        time: new Date().toISOString(),
      });
    }

    const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
    if (!claims.sub) return json(401, { error: 'unauthorized' });

    if (routeKey === 'GET /me' || rawPath.endsWith('/me')) {
      const profile = await services.accounts.profile(claims.sub, event);
      return json(200, {
        sub: claims.sub,
        email: claims.email,
        tier: profile.tier ?? 'free',
      });
    }

    if (routeKey === 'PUT /me/tier' || rawPath.endsWith('/me/tier')) {
      const body = parseJson(event.body);
      if (!TIERS.has(body.tier)) {
        return json(400, { error: 'invalid_tier', allowed: [...TIERS] });
      }
      await services.accounts.setTier(claims.sub, claims.email ?? '', body.tier);
      return json(200, { tier: body.tier });
    }

    if (rawPath.startsWith('/relay/')) {
      const profile = await services.accounts.profile(claims.sub, event);
      if (profile.tier !== 'basic' && profile.tier !== 'pro') {
        return json(403, { error: 'cloud_relay_requires_paid_tier' });
      }
    }

    if (routeKey === 'GET /relay/manifest' || rawPath.endsWith('/relay/manifest')) {
      return json(200, { have: await services.relay.list(claims.sub) });
    }

    // The metadata half of the relay (motif-kka.9): Capture and Bridge pull the
    // account's Idea metadata here and push their own edits to `/relay/updates`,
    // mirroring the LAN pair `GET /motif/library` + `POST /motif/updates`. Audio
    // stays on the `/relay/ideas` routes — an edit never moves bytes.
    if (routeKey === 'GET /relay/library' || rawPath.endsWith('/relay/library')) {
      const stored = await services.relay.library(claims.sub);
      return json(200, {
        ideas: stored
          .map((offerJson) => parseJson(offerJson).idea)
          .filter((idea) => idea && validIdeaId(idea.id)),
      });
    }

    if (routeKey === 'POST /relay/updates' || rawPath.endsWith('/relay/updates')) {
      const update = parseJson(event.body);
      if (!validUpdate(update)) return json(400, { error: 'invalid_idea_update' });
      const id = update.idea.id;
      const offerJson = await services.relay.offer(claims.sub, id);
      // An edit to an Idea this account never uploaded is dropped, exactly as a
      // peer drops an update for an Idea whose audio never arrived. Answering
      // `accepted: false` (not an error) keeps a pushing device's pass going.
      const offer = offerJson ? parseJson(offerJson) : null;
      if (!offer || !offer.idea) return json(200, updateAck(id, false));

      // Read-modify-write: two devices pushing edits to the same Idea in the
      // same instant can lose the earlier one. Left unconditional for the MVP
      // because both keep pushing until the relay matches them, so the next
      // poll re-sends the lost field rather than dropping it for good.
      const merged = mergeIdeaMetadata(offer.idea, update.idea);
      await services.relay.saveOffer(
        claims.sub,
        id,
        JSON.stringify({ ...offer, idea: merged }),
      );
      return json(200, updateAck(id, true));
    }

    if (routeKey === 'POST /relay/ideas' || rawPath.endsWith('/relay/ideas')) {
      const offer = parseJson(event.body);
      if (!validOffer(offer)) return json(400, { error: 'invalid_idea_offer' });
      return json(200, {
        ideaId: offer.idea.id,
        uploadUrl: await services.relay.begin(claims.sub, offer.idea.id),
      });
    }

    if (
      routeKey === 'POST /relay/ideas/{id}/complete' ||
      rawPath.endsWith('/complete')
    ) {
      const id = event.pathParameters?.id ?? rawPath.slice('/relay/ideas/'.length, -'/complete'.length);
      const offer = parseJson(event.body);
      if (!validOffer(offer) || offer.idea.id !== id) {
        return json(400, { error: 'invalid_idea_offer' });
      }
      const completed = await services.relay.complete(
        claims.sub,
        id,
        JSON.stringify(offer),
        offer.audioByteLength,
      );
      if (!completed) return json(400, { error: 'audio_upload_incomplete' });
      return json(200, {
        kind: 'idea-sync-ack',
        ideaId: id,
        accepted: true,
      });
    }

    // Purging an Idea whose Recently Deleted window has elapsed (motif-kka.8).
    // Idempotent: a copy that isn't there is the state the caller asked for, so
    // a sweep interrupted midway is safe to retry. Account-scoped like every
    // other relay route, so one account can never purge another's audio.
    if (isIdeaPath(rawPath) && method === 'DELETE') {
      const id = ideaIdFrom(event, rawPath);
      if (!validIdeaId(id)) return json(400, { error: 'invalid_idea_id' });
      await services.relay.remove(claims.sub, id);
      return json(200, { ideaId: id, deleted: true });
    }

    if (isIdeaPath(rawPath) && method === 'GET') {
      const id = ideaIdFrom(event, rawPath);
      if (!validIdeaId(id)) return json(400, { error: 'invalid_idea_id' });
      const stored = await services.relay.get(claims.sub, id);
      if (!stored) return json(404, { error: 'idea_not_found' });
      return json(200, stored);
    }

    return json(404, { error: 'not_found', path: rawPath });
  };
}

function productionServices() {
  const dynamo = new DynamoDBClient({});
  const s3 = new S3Client({});
  const tableName = process.env.TABLE_NAME;
  const bucketName = process.env.AUDIO_BUCKET_NAME;

  /** One attribute of every Idea row on an account, skipping rows without it. */
  const queryIdeaColumn = async (sub, attribute) => {
    const result = await dynamo.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :idea)',
      ExpressionAttributeValues: {
        ':pk': { S: `ACCOUNT#${sub}` },
        ':idea': { S: 'IDEA#' },
      },
      ProjectionExpression: attribute,
      ConsistentRead: true,
    }));
    return (result.Items ?? []).flatMap((item) => item[attribute]?.S ? [item[attribute].S] : []);
  };

  /** The stored offer for one Idea, or `null` when this account has no such row. */
  const readOffer = async (sub, id) => {
    const stored = await dynamo.send(new GetItemCommand({
      TableName: tableName,
      Key: ideaKey(sub, id),
      ConsistentRead: true,
    }));
    return stored.Item?.offerJson?.S ?? null;
  };

  return {
    accounts: {
      profile: async (sub) => {
        const result = await dynamo.send(new GetItemCommand({
          TableName: tableName,
          Key: profileKey(sub),
          ConsistentRead: true,
        }));
        return { tier: result.Item?.tier?.S ?? 'free' };
      },
      setTier: async (sub, email, tier) => {
        await dynamo.send(new UpdateItemCommand({
          TableName: tableName,
          Key: profileKey(sub),
          UpdateExpression: 'SET #tier = :tier, email = :email, updatedAt = :updatedAt',
          ExpressionAttributeNames: { '#tier': 'tier' },
          ExpressionAttributeValues: {
            ':tier': { S: tier },
            ':email': { S: email },
            ':updatedAt': { S: new Date().toISOString() },
          },
        }));
      },
    },
    relay: {
      list: (sub) => queryIdeaColumn(sub, 'ideaId'),
      begin: async (sub, id) => getSignedUrl(s3, new PutObjectCommand({
        Bucket: bucketName,
        Key: relayObjectKey(sub, id),
        ContentType: 'application/octet-stream',
      }), { expiresIn: 900 }),
      complete: async (sub, id, offerJson, audioByteLength) => {
        let object;
        try {
          object = await s3.send(new HeadObjectCommand({
            Bucket: bucketName,
            Key: relayObjectKey(sub, id),
          }));
        } catch {
          return false;
        }
        if (object.ContentLength !== audioByteLength) return false;
        await dynamo.send(new UpdateItemCommand({
          TableName: tableName,
          Key: ideaKey(sub, id),
          UpdateExpression: 'SET ideaId = :id, offerJson = :offer, audioByteLength = :length, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':id': { S: id },
            ':offer': { S: offerJson },
            ':length': { N: String(audioByteLength) },
            ':updatedAt': { S: new Date().toISOString() },
          },
        }));
        return true;
      },
      library: (sub) => queryIdeaColumn(sub, 'offerJson'),
      offer: readOffer,
      // Metadata only: the audio object and its recorded length are untouched,
      // so an edit can never invalidate a download in flight.
      saveOffer: async (sub, id, offerJson) => {
        await dynamo.send(new UpdateItemCommand({
          TableName: tableName,
          Key: ideaKey(sub, id),
          UpdateExpression: 'SET offerJson = :offer, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':offer': { S: offerJson },
            ':updatedAt': { S: new Date().toISOString() },
          },
        }));
      },
      get: async (sub, id) => {
        const offerJson = await readOffer(sub, id);
        if (!offerJson) return null;
        const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({
          Bucket: bucketName,
          Key: relayObjectKey(sub, id),
        }), { expiresIn: 900 });
        return { offer: parseJson(offerJson), downloadUrl };
      },
      // Audio first: an orphaned metadata row is recoverable (the next purge
      // retries it), an orphaned S3 object is not — nothing would list it.
      // Both commands succeed on a key that isn't there, so retries are safe.
      remove: async (sub, id) => {
        await s3.send(new DeleteObjectCommand({
          Bucket: bucketName,
          Key: relayObjectKey(sub, id),
        }));
        await dynamo.send(new DeleteItemCommand({
          TableName: tableName,
          Key: ideaKey(sub, id),
        }));
      },
    },
  };
}

function validOffer(offer) {
  return offer.kind === 'idea-sync-offer' &&
    offer.idea &&
    validIdeaId(offer.idea.id) &&
    Number.isSafeInteger(offer.audioByteLength) &&
    offer.audioByteLength >= 0;
}

function validUpdate(update) {
  return update.kind === 'idea-metadata-update' &&
    update.idea &&
    validIdeaId(update.idea.id) &&
    validEditableMetadata(update.idea);
}

/**
 * Whether an update carries a complete, well-typed set of editable fields. A
 * winning field is copied into the stored Idea verbatim, and the same record is
 * what both `/relay/library` and the audio download route serve — so a push
 * missing (say) a name while claiming a newer name stamp would leave behind an
 * Idea neither app can parse, taking the account's audio import down with it.
 * Rejecting the whole push keeps that record always readable.
 */
function validEditableMetadata(idea) {
  return typeof idea.name === 'string' &&
    ['tags', 'instrument', 'style'].every((field) =>
      Array.isArray(idea[field]) && idea[field].every((value) => typeof value === 'string')) &&
    (idea.tempo === null || idea.tempo === undefined || Number.isFinite(idea.tempo)) &&
    validLocation(idea.location);
}

function validLocation(location) {
  return location === null || location === undefined || (
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lon) &&
    typeof location.label === 'string'
  );
}

function validIdeaId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}

/** The Idea metadata fields a user can edit on either device (ADR 0006). */
const EDITABLE_IDEA_FIELDS = ['name', 'tags', 'instrument', 'style', 'tempo', 'location'];

/**
 * The per-field edit stamps of an Idea, filling in what a copy uploaded before
 * the metadata schema is missing: the name was effectively set at capture, and
 * nothing else has ever been edited (so any real edit wins). A stamp that isn't
 * a real number is read as its default rather than compared — an unusable clock
 * loses the merge instead of winning every future one. Mirror of
 * `withMetadataDefaults` in `@motif/shared`.
 */
function fieldStamps(idea) {
  const stamps = idea.fieldUpdatedAt ?? {};
  const unedited = { name: idea.capturedAt };
  return Object.fromEntries(EDITABLE_IDEA_FIELDS.map((field) => [
    field,
    Number.isFinite(stamps[field])
      ? stamps[field]
      : (Number.isFinite(unedited[field]) ? unedited[field] : 0),
  ]));
}

function fieldValue(idea, field) {
  if (field === 'name') return idea.name;
  if (field === 'tempo') return idea.tempo ?? null;
  if (field === 'location') return idea.location ?? null;
  return idea[field] ?? [];
}

/**
 * Merges an incoming edit into the relay's copy by per-field last-write-wins
 * (ADR 0006): each field takes the value from whichever device edited it more
 * recently, ties keeping the stored copy. The relay merges rather than
 * overwrites so two devices editing different fields while apart both land —
 * the same rule Capture's `mergeIdea` and Bridge's `merge_idea` apply locally.
 * Everything that is not user-editable (capture facts, audio format) stays as
 * uploaded; `storageState` is per-device and meaningless here, so it too is
 * left alone rather than taking a pushing device's view of it.
 */
function mergeIdeaMetadata(stored, incoming) {
  const storedStamps = fieldStamps(stored);
  const incomingStamps = fieldStamps(incoming);
  const merged = { ...stored, fieldUpdatedAt: storedStamps };
  for (const field of EDITABLE_IDEA_FIELDS) {
    if (incomingStamps[field] > storedStamps[field]) {
      merged[field] = fieldValue(incoming, field);
      merged.fieldUpdatedAt[field] = incomingStamps[field];
    } else {
      merged[field] = fieldValue(stored, field);
    }
  }
  return merged;
}

function updateAck(ideaId, accepted) {
  return { kind: 'idea-update-ack', ideaId, accepted };
}

/** Whether `rawPath` addresses a single Idea, e.g. `/relay/ideas/<id>`. */
function isIdeaPath(rawPath) {
  return rawPath.startsWith('/relay/ideas/');
}

/** The Idea id from a single-Idea route, falling back to the raw path. */
function ideaIdFrom(event, rawPath) {
  return event.pathParameters?.id ?? rawPath.slice('/relay/ideas/'.length);
}

function profileKey(sub) {
  return { PK: { S: `ACCOUNT#${sub}` }, SK: { S: 'PROFILE' } };
}

function ideaKey(sub, id) {
  return { PK: { S: `ACCOUNT#${sub}` }, SK: { S: `IDEA#${id}` } };
}

function relayObjectKey(sub, id) {
  return `accounts/${sub}/ideas/${id}`;
}

function parseJson(body) {
  try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler(productionServices());
