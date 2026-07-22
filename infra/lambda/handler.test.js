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
    body: options.body,
    isBase64Encoded: options.isBase64Encoded,
    requestContext: {
      authorizer: { jwt: { claims: { sub: accountSub, email: 'a@example.com' } } },
    },
    testTier: tier,
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
  return {
    ideas,
    audio,
    accounts: {
      profile: async (_sub, event) => ({ tier: event.testTier }),
      setTier: async () => {},
    },
    relay: {
      list: async (sub) => [...ideas.keys()]
        .filter((key) => key.startsWith(`${sub}/`))
        .map((key) => key.slice(sub.length + 1)),
      begin: async (sub, id) => `https://upload.example/${sub}/${id}`,
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

test('Free accounts cannot access the cloud relay', async () => {
  const handler = createHandler(fakeServices());
  const response = await handler(event('GET /relay/manifest', 'free'));
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: 'cloud_relay_requires_paid_tier' });
});

test('Basic/Pro can upload, list, and download an Idea through the relay', async () => {
  for (const tier of ['basic', 'pro']) {
    const services = fakeServices();
    const handler = createHandler(services);
    const frame = offerFrame(`${tier}-idea`, Buffer.from('audio bytes'));
    const offer = offerFromFrame(frame);

    const initiated = await handler(event('POST /relay/ideas', tier, {
      body: JSON.stringify(offer),
    }));
    assert.equal(initiated.statusCode, 200);
    assert.equal(
      JSON.parse(initiated.body).uploadUrl,
      `https://upload.example/account-1/${tier}-idea`,
    );

    const uploaded = await handler(event('POST /relay/ideas/{id}/complete', tier, {
      path: `/relay/ideas/${tier}-idea/complete`,
      pathParameters: { id: `${tier}-idea` },
      body: JSON.stringify(offer),
    }));
    assert.equal(uploaded.statusCode, 200);
    assert.equal(JSON.parse(uploaded.body).accepted, true);

    const manifest = await handler(event('GET /relay/manifest', tier));
    assert.deepEqual(JSON.parse(manifest.body).have, [`${tier}-idea`]);

    const downloaded = await handler(event('GET /relay/ideas/{id}', tier, {
      path: `/relay/ideas/${tier}-idea`,
      pathParameters: { id: `${tier}-idea` },
    }));
    assert.equal(downloaded.statusCode, 200);
    const descriptor = JSON.parse(downloaded.body);
    assert.deepEqual(descriptor.offer, offer);
    assert.equal(
      descriptor.downloadUrl,
      `https://download.example/account-1/${tier}-idea`,
    );
  }
});

test('two Capture devices on one paid account contribute to one relay Library', async () => {
  for (const tier of ['basic', 'pro']) {
    const services = fakeServices();
    const handler = createHandler(services);

    for (const [deviceId, ideaId] of [['phone', 'phone-idea'], ['tablet', 'tablet-idea']]) {
      const frame = offerFrame(ideaId, Buffer.from(`${deviceId} audio`), deviceId);
      const offer = offerFromFrame(frame);
      await uploadOffer(handler, tier, offer);
    }

    const manifest = await handler(event('GET /relay/manifest', tier));
    assert.deepEqual(
      new Set(JSON.parse(manifest.body).have),
      new Set(['phone-idea', 'tablet-idea']),
    );
  }
});

test('purging an Idea removes its audio and its metadata from the relay', async () => {
  const services = fakeServices();
  const handler = createHandler(services);
  const offer = offerFromFrame(offerFrame('spent-idea', Buffer.from('audio')));
  await uploadOffer(handler, 'basic', offer);

  const purged = await handler(event('DELETE /relay/ideas/{id}', 'basic', {
    path: '/relay/ideas/spent-idea',
    pathParameters: { id: 'spent-idea' },
  }));

  assert.equal(purged.statusCode, 200);
  assert.deepEqual(JSON.parse(purged.body), { ideaId: 'spent-idea', deleted: true });
  assert.deepEqual(JSON.parse((await handler(event('GET /relay/manifest', 'basic'))).body).have, []);
  assert.equal(services.audio.has('account-1/spent-idea'), false);
});

