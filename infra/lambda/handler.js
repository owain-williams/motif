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
      list: async (sub) => {
        const result = await dynamo.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :idea)',
          ExpressionAttributeValues: {
            ':pk': { S: `ACCOUNT#${sub}` },
            ':idea': { S: 'IDEA#' },
          },
          ProjectionExpression: 'ideaId',
          ConsistentRead: true,
        }));
        return (result.Items ?? []).flatMap((item) => item.ideaId?.S ? [item.ideaId.S] : []);
      },
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
      get: async (sub, id) => {
        const metadata = await dynamo.send(new GetItemCommand({
          TableName: tableName,
          Key: ideaKey(sub, id),
          ConsistentRead: true,
        }));
        const offerJson = metadata.Item?.offerJson?.S;
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

function validIdeaId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
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
