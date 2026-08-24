/**
 * The only module that knows how a project is persisted.
 *
 * It never imports `Store`, `App`, the DOM or IndexedDB. That is not tidiness:
 * `vitest` runs with `environment: "node"`, and the whole per-project storage
 * contract — one body per key, corruption confined to one project, an index
 * that survives another tab — is only testable if this file can be loaded
 * without a browser.
 *
 * Two rules run through everything below:
 *
 *   1. **The body is the source of truth; the index is a mirror.** Every
 *      `ProjectMeta` field is derived from a body, never authored here. A
 *      disagreement is always resolved in the body's favour, and a lost index
 *      is recoverable from the bodies on disk (`rebuildFromDisk`).
 *   2. **Nothing is destroyed to make something else work.** Unparseable bytes
 *      are quarantined, never dropped; an index entry is never removed because
 *      its body key is missing (that is exactly what a quarantined project
 *      looks like); a failed index write keeps its journal and retries.
 */

import { migrateProject } from "../core/migrate";
import { createDefaultProject, uid, type Project } from "../core/model";
import { venuePresetById } from "../core/venues";
import {
  ACTIVE_PROJECT_KEY,
  PROJECT_INDEX_BACKUP_KEY,
  PROJECT_INDEX_KEY,
  canEnumerate,
  listPlanformKeys,
  projectBackupKey,
  projectBodyKey,
  projectLayoutsBackupKey,
  projectLayoutsKey,
  quarantine,
  readRaw,
  removeRaw,
  safeStorage,
  writeRaw,
  type LayoutVariant,
  type ProjectMeta,
} from "./projectStorage";

export type ProjectLoad =
  | { ok: true; project: Project; meta: ProjectMeta }
  | { ok: false; reason: "missing" | "corrupt"; meta: ProjectMeta | null };

export interface CreateProjectOptions {
  project?: Project;
  /**
   * Optional. Falls back to the supplied body's own name, then to the default.
   * It NEVER defaults over a supplied name — `e2e/golden.spec.ts` asserts the
   * E310 sample keeps the name its builder gave it.
   */
  name?: string;
}

/**
 * Everything needed to put a deleted project back byte-for-byte.
 *
 * `backup` and `layoutsBackup` are as load-bearing as `body`: for a project
 * whose body would not parse, the quarantined bytes are the ONLY copy, and a
 * 復原 that silently dropped them would be a lie.
 */
export interface DeletedProject {
  meta: ProjectMeta;
  body: string | null;
  backup: string | null;
  layouts: string | null;
  layoutsBackup: string | null;
}

/**
 * Injected into `Store`, so `Store` keeps the 400 ms debounce and the
 * single-fire storage-error latch while never learning a storage key.
 *
 * `saveProject`, `writeLayout` and `deleteLayout` THROW on quota — that is how
 * `Store`'s existing try/catch still knows the truth about the open project.
 */
export interface StorePersistence {
  saveProject(project: Project): void;
  listLayouts(): string[];
  readLayout(name: string): Project | null;
  writeLayout(name: string, project: Project): void;
  deleteLayout(name: string): void;
}

/**
 * Installed whenever no project is open. Never pass `null` in production:
 * `null` makes `Store` fall back to the legacy global autosave key, which
 * would resurrect a just-deleted project there and overwrite the retained
 * cold backup at the same time.
 */
export const NULL_PERSISTENCE: StorePersistence = {
  saveProject() {},
  listLayouts() {
    return [];
  },
  readLayout() {
    return null;
  },
  writeLayout() {},
  deleteLayout() {},
};

/**
 * The sink for "a project is open but the library could not be reached at all"
 * — blocked or full storage at boot.
 *
 * It THROWS on every write, deliberately. `NULL_PERSISTENCE` would be the
 * silent-data-loss version of the same situation: the editor would look
 * completely healthy, every autosave would "succeed" into a no-op, and the
 * 自動儲存失敗 banner (with its 匯出 JSON escape hatch) would never appear.
 * Before the project library existed, a blocked `localStorage.setItem` threw
 * and the banner did appear; this keeps that promise.
 */
export const UNAVAILABLE_PERSISTENCE: StorePersistence = {
  saveProject() {
    throw new Error("storage unavailable");
  },
  listLayouts() {
    return [];
  },
  readLayout() {
    return null;
  },
  writeLayout() {
    throw new Error("storage unavailable");
  },
  deleteLayout() {
    throw new Error("storage unavailable");
  },
};

