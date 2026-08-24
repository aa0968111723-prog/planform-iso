/**
 * The runtime glue between the project library and the running editor.
 *
 * `ProjectRepository` owns bytes; `Store` owns the open document. This owns
 * the two things neither of them can: *which* project is open, and the exact
 * order in which a switch happens. That order is the whole point — get it
 * wrong and the last 400 ms of project A silently lands in project B, or
 * vanishes with no error anywhere.
 */

import {
  createDefaultProject,
  type AreaConfig,
  type Calibration,
  type LayerVisibility,
  type Project,
  type TileConfig,
  type ValidationSettings,
} from "../core/model";
import { migrateProject } from "../core/migrate";
import type { Store } from "./store";
import {
  DEFAULT_PROJECT_NAME,
  NULL_PERSISTENCE,
  ProjectRepository,
  UNAVAILABLE_PERSISTENCE,
  type DeletedProject,
} from "./projectRepository";
import { runLegacyMigration } from "./legacyMigration";
import { BOOT_OVERRIDE_KEY, readRaw, type ProjectMeta } from "./projectStorage";

export type Screen = "home" | "editor";

export interface ToastUndo {
  label: string;
  onSelect(): void;
}

/** `interactive: false` at boot, so the view is restored rather than re-framed. */
export interface OpenContext {
  interactive: boolean;
}

export interface BootstrapResult {
  screen: Screen;
  recovered: boolean;
  migrated: number;
}

export interface CreateOptions {
  project?: Project;
  name?: string;
  open?: boolean;
  /**
   * Fill the pristine project that boot created, instead of minting a second
   * one. Only the first-run wizard passes this; without it, completing the
   * wizard on a fresh install leaves a ghost 未命名平面圖 card behind forever.
   */
  adoptPristineActive?: boolean;
}

/**
 * How many deleted projects stay undoable at once.
 *
 * A tombstone holds the project's raw bytes, so this is a memory budget, not a
 * storage one — the whole point of deleting is to free storage. Ten covers
 * "I just cleared out last term's projects and want two of them back"; past
 * that the oldest stops being recoverable, which the copy never promises.
 */
const MAX_TOMBSTONES = 10;

export class ProjectSession {
  private screenValue: Screen = "editor";
  private activeIdValue: string | null = null;
  /**
   * Deleted projects, oldest first. A single slot would be actively
   * destructive: deleting A and then B — an entirely ordinary "clean up two
   * old projects" — would drop A's only surviving copy on the floor, with A's
   * keys already removed from disk and no error anywhere.
   */
  private tombstones: DeletedProject[] = [];

  /**
   * The id boot minted on a genuinely empty first run — the ONLY project the
   * wizard may fill in place. Targeting "any empty project" instead would mean
   * that pressing ＋新建專案 from an empty project quietly refuses to create
   * one, which is the exact bug this whole change exists to remove.
   */
  private pristineBootId: string | null = null;

  onProjectOpened: ((project: Project, ctx: OpenContext) => void) | null = null;
  onScreenChange: ((screen: Screen) => void) | null = null;
  onLibraryChange: (() => void) | null = null;
  onToast: ((message: string, undo?: ToastUndo) => void) | null = null;

  constructor(
    private readonly store: Store,
    readonly repo: ProjectRepository = new ProjectRepository(),
  ) {
    // Never leave the Store on its legacy fallback while a session exists: a
    // stray flush would write a default project straight over the retained
    // pre-library autosave, which is someone's only copy of their old plan.
    this.store.setPersistence(NULL_PERSISTENCE);
  }

  get screen(): Screen {
    return this.screenValue;
  }

  get activeId(): string | null {
    return this.activeIdValue;
  }

  get activeMeta(): ProjectMeta | null {
    return this.activeIdValue ? this.repo.getMeta(this.activeIdValue) : null;
  }

  listProjects(): ProjectMeta[] {
    return this.repo.listProjects();
  }

  /** Raw recovery bytes for one broken project; the Home screen owns delivery. */
  corruptBody(id: string): string | null {
    return this.repo.corruptBody(id);
  }

  // --- boot ----------------------------------------------------------------

