# Connector-ready delivery contract

The platform is not integration-ready until the acceptance checks below pass against sandbox tenants. No real credentials should be stored in Git.

## SharePoint (Microsoft Graph)
- Register an Entra application using least-privilege site-scoped permissions (prefer Sites.Selected).
- Administrator grants read access only to the nominated valuation site/library.
- Configuration: tenant_id, client_id, credential reference, site_id, drive_id, folder_path (optional).
- Discover files using Graph drive delta and page through @odata.nextLink. Persist @odata.deltaLink for incremental runs.
- Retrieve file bytes through authorised Graph endpoints; process PDFs/DOCX, preserve site/drive/item ID, eTag, modified timestamp, content hash, version and source URL.
- Treat delete/rename as source events; do not erase previously verified historical evidence without retention policy.
- Skip unsupported formats with logged reason; no unrestricted tenant-wide scraping.
- Never expose original files to users without checking access rights.

## Cirrus8
- Reuse BRWA's existing automated integration; determine whether its authorised delivery is SQL, API, Fabric or file export.
- Provide read-only adapter mapping for property, building, tenancy, lease, rent review, expiry, options and effective-dated rent history.
- Configuration: adapter type, endpoint or approved feed location, secret reference, source field mapping.
- Incremental watermark or change-token sync; replay-safe imports; preserve source IDs.
- Missing values remain null, never inferred.

## Salesforce
- Use a connected app / OAuth integration identity with read-only access to approved objects.
- Configuration: instance URL, OAuth client reference, object API names, field mappings, stage-to-status mapping.
- Query API or Bulk API for initial backfill; incremental extraction via SystemModstamp where supported, plus deleted-record handling.
- Do not assume Closed Won means executed or settled. Require mapped evidence of contract, settlement or executed lease.
- Respect API limits, pagination, retries and backoff.

## Common adapter contract
Each connector implements:
- testConnection(): connectivity, permissions, visible scope, diagnostics
- discoverSchema(): fields and object types, sample counts
- preview(limit): redacted candidate records and mapping errors
- sync(cursor): incremental upsert of raw records, provenance and source metadata
- getStatus(): last success, cursor, throughput, failures, retry queue
- pause()/resume(): administrator controls

All writes flow through staging, validation, canonical matching and evidence review. Never grant source write permissions.

## Definition of done for integration-ready
- A real authenticated backend, encrypted secret storage, migrations and role-based admin UI.
- Each adapter runs against a mocked API and an approved sandbox test.
- SharePoint delta pagination and file changes are covered by tests.
- Salesforce status mapping, pagination and deletions are covered by tests.
- Cirrus8 effective-dated rent changes are covered by tests.
- Re-running any import does not create duplicate canonical records.
- Failure/retry/observability and review workflows are operational.
- Security review and deployment runbook completed.

The current browser prototype does **not** meet this definition yet.
