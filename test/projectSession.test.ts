import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store";
import { ProjectRepository } from "../src/state/projectRepository";
import { ProjectSession } from "../src/state/projectSession";
import { projectBodyKey } from "../src/state/projectStorage";
import { createDefaultProject, type Project, type Zone } from "../src/core/model";

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return store;
}

function zone(name: string, x = 0): Zone {
  return {
    id: `zone_${name}`,
    type: "group",
    name,
    x,
    z: 0,
    width: 2,
    depth: 2,
    color: "#38bdf8",
    locked: false,
    hidden: false,
    icon: "◻",
    capacity: null,
  };
}

function measurement(id: string): Project["measurements"][number] {
  return {
    id,
    type: "free-distance",
    start: { x: 0, z: 0 },
    end: { x: 3, z: 0 },
    locked: false,
    visible: true,
    color: "#facc15",
  };
}

function plan(name: string): Project {
  const p = createDefaultProject();
  p.name = name;
  return p;
}

describe("ProjectSession", () => {
  let backing: Map<string, string>;
  let store: Store;
  let session: ProjectSession;

  beforeEach(() => {
    backing = installLocalStorage();
    store = new Store(createDefaultProject());
    session = new ProjectSession(store, new ProjectRepository());
  });

  it("編輯 A → 切到 B → 切回 A，A 原封不動", () => {
    // `scheduleAutosave` is a no-op under node (`typeof window === "undefined"`),
    // so this can only pass because the switch itself flushes — which is
    // exactly the behaviour under test. Do not add a window stub.
    const a = session.createProject({ project: plan("A 活動"), open: true });
    store.mutate((p) => void p.zones.push(zone("報到區")));

    const b = session.createProject({ project: plan("B 活動"), open: true });
    store.mutate((p) => void p.routes.push({ id: "r1", name: "動線", type: "custom", points: [] } as never));

    expect(session.activeId).toBe(b.id);
    expect(store.getState().zones).toHaveLength(0);

    session.openProject(a.id);
    expect(session.activeId).toBe(a.id);
    expect(store.getState().zones).toHaveLength(1);
    expect(store.getState().routes).toHaveLength(0);

    // B's own key kept B's edit.
    expect(backing.get(projectBodyKey(b.id))).toContain("動線");
    expect(backing.get(projectBodyKey(a.id))).toContain("報到區");
    expect(backing.get(projectBodyKey(a.id))).not.toContain("動線");
  });

  it("切換專案時，還沒寫下去的編輯不會落到另一份專案", () => {
    const a = session.createProject({ project: plan("A"), open: true });
    store.mutate((p) => void p.zones.push(zone("只在A")));
    const b = session.createProject({ project: plan("B"), open: true });

    expect(backing.get(projectBodyKey(a.id))).toContain("只在A");
    expect(backing.get(projectBodyKey(b.id))).not.toContain("只在A");
  });

  it("刪掉正在編輯的專案不會白屏，也不會寫回已刪除的 key", () => {
    const a = session.createProject({ project: plan("A"), open: true });
    store.mutate((p) => void p.zones.push(zone("報到區")));
    const body = (() => {
      session.flush();
      return backing.get(projectBodyKey(a.id))!;
    })();

    expect(session.deleteProject(a.id)).toBe(true);
    expect(session.screen).toBe("home");
    expect(session.activeId).toBeNull();
    expect(backing.has(projectBodyKey(a.id))).toBe(false);

    // The no-op sink, not `null`: a legacy fallback here would resurrect the
    // deleted project in the pre-library key.
    store.saveAutosave();
    expect(backing.has(projectBodyKey(a.id))).toBe(false);
    expect(backing.has("planform-iso:autosave")).toBe(false);

    expect(session.undoDelete()).toBe(true);
    expect(backing.get(projectBodyKey(a.id))).toBe(body);
    expect(session.listProjects().map((m) => m.id)).toEqual([a.id]);
  });

  it("重新命名之後，接下來的自動儲存不會把名字改回去", () => {
    const a = session.createProject({ project: plan("原名"), open: true });
    expect(session.renameProject(a.id, "新名字")).toBe(true);

    store.mutate((p) => void p.zones.push(zone("報到區")));
    store.flushAutosave();

    expect(session.repo.getMeta(a.id)?.name).toBe("新名字");
    const load = session.repo.openProject(a.id);
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.project.name).toBe("新名字");
  });

  it("載入另一版場佈之前，目前的排法會先被保留", () => {
    session.createProject({ project: plan("A"), open: true });
    store.mutate((p) => void p.zones.push(zone("報到區", 0)));
    expect(session.saveLayout("A版")).toBe(true);

    store.mutate((p) => void (p.zones[0].x = 9));
    expect(session.applyLayout("A版")).toBe(true);

    // The arrangement on screen went back to the saved one...
    expect(store.getState().zones[0].x).toBe(0);
    // ...and the one it replaced was kept, not discarded.
    const names = session.listLayouts();
    const autoKept = names.find((n) => n.startsWith("自動保留"));
    expect(autoKept).toBeDefined();
    const kept = session.repo.readLayout(session.activeId!, autoKept!);
    expect(kept?.zones[0].x).toBe(9);
  });

  it("同一分鐘內載入兩次，第一次自動保留的排法不會被蓋掉", () => {
    session.createProject({ project: plan("A"), open: true });
    store.mutate((p) => void p.zones.push(zone("晚宴", 1)));
    session.saveLayout("晚宴版");
    store.mutate((p) => void (p.zones[0].x = 2));
    session.saveLayout("午餐版");

    // The arrangement the user has been dragging and has NOT saved anywhere.
    store.mutate((p) => void (p.zones[0].x = 99));

    // Two 載入 back to back — comparing two saved arrangements, which lands
    // both auto-keeps inside the same minute.
    expect(session.applyLayout("晚宴版")).toBe(true);
    expect(session.applyLayout("午餐版")).toBe(true);

    const id = session.activeId!;
    const autoKept = session.listLayouts().filter((n) => n.startsWith("自動保留"));
    expect(autoKept.length).toBe(2);

    // The unsaved arrangement must still be recoverable from one of them.
    const positions = autoKept.map((n) => session.repo.readLayout(id, n)?.zones[0]?.x);
    expect(positions).toContain(99);
  });

  it("只有量測的專案，載入其他排法前也會先保留", () => {
    session.createProject({ project: plan("只有量測"), open: true });
    store.mutate((p) => void p.zones.push(zone("暫時")));
    session.saveLayout("有東西的版本");
    store.mutate((p) => {
      p.zones = [];
      p.measurements.push(measurement("m1"));
    });

    expect(session.applyLayout("有東西的版本")).toBe(true);

    // 尺寸線 is real work: walking the venue and recording it before placing a
    // single object must not count as "nothing to keep".
    const autoKept = session.listLayouts().find((n) => n.startsWith("自動保留"));
    expect(autoKept).toBeDefined();
    const kept = session.repo.readLayout(session.activeId!, autoKept!);
    expect(kept?.measurements).toHaveLength(1);
  });

  it("只有量測時，精靈也會開新專案而不是覆蓋", () => {
    session.bootstrap();
    store.mutate((p) => void p.measurements.push(measurement("m1")));

    session.createProject({ project: plan("新的活動"), open: true, adoptPristineActive: true });

    expect(session.listProjects()).toHaveLength(2);
  });

  it("儲存場佈不會把專案改名", () => {
    const a = session.createProject({ project: plan("A 活動"), open: true });
    store.mutate((p) => void p.zones.push(zone("報到區")));
    session.saveLayout("晚宴版");

    expect(store.getState().name).toBe("A 活動");
    expect(session.repo.getMeta(a.id)?.name).toBe("A 活動");
  });

  it("第一次啟動只會有一份專案，精靈填的是同一份", () => {
    const boot = session.bootstrap();
    expect(boot.screen).toBe("editor");
    expect(session.listProjects()).toHaveLength(1);

    // The wizard fills the pristine project in place.
    const built = plan("E310 演講活動（範例）");
    built.zones.push(zone("報到區"));
    session.createProject({ project: built, open: true, adoptPristineActive: true });

    expect(session.listProjects()).toHaveLength(1);
    expect(session.listProjects()[0].name).toBe("E310 演講活動（範例）");
    expect(store.getState().zones).toHaveLength(1);
  });

  it("已經有內容時，精靈一定會開新專案而不是覆蓋", () => {
    session.bootstrap();
    store.mutate((p) => void p.zones.push(zone("既有的內容")));

    const built = plan("新的活動");
    session.createProject({ project: built, open: true, adoptPristineActive: true });

    expect(session.listProjects()).toHaveLength(2);
    const previous = session.listProjects().find((m) => m.name === "未命名平面圖");
    expect(previous).toBeDefined();
    expect(backing.get(projectBodyKey(previous!.id))).toContain("既有的內容");
  });

  it("已經有專案時，預設從「我的專案」開始，並保持 Store 是活的", () => {
    const first = new ProjectSession(store, new ProjectRepository());
    first.createProject({ project: plan("去年的活動"), open: true });

    const store2 = new Store(createDefaultProject());
    const second = new ProjectSession(store2, new ProjectRepository());
    const boot = second.bootstrap();

    expect(boot.screen).toBe("home");
    expect(second.activeId).not.toBeNull();
    expect(store2.getState().name).toBe("去年的活動");
  });

  it("boot override 會直接進編輯器", () => {
    session.createProject({ project: plan("去年的活動"), open: true });
    backing.set("planform-iso:boot", "editor");

    const store2 = new Store(createDefaultProject());
    const second = new ProjectSession(store2, new ProjectRepository());
    expect(second.bootstrap().screen).toBe("editor");
  });

  it("blocked storage 不會讓 bootstrap 丟例外，而且會誠實回報存不起來", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
    };
    const blockedStore = new Store(createDefaultProject());
    const blocked = new ProjectSession(blockedStore, new ProjectRepository());

    let result: { screen: string } | null = null;
    expect(() => {
      result = blocked.bootstrap();
    }).not.toThrow();
    expect(result!.screen).toBe("editor");

    // The editor stays usable, and 自動儲存失敗 fires exactly once. A silent
    // no-op sink here would be worse than the crash it replaced: the user
    // would keep editing while nothing was ever written.
    let errors = 0;
    let recovered = 0;
    blockedStore.onStorageError = () => errors++;
    blockedStore.onStorageRecovered = () => recovered++;
    blockedStore.saveAutosave();
    blockedStore.saveAutosave();
    expect(errors).toBe(1);
    expect(recovered).toBe(0);
  });

  it("連續刪兩個專案，兩個都還原得回來", () => {
    const a = session.createProject({ project: plan("A"), open: true });
    store.mutate((p) => void p.zones.push(zone("只在A")));
    session.flush();
    const b = session.createProject({ project: plan("B"), open: true });
    store.mutate((p) => void p.zones.push(zone("只在B")));
    session.flush();

    const bodyA = backing.get(projectBodyKey(a.id))!;
    const bodyB = backing.get(projectBodyKey(b.id))!;

    // No undo in between — exactly the "clear out two old projects" case.
    expect(session.deleteProject(a.id)).toBe(true);
    expect(session.deleteProject(b.id)).toBe(true);
    expect(session.listProjects()).toHaveLength(0);

    // The chip on each toast undoes the delete it belongs to.
    expect(session.undoDelete(a.id)).toBe(true);
    expect(backing.get(projectBodyKey(a.id))).toBe(bodyA);
    expect(session.undoDelete(b.id)).toBe(true);
    expect(backing.get(projectBodyKey(b.id))).toBe(bodyB);
    expect(session.listProjects().map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("index 條目掉了但 body 還在時，開機會把它接回來", () => {
    const a = session.createProject({ project: plan("A"), open: true });
    const b = session.createProject({ project: plan("B"), open: true });
    session.flush();

    // Exactly what a failed index write, or a concurrent tab's flush, leaves
    // behind: B's body is on disk, but the index has never heard of it.
    const index = JSON.parse(backing.get("planform-iso:projects:index")!) as { id: string }[];
    backing.set(
      "planform-iso:projects:index",
      JSON.stringify(index.filter((m) => m.id !== b.id)),
    );

    // The four-method stub cannot be enumerated, so give this one a real walk.
    const enumerable = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
      get length() {
        return backing.size;
      },
      key: (i: number) => [...backing.keys()][i] ?? null,
    };
    (globalThis as { localStorage?: unknown }).localStorage = enumerable;

    const store2 = new Store(createDefaultProject());
    const second = new ProjectSession(store2, new ProjectRepository());
    second.bootstrap();

    expect(second.listProjects().map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("開一份壞掉的專案會留在原地，不會清空目前的畫面", () => {
    const a = session.createProject({ project: plan("A"), open: true });
    store.mutate((p) => void p.zones.push(zone("報到區")));
    const b = session.createProject({ project: plan("B"), open: true });
    backing.set(projectBodyKey(a.id), "{broken json!!");

    let toast = "";
    session.onToast = (msg) => void (toast = msg);
    expect(session.openProject(a.id)).toBe(false);
    expect(toast).toContain("需要復原");
    expect(session.repo.getMeta(a.id)?.broken).toBe(true);
    expect(session.repo.getMeta(b.id)?.broken).toBeUndefined();
  });

  /**
   * PR #19 review P1 — 「Preserve venue-only edits before replacing the project」.
   *
   * Someone who spent ten minutes measuring the classroom, calibrating the tile
   * grid or writing the activity description has done REAL WORK, even with not
   * one object on the floor. Both callers of `planHasContent` must see it:
   * the wizard must open a new project rather than fill this one, and loading a
   * saved arrangement must auto-keep what is on screen first.
   *
   * Table-driven on purpose: the failure mode this guards against is somebody
   * adding a user-editable Project field and forgetting the predicate, so every
   * field the review named gets its own row.
   */
  describe("只改場地設定也算有內容", () => {
    const VENUE_ONLY_EDITS: { label: string; edit: (p: Project) => void; check: (p: Project) => void }[] = [
      {
        label: "教室尺寸",
        edit: (p) => void (p.classroom.length = 13.5),
        check: (p) => expect(p.classroom.length).toBe(13.5),
      },
      {
        label: "走廊尺寸",
        edit: (p) => void (p.corridor.width = 2.8),
        check: (p) => expect(p.corridor.width).toBe(2.8),
      },
      {
        label: "地磚尺寸",
        edit: (p) => void (p.tile.width = 0.4),
        check: (p) => expect(p.tile.width).toBe(0.4),
      },
      {
        label: "現場校正",
        edit: (p) => {
          p.calibration.referenceLength = 0.62;
          p.calibration.confirmed = { tile: true };
        },
        check: (p) => expect(p.calibration.confirmed.tile).toBe(true),
      },
      {
        label: "活動說明",
        edit: (p) => void (p.description = "9/24 社課，教室內報到"),
        check: (p) => expect(p.description).toContain("9/24"),
      },
      {
        label: "圖層顯示",
        edit: (p) => void (p.layers.tiles = false),
        check: (p) => expect(p.layers.tiles).toBe(false),
      },
      {
        label: "檢查門檻",
        edit: (p) => void (p.validationSettings.minAisleWidth = 1.2),
        check: (p) => expect(p.validationSettings.minAisleWidth).toBe(1.2),
      },
      {
        label: "自訂素材",
        edit: (p) => {
          p.catalogExtras = [{
            id: "custom:社旗",
            name: "社旗",
            semanticType: "other",
            sourceType: "builtin-procedural",
            category: "custom",
            placementType: "floor",
            dimensions: { width: 0.6, depth: 0.1, height: 1.8 },
            defaultFacingDeg: 0,
            clearanceFront: 0,
            blocksFlow: false,
            kind: "chair",
            icon: "🚩",
            color: "#f1f5f9",
            visualRef: "proc:other",
            tags: ["custom"],
            createdBy: "builtin",
            version: 1,
          }];
        },
        check: (p) => expect(p.catalogExtras).toHaveLength(1),
      },
      {
        label: "場地模板",
        edit: (p) => void (p.venuePresetId = "venue:tku-e310"),
        check: (p) => expect(p.venuePresetId).toBe("venue:tku-e310"),
      },
      {
        label: "活動日期",
        edit: (p) => void (p.eventDate = "2026-09-24"),
        check: (p) => expect(p.eventDate).toBe("2026-09-24"),
      },
    ];

    for (const { label, edit, check } of VENUE_ONLY_EDITS) {
      it(`只改${label}時，精靈開新專案而不是覆蓋`, () => {
        session.bootstrap();
        expect(session.listProjects()).toHaveLength(1);
        store.mutate((p) => edit(p));

        session.createProject({ project: plan("新的活動"), open: true, adoptPristineActive: true });

        // Two projects: the wizard minted its own instead of eating this one.
        expect(session.listProjects()).toHaveLength(2);
        const kept = session.listProjects().find((m) => m.name !== "新的活動");
        expect(kept, `只改${label}的那份專案被覆蓋了`).toBeDefined();
        const reopened = session.repo.openProject(kept!.id);
        expect(reopened.ok).toBe(true);
        if (reopened.ok) check(reopened.project);
      });

      it(`只改${label}時，載入其他排法前也會先保留`, () => {
        session.createProject({ project: plan(`只改${label}`), open: true });
        store.mutate((p) => void p.zones.push(zone("暫時")));
        session.saveLayout("有東西的版本");
        store.mutate((p) => {
          p.zones = [];
          edit(p);
        });

        expect(session.applyLayout("有東西的版本")).toBe(true);

        const autoKept = session.listLayouts().find((n) => n.startsWith("自動保留"));
        expect(autoKept, `只改${label}的排法沒有被保留`).toBeDefined();
        const kept = session.repo.readLayout(session.activeId!, autoKept!);
        expect(kept).toBeTruthy();
        check(kept!);
      });
    }

    it("完全沒動過的專案，精靈仍然直接沿用那一份", () => {
      session.bootstrap();
      session.createProject({ project: plan("新的活動"), open: true, adoptPristineActive: true });

      // The whole point of the pristine path: no ghost card left behind.
      expect(session.listProjects()).toHaveLength(1);
      expect(session.listProjects()[0].name).toBe("新的活動");
    });
  });
});
