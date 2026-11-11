# BRWA Property Intelligence Platform

A runnable property intelligence application for Burgess Rawson WA, with a persistent database, server-side access control, replay-safe ingestion, source-page evidence review, Property 360°, Evidence Explorer, valuation quoting and connector administration.

**Release status: local synthetic implementation with tested adapter contracts. The integration-ready acceptance gate has not passed.** Approved sandbox credentials, source mappings, representative valuation reports and IT security sign-off are still required. No production systems have been accessed, no paid AI requests made, and no production deployment performed.

## Run the application

Use Node.js 24 or newer (built-in SQLite is required):

```bash
npm ci
npm run demo
```

Open the local URL printed in the terminal, normally `http://127.0.0.1:3000`, and enter the generated local access code. The synthetic workspace persists to `data/brwa.sqlite` across restarts. It contains two invented properties, lease and rent history, agency sale observations, two document fixtures, an intentionally incorrect extraction and an indicative quote. No real BRWA records are included. The original `index.html` prototype has been retired; use the server.

```bash
npm run check
npm test
npm run test:e2e
```

The core application and Node tests have no runtime dependencies. Development dependencies provide formatting and browser regression tests. See [validation](docs/VALIDATION.md) for what has actually been run in this environment.

## Implemented behaviour

- SQLite migrations, foreign keys, immutable raw source versions, canonical records, property-to-entity links, rent history and encrypted original-document vault.
- Entra authorization-code sign-in with PKCE, nonce/state validation, pinned tenant/issuer/audience, signature verification, explicit object-ID grants and expiring HTTP-only sessions. Local access-code authentication is restricted to loopback synthetic mode.
- Reader, valuer, reviewer and administrator roles; client/tenant checks on record reads, documents and mutations; CSRF/origin checks, secure headers, bounded requests and sign-in throttling.
- Graph drive-delta pagination and deletion events; Salesforce QueryAll pagination, overlapping watermarks and explicit settled/executed status requirements; a read-only adapter for the existing normalised Cirrus8 feed.
- Import idempotency, atomic cursor advancement, failure history, manual replay, pause/resume, schema discovery and redacted preview. Ambiguous property identity goes to review; fuzzy matching cannot merge properties.
- Azure layout and schema-constrained extraction provider implementations, tested against mocked responses. Source page, literal quote, numeric support, confidence and licensing checks block approval of invalid evidence. Original connected PDFs/DOCX files are encrypted and available only after document authorization.
- Audited corrections, optimistic concurrency, reversible property merges, independent quote approval and branded printable indicative proposals.
- Append-only hash-chained audit events, AES-256-GCM credential storage and verified backup/restore tooling.

## Handover documents

- [Deployment runbook](docs/DEPLOYMENT.md)
- [IT credentials and permissions checklist](docs/IT_CHECKLIST.md)
- [Acceptance results and remaining gates](docs/VALIDATION.md)
- [Architecture decisions and limits](docs/IMPLEMENTATION.md)
- [API reference](docs/API.md)
- [Original technical specification](docs/ARCHITECTURE.md)
- [Data contracts](docs/DATA_CONTRACTS.md)
- [Connector contracts](docs/CONNECTOR_SETUP.md)

Use [`.env.example`](.env.example) and [`config/connectors.runtime.example.json`](config/connectors.runtime.example.json) as configuration templates. Never commit credentials or source exports.
