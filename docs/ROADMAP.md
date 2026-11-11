# Delivery roadmap and acceptance criteria

## Phase 0 — Foundation (completed initial scaffold)
- [x] Repository README and architecture/data contract specification
- [x] Synthetic interactive browser MVP: overview, Property 360, evidence search, review, quoting and integration catalogue
- [ ] Automated browser testing and CI

## Phase 1 — Secure backend and schema
- [ ] Select hosting/runtime with internal IT; Entra ID security design
- [ ] Azure SQL migrations and seed data; typed REST APIs
- [ ] Audit events, permissions, logging, validation, backup/restore
- [ ] Replace browser-only records with API-backed synthetic dataset

## Phase 2 — Data pilot
- [ ] Read-only inventory of 100 representative valuation reports, with approval
- [ ] Parse text/tables and extract subject valuation and comparable evidence
- [ ] Implement source-page traceability and side-by-side verification
- [ ] Test deterministic property matching, duplicate sales and multi-parcel cases

## Phase 3 — Internal integrations
- [ ] Audit existing Cirrus8 pipelines; reuse feeds and identifiers
- [ ] Map Salesforce objects and statuses; incremental sync
- [ ] Reconcile 20 representative properties across systems
- [ ] Add monitoring and replay for failed loads

## Phase 4 — Commercial features
- [ ] Calibrate quoting from approved historical fees and hours
- [ ] Branded quote generation and approval workflow
- [ ] Licensed external data adapters and permission controls
- [ ] Power BI dashboards and agency opportunity rules

## Acceptance gates
- No unapproved production access or deployments.
- 100% source-page traceability for published document evidence.
- >=99% critical numeric extraction accuracy on a reviewed representative test set, with errors escalated.
- Zero false automatic property merges in acceptance cases.
- Idempotent imports and reversible merges.
- Server-side access control and verified tenant/client confidentiality boundaries.
- Quote pricing is labelled indicative until signed off by Valuations leadership.

## Immediate owner dependencies
IT: Azure/SQL environment, existing Cirrus8 pipeline schema, Salesforce object definitions, shared-drive access plan.
Valuations: representative reports, field definitions, approval policy.
Sales & Leasing: stage semantics, completed deal data fields, ownership of verification.
External: licence review before feed use.
