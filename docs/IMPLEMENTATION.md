# Implementation decisions and operational limits

## Executable architecture

The original architecture specifies Azure SQL, Functions, AI Search, Next.js and Entra ID. This increment uses a Node.js 24 HTTP service, a framework-free browser client and SQLite to provide a runnable application without provisioning infrastructure or incurring costs. This is a deliberate development decision, not an implemented Azure SQL deployment. Entra sign-in and configurable read-only adapters are included; Azure AI providers are present but disabled and mock-tested only.

The database enforces tenant/client scoping in the service layer, relational links and foreign keys, immutable raw source payloads, versioned observations, workflow records and append-only audit events. Entity payloads retain source-specific parcel, building, tenancy, lease, rent-term, sale and valuation fields as JSON. `property_links` permits multiple links per entity; the current runtime mapper attaches one reviewed property scope per source record. Multi-property deals and multi-client libraries need a reviewed allocation/ACL mapping before enabling those feeds. They are not grounds for automatic property merging.

Only previously human-verified source identifiers match automatically. Normalised addresses and title references produce review candidates. A reviewer must explicitly associate a source with a property. Administrative merge history retains prior identities and record links; reversal restores recorded links. Reverse before applying another merge involving either property. New transactions arriving after a merge need reconciliation before reversal if their ownership is ambiguous.

Documents retain pages and a model version; Azure layout includes table metadata. Numeric evidence requires a literal source quote, one-based page and explicit basis. Human review is mandatory, even with high extraction confidence. A model confidence value is not a measured accuracy rate. A linked comparable in a valuation is still reported/indicative evidence unless its own transaction status is substantiated.

All versions remain queryable; there is no silent replacement of historical evidence. A deletion records a source event and withdraws linked evidence while retaining its original payload. Query consumers must choose dates/status deliberately; amounts across old and new source versions must not be summed as if distinct current deals. Rent terms retain effective dates, null outgoings and source IDs.

## Source configuration

Live adapters are loaded only in Entra mode with `ENABLE_SOURCE_NETWORK=true`. The default is no adapters. The application remains an analytical read model and never writes to SharePoint, Salesforce or Cirrus8. SharePoint processing additionally requires `ENABLE_PAID_AI=true`; setting credentials alone does not authorize expenditure.

The Cirrus8 HTTPS transport assumes the existing BRWA integration can expose the normalised envelope in `DATA_CONTRACTS.md`. SQL/Fabric/file-export delivery cannot be completed until IT identifies the actual approved transport and schema. Do not create a second integration or infer unknown fields.

The supplied SharePoint mapper scopes a whole nominated drive to one explicit confidentiality client. Do not use it for a library containing multiple incompatible client ACLs. Folder scoping, fine-grained source permission reconciliation and revocation are remaining integration work requiring IT's source security design. Original file download redirects are restricted to HTTPS SharePoint domains and receive no Graph bearer token.

Salesforce object/field names and stage mappings are supplied in configuration. A mapped settled stage also requires a settlement-date field; executed leases require execution evidence. QueryAll includes deleted rows and polling replays a 24-hour overlap. This mitigates boundary issues but is not a guaranteed change-data-capture service. Before production use, agree CDC or a periodic full reconciliation, deletion retention windows and Bulk API strategy with IT.

## Operating envelope

Run one application process on one host with a persistent local volume. SQLite and original-file storage are not a horizontally scaled Azure service. Session and OAuth state are held in memory; restart signs users out. CSRF tokens and session state do not survive restart. Explicit user grants come from deployment configuration, not browser-supplied claims. Conditional Access and MFA are enforced by the Entra tenant configuration.

Database files contain confidential canonical data and source text; the host volume and backups must be encrypted by IT. Credentials and original-file blobs are additionally encrypted with AES-256-GCM using an external 32-byte key. Keep the key outside the database and backups. Key rotation needs a controlled decrypt/re-encrypt maintenance process. The audit hash chain detects ordinary modification; a database operator with full write access can rebuild a chain. Export to an independent append-only audit destination before production.

Connector work is initiated by an administrator; there is no always-on scheduler or distributed worker. HTTP throttling retries are bounded. Failed runs expose a retry time and can be replayed via Sync using the last committed cursor. The in-process concurrency guard prevents overlapping runs in this deployment model. A crash may leave an interrupted job; startup recovery marks it failed and retains its prior cursor. Do not run multiple workers against this database.

Not implemented or certified: Azure SQL migration/deployment, AI Search, Power BI/licensed external feeds, pricing calibration, real report numeric accuracy, multi-system 20-property reconciliation, sandbox end-to-end validation, document-source ACL revocation and an independent penetration test. These remain explicit gates, not completed roadmap items.
