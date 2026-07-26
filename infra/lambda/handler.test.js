'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHandler } = require('./handler');

function event(routeKey, tier, options = {}) {
  const accountSub = options.accountSub ?? 'account-1';
  return {
    routeKey,
    rawPath: options.path ?? routeKey.split(' ')[1],
    pathParameters: options.pathParameters,
    headers: options.headers,
    body: options.body,
    isBase64Encoded: options.isBase64Encoded,
    requestContext: {
      authorizer: { jwt: { claims: { sub: accountSub, email: 'a@example.com' } } },
    },
    testTier: tier,
  };
}

function revenueCatEvent(type, timestamp, options = {}) {
  return {
    routeKey: 'POST /webhooks/revenuecat',
    rawPath: '/webhooks/revenuecat',
    headers: options.headers ?? { authorization: 'Bearer webhook-secret' },
    body: JSON.stringify({
      event: {
        id: options.id ?? `${type}-${timestamp}`,
        type,
        event_timestamp_ms: timestamp,
        app_user_id: options.appUserId ?? 'account-1',
        entitlement_ids: options.entitlementIds ?? ['motif_pro'],
        ...options.event,
      },
    }),
    requestContext: { http: { method: 'POST', path: '/webhooks/revenuecat' } },
  };
}

function offerFrame(id, audio, deviceId = 'capture-1') {
  const offer = Buffer.from(JSON.stringify({
    kind: 'idea-sync-offer',
    from: { deviceId, displayName: deviceId, role: 'capture' },
    idea: {
      id,
      name: 'Cloud Idea',
      capturedAt: 1700000000000,
      durationMs: 4200,
      audioFormat: 'aac',
      channels: 1,
      storageState: 'on-device',
    },
    audioByteLength: audio.length,
  }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(offer.length);
  return Buffer.concat([length, offer, audio]);
}

function offerFromFrame(frame) {
  const jsonLength = frame.readUInt32BE(0);
  return JSON.parse(frame.subarray(4, 4 + jsonLength).toString());
}

async function uploadOffer(handler, tier, offer, options = {}) {
  const ideaId = offer.idea.id;
  const initiated = await handler(event('POST /relay/ideas', tier, {
    accountSub: options.accountSub,
    body: JSON.stringify(offer),
  }));
  assert.equal(initiated.statusCode, 200);

  const completed = await handler(event('POST /relay/ideas/{id}/complete', tier, {
    accountSub: options.accountSub,
    path: `/relay/ideas/${ideaId}/complete`,
    pathParameters: { id: ideaId },
    body: JSON.stringify(offer),
  }));
  assert.equal(completed.statusCode, 200);
}

function fakeServices() {
  const ideas = new Map();
  const audio = new Map();
  const profiles = new Map();
  const cancelledUploads = [];
  return {
    ideas,
    audio,
    profiles,
    accounts: {
      profile: async (sub, event) => ({ tier: profiles.get(sub)?.tier ?? event.testTier }),
      projectRevenueCatTier: async (sub, tier, version) => {
        const current = profiles.get(sub);
        if (current && current.version >= version) return false;
        profiles.set(sub, { tier, version });
        return true;
      },
    },
    relay: {
      cancelledUploads,
      bytesUsed: async (sub) => [...audio.entries()]
        .filter(([key]) => key.startsWith(`${sub}/`))
        .reduce((total, [, length]) => total + length, 0),
      list: async (sub) => [...ideas.keys()]
        .filter((key) => key.startsWith(`${sub}/`))
        .map((key) => key.slice(sub.length + 1)),
      begin: async (sub, id) => `https://upload.example/${sub}/${id}`,
      cancelUpload: async (sub, id) => {
        cancelledUploads.push(`${sub}/${id}`);
      },
      complete: async (sub, id, offerJson, audioByteLength) => {
        ideas.set(`${sub}/${id}`, offerJson);
        audio.set(`${sub}/${id}`, audioByteLength);
        return true;
      },
      get: async (sub, id) => {
        const key = `${sub}/${id}`;
        if (!ideas.has(key)) return null;
        return {
          offer: JSON.parse(ideas.get(key)),
          downloadUrl: `https://download.example/${sub}/${id}`,
        };
      },
      library: async (sub) => [...ideas.entries()]
        .filter(([key]) => key.startsWith(`${sub}/`))
        .map(([, offerJson]) => offerJson),
      offer: async (sub, id) => ideas.get(`${sub}/${id}`) ?? null,
      saveOffer: async (sub, id, offerJson) => {
        ideas.set(`${sub}/${id}`, offerJson);
      },
      remove: async (sub, id) => {
        ideas.delete(`${sub}/${id}`);
        audio.delete(`${sub}/${id}`);
      },
    },
  };
}

/** An Idea carrying the editable metadata and per-field stamps of ADR 0006. */
function relayIdea(id, overrides = {}) {
  return {
    id,
    name: 'Cloud Idea',
    capturedAt: 1700000000000,
    durationMs: 4200,
    audioFormat: 'aac',
    channels: 1,
    storageState: 'on-device',
    tags: [],
    instrument: [],
    style: [],
    tempo: null,
    location: null,
    ...overrides,
    fieldUpdatedAt: {
      name: 1700000000000,
      tags: 0,
      instrument: 0,
      style: 0,
      tempo: 0,
      location: 0,
      ...overrides.fieldUpdatedAt,
    },
  };
}

function offerFor(idea, deviceId = 'capture-1') {
  return {
    kind: 'idea-sync-offer',
    from: { deviceId, displayName: deviceId, role: 'capture' },
    idea,
    audioByteLength: 11,
  };
}

function updateEvent(tier, idea, options = {}) {
  return event('POST /relay/updates', tier, {
    ...options,
    body: JSON.stringify({
      kind: 'idea-metadata-update',
      from: { deviceId: options.deviceId ?? 'capture-1', displayName: 'Capture', role: 'capture' },
      idea,
    }),
  });
}

async function relayLibrary(handler, tier, options = {}) {
  const response = await handler(event('GET /relay/library', tier, options));
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body).ideas;
}

test('only the configured RevenueCat credential can project an account Tier', async () => {
  const services = fakeServices();
  const handler = createHandler(services, {
    revenueCatAuthorization: 'Bearer webhook-secret',
    proEntitlementId: 'motif_pro',
  });

  for (const headers of [{}, { authorization: 'wrong' }]) {
    const response = await handler(revenueCatEvent('INITIAL_PURCHASE', 100, { headers }));
    assert.equal(response.statusCode, 401);
  }

  assert.equal(services.profiles.size, 0);
});

test('RevenueCat purchases grant the owning Cognito account immediate relay access', async () => {
  const services = fakeServices();
  const handler = createHandler(services, {
    revenueCatAuthorization: 'Bearer webhook-secret',
    proEntitlementId: 'motif_pro',
  });

  const projected = await handler(revenueCatEvent('INITIAL_PURCHASE', 100, {
    appUserId: 'cognito-owner',
  }));
  const relay = await handler(event('GET /relay/manifest', 'free', {
    accountSub: 'cognito-owner',
  }));

  assert.equal(projected.statusCode, 200);
  assert.deepEqual(JSON.parse(projected.body), { accepted: true, tier: 'pro' });
  assert.equal(services.profiles.get('cognito-owner').tier, 'pro');
  assert.equal(relay.statusCode, 200);
});

test('RevenueCat expiration and refund events revoke Pro relay access', async () => {
  const revocations = [
    { type: 'EXPIRATION' },
    { type: 'REFUND' },
    { type: 'CANCELLATION', event: { expiration_at_ms: 200 } },
  ];
  for (const revocation of revocations) {
    const services = fakeServices();
    const handler = createHandler(services, {
      revenueCatAuthorization: 'Bearer webhook-secret',
      proEntitlementId: 'motif_pro',
    });
    await handler(revenueCatEvent('RENEWAL', 100));

    const projected = await handler(revenueCatEvent(revocation.type, 200, {
      event: revocation.event,
    }));
    const relay = await handler(event('GET /relay/manifest', 'pro'));

    assert.deepEqual(JSON.parse(projected.body), { accepted: true, tier: 'free' });
    assert.equal(relay.statusCode, 403);
  }
});

test('cancelling renewal keeps Pro active until RevenueCat reports expiration', async () => {
  const services = fakeServices();
  const handler = createHandler(services, {
    revenueCatAuthorization: 'Bearer webhook-secret',
    proEntitlementId: 'motif_pro',
  });

  const projected = await handler(revenueCatEvent('CANCELLATION', 200, {
    event: { expiration_at_ms: 300 },
  }));
  const relay = await handler(event('GET /relay/manifest', 'free'));

  assert.deepEqual(JSON.parse(projected.body), { accepted: true, tier: 'pro' });
  assert.equal(relay.statusCode, 200);
});

test('duplicate and out-of-order RevenueCat events cannot overwrite newer Tier state', async () => {
  const services = fakeServices();
  const handler = createHandler(services, {
    revenueCatAuthorization: 'Bearer webhook-secret',
    proEntitlementId: 'motif_pro',
  });

  await handler(revenueCatEvent('RENEWAL', 200, { id: 'renewed' }));
  await handler(revenueCatEvent('EXPIRATION', 300, { id: 'expired' }));
  const stale = await handler(revenueCatEvent('RENEWAL', 200, { id: 'renewed' }));
  const duplicate = await handler(revenueCatEvent('EXPIRATION', 300, { id: 'expired' }));

  assert.deepEqual(JSON.parse(stale.body), { accepted: false, tier: 'pro' });
  assert.deepEqual(JSON.parse(duplicate.body), { accepted: false, tier: 'free' });
  assert.equal(services.profiles.get('account-1').tier, 'free');
});

test('RevenueCat anonymous customers cannot be mistaken for Cognito accounts', async () => {
  const services = fakeServices();
  const handler = createHandler(services, {
    revenueCatAuthorization: 'Bearer webhook-secret',
    proEntitlementId: 'motif_pro',
  });

  const response = await handler(revenueCatEvent('INITIAL_PURCHASE', 100, {
    appUserId: '$RCAnonymousID:device-customer',
  }));

  assert.equal(response.statusCode, 400);
  assert.equal(services.profiles.size, 0);
});

test('Free accounts cannot access the cloud relay', async () => {
  const handler = createHandler(fakeServices());
  const response = await handler(event('GET /relay/manifest', 'free'));
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: 'cloud_relay_requires_paid_tier' });
});