test('purging an Idea the relay never had reports success, so a retry is safe', async () => {
  const handler = createHandler(fakeServices());

  const purged = await handler(event('DELETE /relay/ideas/{id}', 'basic', {
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
  await uploadOffer(handler, 'basic', offer, { accountSub: 'account-a' });

  await handler(event('DELETE /relay/ideas/{id}', 'basic', {
    accountSub: 'account-b',
    path: '/relay/ideas/private-idea',
    pathParameters: { id: 'private-idea' },
  }));

  const owner = await handler(event('GET /relay/manifest', 'basic', {
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
  await uploadOffer(handler, 'basic', offer);

  // A payload without routeKey must still be routed by method, or a DELETE
  // would be answered by the GET branch and quietly leave the copy behind.
  const purged = await handler({
    ...event('DELETE /relay/ideas/{id}', 'basic', {
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
  await uploadOffer(handler, 'basic', offerFor(relayIdea('edited-idea')));

  const ack = await handler(updateEvent('basic', relayIdea('edited-idea', {
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
  const [stored] = await relayLibrary(handler, 'basic');
  assert.deepEqual(stored.tags, ['riff']);
  assert.equal(stored.tempo, 120);
  assert.equal(stored.fieldUpdatedAt.tags, 1700000009000);
});

test('an edit also reaches a device that downloads the Idea for the first time', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'basic', offerFor(relayIdea('renamed-idea')));

  await handler(updateEvent('basic', relayIdea('renamed-idea', {
    name: 'Chorus riff',
    fieldUpdatedAt: { name: 1700000009000 },
  })));

  const downloaded = await handler(event('GET /relay/ideas/{id}', 'basic', {
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
  await uploadOffer(handler, 'basic', offerFor(relayIdea('shared-idea')));

  // Bridge renames while offline; Capture adds a tag afterwards but still holds
  // the old name. Each field takes whichever edit is newer (ADR 0006).
  await handler(updateEvent('basic', relayIdea('shared-idea', {
    name: 'Verse idea',
    fieldUpdatedAt: { name: 1700000002000 },
  })));
  await handler(updateEvent('basic', relayIdea('shared-idea', {
    name: 'Cloud Idea',
    tags: ['drums'],
    fieldUpdatedAt: { name: 1700000001000, tags: 1700000003000 },
  })));

  const [stored] = await relayLibrary(handler, 'basic');
  assert.equal(stored.name, 'Verse idea');
  assert.deepEqual(stored.tags, ['drums']);
});

test('an Idea uploaded before the metadata schema still merges edits', async () => {
  const handler = createHandler(fakeServices());
  // The pre-metadata offer shape: no tags, no per-field stamps.
  await uploadOffer(handler, 'basic', offerFromFrame(offerFrame('legacy-idea', Buffer.from('audio bytes'))));

  // An edit older than the capture instant loses the name (it was set then),
  // but wins every field that has never been edited.
  await handler(updateEvent('basic', relayIdea('legacy-idea', {
    name: 'Stale name',
    tags: ['loop'],
    fieldUpdatedAt: { name: 1699999999000, tags: 1699999999000 },
  })));

  const [stored] = await relayLibrary(handler, 'basic');
  assert.equal(stored.name, 'Cloud Idea');
  assert.deepEqual(stored.tags, ['loop']);
});

test('an edit to an Idea the relay never received is refused, not invented', async () => {
  const handler = createHandler(fakeServices());

  const ack = await handler(updateEvent('basic', relayIdea('never-uploaded', {
    tags: ['ghost'],
    fieldUpdatedAt: { tags: 1700000009000 },
  })));

  assert.equal(ack.statusCode, 200);
  assert.equal(JSON.parse(ack.body).accepted, false);
  assert.deepEqual(await relayLibrary(handler, 'basic'), []);
});

test('one account cannot edit another account\'s Idea', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'basic', offerFor(relayIdea('private-idea')), {
    accountSub: 'account-a',
  });

  const ack = await handler(updateEvent('basic', relayIdea('private-idea', {
    name: 'Stolen',
    fieldUpdatedAt: { name: 1700000009000 },
  }), { accountSub: 'account-b' }));

  assert.equal(JSON.parse(ack.body).accepted, false);
  const [owned] = await relayLibrary(handler, 'basic', { accountSub: 'account-a' });
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
  await uploadOffer(handler, 'basic', offerFor(relayIdea('guarded-idea')));

  const response = await handler(event('POST /relay/updates', 'basic', {
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
  await uploadOffer(handler, 'basic', offerFor(relayIdea('guarded-idea')));

  const malformed = [
    // `undefined` disappears in JSON, so this arrives as an Idea with no name.
    { name: undefined, fieldUpdatedAt: { name: 1700000009000 } },
    { tags: 'riff', fieldUpdatedAt: { tags: 1700000009000 } },
    { tags: [{ not: 'a string' }], fieldUpdatedAt: { tags: 1700000009000 } },
    { tempo: 'fast', fieldUpdatedAt: { tempo: 1700000009000 } },
    { location: { lat: 'north', lon: 0, label: '' }, fieldUpdatedAt: { location: 1700000009000 } },
  ];
  for (const overrides of malformed) {
    const response = await handler(updateEvent('basic', relayIdea('guarded-idea', overrides)));
    assert.equal(response.statusCode, 400, `expected a rejection for ${JSON.stringify(overrides)}`);
  }

  const [stored] = await relayLibrary(handler, 'basic');
  assert.equal(stored.name, 'Cloud Idea');
  assert.deepEqual(stored.tags, []);
  assert.equal(stored.tempo, null);
  assert.equal(stored.location, null);
});

test('an edit stamped with a nonsense clock never wins a field', async () => {
  const handler = createHandler(fakeServices());
  await uploadOffer(handler, 'basic', offerFor(relayIdea('guarded-idea')));

  await handler(updateEvent('basic', relayIdea('guarded-idea', {
    instrument: ['ghost'],
    fieldUpdatedAt: { instrument: 'soon' },
  })));

  const [stored] = await relayLibrary(handler, 'basic');
  assert.deepEqual(stored.instrument, []);
});

test('paid relay Libraries remain isolated by account', async () => {
  const services = fakeServices();
  const handler = createHandler(services);
  const frame = offerFrame('private-idea', Buffer.from('audio'), 'phone');
  const offer = offerFromFrame(frame);
  await uploadOffer(handler, 'basic', offer, { accountSub: 'account-a' });

  const otherAccountManifest = await handler(event('GET /relay/manifest', 'basic', {
    accountSub: 'account-b',
  }));
  assert.deepEqual(JSON.parse(otherAccountManifest.body).have, []);
});
