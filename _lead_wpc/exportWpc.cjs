const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const BASE_URL = process.env.PLANFORM_PREVIEW_URL || "http://127.0.0.1:4181";
const ROOT = path.resolve(__dirname);
const EXPORT_DIR = path.join(ROOT, "exports");
const PHONE_DIR = path.join(ROOT, "phone");

async function clickDownload(page, label, filename) {
  const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
  await page.locator(".left button", { hasText: label }).first().click();
  const download = await downloadPromise;
  const output = path.join(EXPORT_DIR, filename);
  await download.saveAs(output);
  console.log(`${label} -> ${output}`);
  return output;
}

async function main() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.mkdirSync(PHONE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 1024 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.removeItem("planform-iso:quickstart");
    localStorage.removeItem("planform-iso:autosave");
    localStorage.removeItem("planform-iso:autosave-backup");
    localStorage.removeItem("planform-iso:venues");
    localStorage.removeItem("planform-iso:layouts");
  });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.locator(".quickstart__card button", { hasText: "E310 演講範例（60 人）" }).click();
  await page.waitForTimeout(500);
  await page.locator('.navbtn[data-nav="export"]').click();
  await page.waitForTimeout(350);

  const outputs = [];
  outputs.push(await clickDownload(page, "場佈總覽圖", "e310-overview.png"));
  outputs.push(await clickDownload(page, "3D 場佈圖", "e310-3d.png"));
  outputs.push(await clickDownload(page, "動線圖", "e310-routes.png"));
  outputs.push(await clickDownload(page, "地墊 / 座位圖", "e310-mats.png"));
  outputs.push(await clickDownload(page, "物資清單圖", "e310-inventory.png"));
  outputs.push(await clickDownload(page, "夥伴觀看圖", "e310-partner.png"));

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  for (const output of outputs) {
    const base64 = fs.readFileSync(output).toString("base64");
    await phone.setContent(`<!doctype html><style>html,body{margin:0;background:#0b1120}img{display:block;width:100%;height:auto}</style><img src="data:image/png;base64,${base64}">`);
    const stem = path.basename(output, ".png");
    await phone.screenshot({ path: path.join(PHONE_DIR, `${stem}-390px.png`), fullPage: true });
  }
  await browser.close();
  console.log(`Produced ${outputs.length} exports in ${EXPORT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
