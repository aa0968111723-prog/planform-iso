/**
 * 我的專案 — the first screen, and the only place a project is created,
 * renamed, duplicated or deleted.
 *
 * Modelled on Partner Mode, not on Quick Start: this is a different
 * application surface (a `data-screen` attribute plus a CSS block that hides
 * the editor chrome), because it is persistent and re-enterable. Quick Start's
 * self-removing overlay would be the wrong shape.
 *
 * Everything renders from the index alone — no project body is ever parsed to
 * draw this screen. That is the whole defence against one corrupt file taking
 * the library down with it.
 */

import type { ProjectSession, ToastUndo } from "../state/projectSession";
import type { ProjectMeta } from "../state/projectStorage";
import type { MenuSheetHandles } from "./menuSheet";
import { button, el } from "./dom";

export interface ProjectHomeDeps {
  session: ProjectSession;
  /** The UI's existing menu sheet: a bottom sheet on compact, a dialog on desktop. */
  menu: MenuSheetHandles;
  onNewProject: () => void;
  onToast: (message: string, undo?: ToastUndo) => void;
}

export interface ProjectHomeHandle {
  root: HTMLElement;
  update(): void;
}

export function buildProjectHome(deps: ProjectHomeDeps): ProjectHomeHandle {
  const { session } = deps;

  const grid = el("div", { class: "cardgrid projecthome__grid" });
  const empty = el("p", {
    class: "hint projecthome__empty",
    text: "還沒有專案，按「＋ 建立新專案」開始。",
  });
  const root = el("section", { class: "projecthome" }, [
    el("header", { class: "projecthome__top" }, [
      el("h1", { class: "projecthome__title", text: "我的專案" }),
      button("＋ 建立新專案", () => deps.onNewProject(), "btn btn--primary projecthome__new"),
    ]),
    el("p", {
      class: "hint projecthome__hint",
      text: "一場活動一份專案。同一場活動的不同排法，請在專案裡的「分享 / 匯出」存成場佈。",
    }),
    grid,
    empty,
  ]);

  const update = (): void => {
    const metas = session.listProjects();
    grid.innerHTML = "";
    empty.style.display = metas.length === 0 ? "block" : "none";
    for (const meta of metas) grid.append(renderCard(meta));
  };

  function renderCard(meta: ProjectMeta): HTMLElement {
    const broken = meta.broken === true;
    const card = el("div", {
      class: `card projectcard${broken ? " projectcard--broken" : ""}`,
      "data-project-id": meta.id,
    });

    const open = el("button", {
      type: "button",
      class: "projectcard__open",
      "aria-label": `開啟 ${meta.name}`,
      disabled: broken,
    }) as HTMLButtonElement;
    if (!broken) open.addEventListener("click", () => session.openProject(meta.id));

    const more = button("⋯", () => openCardMenu(meta), "chip chip--sm projectcard__more");
    more.setAttribute("aria-label", `${meta.name} 的更多動作`);

    const body = el("span", { class: "card__body" }, [
      el("span", { class: "card__title", text: meta.name }),
      el("span", { class: "card__sub", text: broken ? "這份專案需要復原" : describe(meta) }),
      el("span", { class: "card__sub card__sub--dim", text: broken ? "" : relativeTime(meta.updatedAt) }),
    ]);

    card.append(open, el("span", { class: "card__icon", text: broken ? "⚠️" : "🗺️" }), body, more);
    return card;
  }

  function openCardMenu(meta: ProjectMeta): void {
    if (meta.broken) {
      // A broken project offers exactly two honest actions: take the bytes
      // away, or let them go. Nothing here pretends it can be opened.
      deps.menu.open(meta.name, [
        {
          items: [
            {
              label: "下載這份的原始資料",
              sub: "無法讀取的內容，可留著等修復",
              onSelect: () => downloadRaw(meta),
            },
            { label: "刪除", danger: true, onSelect: () => confirmDelete(meta) },
          ],
        },
      ]);
      return;
    }

    deps.menu.open(meta.name, [
      {
        items: [
          { label: "開啟", onSelect: () => void session.openProject(meta.id) },
          {
            label: "重新命名",
            sub: meta.name,
            onSelect: () => {
              const next = window.prompt("專案名稱", meta.name);
              if (next && next.trim()) session.renameProject(meta.id, next.trim());
              // Returning true keeps the sheet open so the new name is visible.
              return true;
            },
          },
          {
            label: "複製",
            sub: "整份複製：場地、地墊、物資、動線、區域",
            onSelect: () => void session.duplicateProject(meta.id),
          },
          { label: "刪除", danger: true, onSelect: () => confirmDelete(meta) },
        ],
      },
    ]);
  }

  function confirmDelete(meta: ProjectMeta): void {
    // No 「此動作無法復原」 here: it IS undoable, and the toast that says so
    // is rendered above this screen.
    if (!window.confirm(`確定刪除專案「${meta.name}」？`)) return;
    session.deleteProject(meta.id);
  }

  function downloadRaw(meta: ProjectMeta): void {
    const raw = session.repo.corruptBody(meta.id);
    if (!raw) {
      deps.onToast("找不到這份專案的原始資料");
      return;
    }
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const a = el("a", { href: url, download: `planform-${meta.name}-原始資料.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  update();
  return { root, update };
}

/** 「E310 · 60 人」 — each half is omitted when the body never supplied it. */
function describe(meta: ProjectMeta): string {
  const parts: string[] = [];
  if (meta.venueName) parts.push(meta.venueName);
  if (typeof meta.participants === "number") parts.push(`${meta.participants} 人`);
  if (meta.eventDate) parts.push(meta.eventDate);
  return parts.join(" · ");
}

function relativeTime(at: number): string {
  if (!at) return "";
  const diff = Date.now() - at;
  if (diff < 60_000) return "剛剛編輯";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前編輯`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前編輯`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前編輯`;
  const d = new Date(at);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 編輯`;
}
