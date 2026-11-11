"use strict";
const { test, expect } = require("@playwright/test");
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Local access code").fill("synthetic-browser-fixture");
  await page.getByRole("button", { name: "Open synthetic workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Your property intelligence workspace" }),
  ).toBeVisible();
});
test("Property 360 connects evidence and effective-dated rent history", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Property 360°" }).click();
  await page.getByRole("button", { name: "Open profile" }).first().click();
  await expect(
    page.getByRole("heading", { name: "18 EXAMPLE ST WELSHPOOL" }),
  ).toBeVisible();
  await expect(page.getByText("term-2", { exact: true })).toBeVisible();
  await expect(
    page.getByText("2025-07-01", { exact: true }).first(),
  ).toBeVisible();
});
test("Evidence Explorer filters verification and opens a source page", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Evidence Explorer" }).click();
  await page.getByLabel("Verification status").selectOption("verified");
  await expect(page.locator("#evidence-results tbody tr")).toHaveCount(1);
  await page.getByLabel("Verification status").selectOption("pending");
  await page
    .getByRole("button", { name: "Page 1", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Literal source quote")).toBeVisible();
  await expect(page.locator(".source")).toContainText("SYNTHETIC REPORT");
});
test("review requires explicit source numeric confirmation before publishing", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Review queue" }).click();
  const card = page
    .locator("#content > .card")
    .filter({ hasText: "adopted_value" });
  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await page
    .getByLabel("Type the source numeric value to confirm")
    .fill("4400000");
  await page
    .getByLabel("Decision reason")
    .fill("Browser regression: checked synthetic source page");
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  await expect(
    page.locator("#content > .card").filter({ hasText: "adopted_value" }),
  ).toHaveCount(0);
});
test("quote creation and self-approval prevention are visible in UI", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Valuation quoting" }).click();
  await page
    .getByLabel("Purpose", { exact: true })
    .fill("Synthetic browser test quote");
  await page.getByRole("button", { name: "Save indicative quote" }).click();
  const row = page
    .getByRole("row")
    .filter({ hasText: "Synthetic browser test quote" });
  await expect(row).toContainText("$3,560");
  await row.getByRole("button", { name: "Submit", exact: true }).click();
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "A second administrator must approve",
  );
});
test("administrator can sync fixtures twice without duplicates", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Administration" }).click();
  const card = page.locator("#content .card").filter({
    has: page.getByRole("heading", { name: "cirrus8", exact: true }),
  });
  await card.getByRole("button", { name: "Sync / replay" }).click();
  await expect(page.getByRole("status")).toContainText("0 new records");
  await card.getByRole("button", { name: "Sync / replay" }).click();
  await expect(page.getByRole("status")).toContainText("0 new records");
  await expect(
    page.getByRole("heading", { name: "Ingestion runs" }),
  ).toBeVisible();
});
test("mobile evidence layout keeps navigation and controls reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Evidence Explorer" }).click();
  await expect(
    page.getByRole("heading", { name: "Evidence Explorer", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search evidence").fill("adopted_value");
  await expect(page.locator("#evidence-results tbody tr")).toHaveCount(1);
});
