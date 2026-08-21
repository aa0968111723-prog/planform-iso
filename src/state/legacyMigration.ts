/**
 * One-time promotion of the pre-library storage into the project library.
 *
 * Before this change the app had exactly one autosave slot plus a map of named
 * layouts — and `quickStart.ts` offered those layouts as 「已存的平面圖（直接
 * 載入整份場佈）」, i.e. whole-plan loads. Under the new vocabulary each of
 * those IS a project, so each becomes one. That is what makes 「舊資料不能不見」
 * and 「排法不是專案」 true at the same time.
 *
 * Three properties matter more than tidiness here:
 *
 *   - **Never throws.** It runs before the UI exists; a throw is a white screen.
 *   - **Resumable, not just idempotent.** Progress is rewritten after every
 *     single promotion, so a run that dies on item 3 of 8 resumes at item 4
 *     instead of freezing the remaining five out of the library forever.
 *   - **Deletes nothing.** The legacy keys stay on disk as a cold backup for a
 *     full release. At ten typical projects that is under 180 KiB of a measured
 *     5 MiB budget — a price worth paying to be able to say "nothing was lost"
 *     and mean it.
 */

import { migrateProject } from "../core/migrate";
import { uid, type Project } from "../core/model";
import type { ProjectRepository } from "./projectRepository";
import {
  LEGACY_AUTOSAVE_BACKUP_KEY,
  LEGACY_AUTOSAVE_KEY,
  LEGACY_LAYOUTS_BACKUP_KEY,
  LEGACY_LAYOUTS_KEY,
  MIGRATION_KEY,
  projectBackupKey,
  quarantine,
  readRaw,
  removeRaw,
  writeRaw,
} from "./projectStorage";

export interface MigrationProgress {
  v: 1;
  done: boolean;
  autosave: "pending" | "promoted" | "quarantined" | "absent";
  autosaveId?: string;
  /** Layout names already promoted. This is what makes a resumed run exact. */
  layouts: string[];
}

export interface LegacyMigrationResult {
  created: number;
  quarantined: number;
  activeId: string | null;
  skipped: boolean;
}

const LEGACY_AUTOSAVE_NAME = "我的舊場佈";
const LEGACY_BROKEN_NAME = "我的舊場佈（需要復原）";

function freshProgress(): MigrationProgress {
  return { v: 1, done: false, autosave: "pending", layouts: [] };
}

function readProgress(): MigrationProgress | null {
  const raw = readRaw(MIGRATION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Partial<MigrationProgress>;
    return {
      v: 1,
      done: p.done === true,
      autosave:
        p.autosave === "promoted" || p.autosave === "quarantined" || p.autosave === "absent"
          ? p.autosave
          : "pending",
      autosaveId: typeof p.autosaveId === "string" ? p.autosaveId : undefined,
      layouts: Array.isArray(p.layouts) ? p.layouts.filter((n): n is string => typeof n === "string") : [],
    };
  } catch {
    return null;
  }
}

function persist(progress: MigrationProgress): void {
  try {
    writeRaw(MIGRATION_KEY, JSON.stringify(progress));
  } catch {
    // A lost progress record costs a repeated scan next boot, which the exact
    // de-dupe below already tolerates. It must never abort the migration.
  }
}

/**
 * A body reduced to something comparable.
 *
 * Keys are emitted in sorted order at every depth, because two documents that
 * are semantically identical can still serialize with different key order, and
 * `id` is dropped because it differs by construction.
 */