  /**
   * Legacy migration, then the first screen, then a hydrated Store. Call
   * before `new UI`.
   *
   * Never throws. Blocked or full storage is tolerated end to end today and
   * has to stay that way: on any failure this installs the no-op sink and
   * returns the editor, so the 自動儲存失敗 banner and its 匯出 JSON escape
   * hatch still reach the user instead of a white screen.
   */
  bootstrap(): BootstrapResult {
    try {
      const migration = runLegacyMigration(this.repo);
      let recovered = migration.quarantined > 0;
      // Once per load: put back any project whose body is on disk but whose
      // index entry was lost to a failed write or a concurrent tab.
      this.repo.reconcile();
      const metas = this.repo.listProjects();

      if (metas.length === 0) {
        const meta = this.repo.createProject({ name: DEFAULT_PROJECT_NAME });
        this.hydrate(meta.id, { interactive: false });
        this.pristineBootId = meta.id;
        this.screenValue = "editor";
        return { screen: "editor", recovered, migrated: migration.created };
      }

      const stored = this.repo.getActiveProjectId();
      const preferred = stored && this.repo.getMeta(stored) ? stored : metas[0].id;

      let opened = this.hydrate(preferred, { interactive: false });
      if (!opened) recovered = true;

      const override = readRaw(BOOT_OVERRIDE_KEY);
      let screen: Screen = override === "editor" ? "editor" : "home";

      if (!opened && screen === "editor") {
        // Only the explicit editor override tries the next project: landing on
        // Home is a better answer to "this one is broken" than silently
        // opening someone else's plan.
        for (const meta of metas) {
          if (meta.id === preferred) continue;
          if (this.hydrate(meta.id, { interactive: false })) {
            opened = true;
            break;
          }
        }
      }
      if (!opened) screen = "home";

      this.screenValue = screen;
      return { screen, recovered, migrated: migration.created };
    } catch {
      // The library could not be reached at all (blocked or full storage).
      // UNAVAILABLE_PERSISTENCE, not NULL: the editor stays usable, but every
      // autosave throws, so the 自動儲存失敗 banner and its 匯出 JSON escape
      // hatch fire exactly once instead of the app pretending it saved.
      this.store.setPersistence(UNAVAILABLE_PERSISTENCE);
      this.activeIdValue = null;
      this.screenValue = "editor";
      return { screen: "editor", recovered: false, migrated: 0 };
    }
  }

  // --- opening -------------------------------------------------------------

  openProject(id: string): boolean {
    if (id === this.activeIdValue) {
      // 繼續編輯: already hydrated, with its undo history intact.
      this.setScreen("editor");
      return true;
    }
    if (!this.hydrate(id, { interactive: true })) {
      this.onToast?.("這份專案需要復原，請先下載原始資料");
      this.onLibraryChange?.();
      return false;
    }
    this.setScreen("editor");
    this.onLibraryChange?.();
    return true;
  }

  /**
   * The switch, in the only order that keeps both projects intact.
   *
   * Step 1 is the load-bearing one. `flushAutosave` cancels the pending 400 ms
   * timer and writes the OLD project through the OLD sink. Without it the
   * stale timer fires later, reads the Store — which by then holds the NEW
   * project — and writes it through the NEW sink: harmless-looking, and the
   * old project's last edits are simply gone.
   */
  private hydrate(id: string, ctx: OpenContext): boolean {
    this.flush();

    const load = this.repo.openProject(id);
    if (!load.ok) {
      this.store.setPersistence(NULL_PERSISTENCE);
      this.activeIdValue = null;
      this.repo.setActiveProjectId(null);
      return false;
    }

    // Before the load, never after: the `scheduleAutosave()` inside
    // `loadProject` must already be pointing at the new project's key.
    this.store.setPersistence(this.repo.persistenceFor(id));
    this.activeIdValue = id;
    this.pristineBootId = this.pristineBootId === id ? this.pristineBootId : null;
    this.repo.setActiveProjectId(id);

    // `undoBeforeLoad: false` clears the undo stack, which is what makes this a
    // clean switch: undo must not be able to resurrect project A's state and
    // autosave it into project B's key.
    this.store.loadProject(load.project, { undoBeforeLoad: false });
    this.onProjectOpened?.(this.store.getState(), ctx);
    return true;
  }

  // --- lifecycle -----------------------------------------------------------

