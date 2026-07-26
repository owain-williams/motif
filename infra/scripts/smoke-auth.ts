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
 *   7. PUT /me/tier           -> expect a refusal, and an account still Free:
 *                                no user session can assign itself Pro
 *   8. fixture Pro Tier       -> billing owns Tier, so this projects one through
 *                                the credential-verified RevenueCat webhook and
 *                                reads it back
 *   9. cloud relay            -> upload and download an Idea
 *  10. AdminDeleteUser        -> clean up the throwaway test user
 *
 * Uses the ambient AWS credentials/region. Run: pnpm --filter @motif/infra smoke
 */
import { DeleteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { REGION, operatorCredential, stackOutputs } from './deployed-stack';
import { postFixtureTier } from './fixture-tier';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main(): Promise<void> {
  const out = await stackOutputs(REGION);
  const apiUrl = out.ApiUrl;
  const userPoolId = out.UserPoolId;
  const clientId = out.UserPoolClientId;
  const revenueCatSecretName = out.RevenueCatWebhookCredentialSecretName;
  assert(apiUrl && userPoolId && clientId && revenueCatSecretName, 'missing stack outputs');
  console.log(`Region:      ${REGION}`);
  console.log(`API:         ${apiUrl}`);
  console.log(`User pool:   ${userPoolId}`);
  console.log(`App client:  ${clientId}\n`);

  const idp = new CognitoIdentityProviderClient({ region: REGION });
  const dynamo = new DynamoDBClient({ region: REGION });
  const s3 = new S3Client({ region: REGION });
  const email = `smoke+${Date.now()}@motif.test`;
  const password = `Sm0ke!${Math.random().toString(36).slice(2, 10)}A`;
  const ideaId = `smoke-${Date.now()}`;
  let accountSub: string | undefined;

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
    const body = (await me.json()) as {
      sub?: string;
      email?: string;
      tier?: string;
      cloudStorageBytesUsed?: number;
    };
    console.log(`GET /me     -> ${me.status} ${JSON.stringify(body)}`);
    assert(me.status === 200, `/me expected 200, got ${me.status}`);
    assert(body.email === email, `/me returned wrong email: ${body.email}`);
    accountSub = body.sub;
    assert(body.tier === 'free', `/me defaulted to wrong tier: ${body.tier}`);
    assert(body.cloudStorageBytesUsed === 0, `/me returned unexpected storage usage: ${body.cloudStorageBytesUsed}`);

    // 7. The temporary self-service tier control is gone (motif-p73). Proving
    // that against the real gateway matters more than against the handler: a
    // route left behind in the stack would answer here and nowhere else.
    const selfService = await fetch(`${apiUrl}/me/tier`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tier: 'pro' }),
    });
    const afterSelfService = (await fetch(`${apiUrl}/me`, {
      headers: { authorization: `Bearer ${idToken}` },
    }).then((response) => response.json())) as { tier?: string };
    console.log(`PUT /me/tier -> ${selfService.status}; GET /me -> ${afterSelfService.tier}`);
    assert(!selfService.ok, `self-service tier assignment was accepted: ${selfService.status}`);
    assert(
      afterSelfService.tier === 'free',
      `a user session assigned itself ${afterSelfService.tier}`,
    );

    // 8. Only verified billing changes a Tier, so the relay steps below need a
    // fixture projected through that same webhook — the operator credential is
    // what authorizes it, never the account's own session.
    assert(accountSub, '/me returned no account sub to project a Tier onto');
    const credential = await operatorCredential(REGION, revenueCatSecretName);
    const projected = await postFixtureTier({
      apiUrl,
      credential,
      appUserId: accountSub,
      tier: 'pro',
    });
    assert(projected.tier === 'pro', `fixture Tier projected as ${projected.tier}`);
    const updatedMe = await fetch(`${apiUrl}/me`, {
      headers: { authorization: `Bearer ${idToken}` },
    });
    const updatedBody = (await updatedMe.json()) as { tier?: string };
    console.log(`Fixture Pro -> GET /me -> ${updatedBody.tier}`);
    assert(updatedBody.tier === 'pro', `tier update was not persisted: ${updatedBody.tier}`);

    // 9. relay an Idea through real API + presigned S3 URLs.
    const audio = new TextEncoder().encode('smoke audio');
    const offer = {
      kind: 'idea-sync-offer',
      from: { deviceId: 'smoke-capture', displayName: 'Smoke', role: 'capture' },
      idea: {
        id: ideaId,
        name: 'Smoke Idea',
        capturedAt: Date.now(),
        durationMs: 1000,
        audioFormat: 'aac',
        channels: 1,
        storageState: 'on-device',
      },
      audioByteLength: audio.length,
    };
    const initiate = await fetch(`${apiUrl}/relay/ideas`, {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(offer),
    });
    const initiated = (await initiate.json()) as { uploadUrl?: string };
    assert(initiate.status === 200 && initiated.uploadUrl, 'relay initiation failed');
    const upload = await fetch(initiated.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: audio,
    });
    assert(upload.ok, `S3 upload failed: ${upload.status}`);
    const complete = await fetch(`${apiUrl}/relay/ideas/${ideaId}/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(offer),
    });
    assert(complete.ok, `relay completion failed: ${complete.status}`);
    const manifest = await fetch(`${apiUrl}/relay/manifest`, {
      headers: { authorization: `Bearer ${idToken}` },
    }).then((response) => response.json()) as { have?: string[] };
    assert(manifest.have?.includes(ideaId), 'relay manifest omitted uploaded Idea');
    const descriptor = await fetch(`${apiUrl}/relay/ideas/${ideaId}`, {
      headers: { authorization: `Bearer ${idToken}` },
    }).then((response) => response.json()) as { downloadUrl?: string };
    assert(descriptor.downloadUrl, 'relay download URL missing');
    const downloadedBuffer = await fetch(descriptor.downloadUrl).then((response) => response.arrayBuffer());
    const downloaded = new Uint8Array(downloadedBuffer as ArrayBuffer);
    assert(new TextDecoder().decode(downloaded) === 'smoke audio', 'relay audio did not round-trip');
    console.log('Cloud relay -> upload + manifest + download ok');
  } finally {
    // 10. cleanup
    if (accountSub) {
      await Promise.all([
        dynamo.send(new DeleteItemCommand({
          TableName: out.TableName,
          Key: { PK: { S: `ACCOUNT#${accountSub}` }, SK: { S: `IDEA#${ideaId}` } },
        })),
        dynamo.send(new DeleteItemCommand({
          TableName: out.TableName,
          Key: { PK: { S: `ACCOUNT#${accountSub}` }, SK: { S: 'PROFILE' } },
        })),
        s3.send(new DeleteObjectCommand({
          Bucket: out.BucketName,
          Key: `accounts/${accountSub}/ideas/${ideaId}`,
        })),
      ]).catch((error) => console.warn('Relay cleanup failed (non-fatal):', error?.message));
    }
    await idp
      .send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }))
      .then(() => console.log('Cleanup     -> deleted test user'))
      .catch((e) => console.warn('Cleanup failed (non-fatal):', e?.message));
  }

  console.log('\n✅ Smoke test passed: account + cloud relay end-to-end.');
}

main().catch((err) => {
  console.error('\n❌ Smoke test failed:', err);
  process.exit(1);
});
