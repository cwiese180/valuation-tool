"use strict";
const { safeUrl } = require("./connectors");
function approvedEndpoint(value, suffix) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(suffix) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("Unapproved AI endpoint");
  return url.origin;
}
function azureLayout({
  endpoint,
  key,
  approved = false,
  fetcher = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const origin = approvedEndpoint(endpoint, ".cognitiveservices.azure.com");
  return async ({ bytes, mime }) => {
    if (!approved)
      throw Error("Paid AI processing requires explicit deployment approval");
    const response = await fetcher(
      origin +
        "/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30",
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": await key(),
          "Content-Type": mime,
        },
        body: bytes,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    if (response.status !== 202)
      throw Error("Layout request failed HTTP " + response.status);
    const location = safeUrl(
      response.headers.get("operation-location"),
      origin,
      "/documentintelligence/documentModels/",
    );
    for (let poll = 0; poll < 60; poll++) {
      await sleep(1000);
      const r = await fetcher(location, {
        headers: { "Ocp-Apim-Subscription-Key": await key() },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error("Layout polling failed HTTP " + r.status);
      const result = await r.json();
      if (result.status === "failed" || result.status === "canceled")
        throw Error("Layout analysis failed");
      if (result.status === "succeeded") {
        const analysis = result.analyzeResult;
        if (!analysis?.pages?.length) throw Error("No layout pages");
        const pages = analysis.pages.map((page) => ({
          number: page.pageNumber,
          text:
            page.lines?.map((l) => l.content).join("\n") ||
            page.spans
              ?.map((s) =>
                analysis.content.slice(s.offset, s.offset + s.length),
              )
              .join("\n") ||
            "",
          width: page.width ?? null,
          height: page.height ?? null,
          unit: page.unit ?? null,
          tables: (analysis.tables || []).filter((t) =>
            t.boundingRegions?.some((r) => r.pageNumber === page.pageNumber),
          ),
        }));
        return { pages, model: "azure-layout-2024-11-30" };
      }
    }
    throw Error("Layout analysis timed out");
  };
}
function azureExtraction({
  endpoint,
  key,
  deployment,
  approved = false,
  fetcher = fetch,
}) {
  const origin = approvedEndpoint(endpoint, ".openai.azure.com");
  if (typeof deployment !== "string" || !deployment)
    throw Error("Model deployment required");
  return async ({ pages, instruction }) => {
    if (!approved)
      throw Error("Paid AI processing requires explicit deployment approval");
    const properties = {
      kind: { type: "string", enum: ["sale", "lease", "valuation"] },
      measure: {
        type: "string",
        enum: ["adopted_value", "sale_price", "face_rent", "area_sqm", "yield"],
      },
      value: { type: "number" },
      unit: { type: "string" },
      basis: { type: "string" },
      page: { type: "integer" },
      quote: { type: "string" },
      confidence: { type: "number" },
    };
    const schema = {
      type: "object",
      properties: {
        observations: {
          type: "array",
          items: {
            type: "object",
            properties,
            required: Object.keys(properties),
            additionalProperties: false,
          },
        },
      },
      required: ["observations"],
      additionalProperties: false,
    };
    const r = await fetcher(origin + "/openai/v1/chat/completions", {
      method: "POST",
      headers: { "api-key": await key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        model: deployment,
        messages: [
          {
            role: "system",
            content:
              instruction +
              " Do not treat asking prices as settled sales. Use one-based source page numbers.",
          },
          {
            role: "user",
            content: JSON.stringify(
              pages.map((p, i) => ({ page: i + 1, text: p.text })),
            ),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "evidence_extraction", strict: true, schema },
        },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw Error("Extraction request failed HTTP " + r.status);
    const result = await r.json(),
      choice = result.choices?.[0];
    if (choice?.finish_reason !== "stop" || choice.message?.refusal)
      throw Error("Incomplete or refused extraction");
    return {
      ...JSON.parse(choice.message.content),
      model: result.model || deployment,
    };
  };
}
module.exports = { azureLayout, azureExtraction };
