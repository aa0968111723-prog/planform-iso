/**
 * 我的道具 — definitions saved on this device, reusable across projects.
 *
 * Same storage shape as templateLibrary: versioned index, one body per key,
 * defensive parse, memory fallback when storage is unavailable. A definition
 * is already portable — its parts are prop-local geometry, no world
 * coordinates — so unlike interaction templates nothing is stripped on save.
 *
 * §39's split lives here: the project's copy in `Project.props` is a frozen
 * snapshot; this library is the evolving original. `libraryIsNewer` is what
 * the 保留目前版本／更新到新版 choice is built on.
 */

import { migrateProps } from "../core/migrate";
import type { PropDefinition } from "../core/model";

const INDEX_KEY = "planform-iso:prop-library";
const BODY_PREFIX = "planform-iso:prop-library:";
const INDEX_VERSION = 1;

export interface PropLibraryMeta {
  id: string;
  name: string;
  icon?: string;
  savedAt: number;
  version: number;
  interactive: boolean;
}

interface PropIndex {
  version: number;
  entries: PropLibraryMeta[];
}

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return memory.get(key) ?? null;
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Full or blocked; the in-memory copy keeps this session working.
  }
}

function drop(key: string): void {
  memory.delete(key);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch {
    // Already gone from memory.
  }
}

function readIndex(): PropIndex {
  const raw = read(INDEX_KEY);
  if (!raw) return { version: INDEX_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<PropIndex>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return {
      version: INDEX_VERSION,
      entries: entries.filter((e): e is PropLibraryMeta =>
        !!e && typeof e.id === "string" && typeof e.name === "string"),
    };
  } catch {
    // A corrupt index must not take the saved bodies down with it.
    return { version: INDEX_VERSION, entries: [] };
  }
}

export function listLibraryProps(): PropLibraryMeta[] {
  return [...readIndex().entries].sort((a, b) => b.savedAt - a.savedAt);
}

export function saveLibraryProp(def: PropDefinition): PropLibraryMeta {
  const meta: PropLibraryMeta = {
    id: def.id,
    name: def.name,
    icon: def.icon,
    savedAt: Date.now(),
    version: def.version,
    interactive: !!def.interaction,
  };
  write(`${BODY_PREFIX}${def.id}`, JSON.stringify(def));
  const index = readIndex();
  write(INDEX_KEY, JSON.stringify({
    version: INDEX_VERSION,
    entries: [meta, ...index.entries.filter((e) => e.id !== meta.id)],
  }));
  return meta;
}

export function loadLibraryProp(id: string): PropDefinition | null {
  const raw = read(`${BODY_PREFIX}${id}`);
  if (!raw) return null;
  try {
    // Through the same defensive funnel a project body gets — a definition
    // saved by a build that knew one more part shape must still open here.
    const defs = migrateProps([JSON.parse(raw)]);
    return defs?.[0] ?? null;
  } catch {
    return null;
  }
}

export function deleteLibraryProp(id: string): void {
  drop(`${BODY_PREFIX}${id}`);
  const index = readIndex();
  write(INDEX_KEY, JSON.stringify({
    version: INDEX_VERSION,
    entries: index.entries.filter((e) => e.id !== id),
  }));
}

/** §39: is the library's copy newer than the project's snapshot? */
export function libraryIsNewer(projectDef: PropDefinition): boolean {
  const meta = readIndex().entries.find((e) => e.id === projectDef.id);
  return !!meta && meta.version > projectDef.version;
}