  createProject(opts: CreateOptions = {}): ProjectMeta {
    if (opts.adoptPristineActive && this.canAdoptPristine()) {
      const id = this.activeIdValue!;
      const project = opts.project ? migrateProject(opts.project) : createDefaultProject();
      project.id = id;
      project.name = (opts.name ?? "").trim() || (project.name ?? "").trim() || DEFAULT_PROJECT_NAME;

      this.store.loadProject(project, { undoBeforeLoad: false });
      this.store.flushAutosave();
      this.repo.flushIndex();
      this.pristineBootId = null;

      const meta = this.repo.getMeta(id) ?? {
        id,
        name: project.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (opts.open !== false) {
        this.setScreen("editor");
        this.onProjectOpened?.(this.store.getState(), { interactive: true });
      }
      this.onLibraryChange?.();
      return meta;
    }

    const meta = this.repo.createProject({ project: opts.project, name: opts.name });
    this.pristineBootId = null;
    if (opts.open !== false) {
      this.hydrate(meta.id, { interactive: true });
      this.setScreen("editor");
    }
    this.onLibraryChange?.();
    return meta;
  }

  /**
   * Whether the wizard may fill the open project instead of minting one.
   *
   * Deliberately does NOT check `updatedAt === createdAt`: boot's own
   * `loadProject` schedules an autosave that bumps `updatedAt` about 400 ms
   * later, long before anyone finishes the wizard, so a timestamp test would
   * always fail and always leave the ghost card behind.
   */
  private canAdoptPristine(): boolean {
    if (!this.activeIdValue || this.activeIdValue !== this.pristineBootId) return false;
    return !planHasContent(this.store.getState());
  }

  goHome(): void {
    this.flush();
    this.setScreen("home");
  }

  /**
   * The body is the single source of truth for the name, so the rename IS a
   * body write. Renaming only the index would let the open project's next
   * autosave quietly put the old name back.
   */
  renameProject(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;

    if (id === this.activeIdValue) {
      this.store.mutate((p) => {
        p.name = trimmed;
      }, { history: false });
      this.store.flushAutosave();
    } else if (!this.repo.renameProject(id, trimmed)) {
      this.onToast?.("重新命名失敗，這份專案可能需要復原");
      return false;
    }
    this.repo.flushIndex();
    this.onLibraryChange?.();
    return true;
  }

  duplicateProject(id: string): ProjectMeta | null {
    if (id === this.activeIdValue) this.flush();
    const meta = this.repo.duplicateProject(id);
    if (!meta) {
      this.onToast?.("複製失敗，這份專案可能需要復原");
      return null;
    }
    this.onLibraryChange?.();
    this.onToast?.(`已複製為「${meta.name}」`);
    return meta;
  }

  /**
   * Deleting the OPEN project cannot white-screen: the no-op sink goes in, the
   * active pointer is cleared, and Home renders from the index alone.
   */
  deleteProject(id: string): boolean {
    this.flush();
    const tomb = this.repo.deleteProject(id);
    if (!tomb) return false;

    this.tombstones.push(tomb);
    if (this.tombstones.length > MAX_TOMBSTONES) this.tombstones.shift();
    if (id === this.activeIdValue) {
      this.store.setPersistence(NULL_PERSISTENCE);
      this.activeIdValue = null;
      this.pristineBootId = null;
      this.repo.setActiveProjectId(null);
      this.setScreen("home");
    }
    this.repo.flushIndex();
    this.onLibraryChange?.();
    this.onToast?.(`已刪除「${tomb.meta.name}」`, {
      label: "復原",
      // Captures THIS delete's id, so a second delete before the toast expires
      // still undoes the one the chip belongs to.
      onSelect: () => void this.undoDelete(id),
    });
    return true;
  }

  /** Undo a delete. Without an id, the most recent one. */
  undoDelete(id?: string): boolean {
    const at = id
      ? this.tombstones.findIndex((t) => t.meta.id === id)
      : this.tombstones.length - 1;
    if (at < 0) return false;

    const tomb = this.tombstones[at];
    if (!this.repo.restoreProject(tomb)) {
      this.onToast?.("復原失敗，儲存空間可能已滿");
      return false;
    }
    this.tombstones.splice(at, 1);
    this.onLibraryChange?.();
    this.onToast?.(`已復原「${tomb.meta.name}」`);
    return true;
  }

  // --- 場佈版本 -------------------------------------------------------------

  listLayouts(): string[] {
    return this.activeIdValue ? this.repo.listLayouts(this.activeIdValue) : [];
  }

  saveLayout(name: string): boolean {
    if (!this.activeIdValue) return false;
    return this.store.saveNamedLayout(name);
  }

  /**
   * Loading another arrangement keeps the current one first, under an
   * auto-generated name. This is the last place in the app where something
   * on screen was replaced with no way back.
   */
  applyLayout(name: string): boolean {
    const id = this.activeIdValue;
    if (!id) return false;

    const current = this.store.getState();
    if (planHasContent(current)) {
      try {
        // A minute-granular name would let a second 載入 inside the same minute
        // overwrite this auto-keep with an arrangement that is ALREADY saved
        // under its own name — and the arrangement it replaced was never
        // written anywhere else.
        this.repo.writeLayout(id, uniqueAutoKeepName(this.repo.listLayouts(id)), current);
      } catch {
        this.onToast?.("目前的排法沒能先存起來，已取消載入");
        return false;
      }
    }
    return this.store.loadNamedLayout(name);
  }

  deleteLayout(name: string): boolean {
    if (!this.activeIdValue) return false;
    return this.store.deleteNamedLayout(name);
  }

  // --- plumbing ------------------------------------------------------------

  /** Every exit point calls this: pagehide, tab hidden, 立即更新, goHome, switch, delete. */
  flush(): void {
    this.store.flushAutosave();
    this.repo.flushIndex();
    if (this.activeIdValue) this.repo.setActiveProjectId(this.activeIdValue);
  }

  setScreen(screen: Screen): void {
    if (this.screenValue === screen) {
      this.onScreenChange?.(screen);
      return;
    }
    this.screenValue = screen;
    this.onScreenChange?.(screen);
  }
}

/**
 * Does this plan hold anything the user would miss if we replaced it?
 *
 * Semantic comparison against a pristine `createDefaultProject()`, covering
 * every user-editable field — not just the furniture arrays. Room dimensions,
 * tile calibration, description, layers, custom catalog, validation settings,
 * venue identity and event date all count: someone who spent ten minutes
 * measuring the classroom before placing a single chair has real work here.
 *
 * Identity (`id`) and pure camera `view` are ignored — ambient, not work.
 *
 * One predicate, two callers (`canAdoptPristine` / `applyLayout`), on purpose.
 * The four-array version of this test is exactly the unsound check that the
 * deleted `confirmReplace()` used to wipe plans with — it must not grow back.
 */
export function planHasContent(p: Project): boolean {
  const d = createDefaultProject();

  if (p.zones.length > 0) return true;
  if (p.objects.length > 0) return true;
  if (p.groups.length > 0) return true;
  if (p.routes.length > 0) return true;
  if (p.measurements.length > 0) return true;
  if ((p.scenarios?.length ?? 0) > 0) return true;
  if ((p.catalogExtras?.length ?? 0) > 0) return true;

  if ((p.description ?? "").trim() !== "") return true;
  if (p.venuePresetId) return true;
  if (p.eventDate) return true;
  if (p.activeScenarioId) return true;

  // Anything other than the blank default name is a deliberate user decision.
  const name = (p.name ?? "").trim();
  if (name && name !== DEFAULT_PROJECT_NAME && name !== d.name) return true;

  if (!areaConfigEqual(p.classroom, d.classroom)) return true;
  if (!areaConfigEqual(p.corridor, d.corridor)) return true;
  if (!tileConfigEqual(p.tile, d.tile)) return true;
  if (!calibrationEqual(p.calibration, d.calibration)) return true;
  if (!layersEqual(p.layers, d.layers)) return true;
  if (!validationEqual(p.validationSettings, d.validationSettings)) return true;

  return false;
}

function areaConfigEqual(a: AreaConfig, b: AreaConfig): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.length === b.length &&
    a.width === b.width &&
    a.x === b.x &&
    a.z === b.z
  );
}

