# Deployment and recovery runbook

## Local synthetic application

1. Install Node.js 24+ and run `npm ci`, `npm run check`, `npm test`.
2. Run `npm run demo`. Open its printed loopback URL and use the terminal access code. Use only invented records in this mode.
3. Stop with Ctrl+C. Data persists under `data/`; it is excluded from Git. Use a separate fresh `DATABASE_PATH` for disposable tests rather than removing an existing database.

The application uses no paid services in demo mode. `npm start` deliberately defaults to Entra mode and fails until identity is configured.

## Prepare an approved internal sandbox

This section is a runbook, not authorization to provision, incur costs or deploy. IT must approve the destination, identity applications, network routes, data handling and any AI budget first.

- Choose one Node.js 24 service process on an approved Linux VM/container host, with encrypted persistent storage for `/var/lib/brwa` and encrypted backups. Select the intended database architecture with IT; the included migrations target SQLite, not Azure SQL.
- Run as a dedicated non-root service identity. Restrict the data directory to that identity. Keep the process bound to loopback, behind a TLS reverse proxy with no public ingress unless separately approved.
- Configure an exact `APP_ORIGIN` HTTPS URL. Preserve its original `Host` header through the proxy. Do not rewrite request Origins or bypass origin checks. Forward to the local HTTP listener; the application does not trust forwarded identity headers.
- Register a single-tenant Entra web application. Set the redirect URI to `APP_ORIGIN/auth/callback`. Require assignment, MFA/Conditional Access as appropriate. Put its client secret in the approved secret manager and inject `ENTRA_CLIENT_SECRET` at runtime.
- Set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `AUTH_MODE=entra`, `DATABASE_PATH`, `PORT` and `APP_ORIGIN`. Generate `SECRET_ENCRYPTION_KEY` as base64 of 32 cryptographically random bytes and inject it from the secret manager. Do not print or commit it.
- Set `USER_ACCESS_JSON` with reviewed Entra object IDs, roles (`reader`, `valuer`, `reviewer`, `admin`) and exact client scopes. `"*"` grants all clients within this tenant and enables tenant-wide audit access. Configure at least two distinct authorized people if quote approval is to be exercised.
- Start with `ENABLE_SOURCE_NETWORK=false` and `ENABLE_PAID_AI=false`. Run `npm start`; migrations apply on startup. Confirm `/health` returns `{"ok":true}`. Verify real Entra login, wrong-tenant denial, client boundaries and role restrictions before adding data.

Environment values are supplied by the service manager or secret injector. The application does not automatically load `.env` files. If using Node's environment-file option, run `node --env-file=/secure/path/brwa.env src/server.js`; protect the file and keep it outside the repository.

## Connect approved sandbox sources

1. Copy `config/connectors.runtime.example.json` outside Git. Replace the placeholders with sandbox scope and reviewed mappings. The SharePoint sample supports one reviewed client scope per drive; a mixed-client library requires an ACL mapper first.
2. Use the authenticated administrator endpoint `POST /api/admin/secrets` to set each named credential over HTTPS. It accepts `{ "name": "configured-name", "value": "credential-value" }`. Supply the session cookie and CSRF token. Values are encrypted before persistence and never returned by a read endpoint. Salesforce's credential value is a JSON string with `clientSecret` and `refreshToken`.
3. Put the absolute configuration path in `CONNECTORS_CONFIG_PATH`. After explicit source authorization, enable only the desired source and `ENABLE_SOURCE_NETWORK=true`, then restart. This loads mappings, not source data; source reads begin when the administrator tests/previews/syncs.
4. Do not enable SharePoint document processing until AI contractual handling, regional endpoints and budget are approved. Only then set `ENABLE_PAID_AI=true`. Supply the layout/extraction keys using the configured secret names.
5. Test connection, discover schema and preview. Confirm source scope and mappings. Sync a small approved set, verify every exception, replay the same sync and confirm no duplicate canonical observations. Test deletion, rename, throttling and interrupted processing.
6. Reconcile the specified 20 properties and benchmark numeric extraction against the reviewed 100-report set. Record findings in `docs/VALIDATION.md`. Resolve all remaining gates before seeking production authorization.

## Failure handling and monitoring

The Administration view shows job states, last source success/error and a manual Sync/replay action. Cursor advancement and database imports commit together. On failure, review the configuration/source permissions, correct the cause and replay; failed runs retain the last successful cursor. Do not edit source payloads or force a cursor past a failed page. Graph HTTP 410 requires an approved full delta re-enumeration; the application fails safely rather than silently discarding history.

Monitor the health endpoint, process memory, disk space, database size, job failures, cursor age and backup success. Request logs contain request IDs and generic errors, not tokens or document contents. Configure an independent audit sink and alerting before production. Interrupted running jobs are marked failed on startup; replay through the normal administrator action.

## Backup and restore

```bash
DATABASE_PATH=/var/lib/brwa/brwa.sqlite npm run backup -- /secure-backups/brwa-2026-11-11.sqlite
```

The online SQLite backup uses a consistent snapshot and runs `PRAGMA integrity_check`. Also back up `/var/lib/brwa/documents` (or the configured vault directory) and the configuration. Preserve the external encryption key in the approved key vault recovery system; losing it makes encrypted credentials and original documents unrecoverable. Protect backups with the same confidentiality controls as the live data.

To restore, stop the service, preserve its current database/volume as a recovery point, restore the database and associated document vault to a separate recovery directory, and run integrity/audit checks using a non-production identity. Set `DATABASE_PATH` to the restored database, keep both network flags false, restart and verify the expected record counts, source pages, quote states and audit integrity. Authorize resumed source reads only after reconciliation. The automated persistence test verifies database restoration; IT must also perform a full volume/key recovery drill.

## Release and rollback

Record the Git commit, test output, database schema version and configuration revision. Back up before starting a new release. This release applies schema versions 1 and 2. Roll back code only to a release compatible with that schema; otherwise restore the pre-release database and vault as a matched set. Session restart requires users to sign in again. No production rollout or infrastructure provisioning has been performed by this work.
