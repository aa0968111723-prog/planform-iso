/**
 * Capabilities the agent needs that do NOT live in the plan document.
 *
 * The draft/commit gate protects the plan. It cannot protect the project
 * library, the camera or the file system, because those are not part of the
 * plan — rolling back a preview does not un-delete a project or un-download a
 * PNG. So they are separated out here and injected.
 *
 * Every member is optional on purpose. A headless executor (tests, a worker)
 * gets none of them, and a tool that needs one then fails with a real message
 * instead of returning `{ ok: true, note: "由 UI 處理" }` — which is a lie the
 * user reads as "done".
 */

import type { Project } from "../core/model";
import type { PlanPreset, PageSize, PageOrientation } from "../export/constructionPlan";

export interface ProjectMetaLike {
  id: string;
  name: string;
  updatedAt: number;
  eventDate?: string;
}

export interface ProjectHost {
  list(): ProjectMetaLike[];
  activeId(): string | null;
  create(input: { name: string; eventDate?: string; venuePresetId?: string }): ProjectMetaLike;
  open(id: string): { ok: true; project: Project } | { ok: false; reason: string };
  save(): { ok: true } | { ok: false; reason: string };
  duplicate(id: string, name?: string): ProjectMetaLike | null;
  rename(id: string, name: string): ProjectMetaLike | null;
  /**
   * Deleting is the one agent-reachable action the preview gate cannot undo,
   * so the host returns the snapshot it removed. The executor refuses the call
   * without an explicit `confirm: true` from the caller.
   */
  remove(id: string): { restored: boolean; snapshot: unknown } | null;
}

export interface LayoutVersionHost {
  list(): string[];
  exists(name: string): boolean;
  save(name: string): boolean;
  read(name: string): Project | null;
}

export interface ViewportHost {
  focusPoint(x: number, z: number): void;
  fitScene(): void;
  setLabelsVisible(visible: boolean): void;
  setSimulationRunning(running: boolean): void;
  /** "phone" | "tablet" | "desktop" — what the workspace is currently showing. */
  workspaceMode(): string;
}

export interface ExportHost {
  /** Returns the filename written, or throws. */
  planImage(options: { preset: PlanPreset; pageSize: PageSize; orientation: PageOrientation }): Promise<string>;
  partnerView(): Promise<string>;
  projectJson(): string;
}

export interface AgentHost {
  projects?: ProjectHost;
  layoutVersions?: LayoutVersionHost;
  viewport?: ViewportHost;
  exports?: ExportHost;
}
