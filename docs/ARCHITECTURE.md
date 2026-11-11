# Architecture and implementation specification

## Objective
Create an internal-first, source-traceable property intelligence platform for BRWA. Operational systems remain authoritative: Cirrus8 for managed leases and Salesforce for agency transactions. The platform is an analytical read model.

## Logical architecture
1. Source adapters: existing Cirrus8 feed, Salesforce incremental API, read-only valuation shared-drive crawler, licensed external provider adapters.
2. Raw landing: immutable source payloads and original documents in protected Azure Blob Storage; content hashes and source ACLs.
3. Processing: Azure Functions or Data Factory jobs, document layout extraction, schema-constrained LLM extraction, deterministic validation, deduplication.
4. Canonical store: Azure SQL schemas raw/staging/core/evidence/workflow/analytics, with effective-dated history.
5. Search: SQL filtering and Azure AI Search for document retrieval; access enforcement at API and document levels.
6. App: Next.js + TypeScript, Entra ID, server-side RBAC, audit trail; Power BI for analytics.

## Non-negotiables
- Source records are never silently overwritten; capture ingested_at, observed_at and effective_at.
- Never equate valuation opinions, asking evidence, executed leases and settled sales.
- Evidence must preserve document/page/field provenance, confidence, verification decision and licensing rights.
- Entity resolution must support one-to-many property/building/parcel relationships and many-to-many transaction/property relationships.
- No automatic merge from fuzzy address alone. Human review for uncertain matches and reversibility for incorrect merges.
- Never train external models on confidential documents without approved contractual/data handling terms.
- No source-system writes in MVP. No client-facing evidence publication without access-policy checks.

## Security
Entra ID authentication, least-privilege roles, document-level entitlements, encryption, Key Vault, audit logs, private networking where required, backup/restore and retention policy. Restrict ingestion service to read-only access. No secrets or production exports in Git.

## MVP boundaries
Current index.html is a dependency-free UI demonstration with synthetic records and in-memory state. It is not a backend, not production ready and has no real ingestion, persistence, authentication, or document AI. Subsequent increments should build a real API and migrations after source schemas and security boundaries are validated.
