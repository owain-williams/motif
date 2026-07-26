/**
 * Establishes a fixture Tier on a development account (motif-p73):
 *
 *   pnpm --filter @motif/infra tier <email-or-account-sub> <free|pro> --confirm
 *
 * Billing owns Tier in production, and neither Capture nor the account API can
 * assign one. This is the development counterpart: it takes AWS credentials for
 * the deployed stack, reads the operator webhook credential from Secrets
 * Manager, and projects the Tier through the same verified RevenueCat webhook a
 * real purchase arrives on.
 *
 * There is one deployed stack, so that account store is also the real one and a
 * mistyped email is somebody's actual subscription. Hence the two-step: the
 * first run only resolves and reports the account it would change, and
 * `--confirm` is what actually moves a Tier.
 */
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { REGION, operatorCredential, stackOutputs } from './deployed-stack';
import { TIERS, isTier, postFixtureTier } from './fixture-tier';

const USAGE = `Usage: pnpm --filter @motif/infra tier <email-or-account-sub> <${TIERS.join('|')}> [--confirm]`;

/**
 * The Cognito sub for an account, accepting the email a developer signed up
 * with as well as the sub itself — nobody remembers their own sub.
 */
async function accountSub(identifier: string, userPoolId: string): Promise<string> {
  if (!identifier.includes('@')) return identifier;
  const idp = new CognitoIdentityProviderClient({ region: REGION });
  const user = await idp.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: identifier }),
  );
  const sub = user.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  if (!sub) throw new Error(`No Cognito account found for ${identifier}`);
  return sub;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmed = args.includes('--confirm');
  const [identifier, tier] = args.filter((arg) => !arg.startsWith('--'));
  if (!identifier || !isTier(tier)) throw new Error(USAGE);

  const outputs = await stackOutputs(REGION);
  const { ApiUrl, UserPoolId, RevenueCatWebhookCredentialSecretName } = outputs;
  if (!ApiUrl || !UserPoolId || !RevenueCatWebhookCredentialSecretName) {
    throw new Error('Stack outputs are missing the API, user pool, or webhook credential');
  }

  const sub = await accountSub(identifier, UserPoolId);
  const account = sub === identifier ? sub : `${identifier} (${sub})`;
  if (!confirmed) {
    console.log(`Would set ${account} to ${tier}.`);
    console.log(`Re-run with --confirm if that is the right account.`);
    return;
  }

  const projected = await postFixtureTier({
    apiUrl: ApiUrl,
    credential: await operatorCredential(REGION, RevenueCatWebhookCredentialSecretName),
    appUserId: sub,
    tier,
  });
  console.log(`${account} is now ${projected.tier}.`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Could not set a fixture Tier: ${reason}`);
  process.exit(1);
});
