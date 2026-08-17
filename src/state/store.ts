import {
  createDefaultProject,
  PROJECT_VERSION,
  type Project,
} from "../core/model";

const AUTOSAVE_KEY = "planform-iso:autosave";
const LAYOUTS_KEY = "planform-iso:layouts";
const MAX_HISTORY = 100;

function clone<T>(v: T): T {
  return structuredClone(v);
}

type Listener = () => void;

/**
 * Single source of truth for the project. Supports history-tracked mutations
 * (undo/redo), transient mutations for live dragging, autosave to
 * localStorage, and named local layouts.
 */
export class Store {
  private project: Project;
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

  /** Replace the whole project (import / load layout). Resets history. */
  loadProject(project: Project): void {
    this.project = migrate(project);
    this.undoStack = [];
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

  saveAutosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.project));
    } catch {
      /* storage may be unavailable; ignore */
    }
  }

  static loadAutosave(): Project | null {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      return migrate(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  // --- named layouts -----------------------------------------------------

  listLayouts(): string[] {
    return Object.keys(readLayouts()).sort();
  }

  saveNamedLayout(name: string): void {
    const layouts = readLayouts();
    const project = clone(this.project);
    project.name = name;
    layouts[name] = project;
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
    this.mutate((p) => {
      p.name = name;
    }, { history: false });
  }

  loadNamedLayout(name: string): boolean {
    const layouts = readLayouts();
    const project = layouts[name];
    if (!project) return false;
    this.loadProject(project);
    return true;
  }

  deleteNamedLayout(name: string): void {
    const layouts = readLayouts();
    delete layouts[name];
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
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

/** Fill in any fields missing from older/imported project blobs. */
export function migrate(input: Partial<Project>): Project {
  const base = createDefaultProject();
  const p: Project = { ...base, ...input, version: PROJECT_VERSION };
  p.classroom = { ...base.classroom, ...input.classroom };
  p.corridor = { ...base.corridor, ...input.corridor };
  p.tile = { ...base.tile, ...input.tile };
  p.calibration = { ...base.calibration, ...input.calibration };
  p.layers = { ...base.layers, ...input.layers };
  p.zones = Array.isArray(input.zones) ? input.zones : [];
  p.objects = Array.isArray(input.objects) ? input.objects : [];
  p.routes = Array.isArray(input.routes) ? input.routes : [];
  return p;
}
