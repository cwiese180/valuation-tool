# Delivery roadmap and acceptance gates

The runnable implementation and validation limits are recorded in [VALIDATION.md](VALIDATION.md). The original Azure-oriented specification remains in [ARCHITECTURE.md](ARCHITECTURE.md); [IMPLEMENTATION.md](IMPLEMENTATION.md) explains the executable Node/SQLite implementation and its limits.

## Implemented in the synthetic development release

- [x] Persistent backend, relational migrations, immutable raw source history and API-backed UI
- [x] Property 360°, Evidence Explorer and source-page review/correction workflows
- [x] Single-tenant Entra sign-in implementation, role enforcement, client scopes and encrypted credentials
- [x] Graph delta, Salesforce QueryAll and normalised existing-feed Cirrus8 adapter implementations
- [x] Mock pagination/deletion/replay/transport tests, effective-dated rent history
- [x] Azure layout and schema-constrained extraction providers with expenditure guard
- [x] Human property matching, recorded source mappings and reversible merges
- [x] Indicative quotes, independent approval and branded printable proposals
- [x] Administration, failure history, restart recovery, manual replay, audit chain and backup/restore tooling
- [x] Core/service/HTTP automated tests executed
- [x] Browser regression tests and CI workflow written
- [x] Deployment runbook, security limitations and IT credential checklist

## Remaining implementation and external acceptance

- [x] Publish the development branch through the connected GitHub API
- [ ] Establish passing GitHub CI, including browser cases
- [ ] Approved runtime/database target; implement and validate Azure SQL migration if IT retains that target
- [ ] Entra sandbox end-to-end sign-in and access-policy validation
- [ ] Source-schema discovery and actual Cirrus8 SQL/API/Fabric/export contract mapping
- [ ] Sandbox connectivity and end-to-end import tests for all three sources
- [ ] SharePoint mixed-client/source ACL and revocation reconciliation, folder scope if required
- [ ] Representative 100-report extraction benchmark at ≥99% critical numeric accuracy
- [ ] Multi-property deal allocation mapping and multi-parcel acceptance cases
- [ ] Reconcile 20 representative properties across systems
- [ ] Salesforce full reconciliation/CDC and Bulk API backfill plan for actual volume
- [ ] Production-scale worker/scheduler, external audit sink, alerting, retention and key rotation
- [ ] Historical fee/hour calibration and Valuations leadership sign-off
- [ ] Independent IT security review and full volume/key recovery drill
- [ ] Power BI, licensed external data and agency opportunity rules if retained in scope
- [ ] Separately authorized production deployment

No production source access, paid AI processing or production deployment is authorized by this roadmap.
