"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  sourceEnvelope,
  normaliseAddress,
  matchProperty,
  classifyTransaction,
  validateEvidence,
} = require("../src/canonical");
test("normalises address variants", () =>
  assert.equal(
    normaliseAddress("18 Example Street, Welshpool"),
    "18 EXAMPLE ST WELSHPOOL",
  ));
test("verified source mapping is automatic", () =>
  assert.equal(
    matchProperty({ sourceSystem: "cirrus8", sourceRecordId: "P42" }, [
      { id: "P1", sourceIds: [{ system: "cirrus8", id: "P42" }] },
    ]).decision,
    "match",
  ));
test("matching street address alone requires review", () =>
  assert.equal(
    matchProperty({ address: "18 Example Street" }, [
      { id: "P1", address: "18 Example St" },
    ]).decision,
    "review",
  ));
test("matching title alone requires review", () =>
  assert.equal(
    matchProperty({ titleReference: "123/456" }, [
      { id: "P1", titleReference: "123/456" },
    ]).decision,
    "review",
  ));
test("Closed Won does not imply settlement", () =>
  assert.equal(classifyTransaction("sale", "Closed Won"), "indicative"));
test("executed lease classified", () =>
  assert.equal(classifyTransaction("lease", "executed"), "executed"));
test("source envelope requires identity", () =>
  assert.throws(() =>
    sourceEnvelope({ system: "salesforce", id: "", type: "sale", payload: {} }),
  ));
test("document evidence needs page", () =>
  assert.equal(
    validateEvidence({
      sourceSystem: "sharepoint",
      sourceRecordId: "1",
      measure: "price",
      value: 100,
      unit: "AUD",
      basis: "gross",
      documentId: "D1",
    }).valid,
    false,
  ));
test("document page zero and blank numeric strings are invalid", () => {
  const e = {
    sourceSystem: "sharepoint",
    sourceRecordId: "1",
    measure: "price",
    value: 100,
    unit: "AUD",
    basis: "gross",
    documentId: "D1",
    page: 0,
  };
  assert.equal(validateEvidence(e).valid, false);
  assert.equal(validateEvidence({ ...e, page: 1, value: "" }).valid, false);
});
