import { createDefaultProject, planHasContent, type Project } from "../core/model";
import { migrateProject } from "../core/migrate";
import { ProjectRepository } from "./projectRepository";

const AUTOSAVE_KEY = "planform-iso:autosave";
const AUTOSAVE_BACKUP_KEY = "planform-iso:autosave-backup";
const LAYOUTS_KEY = "planform-iso:layouts";
const MAX_HISTORY = 100;

function clone<T>(v: T): T {
  return structuredClone(v);
}

type Listener = () => void;

/**
 * Single source of truth for **the one project currently being edited**.
 * Supports history-tracked mutations (undo/redo), transient mutations for live
 * dragging, autosave, and named local layouts.
 *
 * Having *many* projects is the ProjectRepository's job. When a project is
 * bound here with `bindProject`, autosave writes to that project's own storage
 * key, which is what makes switching between 「期初茶會」 and 「9/24 社課」 safe:
 * saving one cannot overwrite the other. With nothing bound the Store falls
 * back to the pre-multi-project global autosave key.
 */
export class Store {
  private project: Project;
  /** Which library project this Store is editing, if any. */
  private projectId: string | null = null;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private listeners = new Set<Listener>();
  private pending: Project | null = null;
  private autosaveTimer: number | null = null;

  constructor(initial?: Project) {
    this.project = initial ?? createDefaultProject();
  }

  getState(): Project {
    return this.project;
  }

  /**
   * Point autosave at one library project. Any pending write for the previous
   * project is flushed first, so switching never drops the last edit.
   */
  bindProject(id: string | null): void {
    if (id === this.projectId) return;
    if (this.projectId) this.flushAutosave();
    this.projectId = id;
  }

  getProjectId(): string | null {
    return this.projectId;
  }

  /**
   * Swap in a different project's plan without recording it as an undo step of
   * the previous one — switching projects is navigation, not an edit.
   */
  openBoundProject(id: string, project: Project): void {
    this.flushAutosave();
    this.projectId = id;
    this.project = migrateProject(project);
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.emit();
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

  /**
   * Replace the whole project. Safety loads keep one undo checkpoint.
   *
   * "Has content" is `planHasContent`, not a count of four arrays. A plan whose
   * work is a resized room, a measured tile, a confirmed calibration and three
   * 尺寸線 has empty arrays and is absolutely not empty — and the arrays-only
   * test cleared the undo stack on it, so 匯入 JSON replaced that plan with
   * Ctrl+Z already dead. The dialog above it promises 「載入前已保留一個復原
   * 步驟」; this is the line that makes the promise true.
   */
  loadProject(project: Project, options: { undoBeforeLoad?: boolean } = {}): void {
    if (options.undoBeforeLoad ?? planHasContent(this.project)) {
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

  saveAutosave(): void {
    if (typeof localStorage === "undefined") return;
    const ok = this.projectId
      ? ProjectRepository.saveProject(this.projectId, this.project)
      : this.writeLegacyAutosave();
    if (ok) {
      if (this.storageErrorReported) {
        this.storageErrorReported = false;
        this.onStorageRecovered?.();
      }
      return;
    }
    if (!this.storageErrorReported) {
      this.storageErrorReported = true;
      this.onStorageError?.();
    }
  }

  /** Pre-multi-project fallback: one global autosave key. */
  private writeLegacyAutosave(): boolean {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.project));
      return true;
    } catch {
      return false;
    }
  }

  /** Write pending changes immediately (pagehide / tab hidden). */
  flushAutosave(): void {
    if (this.autosaveTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    this.saveAutosave();
  }

  static loadAutosave(): Project | null {
    return Store.loadAutosaveWithRecovery().project;
  }

  /**
   * Load the autosave; if it is corrupt, keep the raw blob in a backup key
   * (so nothing is silently destroyed) and report `recovered: true` for the
   * UI to explain what happened.
   */
  static loadAutosaveWithRecovery(): { project: Project | null; recovered: boolean } {
    let raw: string | null;
    try {
      raw = localStorage.getItem(AUTOSAVE_KEY);
    } catch {
      return { project: null, recovered: false };
    }
    if (!raw) return { project: null, recovered: false };
    try {
      return { project: migrateProject(JSON.parse(raw)), recovered: false };
    } catch {
      try {
        localStorage.setItem(AUTOSAVE_BACKUP_KEY, raw);
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch {
        /* keep going — a fresh project still beats a white screen */
      }
      return { project: null, recovered: true };
    }
  }

  /** Raw backup kept from a failed load, if any (for support/export). */
  static corruptBackup(): string | null {
    try {
      return localStorage.getItem(AUTOSAVE_BACKUP_KEY);
    } catch {
      return null;
    }
  }

  // --- named layouts -----------------------------------------------------

  listLayouts(): string[] {
    return Object.keys(readLayouts()).sort();
  }

  /** Does a saved version of this name already exist? The caller has to ask. */
  hasNamedLayout(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(readLayouts(), name);
  }

  saveNamedLayout(name: string): boolean {
    try {
      const layouts = readLayouts();
      const project = clone(this.project);
      project.name = name;
      layouts[name] = project;
      localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
      this.mutate((p) => {
        p.name = name;
      }, { history: false });
      return true;
    } catch {
      this.onLayoutError?.("save");
      return false;
    }
  }

  /**
   * Read a saved version WITHOUT loading it.
   *
   * `loadNamedLayout` replaces the live plan immediately, which is exactly what
   * the agent's preview gate exists to prevent: restoring a version has to land
   * in the draft first so the user can look before it replaces what is on
   * screen.
   */
  readNamedLayout(name: string): Project | null {
    const layouts = readLayouts();
    const project = layouts[name];
    return project ? migrateProject(project) : null;
  }

  loadNamedLayout(name: string): boolean {
    const layouts = readLayouts();
    const project = layouts[name];
    if (!project) return false;
    this.loadProject(project, { undoBeforeLoad: true });
    return true;
  }

  deleteNamedLayout(name: string): boolean {
    try {
      const layouts = readLayouts();
      delete layouts[name];
      localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
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

/** @deprecated use migrateProject from core/migrate. Kept for import compatibility. */
export const migrate = migrateProject;
