/**
 * End-to-end proof for motif-6fu.2 AC "a test client can create an account and
 * log in". Against the deployed MotifBackendStack this:
 *
 *   1. reads stack outputs from CloudFormation
 *   2. GET /health           -> expect 200 (instance reachable)
 *   3. SignUp                 -> real self-service account creation
 *   4. AdminConfirmSignUp     -> stands in for the email-verify click (no inbox
 *                                in automation)
 *   5. InitiateAuth           -> USER_PASSWORD_AUTH login, returns JWTs
 *   6. GET /me with IdToken   -> expect the default Free tier
 *   7. PUT /me/tier           -> set and read back the debug Basic tier
 *   8. AdminDeleteUser        -> clean up the throwaway test user
 *
 * Uses the ambient AWS credentials/region. Run: pnpm --filter @motif/infra smoke
 */
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const STACK_NAME = 'MotifBackendStack';
const REGION = process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'eu-west-2';

async function outputs(): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({ region: REGION });
  const res = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const stack = res.Stacks?.[0];
  if (!stack) throw new Error(`Stack ${STACK_NAME} not found in ${REGION}`);
  const map: Record<string, string> = {};
  for (const o of stack.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue) map[o.OutputKey] = o.OutputValue;
  }
  return map;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main(): Promise<void> {
  const out = await outputs();
  const apiUrl = out.ApiUrl;
  const userPoolId = out.UserPoolId;
  const clientId = out.UserPoolClientId;
  assert(apiUrl && userPoolId && clientId, 'missing stack outputs');
  console.log(`Region:      ${REGION}`);
  console.log(`API:         ${apiUrl}`);
  console.log(`User pool:   ${userPoolId}`);
  console.log(`App client:  ${clientId}\n`);

  const idp = new CognitoIdentityProviderClient({ region: REGION });
  const email = `smoke+${Date.now()}@motif.test`;
  const password = `Sm0ke!${Math.random().toString(36).slice(2, 10)}A`;

  // 2. reachable
  const health = await fetch(`${apiUrl}/health`);
  console.log(`GET /health -> ${health.status}`);
  assert(health.status === 200, `/health expected 200, got ${health.status}`);

  try {
    // 3. create account
    await idp.send(
      new SignUpCommand({
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }],
      }),
    );
    console.log(`SignUp      -> created ${email}`);

    // 4. confirm (email-verify stand-in)
    await idp.send(
      new AdminConfirmSignUpCommand({ UserPoolId: userPoolId, Username: email }),
    );
    console.log('Confirm     -> ok');

    // 5. log in
    const auth = await idp.send(
      new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      }),
    );
    const idToken = auth.AuthenticationResult?.IdToken;
    assert(idToken, 'login returned no IdToken');
    console.log('Login       -> got IdToken');

    // 6. authenticated call (send IdToken: Cognito access tokens carry no `aud`
    // claim, which the HTTP API JWT authorizer validates against the client id)
    const me = await fetch(`${apiUrl}/me`, {
      headers: { authorization: `Bearer ${idToken}` },
    });
    const body = (await me.json()) as { sub?: string; email?: string; tier?: string };
    console.log(`GET /me     -> ${me.status} ${JSON.stringify(body)}`);
    assert(me.status === 200, `/me expected 200, got ${me.status}`);
    assert(body.email === email, `/me returned wrong email: ${body.email}`);
    assert(body.tier === 'free', `/me defaulted to wrong tier: ${body.tier}`);

    // 7. temporary tier assignment path, pending billing integration.
    const tierUpdate = await fetch(`${apiUrl}/me/tier`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tier: 'basic' }),
    });
    assert(tierUpdate.status === 200, `/me/tier expected 200, got ${tierUpdate.status}`);
    const updatedMe = await fetch(`${apiUrl}/me`, {
      headers: { authorization: `Bearer ${idToken}` },
    });
    const updatedBody = (await updatedMe.json()) as { tier?: string };
    console.log(`PUT tier    -> ${tierUpdate.status}; GET /me -> ${updatedBody.tier}`);
    assert(updatedBody.tier === 'basic', `tier update was not persisted: ${updatedBody.tier}`);
  } finally {
    // 8. cleanup
    await idp
      .send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }))
      .then(() => console.log('Cleanup     -> deleted test user'))
      .catch((e) => console.warn('Cleanup failed (non-fatal):', e?.message));
  }

  console.log('\n✅ Auth smoke test passed: account created + logged in end-to-end.');
}

main().catch((err) => {
  console.error('\n❌ Smoke test failed:', err);
  process.exit(1);
});
