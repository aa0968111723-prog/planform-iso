/**
 * Compact overflow menu — the "More" / "View" surface for the single-row header.
 *
 * On a tablet the header may only ever be one row, so anything that does not
 * earn a permanent slot (labels, recenter, snap, simplify, measure, team view)
 * lives here instead of wrapping the header onto a second and third row.
 */

import { button, el } from "./dom";

export interface MenuItem {
  label: string;
  sub?: string;
  active?: boolean;
  danger?: boolean;
  /** Return true to keep the sheet open (for toggles the user may repeat). */
  onSelect: () => boolean | void;
}

export interface MenuGroup {
  title?: string;
  items: MenuItem[];
}

export interface MenuSheetHandles {
  root: HTMLElement;
  open: (title: string, groups: MenuGroup[]) => void;
  close: () => void;
  isOpen: () => boolean;
  /** Re-render the currently open menu (after a toggle changed state). */
  refresh: () => void;
}

export function buildMenuSheet(): MenuSheetHandles {
  const panel = el("div", { class: "menusheet__panel", role: "menu" });
  const titleEl = el("div", { class: "menusheet__title" });
  const bodyEl = el("div", { class: "menusheet__body" });
  const root = el("div", { class: "menusheet", style: "display:none" }, [
    el("div", { class: "menusheet__scrim" }),
    panel,
  ]);
  panel.append(titleEl, bodyEl, button("關閉", () => close(), "btn btn--ghost menusheet__close"));

  let current: { title: string; groups: MenuGroup[] } | null = null;

  const close = (): void => {
    current = null;
    root.style.display = "none";
  };

  const render = (): void => {
    if (!current) return;
    titleEl.textContent = current.title;
    bodyEl.innerHTML = "";
    for (const group of current.groups) {
      if (group.title) bodyEl.append(el("div", { class: "subhead", text: group.title }));
      const row = el("div", { class: "menusheet__group" });
      for (const item of group.items) {
        const cls = `menuitem${item.active ? " menuitem--active" : ""}${item.danger ? " menuitem--danger" : ""}`;
        const b = el("button", { type: "button", class: cls, role: "menuitem" }, [
          el("span", { class: "menuitem__label", text: item.label }),
          ...(item.sub ? [el("span", { class: "menuitem__sub", text: item.sub })] : []),
        ]) as HTMLButtonElement;
        b.setAttribute("aria-pressed", String(!!item.active));
        b.addEventListener("click", () => {
          const keep = item.onSelect();
          if (keep) render();
          else close();
        });
        row.append(b);
      }
      bodyEl.append(row);
    }
  };

  root.querySelector(".menusheet__scrim")?.addEventListener("click", () => close());

  return {
    root,
    open: (title, groups) => {
      current = { title, groups };
      root.style.display = "flex";
      render();
    },
    close,
    isOpen: () => current !== null,
    refresh: render,
  };
}