export const DEFAULT_PROJECT_NAME = "未命名平面圖";

/** How long the index may lag behind the bodies before a save forces a write. */
const INDEX_WRITE_INTERVAL_MS = 30_000;

/** Ids become part of a storage key, so they may not contain the separator. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function clone<T>(v: T): T {
  return structuredClone(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Every project id with bytes on disk, from `planform-iso:project:<id>[:…]`. */
function scanBodyIds(ls: Storage): Set<string> {
  const ids = new Set<string>();
  for (const key of listPlanformKeys(ls)) {
    const parts = key.split(":");
    if (parts.length >= 3 && parts[1] === "project" && parts[2]) ids.add(parts[2]);
  }
  return ids;
}

/**
 * Sort order for the library: most recently edited first.
 *
 * `createdAt` and then the id break ties, so the order is total and stable —
 * two projects created inside the same millisecond must not swap places
 * between two renders of the same screen. The id tiebreak runs DESCENDING
 * because `uid()` embeds a base-36 timestamp and an increasing counter, so a
 * larger id is the newer project.
 */
function byRecency(a: ProjectMeta, b: ProjectMeta): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

function coerceMeta(v: unknown): ProjectMeta | null {
  if (!isRecord(v)) return null;
  const id = v.id;
  if (typeof id !== "string" || !id) return null;
  const meta: ProjectMeta = {
    id,
    name: typeof v.name === "string" && v.name ? v.name : DEFAULT_PROJECT_NAME,
    createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
  };
  if (typeof v.venueName === "string" && v.venueName) meta.venueName = v.venueName;
  if (typeof v.participants === "number") meta.participants = v.participants;
  if (typeof v.eventDate === "string" && v.eventDate) meta.eventDate = v.eventDate;
  if (v.broken === true) meta.broken = true;
  return meta;
}

/**
 * The index entry for a body. Derived facts only — see rule 1 at the top.
 *
 * `venueName` prefers the preset's own name and falls back to whatever the
 * classroom is called, because `applyVenuePreset` copies the preset's area
 * name onto `classroom.name`; a project built by hand has only the latter.
 */
function deriveMeta(project: Project, times: { createdAt: number; updatedAt: number }): ProjectMeta {
  const scenarios = Array.isArray(project.scenarios) ? project.scenarios : [];
  const scenario = scenarios.find((s) => s.id === project.activeScenarioId) ?? scenarios[0];
  const preset = project.venuePresetId ? venuePresetById(project.venuePresetId) : null;
  const venueName = preset?.name ?? project.classroom?.name;
  const meta: ProjectMeta = {
    id: project.id,
    name: project.name || DEFAULT_PROJECT_NAME,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
  };
  if (venueName) meta.venueName = venueName;
  if (scenario && typeof scenario.participantCount === "number") meta.participants = scenario.participantCount;
  if (project.eventDate) meta.eventDate = project.eventDate;
  return meta;
}

export class ProjectRepository {
  /**
   * Metas touched this session that may not be on disk yet, and ids deleted
   * this session. Together they are the "journal" that `flushIndex()` merges
   * onto whatever the index currently holds — which is how a second tab's new
   * project survives this tab's next write.
   */
  private journal = new Map<string, ProjectMeta>();
  private deletedIds = new Set<string>();
  private dirty = false;
  private lastIndexWrite = 0;

  /**
   * Index and variant failures ONLY. A body failure must propagate to `Store`
   * so its single 自動儲存失敗 latch keeps tracking exactly one question: can
   * I persist the project that is open?
   */
  onError: ((op: "index" | "layout", id: string | null) => void) | null = null;

  // --- library -------------------------------------------------------------

  /** The library, most recently edited first. Reads the index from disk every call. */
  listProjects(): ProjectMeta[] {
    const byId = new Map<string, ProjectMeta>();
    for (const meta of this.readIndex()) byId.set(meta.id, meta);
    for (const [id, meta] of this.journal) byId.set(id, meta);
    for (const id of this.deletedIds) byId.delete(id);
    return [...byId.values()].sort(byRecency);
  }

  getMeta(id: string): ProjectMeta | null {
    if (this.deletedIds.has(id)) return null;
    const pending = this.journal.get(id);
    if (pending) return pending;
    return this.readIndex().find((m) => m.id === id) ?? null;
  }

