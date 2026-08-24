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
  const projectCount = el("strong", { text: "0" });
  const venueCount = el("strong", { text: "0" });
  const empty = el("p", {
    class: "hint projecthome__empty",
    text: "建立第一個活動場佈。按「＋ 建立新專案」開始。",
  });
  const root = el("section", { class: "projecthome" }, [
    el("div", { class: "projecthome__wash", "aria-hidden": "true" }),
    el("div", { class: "projecthome__shell" }, [
      el("header", { class: "projecthome__top" }, [
        el("div", { class: "projecthome__brand" }, [
          el("span", { class: "projecthome__mark", text: "P" }),
          el("span", { text: "Planform" }),
        ]),
        el("span", { class: "projecthome__release", text: "Release 1.0" }),
      ]),
      el("div", { class: "projecthome__hero" }, [
        el("div", { class: "projecthome__hero-copy" }, [
          el("span", { class: "projecthome__eyebrow", text: "活動場佈工作台" }),
          el("h1", { class: "projecthome__title", text: "把現場想清楚，再開始搬。" }),
          el("p", {
            class: "projecthome__lead",
            text: "從真實場地與人數開始，排好巧拼、物資與動線，輸出夥伴一看就懂的場佈圖。",
          }),
          button("＋ 建立新專案", () => deps.onNewProject(), "btn btn--primary projecthome__new"),
        ]),
        el("div", { class: "projecthome__scene", "aria-hidden": "true" }, [
          el("span", { class: "projecthome__scene-stage" }),
          el("span", { class: "projecthome__scene-mats" }),
          el("span", { class: "projecthome__scene-corridor" }),
          el("span", { class: "projecthome__scene-route" }),
        ]),
      ]),
      el("div", { class: "projecthome__summary" }, [
        el("span", {}, [projectCount, document.createTextNode(" 份專案")]),
        el("span", {}, [venueCount, document.createTextNode(" 個場地")]),
        el("span", { text: "本機自動儲存" }),
      ]),
      el("div", { class: "projecthome__sectionhead" }, [
        el("div", {}, [
          el("h2", { text: "我的專案" }),
          el("p", { class: "hint", text: "一場活動一份專案；不同排法留在同一份專案裡。" }),
        ]),
      ]),
      grid,
      empty,
    ]),
  ]);

  const update = (): void => {
    const metas = session.listProjects();
    grid.innerHTML = "";
    empty.style.display = metas.length === 0 ? "block" : "none";
    projectCount.textContent = String(metas.length);
    venueCount.textContent = String(new Set(metas.map((meta) => meta.venueName).filter(Boolean)).size);
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

    const body = el("span", { class: "card__body projectcard__body" }, [
      el("span", { class: "projectcard__preview", "aria-hidden": "true" }, [
        el("span", { class: "projectcard__preview-room" }),
        el("span", { class: "projectcard__preview-field" }),
        el("span", { class: "projectcard__preview-stage" }),
      ]),
      el("span", { class: "projectcard__content" }, [
        el("span", { class: "projectcard__kicker", text: meta.broken ? "需要復原" : "場佈專案" }),
        el("span", { class: "card__title", text: meta.name }),
        el("span", { class: "card__meta", text: cardMetaLine(meta) }),
      ]),
    ]);
    open.append(body);

    if (broken) {
      const recover = button("這份專案需要復原", () => openBrokenMenu(meta), "chip chip--sm");
      card.append(open, recover, more);
    } else {
      card.append(open, more);
    }
    return card;
  }

  function openCardMenu(meta: ProjectMeta): void {
    deps.menu.open(meta.name, [{
      items: [
        {
          label: "重新命名",
          onSelect: () => renameProject(meta),
        },
        {
          label: "複製成新專案",
          onSelect: () => {
            const copy = session.duplicateProject(meta.id);
            if (copy) deps.onToast(`已複製成「${copy.name}」`);
          },
        },
        {
          label: "刪除",
          danger: true,
          onSelect: () => confirmDelete(meta),
        },
      ],
    }]);
  }

  function openBrokenMenu(meta: ProjectMeta): void {
    deps.menu.open(meta.name, [{
      items: [
        {
          label: "下載原始資料",
          onSelect: () => downloadCorruptBody(meta),
        },
        {
          label: "移除這份損壞專案",
          danger: true,
          onSelect: () => confirmDelete(meta),
        },
      ],
    }]);
  }

  function downloadCorruptBody(meta: ProjectMeta): void {
    const raw = session.corruptBody(meta.id);
    if (!raw) {
      deps.onToast("找不到可下載的復原資料");
      return;
    }
    const safeName = meta.name.replace(/[^\w一-龥-]+/g, "_").slice(0, 40) || "需要復原的專案";
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}-原始資料.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function renameProject(meta: ProjectMeta): void {
    const next = window.prompt("專案名稱", meta.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
      deps.onToast("名稱不能空白");
      return;
    }
    session.renameProject(meta.id, trimmed);
    deps.onToast("已重新命名");
  }

  function confirmDelete(meta: ProjectMeta): void {
    const ok = window.confirm(`刪除「${meta.name}」？可在短時間內復原。`);
    if (!ok) return;
    session.deleteProject(meta.id);
  }

  update();
  return { root, update };
}

function cardMetaLine(meta: ProjectMeta): string {
  const bits: string[] = [];
  if (meta.venueName) bits.push(meta.venueName);
  if (meta.participants != null) bits.push(`${meta.participants} 人`);
  bits.push(formatRelative(meta.updatedAt));
  return bits.join(" · ");
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  if (diff < 86_400_000 * 7) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
