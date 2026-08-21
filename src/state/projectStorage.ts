/**
 * Every localStorage key this app owns, and the guarded primitives that touch
 * them. Nothing else in `src/`, `e2e/` or `scripts/` may spell a key literal.
 *
 * That rule exists because the old single-autosave key was re-typed in four
 * places, so "which keys does Planform own?" could only be answered by grep.
 * With a project library there are now key *families* (one body per project),
 * and a stray literal is how a body gets orphaned into permanent invisibility.
 *
 * Pure and node-safe on purpose: no DOM, no IndexedDB, no imports from the
 * store or the app. `vitest` runs `environment: "node"`, and the existing
 * `test/storeRecovery.test.ts` stub is a four-method object — see `canEnumerate`.
 */

/**
 * What the project index holds for one project.
 *
 * Only facts DERIVED from the body, never facts authored here. The body is the
 * single source of truth; the index is a cache that exists so Project Home can
 * render the library without parsing a single project — which is the entire
 * defence against one corrupt file white-screening the whole app.
 */
export interface ProjectMeta {
  id: string;
  /** Mirror of `Project.name`. The body wins on any disagreement. */
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Derived: venue preset name, else the classroom's own name. */
  venueName?: string;
  /** Derived: the active scenario's participant count. */
  participants?: number;
  /** Derived: `Project.eventDate`. */
  eventDate?: string;
  /** The body would not parse; its raw bytes are in the `:backup` key. */
  broken?: boolean;
}

/**
 * A saved arrangement WITHIN a project — 場佈版本, not another project.
 *
 * Stored without `id` or `name` on purpose: those belong to the parent project,
 * and freezing them into a variant is exactly how a "layout" starts behaving
 * like a second project. They are re-stamped from the parent on read.
 */
export interface LayoutVariant {
  name: string;
  savedAt: number;
  body: Record<string, unknown>;
}

export const PROJECT_KEY_PREFIX = "planform-iso:";

export const PROJECT_INDEX_KEY = "planform-iso:projects:index";
export const PROJECT_INDEX_BACKUP_KEY = "planform-iso:projects:index:backup";
export const ACTIVE_PROJECT_KEY = "planform-iso:active";
export const MIGRATION_KEY = "planform-iso:projects:migration";
export const BOOT_OVERRIDE_KEY = "planform-iso:boot";

/**
 * Pre-library keys. Read once by the migration, then never written again — but
 * deliberately NOT deleted for one release: they are the only copy of a plan
 * made before this change, and a user who downgrades or hits a migration bug
 * must still have their work sitting there.
 */
export const LEGACY_AUTOSAVE_KEY = "planform-iso:autosave";
export const LEGACY_AUTOSAVE_BACKUP_KEY = "planform-iso:autosave-backup";
export const LEGACY_LAYOUTS_KEY = "planform-iso:layouts";
export const LEGACY_LAYOUTS_BACKUP_KEY = "planform-iso:layouts-backup";

export function projectBodyKey(id: string): string {
  return `planform-iso:project:${id}`;
}

export function projectBackupKey(id: string): string {
  return `planform-iso:project:${id}:backup`;
}

export function projectLayoutsKey(id: string): string {
  return `planform-iso:project:${id}:layouts`;
}

export function projectLayoutsBackupKey(id: string): string {
  return `planform-iso:project:${id}:layouts:backup`;
}

/**
 * localStorage, or null where it is blocked (private mode, embedded webviews,
 * a browser setting). Mirrors the shape venues.ts already relies on: the app
 * has always kept working without storage, and a project library must not be
 * the thing that finally makes it throw on boot.
 */
export function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readRaw(key: string): string | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    return ls.getItem(key);
  } catch {
    return null;
  }
}

/**
 * THROWS on quota or a blocked store. Deliberately the one primitive that does:
 * a silent write failure is how "I saved it" becomes "it was never there", and
 * the callers above this all have a real story for a failed write (surface the
 * banner, keep the tombstone, abandon the migration step and retry next boot).
 */
export function writeRaw(key: string, value: string): void {
  const ls = safeStorage();
  if (!ls) throw new Error("storage unavailable");
  ls.setItem(key, value);
}

export function removeRaw(key: string): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.removeItem(key);
  } catch {
    /* nothing useful to do; the caller's state is already consistent */
  }
}

/**
 * Move unreadable bytes out of the way without ever destroying them.
 *
 * The ordering is a contract, not an implementation detail — it is the only
 * thing standing between a corrupt 16 KiB body and a full disk:
 *
 *   1. Nothing there → touch nothing at all.
 *   2. A backup already exists → drop the primary but KEEP the older backup.
 *      A newer corruption must never overwrite the copy that might still be
 *      recoverable.
 *   3. The backup write throws (quota) → leave the primary exactly where it is.
 *      A full disk must not be able to delete the user's only copy.
 *   4. Only a successful backup write earns the right to remove the primary.
 *
 * @returns the raw bytes that were quarantined, or null when there were none.
 */
export function quarantine(primaryKey: string, backupKey: string): string | null {
  const raw = readRaw(primaryKey);
  if (!raw) return null;

  const existing = readRaw(backupKey);
  if (existing) {
    removeRaw(primaryKey);
    return raw;
  }

  try {
    writeRaw(backupKey, raw);
  } catch {
    return raw;
  }
  removeRaw(primaryKey);
  return raw;
}

/**
 * Whether this Storage can actually be walked.
 *
 * `test/storeRecovery.test.ts` installs a four-method stub — getItem, setItem,
 * removeItem, clear — with no `length` and no `key()`. `Object.keys()` on it
 * returns method NAMES, so any enumeration-based lookup would quietly "find"
 * projects called `getItem`. Every enumeration below is gated on this, and no
 * happy path enumerates at all: the index is the directory.
 */
export function canEnumerate(ls: Storage): boolean {
  return typeof ls.key === "function" && typeof ls.length === "number";
}

/** Every `planform-iso:` key present. `[]` when the store cannot be walked. */
export function listPlanformKeys(ls: Storage): string[] {
  if (!canEnumerate(ls)) return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (key && key.startsWith(PROJECT_KEY_PREFIX)) out.push(key);
    }
  } catch {
    return out;
  }
  return out;
}

/** Raw bytes a pre-library build quarantined from a corrupt global autosave. */
export function readLegacyCorruptBackup(): string | null {
  return readRaw(LEGACY_AUTOSAVE_BACKUP_KEY);
}
