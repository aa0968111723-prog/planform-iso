/**
 * The browser implementation of `AgentHost`.
 *
 * Everything here is a capability the agent needs that lives OUTSIDE the plan
 * document — the project library, named versions, the camera, the exporters.
 * They are wired here rather than inside the executor for two reasons:
 *
 * - The executor must stay runnable headless. A test that imports it must not
 *   pull in Three.js, `document` or `localStorage`.
 * - Actions here are outside the preview/commit gate. Rolling back a preview
 *   does not un-delete a project or un-download a PNG, so the boundary should
 *   be visible in the module graph, not buried in a switch statement.
 *
 * Where a capability cannot be honoured, the method throws or returns a
 * failure. It never reports success it did not achieve.
 */

import type { App } from "./App";
import type { AgentHost, ProjectHost, LayoutVersionHost, ViewportHost, ExportHost, ProjectMetaLike } from "../agent/host";
import { ProjectRepository } from "../state/projectRepository";
import { renderConstructionPlan, type PageOrientation, type PageSize, type PlanPreset } from "../export/constructionPlan";
import { downloadPng, pngFilename } from "../export/exporters";
import { migrateProject } from "../core/migrate";
import type { Project } from "../core/model";

function toMeta(m: { id: string; name: string; updatedAt: number; eventDate?: string }): ProjectMetaLike {
  return { id: m.id, name: m.name, updatedAt: m.updatedAt, ...(m.eventDate ? { eventDate: m.eventDate } : {}) };
}

export function createAppAgentHost(app: App): AgentHost {
  const projects: ProjectHost = {
    list: () => ProjectRepository.listProjects().map(toMeta),
    activeId: () => app.currentProjectId,
    create: (input) => {
      // The wizard normally supplies a starting plan. From the agent there is
      // no wizard, so the default plan is used and the user is told what they
      // got rather than being handed an empty editor.
      const base = app.plan;
      const project: Project = migrateProject({
        ...structuredClone(base),
        name: input.name,
        ...(input.eventDate ? { eventDate: input.eventDate } : {}),
        objects: [],
        groups: [],
        zones: [],
        routes: [],
        measurements: [],
      });
      return toMeta(app.createProject({
        name: input.name,
        project,
        ...(input.venuePresetId ? { venuePresetId: input.venuePresetId } : {}),
      }));
    },
    open: (id) => {
      const opened = ProjectRepository.openProject(id);
      if (!opened.ok) return { ok: false, reason: `無法開啟專案 ${id}` };
      return app.openProjectById(id)
        ? { ok: true, project: app.plan }
        : { ok: false, reason: `無法開啟專案 ${id}` };
    },
    save: () => {
      const id = app.currentProjectId;
      if (!id) return { ok: false, reason: "目前沒有開啟中的專案。" };
      return ProjectRepository.saveProject(id, app.plan)
        ? { ok: true }
        : { ok: false, reason: "存檔失敗（可能是本機儲存空間已滿）。" };
    },
    duplicate: (id, name) => {
      const meta = ProjectRepository.duplicateProject(id, name);
      return meta ? toMeta(meta) : null;
    },
    rename: (id, name) => {
      const meta = ProjectRepository.renameProject(id, name);
      return meta ? toMeta(meta) : null;
    },
    remove: (id) => {
      // Deleting the project currently open would leave autosave writing a
      // dead key. Detach first — the same order Project Home uses.
      if (app.currentProjectId === id) app.detachProject();
      const snapshot = ProjectRepository.deleteProject(id);
      return snapshot ? { restored: true, snapshot } : null;
    },
  };

  const layoutVersions: LayoutVersionHost = {
    list: () => app.store.listLayouts(),
    exists: (name) => app.store.hasNamedLayout(name),
    save: (name) => app.store.saveNamedLayout(name),
    read: (name) => {
      // Read WITHOUT loading: the agent restores into the draft so the user can
      // preview it. `loadNamedLayout` would replace the live plan immediately,
      // which is the one thing the preview gate exists to prevent.
      return app.store.readNamedLayout(name);
    },
  };

  const viewport: ViewportHost = {
    focusPoint: (x, z) => app.scene.focusOn(x, z),
    fitScene: () => app.fitSceneToCanvas(),
    setLabelsVisible: (visible) => app.setShowLabels(visible),
    setSimulationRunning: (running) => {
      if (running) app.replaySimulation();
      else app.stopSimulation();
    },
    workspaceMode: () => app.workspaceMode,
  };

  const exports: ExportHost = {
    planImage: async (options: { preset: PlanPreset; pageSize: PageSize; orientation: PageOrientation }) => {
      const dataUrl = renderConstructionPlan(app.plan, {
        preset: options.preset,
        page: options.pageSize,
        orientation: options.orientation,
      });
      const filename = pngFilename(app.plan.name, options.preset);
      downloadPng(dataUrl, filename);
      return filename;
    },
    partnerView: async () => {
      const dataUrl = renderConstructionPlan(app.plan, { preset: "partner", simplify: true, dims: false });
      const filename = pngFilename(app.plan.name, "夥伴觀看圖");
      downloadPng(dataUrl, filename);
      return filename;
    },
    projectJson: () => JSON.stringify(app.plan, null, 2),
  };

  return { projects, layoutVersions, viewport, exports };
}
