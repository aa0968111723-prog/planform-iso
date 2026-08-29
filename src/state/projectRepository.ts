/**
 * Project library — the multi-project layer that sits *outside* the Store.
 *
 * The Store stays exactly what it was: the one plan currently being edited,
 * with its own history and autosave. This module owns everything about having
 * *many* plans: their identities, their metadata, and which one is open.
 *
 * Storage shape (localStorage; see the audit in the PR — the heaviest real
 * plan, the 60-person E310 golden scenario, is 8.5 KB, so a hundred projects
 * sit under a megabyte and IndexedDB would be needless machinery):
 *
 *   planform-iso:projects:index    → { version, entries: ProjectMeta[] }
 *   planform-iso:projects:<id>     → Project body
 *   planform-iso:active-project    → project id
 *
 * One key per body is what makes autosave isolation real rather than
 * promised: saving 「9/24 社課」 physically cannot rewrite 「期初茶會」.
 *
 * Legacy keys (`planform-iso:autosave`, `planform-iso:layouts`) are read for
 * migration and then **left alone**. Nothing a user already had is deleted.
 */

import { createDefaultProject, type Project } from "../core/model";
import { migrateProject } from "../core/migrate";

const INDEX_KEY = "planform-iso:projects:index";
const BODY_PREFIX = "planform-iso:projects:";
const ACTIVE_KEY = "planform-iso:active-project";
const CORRUPT_PREFIX = "planform-iso:corrupt:";

/** Legacy single-project autosave, migrated on first run and then preserved. */
export const LEGACY_AUTOSAVE_KEY = "planform-iso:autosave";
export const LEGACY_LAYOUTS_KEY = "planform-iso:layouts";
/** Marks that the one-time legacy import already ran, so it never repeats. */
const MIGRATED_KEY = "planform-iso:projects:migrated";

const INDEX_VERSION = 1;

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  venuePresetId?: string;
  /** Display name of the venue, denormalised so cards render without a body read. */
  venueName?: string;
  /** Optional event date, "YYYY-MM-DD". */
  eventDate?: string;
  participants?: number;
  /** Optional tiny preview (data URL). Absent is fine — cards fall back to a glyph. */
  thumbnail?: string;
}

interface ProjectIndex {
  version: number;
  entries: ProjectMeta[];
}

export interface CreateProjectInput {
  name: string;
  project: Project;
  venuePresetId?: string;
  venueName?: string;
  eventDate?: string;
  participants?: number;
}

/** Result of opening a project: either a body, or an explanation. */
export type OpenResult =
  | { ok: true; project: Project; meta: ProjectMeta }
  | { ok: false; reason: "missing" | "corrupt"; meta: ProjectMeta | null };

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Private mode / blocked storage. The app still runs, just in memory.
    return null;
  }
}

function bodyKey(id: string): string {
  return `${BODY_PREFIX}${id}`;
}

let seq = 0;
/**
 * Two tabs creating a project in the same millisecond would both be at seq 1,
 * so the id carries a random tail as well as the counter. A collision would
 * silently overwrite someone's plan, which is exactly what this feature exists
 * to prevent.
 */
function newProjectId(now: number): string {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `prj_${now.toString(36)}_${seq.toString(36)}_${rand}`;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function readIndex(): ProjectIndex {
  const s = storage();
  if (!s) return { version: INDEX_VERSION, entries: [] };
  let raw: string | null;
  try {
    raw = s.getItem(INDEX_KEY);
  } catch {
    return { version: INDEX_VERSION, entries: [] };
  }
  if (!raw) return { version: INDEX_VERSION, entries: [] };
  try {
    const parsed = JSON.parse(raw) as ProjectIndex;
    if (!parsed || !Array.isArray(parsed.entries)) throw new Error("shape");
    // Drop entries that are not usable as cards rather than throwing the whole
    // library away — one bad row must not hide every other project.
    const entries = parsed.entries.filter(
      (e): e is ProjectMeta => !!e && typeof e.id === "string" && typeof e.name === "string",
    );
    return { version: parsed.version ?? INDEX_VERSION, entries };
  } catch {
    // A corrupt index would otherwise mean "you have no projects". Recover the
    // library by scanning for body keys instead.
    return { version: INDEX_VERSION, entries: recoverIndexFromBodies() };
  }
}

/** Last-resort rebuild: every stored body becomes a card again. */
function recoverIndexFromBodies(): ProjectMeta[] {
  const s = storage();
  if (!s) return [];
  const out: ProjectMeta[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key || !key.startsWith(BODY_PREFIX)) continue;
      const id = key.slice(BODY_PREFIX.length);
      if (!id || id === "index" || id === "migrated") continue;
      let name = "復原的專案";
      try {
        const body = JSON.parse(s.getItem(key) ?? "") as Project;
        if (body && typeof body.name === "string" && body.name) name = body.name;
      } catch {
        name = "需要復原的專案";
      }
      out.push({ id, name, createdAt: 0, updatedAt: 0 });
    }
  } catch {
    /* fall through with whatever was collected */
  }
  return out;
}

