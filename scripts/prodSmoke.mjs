/**
 * Production smoke test against a built preview server (default :4173).
 *
 *   node scripts/prodSmoke.mjs [baseUrl]
 *
 * Verifies, on the REAL production bundle (no dev-only hooks):
 *   phone: quick start wizard → 建立場佈 → editor; service worker ready;
 *          OFFLINE reload still boots; /version.json is live
 *   tablet: partner mode via More sheet
 *   desktop: all six 場刊圖 exports actually download
 * and saves screenshots + export PNGs into _smoke/ for the release PR.
 */

import { chromium, devices } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.argv[2] ?? "http://localhost:4173";
const OUT = fileURLToPath(new URL("../_smoke/", import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).version;
mkdirSync(OUT, { recursive: true });

const results = [];
function ok(name, pass, note = "") {
  results.push({ name, pass, note });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${note ? ` — ${note}` : ""}`);
}

async function completeWizard(page, participants) {
  await page.locator(".quickstart__card button", { hasText: "淡江教室模板" }).click();
  await page.locator('.quickstart__card input[type="number"]').fill(String(participants));
  await page.locator(".quickstart__card button", { hasText: "建立場佈" }).click();
  await page.waitForTimeout(600);
}

const browser = await chromium.launch({
  // Same escape hatch playwright.config.ts and exportPlans.cjs already offer:
  // CI boxes keep a preinstalled browser that may not match this project's
  // pinned Playwright build.
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

// ---------- phone ----------
{
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector("#app[data-ws-mode]");
  const mode = await page.getAttribute("#app", "data-ws-mode");
  ok("phone workspace mode", mode === "phone", `data-ws-mode=${mode}`);

  const wizard = page.locator(".quickstart__title");
  await wizard.waitFor({ timeout: 5000 });
  ok("first-run quick start shows", (await wizard.innerText()) === "今天要排什麼？");
  await page.screenshot({ path: `${OUT}phone-quickstart.png` });

  await completeWizard(page, 30);
  ok("wizard creates a plan", await page.evaluate(() => !!document.querySelector("#scene")));
  await page.screenshot({ path: `${OUT}phone-editor.png` });

  // Service worker + offline boot.
  const swReady = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  ok("service worker active", swReady);
  const version = await page.evaluate(async () => (await (await fetch("version.json", { cache: "no-store" })).json()).version);
  ok("/version.json live", version === PKG_VERSION, `version=${version} (package ${PKG_VERSION})`);

  await page.waitForTimeout(800); // let precache settle
  await ctx.setOffline(true);
  await page.reload();
  try {
    await page.waitForSelector("#app[data-ws-mode]", { timeout: 8000 });
    ok("offline reload boots (SW precache)", true);
    // Autosaved plan is still there offline.
    const hasCanvas = await page.evaluate(() => !!document.querySelector("#scene"));
    ok("offline shows project", hasCanvas);
    await page.screenshot({ path: `${OUT}phone-offline.png` });
  } catch {
    ok("offline reload boots (SW precache)", false);
  }
  await ctx.setOffline(false);
  await ctx.close();
}

// ---------- tablet: partner mode ----------
{
  const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector("#app[data-ws-mode]");
  await page.locator(".quickstart__title").waitFor();
  await completeWizard(page, 40);
  await page.screenshot({ path: `${OUT}tablet-editor.png` });
  await page.locator(".topbar__more").click();
  await page.locator(".menusheet button", { hasText: "夥伴模式" }).click();
  await page.waitForTimeout(800);
  const partner = await page.evaluate(() => document.getElementById("app")?.classList.contains("partner"));
  ok("tablet partner mode", !!partner);
  await page.screenshot({ path: `${OUT}tablet-partner.png` });
  await page.locator(".partnertop .partnerroles button", { hasText: "報到組" }).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}tablet-partner-checkin.png` });
  await ctx.close();
}

// ---------- desktop: six exports ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, acceptDownloads: true, baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector("#app[data-ws-mode]");
  await page.locator(".quickstart__title").waitFor();
  await completeWizard(page, 30);
  await page.locator(".topbar .chip", { hasText: "分享" }).first().click();
  const buttons = ["場佈總覽圖", "3D 場佈圖", "動線圖", "地墊 / 座位圖", "工作分區圖", "物資清單圖", "夥伴觀看圖"];
  for (const label of buttons) {
    const dl = page.waitForEvent("download", { timeout: 15000 });
    await page.locator(".left button", { hasText: label }).first().click();
    try {
      const d = await dl;
      const file = `${OUT}export-${label.replace(/[ /]/g, "")}.png`;
      await d.saveAs(file);
      ok(`export ${label}`, true, d.suggestedFilename());
    } catch {
      ok(`export ${label}`, false);
    }
  }
  await page.screenshot({ path: `${OUT}desktop-share.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