  hasProjects(): boolean {
    return this.listProjects().length > 0;
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Mint a project and write its body.
   *
   * The id is re-keyed on any collision with existing bytes, and `project.id`
   * is always re-stamped before the write: an imported or duplicated body can
   * carry a foreign id, and a body whose `id` disagrees with the key it lives
   * under is how one project starts overwriting another.
   *
   * Throws only if the BODY write fails — a project that could not be stored
   * must not appear in the library.
   */
  createProject(opts: CreateProjectOptions = {}): ProjectMeta {
    const project = opts.project ? migrateProject(opts.project) : createDefaultProject();
    const name = (opts.name ?? "").trim() || (project.name ?? "").trim() || DEFAULT_PROJECT_NAME;

    let id = typeof project.id === "string" && SAFE_ID.test(project.id) ? project.id : uid("proj");
    while (this.idTaken(id)) id = uid("proj");

    project.id = id;
    project.name = name;

    writeRaw(projectBodyKey(id), JSON.stringify(project));

    const now = Date.now();
    const meta = deriveMeta(project, { createdAt: now, updatedAt: now });
    this.remember(meta);
    this.flushIndex();
    return meta;
  }

  /**
   * Load one project.
   *
   * A body that will not parse is quarantined and the card is flagged broken —
   * the failure is confined to this one project, and the raw bytes stay
   * downloadable via `corruptBody`. A body that is absent while its `:backup`
   * exists is also "corrupt": that is a project quarantined by an earlier run,
   * not a missing one.
   */
  openProject(id: string): ProjectLoad {
    const bodyKey = projectBodyKey(id);
    const raw = readRaw(bodyKey);
    const prev = this.getMeta(id);

    if (raw === null || raw === "") {
      if (readRaw(projectBackupKey(id)) !== null) {
        return { ok: false, reason: "corrupt", meta: this.markBroken(id, prev) };
      }
      return { ok: false, reason: "missing", meta: prev };
    }

    let project: Project;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("not an object");
      project = migrateProject(parsed as Partial<Project>);
    } catch {
      // Order matters: the bytes are parked BEFORE the index says so, so a
      // crash between the two leaves a recoverable body, not a phantom card.
      quarantine(bodyKey, projectBackupKey(id));
      return { ok: false, reason: "corrupt", meta: this.markBroken(id, prev) };
    }

    project.id = id;
    const now = Date.now();
    // Opening is not editing: `updatedAt` is carried over, never bumped.
    const meta = deriveMeta(project, {
      createdAt: prev?.createdAt ?? now,
      updatedAt: prev?.updatedAt ?? now,
    });
    if (!prev || prev.broken || JSON.stringify(prev) !== JSON.stringify(meta)) {
      this.remember(meta);
    }
    return { ok: true, project, meta };
  }

  /**
   * Persist an open project. The body write always happens and its throw is
   * allowed to propagate; the index catches up on its own schedule so a
   * successful index write can never report 已恢復 over an unwritten body.
   */
  saveProject(id: string, project: Project): void {
    project.id = id;
    writeRaw(projectBodyKey(id), JSON.stringify(project));

    const prev = this.getMeta(id);
    const now = Date.now();
    this.remember(deriveMeta(project, { createdAt: prev?.createdAt ?? now, updatedAt: now }));
    if (now - this.lastIndexWrite >= INDEX_WRITE_INTERVAL_MS) this.flushIndex();
  }

