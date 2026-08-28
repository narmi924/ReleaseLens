import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

type ApiIndex = {
  products: Array<{
    id: string;
    latest: Array<{ observationId: string; version: string }>;
  }>;
};

async function indexFrom(page: Page): Promise<ApiIndex> {
  const response = await page.request.get("/api/v1/index.json");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ApiIndex;
}

test("dashboard surfaces real current release state", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/ReleaseLens/);
  await expect(
    page.getByRole("heading", { name: /Release intelligence/i }),
  ).toBeVisible();
  for (const tool of ["Codex", "Claude Code", "Gemini CLI"]) {
    await expect(
      page.getByRole("heading", { name: tool, exact: true }),
    ).toBeVisible();
  }
  const index = await indexFrom(page);
  const codex = index.products.find((product) => product.id === "codex");
  expect(codex?.latest.length).toBeGreaterThan(0);
  const codexCard = page
    .locator(".tool-card")
    .filter({ has: page.getByRole("heading", { name: "Codex", exact: true }) });
  await expect(
    codexCard.getByText(codex!.latest[0]!.version, { exact: false }).first(),
  ).toBeVisible();
});

test("tool timeline and release detail resolve through published API IDs", async ({
  page,
}) => {
  const index = await indexFrom(page);
  const codex = index.products.find((product) => product.id === "codex");
  expect(codex).toBeDefined();
  const latest = codex!.latest[0]!;
  await page.goto("/tools/codex/");
  await expect(
    page.getByRole("heading", { name: "Codex", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(latest.version, { exact: true }).first(),
  ).toBeVisible();
  await page.goto(`/tools/codex/releases/${latest.observationId}/`);
  await expect(
    page.getByRole("heading", { name: latest.version, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Persisted comparison" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Distribution and source provenance" }),
  ).toBeVisible();
});

test("compare can switch products without inventing a delta", async ({
  page,
}) => {
  await page.goto("/compare/");
  await page.getByLabel("Comparison product").selectOption("gemini-cli");
  await expect(page.getByLabel("Comparison product")).toHaveValue("gemini-cli");
  await expect(
    page.getByRole("heading", {
      name: /material change|No direct persisted delta/i,
    }),
  ).toBeVisible();
});

test("incidents and methodology remain honest and navigable", async ({
  page,
}) => {
  await page.goto("/incidents/");
  await expect(
    page.getByRole("heading", {
      name: /Regression claims require durable evidence/i,
    }),
  ).toBeVisible();
  await page.goto("/methodology/");
  await expect(
    page.getByRole("heading", { name: /A verdict is a traceable decision/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "FE3 is experimental" }),
  ).toBeVisible();
});

test("mobile dashboard preserves primary status flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("ReleaseLens", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Codex", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Open navigation")).toBeVisible();
});
