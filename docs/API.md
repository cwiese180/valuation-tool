# API contract

All `/api/*` routes require an authenticated session. GET responses are JSON except authorized original-file downloads. Mutations accept JSON objects and require the exact configured `Origin` plus the `X-CSRF-Token` returned by `/auth/session`. Session cookies are HTTP-only. Entra mode uses HTTPS secure cookies. No CORS or browser-supplied identity headers are trusted.

Errors return `{ "error": "message", "requestId": "uuid" }`. Statuses include 400 (invalid input), 401 (sign-in required), 403 (role/origin/CSRF denied), 404 (missing or outside record scope), 409 (stale version/workflow conflict), 413 (size limit), 415 (content type), 422 (unresolved validation/configuration) and 429 (rate limit). Internal errors expose no provider payload or secret.

## Identity

| Method and path | Behaviour |
|---|---|
| `GET /health` | Database availability; no record data |
| `GET /auth/config` | Sign-in mode |
| `GET /auth/login` | Entra authorization-code/PKCE redirect |
| `GET /auth/callback` | Validate OIDC state, nonce, signed identity token and explicit grant |
| `POST /auth/demo` | Loopback synthetic mode only; `{code:string}` |
| `GET /auth/session` | Authorized user, CSRF token and session expiry |
| `POST /auth/logout` | Invalidate current session |

## Property and evidence

| Method and path | Role | Contract |
|---|---|---|
| `GET /api/properties` | Reader+ | Client-scoped property collection |
| `GET /api/properties/:id` | Reader+ | Property with linked evidence, entities, quotes and relationships |
| `POST /api/properties` | Admin | `{client,address,locality?,assetClass?,titleReference?,data?}` |
| `GET /api/evidence` | Reader+ | Filters: `q`, `status`, `kind`, `transaction_status`, `property_id` |
| `PATCH /api/evidence/:id` | Reviewer+ | Pending only: `{version,value:number,unit,basis,page?,quote?,reason}`. Original extraction remains in immutable raw history; corrections are audited |
| `GET /api/documents/:id` | Reader+ | Authorized source text/pages/model/hash; protected upstream URI omitted |
| `GET /api/documents/:id/file` | Reader+ | Authorized encrypted-vault original; fixture documents return 404 |
| `GET /api/reviews` | Reader+ | Client-scoped review tasks |
| `POST /api/reviews/:id` | Reviewer+ | `{decision:"approved"|"rejected",reason,version?,confirmedValue?,propertyId?}`. Evidence decisions need the current version; approved document observations also need exact source numeric confirmation. Property matches require an explicit property ID |

Evidence statuses are `pending`, `verified`, `rejected`, `withdrawn`; review decisions use `approved`/`rejected`. Transaction status (`settled`, `contracted`, `executed`, `indicative`, `opinion`) is independent of verification status and source class. Null numeric values remain unknown. No route publishes document evidence without review.

## Quotes

| Method and path | Role | Contract |
|---|---|---|
| `GET /api/quotes` | Reader+ | Client-scoped quotes |
| `POST /api/quotes` | Valuer+ | `{propertyId,purpose,hours:number,rate:number,costRate:number,expenses?:number,assumptions?:string}` |
| `POST /api/quotes/:id` | Valuer/Admin | `{version,status}`; `draft → submitted` and `approved → issued` require valuer; `submitted → approved` requires a different administrator from the author |

Fee = hours × fee rate + expenses; cost = hours × loaded cost rate + expenses. Contribution = fee − cost. Prices are AUD excluding GST and remain explicitly indicative. The browser's printable proposal excludes internal cost and contribution.

## Administration

Tenant-wide connector, secret, audit and job operations require an administrator with `clients:["*"]`. Identity and merge operations additionally check each property's client boundary.

| Method and path | Contract |
|---|---|
| `GET /api/admin/connectors` | Last success/error, cursor, import counts, pause state |
| `GET /api/admin/connectors/:system/test` | Connectivity and visible scope |
| `GET /api/admin/connectors/:system/schema` | Source field metadata |
| `GET /api/admin/connectors/:system/preview` | Redacted source preview |
| `POST /api/admin/connectors/:system/sync` | Import/replay from last committed cursor |
| `POST /api/admin/connectors/:system/pause` | `{paused:boolean}` |
| `POST /api/admin/import` | `{system,records:[normalised envelopes]}`; staging, matching, validation and review apply |
| `POST /api/admin/mappings` | `{system,sourceId,propertyId,reason}`; reviewed source identity mapping (reviewer+) |
| `GET /api/admin/jobs` | Tenant job history and replay diagnostics |
| `GET /api/admin/audit` | Chain integrity and latest 200 tenant audit events |
| `POST /api/admin/secrets` | `{name,value}`; encrypted storage, no read-back endpoint; external 32-byte key required |
| `POST /api/admin/merges` | `{sourceId,targetId,reason}`; audited reversible reassociation |
| `GET /api/admin/merges` | In-scope merge history |
| `POST /api/admin/merges/:id/reverse` | `{reason}`; conflict checks before restoring recorded links |

`system` is `sharepoint`, `cirrus8` or `salesforce`. Source access is read-only; adapters cannot write to source systems. Imports are limited to 10,000 records and HTTP JSON bodies to 2 MiB; file downloads are bounded at 25 MiB through the connector pipeline.
