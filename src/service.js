"use strict";
const { id, now, hash } = require("./store");
const { normaliseAddress, classifyTransaction } = require("./canonical");
const { extractSynthetic, validateExtraction } = require("./extraction");
const { SYSTEMS } = require("./connectors");
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};
const parse = (row) =>
  row
    ? Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          ["data", "issues", "pages", "snapshot", "config"].includes(k) &&
          typeof v === "string"
            ? JSON.parse(v)
            : v,
        ]),
      )
    : row;
const requireText = (value, name, max = 2000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, "Invalid " + name);
  return value.trim();
};
function access(user, permission) {
  const permissions = {
    reader: ["read"],
    valuer: ["read", "quote"],
    reviewer: ["read", "review"],
    admin: ["read", "quote", "review", "admin"],
  };
  if (!user || !permissions[user.role]?.includes(permission))
    fail(403, "Permission denied");
}
function tenantAdmin(user) {
  access(user, "admin");
  if (!user.clients.includes("*"))
    fail(403, "Tenant-wide administration requires full client scope");
}
function inScope(user, row) {
  return (
    !!row &&
    row.tenant === user.tenant &&
    (user.clients.includes("*") || user.clients.includes(row.client))
  );
}
function scoped(user, row) {
  if (!inScope(user, row)) fail(404, "Record not found");
  return parse(row);
}
class Platform {
  constructor(store, adapters = {}) {
    this.store = store;
    this.adapters = adapters;
    this.running = new Set();
  }
  recoverInterruptedJobs() {
    return this.store.transaction(() => {
      const jobs = this.store.all("SELECT * FROM jobs WHERE status='running'");
      for (const job of jobs) {
        this.store.run(
          "UPDATE jobs SET status='failed',error=?,next_attempt=?,finished_at=? WHERE id=?",
          "Interrupted by process restart; replay from last committed cursor",
          now(),
          now(),
          job.id,
        );
        this.store.audit(
          { tenant: job.tenant, id: "system-recovery" },
          "connector.interrupted",
          job.system,
          { job: job.id },
        );
      }
      return jobs.length;
    });
  }
  list(user, table) {
    access(user, "read");
    if (
      ![
        "properties",
        "evidence",
        "reviews",
        "quotes",
        "documents",
        "entities",
      ].includes(table)
    )
      fail(400, "Unknown collection");
    return this.store
      .all("SELECT * FROM " + table + " WHERE tenant=?", user.tenant)
      .filter((r) => inScope(user, r))
      .map(parse);
  }
  property(user, propertyId) {
    access(user, "read");
    const property = scoped(
      user,
      this.store.get("SELECT * FROM properties WHERE id=?", propertyId),
    );
    return {
      ...property,
      evidence: this.list(user, "evidence").filter(
        (e) => e.property_id === propertyId,
      ),
      entities: this.list(user, "entities").filter(
        (e) => e.property_id === propertyId,
      ),
      quotes: this.list(user, "quotes").filter(
        (e) => e.property_id === propertyId,
      ),
      links: this.store.all(
        "SELECT * FROM property_links WHERE tenant=? AND property_id=?",
        user.tenant,
        propertyId,
      ),
    };
  }
  createProperty(user, input) {
    return this.store.transaction(() => {
      access(user, "admin");
      const client = requireText(input.client, "client", 100);
      if (!user.clients.includes("*") && !user.clients.includes(client))
        fail(403, "Client outside scope");
      const p = {
        id: id(),
        tenant: user.tenant,
        client,
        address: normaliseAddress(requireText(input.address, "address")),
        locality: input.locality || null,
        asset_class: input.assetClass || "unknown",
        title_reference: input.titleReference || null,
        data: JSON.stringify(input.data || {}),
        created_at: now(),
      };
      this.store.run(
        "INSERT INTO properties VALUES(?,?,?,?,?,?,?,?,?)",
        ...Object.values(p),
      );
      this.store.audit(user, "property.created", p.id);
      return parse(p);
    });
  }
  mapSource(user, { system, sourceId, propertyId, reason }) {
    return this.store.transaction(() => {
      access(user, "review");
      if (!SYSTEMS.includes(system)) fail(400, "Unknown source");
      this.property(user, propertyId);
      requireText(sourceId, "source ID");
      requireText(reason, "reason");
      const raw = this.store.get(
        "SELECT client FROM raw_records WHERE tenant=? AND system=? AND source_id=? ORDER BY rowid DESC LIMIT 1",
        user.tenant,
        system,
        sourceId,
      );
      const property = this.property(user, propertyId);
      if (raw && raw.client !== property.client)
        fail(403, "Mapping conflicts with source client ACL");
      const existing = this.store.get(
        "SELECT * FROM source_maps WHERE tenant=? AND system=? AND source_id=?",
        user.tenant,
        system,
        sourceId,
      );
      if (existing && existing.property_id !== propertyId)
        fail(409, "Mapping already exists; use reversible merge or review");
      this.store.run(
        "INSERT OR IGNORE INTO source_maps VALUES(?,?,?,?,?,?)",
        user.tenant,
        system,
        sourceId,
        propertyId,
        "human-verified",
        user.id,
      );
      this.store.audit(user, "source.mapped", propertyId, {
        system,
        sourceId,
        reason,
      });
    });
  }
  ingest(user, system, records) {
    access(user, "admin");
    if (
      !SYSTEMS.includes(system) ||
      !Array.isArray(records) ||
      records.length > 10000
    )
      fail(400, "Invalid import");
    return this.store.transaction(() => {
      let imported = 0,
        duplicates = 0;
      for (const r of records) {
        if (!r || typeof r !== "object" || Array.isArray(r))
          fail(400, "Invalid source record");
        if (
          ![
            "property",
            "sale",
            "lease",
            "document",
            "deletion",
            "unsupported",
          ].includes(r.type)
        )
          fail(400, "Invalid record type");
        if (
          r.entities !== undefined &&
          (!Array.isArray(r.entities) || r.entities.length > 1000)
        )
          fail(400, "Invalid entities");
        if (
          r.observations !== undefined &&
          (!Array.isArray(r.observations) || r.observations.length > 1000)
        )
          fail(400, "Invalid observations");
        if (r.client !== undefined && typeof r.client !== "string")
          fail(400, "Invalid client ACL");
        if (r.address !== undefined && r.address !== null)
          requireText(r.address, "source address");
        requireText(r.id, "source ID");
        if (
          !r.client ||
          (!user.clients.includes("*") && !user.clients.includes(r.client))
        ) {
          if (r.deleted) {
            const old = this.store.get(
              "SELECT client FROM raw_records WHERE tenant=? AND system=? AND source_id=? ORDER BY rowid DESC LIMIT 1",
              user.tenant,
              system,
              r.id,
            );
            if (
              !old ||
              (!user.clients.includes("*") &&
                !user.clients.includes(old.client))
            )
              fail(403, "Deletion outside client scope");
            r.client = old.client;
          } else fail(403, "Source record missing permitted client ACL");
        }
        const fingerprint = hash(r);
        if (
          this.store.get(
            "SELECT id FROM raw_records WHERE tenant=? AND system=? AND source_id=? AND hash=?",
            user.tenant,
            system,
            r.id,
            fingerprint,
          )
        ) {
          duplicates++;
          continue;
        }
        const raw = id();
        this.store.run(
          "INSERT INTO raw_records VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          raw,
          user.tenant,
          r.client,
          system,
          r.id,
          String(r.version || "1"),
          fingerprint,
          JSON.stringify(r),
          now(),
          r.effectiveAt || null,
          r.deleted ? 1 : 0,
        );
        imported++;
        if (r.deleted) {
          this.store.run(
            "UPDATE evidence SET status='withdrawn',version=version+1 WHERE tenant=? AND raw_id IN (SELECT id FROM raw_records WHERE tenant=? AND system=? AND source_id=?)",
            user.tenant,
            user.tenant,
            system,
            r.id,
          );
          this.store.audit(user, "source.deleted", raw, {
            system,
            sourceId: r.id,
          });
          continue;
        }
        const mapping = this.store.get(
          "SELECT property_id FROM source_maps WHERE tenant=? AND system=? AND source_id=?",
          user.tenant,
          system,
          r.propertySourceId || r.id,
        );
        const property = mapping
          ? this.store.get(
              "SELECT * FROM properties WHERE id=?",
              mapping.property_id,
            )
          : null;
        if (property && property.client !== r.client)
          fail(403, "Source mapping conflicts with client ACL");
        const propertyId = property?.id || null;
        if (!propertyId) {
          const candidates = this.store
            .all(
              "SELECT * FROM properties WHERE tenant=? AND client=?",
              user.tenant,
              r.client,
            )
            .filter(
              (p) =>
                (r.titleReference && r.titleReference === p.title_reference) ||
                (r.address && normaliseAddress(r.address) === p.address),
            )
            .map((p) => p.id);
          this.store.run(
            "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            id(),
            user.tenant,
            r.client,
            null,
            raw,
            "property-match",
            "pending",
            JSON.stringify({
              candidates,
              address: r.address || null,
              system,
              sourceId: r.propertySourceId || r.id,
            }),
            null,
            null,
            null,
          );
        }
        let documentId = null,
          observations = r.observations || [];
        if (r.type === "document") {
          if (
            !Array.isArray(r.pages) ||
            !r.pages.length ||
            r.pages.some((p) => typeof p.text !== "string")
          )
            fail(400, "Source pages required");
          const extraction = r.extraction
            ? {
                model: r.extraction.model,
                observations: validateExtraction(r.extraction, r.pages),
              }
            : extractSynthetic(r.pages);
          documentId = id();
          this.store.run(
            "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)",
            documentId,
            user.tenant,
            r.client,
            raw,
            hash(r.pages),
            r.name || r.id,
            JSON.stringify(r.pages),
            extraction.model || "unversioned",
            r.sourceUri || null,
            now(),
          );
          observations = extraction.observations;
        }
        for (const o of observations) {
          const eid = id(),
            issues = [...(o.issues || [])];
          if (!propertyId) issues.push("unresolved property");
          if (
            typeof o.value !== "number" ||
            !Number.isFinite(o.value) ||
            o.value < 0
          )
            issues.push("invalid numeric value");
          if (!o.unit || !o.basis) issues.push("missing unit or basis");
          if (
            documentId &&
            (!Number.isInteger(o.page) || o.page < 1 || o.page > r.pages.length)
          )
            issues.push("invalid source page");
          const kind = o.kind || r.kind || "valuation",
            status = ["sale", "lease"].includes(kind)
              ? classifyTransaction(
                  kind,
                  o.transactionStatus || r.transactionStatus,
                )
              : "opinion";
          this.store.run(
            "INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            eid,
            user.tenant,
            r.client,
            propertyId,
            raw,
            documentId,
            o.page || null,
            kind,
            o.measure || "unknown",
            Number.isFinite(o.value) ? o.value : null,
            o.unit || "unknown",
            o.basis || "unknown",
            status,
            kind === "valuation"
              ? "opinion"
              : status === "indicative"
                ? "indicative"
                : "reported",
            Number.isFinite(o.confidence) ? o.confidence : 0,
            "pending",
            JSON.stringify(issues),
            JSON.stringify({
              ...o,
              sourceSystem: system,
              sourceRecordId: r.id,
              effectiveAt: r.effectiveAt || null,
              licence: r.licence || "internal-only",
              sourceDeleted: false,
            }),
            1,
          );
          this.store.run(
            "INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            id(),
            user.tenant,
            r.client,
            eid,
            raw,
            "evidence",
            "pending",
            "{}",
            null,
            null,
            null,
          );
        }
        if (propertyId) this.attachEntities(user, raw, propertyId, r);
      }
      this.store.audit(user, "ingestion.completed", system, {
        imported,
        duplicates,
      });
      return { imported, duplicates };
    });
  }
  attachEntities(user, raw, propertyId, record) {
    for (const entity of record.entities || []) {
      if (
        ![
          "parcel",
          "building",
          "tenancy",
          "lease",
          "rent-term",
          "sale",
          "valuation",
        ].includes(entity.type)
      )
        fail(400, "Unsupported entity type");
      const eid = id();
      this.store.run(
        "INSERT INTO entities VALUES(?,?,?,?,?,?,?,?,?)",
        eid,
        user.tenant,
        record.client,
        propertyId,
        raw,
        entity.type,
        requireText(entity.id, "entity source ID"),
        entity.effectiveAt || record.effectiveAt || null,
        JSON.stringify(entity),
      );
      this.store.run(
        "INSERT INTO property_links VALUES(?,?,?,?,?,?,?)",
        id(),
        user.tenant,
        propertyId,
        eid,
        entity.type,
        entity.effectiveAt || record.effectiveAt || null,
        entity.effectiveTo || null,
      );
    }
  }
  review(user, reviewId, input) {
    access(user, "review");
    requireText(input.reason, "reason");
    if (!["approved", "rejected"].includes(input.decision))
      fail(400, "Invalid decision");
    return this.store.transaction(() => {
      const task = scoped(
        user,
        this.store.get("SELECT * FROM reviews WHERE id=?", reviewId),
      );
      if (task.status !== "pending") fail(409, "Review already decided");
      if (task.type === "property-match") {
        if (input.decision === "approved") {
          const property = this.property(user, input.propertyId);
          if (property.client !== task.client)
            fail(403, "Client boundary mismatch");
          const record = JSON.parse(
            this.store.get(
              "SELECT payload FROM raw_records WHERE id=?",
              task.raw_id,
            ).payload,
          );
          this.attachEntities(user, task.raw_id, property.id, record);
          const source = task.data;
          this.mapSource(user, {
            system: source.system,
            sourceId: source.sourceId,
            propertyId: property.id,
            reason: input.reason,
          });
          this.store.run(
            "UPDATE evidence SET property_id=?,version=version+1 WHERE raw_id=?",
            property.id,
            task.raw_id,
          );
          for (const e of this.store.all(
            "SELECT id,issues FROM evidence WHERE raw_id=?",
            task.raw_id,
          )) {
            this.store.run(
              "UPDATE evidence SET issues=? WHERE id=?",
              JSON.stringify(
                JSON.parse(e.issues).filter((s) => s !== "unresolved property"),
              ),
              e.id,
            );
          }
        }
      } else {
        const e = scoped(
          user,
          this.store.get("SELECT * FROM evidence WHERE id=?", task.evidence_id),
        );
        if (input.version !== e.version)
          fail(409, "Evidence changed; refresh before reviewing");
        if (e.status !== "pending") fail(409, "Evidence is no longer pending");
        if (input.decision === "approved") {
          if (e.issues.length)
            fail(422, "Resolve extraction issues before approval");
          if (!e.property_id || e.value === null)
            fail(422, "Property and numeric value required");
          if (e.document_id) {
            const doc = scoped(
              user,
              this.store.get(
                "SELECT * FROM documents WHERE id=?",
                e.document_id,
              ),
            );
            if (!doc.pages[e.page - 1]) fail(422, "Missing source page");
            if (input.confirmedValue !== e.value)
              fail(422, "Confirm numeric value against source page");
          }
          if (!["internal-only", "redistributable"].includes(e.data.licence))
            fail(422, "Unapproved evidence licence");
        }
        this.store.run(
          "UPDATE evidence SET status=?,version=version+1 WHERE id=?",
          input.decision === "approved" ? "verified" : "rejected",
          e.id,
        );
      }
      this.store.run(
        "UPDATE reviews SET status=?,reviewer=?,reason=?,decided_at=? WHERE id=?",
        input.decision,
        user.id,
        input.reason,
        now(),
        reviewId,
      );
      this.store.audit(user, "review." + input.decision, reviewId, {
        reason: input.reason,
      });
      return { ok: true };
    });
  }
  correctEvidence(user, evidenceId, input) {
    access(user, "review");
    requireText(input.reason, "reason");
    return this.store.transaction(() => {
      const e = scoped(
        user,
        this.store.get("SELECT * FROM evidence WHERE id=?", evidenceId),
      );
      if (e.status !== "pending" || input.version !== e.version)
        fail(409, "Evidence changed or already decided");
      if (
        typeof input.value !== "number" ||
        !Number.isFinite(input.value) ||
        input.value < 0
      )
        fail(400, "Invalid numeric value");
      const basis = requireText(input.basis, "basis", 200),
        unit = requireText(input.unit, "unit", 40);
      let page = e.page,
        quote = e.data.quote,
        issues = e.issues.filter((s) => s === "unresolved property");
      if (e.document_id) {
        const doc = scoped(
          user,
          this.store.get("SELECT * FROM documents WHERE id=?", e.document_id),
        );
        page = input.page;
        quote = requireText(input.quote, "source quote");
        const checked = validateExtraction(
          {
            observations: [
              {
                measure: e.measure,
                value: input.value,
                unit,
                basis,
                page,
                quote,
                confidence: 1,
              },
            ],
          },
          doc.pages,
        )[0];
        issues.push(...checked.issues);
      }
      const data = {
        ...e.data,
        value: input.value,
        basis,
        unit,
        page,
        quote,
        correction: {
          actor: user.id,
          reason: input.reason,
          at: now(),
          original: {
            value: e.value,
            page: e.page,
            basis: e.basis,
            unit: e.unit,
            quote: e.data.quote,
          },
        },
      };
      this.store.run(
        "UPDATE evidence SET value=?,unit=?,basis=?,page=?,issues=?,data=?,version=version+1 WHERE id=?",
        input.value,
        unit,
        basis,
        page,
        JSON.stringify(issues),
        JSON.stringify(data),
        evidenceId,
      );
      this.store.audit(user, "evidence.corrected", evidenceId, {
        reason: input.reason,
      });
      return scoped(
        user,
        this.store.get("SELECT * FROM evidence WHERE id=?", evidenceId),
      );
    });
  }
  document(user, documentId) {
    access(user, "read");
    const doc = scoped(
      user,
      this.store.get("SELECT * FROM documents WHERE id=?", documentId),
    );
    this.store.audit(user, "document.read", documentId);
    delete doc.source_uri;
    return doc;
  }
  quote(user, input) {
    return this.store.transaction(() => {
      access(user, "quote");
      const property = this.property(user, input.propertyId);
      const hours = Number(input.hours),
        rate = Number(input.rate),
        costRate = Number(input.costRate),
        expenses = Number(input.expenses ?? 0);
      if (
        ![input.hours, input.rate, input.costRate, input.expenses ?? 0].every(
          (v) => typeof v === "number" && Number.isFinite(v),
        ) ||
        hours <= 0 ||
        hours > 10000 ||
        rate <= 0 ||
        costRate < 0 ||
        expenses < 0
      )
        fail(400, "Invalid quote inputs");
      const purpose = requireText(input.purpose, "purpose", 300),
        fee = Math.round((hours * rate + expenses) * 100) / 100,
        cost = Math.round((hours * costRate + expenses) * 100) / 100;
      const data = {
        purpose,
        hours,
        rate,
        costRate,
        expenses,
        fee,
        cost,
        contribution: fee - cost,
        currency: "AUD",
        gst: "exclusive",
        indicative: true,
        pricingVersion: "manual-hours-v1",
        assumptions: input.assumptions || "",
      };
      const quoteId = id();
      this.store.run(
        "INSERT INTO quotes VALUES(?,?,?,?,?,?,?,?,?,?)",
        quoteId,
        user.tenant,
        property.client,
        property.id,
        "draft",
        JSON.stringify(data),
        1,
        user.id,
        null,
        now(),
      );
      this.store.audit(user, "quote.created", quoteId);
      return scoped(
        user,
        this.store.get("SELECT * FROM quotes WHERE id=?", quoteId),
      );
    });
  }
  quoteTransition(user, quoteId, input) {
    return this.store.transaction(() => {
      const q = scoped(
        user,
        this.store.get("SELECT * FROM quotes WHERE id=?", quoteId),
      );
      if (input.version !== q.version) fail(409, "Quote changed");
      const transitions = {
        draft: ["submitted", "quote"],
        submitted: ["approved", "admin"],
        approved: ["issued", "quote"],
      };
      const rule = transitions[q.status];
      if (!rule || input.status !== rule[0])
        fail(409, "Invalid quote transition");
      access(user, rule[1]);
      if (input.status === "approved" && q.created_by === user.id)
        fail(403, "A second administrator must approve");
      this.store.run(
        "UPDATE quotes SET status=?,version=version+1,approved_by=COALESCE(?,approved_by) WHERE id=?",
        input.status,
        input.status === "approved" ? user.id : null,
        quoteId,
      );
      this.store.audit(user, "quote." + input.status, quoteId);
      return scoped(
        user,
        this.store.get("SELECT * FROM quotes WHERE id=?", quoteId),
      );
    });
  }
  connectorStatus(user) {
    tenantAdmin(user);
    return SYSTEMS.map((system) => {
      const row = this.store.get(
        "SELECT * FROM connectors WHERE tenant=? AND system=?",
        user.tenant,
        system,
      );
      return {
        ...(row
          ? parse(row)
          : { system, paused: 0, cursor: null, imported: 0 }),
        mode: this.adapters[system]
          ? this.adapters[system].mode || "configured read-only"
          : "unconfigured",
      };
    });
  }
  async sync(user, system) {
    tenantAdmin(user);
    const adapter = this.adapters[system];
    if (!adapter) fail(422, "Connector not configured");
    const key = user.tenant + ":" + system;
    if (this.running.has(key)) fail(409, "Connector run already active");
    this.store.run(
      "INSERT OR IGNORE INTO connectors(tenant,system) VALUES(?,?)",
      user.tenant,
      system,
    );
    const state = this.store.get(
      "SELECT * FROM connectors WHERE tenant=? AND system=?",
      user.tenant,
      system,
    );
    if (state.paused) fail(409, "Connector paused");
    this.running.add(key);
    const job = id();
    this.store.run(
      "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?)",
      job,
      user.tenant,
      system,
      "running",
      1,
      null,
      null,
      now(),
      null,
    );
    try {
      const result = await adapter.sync(state.cursor);
      const count = this.store.transaction(() => {
        const resultCount = this.ingest(user, system, result.records);
        this.store.run(
          "UPDATE connectors SET cursor=?,last_success=?,last_error=NULL,imported=imported+? WHERE tenant=? AND system=?",
          result.cursor,
          now(),
          resultCount.imported,
          user.tenant,
          system,
        );
        this.store.run(
          "UPDATE jobs SET status='succeeded',finished_at=? WHERE id=?",
          now(),
          job,
        );
        return resultCount;
      });
      return { job, ...count };
    } catch (error) {
      this.store.run(
        "UPDATE jobs SET status='failed',error=?,next_attempt=?,finished_at=? WHERE id=?",
        "Connector run failed; replay after investigating source/mapping",
        new Date(Date.now() + 60000).toISOString(),
        now(),
        job,
      );
      this.store.run(
        "UPDATE connectors SET last_error=? WHERE tenant=? AND system=?",
        "Run failed: " + job,
        user.tenant,
        system,
      );
      this.store.audit(user, "connector.failed", system, { job });
      throw error;
    } finally {
      this.running.delete(key);
    }
  }
  pause(user, system, paused) {
    tenantAdmin(user);
    if (!SYSTEMS.includes(system)) fail(400, "Unknown connector");
    if (typeof paused !== "boolean") fail(400, "Pause state must be boolean");
    this.store.run(
      "INSERT OR IGNORE INTO connectors(tenant,system) VALUES(?,?)",
      user.tenant,
      system,
    );
    this.store.run(
      "UPDATE connectors SET paused=? WHERE tenant=? AND system=?",
      paused ? 1 : 0,
      user.tenant,
      system,
    );
    this.store.audit(
      user,
      paused ? "connector.paused" : "connector.resumed",
      system,
    );
    return { ok: true };
  }
  merge(user, input) {
    access(user, "admin");
    requireText(input.reason, "reason");
    if (input.sourceId === input.targetId)
      fail(400, "Cannot merge with itself");
    return this.store.transaction(() => {
      const source = this.property(user, input.sourceId),
        target = this.property(user, input.targetId);
      if (source.client !== target.client)
        fail(403, "Cannot merge across clients");
      if (
        this.store.get(
          "SELECT id FROM merges WHERE tenant=? AND reversed_at IS NULL AND (source_id IN (?,?) OR target_id IN (?,?))",
          user.tenant,
          source.id,
          target.id,
          source.id,
          target.id,
        )
      )
        fail(409, "Reverse earlier merge before merging these properties");
      const snapshot = {};
      for (const table of ["evidence", "entities", "quotes", "property_links"])
        snapshot[table] = this.store
          .all("SELECT id FROM " + table + " WHERE property_id=?", source.id)
          .map((r) => r.id);
      snapshot.maps = this.store.all(
        "SELECT system,source_id FROM source_maps WHERE tenant=? AND property_id=?",
        user.tenant,
        source.id,
      );
      snapshot.property = source.data;
      for (const table of ["evidence", "entities", "quotes", "property_links"])
        this.store.run(
          "UPDATE " + table + " SET property_id=? WHERE property_id=?",
          target.id,
          source.id,
        );
      this.store.run(
        "UPDATE source_maps SET property_id=? WHERE tenant=? AND property_id=?",
        target.id,
        user.tenant,
        source.id,
      );
      this.store.run(
        "UPDATE properties SET data=? WHERE id=?",
        JSON.stringify({ ...source.data, mergedInto: target.id }),
        source.id,
      );
      const mergeId = id();
      this.store.run(
        "INSERT INTO merges VALUES(?,?,?,?,?,?,?,?,?)",
        mergeId,
        user.tenant,
        source.id,
        target.id,
        JSON.stringify(snapshot),
        user.id,
        input.reason,
        null,
        now(),
      );
      this.store.audit(user, "property.merged", mergeId, {
        reason: input.reason,
      });
      return { id: mergeId };
    });
  }
  reverseMerge(user, mergeId, reason) {
    access(user, "admin");
    requireText(reason, "reason");
    return this.store.transaction(() => {
      const merge = parse(
        this.store.get(
          "SELECT * FROM merges WHERE tenant=? AND id=?",
          user.tenant,
          mergeId,
        ),
      );
      if (!merge || merge.reversed_at) fail(409, "Merge unavailable");
      this.property(user, merge.source_id);
      this.property(user, merge.target_id);
      const snapshot = merge.snapshot;
      for (const table of ["evidence", "entities", "quotes", "property_links"])
        for (const rowId of snapshot[table]) {
          const row = this.store.get(
            "SELECT property_id FROM " + table + " WHERE id=?",
            rowId,
          );
          if (row?.property_id !== merge.target_id)
            fail(
              409,
              "Dependent records changed; manual reconciliation required",
            );
          this.store.run(
            "UPDATE " + table + " SET property_id=? WHERE id=?",
            merge.source_id,
            rowId,
          );
        }
      for (const map of snapshot.maps)
        this.store.run(
          "UPDATE source_maps SET property_id=? WHERE tenant=? AND system=? AND source_id=?",
          merge.source_id,
          user.tenant,
          map.system,
          map.source_id,
        );
      this.store.run(
        "UPDATE properties SET data=? WHERE id=?",
        JSON.stringify(snapshot.property),
        merge.source_id,
      );
      this.store.run(
        "UPDATE merges SET reversed_at=? WHERE id=?",
        now(),
        mergeId,
      );
      this.store.audit(user, "property.merge-reversed", mergeId, { reason });
      return { ok: true };
    });
  }
}
module.exports = {
  tenantAdmin,
  Platform,
  HttpError,
  access,
  scoped,
  inScope,
  parse,
  requireText,
};
