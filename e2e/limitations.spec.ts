import { expect, test } from "@playwright/test";
import { openWorkspace } from "./helpers";

/**
 * Honesty labels for features that look finished but are 1.1 / field-only / mock.
 */

test("更多 → 已知限制 lists the documented gaps", async ({ page }) => {
  await openWorkspace(page);
  await page.locator(".topbar__more").first().click();
  await page.getByRole("menuitem", { name: /已知限制/ }).click();

  const sheet = page.locator(".limitsheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("線上 Zeabur");
  await expect(sheet).toContainText("已補上");
  await expect(sheet.locator("[data-limitation-id]")).toHaveCount(1);
});

test("✦ AI 幫我 says offline rules unless a key is set", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "✦ AI" }).first().click();
  await expect(page.locator(".agent-sheet")).toContainText("沒金鑰用離線規則");
});

test("掃描場地 and 模擬 say what they actually do", async ({ page }) => {
  await openWorkspace(page);

  // Desktop has no bottom nav — workflows live in the topbar chips.
  await page.locator(".topbar .group--flows").getByRole("button", { name: "場地" }).click();
  await page.locator(".left > .section", { hasText: "進階設定" }).locator(".section__title").first().click();
  await expect(page.locator(".venue-capture")).toContainText("本機影像分析");

  await page.locator(".topbar .group--flows").getByRole("button", { name: "動線" }).click();
  await expect(page.locator(".sim-panel-host")).toContainText("A–E 報到模板");
  await expect(page.locator(".sim-panel-host")).toContainText("一般報到");
});
