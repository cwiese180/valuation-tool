"use strict";
const { MockConnector } = require("./connectors");
const demoUser = {
  id: "demo-admin",
  tenant: "brwa-demo",
  role: "admin",
  clients: ["*"],
  name: "Synthetic administrator",
};
const fixtures = {
  cirrus8: [
    {
      id: "C-P1",
      client: "demo-client",
      type: "property",
      address: "18 Example Street, Welshpool",
      entities: [
        {
          id: "parcel-1",
          type: "parcel",
          lotPlan: "LOT 18 / SYNTHETIC 100",
          areaSqm: 4200,
        },
        { id: "building-1", type: "building", areaSqm: 2100, areaBasis: "GFA" },
        {
          id: "tenancy-1",
          type: "tenancy",
          buildingId: "building-1",
          areaSqm: 2100,
        },
        {
          id: "lease-1",
          type: "lease",
          tenancyId: "tenancy-1",
          commencement: "2024-07-01",
          expiry: "2029-06-30",
          options: "1 x 5 years",
          status: "executed",
        },
        {
          id: "term-1",
          type: "rent-term",
          leaseId: "lease-1",
          effectiveAt: "2024-07-01",
          effectiveTo: "2025-06-30",
          amount: 220000,
          period: "annual",
          basis: "net",
          outgoings: null,
        },
        {
          id: "term-2",
          type: "rent-term",
          leaseId: "lease-1",
          effectiveAt: "2025-07-01",
          effectiveTo: null,
          amount: 231000,
          period: "annual",
          basis: "net",
          outgoings: null,
        },
      ],
      observations: [
        {
          kind: "lease",
          measure: "face_rent",
          value: 231000,
          unit: "AUD/year",
          basis: "net; GST exclusive; incentives unknown",
          transactionStatus: "executed",
          confidence: 1,
        },
      ],
      effectiveAt: "2025-07-01",
      version: "2",
    },
    {
      id: "C-P2",
      client: "demo-client",
      type: "property",
      address: "42 Demonstration Road, Osborne Park",
      entities: [
        { id: "building-2", type: "building", areaSqm: 850, areaBasis: "NLA" },
      ],
      observations: [],
    },
  ],
  salesforce: [
    {
      id: "SF-S1",
      propertySourceId: "SF-P1",
      client: "demo-client",
      type: "sale",
      kind: "sale",
      address: "18 Example Street, Welshpool",
      transactionStatus: "settled",
      observations: [
        {
          measure: "sale_price",
          value: 4250000,
          unit: "AUD",
          basis: "GST exclusive; allocation whole property",
          confidence: 1,
        },
      ],
      entities: [
        {
          id: "SF-S1",
          type: "sale",
          contractDate: "2025-02-14",
          settlementDate: "2025-04-15",
          price: 4250000,
          status: "settled",
          properties: ["SF-P1"],
          allocationBasis: "whole property",
        },
      ],
      effectiveAt: "2025-04-15",
    },
    {
      id: "SF-S2",
      propertySourceId: "SF-P2",
      client: "demo-client",
      type: "sale",
      kind: "sale",
      address: "42 Demonstration Road, Osborne Park",
      transactionStatus: "Closed Won",
      observations: [
        {
          measure: "sale_price",
          value: 2950000,
          unit: "AUD",
          basis: "GST unknown; reported price",
          confidence: 1,
        },
      ],
      effectiveAt: "2025-08-10",
    },
  ],
  sharepoint: [
    {
      id: "SP-D1",
      propertySourceId: "SP-P1",
      client: "demo-client",
      type: "document",
      name: "Synthetic Welshpool valuation",
      kind: "valuation",
      pages: [
        {
          text: "BRWA SYNTHETIC REPORT — NO REAL PROPERTY OR CLIENT DATA\nSubject: 18 Example Street, Welshpool\nValuation effective date: 30 June 2025\nadopted_value: 4,400,000 AUD | market value; GST exclusive\narea_sqm: 2,100 sqm | gross floor area",
        },
        {
          text: "Synthetic comparable evidence — verification required\nsale_price: 4,250,000 AUD | GST exclusive; whole property",
        },
      ],
      effectiveAt: "2025-06-30",
      version: "etag-1",
    },
    {
      id: "SP-D2",
      client: "demo-client",
      type: "document",
      address: "42 Demonstration Road, Osborne Park",
      name: "Synthetic extraction exception",
      pages: [{ text: "sale_price: 2,950,000 AUD | GST unknown" }],
      extraction: {
        model: "synthetic-fault-fixture-v1",
        observations: [
          {
            measure: "sale_price",
            value: 29500000,
            unit: "AUD",
            basis: "GST unknown",
            page: 1,
            quote: "sale_price: 2,950,000 AUD | GST unknown",
            confidence: 0.85,
          },
        ],
      },
      kind: "sale",
      transactionStatus: "reported",
      effectiveAt: "2025-08-10",
    },
  ],
};
function adapters() {
  return Object.fromEntries(
    Object.entries(fixtures).map(([k, v]) => [
      k,
      new MockConnector(k, structuredClone(v)),
    ]),
  );
}
function seed(platform) {
  const u = demoUser;
  if (platform.list(u, "properties").length) return;
  const p1 = platform.createProperty(u, {
      client: "demo-client",
      address: "18 Example Street, Welshpool",
      locality: "Welshpool",
      assetClass: "Industrial",
      data: { landAreaSqm: 4200, buildingAreaSqm: 2100, synthetic: true },
    }),
    p2 = platform.createProperty(u, {
      client: "demo-client",
      address: "42 Demonstration Road, Osborne Park",
      locality: "Osborne Park",
      assetClass: "Office",
      data: { buildingAreaSqm: 850, synthetic: true },
    });
  for (const [system, sourceId, propertyId] of [
    ["cirrus8", "C-P1", p1.id],
    ["cirrus8", "C-P2", p2.id],
    ["salesforce", "SF-P1", p1.id],
    ["salesforce", "SF-P2", p2.id],
    ["sharepoint", "SP-P1", p1.id],
  ])
    platform.mapSource(u, {
      system,
      sourceId,
      propertyId,
      reason: "Explicit synthetic fixture mapping",
    });
  for (const [system, records] of Object.entries(fixtures))
    platform.ingest(u, system, records);
  const e = platform
      .list(u, "evidence")
      .find((e) => e.data.sourceRecordId === "SF-S1"),
    task = platform.list(u, "reviews").find((r) => r.evidence_id === e.id);
  platform.review({ ...u, id: "demo-reviewer", role: "reviewer" }, task.id, {
    decision: "approved",
    version: e.version,
    reason: "Synthetic settlement fixture checked",
  });
  platform.quote(u, {
    propertyId: p1.id,
    purpose: "Mortgage security valuation",
    hours: 12,
    rate: 280,
    costRate: 145,
    expenses: 200,
    assumptions:
      "Indicative synthetic fee; subject to scope and leadership approval.",
  });
}
module.exports = { demoUser, fixtures, adapters, seed };
