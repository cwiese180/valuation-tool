# BRWA Property Intelligence Platform

An internal-first commercial property intelligence and valuation quoting platform for Burgess Rawson WA.

## MVP
- Property 360: property profiles linked to leases, sales, valuations and source records
- Evidence Explorer: searchable sales and leasing evidence with status and provenance
- Valuation quoting: indicative fee and contribution calculation
- Review queue: synthetic extraction records requiring human validation
- Data integration contracts for Cirrus8, Salesforce, shared-drive valuations and external feeds

**Status:** Synthetic-data prototype. No live integrations, authentication, persistence, document AI, or production deployment.

## Run
Open `index.html` in a browser. No dependencies or credentials required.

## Architecture
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_CONTRACTS.md](docs/DATA_CONTRACTS.md), and [docs/ROADMAP.md](docs/ROADMAP.md).

## Security
Do not place real BRWA documents, credentials, client data, Salesforce exports or Cirrus8 exports in this repository. Production access requires an approved secure environment, Entra ID, RBAC, audit trails and data-handling review.
