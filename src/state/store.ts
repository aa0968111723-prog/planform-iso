import { createDefaultProject, type Project } from "../core/model";
import { migrateProject } from "../core/migrate";
import { ProjectRepository } from "./projectRepository";
import { createTabSync, type TabSyncHandle } from "./tabSync";
import { renderProjectThumbnail } from "../export/constructionPlan";

const AUTOSAVE_KEY = "planform-iso:autosave";
const AUTOSAVE_BACKUP_KEY = "planform-iso:autosave-backup";
const LAYOUTS_KEY = "planform-iso:layouts";
const SNAPSHOT_PREFIX = "planform-iso:snapshots:";
const MAX_HISTORY = 100;
const THUMBNAIL_MS = 1200;

export function snapshotStorageKey(projectId: string): string {
  return `${SNAPSHOT_PREFIX}${projectId}`;
}

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
  private thumbnailTimer: number | null = null;
  private tabSync: TabSyncHandle | null = null;

  constructor(initial?: Project) {
    this.project = initial ?? createDefaultProject();
    this.attachTabSync();
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
    if (id) this.announceOpen();
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
    this.announceOpen();
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

  private scheduleAutosave(): void {
    if (typeof window === "undefined") return;
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.saveAutosave(), 400);
  }

  /** Called once if autosave writes start failing (e.g. storage full). */
  onStorageError: (() => void) | null = null;
  onStorageRecovered: (() => void) | null = null;
  onLayoutError: ((action: "save" | "delete") => void) | null = null;
  /** Another tab wrote a newer revision of this project. */
  onWriteConflict: ((remote: Project) => void) | null = null;
  /** Another tab has the same project open (heartbeat). */
  onPeerOpen: ((projectId: string) => void) | null = null;
  private storageErrorReported = false;

  saveAutosave(): void {
    if (typeof localStorage === "undefined") return;
    if (this.projectId) {
      const result = ProjectRepository.trySaveProject(this.projectId, this.project);
      if (result.ok) {
        if (this.storageErrorReported) {
          this.storageErrorReported = false;
          this.onStorageRecovered?.();
        }
        this.tabSync?.post({
          type: "saved",
          projectId: this.projectId,
          revision: this.project.revision ?? 0,
        });
        this.scheduleThumbnail();
        return;
      }
      if (result.reason === "conflict") {
        this.onWriteConflict?.(result.remote);
        return;
      }
      if (!this.storageErrorReported) {
        this.storageErrorReported = true;
        this.onStorageError?.();
      }
      return;
    }
    const ok = this.writeLegacyAutosave();
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
    this.flushThumbnail();
  }

  /** Adopt the disk copy after a conflict (「載入最新」). */
  adoptRemote(remote: Project): void {
    this.project = migrateProject(remote);
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.emit();
  }

  /** Keep this tab's edits and take the next write (「繼續用這一頁」). */
  takeWritePriority(remoteRevision: number): void {
    this.project.revision = remoteRevision;
  }

  private attachTabSync(): void {
    this.tabSync = createTabSync({
      onRemoteSave: (msg) => {
        if (!this.projectId || msg.projectId !== this.projectId) return;
        if (msg.revision <= (this.project.revision ?? 0)) return;
        const opened = ProjectRepository.openProject(msg.projectId);
        if (opened.ok) this.onWriteConflict?.(opened.project);
      },
      onPeerOpen: (msg) => {
        if (this.projectId && msg.projectId === this.projectId) this.onPeerOpen?.(msg.projectId);
      },
    });
  }

  announceOpen(): void {
    if (this.projectId) this.tabSync?.post({ type: "open", projectId: this.projectId });
  }

  private scheduleThumbnail(): void {
    if (!this.projectId || typeof document === "undefined") return;
    if (typeof window === "undefined") return;
    if (this.thumbnailTimer !== null) window.clearTimeout(this.thumbnailTimer);
    this.thumbnailTimer = window.setTimeout(() => this.flushThumbnail(), THUMBNAIL_MS);
  }

  private flushThumbnail(): void {
    if (this.thumbnailTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.thumbnailTimer);
      this.thumbnailTimer = null;
    }
    const id = this.projectId;
    if (!id || typeof document === "undefined") return;
    const url = renderProjectThumbnail(this.project);
    if (url) ProjectRepository.setThumbnail(id, url);
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
    return Object.keys(readLayouts(this.layoutsKey())).sort();
  }

  saveNamedLayout(name: string): boolean {
    try {
      const key = this.layoutsKey();
      const layouts = readLayouts(key);
      const project = clone(this.project);
      project.name = name;
      layouts[name] = project;
      localStorage.setItem(key, JSON.stringify(layouts));
      this.mutate((p) => {
        p.name = name;
      }, { history: false });
      return true;
    } catch {
      this.onLayoutError?.("save");
      return false;
    }
  }

  loadNamedLayout(name: string): boolean {
    const layouts = readLayouts(this.layoutsKey());
    const project = layouts[name];
    if (!project) return false;
    this.loadProject(project, { undoBeforeLoad: true });
    return true;
  }

  deleteNamedLayout(name: string): boolean {
    try {
      const key = this.layoutsKey();
      const layouts = readLayouts(key);
      delete layouts[name];
      localStorage.setItem(key, JSON.stringify(layouts));
      return true;
    } catch {
      this.onLayoutError?.("delete");
      return false;
    }
  }

  /** Bound projects keep snapshots under their own key; unbound uses the legacy global list. */
  private layoutsKey(): string {
    return this.projectId ? snapshotStorageKey(this.projectId) : LAYOUTS_KEY;
  }
}

function readLayouts(key: string): Record<string, Project> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, Project>) : {};
  } catch {
    return {};
  }
}

/** @deprecated use migrateProject from core/migrate. Kept for import compatibility. */
export const migrate = migrateProject;
