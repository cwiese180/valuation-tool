# Data contracts and canonical model

## Source adapter envelope
Every source record: source_system, source_record_id, record_type, payload_version, extracted_at, effective_at (nullable), content_hash, confidentiality_class, source_uri (protected), raw_payload_reference. Incremental loads must be idempotent by source_system/source_record_id/version or content hash.

## Core tables
- Property(property_id PK, address_normalised, locality, postcode, asset_class, geometry, created_at)
- LandParcel(parcel_id PK, lot_plan, title_reference, area_sqm)
- PropertyParcel(property_id FK, parcel_id FK, valid_from, valid_to)
- Building(building_id PK, property_id FK, area_sqm, area_basis, use_class)
- Tenancy(tenancy_id PK, building_id FK, unit_reference, area_sqm)
- Lease(lease_id PK, tenancy_id FK, commencement, expiry, options, status)
- LeaseTermHistory(term_id PK, lease_id FK, effective_from, effective_to, face_rent, net_or_gross, rent_period, incentive_amount, incentive_basis, outgoings_basis)
- SaleTransaction(sale_id PK, contract_date, settlement_date, price_aud, gst_basis, status)
- SaleProperty(sale_id FK, property_id FK, allocation_basis, allocated_price)
- LeasingTransaction(deal_id PK, tenancy_id FK, executed_at, area_sqm, face_rent, effective_rent, incentive_basis, term_months, status)
- Valuation(valuation_id PK, effective_date, purpose, adopted_value_aud, methodology, report_document_id)
- ValuationProperty(valuation_id FK, property_id FK)
- SourceRecordMap(source_system, source_record_id, canonical_entity_type, canonical_entity_id, match_method, reviewer)
- Document(document_id PK, content_hash, protected_uri, source_system, classification, ACL_reference)
- EvidenceObservation(observation_id PK, entity_type, entity_id, measure, numeric_value, unit, basis, observed_at, effective_at, source_id, document_id, page, verification_status, confidence)
- ComparableUse(valuation_id FK, observation_id FK, adjustment_notes)
- ReviewTask(task_id PK, observation_id, assigned_to, decision, reason, decided_at)
- Quote(quote_id PK, property_id, requested_purpose, price_aud, estimated_hours, loaded_cost_aud, approval_status, issued_at)

## Source-specific requirements
**Cirrus8:** retain native property, building, tenancy, lease and rent review IDs; effective-dated lease history; distinguish passing rent, recoveries and arrears.
**Salesforce:** map actual object API names only after schema discovery; distinguish lead/opportunity/under-offer/exchanged/settled/executed; do not assume Closed Won means settled.
**Valuation documents:** report identity, subject property, valuation date, adopted assumptions, embedded sale/lease comparables, source page/table and extraction model version.
**External:** provider, licence scope, redistribution permissions, observation type, effective date and original reference.

## Evidence semantics
Transaction status and evidence verification status are separate. Source class (confirmed/corroborated/reported/indicative/opinion) is separate from confidence in extraction. GST, rental period, net/gross basis, incentives and area basis must be explicit. Null means unknown, never zero.

## Entity resolution
Exact verified source-ID mapping -> cadastral/title + scope checks -> normalised address + geospatial + area checks -> human review. No fuzzy-only automatic merges. Record candidate scores, conflicting attributes, reviewer and reversible merge history.
