/**
 * What happens when the disk says no.
 *
 * Safari private mode, an embedded webview, a genuinely full 5 MiB origin: the
 * writes throw. The storage layer is honest about that — it throws or returns
 * false — and the question these tests answer is whether the layer ABOVE it
 * tells the user, or just stops.
 *
 * The worst case here is not a missing toast. `deleteProject` removes the body
 * and hands back the only remaining copy as an in-memory snapshot; if 復原 then
 * fails and the caller throws that snapshot away, the plan is gone for good.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ProjectRepository, StorageFullError } from "../src/state/projectRepository";
import { createDefaultProject, type Project } from "../src/core/model";

/** A localStorage that can be told to refuse specific keys. */
class MemoryStorage {
  private map = new Map<string, string>();
  /** Keys matching this throw on write, as a full quota does. */
  failOn: RegExp | null = null;

  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  setItem(k: string, v: string): void {
    if (this.failOn?.test(k)) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.map.set(k, v);
  }
}

let store: MemoryStorage;

beforeEach(() => {
  store = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = store;
});

function plan(name: string): Project {
  return { ...createDefaultProject(), name, description: `${name} 的說明` };
}

describe("複製 on a full store", () => {
  it("throws rather than pretending — and the caller has to catch it", () => {
    const a = ProjectRepository.createProject({ name: "上週社課", project: plan("上週社課") });
    store.failOn = /planform-iso:projects:prj_/;
    // The contract the UI must honour. Before this was caught, the click
    // handler aborted before both its refresh() and its toast(): the card
    // never appeared and nothing said why.
    expect(() => ProjectRepository.duplicateProject(a.id)).toThrow(StorageFullError);
  });

  it("leaves the original untouched", () => {
    const a = ProjectRepository.createProject({ name: "上週社課", project: plan("上週社課") });
    store.failOn = /planform-iso:projects:prj_/;
    try { ProjectRepository.duplicateProject(a.id); } catch { /* expected */ }
    store.failOn = null;
    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok).toBe(true);
    expect(ProjectRepository.listProjects().map((m) => m.name)).toEqual(["上週社課"]);
  });
});

describe("a failed 復原 must not be the end of the plan", () => {
  it("restoreProject reports failure instead of throwing", () => {
    const a = ProjectRepository.createProject({ name: "期初茶會", project: plan("期初茶會") });
    const snapshot = ProjectRepository.deleteProject(a.id)!;
    expect(snapshot.body).not.toBeNull();
    store.failOn = /planform-iso:projects:prj_/;
    expect(ProjectRepository.restoreProject(snapshot)).toBe(false);
  });

  it("and the snapshot still restores once there is room again", () => {
    const a = ProjectRepository.createProject({ name: "期初茶會", project: plan("期初茶會") });
    const snapshot = ProjectRepository.deleteProject(a.id)!;
    store.failOn = /planform-iso:projects:prj_/;
    expect(ProjectRepository.restoreProject(snapshot)).toBe(false);
    // This is the whole point: the caller must KEEP the snapshot after a
    // failed undo. Dropping it deletes the project permanently, because the
    // body is already gone from storage.
    store.failOn = null;
    expect(ProjectRepository.restoreProject(snapshot)).toBe(true);
    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.project.name).toBe("期初茶會");
  });

  it("the deleted body really is gone from storage in between", () => {
    const a = ProjectRepository.createProject({ name: "期初茶會", project: plan("期初茶會") });
    ProjectRepository.deleteProject(a.id);
    expect(store.getItem(`planform-iso:projects:${a.id}`)).toBeNull();
  });
});

describe("改名 tells the caller when it only half-landed", () => {
  it("reports fullyApplied on a healthy store", () => {
    const a = ProjectRepository.createProject({ name: "舊名字", project: plan("舊名字") });
    const renamed = ProjectRepository.renameProject(a.id, "新名字");
    expect(renamed?.fullyApplied).toBe(true);
    const opened = ProjectRepository.openProject(a.id);
    expect(opened.ok && opened.project.name).toBe("新名字");
  });

  it("reports a half-applied rename rather than claiming success", () => {
    const a = ProjectRepository.createProject({ name: "舊名字", project: plan("舊名字") });
    // The card index still fits; the plan body does not.
    store.failOn = new RegExp(`planform-iso:projects:${a.id}$`);
    const renamed = ProjectRepository.renameProject(a.id, "新名字");
    expect(renamed?.name).toBe("新名字");
    // The card would say 新名字 while the 場刊圖 still prints 舊名字.
    expect(renamed?.fullyApplied).toBe(false);
  });
});
