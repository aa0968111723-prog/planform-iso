/** Build metadata injected by vite.config.ts `define`. */

declare const __APP_VERSION__: string;
declare const __COMMIT_SHA__: string;
declare const __BUILD_TIME__: string;

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

export const BUILD_INFO: BuildInfo = {
  version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
  commit: typeof __COMMIT_SHA__ !== "undefined" ? __COMMIT_SHA__ : "local",
  builtAt: typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "",
};
