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

  /** Undo buffer for the most recent delete, so a mis-tap is recoverable. */
  let lastDeleted: { meta: ProjectMeta; body: string | null } | null = null;
  let undoTimer: number | null = null;

  const toast = (message: string, ok = true): void => cb.onToast?.(message, ok);

  const clearUndo = (): void => {
    lastDeleted = null;
    if (undoTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(undoTimer);
      undoTimer = null;
    }
  };

  const renderUndoBar = (): HTMLElement | null => {
    if (!lastDeleted) return null;
    const name = lastDeleted.meta.name;
    return el("div", { class: "projhome__undo" }, [
      el("span", { text: `已刪除「${name}」` }),
      button("復原", () => {
        if (!lastDeleted) return;
        const restoredId = lastDeleted.meta.id;
        const ok = ProjectRepository.restoreProject(lastDeleted);
        if (ok) cb.onRestored?.(restoredId);
        clearUndo();
        refresh();
        toast(ok ? `已復原「${name}」` : "無法復原這份專案", ok);
      }, "chip chip--accent"),
    ]);
  };

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
    clearUndo();
    lastDeleted = snapshot;
    if (typeof window !== "undefined") {
      undoTimer = window.setTimeout(() => {
        lastDeleted = null;
        undoTimer = null;
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
    const undo = renderUndoBar();
    if (undo) body.append(undo);

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

  return {
    root,
    refresh,
    show: () => {
      clearUndo();
      refresh();
      root.style.display = "block";
      root.scrollTop = 0;
    },
    hide: () => {
      clearUndo();
      root.style.display = "none";
    },
    isVisible: () => root.style.display !== "none",
  };
}
