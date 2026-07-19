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
| S3 `motif-idea-audio-<acct>-<region>` | Idea audio (empty; not yet wired to apps) |
| API Gateway HTTP API + Lambda | `GET /health` (open), `GET /me` and `PUT /me/tier` (Cognito JWT authorizer) |

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
