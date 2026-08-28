/**
 * Render the shipped examples to PNGs so a human can look at them.
 *
 * Dev-only: `node scripts/renderScenes.mjs <out-dir> [url]`. Geometry constants
 * (a bag's height above a chair, the y of the mat seam grid) are the kind of
 * thing a unit test cannot judge — the only way to know a scene is right is to
 * open it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const outDir = process.argv[2] ?? ".";
const url = process.argv[3] ?? "http://127.0.0.1:5183";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(url);
await page.waitForFunction(() => !!window.planform);

await page.evaluate(() => {
  const card = document.querySelector(".quickstart__card");
  card.querySelector(".quickstart__name").value = "場景檢查";
  card.querySelector("button.btn--primary").click();
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".quickstart__card button")];
  btns.find((b) => b.textContent.includes("建立 30 人實景場佈")).click();
});
await page.waitForTimeout(1800);

for (const view of ["iso", "top"]) {
  const dataUrl = await page.evaluate((v) => {
    const pf = window.planform;
    pf.app.setView(v);
    return new Promise((resolve) => setTimeout(() => resolve(pf.app.scene.renderToDataURL(pf.store.getState(), v)), 700));
  }, view);
  writeFileSync(`${outDir}/e310-${view}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`wrote ${outDir}/e310-${view}.png`);
}

await browser.close();
