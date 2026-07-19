'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHandler } = require('./handler');

function event(routeKey, tier, options = {}) {
  return {
    routeKey,
    rawPath: options.path ?? routeKey.split(' ')[1],
    pathParameters: options.pathParameters,
    body: options.body,
    isBase64Encoded: options.isBase64Encoded,
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'account-1', email: 'a@example.com' } } },
    },
    testTier: tier,
  };
}

function offerFrame(id, audio) {
  const offer = Buffer.from(JSON.stringify({
    kind: 'idea-sync-offer',
    from: { deviceId: 'capture-1', displayName: 'Phone', role: 'capture' },
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
      list: async () => [...ideas.keys()],
      begin: async (_sub, id) => `https://upload.example/${id}`,
      complete: async (_sub, id, offerJson, audioByteLength) => {
        ideas.set(id, offerJson);
        audio.set(id, audioByteLength);
        return true;
      },
      get: async (_sub, id) => {
        if (!ideas.has(id)) return null;
        return {
          offer: JSON.parse(ideas.get(id)),
          downloadUrl: `https://download.example/${id}`,
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
    const jsonLength = frame.readUInt32BE(0);
    const offer = JSON.parse(frame.subarray(4, 4 + jsonLength).toString());

    const initiated = await handler(event('POST /relay/ideas', tier, {
      body: JSON.stringify(offer),
    }));
    assert.equal(initiated.statusCode, 200);
    assert.equal(JSON.parse(initiated.body).uploadUrl, `https://upload.example/${tier}-idea`);

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
    assert.equal(descriptor.downloadUrl, `https://download.example/${tier}-idea`);
  }
});
