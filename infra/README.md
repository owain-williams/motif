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
| API Gateway HTTP API + Lambda | Health, account profile/tier, and authenticated cloud-relay routes |

Relay routes require a Cognito ID token and reject Free accounts: `GET
/relay/manifest`, `POST /relay/ideas`, `POST /relay/ideas/{id}/complete`, and
`GET /relay/ideas/{id}`. The authenticated API exchanges metadata and short-lived
account-scoped S3 URLs; audio transfers directly to S3 so Pro WAV Ideas are not
constrained by API Gateway's 10MB request limit. The Cognito account is the paid
pairing boundary: every Capture using the same Basic/Pro account reads and
writes one relay manifest, while a different account cannot see those Ideas.

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
  a new account as Free; `PUT /me/tier` is the temporary self-service debug tier
  control until billing integration owns paid-tier changes.
- **Bootstrap:** this env is CDK-bootstrapped (`hnb659fds`). If a deploy fails
  with `No bucket named 'cdk-hnb659fds-assets-...'`, the bootstrap staging bucket
  was deleted out-of-band — recreate it with that exact name (block public
  access, versioning + AES256) and redeploy.