function canonicalBody(project: Project): string {
  const seen = new WeakSet<object>();
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      if (seen.has(value as object)) return null;
      seen.add(value as object);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        if (key === "id") continue;
        out[key] = walk((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  const { id: _dropped, ...rest } = project;
  void _dropped;
  return JSON.stringify(walk(rest));
}

/**
 * Promote the legacy keys into projects. Safe to call on every boot.
 */
export function runLegacyMigration(repo: ProjectRepository): LegacyMigrationResult {
  const result: LegacyMigrationResult = { created: 0, quarantined: 0, activeId: null, skipped: false };

  try {
    let progress = readProgress();
    if (progress?.done === true) {
      result.skipped = true;
      return result;
    }

    /**
     * No progress record but a non-empty library means either an earlier build
     * already migrated (and cleared the flag) or the state was hand-edited.
     * Skipping would freeze half a library out; instead we compare each
     * candidate against the bodies already on disk. At most a handful of parses
     * in a rare branch. Worst case we create nothing — never drop anything.
     */
    let existing: string[] | null = null;
    if (progress === null) {
      progress = freshProgress();
      const metas = repo.listProjects();
      if (metas.length > 0) {
        existing = [];
        for (const meta of metas) {
          const load = repo.openProject(meta.id);
          if (load.ok) existing.push(canonicalBody(load.project));
        }
      }
    }

    const alreadyThere = (candidate: Project): boolean =>
      existing !== null && existing.includes(canonicalBody(candidate));

    // --- step 1: the global autosave -------------------------------------
    let firstId: string | null = progress.autosaveId ?? null;
    let firstCanonical: string | null = null;

    if (progress.autosave === "pending") {
      const raw = readRaw(LEGACY_AUTOSAVE_KEY);
      if (raw === null || raw === "") {
        progress.autosave = "absent";
      } else {
        let project: Project | null = null;
        try {
          const parsed: unknown = JSON.parse(raw);
          project = parsed && typeof parsed === "object" ? migrateProject(parsed as Partial<Project>) : null;
        } catch {
          project = null;
        }

        if (project) {
          project.name = (project.name ?? "").trim() || LEGACY_AUTOSAVE_NAME;
          if (alreadyThere(project)) {
            progress.autosave = "promoted";
          } else {
            const meta = repo.createProject({ project, name: project.name });
            firstId = meta.id;
            firstCanonical = canonicalBody(project);
            progress.autosave = "promoted";
            progress.autosaveId = meta.id;
            result.created += 1;
          }
        } else {
          // Unparseable. Do NOT drop it: mint an id, park the raw bytes where
          // 下載這份的原始資料 can reach them, and index a broken card.
          const id = uid("proj");
          try {
            writeRaw(projectBackupKey(id), raw);
            const now = Date.now();
            repo.indexBroken({ id, name: LEGACY_BROKEN_NAME, createdAt: now, updatedAt: now, broken: true });
            progress.autosave = "quarantined";
            result.quarantined += 1;
          } catch {
            // Could not park the bytes. Leave the legacy key untouched and
            // stay "pending" so the next boot tries again.
          }
        }
      }
      persist(progress);
    }

    if (firstId && firstCanonical === null) {
      const load = repo.openProject(firstId);
      if (load.ok) firstCanonical = canonicalBody(load.project);
    }

    // --- step 2: every named layout --------------------------------------
    let lastCreatedId: string | null = null;
    const layoutsRaw = readRaw(LEGACY_LAYOUTS_KEY);
    let promotedAll = true;

    if (layoutsRaw !== null && layoutsRaw !== "") {
      let parsed: unknown = null;
      let readable = true;
      try {
        parsed = JSON.parse(layoutsRaw);
      } catch {
        // A bad layouts blob must not undo step 1's result.
        quarantine(LEGACY_LAYOUTS_KEY, LEGACY_LAYOUTS_BACKUP_KEY);
        result.quarantined += 1;
        readable = false;
      }

      if (readable && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = parsed as Record<string, unknown>;
        for (const name of Object.keys(entries).sort()) {
          if (progress.layouts.includes(name)) continue;

          const body = entries[name];
          if (!body || typeof body !== "object") {
            progress.layouts.push(name);
            persist(progress);
            continue;
          }

          let project: Project;
          try {
            project = migrateProject(body as Partial<Project>);
          } catch {
            progress.layouts.push(name);
            persist(progress);
            continue;
          }
          project.name = name;

          /**
           * De-dupe on EXACT body equality only.
           *
           * The tempting name+counts heuristic is unsound here and destroys
           * data: `saveNamedLayout` wrote the name onto both the stored layout
           * and the live project, so the autosave and the last-saved layout
           * always share a name and all four counts, and typically differ only
           * in where the objects sit. A spurious duplicate costs 16 KiB of a
           * 5 MiB budget; a dropped project costs everything.
           */
          const canonical = canonicalBody(project);
          if ((firstCanonical !== null && canonical === firstCanonical) || alreadyThere(project)) {
            progress.layouts.push(name);
            persist(progress);
            continue;
          }

          try {
            const meta = repo.createProject({ project, name });
            lastCreatedId = meta.id;
            result.created += 1;
          } catch {
            // Out of room (or storage went away). Stop here with everything so
            // far recorded, so the next boot picks up at exactly this name.
            promotedAll = false;
            break;
          }
          progress.layouts.push(name);
          persist(progress);
        }
      }
    }

    // --- step 3: the active pointer --------------------------------------
    const chosen = firstId ?? lastCreatedId;
    const current = repo.getActiveProjectId();
    if (chosen && (!current || !repo.getMeta(current))) {
      // The legacy autosave was literally "the plan you had open", so it wins.
      repo.setActiveProjectId(chosen);
    }
    result.activeId = repo.getActiveProjectId();

    // --- steps 4 & 5: stamp ----------------------------------------------
    // A zero-entry run still stamps done: an empty index is what makes boot
    // take the genuine first-run path, byte-for-byte today's behaviour.
    progress.done = promotedAll && progress.autosave !== "pending";
    persist(progress);
    return result;
  } catch {
    // Never let a migration failure reach the boot path.
    return result;
  }
}

/**
 * 更多 → 清除舊版存檔. Ships wired to nothing: the retained cold backup is the
 * literal implementation of 「舊資料不能不見」 and is meant to survive one full
 * release before anyone is offered a button that removes it.
 *
 * `planform-iso:autosave-backup` is NEVER removed. It is not legacy data — it
 * is the app's designated last-resort copy of a plan that failed to parse, and
 * no code path has ever cleared it.
 */
export function clearLegacyKeys(): { cleared: boolean; reason?: string } {
  const progress = readProgress();
  if (!progress || !progress.done) {
    return { cleared: false, reason: "遷移尚未完成" };
  }

  const raw = readRaw(LEGACY_LAYOUTS_KEY);
  if (raw !== null && raw !== "") {
    let names: string[];
    try {
      const parsed: unknown = JSON.parse(raw);
      names = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
    } catch {
      return { cleared: false, reason: "舊的排法資料無法讀取" };
    }
    for (const name of names) {
      if (!progress.layouts.includes(name)) {
        return { cleared: false, reason: `「${name}」還沒搬到「我的專案」` };
      }
    }
  }

  removeRaw(LEGACY_AUTOSAVE_KEY);
  removeRaw(LEGACY_LAYOUTS_KEY);
  return { cleared: true };
}

/** Exposed for the migration's own tests; not part of the runtime surface. */
export const __testing = { canonicalBody, readProgress, LEGACY_AUTOSAVE_BACKUP_KEY };