function writeIndex(index: ProjectIndex): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

/**
 * Card metadata: explicit input wins, otherwise derive it from the plan so the
 * caller never has to state the head count twice. Undefined input keys must
 * fall through to the derived value rather than overwrite it, so this builds
 * the object key by key instead of spreading `input` over the derived fields.
 */
function metaFrom(project: Project, input: Partial<ProjectMeta>): Partial<ProjectMeta> {
  const scenario = project.activeScenarioId
    ? project.scenarios.find((sc) => sc.id === project.activeScenarioId)
    : project.scenarios[0];
  const out: Partial<ProjectMeta> = {
    venuePresetId: input.venuePresetId ?? project.venuePresetId,
    participants: input.participants ?? scenario?.participantCount,
  };
  if (input.venueName !== undefined) out.venueName = input.venueName;
  if (input.eventDate !== undefined) out.eventDate = input.eventDate;
  if (input.thumbnail !== undefined) out.thumbnail = input.thumbnail;
  return out;
}

/**
 * The multi-project library. All methods are safe to call when storage is
 * unavailable — they degrade to "no projects" rather than throwing.
 */
export const ProjectRepository = {
  /** Every project, most recently updated first. */
  listProjects(): ProjectMeta[] {
    return [...readIndex().entries].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getRecentProjects(limit = 6): ProjectMeta[] {
    return ProjectRepository.listProjects().slice(0, Math.max(0, limit));
  },

  getMeta(id: string): ProjectMeta | null {
    return readIndex().entries.find((e) => e.id === id) ?? null;
  },

  count(): number {
    return readIndex().entries.length;
  },

  /**
   * Create a brand new project. This never touches any existing project —
   * it is the whole point of the feature.
   */
  createProject(input: CreateProjectInput, now = Date.now()): ProjectMeta {
    const id = newProjectId(now);
    const body = migrateProject(clone(input.project));
    body.name = input.name || body.name || "未命名專案";
    const meta: ProjectMeta = {
      id,
      name: body.name,
      createdAt: now,
      updatedAt: now,
      ...metaFrom(body, {
        venuePresetId: input.venuePresetId,
        venueName: input.venueName,
        eventDate: input.eventDate,
        participants: input.participants,
      }),
    };
    // Body first: if the body write fails, no card is created pointing at
    // nothing.
    if (!writeBody(id, body)) throw new StorageFullError();
    const index = readIndex();
    index.entries.push(meta);
    writeIndex(index);
    return meta;
  },

  /** Read a project body. Never throws — a bad body is reported, not fatal. */
  openProject(id: string): OpenResult {
    const meta = ProjectRepository.getMeta(id);
    const s = storage();
    if (!s) return { ok: false, reason: "missing", meta };
    let raw: string | null;
    try {
      raw = s.getItem(bodyKey(id));
    } catch {
      return { ok: false, reason: "missing", meta };
    }
    if (raw === null) return { ok: false, reason: "missing", meta };
    try {
      const project = migrateProject(JSON.parse(raw) as Project);
      return { ok: true, project, meta: meta ?? synthesiseMeta(id, project) };
    } catch {
      // Keep the raw blob so the user can still get their data out, and leave
      // the card in the library flagged as needing recovery.
      try {
        s.setItem(`${CORRUPT_PREFIX}${id}`, raw);
      } catch {
        /* best effort */
      }
      return { ok: false, reason: "corrupt", meta };
    }
  },

  /** Raw bytes kept from a body that failed to parse, if any. */
  corruptBody(id: string): string | null {
    const s = storage();
    if (!s) return null;
    try {
      return s.getItem(`${CORRUPT_PREFIX}${id}`);
    } catch {
      return null;
    }
  },

  /**
   * Persist a project body and refresh its card.
   * Always overwrites (tests and first bind). Use `trySaveProject` when a
   * stale tab must not clobber a newer revision.
   */
  saveProject(id: string, project: Project, now = Date.now()): boolean {
    const existing = peekBody(id);
    const existingRev = typeof existing?.revision === "number" ? existing.revision : 0;
    project.revision = existingRev + 1;
    if (!writeBody(id, project)) return false;
    const index = readIndex();
    const entry = index.entries.find((e) => e.id === id);
    if (entry) {
      entry.updatedAt = now;
      entry.name = project.name || entry.name;
      const derived = metaFrom(project, {});
      // A venue swap must not leave the card advertising the old venue: the
      // denormalised display name is dropped so the card falls back to looking
      // the preset up by its (now current) id.
      if (derived.venuePresetId !== entry.venuePresetId) {
        entry.venueName = undefined;
        entry.venuePresetId = derived.venuePresetId;
      }
      if (derived.participants !== undefined) entry.participants = derived.participants;
    } else {
      index.entries.push({ ...synthesiseMeta(id, project), createdAt: now, updatedAt: now });
    }
    writeIndex(index);
    return true;
  },

  /**
   * Same as saveProject, but refuse a silent overwrite when the disk copy is
   * newer than the in-memory revision (another tab already wrote).
   */
  trySaveProject(id: string, project: Project, now = Date.now()):
    | { ok: true }
    | { ok: false; reason: "storage" }
    | { ok: false; reason: "conflict"; remote: Project } {
    const existing = peekBody(id);
    const remoteRev = typeof existing?.revision === "number" ? existing.revision : 0;
    const localRev = typeof project.revision === "number" ? project.revision : 0;
    if (existing && remoteRev > localRev) {
      return { ok: false, reason: "conflict", remote: existing };
    }
    if (!ProjectRepository.saveProject(id, project, now)) {
      return { ok: false, reason: "storage" };
    }
    return { ok: true };
  },

  renameProject(id: string, name: string, now = Date.now()): ProjectMeta | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const index = readIndex();
    const entry = index.entries.find((e) => e.id === id);
    if (!entry) return null;
    entry.name = trimmed;
    entry.updatedAt = now;
    writeIndex(index);
    // Keep the body's own name in step so exports and 場刊 titles match.
    const opened = ProjectRepository.openProject(id);
    if (opened.ok) {
      opened.project.name = trimmed;
      writeBody(id, opened.project);
    }
    return { ...entry };
  },

  setEventDate(id: string, eventDate: string | undefined, now = Date.now()): ProjectMeta | null {
    const index = readIndex();
    const entry = index.entries.find((e) => e.id === id);
    if (!entry) return null;
    entry.eventDate = eventDate || undefined;
    entry.updatedAt = now;
    writeIndex(index);
    return { ...entry };
  },

  setThumbnail(id: string, thumbnail: string | undefined): void {
    const index = readIndex();
    const entry = index.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.thumbnail = thumbnail;
    writeIndex(index);
  },

  /**
   * Copy a whole project — the club reuses last week's 社課 layout every week,
   * so this is the most-used button after 新建.
   */
  duplicateProject(id: string, name?: string, now = Date.now()): ProjectMeta | null {
    const opened = ProjectRepository.openProject(id);
    if (!opened.ok) return null;
    const source = ProjectRepository.getMeta(id);
    const copyName = (name ?? `${opened.project.name} 複本`).trim() || "未命名專案";
    return ProjectRepository.createProject({
      name: copyName,
      project: opened.project,
      venuePresetId: source?.venuePresetId,
      venueName: source?.venueName,
      eventDate: source?.eventDate,
      participants: source?.participants,
    }, now);
  },

  /**
   * Remove a project. Returns a snapshot so the caller can offer an undo —
   * a mis-tapped delete on a phone must not be final.
   */
  deleteProject(id: string): { meta: ProjectMeta; body: string | null } | null {
    const index = readIndex();
    const at = index.entries.findIndex((e) => e.id === id);
    if (at < 0) return null;
    const [meta] = index.entries.splice(at, 1);
    const s = storage();
    let body: string | null = null;
    try {
      body = s?.getItem(bodyKey(id)) ?? null;
      s?.removeItem(bodyKey(id));
    } catch {
      /* the card is gone either way */
    }
    writeIndex(index);
    if (ProjectRepository.getActiveProjectId() === id) ProjectRepository.setActiveProjectId(null);
    return { meta, body };
  },

  /** Put back a project removed by deleteProject. */
  restoreProject(snapshot: { meta: ProjectMeta; body: string | null }): boolean {
    const s = storage();
    if (!s || snapshot.body === null) return false;
    try {
      s.setItem(bodyKey(snapshot.meta.id), snapshot.body);
    } catch {
      return false;
    }
    const index = readIndex();
    if (!index.entries.some((e) => e.id === snapshot.meta.id)) index.entries.push(snapshot.meta);
    writeIndex(index);
    return true;
  },

  // --- active project ----------------------------------------------------

  getActiveProjectId(): string | null {
    const s = storage();
    if (!s) return null;
    try {
      const id = s.getItem(ACTIVE_KEY);
      if (!id) return null;
      // An active id pointing at a deleted project must not strand the app.
      return ProjectRepository.getMeta(id) ? id : null;
    } catch {
      return null;
    }
  },

  setActiveProjectId(id: string | null): void {
    const s = storage();
    if (!s) return;
    try {
      if (id) s.setItem(ACTIVE_KEY, id);
      else s.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
  },

  // --- migration ---------------------------------------------------------

  /**
   * One-time import of the pre-multi-project world.
   *
   * The old app kept a single `planform-iso:autosave`. On first run of the new
   * library that plan becomes a real project so nobody opens the app to an
   * empty list and thinks their work is gone. The legacy keys are **read, not
   * removed** — if anything here is wrong the old data is still on disk.
   */
  migrateLegacyIfNeeded(now = Date.now()): ProjectMeta | null {
    const s = storage();
    if (!s) return null;
    try {
      if (s.getItem(MIGRATED_KEY)) return null;
    } catch {
      return null;
    }
    // Only import into an empty library; never on top of real projects.
    if (readIndex().entries.length > 0) {
      markMigrated();
      return null;
    }
    let raw: string | null;
    try {
      raw = s.getItem(LEGACY_AUTOSAVE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) {
      markMigrated();
      return null;
    }
    let project: Project;
    try {
      project = migrateProject(JSON.parse(raw) as Project);
    } catch {
      // Corrupt legacy blob: leave it exactly where it is for recovery and
      // start the library empty rather than importing garbage.
      markMigrated();
      return null;
    }
    const name = project.name && project.name !== "未命名平面圖" ? project.name : "我的舊場佈";
    try {
      const meta = ProjectRepository.createProject({ name, project }, now);
      markMigrated();
      return meta;
    } catch {
      // Storage full — do not mark migrated, so it can be retried after the
      // user frees space. The legacy key is untouched.
      return null;
    }
  },

  /** True once the legacy import has run (or been determined unnecessary). */
  hasMigrated(): boolean {
    const s = storage();
    if (!s) return false;
    try {
      return !!s.getItem(MIGRATED_KEY);
    } catch {
      return false;
    }
  },

  /** Convenience for a first-run install with nothing to migrate. */
  createBlankProject(name = "未命名專案", now = Date.now()): ProjectMeta {
    return ProjectRepository.createProject({ name, project: createDefaultProject() }, now);
  },

  /** Test seam. Removes every key this module owns; legacy keys are kept. */
  _resetForTests(): void {
    const s = storage();
    if (!s) return;
    const doomed: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key) continue;
      if (key.startsWith(BODY_PREFIX) || key.startsWith(CORRUPT_PREFIX) || key === ACTIVE_KEY) {
        doomed.push(key);
      }
    }
    for (const key of doomed) s.removeItem(key);
  },
};

export class StorageFullError extends Error {
  constructor() {
    super("storage-full");
    this.name = "StorageFullError";
  }
}

function markMigrated(): void {
  try {
    storage()?.setItem(MIGRATED_KEY, "1");
  } catch {
    /* ignore */
  }
}

function peekBody(id: string): Project | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(bodyKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

function writeBody(id: string, project: Project): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(bodyKey(id), JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

function synthesiseMeta(id: string, project: Project): ProjectMeta {
  return {
    id,
    name: project.name || "未命名專案",
    createdAt: 0,
    updatedAt: 0,
    venuePresetId: project.venuePresetId,
  };
}

export const PROJECT_STORAGE_KEYS = {
  index: INDEX_KEY,
  bodyPrefix: BODY_PREFIX,
  active: ACTIVE_KEY,
  migrated: MIGRATED_KEY,
} as const;
