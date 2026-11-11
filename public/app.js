"use strict";
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "—").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const money = (v) =>
  v == null
    ? "Unknown"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0,
      }).format(v);
const badge = (v) =>
  `<span class="badge ${esc(v)}">${esc(v).replaceAll("_", " ")}</span>`;
let session,
  state = {
    view: "overview",
    properties: [],
    evidence: [],
    reviews: [],
    quotes: [],
    connectors: [],
    jobs: [],
  };
async function api(path, method = "GET", data) {
  const r = await fetch(path, {
    method,
    headers: {
      ...(method !== "GET"
        ? {
            "Content-Type": "application/json",
            "X-CSRF-Token": session?.csrf || "",
          }
        : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result = await r.json();
  if (!r.ok) {
    if (r.status === 401 && path.startsWith("/api/")) showLogin();
    throw Error(result.error || "Request failed");
  }
  return result;
}
function notice(message, error = false) {
  if ($("#source-dialog").open) {
    let alert = $("#modal-notice");
    if (!alert) {
      alert = document.createElement("p");
      alert.id = "modal-notice";
      alert.setAttribute("role", "alert");
      $("#source-content").prepend(alert);
    }
    alert.textContent = message;
    alert.className = "callout";
  }
  $("#notice").hidden = false;
  $("#notice").className = error ? "error" : "";
  $("#notice").textContent = message;
}
async function reload() {
  [state.properties, state.evidence, state.reviews, state.quotes] =
    await Promise.all(
      ["/api/properties", "/api/evidence", "/api/reviews", "/api/quotes"].map(
        (p) => api(p),
      ),
    );
  if (session.user.role === "admin" && session.user.clients.includes("*"))
    [state.connectors, state.jobs] = await Promise.all(
      ["/api/admin/connectors", "/api/admin/jobs"].map((p) => api(p)),
    );
  $("#review-count").textContent = state.reviews.filter(
    (r) => r.status === "pending",
  ).length;
}
const propertyName = (id) =>
  state.properties.find((p) => p.id === id)?.address ||
  "Property match required";
const title = (name, description, action = "") =>
  `<div class="intro"><div><h1>${name}</h1><p class="muted">${description}</p></div>${action}</div>`;
const table = (headers, rows) =>
  `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" class="empty">No records match this view.</td></tr>`}</tbody></table></div>`;
function evidenceTable(rows) {
  return table(
    [
      "Property / observation",
      "Value & basis",
      "Transaction",
      "Verification",
      "Source",
    ],
    rows.map(
      (e) =>
        `<tr><td><strong>${esc(propertyName(e.property_id))}</strong><small>${esc(e.measure)} · ${esc(e.kind)}</small></td><td class="money"><strong>${e.unit.startsWith("AUD") ? money(e.value) : esc(e.value)} <small>${esc(e.unit)}</small></strong><small>${esc(e.basis)}</small></td><td>${badge(e.transaction_status)}</td><td>${badge(e.status)}</td><td>${e.document_id ? `<button class="subtle" data-source="${e.id}">Page ${e.page || "?"}</button>` : esc(e.data.sourceSystem)}<small>${esc(e.data.sourceRecordId)}</small></td></tr>`,
    ),
  );
}
function overview() {
  const verified = state.evidence.filter((e) => e.status === "verified").length,
    pending = state.reviews.filter((r) => r.status === "pending").length;
  return (
    title(
      "Your property intelligence workspace",
      "A connected view of property, evidence and valuation activity.",
      `<button data-nav="properties">Explore properties →</button>`,
    ) +
    `<div class="callout">Synthetic records only. Document extraction and connector behaviour are tested with fixtures; real data acceptance remains pending.</div><div class="stats">${[
      [
        "Properties",
        state.properties.filter((p) => !p.data.mergedInto).length,
        "Canonical property profiles",
      ],
      [
        "Evidence observations",
        state.evidence.length,
        "Sales, leases and valuation opinions",
      ],
      ["Verified evidence", verified, "Human review completed"],
      ["Awaiting review", pending, "Extraction and property matching"],
    ]
      .map(
        ([label, value, sub]) =>
          `<div class="stat"><p class="eyebrow">${label}</p><div class="value">${value}</div><span class="muted">${sub}</span></div>`,
      )
      .join(
        "",
      )}</div><div class="grid"><div class="card flush"><div class="card-title"><h2>Recent evidence</h2><button class="subtle" data-nav="evidence">View all →</button></div>${evidenceTable(state.evidence.slice(0, 4))}</div><div><div class="card"><h2>Data quality</h2><div class="metric-row"><span>Source identified</span><strong>${state.evidence.filter((e) => e.raw_id).length} / ${state.evidence.length}</strong></div><div class="metric-row"><span>Document observations with pages</span><strong>${state.evidence.filter((e) => e.document_id && e.page > 0).length}</strong></div><div class="metric-row"><span>Extraction exceptions</span><strong>${state.evidence.filter((e) => e.issues.length).length}</strong></div><div class="metric-row"><span>Automatic fuzzy merges</span><strong>Disabled</strong></div></div><div class="card"><h2>Continue your work</h2><p class="muted">Verify extracted numbers against the source before using evidence.</p><button data-nav="reviews">Open review queue →</button></div></div></div>`
  );
}
function properties() {
  return (
    title(
      "Property 360°",
      "Property profiles connected to source records and effective-dated history.",
    ) +
    `<div class="card flush">${table(
      ["Property", "Asset class", "Sources & evidence", ""],
      state.properties
        .filter((p) => !p.data.mergedInto)
        .map(
          (p) =>
            `<tr><td><strong>${esc(p.address)}</strong><small>${esc(p.locality)}</small></td><td>${esc(p.asset_class)}</td><td>${state.evidence.filter((e) => e.property_id === p.id).length} observations</td><td><button data-property="${p.id}">Open profile →</button></td></tr>`,
        ),
    )}</div>`
  );
}
async function propertyDetail(id) {
  const p = await api("/api/properties/" + id);
  $("#content").innerHTML =
    title(
      esc(p.address),
      `${esc(p.asset_class)} · ${esc(p.locality)} · Canonical property profile`,
      `<button class="subtle" data-nav="properties">← All properties</button>`,
    ) +
    `<div class="stats">${[
      [
        "Land area",
        p.data.landAreaSqm ? esc(p.data.landAreaSqm) + " m²" : "Unknown",
      ],
      [
        "Building area",
        p.data.buildingAreaSqm
          ? esc(p.data.buildingAreaSqm) + " m²"
          : "Unknown",
      ],
      ["Evidence", p.evidence.length],
      ["Entities", p.entities.length],
    ]
      .map(
        ([k, v]) =>
          `<div class="stat"><span class="eyebrow">${k}</span><div class="value">${v}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="card flush"><div class="card-title"><h2>Linked evidence</h2></div>${evidenceTable(p.evidence)}</div><div class="card flush"><div class="card-title"><h2>Buildings, parcels, leases & rent history</h2></div>${table(
      ["Type", "Source identity", "Effective date", "Details"],
      p.entities.map(
        (e) =>
          `<tr><td>${badge(e.type)}</td><td>${esc(e.source_id)}</td><td>${esc(e.effective_at)}</td><td><pre>${esc(JSON.stringify(e.data, null, 2))}</pre></td></tr>`,
      ),
    )}</div>`;
}
function evidence() {
  return (
    title(
      "Evidence Explorer",
      "Keep transaction status, extraction confidence and verification separate.",
    ) +
    `<div class="filters"><input id="evidence-search" aria-label="Search evidence" placeholder="Search property, source, basis or measure…"><select id="evidence-kind" aria-label="Evidence kind"><option value="">All types</option><option>sale</option><option>lease</option><option>valuation</option></select><select id="evidence-status" aria-label="Verification status"><option value="">All verification</option><option>verified</option><option>pending</option><option>rejected</option><option>withdrawn</option></select></div><div id="evidence-results" class="card flush">${evidenceTable(state.evidence)}</div>`
  );
}
function reviews() {
  const rows = state.reviews.filter((r) => r.status === "pending");
  return (
    title(
      "Review queue",
      "Confirm identity, check source pages and resolve numeric exceptions.",
    ) +
    (rows
      .map((r) => {
        const e = state.evidence.find((e) => e.id === r.evidence_id);
        return `<div class="card"><div class="intro"><div><h2>${r.type === "property-match" ? "Resolve property identity" : esc(e?.measure) + " · " + esc(propertyName(e?.property_id))}</h2><p class="muted">${r.type === "property-match" ? esc(r.data.address || r.data.sourceId) : `${esc(e.data.sourceSystem)} · ${esc(e.data.sourceRecordId)} · ${Math.round(e.confidence * 100)}% extraction confidence`}</p></div>${badge("pending")}</div>${e?.issues.length ? `<div class="callout">${e.issues.map(esc).join(" · ")}</div>` : ""}${e ? `<p><strong>${e.unit.startsWith("AUD") ? money(e.value) : esc(e.value)}</strong> ${esc(e.unit)} · ${esc(e.basis)}</p>` : ""}<div class="actions">${e?.document_id ? `<button data-source="${e.id}">Verify against source →</button>` : ""}${e?.issues.length ? `<button class="subtle" data-correct="${e.id}">Correct extracted fields</button>` : ""}<button class="subtle" data-review="${r.id}" data-decision="approved">${r.type === "property-match" ? "Choose property" : "Approve"}</button><button class="subtle" data-review="${r.id}" data-decision="rejected">Reject</button></div></div>`;
      })
      .join("") || '<div class="card empty">No pending reviews.</div>')
  );
}
function quoteRows() {
  return table(
    ["Property / purpose", "Fee (ex GST)", "Contribution", "Workflow", ""],
    state.quotes.map(
      (q) =>
        `<tr><td><strong>${esc(propertyName(q.property_id))}</strong><small>${esc(q.data.purpose)}</small></td><td>${money(q.data.fee)}<small>Indicative</small></td><td>${money(q.data.contribution)}</td><td>${badge(q.status)}</td><td><button class="subtle" data-print="${q.id}">Print quote</button> ${q.status !== "issued" ? `<button data-quote-transition="${q.id}">${{ draft: "Submit", submitted: "Approve", approved: "Issue" }[q.status]}</button>` : ""}</td></tr>`,
    ),
  );
}
function quotes() {
  return (
    title(
      "Valuation quoting",
      "Build a scoped, indicative fee and route it for independent approval.",
    ) +
    `<div class="grid"><div class="card"><h2>Prepare a quote</h2><form id="quote-form" class="form-grid"><label class="wide">Property<select name="propertyId" required>${state.properties
      .filter((p) => !p.data.mergedInto)
      .map((p) => `<option value="${p.id}">${esc(p.address)}</option>`)
      .join(
        "",
      )}</select></label><label class="wide">Purpose<input name="purpose" value="Mortgage security valuation" required></label><label>Estimated hours<input name="hours" type="number" min="0.25" step="0.25" value="12" required></label><label>Hourly fee (AUD)<input name="rate" type="number" min="1" value="280" required></label><label>Loaded hourly cost (AUD)<input name="costRate" type="number" min="0" value="145" required></label><label>Expenses (AUD)<input name="expenses" type="number" min="0" value="200" required></label><label class="wide">Scope and assumptions<textarea name="assumptions" required>Subject to agreed scope, inspection and information availability.</textarea></label><button class="wide">Save indicative quote</button></form></div><div class="card"><h2>Fee governance</h2><p>Quotes use explicit hours, fee rate, loaded costs and expenses. Pricing remains indicative until calibrated and signed off by Valuations leadership.</p><div class="metric-row"><span>Approval</span><strong>Second administrator</strong></div><div class="metric-row"><span>Workflow</span><strong>Draft → Submitted → Approved → Issued</strong></div><div class="callout">The author cannot approve their own quote. Print output retains the indicative pricing label.</div></div></div><div class="card flush">${quoteRows()}</div>`
  );
}
function admin() {
  if (session.user.role !== "admin" || !session.user.clients.includes("*"))
    return title(
      "Administration",
      "Tenant-wide administrator access required.",
    );
  return (
    title(
      "Administration",
      "Read-only source adapters, replay controls and audited identity decisions.",
    ) +
    `<div class="grid">${state.connectors.map((c) => `<div class="card"><h2>${esc(c.system)}</h2>${badge(c.paused ? "paused" : "ready")}<div class="metric-row"><span>Mode</span><strong>${esc(c.mode)}</strong></div><div class="metric-row"><span>Imported by sync</span><strong>${c.imported}</strong></div><div class="metric-row"><span>Last success</span><strong>${esc(c.last_success || "Awaiting first run")}</strong></div>${c.last_error ? `<div class="callout">${esc(c.last_error)}</div>` : ""}<div class="actions"><button data-sync="${c.system}">Sync / replay</button><button class="subtle" data-pause="${c.system}" data-paused="${c.paused ? "false" : "true"}">${c.paused ? "Resume" : "Pause"}</button><button class="subtle" data-test="${c.system}">Test connection</button><button class="subtle" data-schema="${c.system}">Schema</button><button class="subtle" data-preview="${c.system}">Preview</button></div></div>`).join("")}<div class="card"><h2>Audit & merge history</h2><p class="muted">All identity changes require a reason. Merges keep original properties and can be reversed.</p><div class="actions"><button class="subtle" id="audit">View audit</button><button class="subtle" id="merges">Merge history</button></div><form id="merge-form" class="form-grid"><label class="wide">Source property<select name="sourceId">${state.properties.map((p) => `<option value="${p.id}">${esc(p.address)}</option>`).join("")}</select></label><label class="wide">Target property<select name="targetId">${state.properties.map((p) => `<option value="${p.id}">${esc(p.address)}</option>`).join("")}</select></label><label class="wide">Reason<input name="reason" required></label><button class="wide">Merge properties</button></form></div></div><div class="card"><h2>Encrypted source credentials</h2><p class="muted">Configure the external encryption key before adding credentials. Stored values cannot be read back.</p><form id="secret-form" class="form-grid"><label>Configured secret name<input name="name" required autocomplete="off"></label><label>Credential value<input name="value" type="password" required autocomplete="new-password"></label><button>Save encrypted credential</button></form></div><div class="card flush"><div class="card-title"><h2>Ingestion runs</h2></div>${table(
      ["Source", "State", "Attempts", "Created", "Error"],
      state.jobs.map(
        (j) =>
          `<tr><td>${esc(j.system)}</td><td>${badge(j.status)}</td><td>${j.attempts}</td><td>${esc(j.created_at)}</td><td>${esc(j.error)}</td></tr>`,
      ),
    )}</div>`
  );
}
function render() {
  const views = { overview, properties, evidence, reviews, quotes, admin };
  $("#content").innerHTML = views[state.view]();
  $("#breadcrumb").textContent =
    "Workspace / " +
    {
      overview: "Overview",
      properties: "Property 360°",
      evidence: "Evidence Explorer",
      reviews: "Review queue",
      quotes: "Valuation quoting",
      admin: "Administration",
    }[state.view];
  document
    .querySelectorAll("nav button")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.view === state.view),
    );
}
async function showSource(evidenceId) {
  const e = state.evidence.find((e) => e.id === evidenceId),
    d = await api("/api/documents/" + e.document_id);
  $("#source-content").innerHTML =
    `<h2>${esc(d.name)}</h2><p class="muted">Page ${e.page || "?"} of ${d.pages.length} · ${esc(d.model)} · SHA-256 ${esc(d.hash.slice(0, 12))}…</p><div class="grid equal"><div class="source">${esc(d.pages[(e.page || 1) - 1]?.text || "Page unavailable")}</div><div class="card"><h2>Extracted observation</h2><div class="metric-row"><span>Measure</span><strong>${esc(e.measure)}</strong></div><div class="metric-row"><span>Value</span><strong>${esc(e.value)} ${esc(e.unit)}</strong></div><p>${esc(e.basis)}</p><p>${badge(e.status)} ${badge(e.transaction_status)}</p><h3>Literal source quote</h3><p>${esc(e.data.quote)}</p>${e.issues.length ? `<div class="callout">${e.issues.map(esc).join("<br>")}</div>` : ""}<p class="muted">Compare the number, basis and page before approval.</p><a href="/api/documents/${d.id}/file" target="_blank" rel="noopener">Download original source (connected files only)</a></div></div>`;
  $("#source-dialog").showModal();
}
function modal(html) {
  $("#source-content").innerHTML = html;
  if (!$("#source-dialog").open) $("#source-dialog").showModal();
}
function reviewForm(reviewId, decision) {
  const r = state.reviews.find((r) => r.id === reviewId),
    e = state.evidence.find((e) => e.id === r.evidence_id);
  modal(
    `<h2>${decision === "approved" ? "Approve review" : "Reject review"}</h2><form id="review-form" data-id="${r.id}" data-decision="${decision}" class="form-grid">${
      r.type === "property-match" && decision === "approved"
        ? `<label class="wide">Verified property<select name="propertyId" required>${state.properties
            .filter((p) => !p.data.mergedInto)
            .map(
              (p) =>
                `<option value="${p.id}">${esc(p.address)}${r.data.candidates.includes(p.id) ? " (candidate)" : ""}</option>`,
            )
            .join("")}</select></label>`
        : ""
    }${e?.document_id && decision === "approved" ? `<label class="wide">Type the source numeric value to confirm<input name="confirmedValue" type="number" step="any" required></label>` : ""}<label class="wide">Decision reason<textarea name="reason" required></textarea></label><button class="wide">Record decision</button></form>`,
  );
}
function correctionForm(evidenceId) {
  const e = state.evidence.find((e) => e.id === evidenceId);
  modal(
    `<h2>Correct extracted fields</h2><p>Retain a literal quote and page. Corrections are audited; a separate approval is still required.</p><form id="correction-form" data-id="${e.id}" class="form-grid"><label>Value<input name="value" type="number" step="any" value="${e.value}" required></label><label>Unit<input name="unit" value="${esc(e.unit)}" required></label><label class="wide">Basis<input name="basis" value="${esc(e.basis)}" required></label>${e.document_id ? `<label>Page<input name="page" type="number" min="1" value="${e.page || 1}" required></label><label class="wide">Literal source quote<textarea name="quote" required>${esc(e.data.quote)}</textarea></label>` : ""}<label class="wide">Correction reason<textarea name="reason" required></textarea></label><button class="wide">Save correction</button></form>`,
  );
}
function printQuote(quoteId) {
  const q = state.quotes.find((q) => q.id === quoteId);
  document.querySelector(".print-quote")?.remove();
  const out = document.createElement("article");
  out.className = "print-quote";
  out.innerHTML = `<div class="wordmark">BR<span>WA</span></div><p>Burgess Rawson Western Australia</p><h1>Indicative valuation fee proposal</h1><p>Reference: ${esc(q.id)}</p><h2>${esc(propertyName(q.property_id))}</h2><p>${esc(q.data.purpose)}</p>${table(["Description", "AUD"], [`<tr><td>Professional fee (${q.data.hours} hours × ${money(q.data.rate)})</td><td>${money(q.data.hours * q.data.rate)}</td></tr>`, `<tr><td>Expenses</td><td>${money(q.data.expenses)}</td></tr>`, `<tr><td><strong>Total excluding GST</strong></td><td><strong>${money(q.data.fee)}</strong></td></tr>`])}<h2>Scope & assumptions</h2><p>${esc(q.data.assumptions)}</p><p>Workflow status: ${esc(q.status)}. Pricing is indicative and subject to Valuations leadership sign-off. GST is additional where applicable.</p>`;
  document.body.append(out);
  window.print();
}
async function showLogin() {
  session = null;
  $("#workspace").hidden = true;
  $("#login").hidden = false;
  const config = await api("/auth/config");
  $("#login-form").hidden = config.mode !== "demo";
  $("#entra-login").hidden = config.mode !== "entra";
}
async function signedIn() {
  await reload();
  $("#login").hidden = true;
  $("#workspace").hidden = false;
  $("#identity").textContent = session.user.name + " · " + session.user.role;
  const config = await api("/auth/config");
  $("#mode").textContent =
    config.mode === "demo" ? "Synthetic workspace" : "Entra workspace";
  $("#environment").textContent =
    config.mode === "demo" ? "SYNTHETIC DATA" : "INTERNAL WORKSPACE";
  render();
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    session = await api("/auth/demo", "POST", {
      code: new FormData(event.target).get("code"),
    });
    event.target.reset();
    await signedIn();
  } catch (e) {
    $("#login-error").textContent = e.message;
  }
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("/auth/logout", "POST", {});
    await showLogin();
  } catch (e) {
    notice(e.message, true);
  }
});
$("#close-source").addEventListener("click", () => $("#source-dialog").close());
document.addEventListener("input", (event) => {
  if (
    ["evidence-search", "evidence-kind", "evidence-status"].includes(
      event.target.id,
    )
  ) {
    const q = $("#evidence-search").value.toLowerCase(),
      kind = $("#evidence-kind").value,
      status = $("#evidence-status").value;
    $("#evidence-results").innerHTML = evidenceTable(
      state.evidence.filter(
        (e) =>
          (!kind || e.kind === kind) &&
          (!status || e.status === status) &&
          (JSON.stringify(e) + propertyName(e.property_id))
            .toLowerCase()
            .includes(q),
      ),
    );
  }
});
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.view || b.dataset.nav) {
      state.view = b.dataset.view || b.dataset.nav;
      render();
    } else if (b.dataset.property) await propertyDetail(b.dataset.property);
    else if (b.dataset.source) await showSource(b.dataset.source);
    else if (b.dataset.correct) correctionForm(b.dataset.correct);
    else if (b.dataset.review) reviewForm(b.dataset.review, b.dataset.decision);
    else if (b.dataset.sync) {
      b.disabled = true;
      const r = await api(
        "/api/admin/connectors/" + b.dataset.sync + "/sync",
        "POST",
        {},
      );
      await reload();
      render();
      notice(
        `Import complete: ${r.imported} new records, ${r.duplicates} duplicates skipped.`,
      );
    } else if (b.dataset.pause) {
      await api("/api/admin/connectors/" + b.dataset.pause + "/pause", "POST", {
        paused: b.dataset.paused === "true",
      });
      await reload();
      render();
    } else if (b.dataset.test || b.dataset.schema || b.dataset.preview) {
      const source = b.dataset.test || b.dataset.schema || b.dataset.preview,
        action = b.dataset.test
          ? "test"
          : b.dataset.schema
            ? "schema"
            : "preview";
      const r = await api("/api/admin/connectors/" + source + "/" + action);
      modal(
        `<h2>${esc(source)} ${action}</h2><pre>${esc(JSON.stringify(r, null, 2))}</pre>`,
      );
    } else if (b.dataset.quoteTransition) {
      const q = state.quotes.find((q) => q.id === b.dataset.quoteTransition);
      await api("/api/quotes/" + q.id, "POST", {
        version: q.version,
        status: {
          draft: "submitted",
          submitted: "approved",
          approved: "issued",
        }[q.status],
      });
      await reload();
      render();
      notice("Quote workflow updated.");
    } else if (b.dataset.print) printQuote(b.dataset.print);
    else if (b.id === "audit") {
      const r = await api("/api/admin/audit");
      modal(
        `<h2>Audit trail · integrity ${r.integrity ? "verified" : "FAILED"}</h2>${table(
          ["Time", "Actor", "Action", "Record"],
          r.events.map(
            (e) =>
              `<tr><td>${esc(e.at)}</td><td>${esc(e.actor)}</td><td>${esc(e.action)}</td><td>${esc(e.entity)}</td></tr>`,
          ),
        )}`,
      );
    } else if (b.id === "merges") {
      const r = await api("/api/admin/merges");
      modal(
        "<h2>Merge history</h2>" +
          r
            .map(
              (m) =>
                `<div class="card"><p>${esc(propertyName(m.source_id))} → ${esc(propertyName(m.target_id))}</p><p>${esc(m.reason)}</p>${m.reversed_at ? badge("reversed") : `<button data-reverse="${m.id}">Reverse merge</button>`}</div>`,
            )
            .join(""),
      );
    } else if (b.dataset.reverse) {
      modal(
        `<h2>Reverse merge</h2><form id="reverse-form" data-id="${b.dataset.reverse}"><label>Reason<input name="reason" required></label><div class="actions"><button>Record reversal</button></div></form>`,
      );
    }
  } catch (e) {
    notice(e.message, true);
  } finally {
    b.disabled = false;
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (
    ![
      "quote-form",
      "review-form",
      "correction-form",
      "merge-form",
      "reverse-form",
      "secret-form",
    ].includes(form.id)
  )
    return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "quote-form") {
      for (const k of ["hours", "rate", "costRate", "expenses"])
        data[k] = Number(data[k]);
      await api("/api/quotes", "POST", data);
    } else if (form.id === "review-form") {
      data.decision = form.dataset.decision;
      const task = state.reviews.find((r) => r.id === form.dataset.id),
        e = state.evidence.find((e) => e.id === task.evidence_id);
      if (e) data.version = e.version;
      if (data.confirmedValue !== undefined)
        data.confirmedValue = Number(data.confirmedValue);
      await api("/api/reviews/" + form.dataset.id, "POST", data);
    } else if (form.id === "correction-form") {
      const e = state.evidence.find((e) => e.id === form.dataset.id);
      data.version = e.version;
      data.value = Number(data.value);
      if (data.page) data.page = Number(data.page);
      await api("/api/evidence/" + e.id, "PATCH", data);
    } else if (form.id === "secret-form") {
      await api("/api/admin/secrets", "POST", data);
      form.reset();
    } else if (form.id === "merge-form")
      await api("/api/admin/merges", "POST", data);
    else
      await api(
        "/api/admin/merges/" + form.dataset.id + "/reverse",
        "POST",
        data,
      );
    $("#source-dialog").close();
    await reload();
    render();
    notice("Saved successfully.");
  } catch (e) {
    notice(e.message, true);
  }
});
(async () => {
  try {
    session = await api("/auth/session");
    await signedIn();
  } catch {
    await showLogin();
  }
})();