test('the account profile reports every byte held in cloud storage', async () => {
  const services = fakeServices();
  services.audio.set('account-1/idea-1', 1200);
  services.audio.set('account-1/idea-2', 3456);
  services.audio.set('another-account/private', 9999);
  const handler = createHandler(services);

  const response = await handler(event('GET /me', 'pro'));

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).cloudStorageBytesUsed, 4656);
});

test('an Idea offer that would exceed the Pro quota is refused before upload', async () => {
  const services = fakeServices();
  const GB = 1024 ** 3;
  services.audio.set('account-1/existing', 149 * GB);
  const handler = createHandler(services);
  const offer = offerFor(relayIdea('too-large'));
  offer.audioByteLength = 2 * GB;

  const response = await handler(event('POST /relay/ideas', 'pro', {
    body: JSON.stringify(offer),
  }));

  assert.equal(response.statusCode, 409);
  assert.deepEqual(JSON.parse(response.body), {
    error: 'cloud_storage_quota_exceeded',
    cloudStorageBytesUsed: 149 * GB,
    cloudStorageQuotaBytes: 150 * GB,
  });
});

test('completion rechecks quota when concurrent offers were initially allowed', async () => {
  const services = fakeServices();
  const GB = 1024 ** 3;
  services.audio.set('account-1/existing', 149 * GB);
  const handler = createHandler(services);
  const first = offerFor(relayIdea('first'));
  const second = offerFor(relayIdea('second'));
  first.audioByteLength = GB;
  second.audioByteLength = GB;

  for (const offer of [first, second]) {
    const initiated = await handler(event('POST /relay/ideas', 'pro', {
      body: JSON.stringify(offer),
    }));
    assert.equal(initiated.statusCode, 200);
  }

  const firstCompletion = await handler(event('POST /relay/ideas/{id}/complete', 'pro', {
    path: '/relay/ideas/first/complete',
    pathParameters: { id: 'first' },
    body: JSON.stringify(first),
  }));
  const secondCompletion = await handler(event('POST /relay/ideas/{id}/complete', 'pro', {
    path: '/relay/ideas/second/complete',
    pathParameters: { id: 'second' },
    body: JSON.stringify(second),
  }));

  assert.equal(firstCompletion.statusCode, 200);
  assert.equal(secondCompletion.statusCode, 409);
  assert.deepEqual(services.relay.cancelledUploads, ['account-1/second']);
});

