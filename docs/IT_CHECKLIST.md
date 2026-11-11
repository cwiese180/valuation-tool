# IT connection checklist

Provide credentials through the approved secret manager, never chat or Git. Start with sandbox/test scope.

| Area | Credentials and identifiers | Minimum permissions / decisions |
|---|---|---|
| Application sign-in | Entra tenant ID, web-app client ID, client-secret reference, approved HTTPS origin and redirect URI | Single-tenant OIDC, user assignment and Conditional Access; explicit object-ID role/client grants; two distinct quote approvers |
| SharePoint valuation library | Separate read-only app ID/credential reference, tenant ID, site ID, drive/library ID, approved client confidentiality scope | Prefer `Sites.Selected` plus explicit read grant to the selected site; file-content and delta reads only; define source ACL/revocation handling and whether library contains multiple client scopes |
| Existing Cirrus8 integration | Approved transport (API/SQL/Fabric/export), endpoint/feed location, read credential reference, source schema and stable IDs | Read-only access to existing integration; property/building/tenancy/lease/rent-term mapping, effective-date semantics, cursor and deletion contract. Current executable transport expects a normalised HTTPS feed; other transports require its adapter to be completed after discovery |
| Salesforce Sales & Leasing | Sandbox instance URL, connected-app client ID, OAuth client-secret/refresh-token reference, approved object and field API names | Read/API access only to selected objects and fields; client ACL field, stable property reference, SystemModstamp/deletion access, settlement/execution fields, reviewed stages. Confirm CDC or periodic full reconciliation and initial backfill volume |
| Document AI | Approved regional Azure layout endpoint/key reference, Azure OpenAI endpoint/key reference and structured-output deployment | Approved confidentiality/data-processing terms, region and budget. Keep paid AI disabled until authorized |
| Host and storage | Approved sandbox host, TLS certificate, persistent encrypted volume, external 32-byte encryption-key reference, backup/audit destinations | Dedicated service identity, restricted ingress/egress, retention and restore policy, independent audit export, target database decision (SQLite implementation versus planned Azure SQL) |

Valuations must supply an approved representative 100-report set with reviewed expected critical numeric values and source pages, plus pricing/approval policy. Sales & Leasing must supply stage semantics and a 20-property reconciliation set. No production source access or paid processing is needed to run the synthetic application.