  /**
   * Rename a project that is NOT open, body first.
   *
   * `ProjectSession` handles the open one through the Store, because renaming
   * the index while the Store still holds the old name would let the next
   * autosave quietly rename it back.
   */
  renameProject(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;

    const raw = readRaw(projectBodyKey(id));
    if (raw === null || raw === "") return false;

    let project: Project;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) return false;
      project = migrateProject(parsed as Partial<Project>);
    } catch {
      return false;
    }

    project.id = id;
    project.name = trimmed;
    try {
      writeRaw(projectBodyKey(id), JSON.stringify(project));
    } catch {
      return false;
    }

    const prev = this.getMeta(id);
    const now = Date.now();
    this.remember(deriveMeta(project, { createdAt: prev?.createdAt ?? now, updatedAt: now }));
    this.flushIndex();
    return true;
  }

  /**
   * A whole second project: room, tiles, objects, routes, zones, scenarios and
   * the saved arrangements. Blob-backed custom assets are referenced by id and
   * are deliberately shared, not copied — see the deferred list.
   */
  duplicateProject(id: string, name?: string): ProjectMeta | null {
    const load = this.openProject(id);
    if (!load.ok) return null;

    const copy = clone(load.project);
    const meta = this.createProject({
      project: copy,
      name: (name ?? "").trim() || `${load.meta.name} 副本`,
    });

    const variants = this.readVariants(id);
    if (Object.keys(variants).length > 0) {
      try {
        writeRaw(projectLayoutsKey(meta.id), JSON.stringify(variants));
      } catch {
        // The project itself copied fine; only its saved arrangements did not.
        this.onError?.("layout", meta.id);
      }
    }
    return meta;
  }

  /**
   * Remove a project and hand back everything needed to undo that.
   *
   * Every byte is captured BEFORE anything is removed, including the two
   * quarantine keys — for a broken project those are the only copy left.
   */
  deleteProject(id: string): DeletedProject | null {
    const meta = this.getMeta(id);
    if (!meta) return null;

    const tomb: DeletedProject = {
      meta,
      body: readRaw(projectBodyKey(id)),
      backup: readRaw(projectBackupKey(id)),
      layouts: readRaw(projectLayoutsKey(id)),
      layoutsBackup: readRaw(projectLayoutsBackupKey(id)),
    };

    removeRaw(projectBodyKey(id));
    removeRaw(projectBackupKey(id));
    removeRaw(projectLayoutsKey(id));
    removeRaw(projectLayoutsBackupKey(id));

    this.journal.delete(id);
    this.deletedIds.add(id);
    this.dirty = true;
    this.flushIndex();
    return tomb;
  }

  /** Put a tombstone back exactly as it was. */
  restoreProject(tomb: DeletedProject): boolean {
    const { id } = tomb.meta;
    try {
      if (tomb.body !== null) writeRaw(projectBodyKey(id), tomb.body);
      if (tomb.backup !== null) writeRaw(projectBackupKey(id), tomb.backup);
      if (tomb.layouts !== null) writeRaw(projectLayoutsKey(id), tomb.layouts);
      if (tomb.layoutsBackup !== null) writeRaw(projectLayoutsBackupKey(id), tomb.layoutsBackup);
    } catch {
      return false;
    }
    this.deletedIds.delete(id);
    this.remember(tomb.meta);
    this.flushIndex();
    return true;
  }

  /**
   * Add back any project whose body is on disk but absent from the index.
   *
   * Called once per app load, never on a render path. Two things put a project
   * in that state, and neither is theoretical: an index write that failed on a
   * full disk while the body write succeeded, and two tabs flushing the index
   * at the same moment (both read, both merge, the slower write wins and the
   * faster tab's new entry is gone). The body is still there in both cases, so
   * the next boot can simply put the entry back.
   *
   * @returns how many entries were recovered.
   */
  reconcile(): number {
    const ls = safeStorage();
    if (!ls || !canEnumerate(ls)) return 0;

    const known = new Set(this.listProjects().map((m) => m.id));
    const now = Date.now();
    let added = 0;
    for (const id of scanBodyIds(ls)) {
      if (known.has(id) || this.deletedIds.has(id)) continue;
      const meta = this.metaFromDisk(id, now);
      if (!meta) continue;
      this.remember(meta);
      added += 1;
    }
    if (added > 0) this.flushIndex();
    return added;
  }

  /**
   * Index a project whose body could not be read, with no body key at all.
   * Used by the legacy migration, which must never drop bytes it cannot parse.
   */
  indexBroken(meta: ProjectMeta): ProjectMeta {
    const broken: ProjectMeta = { ...meta, broken: true };
    this.remember(broken);
    this.flushIndex();
    return broken;
  }

  // --- active pointer ------------------------------------------------------

  getActiveProjectId(): string | null {
    const raw = readRaw(ACTIVE_PROJECT_KEY);
    return raw && raw.length > 0 ? raw : null;
  }

  setActiveProjectId(id: string | null): void {
    if (!id) {
      removeRaw(ACTIVE_PROJECT_KEY);
      return;
    }
    try {
      writeRaw(ACTIVE_PROJECT_KEY, id);
    } catch {
      // Harmless on its own: the next boot falls back to the most recently
      // edited project instead of this one. Not worth a banner.
    }
  }

  // --- 場佈版本 (arrangements saved inside one project) ----------------------

  listLayouts(projectId: string): string[] {
    return Object.keys(this.readVariants(projectId)).sort();
  }

  /**
   * A variant is not a project: it is stored without `id` or `name`, and both
   * are re-stamped from the parent on the way out. That is what stops a loaded
   * arrangement from carrying a stale id into another project's key.
   */
  readLayout(projectId: string, name: string): Project | null {
    const variant = this.readVariants(projectId)[name];
    if (!variant || !isRecord(variant.body)) return null;
    try {
      const project = migrateProject(variant.body as Partial<Project>);
      project.id = projectId;
      project.name = this.getMeta(projectId)?.name ?? project.name;
      return project;
    } catch {
      return null;
    }
  }

  writeLayout(projectId: string, name: string, project: Project): void {
    const variants = this.readVariants(projectId);
    const body = clone(project) as unknown as Record<string, unknown>;
    delete body.id;
    delete body.name;
    variants[name] = { name, savedAt: Date.now(), body };
    writeRaw(projectLayoutsKey(projectId), JSON.stringify(variants));
  }

  deleteLayout(projectId: string, name: string): void {
    const variants = this.readVariants(projectId);
    if (!(name in variants)) return;
    delete variants[name];
    writeRaw(projectLayoutsKey(projectId), JSON.stringify(variants));
  }

  // --- corruption escape hatches -------------------------------------------

  /**
   * Raw bytes for a project that failed to parse.
   *
   * Prefer the quarantine backup. When the backup write itself failed (quota
   * full), `quarantine` intentionally left the only copy in the primary body
   * key — fall back to that. Only return primary bytes when they truly do not
   * parse as a healthy project, so 「下載這份的原始資料」 never hands out a
   * working plan under a recovery label.
   */
  corruptBody(id: string): string | null {
    const backup = readRaw(projectBackupKey(id));
    if (backup !== null && backup !== "") return backup;

    const primary = readRaw(projectBodyKey(id));
    if (primary === null || primary === "") return null;

    try {
      const parsed: unknown = JSON.parse(primary);
      if (!isRecord(parsed)) return primary;
      migrateProject(parsed as Partial<Project>);
      // Healthy project sitting in the primary key — not recovery material.
      return null;
    } catch {
      return primary;
    }
  }

  corruptLayouts(projectId: string): string | null {
    return readRaw(projectLayoutsBackupKey(projectId));
  }

  corruptIndex(): string | null {
    return readRaw(PROJECT_INDEX_BACKUP_KEY);
  }

  // --- plumbing ------------------------------------------------------------

  /**
   * Merge this session's journal onto whatever the index holds RIGHT NOW and
   * write it back. Never serializes a cached array: another tab may have added
   * a project since the last read, and overwriting it would be the multi-tab
   * version of the bug this whole change exists to fix.
   *
   * A failed write keeps the journal and stays dirty, so the next flush
   * retries rather than leaving a truncated index behind.
   */
  flushIndex(): void {
    if (!this.dirty) return;

    const byId = new Map<string, ProjectMeta>();
    for (const meta of this.readIndex()) byId.set(meta.id, meta);
    for (const [id, meta] of this.journal) byId.set(id, meta);
    for (const id of this.deletedIds) byId.delete(id);

    const next = [...byId.values()].sort(byRecency);
    try {
      writeRaw(PROJECT_INDEX_KEY, JSON.stringify(next));
    } catch {
      this.onError?.("index", null);
      return;
    }
    this.journal.clear();
    this.deletedIds.clear();
    this.dirty = false;
    this.lastIndexWrite = Date.now();
  }

  /** The persistence sink for one project, handed to `Store.setPersistence`. */
  persistenceFor(id: string): StorePersistence {
    return {
      saveProject: (project) => this.saveProject(id, project),
      listLayouts: () => this.listLayouts(id),
      readLayout: (name) => this.readLayout(id, name),
      writeLayout: (name, project) => this.writeLayout(id, name, project),
      deleteLayout: (name) => this.deleteLayout(id, name),
    };
  }

  // --- internals -----------------------------------------------------------

  private remember(meta: ProjectMeta): void {
    this.journal.set(meta.id, meta);
    this.deletedIds.delete(meta.id);
    this.dirty = true;
  }

  private idTaken(id: string): boolean {
    if (this.deletedIds.has(id)) return false;
    if (this.journal.has(id)) return true;
    if (readRaw(projectBodyKey(id)) !== null) return true;
    if (readRaw(projectBackupKey(id)) !== null) return true;
    return this.readIndex().some((m) => m.id === id);
  }

  private markBroken(id: string, prev: ProjectMeta | null): ProjectMeta {
    const now = Date.now();
    const meta: ProjectMeta = {
      ...(prev ?? { id, name: DEFAULT_PROJECT_NAME, createdAt: now, updatedAt: now }),
      id,
      broken: true,
    };
    this.remember(meta);
    this.flushIndex();
    return meta;
  }

  /**
   * The index as it is on disk, self-healed if it is unreadable or empty.
   *
   * A parse failure quarantines the raw bytes and yields an empty list rather
   * than throwing; the recovery scan then ADDS back whatever bodies are on
   * disk. It never subtracts — an entry with no body is a quarantined project,
   * and dropping it would orphan the only copy of its bytes.
   */
  private readIndex(): ProjectMeta[] {
    const raw = readRaw(PROJECT_INDEX_KEY);
    let parsed: unknown = null;
    if (raw !== null && raw !== "") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        quarantine(PROJECT_INDEX_KEY, PROJECT_INDEX_BACKUP_KEY);
        this.onError?.("index", null);
      }
    }

    const metas: ProjectMeta[] = [];
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const meta = coerceMeta(entry);
        if (meta) metas.push(meta);
      }
    }
    if (metas.length > 0) return metas;
    return this.rebuildFromDisk();
  }

  /**
   * Rebuild the library by walking storage. Only ever reached when the index
   * yielded nothing, and only where the Storage really supports enumeration —
   * the unit-test stub does not, and `Object.keys()` on it would happily
   * "find" projects named `getItem`.
   */
  private rebuildFromDisk(): ProjectMeta[] {
    const ls = safeStorage();
    if (!ls || !canEnumerate(ls)) return [];

    const now = Date.now();
    const out: ProjectMeta[] = [];
    for (const id of scanBodyIds(ls)) {
      if (this.deletedIds.has(id)) continue;
      const meta = this.metaFromDisk(id, now);
      if (meta) out.push(meta);
    }
    return out;
  }

  /**
   * One project's meta, read straight from its body key. A body that will not
   * parse becomes a broken card; the bytes stay exactly where they are,
   * because this is a read and a read must not quarantine anything.
   */
  private metaFromDisk(id: string, now: number): ProjectMeta | null {
    const raw = readRaw(projectBodyKey(id));
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed)) {
          const project = migrateProject(parsed as Partial<Project>);
          project.id = id;
          // The real timestamps died with the index. "Now" keeps recovered
          // projects at the top of 我的專案, which is where someone looking
          // for them will look first.
          return deriveMeta(project, { createdAt: now, updatedAt: now });
        }
      } catch {
        /* falls through to the broken card below */
      }
    }
    if (raw || readRaw(projectBackupKey(id)) !== null) {
      return { id, name: "需要復原的專案", createdAt: now, updatedAt: now, broken: true };
    }
    return null;
  }

  /**
   * The variants map for one project. The single reader, so there is no code
   * path that turns a parse failure into `{}` and then writes that back over
   * the user's saved arrangements.
   */
  private readVariants(projectId: string): Record<string, LayoutVariant> {
    const key = projectLayoutsKey(projectId);
    const raw = readRaw(key);
    if (raw === null || raw === "") return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      quarantine(key, projectLayoutsBackupKey(projectId));
      this.onError?.("layout", projectId);
      return {};
    }
    if (!isRecord(parsed)) {
      quarantine(key, projectLayoutsBackupKey(projectId));
      this.onError?.("layout", projectId);
      return {};
    }

    const out: Record<string, LayoutVariant> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      if (isRecord(value.body)) {
        out[name] = {
          name: typeof value.name === "string" ? value.name : name,
          savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
          body: value.body,
        };
      } else if (typeof value.version === "number") {
        // A bare project blob, from a hand-edited or hand-migrated key.
        out[name] = { name, savedAt: 0, body: value };
      }
    }
    return out;
  }
}
