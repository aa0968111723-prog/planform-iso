import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "dev-dist", "node_modules", "_grok_round*", "_lead", "_lead_wpc", "_smoke", "test-results"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "vite.config.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["test/**/*.ts", "e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Node utility scripts drive a real browser, so both worlds apply.
    files: ["scripts/**/*.{mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