test('authenticated clients cannot assign their own Tier', async () => {
  const handler = createHandler(fakeServices());

  const response = await handler(event('PUT /me/tier', 'free', {
    body: JSON.stringify({ tier: 'pro' }),
  }));

  assert.equal(response.statusCode, 404);
});

test('an account still stored as Basic reads as Pro and keeps its cloud relay', async () => {
  const handler = createHandler(fakeServices());

  const profile = await handler(event('GET /me', 'basic'));
  assert.equal(JSON.parse(profile.body).tier, 'pro');

  const manifest = await handler(event('GET /relay/manifest', 'basic'));
  assert.equal(manifest.statusCode, 200);
});

test('an unrecognised stored tier falls back to Free rather than paid access', async () => {
  const handler = createHandler(fakeServices());

  const profile = await handler(event('GET /me', 'platinum'));
  assert.equal(JSON.parse(profile.body).tier, 'free');

  const manifest = await handler(event('GET /relay/manifest', 'platinum'));
  assert.equal(manifest.statusCode, 403);
});

test('Pro can upload, list, and download an Idea through the relay', async () => {
  const services = fakeServices();
  const handler = createHandler(services);
  const frame = offerFrame('pro-idea', Buffer.from('audio bytes'));
  const offer = offerFromFrame(frame);

  const initiated = await handler(event('POST /relay/ideas', 'pro', {
    body: JSON.stringify(offer),
  }));
  assert.equal(initiated.statusCode, 200);
  assert.equal(
    JSON.parse(initiated.body).uploadUrl,
    'https://upload.example/account-1/pro-idea',
  );

  const uploaded = await handler(event('POST /relay/ideas/{id}/complete', 'pro', {
    path: '/relay/ideas/pro-idea/complete',
    pathParameters: { id: 'pro-idea' },
    body: JSON.stringify(offer),
  }));
  assert.equal(uploaded.statusCode, 200);
  assert.equal(JSON.parse(uploaded.body).accepted, true);

  const manifest = await handler(event('GET /relay/manifest', 'pro'));
  assert.deepEqual(JSON.parse(manifest.body).have, ['pro-idea']);

  const downloaded = await handler(event('GET /relay/ideas/{id}', 'pro', {
    path: '/relay/ideas/pro-idea',
    pathParameters: { id: 'pro-idea' },
  }));
  assert.equal(downloaded.statusCode, 200);
  const descriptor = JSON.parse(downloaded.body);
  assert.deepEqual(descriptor.offer, offer);
  assert.equal(
    descriptor.downloadUrl,
    'https://download.example/account-1/pro-idea',
  );
});

