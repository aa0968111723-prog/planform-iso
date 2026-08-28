/**
 * Render the 互動流程 sheet to a PNG so a human can look at it.
 *
 * Dev-only helper: `node scripts/renderFlowSheet.mjs out.png`. The export is a
 * canvas drawing, and the only way to know a canvas drawing is legible is to
 * look at it — `flowSheetLines()` proves WHAT is printed, this proves it fits.
 */

import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const out = process.argv[2] ?? "flow-sheet.png";
const url = process.argv[3] ?? "http://127.0.0.1:5183";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.waitForFunction(() => !!window.planform);

// Build the booth plan the same way a user does.
await page.evaluate(() => {
  const card = document.querySelector(".quickstart__card");
  card.querySelector(".quickstart__name").value = "流程圖檢查";
  card.querySelector("button.btn--primary").click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".quickstart__card button")];
  btns.find((b) => b.textContent.includes("戶外攤位")).click();
});
await page.waitForTimeout(1200);

const dataUrl = await page.evaluate(async () => {
  const mod = await import("/src/export/constructionPlan.ts");
  return mod.renderConstructionPlan(window.planform.store.getState(), {
    preset: "flow", page: "a4", orientation: "portrait", scale: 2,
    dims: false, inventory: false, simplify: false, roleFilter: null,
  });
});

writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log(`wrote ${out}`);
await browser.close();
