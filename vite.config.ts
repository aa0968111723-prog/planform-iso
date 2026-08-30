import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // CI/PaaS builders may lack git or .git (e.g. Zeabur source builds) —
    // fall back to the env vars those platforms inject before giving up.
    const env =
      process.env.ZEABUR_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      process.env.SOURCE_COMMIT ??
      process.env.COMMIT_SHA;
    return env ? env.slice(0, 7) : "unknown";
  }
}

const APP_VERSION = pkg.version;
const COMMIT_SHA = gitSha();
const BUILD_TIME = new Date().toISOString();

/** Emit /version.json so a deployed client (and ops) can check the live build. */
function versionJson(): Plugin {
  return {
    name: "planform-version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(
          { version: APP_VERSION, commit: COMMIT_SHA, builtAt: BUILD_TIME },
          null,
          2,
        ),
      });
    },
  };
}

// Relative base keeps the production build working under a GitHub Pages
// project subpath (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __COMMIT_SHA__: JSON.stringify(COMMIT_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    versionJson(),
    VitePWA({
      // "prompt" + our update banner: a stale client is told a new version
      // exists instead of silently running old code until a manual refresh.
      registerType: "prompt",
      injectRegister: false,
      filename: "sw.js",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      workbox: {
        // The three.js chunk is large; without this it silently falls out of
        // the precache and the app stops working offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/version\.json$/],
        // version.json must always come from the network so update checks
        // and ops probes never see a cached value.
        globIgnores: ["version.json"],
      },
      manifest: {
        name: "PLANFORM｜活動空間彩排",
        short_name: "Planform",
        description: "活動開始前，把場地、3D 道具、人流與互動先排好、先彩排，再把清楚的場刊圖交給夥伴。",
        lang: "zh-Hant",
        theme_color: "#eef2f7",
        background_color: "#eef2f7",
        display: "standalone",
        orientation: "any",
        start_url: "./",
        scope: "./",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