test('two Capture devices on one paid account contribute to one relay Library', async () => {
  const handler = createHandler(fakeServices());

  for (const [deviceId, ideaId] of [['phone', 'phone-idea'], ['tablet', 'tablet-idea']]) {
    const frame = offerFrame(ideaId, Buffer.from(`${deviceId} audio`), deviceId);
    const offer = offerFromFrame(frame);
    await uploadOffer(handler, 'pro', offer);
  }

  const manifest = await handler(event('GET /relay/manifest', 'pro'));
  assert.deepEqual(
    new Set(JSON.parse(manifest.body).have),
    new Set(['phone-idea', 'tablet-idea']),
  );
});

test('purging an Idea removes its audio and its metadata from the relay', async () => {
  const services = fakeServices();
  const handler = createHandler(services);
  const offer = offerFromFrame(offerFrame('spent-idea', Buffer.from('audio')));
  await uploadOffer(handler, 'pro', offer);

  const purged = await handler(event('DELETE /relay/ideas/{id}', 'pro', {
    path: '/relay/ideas/spent-idea',
    pathParameters: { id: 'spent-idea' },
  }));

  assert.equal(purged.statusCode, 200);
  assert.deepEqual(JSON.parse(purged.body), { ideaId: 'spent-idea', deleted: true });
  assert.deepEqual(JSON.parse((await handler(event('GET /relay/manifest', 'pro'))).body).have, []);
  assert.equal(services.audio.has('account-1/spent-idea'), false);
});

test('purging an Idea the relay never had reports success, so a retry is safe', async () => {
  const handler = createHandler(fakeServices());

  const purged = await handler(event('DELETE /relay/ideas/{id}', 'pro', {
    path: '/relay/ideas/never-uploaded',
    pathParameters: { id: 'never-uploaded' },
  }));

  assert.equal(purged.statusCode, 200);
  assert.equal(JSON.parse(purged.body).deleted, true);
});

test('one account cannot purge another account\'s Idea', async () => {
  const services = fakeServices();
  const handler = createHandler(services);
  const offer = offerFromFrame(offerFrame('private-idea', Buffer.from('audio')));
  await uploadOffer(handler, 'pro', offer, { accountSub: 'account-a' });

  await handler(event('DELETE /relay/ideas/{id}', 'pro', {
    accountSub: 'account-b',
    path: '/relay/ideas/private-idea',
    pathParameters: { id: 'private-idea' },
  }));

  const owner = await handler(event('GET /relay/manifest', 'pro', {
    accountSub: 'account-a',
  }));
  assert.deepEqual(JSON.parse(owner.body).have, ['private-idea']);
});

