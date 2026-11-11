"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { azureLayout, azureExtraction } = require("../src/ai-providers");
test("Azure providers fail closed before any expenditure without explicit approval", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error("Must not call");
  };
  const layout = azureLayout({
    endpoint: "https://synthetic.cognitiveservices.azure.com",
    key: async () => "test",
    fetcher,
  });
  await assert.rejects(
    layout({ bytes: Buffer.from("synthetic"), mime: "application/pdf" }),
    /approval/,
  );
  const extraction = azureExtraction({
    endpoint: "https://synthetic.openai.azure.com",
    deployment: "mock",
    key: async () => "test",
    fetcher,
  });
  await assert.rejects(extraction({ pages: [] }), /approval/);
  assert.equal(calls, 0);
});
test("Azure layout polls only approved endpoint and preserves page tables", async () => {
  let calls = 0;
  const provider = azureLayout({
    endpoint: "https://synthetic.cognitiveservices.azure.com",
    approved: true,
    key: async () => "fixture",
    sleep: async () => {},
    fetcher: async () => {
      calls++;
      return calls === 1
        ? {
            status: 202,
            headers: new Headers({
              "operation-location":
                "https://synthetic.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-layout/analyzeResults/1",
            }),
          }
        : {
            ok: true,
            json: async () => ({
              status: "succeeded",
              analyzeResult: {
                pages: [
                  { pageNumber: 1, lines: [{ content: "Value: 100 AUD" }] },
                ],
                tables: [{ boundingRegions: [{ pageNumber: 1 }], cells: [] }],
              },
            }),
          };
    },
  });
  const result = await provider({
    bytes: Buffer.from("synthetic"),
    mime: "application/pdf",
  });
  assert.equal(result.pages[0].text, "Value: 100 AUD");
  assert.equal(result.pages[0].tables.length, 1);
});
test("Azure layout rejects hostile operation locations before polling", async () => {
  const provider = azureLayout({
    endpoint: "https://synthetic.cognitiveservices.azure.com",
    approved: true,
    key: async () => "fixture",
    fetcher: async () => ({
      status: 202,
      headers: new Headers({
        "operation-location": "https://evil.example/steal",
      }),
    }),
  });
  await assert.rejects(
    provider({ bytes: Buffer.from("x"), mime: "application/pdf" }),
    /outside approved scope/,
  );
});
test("Azure extraction sends strict schema and rejects truncated output", async () => {
  const provider = azureExtraction({
    endpoint: "https://synthetic.openai.azure.com",
    deployment: "mock",
    approved: true,
    key: async () => "fixture",
    fetcher: async (url, init) => {
      const payload = JSON.parse(init.body);
      assert.equal(payload.response_format.json_schema.strict, true);
      assert.equal(payload.messages[0].role, "system");
      return {
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: "length", message: { content: "{}" } }],
        }),
      };
    },
  });
  await assert.rejects(
    provider({ pages: [{ text: "synthetic" }], instruction: "Extract only" }),
    /Incomplete/,
  );
});
