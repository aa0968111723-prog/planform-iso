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

/** What to call a prop in a change note, from what it actually is. */
function propNoun(def: { category?: string; interaction?: unknown }): string {
  if (def.category === "文宣") return "文宣";
  if (def.category === "背景") return "背景";
  if (def.category === "擺攤小物") return "擺攤小物";
  return def.interaction ? "互動道具" : "道具";
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
      return {
        addedObjectIds: [], movedObjectIds: [], removedObjectIds: [], addedCatalogIds: [],
        addedPropIds: [], changedPropIds: [], removedPropIds: [], notes: [],
      };
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

    // Props are their own top-level block; an agent recipe that creates one
    // showed up nowhere in the preview without this.
    const beforeProps = new Map((this.base.props ?? []).map((d) => [d.id, d]));
    const afterProps = new Map((this.draft.props ?? []).map((d) => [d.id, d]));
    const addedPropIds = [...afterProps.keys()].filter((id) => !beforeProps.has(id));
    const removedPropIds = [...beforeProps.keys()].filter((id) => !afterProps.has(id));
    const changedPropIds = [...afterProps.keys()].filter((id) => {
      const was = beforeProps.get(id);
      return was && JSON.stringify(was) !== JSON.stringify(afterProps.get(id));
    });

    const vb = issueCounts(validateProject(this.base));
    const va = issueCounts(validateProject(this.draft));
    const notes: string[] = [];
    if (addedObjectIds.length) notes.push(`新增 ${addedObjectIds.length} 件物件`);
    if (movedObjectIds.length) notes.push(`移動 ${movedObjectIds.length} 件物件`);
    if (addedCatalogIds.length) notes.push(`新增 ${addedCatalogIds.length} 筆素材`);
    for (const id of addedPropIds) {
      const def = afterProps.get(id)!;
      // 「互動道具」 was hard-coded, so an A2 poster was announced as an
      // interactive prop. The definition already says what it is.
      notes.push(`新增${propNoun(def)}「${def.name}」`);
    }
    for (const id of changedPropIds) notes.push(`修改道具「${afterProps.get(id)!.name}」`);
    for (const id of removedPropIds) notes.push(`移除道具「${beforeProps.get(id)!.name}」`);
    if (va.error !== vb.error || va.warning !== vb.warning) {
      notes.push(`Validation 錯誤 ${vb.error}→${va.error}，警告 ${vb.warning}→${va.warning}`);
    }

    return {
      addedObjectIds,
      movedObjectIds,
      removedObjectIds,
      addedCatalogIds,
      addedPropIds,
      changedPropIds,
      removedPropIds,
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
      // `Object.assign` copies keys the draft HAS; a key the draft DELETED
      // stays behind. Both of these are optional top-level blocks that a
      // recipe can legitimately remove, so a deletion has to be applied by
      // hand or it silently does not happen.
      if (next.props) p.props = next.props; else delete p.props;
      if (next.interaction) p.interaction = next.interaction; else delete p.interaction;
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