function tileConfigEqual(a: TileConfig, b: TileConfig): boolean {
  return (
    a.width === b.width &&
    a.depth === b.depth &&
    a.originX === b.originX &&
    a.originZ === b.originZ &&
    a.rotationDeg === b.rotationDeg &&
    a.visible === b.visible
  );
}

function calibrationEqual(a: Calibration, b: Calibration): boolean {
  return (
    a.referenceLength === b.referenceLength &&
    (a.note ?? "") === (b.note ?? "") &&
    !!a.confirmed?.tile === !!b.confirmed?.tile &&
    !!a.confirmed?.door === !!b.confirmed?.door &&
    !!a.confirmed?.room === !!b.confirmed?.room
  );
}

function layersEqual(a: LayerVisibility, b: LayerVisibility): boolean {
  return (
    a.areas === b.areas &&
    a.zones === b.zones &&
    a.objects === b.objects &&
    a.tiles === b.tiles &&
    a.routes === b.routes
  );
}

function validationEqual(a: ValidationSettings, b: ValidationSettings): boolean {
  return (
    a.minAisleWidth === b.minAisleWidth &&
    a.doorFrontClearance === b.doorFrontClearance &&
    a.matWallClearance === b.matWallClearance &&
    a.checkScreenView === b.checkScreenView &&
    a.checkZoneRouteIntrusion === b.checkZoneRouteIntrusion
  );
}

/** 「自動保留 3/14 20:11」 — legible at a glance, and sorts naturally per day. */
function autoKeepName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `自動保留 ${now.getMonth() + 1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * An auto-keep name that cannot clobber an earlier one.
 *
 * Comparing two saved 場佈 means two 載入 within the same minute, and the name
 * above only has minute resolution. The second write would then replace the
 * first auto-keep — which holds the user's unsaved arrangement — with content
 * that is already saved under its own name. Same failure as a single-slot
 * tombstone: the only surviving copy, dropped silently.
 */
function uniqueAutoKeepName(taken: string[]): string {
  const base = autoKeepName();
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}（${i}）`;
    if (!used.has(candidate)) return candidate;
  }
}
