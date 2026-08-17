import type { Project } from "../core/model";

/**
 * Backend-free sharing: the whole plan is serialized into the URL hash so a
 * link fully reconstructs the plan on another device. No server involved.
 */

const HASH_PREFIX = "#p=";

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** URL-safe base64 (so the payload survives inside a URL hash). */
export function encodeProject(project: Project): string {
  return utf8ToBase64(JSON.stringify(project))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeProject(encoded: string): Partial<Project> | null {
  try {
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(base64ToUtf8(b64)) as Partial<Project>;
  } catch {
    return null;
  }
}

export function buildShareUrl(project: Project, base?: string): string {
  const origin = base ?? `${location.origin}${location.pathname}`;
  return `${origin}${HASH_PREFIX}${encodeProject(project)}`;
}

/** Extract a shared plan from the current URL hash, if present. */
export function readSharedFromHash(hash: string): Partial<Project> | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  return decodeProject(hash.slice(HASH_PREFIX.length));
}