test('Free accounts cannot purge through the relay', async () => {
  const handler = createHandler(fakeServices());

  const purged = await handler(event('DELETE /relay/ideas/{id}', 'free', {
    path: '/relay/ideas/some-idea',
    pathParameters: { id: 'some-idea' },
  }));

  assert.equal(purged.statusCode, 403);
});

test('a delete never falls through to the download route', async () => {
  const services = fakeServices();
  const handler = createHandler(services);
  const offer = offerFromFrame(offerFrame('kept-idea', Buffer.from('audio')));
  await uploadOffer(handler, 'pro', offer);

  // A payload without routeKey must still be routed by method, or a DELETE
  // would be answered by the GET branch and quietly leave the copy behind.
  const purged = await handler({
    ...event('DELETE /relay/ideas/{id}', 'pro', {
      path: '/relay/ideas/kept-idea',
      pathParameters: { id: 'kept-idea' },
    }),
    routeKey: undefined,
    requestContext: {
      http: { method: 'DELETE', path: '/relay/ideas/kept-idea' },
      authorizer: { jwt: { claims: { sub: 'account-1', email: 'a@example.com' } } },
    },
  });

  assert.equal(JSON.parse(purged.body).deleted, true);
  assert.equal(services.ideas.has('account-1/kept-idea'), false);
});

test('an edit pushed to the relay reaches peers that pull the Library', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'pro', offerFor(relayIdea('edited-idea')));

  const ack = await handler(updateEvent('pro', relayIdea('edited-idea', {
    tags: ['riff'],
    tempo: 120,
    fieldUpdatedAt: { tags: 1700000009000, tempo: 1700000009000 },
  })));

  assert.equal(ack.statusCode, 200);
  assert.deepEqual(JSON.parse(ack.body), {
    kind: 'idea-update-ack',
    ideaId: 'edited-idea',
    accepted: true,
  });
  const [stored] = await relayLibrary(handler, 'pro');
  assert.deepEqual(stored.tags, ['riff']);
  assert.equal(stored.tempo, 120);
  assert.equal(stored.fieldUpdatedAt.tags, 1700000009000);
});

test('an edit also reaches a device that downloads the Idea for the first time', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'pro', offerFor(relayIdea('renamed-idea')));

  await handler(updateEvent('pro', relayIdea('renamed-idea', {
    name: 'Chorus riff',
    fieldUpdatedAt: { name: 1700000009000 },
  })));

  const downloaded = await handler(event('GET /relay/ideas/{id}', 'pro', {
    path: '/relay/ideas/renamed-idea',
    pathParameters: { id: 'renamed-idea' },
  }));
  const descriptor = JSON.parse(downloaded.body);
  assert.equal(descriptor.offer.idea.name, 'Chorus riff');
  // The audio contract must survive a metadata-only edit, or the frame the
  // downloader builds from this offer would no longer match its bytes.
  assert.equal(descriptor.offer.audioByteLength, 11);
});

test('the relay merges edits per field, so a stale field never clobbers a newer one', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'pro', offerFor(relayIdea('shared-idea')));

  // Bridge renames while offline; Capture adds a tag afterwards but still holds
  // the old name. Each field takes whichever edit is newer (ADR 0006).
  await handler(updateEvent('pro', relayIdea('shared-idea', {
    name: 'Verse idea',
    fieldUpdatedAt: { name: 1700000002000 },
  })));
  await handler(updateEvent('pro', relayIdea('shared-idea', {
    name: 'Cloud Idea',
    tags: ['drums'],
    fieldUpdatedAt: { name: 1700000001000, tags: 1700000003000 },
  })));

  const [stored] = await relayLibrary(handler, 'pro');
  assert.equal(stored.name, 'Verse idea');
  assert.deepEqual(stored.tags, ['drums']);
});

test('an Idea uploaded before the metadata schema still merges edits', async () => {
  const handler = createHandler(fakeServices());
  // The pre-metadata offer shape: no tags, no per-field stamps.
  await uploadOffer(handler, 'pro', offerFromFrame(offerFrame('legacy-idea', Buffer.from('audio bytes'))));

  // An edit older than the capture instant loses the name (it was set then),
  // but wins every field that has never been edited.
  await handler(updateEvent('pro', relayIdea('legacy-idea', {
    name: 'Stale name',
    tags: ['loop'],
    fieldUpdatedAt: { name: 1699999999000, tags: 1699999999000 },
  })));

  const [stored] = await relayLibrary(handler, 'pro');
  assert.equal(stored.name, 'Cloud Idea');
  assert.deepEqual(stored.tags, ['loop']);
});

