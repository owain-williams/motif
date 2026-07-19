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
    },
  };
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
