import { createDefaultProject, type Project } from "../core/model";
import { migrateProject } from "../core/migrate";
import type { StorePersistence } from "./projectRepository";

/**
 * Pre-library keys, used ONLY when no persistence is installed — i.e. by unit
 * tests. Production installs a sink at boot and never reaches these again; the
 * legacy migration owns what happens to whatever they still hold.
 */
const AUTOSAVE_KEY = "planform-iso:autosave";
const LAYOUTS_KEY = "planform-iso:layouts";
const MAX_HISTORY = 100;

function clone<T>(v: T): T {
  return structuredClone(v);
}

type Listener = () => void;

/**
 * Single source of truth for the OPEN project. Supports history-tracked
 * mutations (undo/redo), transient mutations for live dragging, debounced
 * autosave, and the arrangements saved inside the project.
 *
 * Switching projects mutates this instance in place through `loadProject`.
 * **Never construct a second Store.** `App`, `quickAgent`, the e2e handle on
 * `window.planform.store`, `UI`'s `onLayoutError` and `main.ts`'s
 * `onStorageError`/`onStorageRecovered` are all bound once at boot, and a
 * replacement instance would leave every one of them silently orphaned.
 *
 * Where the bytes go is not this class's business: `setPersistence` injects
 * that. The Store keeps the debounce and the one-shot storage-error latch; the
 * repository keeps the keys.
 */
export class Store {
  private project: Project;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private listeners = new Set<Listener>();
  private pending: Project | null = null;
  private autosaveTimer: number | null = null;
  private persistence: StorePersistence | null = null;

  constructor(initial?: Project) {
    this.project = initial ?? createDefaultProject();
  }

  getState(): Project {
    return this.project;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** History-tracked mutation (default). Records an undo checkpoint. */
  mutate(fn: (p: Project) => void, options: { history?: boolean } = {}): void {
    const history = options.history !== false;
    if (history) {
      this.undoStack.push(clone(this.project));
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    fn(this.project);
    this.emit();
    this.scheduleAutosave();
  }

  /** Begin a transient change (e.g. a drag) that becomes one undo step. */
  beginTransient(): void {
    this.pending = clone(this.project);
  }

  transient(fn: (p: Project) => void): void {
    fn(this.project);
    this.emit();
  }

  commitTransient(): void {
    if (!this.pending) return;
    const changed =
      JSON.stringify(this.pending) !== JSON.stringify(this.project);
    if (changed) {
      this.undoStack.push(this.pending);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
      this.scheduleAutosave();
    }
    this.pending = null;
  }

  cancelTransient(): void {
    if (this.pending) {
      this.project = this.pending;
      this.pending = null;
      this.emit();
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(clone(this.project));
    this.project = prev;
    this.emit();
    this.scheduleAutosave();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(clone(this.project));
    this.project = next;
    this.emit();
    this.scheduleAutosave();
  }

  /** Replace the whole project. Safety loads keep one undo checkpoint. */
  loadProject(project: Project, options: { undoBeforeLoad?: boolean } = {}): void {
    const hasContent = this.project.objects.length > 0 || this.project.zones.length > 0 ||
      this.project.groups.length > 0 || this.project.routes.length > 0;
    if (options.undoBeforeLoad ?? hasContent) {
      this.undoStack.push(clone(this.project));
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    } else {
      this.undoStack = [];
    }
    this.project = migrateProject(project);
    this.redoStack = [];
    this.pending = null;
    this.emit();
    this.scheduleAutosave();
  }

  // --- persistence -------------------------------------------------------

  /**
   * Point the autosave at one project's storage.
   *
   * `null` means unit-test / legacy mode and falls back to the pre-library
   * global key. Production passes `NULL_PERSISTENCE` when nothing is open —
   * passing `null` there would resurrect a just-deleted project in the legacy
   * key and overwrite the retained cold backup at the same time.
   */
  setPersistence(persistence: StorePersistence | null): void {
    this.persistence = persistence;
  }

  private scheduleAutosave(): void {
    if (typeof window === "undefined") return;
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.saveAutosave(), 400);
  }

  /** Called once if autosave writes start failing (e.g. storage full). */
  onStorageError: (() => void) | null = null;
  onStorageRecovered: (() => void) | null = null;
  onLayoutError: ((action: "save" | "delete") => void) | null = null;
  private storageErrorReported = false;

  /**
   * The latch below answers exactly one question — *can I persist the project
   * that is open?* — which is what the 自動儲存失敗 banner claims. Only the
   * body write goes through it. Index and variant failures are reported
   * separately by the repository, because a successful index write next to a
   * failed body write must never be allowed to say 「已恢復」.
   */
  saveAutosave(): void {
    const sink = this.persistence;
    if (!sink && typeof localStorage === "undefined") return;
    try {
      if (sink) sink.saveProject(this.project);
      else localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.project));
      if (this.storageErrorReported) {
        this.storageErrorReported = false;
        this.onStorageRecovered?.();
      }
    } catch {
      if (!this.storageErrorReported) {
        this.storageErrorReported = true;
        this.onStorageError?.();
      }
    }
  }

  /**
   * Write pending changes immediately (pagehide / tab hidden / before a
   * project switch). Cancelling the timer is the load-bearing half: a timer
   * left pending across a switch fires against the NEW project's sink holding
   * the OLD project's state.
   */
  flushAutosave(): void {
    if (this.autosaveTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.saveAutosave();
  }

  // --- 場佈版本 (arrangements saved inside the open project) ---------------

  listLayouts(): string[] {
    if (this.persistence) return this.persistence.listLayouts();
    return Object.keys(readLayouts()).sort();
  }

  saveNamedLayout(name: string): boolean {
    try {
      if (this.persistence) {
        // Deliberately does NOT rename the live project. Saving an arrangement
        // is not naming the project — conflating the two is exactly what made
        // 場佈 and 專案 the same thing in the old single-slot model.
        this.persistence.writeLayout(name, this.project);
      } else {
        const layouts = readLayouts();
        const project = clone(this.project);
        project.name = name;
        layouts[name] = project;
        localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
        this.mutate((p) => {
          p.name = name;
        }, { history: false });
      }
      return true;
    } catch {
      this.onLayoutError?.("save");
      return false;
    }
  }

  loadNamedLayout(name: string): boolean {
    const project = this.persistence
      ? this.persistence.readLayout(name)
      : (readLayouts()[name] ?? null);
    if (!project) return false;
    this.loadProject(project, { undoBeforeLoad: true });
    return true;
  }

  deleteNamedLayout(name: string): boolean {
    try {
      if (this.persistence) {
        this.persistence.deleteLayout(name);
      } else {
        const layouts = readLayouts();
        delete layouts[name];
        localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
      }
      return true;
    } catch {
      this.onLayoutError?.("delete");
      return false;
    }
  }
}

function readLayouts(): Record<string, Project> {
  try {
    const raw = localStorage.getItem(LAYOUTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Project>) : {};
  } catch {
    return {};
  }
}
