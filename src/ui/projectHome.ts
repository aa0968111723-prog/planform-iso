/**
 * Project Home — 「我的專案」.
 *
 * The first level of the app: a list of the club's plans and one obvious way
 * to start a new one. Deliberately not a dashboard. A 場務組 volunteer opens
 * this on a phone the evening of an event and needs two things — find last
 * week's 社課, or make this week's.
 *
 * Layout is cards only: one column on a phone, two on a tablet, three on a
 * desktop. No sidebar, no table.
 */

import { ProjectRepository, type ProjectMeta } from "../state/projectRepository";
import { venuePresetById } from "../core/venues";
import { button, el } from "./dom";

export interface ProjectHomeCallbacks {
  /** Open a project in the editor. */
  onOpen: (id: string) => void;
  /** Start the new-project wizard. */
  onNew: () => void;
  /**
   * A project was removed. The editor must let go of it — a Store still bound
   * to a deleted id would recreate it on the next autosave.
   */
  onDeleted?: (id: string) => void;
  /** A deleted project was restored, so the editor may bind it again. */
  onRestored?: (id: string) => void;
  onToast?: (message: string, ok?: boolean) => void;
}

export interface ProjectHomeHandles {
  root: HTMLElement;
  refresh: () => void;
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
}

/** "2 分鐘前" — a volunteer wants recency, not a timestamp. */
export function relativeTime(then: number, now = Date.now()): string {
  if (!then) return "尚未儲存";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return "剛剛修改";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} 分鐘前修改`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前修改`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前修改`;
  return new Date(then).toLocaleDateString("zh-TW");
}

/** The card's second line: venue · head count · optional date. */
export function cardSubtitle(meta: ProjectMeta): string {
  const parts: string[] = [];
  const venue = meta.venueName ?? (meta.venuePresetId ? venuePresetById(meta.venuePresetId)?.name : undefined);
  if (venue) parts.push(venue);
  if (meta.participants) parts.push(`${meta.participants} 人`);
  if (meta.eventDate) parts.push(meta.eventDate);
  return parts.join(" · ") || "尚未設定場地";
}

export function buildProjectHome(cb: ProjectHomeCallbacks): ProjectHomeHandles {
  const grid = el("div", { class: "projhome__grid" });
  const body = el("div", { class: "projhome__body" });
  const root = el("div", { class: "projhome", style: "display:none" }, [
    el("div", { class: "projhome__inner" }, [
      el("header", { class: "projhome__head" }, [
        el("h1", { class: "projhome__title", text: "我的專案" }),
        button("＋ 新建專案", () => cb.onNew(), "btn btn--primary projhome__new"),
      ]),
      body,
    ]),
  ]);

  /**
   * Undo buffers for recent deletes — one per delete, not one in total.
   * A single slot lost data: after 刪除 A the storage key is already gone and
   * the snapshot in memory is the only copy left, so deleting B before pressing
   * 復原 threw A away for good, silently. Tidying up several old plans in a row
   * is exactly when that happens.
   */
  interface PendingDelete {
    snapshot: { meta: ProjectMeta; body: string | null };
    timer: number | null;
  }
  const pendingDeletes: PendingDelete[] = [];
  const MAX_PENDING_DELETES = 10;

  const toast = (message: string, ok = true): void => cb.onToast?.(message, ok);

  const clearTimer = (pending: PendingDelete): void => {
    if (pending.timer !== null && typeof window !== "undefined") window.clearTimeout(pending.timer);
    pending.timer = null;
  };

  /** Drop one pending delete (restored, or its window expired). */
  const forget = (id: string): void => {
    const at = pendingDeletes.findIndex((p) => p.snapshot.meta.id === id);
    if (at < 0) return;
    clearTimer(pendingDeletes[at]);
    pendingDeletes.splice(at, 1);
  };

  const renderUndoBars = (): HTMLElement[] =>
    // Newest first: the one most likely to be a mis-tap sits nearest the top.
    [...pendingDeletes].reverse().map((pending) => {
      const { meta } = pending.snapshot;
      return el("div", { class: "projhome__undo" }, [
        el("span", { text: `已刪除「${meta.name}」` }),
        button("復原", () => {
          const ok = ProjectRepository.restoreProject(pending.snapshot);
          if (ok) cb.onRestored?.(meta.id);
          forget(meta.id);
          refresh();
          toast(ok ? `已復原「${meta.name}」` : "無法復原這份專案", ok);
        }, "chip chip--accent"),
      ]);
    });

  const promptRename = (meta: ProjectMeta): void => {
    const next = window.prompt("專案名稱", meta.name);
    if (next === null) return;
    const updated = ProjectRepository.renameProject(meta.id, next);
    if (!updated) {
      toast("名稱不能是空白", false);
      return;
    }
    refresh();
    toast(`已改名為「${updated.name}」`);
  };

  const doDuplicate = (meta: ProjectMeta): void => {
    const copy = ProjectRepository.duplicateProject(meta.id);
    if (!copy) {
      toast("這份專案讀不出來，無法複製", false);
      return;
    }
    refresh();
    toast(`已複製成「${copy.name}」，可以直接改日期`);
  };

  const doDelete = (meta: ProjectMeta): void => {
    // Deleting a whole event plan is not something to do on a stray tap.
    if (!window.confirm(`確定刪除「${meta.name}」？`)) return;
    const snapshot = ProjectRepository.deleteProject(meta.id);
    if (!snapshot) {
      toast("找不到這份專案", false);
      return;
    }
    cb.onDeleted?.(meta.id);
    const pending: PendingDelete = { snapshot, timer: null };
    pendingDeletes.push(pending);
    // Only a runaway tap streak reaches the cap; evicting the oldest is the
    // one case where bytes are still let go, and it takes 11 deletes in 20s.
    while (pendingDeletes.length > MAX_PENDING_DELETES) {
      const evicted = pendingDeletes.shift();
      if (evicted) clearTimer(evicted);
    }
    if (typeof window !== "undefined") {
      pending.timer = window.setTimeout(() => {
        forget(meta.id);
        refresh();
      }, 20_000);
    }
    refresh();
  };

  const buildCard = (meta: ProjectMeta): HTMLElement => {
    const opened = ProjectRepository.openProject(meta.id);
    const broken = !opened.ok;

    const thumb = meta.thumbnail
      ? el("img", { class: "projcard__thumb", src: meta.thumbnail, alt: "" })
      : el("div", { class: "projcard__thumb projcard__thumb--empty", text: broken ? "⚠" : "▦" });

    const open = (): void => {
      if (broken) {
        toast("這份專案需要復原，請先用「下載原始資料」取回內容", false);
        return;
      }
      cb.onOpen(meta.id);
    };

    const title = el("button", {
      type: "button",
      class: "projcard__open",
    }, [
      el("span", { class: "projcard__name", text: meta.name }),
      el("span", { class: "projcard__sub", text: broken ? "這份專案需要復原" : cardSubtitle(meta) }),
      el("span", { class: "projcard__time", text: broken ? "" : relativeTime(meta.updatedAt) }),
    ]) as HTMLButtonElement;
    title.addEventListener("click", open);

    const actions = el("div", { class: "projcard__actions" }, broken
      ? [
        button("下載原始資料", () => downloadCorrupt(meta), "chip chip--sm"),
        button("刪除", () => doDelete(meta), "chip chip--sm chip--danger"),
      ]
      : [
        button("開啟", open, "chip chip--sm chip--primary"),
        button("重新命名", () => promptRename(meta), "chip chip--sm"),
        button("複製", () => doDuplicate(meta), "chip chip--sm"),
        button("刪除", () => doDelete(meta), "chip chip--sm chip--danger"),
      ]);

    return el("div", {
      class: `projcard${broken ? " projcard--broken" : ""}`,
      "data-project-id": meta.id,
    }, [thumb, title, actions]);
  };

  const downloadCorrupt = (meta: ProjectMeta): void => {
    const raw = ProjectRepository.corruptBody(meta.id);
    if (!raw) {
      toast("沒有可以取回的原始資料", false);
      return;
    }
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const a = el("a", { href: url, download: `${meta.name}-原始資料.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const renderEmpty = (): HTMLElement =>
    el("div", { class: "projhome__empty" }, [
      el("div", { class: "projhome__empty-icon", text: "🗂" }),
      el("p", { class: "projhome__empty-title", text: "還沒有任何專案" }),
      el("p", { class: "hint", text: "每一場活動一個專案。建一個新的，選好場地就能開始排。" }),
      button("＋ 新建專案", () => cb.onNew(), "btn btn--big btn--primary"),
    ]);

  const refresh = (): void => {
    const projects = ProjectRepository.listProjects();
    body.innerHTML = "";
    for (const bar of renderUndoBars()) body.append(bar);

    if (!projects.length) {
      body.append(renderEmpty());
      return;
    }

    grid.innerHTML = "";
    for (const meta of projects) grid.append(buildCard(meta));
    body.append(
      el("p", { class: "projhome__count hint", text: `${projects.length} 個專案 · 最近使用的排在前面` }),
      grid,
    );
  };

  /** Leaving 我的專案 ends every undo window, as it always has. */
  const forgetAll = (): void => {
    for (const pending of pendingDeletes) clearTimer(pending);
    pendingDeletes.length = 0;
  };

  return {
    root,
    refresh,
    show: () => {
      forgetAll();
      refresh();
      root.style.display = "block";
      root.scrollTop = 0;
    },
    hide: () => {
      forgetAll();
      root.style.display = "none";
    },
    isVisible: () => root.style.display !== "none",
  };
}
