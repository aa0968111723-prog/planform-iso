/**
 * Indoor freshman plan overlay — the view a first-time visitor reads in
 * a few seconds: door, front, zones, numbered walk, you-are-here.
 */

import type { App } from "../app/App";
import { layoutFreshmanPlan } from "../core/freshmanPlan";
import { button, el } from "./dom";

export interface FreshmanPlanHandles {
  root: HTMLElement;
  show(): void;
  hide(): void;
  visible(): boolean;
  update(): void;
}

export function buildFreshmanPlan(app: App, opts: { onLayoutChange: () => void }): FreshmanPlanHandles {
  const root = el("section", {
    class: "freshmanplan",
    "data-map-dock": "cover",
  });
  root.hidden = true;
  root.setAttribute("inert", "");
  root.setAttribute("aria-label", "教室室內場佈");

  const head = el("div", { class: "freshmanplan__head" }, [
    el("strong", { text: "教室怎麼走" }),
    el("span", { class: "freshmanplan__front", text: "前方（投影幕）↑" }),
  ]);
  const plot = el("div", { class: "freshmanplan__plot" });
  const legend = el("div", { class: "freshmanplan__legend" });
  const foot = el("p", { class: "freshmanplan__entry" });
  const detail = el("p", { class: "freshmanplan__detail" });
  detail.hidden = true;

  root.append(head, plot, legend, foot, detail);

  let shown = false;

  function svgEl(name: string, attrs: Record<string, string>): SVGElement {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function render(): void {
    const guide = app.freshmanGuide();
    const showDetail = !!app.session.partner?.freshmanDetail;
    const view = layoutFreshmanPlan(app.store.getState(), guide, showDetail);
    plot.innerHTML = "";
    const svg = svgEl("svg", {
      viewBox: "0 0 100 100",
      class: "fplan__svg",
      preserveAspectRatio: "xMidYMid meet",
    });
    svg.setAttribute("aria-hidden", "true");

    for (const box of view.boxes) {
      svg.appendChild(svgEl("rect", {
        class: `fplan__box fplan__box--${box.kind}`,
        x: String(box.x),
        y: String(box.y),
        width: String(Math.max(box.w, 0.8)),
        height: String(Math.max(box.h, 0.8)),
        rx: box.kind === "here" || box.kind === "next" ? "4" : "1.2",
      }));
    }
    for (const arrow of view.arrows) {
      const line = svgEl("line", {
        class: "fplan__arrow",
        x1: String(arrow.from.x),
        y1: String(arrow.from.y),
        x2: String(arrow.to.x),
        y2: String(arrow.to.y),
        "marker-end": "url(#fplan-head)",
      });
      svg.appendChild(line);
      const mx = (arrow.from.x + arrow.to.x) / 2;
      const my = (arrow.from.y + arrow.to.y) / 2;
      const badge = svgEl("circle", {
        class: "fplan__num-bg",
        cx: String(mx),
        cy: String(my),
        r: "2.6",
      });
      const num = svgEl("text", {
        class: "fplan__num",
        x: String(mx),
        y: String(my + 0.9),
        "text-anchor": "middle",
      });
      num.textContent = String(arrow.index);
      svg.appendChild(badge);
      svg.appendChild(num);
    }
    const defs = svgEl("defs", {});
    const marker = svgEl("marker", {
      id: "fplan-head",
      markerWidth: "6",
      markerHeight: "6",
      refX: "5",
      refY: "3",
      orient: "auto",
    });
    marker.appendChild(svgEl("path", { d: "M0,0 L6,3 L0,6 Z", class: "fplan__head" }));
    defs.appendChild(marker);
    svg.insertBefore(defs, svg.firstChild);
    plot.append(svg);

    for (const label of view.labels) {
      const node = el("button", {
        type: "button",
        class: `fplan__label fplan__label--${label.tone}`,
        text: label.text,
      }) as HTMLButtonElement;
      node.style.left = `${label.x}%`;
      node.style.top = `${label.y}%`;
      if (label.id === "here" || label.id === "next" || label.id.startsWith("zone:")) {
        const idx = guide.stops.findIndex((s) =>
          label.id === "here" ? s === guide.stops[guide.stopIndex]
            : label.id === "next" ? s === guide.stops[guide.stopIndex + 1]
              : label.text.includes(s.title));
        if (idx >= 0) {
          node.addEventListener("click", () => app.setFreshmanStop(idx));
        }
      }
      plot.append(node);
    }

    legend.innerHTML = "";
    for (const item of [
      ["🚪", "入口"],
      ["🟩", "地墊"],
      ["👟", "鞋子"],
      ["🎒", "背包"],
      ["👋", "報到"],
      ["🎤", "講師"],
    ]) {
      legend.append(el("span", { class: "fplan__chip" }, [
        el("span", { text: item[0] }),
        el("span", { text: item[1] }),
      ]));
    }
    legend.append(button("① 下一步", () => app.freshmanNextStop(), "chip chip--sm fplan__next"));

    foot.textContent = view.entryCaption;
    detail.hidden = !view.detailLine;
    detail.textContent = view.detailLine ?? "";
  }

  return {
    root,
    show() {
      shown = true;
      root.hidden = false;
      root.removeAttribute("inert");
      render();
      opts.onLayoutChange();
    },
    hide() {
      shown = false;
      root.hidden = true;
      root.setAttribute("inert", "");
      opts.onLayoutChange();
    },
    visible: () => shown,
    update() {
      if (!shown) return;
      render();
    },
  };
}
