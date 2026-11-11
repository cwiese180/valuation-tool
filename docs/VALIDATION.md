# Validation and acceptance record

Date: 11 November 2026. Source baseline: `bdb819ea79c244aca7f92b3f7b98b99d15b2fdfa`.

**Overall gate: NOT integration-ready.** This is a runnable synthetic application with implemented backend and adapters. The repository's definition of done includes approved sandbox validation and reviewed representative data; those inputs have not been provided. The original Azure SQL/Next.js architecture has not been deployed or certified.

## Executed checks

| Check | Result |
|---|---|
| Node.js core, provider, authentication, HTTP, persistence and security tests | 68 tests passed; no failed or skipped tests |
| JavaScript syntax checks | Passed |
| npm dependency audit | Zero reported vulnerabilities at time of execution |
| Database migration/restart | Passed; schema versions 1 and 2 |
| Online database backup and restoration | Passed; integrity check, restored evidence count and audit chain |
| Browser sign-in page visual inspection | Passed in managed browser |
| Six Playwright browser regression cases | Passed in GitHub Actions on Ubuntu 24.04 at code commit `f138b7195f073ef0af29c07d106b9d6369d62dd2`; local Chromium remains restricted |
| GitHub publication | Development source is published through the connected GitHub API on `development/integration-foundation`; see the repository pull request for current CI results |
| Real Entra tenant, Graph, Salesforce, Cirrus8 or Azure AI requests | Not run; sandbox permissions, data and expenditure approval absent |

Browser regression cases cover Property 360/rent history, evidence filtering and page viewing, numeric-confirmed review, quote creation/self-approval denial, replay-safe sync and mobile controls. CI runs these on an ordinary GitHub-hosted runner after `npx playwright install --with-deps chromium`; all six passed in [GitHub Actions run 42985317106](https://github.com/cwiese180/valuation-tool/actions/runs/42985317106). `npm run test:e2e` starts an isolated temporary synthetic database and does not use the demo database.

Core tests verify: signature/issuer/audience/tenant/nonce/expiry rejection, server-side roles, tenant and client isolation through real HTTP requests, exact-origin and CSRF checks, atomic imports/cursors, repeat-import deduplication, immutable source versions, source deletion withdrawal, effective-dated rent history, conservative property matching, staged-entity linking, source-page/quote/numeric checks, correction concurrency, independent quote approval, reversible merges, encrypted credentials/original documents, restart recovery and consistent database backups. External source HTTP responses and AI outputs are mocked.

## Repository acceptance gates

| Gate | Current evidence | Status |
|---|---|---|
| No unapproved production access, deployment or expenditure | Source network and paid-AI flags disabled; synthetic data only | Observed |
| Authenticated backend and role/client boundaries | Entra token verification tests, session/HTTP tests and scoped service checks | Implemented; real tenant validation pending |
| Migrations, encrypted secrets and role-based administration | SQLite migrations, AES-GCM storage, administration endpoints/UI | Implemented locally; IT target/at-rest security review pending |
| Source-page traceability for published document evidence | Invalid pages/quotes/numbers block approval; literal numeric confirmation required | Tested with synthetic documents; real original-page verification pending |
| ≥99% critical numeric extraction accuracy | Intentional extraction fault is blocked and corrected in tests | **Not measured** on representative reviewed reports |
| Zero false automatic merges in acceptance cases | Source-ID-only automatic matching; address/title collision tests | Synthetic cases pass; representative cases pending |
| Idempotent imports and reversible merges | Replay, transaction rollback and merge reversal tests | Synthetic cases pass |
| Mock and approved-sandbox validation for all three adapters | Mock pagination, watermark, deletion, retries, effective-date tests | Mock portion passes; sandbox portion blocked |
| Failure/retry/observability workflows | Failed job history, retained cursor, restart recovery, manual replay, HTTP backoff | Implemented for one application process |
| Document/source entitlement preservation | Tenant/client scoping plus authorized original downloads | Mixed-client SharePoint ACL mapping/revocation remains pending |
| Security review and deployment runbook | Internal engineering controls/limits documented; deployment/recovery instructions included | Self-review documented; independent IT review pending |
| Quote prices indicative pending leadership sign-off | Fee labels and independent approval workflow tested | Implemented; calibration/sign-off pending |

## Inputs required to complete acceptance

1. An approved sandbox host and Entra application; two assigned quote approvers; IT decision on SQLite versus the specified Azure SQL target.
2. Read-only sandbox scopes, actual source field mappings, confidentiality rules and the existing Cirrus8 transport contract.
3. Permission for any paid Azure document AI tests, approved regional endpoints and data-processing terms.
4. An approved representative 100-report valuation test set with reviewed numeric truth and page references, plus 20 properties to reconcile across systems.
The synthetic development gate now passes all 68 core/HTTP tests and all six browser cases in GitHub Actions. The sandbox, representative-data and security gates above remain outstanding.

The remaining gates are not satisfied by synthetic fixtures. Do not label the application production-ready or integration-ready until the evidence above is completed and reviewed.
