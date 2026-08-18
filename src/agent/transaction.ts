/**
 * Agent preview transaction — draft clone, never mutates committed project until commit.
 */

import type { Project } from "../core/model";
import type { Store } from "../state/store";
import type { AgentDiffSummary } from "./types";
import { issueCounts, validateProject } from "../core/validation";

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class AgentTransaction {
  private base: Project | null = null;
  private draft: Project | null = null;
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  getDraft(): Project | null {
    return this.draft;
  }

  getBase(): Project | null {
    return this.base;
  }

  start(project: Project): Project {
    this.base = clone(project);
    this.draft = clone(project);
    this.active = true;
    return this.draft;
  }

  /** Mutate the draft only. */
  mutate(fn: (p: Project) => void): void {
    if (!this.draft || !this.active) throw new Error("no active agent preview");
    fn(this.draft);
  }

  summarize(): AgentDiffSummary {
    if (!this.base || !this.draft) {
      return { addedObjectIds: [], movedObjectIds: [], removedObjectIds: [], addedCatalogIds: [], notes: [] };
    }
    const beforeIds = new Set(this.base.objects.map((o) => o.id));
    const afterIds = new Set(this.draft.objects.map((o) => o.id));
    const addedObjectIds = [...afterIds].filter((id) => !beforeIds.has(id));
    const removedObjectIds = [...beforeIds].filter((id) => !afterIds.has(id));
    const movedObjectIds: string[] = [];
    for (const o of this.draft.objects) {
      const prev = this.base.objects.find((x) => x.id === o.id);
      if (!prev) continue;
      if (prev.x !== o.x || prev.z !== o.z || prev.rotationDeg !== o.rotationDeg) {
        movedObjectIds.push(o.id);
      }
    }
    const beforeCatalog = new Set((this.base.catalogExtras ?? []).map((e) => e.id));
    const addedCatalogIds = (this.draft.catalogExtras ?? [])
      .map((e) => e.id)
      .filter((id) => !beforeCatalog.has(id));

    const vb = issueCounts(validateProject(this.base));
    const va = issueCounts(validateProject(this.draft));
    const notes: string[] = [];
    if (addedObjectIds.length) notes.push(`新增 ${addedObjectIds.length} 件物件`);
    if (movedObjectIds.length) notes.push(`移動 ${movedObjectIds.length} 件物件`);
    if (addedCatalogIds.length) notes.push(`新增 ${addedCatalogIds.length} 筆素材`);
    if (va.error !== vb.error || va.warning !== vb.warning) {
      notes.push(`Validation 錯誤 ${vb.error}→${va.error}，警告 ${vb.warning}→${va.warning}`);
    }

    return {
      addedObjectIds,
      movedObjectIds,
      removedObjectIds,
      addedCatalogIds,
      notes,
      validationBefore: { errors: vb.error, warnings: vb.warning },
      validationAfter: { errors: va.error, warnings: va.warning },
    };
  }

  /** Commit draft into store as one undoable mutation. */
  commit(store: Store): AgentDiffSummary {
    if (!this.draft || !this.active) throw new Error("no active agent preview");
    const summary = this.summarize();
    const next = clone(this.draft);
    store.mutate((p) => {
      Object.assign(p, next);
      // Ensure nested arrays replaced
      p.objects = next.objects;
      p.zones = next.zones;
      p.routes = next.routes;
      p.groups = next.groups;
      p.measurements = next.measurements;
      p.catalogExtras = next.catalogExtras ?? [];
      p.validationSettings = next.validationSettings;
    });
    this.clear();
    return summary;
  }

  rollback(): void {
    this.clear();
  }

  private clear(): void {
    this.base = null;
    this.draft = null;
    this.active = false;
  }
}