test('an edit to an Idea the relay never received is refused, not invented', async () => {
  const handler = createHandler(fakeServices());

  const ack = await handler(updateEvent('pro', relayIdea('never-uploaded', {
    tags: ['ghost'],
    fieldUpdatedAt: { tags: 1700000009000 },
  })));

  assert.equal(ack.statusCode, 200);
  assert.equal(JSON.parse(ack.body).accepted, false);
  assert.deepEqual(await relayLibrary(handler, 'pro'), []);
});

test('one account cannot edit another account\'s Idea', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'pro', offerFor(relayIdea('private-idea')), {
    accountSub: 'account-a',
  });

  const ack = await handler(updateEvent('pro', relayIdea('private-idea', {
    name: 'Stolen',
    fieldUpdatedAt: { name: 1700000009000 },
  }), { accountSub: 'account-b' }));

  assert.equal(JSON.parse(ack.body).accepted, false);
  const [owned] = await relayLibrary(handler, 'pro', { accountSub: 'account-a' });
  assert.equal(owned.name, 'Cloud Idea');
});

test('Free accounts cannot read or write relay metadata', async () => {
  const handler = createHandler(fakeServices());

  const library = await handler(event('GET /relay/library', 'free'));
  const pushed = await handler(updateEvent('free', relayIdea('some-idea')));

  assert.equal(library.statusCode, 403);
  assert.equal(pushed.statusCode, 403);
});

test('a malformed metadata update is rejected rather than stored', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'pro', offerFor(relayIdea('guarded-idea')));

  const response = await handler(event('POST /relay/updates', 'pro', {
    body: JSON.stringify({ kind: 'idea-metadata-update', from: {}, idea: { id: '../other' } }),
  }));

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'invalid_idea_update');
});

test('an edit missing an editable field can never leave an unreadable Idea behind', async () => {
  // The merge copies a winning field straight into the stored Idea, and both
  // the metadata *and* the audio-download routes serve that same record — so a
  // push carrying a newer stamp but no value would wedge the whole account.
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'pro', offerFor(relayIdea('guarded-idea')));

  const malformed = [
    // `undefined` disappears in JSON, so this arrives as an Idea with no name.
    { name: undefined, fieldUpdatedAt: { name: 1700000009000 } },
    { tags: 'riff', fieldUpdatedAt: { tags: 1700000009000 } },
    { tags: [{ not: 'a string' }], fieldUpdatedAt: { tags: 1700000009000 } },
    { tempo: 'fast', fieldUpdatedAt: { tempo: 1700000009000 } },
    { location: { lat: 'north', lon: 0, label: '' }, fieldUpdatedAt: { location: 1700000009000 } },
  ];
  for (const overrides of malformed) {
    const response = await handler(updateEvent('pro', relayIdea('guarded-idea', overrides)));
    assert.equal(response.statusCode, 400, `expected a rejection for ${JSON.stringify(overrides)}`);
  }

  const [stored] = await relayLibrary(handler, 'pro');
  assert.equal(stored.name, 'Cloud Idea');
  assert.deepEqual(stored.tags, []);
  assert.equal(stored.tempo, null);
  assert.equal(stored.location, null);
});

test('an edit stamped with a nonsense clock never wins a field', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'pro', offerFor(relayIdea('guarded-idea')));

  await handler(updateEvent('pro', relayIdea('guarded-idea', {
    instrument: ['ghost'],
    fieldUpdatedAt: { instrument: 'soon' },
  })));

  const [stored] = await relayLibrary(handler, 'pro');
  assert.deepEqual(stored.instrument, []);
});

test('paid relay Libraries remain isolated by account', async () => {
  const services = fakeServices();
  const handler = createHandler(services);
  const frame = offerFrame('private-idea', Buffer.from('audio'), 'phone');
  const offer = offerFromFrame(frame);
  await uploadOffer(handler, 'pro', offer, { accountSub: 'account-a' });

  const otherAccountManifest = await handler(event('GET /relay/manifest', 'pro', {
    accountSub: 'account-b',
  }));
  assert.deepEqual(JSON.parse(otherAccountManifest.body).have, []);
});
