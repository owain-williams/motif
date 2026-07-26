# @motif/infra

AWS CDK (TypeScript) infrastructure for Motif's serverless backend. See
[ADR 0004](../docs/adr/0004-backend-serverless-aws.md) for the decision and
trade-offs.

## Stack: `MotifBackendStack`

Pinned to account `775696080126` / `eu-west-2` (`bin/motif-infra.ts`). Fully
serverless — no VPC, RDS, NAT, or bastion, so idle cost is ~$0.

| Resource | Purpose |
|---|---|
| Cognito User Pool + app client | Account creation + login (email, `USER_PASSWORD_AUTH`) |
| DynamoDB table `motif` | Account/Idea/tier/pairing metadata (single-table, on-demand) |
| S3 `motif-idea-audio-<acct>-<region>` | Account-scoped cloud-relay Idea audio |
| API Gateway HTTP API + Lambda | Health, verified RevenueCat lifecycle events, account profiles, and authenticated cloud-relay routes |
| Secrets Manager | Generated RevenueCat webhook Authorization credential |

`POST /webhooks/revenuecat` projects the `pro` RevenueCat entitlement onto the
owning Cognito account's Tier. It requires the exact generated Authorization
credential; duplicate and out-of-order lifecycle events cannot replace newer
state. Relay routes require a Cognito ID token and reject Free accounts. Audio: `GET
/relay/manifest`, `POST /relay/ideas`, `POST /relay/ideas/{id}/complete`, `GET
/relay/ideas/{id}`, and `DELETE /relay/ideas/{id}` (the purge sweep, motif-kka.8).
Metadata: `GET /relay/library` and `POST /relay/updates`, the cloud twin of
Bridge's LAN pair — an edit pushed here is merged into the stored Idea by
per-field last-write-wins (ADR 0006), so two devices that are never on the same
network still converge. The authenticated API exchanges metadata and short-lived
account-scoped S3 URLs; audio transfers directly to S3 so Pro WAV Ideas are not
constrained by API Gateway's 10MB request limit. The Cognito account is the paid
pairing boundary: every Capture using the same Pro account reads and
writes one relay manifest, while a different account cannot see those Ideas.
`GET /me` reports `cloudStorageBytesUsed`, summed across the whole relay Library,
and new offers are refused before upload when they would exceed Pro's 150GB
quota.

Everything uses `RemovalPolicy.DESTROY` — fine for the MVP, revisit before this
holds real user data.

## Commands

```bash
pnpm --filter @motif/infra synth      # synth CloudFormation (no AWS calls)
pnpm --filter @motif/infra diff       # diff against deployed stack
pnpm --filter @motif/infra run deploy # deploy (use `run` — `pnpm deploy` is a builtin)
pnpm --filter @motif/infra smoke      # end-to-end: signup + login against the live stack
pnpm --filter @motif/infra destroy    # tear down
```

## Deployed outputs (eu-west-2)

| Output | Value |
|---|---|
| ApiUrl | `https://to8jymiybd.execute-api.eu-west-2.amazonaws.com` |
| UserPoolId | `eu-west-2_VYNyEgLsI` |
| UserPoolClientId | `158crbvjn6ss89plph8p8ivo96` |
| TableName | `motif` |
| BucketName | `motif-idea-audio-775696080126-eu-west-2` |

Re-read anytime with:
`aws cloudformation describe-stacks --stack-name MotifBackendStack --region eu-west-2 --query 'Stacks[0].Outputs'`

## Notes

- **Account routes need the Cognito *ID* token**, not the access token: HTTP
  API's JWT authorizer validates `aud` against the app client id, and Cognito
  access tokens carry no `aud` claim (they use `client_id`). `GET /me` returns
  a new account as Free. Authenticated clients cannot assign Tier; only the
  credential-verified RevenueCat webhook can project paid entitlement state.
- **RevenueCat setup:** read the `RevenueCatWebhookCredentialSecretName` stack
  output, retrieve that secret value, and configure it as the webhook's exact
  Authorization header. Configure the RevenueCat entitlement identifier as
  `pro`, matching `REVENUECAT_PRO_ENTITLEMENT_ID` on the Lambda.
- **Bootstrap:** this env is CDK-bootstrapped (`hnb659fds`). If a deploy fails
  with `No bucket named 'cdk-hnb659fds-assets-...'`, the bootstrap staging bucket
  was deleted out-of-band — recreate it with that exact name (block public
  access, versioning + AES256) and redeploy.
