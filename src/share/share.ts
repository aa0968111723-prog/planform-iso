import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { Project } from "../core/model";

/**
 * Backend-free sharing: the whole plan is serialized and compressed into the
 * URL hash so a link fully reconstructs the plan on another device — no server
 * involved. Compression keeps links short enough for a QR code in most plans.
 */

const HASH_PREFIX = "#p=";

/** Compress a project into a URL-safe payload. */
export function encodeProject(project: Project): string {
  return compressToEncodedURIComponent(JSON.stringify(project));
}

export function decodeProject(encoded: string): Partial<Project> | null {
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return JSON.parse(json) as Partial<Project>;
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
