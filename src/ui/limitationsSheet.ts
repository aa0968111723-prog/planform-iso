/**
 * 更多 → 已知限制 — the product-facing list of 1.1 / field-only / mock gaps.
 */

import { PRODUCT_LIMITATIONS, LIMITATION_KIND_LABEL } from "../core/productLimitations";
import { button, el } from "./dom";

export interface LimitationsSheetHandles {
  root: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export function buildLimitationsSheet(): LimitationsSheetHandles {
  const list = el("div", { class: "limitsheet__list" });
  for (const item of PRODUCT_LIMITATIONS) {
    list.append(el("article", { class: "limitsheet__item", "data-limitation-id": item.id }, [
      el("div", { class: "limitsheet__item-head" }, [
        el("strong", { class: "limitsheet__title", text: item.title }),
        el("span", { class: "limitsheet__kind", text: LIMITATION_KIND_LABEL[item.kind] }),
      ]),
      el("p", { class: "limitsheet__summary", text: item.summary }),
    ]));
  }

  const panel = el("div", { class: "menusheet__panel limitsheet__panel", role: "dialog", "aria-labelledby": "limitsheet-title" }, [
    el("div", { class: "menusheet__title", id: "limitsheet-title", text: "已知限制" }),
    el("p", {
      class: "hint",
      text: "文件標成 1.1／limitation，或程式裡只有欄位、產品還沒做完的入口。不是故障清單。",
    }),
    list,
  ]);
  const closeBtn = button("關閉", () => close(), "btn btn--ghost menusheet__close");
  panel.append(closeBtn);

  const root = el("div", { class: "menusheet limitsheet", style: "display:none" }, [
    el("div", { class: "menusheet__scrim" }),
    panel,
  ]);

  const close = (): void => {
    root.style.display = "none";
  };

  root.querySelector(".menusheet__scrim")?.addEventListener("click", () => close());

  return {
    root,
    open: () => {
      root.style.display = "flex";
    },
    close,
    isOpen: () => root.style.display !== "none",
  };
}
