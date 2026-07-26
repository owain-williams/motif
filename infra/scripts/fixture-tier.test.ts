import assert from 'node:assert/strict';
import test from 'node:test';
// The Lambda is deployed unbundled and so is plain JavaScript. Driving the one
// round-trip test through the real handler is the point: a fixture is worth
// nothing unless the production projection rules accept what it builds.
import { createHandler } from '../lambda/handler';
import { fixtureTierPayload, type RevenueCatWebhookBody } from './fixture-tier';

const CREDENTIAL = 'Bearer operator-only-secret';
const SUB = '11111111-2222-3333-4444-555555555555';

interface StoredProfile {
  tier: string;
  version: string;
  eventId: string;
}

/** The profile row the webhook writes: a Tier, and the event that set it. */
function accountStore() {
  const profiles = new Map<string, StoredProfile>();
  return {
    profiles,
    accounts: {
      profile: async (sub: string) => ({ tier: profiles.get(sub)?.tier ?? 'free' }),
      projectRevenueCatTier: async (
        sub: string,
        tier: string,
        version: string,
        eventId: string,
      ) => {
        const current = profiles.get(sub);
        if (current && current.version >= version) return false;
        profiles.set(sub, { tier, version, eventId });
        return true;
      },
    },
    relay: { bytesUsed: async () => 0, list: async () => [] },
  };
}

function handlerFor(services: ReturnType<typeof accountStore>) {
  return createHandler(services, {
    revenueCatAuthorization: CREDENTIAL,
    proEntitlementId: 'pro',
  });
}

function webhookRequest(payload: RevenueCatWebhookBody) {
  return {
    routeKey: 'POST /webhooks/revenuecat',
    rawPath: '/webhooks/revenuecat',
    headers: { authorization: CREDENTIAL },
    body: JSON.stringify(payload),
    requestContext: { http: { method: 'POST', path: '/webhooks/revenuecat' } },
  };
}

function relayRequest(sub: string) {
  return {
    routeKey: 'GET /relay/manifest',
    rawPath: '/relay/manifest',
    requestContext: {
      authorizer: { jwt: { claims: { sub, email: 'dev@example.com' } } },
    },
  };
}

test('fixtures move an account between Free and Pro through the real billing path', async () => {
  const handler = handlerFor(accountStore());

  const granted = await handler(
    webhookRequest(fixtureTierPayload(SUB, 'pro', { now: 1_000 })),
  );
  const paid = await handler(relayRequest(SUB));
  const revoked = await handler(
    webhookRequest(fixtureTierPayload(SUB, 'free', { now: 2_000 })),
  );
  const free = await handler(relayRequest(SUB));

  assert.deepEqual(JSON.parse(granted.body), { accepted: true, tier: 'pro' });
  assert.equal(paid.statusCode, 200);
  assert.deepEqual(JSON.parse(revoked.body), { accepted: true, tier: 'free' });
  assert.equal(free.statusCode, 403);
});

test('a fixture Tier is recorded as a fixture rather than as a store purchase', async () => {
  const services = accountStore();
  const handler = handlerFor(services);

  await handler(webhookRequest(fixtureTierPayload(SUB, 'pro', { now: 1_000 })));

  // The account row is where an operator finds out whether a Tier was bought or
  // seeded; nothing else distinguishes the two once projected.
  assert.match(services.profiles.get(SUB)!.eventId, /^fixture-/);
});

test('a fixture aimed at something other than an account sub is refused locally', () => {
  assert.throws(
    () => fixtureTierPayload('dev@example.com', 'pro', { now: 1_000 }),
    /account sub/,
  );
});

test('a fixture for a Tier the account model does not have is refused locally', () => {
  assert.throws(() => fixtureTierPayload(SUB, 'platinum', { now: 1_000 }), /free\|pro/);
});
