"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  makeTransport,
  SharePointAdapter,
  SalesforceAdapter,
  Cirrus8Adapter,
} = require("./connectors");
const { azureLayout, azureExtraction } = require("./ai-providers");
const { extractDocument } = require("./extraction");
const { FileVault } = require("./vault");
function value(record, field) {
  return typeof field === "string" && Object.hasOwn(record, field)
    ? record[field]
    : null;
}
function mapSalesforce(record, mapping) {
  const f = mapping.fields,
    kind = mapping.kind;
  if (!["sale", "lease"].includes(kind))
    throw Error("Salesforce mapping requires sale or lease kind");
  const amount = value(record, f.value),
    client = value(record, f.client);
  if (typeof client !== "string")
    throw Error("Salesforce record requires mapped client ACL");
  let status = mapping.statusMap?.[value(record, f.status)] || "indicative"; // The stage alone never confirms an executed or settled transaction.
  if (
    status === "settled" &&
    (!f.settlementDate || !value(record, f.settlementDate))
  )
    status = "indicative";
  if (status === "executed" && (!f.executedAt || !value(record, f.executedAt)))
    status = "indicative";
  return {
    id: record.Id,
    propertySourceId: value(record, f.propertySourceId),
    client,
    type: kind,
    kind,
    version: record.SystemModstamp,
    address: value(record, f.address),
    effectiveAt: value(record, f.effectiveAt),
    transactionStatus: status,
    entities: [
      {
        id: record.Id,
        type: kind === "sale" ? "sale" : "lease",
        contractDate: value(record, f.contractDate),
        settlementDate: value(record, f.settlementDate),
        executedAt: value(record, f.executedAt),
        commencement: value(record, f.commencement),
        expiry: value(record, f.expiry),
      },
    ],
    observations: [
      {
        measure: kind === "sale" ? "sale_price" : "face_rent",
        kind,
        value: typeof amount === "number" ? amount : null,
        unit: mapping.unit || "AUD",
        basis: mapping.basis || "unknown",
        transactionStatus: status,
        confidence: 1,
      },
    ],
  };
}
function clientCredentials({
  tenantId,
  clientId,
  secret,
  scope,
  fetcher = fetch,
}) {
  let cached,
    expires = 0;
  return async () => {
    if (cached && Date.now() < expires) return cached;
    const r = await fetcher(
      "https://login.microsoftonline.com/" +
        encodeURIComponent(tenantId) +
        "/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: await secret(),
          grant_type: "client_credentials",
          scope,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!r.ok) throw Error("Source OAuth exchange failed");
    const body = await r.json();
    if (!body.access_token) throw Error("Missing access token");
    cached = body.access_token;
    expires =
      Date.now() + Math.max(0, (Number(body.expires_in) || 300) - 60) * 1000;
    return cached;
  };
}
function loadConnectors({
  store,
  tenant,
  key,
  configPath,
  enabled = false,
  paidAI = false,
  fetcher = fetch,
  vaultDirectory = join(__dirname, "../data/documents"),
}) {
  if (!enabled) return { adapters: {}, vault: null };
  if (!tenant || !key || key.length !== 32)
    throw Error("Source integrations require tenant and encryption key");
  const config = JSON.parse(readFileSync(configPath, "utf8")),
    adapters = {};
  const secret = (name) => async () => {
    const v = store.secret(tenant, name, key);
    if (!v) throw Error("Required source credential is not configured");
    return v;
  };
  let vault = null;
  if (config.sharepoint?.enabled) {
    const c = config.sharepoint;
    if (!c.client || !c.driveId || !c.tenantId || !c.clientId)
      throw Error(
        "SharePoint requires approved drive and client confidentiality scope",
      );
    vault = new FileVault(vaultDirectory, key);
    const ai = config.documentAI;
    if (!ai)
      throw Error("SharePoint requires approved document AI configuration");
    const layoutProvider = azureLayout({
        endpoint: ai.layoutEndpoint,
        key: secret(ai.layoutSecret),
        approved: paidAI,
        fetcher,
      }),
      extractionProvider = azureExtraction({
        endpoint: ai.extractionEndpoint,
        deployment: ai.deployment,
        key: secret(ai.extractionSecret),
        approved: paidAI,
        fetcher,
      });
    const token = clientCredentials({
      tenantId: c.tenantId,
      clientId: c.clientId,
      secret: secret(c.credentialSecretName),
      scope: "https://graph.microsoft.com/.default",
      fetcher,
    });
    const request = makeTransport({
      origin: "https://graph.microsoft.com",
      token,
      fetcher,
      prefix: "/v1.0/drives/" + encodeURIComponent(c.driveId),
    });
    adapters.sharepoint = new SharePointAdapter({
      driveId: c.driveId,
      request,
      mapItem: async (item) => {
        const prior = store.get(
          "SELECT payload FROM raw_records WHERE tenant=? AND system='sharepoint' AND source_id=? AND version=? ORDER BY rowid DESC LIMIT 1",
          tenant,
          item.id,
          String(item.eTag),
        );
        if (prior) return JSON.parse(prior.payload);
        const mime = item.file.mimeType;
        if (
          ![
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ].includes(mime)
        )
          return {
            id: item.id,
            type: "unsupported",
            client: c.client,
            version: item.eTag,
            name: item.name,
            skipReason: "Unsupported file format",
          };
        if (item.size > 25 * 1024 * 1024)
          throw Error("SharePoint file exceeds 25 MB");
        if (!paidAI)
          throw Error("Document AI expenditure has not been approved");
        const uri =
          "https://graph.microsoft.com/v1.0/drives/" +
          encodeURIComponent(c.driveId) +
          "/items/" +
          encodeURIComponent(item.id) +
          "/content";
        const response = await fetcher(uri, {
          headers: { Authorization: "Bearer " + (await token()) },
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
        });
        let bytes;
        if (response.status === 302) {
          const location = new URL(response.headers.get("location"));
          if (
            location.protocol !== "https:" ||
            !location.hostname.endsWith(".sharepoint.com") ||
            location.username ||
            location.password
          )
            throw Error("Unapproved document download origin");
          const downloaded = await fetcher(location.href, {
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          });
          if (!downloaded.ok) throw Error("Document download failed");
          bytes = await boundedBytes(downloaded, 25 * 1024 * 1024);
        } else {
          if (!response.ok) throw Error("Graph content retrieval failed");
          bytes = await boundedBytes(response, 25 * 1024 * 1024);
        }
        const extracted = await extractDocument({
          bytes,
          mime,
          layoutProvider,
          extractionProvider,
        });
        return {
          id: item.id,
          client: c.client,
          type: "document",
          name: item.name,
          version: item.eTag,
          modifiedAt: item.lastModifiedDateTime,
          sourceUri: item.webUrl,
          originalRef: vault.put(tenant, bytes),
          originalHash: require("node:crypto")
            .createHash("sha256")
            .update(bytes)
            .digest("hex"),
          mime,
          pages: extracted.pages,
          extraction: extracted,
        };
      },
    });
  }
  if (config.salesforce?.enabled) {
    const c = config.salesforce;
    let cached,
      expires = 0;
    const token = async () => {
      if (cached && Date.now() < expires) return cached;
      const credential = JSON.parse(await secret(c.credentialSecretName)());
      const r = await fetcher(c.instanceUrl + "/services/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: c.clientId,
          client_secret: credential.clientSecret,
          refresh_token: credential.refreshToken,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error("Salesforce OAuth exchange failed");
      const body = await r.json();
      if (!body.access_token || body.instance_url !== c.instanceUrl)
        throw Error("Salesforce instance mismatch");
      cached = body.access_token;
      expires = Date.now() + 240000;
      return cached;
    };
    if (!Array.isArray(c.objects) || !c.objects.length)
      throw Error("Configure Salesforce objects and reviewed field mappings");
    const request = makeTransport({
      origin: c.instanceUrl,
      token,
      fetcher,
      prefix: "/services/data/",
    });
    const children = c.objects.map(
      (mapping) =>
        new SalesforceAdapter({
          origin: c.instanceUrl,
          object: mapping.apiName,
          fields: [...new Set(Object.values(mapping.fields).filter(Boolean))],
          request,
          mapRecord: (r) => mapSalesforce(r, mapping),
        }),
    );
    adapters.salesforce = {
      testConnection: async () => ({
        objects: await Promise.all(children.map((c) => c.testConnection())),
      }),
      discoverSchema: async () =>
        Promise.all(children.map((c) => c.discoverSchema())),
      preview: async (limit) =>
        (await Promise.all(children.map((c) => c.preview(limit)))).flat(),
      sync: async (cursor) => {
        const prior = cursor ? JSON.parse(cursor) : [],
          records = [],
          next = [];
        for (let i = 0; i < children.length; i++) {
          const r = await children[i].sync(prior[i]);
          records.push(...r.records);
          next.push(r.cursor);
        }
        return { records, cursor: JSON.stringify(next) };
      },
    };
  }
  if (config.cirrus8?.enabled) {
    const c = config.cirrus8;
    const origin = new URL(c.feedUrl).origin;
    if (!c.feedUrl.startsWith("https://") || !c.mappingReviewed)
      throw Error("Cirrus8 requires approved HTTPS normalised feed contract");
    const request = makeTransport({
      origin,
      token: secret(c.connectionSecretName),
      fetcher,
      prefix: new URL(c.feedUrl).pathname,
    });
    adapters.cirrus8 = new Cirrus8Adapter({
      readFeed: async ({ cursor, limit } = {}) => {
        const url = new URL(c.feedUrl);
        if (cursor) url.searchParams.set("cursor", cursor);
        if (limit) url.searchParams.set("limit", String(limit));
        return request(url.href);
      },
      mapRecord: (r) => {
        if (!r.id || !r.client)
          throw Error(
            "Existing Cirrus8 feed must provide normalised source and client identity",
          );
        return r;
      },
    });
  }
  return { adapters, vault };
}
async function boundedBytes(response, max) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > max) throw Error("Document download exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
module.exports = {
  loadConnectors,
  mapSalesforce,
  clientCredentials,
  boundedBytes,
};
