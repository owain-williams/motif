/**
 * Fixture Tiers for automated tests and local development (motif-p73).
 *
 * This is deliberately not a second way to change a Tier. A fixture is an
 * ordinary RevenueCat lifecycle event posted to the same credential-verified
 * webhook real billing posts to, so establishing one takes the operator
 * credential out of Secrets Manager rather than a user session — Capture,
 * Bridge, and anything else holding only a Cognito token still have no path of
 * their own. Fixtures therefore inherit the projection, ordering, and
 * idempotency rules a real purchase goes through instead of side-stepping them.
 */

/** The Tiers an account can hold (ADR 0008). */
export const TIERS = ['free', 'pro'] as const;

export type Tier = (typeof TIERS)[number];

/** Mirrors `REVENUECAT_PRO_ENTITLEMENT_ID` on the deployed Lambda. */
const PRO_ENTITLEMENT_ID = 'pro';

/**
 * Marks the event id a fixture projects. Once projected, a fixture Tier and a
 * purchased one are the same account row, so this is what tells an operator
 * reading that row which of the two they are looking at.
 */
const FIXTURE_EVENT_ID_PREFIX = 'fixture-';

/**
 * Cognito subs, which is what `app_user_id` must be. Reaching for an email or a
 * username instead is the easy mistake here, and one the API can only answer
 * with an opaque 400 — so it is worth refusing before anything leaves the
 * machine.
 */
const ACCOUNT_SUB = /^[A-Za-z0-9-]{8,128}$/;

export function isTier(value: string | undefined): value is Tier {
  return TIERS.includes(value as Tier);
}

export interface RevenueCatWebhookBody {
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly event_timestamp_ms: number;
    readonly app_user_id: string;
    readonly entitlement_ids: readonly string[];
  };
}

/**
 * The webhook body that projects `tier` onto `appUserId`. Pro arrives as a
 * purchase and Free as an expiration, the same two shapes the store sends, so
 * the handler needs no notion of a fixture to honour one.
 *
 * @param appUserId Cognito account sub, as returned by `GET /me`.
 */
export function fixtureTierPayload(
  appUserId: string,
  tier: string,
  options: { readonly now?: number } = {},
): RevenueCatWebhookBody {
  if (!isTier(tier)) {
    throw new Error(`A fixture Tier must be one of free|pro, not "${tier}".`);
  }
  if (!ACCOUNT_SUB.test(appUserId)) {
    throw new Error(
      `A fixture Tier is keyed by the Cognito account sub that GET /me reports, not "${appUserId}".`,
    );
  }
  const now = options.now ?? Date.now();
  return {
    event: {
      // The id and timestamp together order lifecycle events, so re-running a
      // fixture at the same instant is the one case that will not take: the
      // account already holds that version. Any later run wins normally.
      id: `${FIXTURE_EVENT_ID_PREFIX}${tier}-${now}`,
      type: tier === 'pro' ? 'INITIAL_PURCHASE' : 'EXPIRATION',
      event_timestamp_ms: now,
      app_user_id: appUserId,
      entitlement_ids: [PRO_ENTITLEMENT_ID],
    },
  };
}

interface FixtureTarget {
  readonly apiUrl: string;
  readonly credential: string;
  readonly appUserId: string;
  readonly tier: Tier;
}

/**
 * Projects a fixture Tier through the deployed webhook, failing loudly rather
 * than leaving a caller to discover later that the Tier never moved.
 */
export async function postFixtureTier({
  apiUrl,
  credential,
  appUserId,
  tier,
}: FixtureTarget): Promise<{ tier: string }> {
  const response = await fetch(`${apiUrl}/webhooks/revenuecat`, {
    method: 'POST',
    headers: { authorization: credential, 'content-type': 'application/json' },
    body: JSON.stringify(fixtureTierPayload(appUserId, tier)),
  });
  const body = (await response.json().catch(() => ({}))) as {
    accepted?: boolean;
    tier?: string;
  };
  if (!response.ok) {
    throw new Error(
      `The webhook refused the fixture Tier (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  // The webhook declines for two very different reasons and answers both the
  // same way. It names the Tier it worked out only when it recognised the
  // entitlement, so the absent one means this deployment calls Pro something
  // other than `${PRO_ENTITLEMENT_ID}` — telling an operator their fixture lost
  // a race would send them looking in the wrong place entirely.
  if (!body.accepted) {
    throw new Error(
      body.tier === undefined
        ? `This deployment does not know the "${PRO_ENTITLEMENT_ID}" entitlement; check REVENUECAT_PRO_ENTITLEMENT_ID on the Lambda.`
        : `${appUserId} already holds a newer billing event than this fixture, so its Tier is unchanged.`,
    );
  }
  return { tier: body.tier ?? tier };
}
