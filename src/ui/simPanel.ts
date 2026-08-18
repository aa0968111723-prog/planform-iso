/**
 * Event-flow simulation Quick Setup + playback controls + result cards.
 */

import type { App } from "../app/App";
import { button, el, num, section } from "./dom";

export function buildSimPanel(app: App): HTMLElement {
  const root = el("div", { class: "sim-panel" });
  root.append(render(app));
  return root;
}

export function refreshSimPanel(root: HTMLElement, app: App): void {
  root.innerHTML = "";
  root.append(render(app));
}

function render(app: App): HTMLElement {
  const q = app.session.simQuick;
  const playing = app.session.simPlaying;
  const paused = app.session.simPaused;
  const result = app.session.simResult;
  const cmp = app.session.simCompare;

  const setup = section("活動流程 Quick Setup", [
    el("p", {
      class: "hint",
      text: "設定人數與現場收費後按「▶ 模擬」。本地離散事件，不需 AI。",
    }),
    el("div", { class: "row wrap" }, [
      num("人數", q.participants, 5, (v) => app.updateSimQuick({ participants: Math.max(1, Math.round(v)) }), 1),
      num(
        "抵達窗口 (分)",
        Math.round(q.arrivalWindowSeconds / 60),
        1,
        (v) => app.updateSimQuick({ arrivalWindowSeconds: Math.max(1, v) * 60 }),
        1,
      ),
    ]),
    el("div", { class: "row wrap" }, [
      num(
        "已繳比例 %",
        Math.round(q.prepaidRatio * 100),
        5,
        (v) => app.updateSimQuick({ prepaidRatio: Math.max(0, Math.min(100, v)) / 100 }),
        0,
      ),
      button(
        q.hasOnsitePayment ? "✓ 現場收費" : "現場收費",
        () => app.updateSimQuick({ hasOnsitePayment: !q.hasOnsitePayment }),
        q.hasOnsitePayment ? "chip chip--sm chip--primary" : "chip chip--sm",
      ),
    ]),
    el("div", { class: "row wrap" }, [
      num("報到人數", q.checkinStaff, 1, (v) => app.updateSimQuick({ checkinStaff: Math.max(1, Math.round(v)) }), 1),
      num("收費人數", q.paymentStaff, 1, (v) => app.updateSimQuick({ paymentStaff: Math.max(1, Math.round(v)) }), 1),
    ]),
    el("div", { class: "row wrap" }, [
      button("建立／更新流程", () => {
        app.ensureEventScenario(true);
        app.onToast?.("已建立活動流程站點");
      }, "btn btn--ghost"),
      button("比較同桌／分桌", () => {
        const c = app.compareCheckinPayment();
        app.onToast?.(c.reason);
      }, "btn btn--ghost"),
    ]),
  ]);

  const transport = el("div", { class: "row wrap sim-transport" }, [
    playing
      ? button(paused ? "繼續" : "暫停", () => app.pauseSimulation(), "btn")
      : button("▶ 模擬", () => app.startSimulation(), "btn btn--primary"),
    button("重開", () => app.restartSimulation(), "chip chip--sm"),
    button("停止", () => app.stopSimulation(), "chip chip--sm"),
    ...([1, 2, 5] as const).map((s) =>
      button(
        `${s}×`,
        () => app.setSimSpeed(s),
        app.session.simSpeed === s ? "chip chip--sm chip--primary" : "chip chip--sm",
      ),
    ),
  ]);

  const body: HTMLElement[] = [setup, transport];

  if (playing || result) {
    const lines: string[] = [];
    if (playing) {
      lines.push(
        `播放 ${app.session.simMode === "event-flow" ? "活動流程" : "動線預覽"} · t=${Math.round(app.session.simTime)}s · 場上 ${app.session.simPositions.length} 人`,
      );
      const bn = app.session.bottlenecks.length;
      if (bn) lines.push(`⚠ 目前 ${bn} 處排隊偏多`);
    }
    if (result) {
      for (const line of result.summaryLines) lines.push(line);
      const top = [...result.stations].sort((a, b) => b.maxQueue - a.maxQueue).slice(0, 4);
      for (const s of top) {
        lines.push(
          `· ${s.name}：最大排隊 ${s.maxQueue}，平均等待 ${Math.round(s.avgWaitSeconds)}s，利用率 ${Math.round(s.utilization * 100)}%`,
        );
      }
    }
    body.push(
      el("div", {
        class: `readout ${result?.bottleneckStationId ? "readout--warn" : ""}`,
      }, lines.map((t) => el("div", { text: t }))),
    );
  }

  if (cmp) {
    body.push(
      el("div", { class: "card smart" }, [
        el("span", { class: "card__body" }, [
          el("span", { class: "card__title", text: "A / B 比較" }),
          el("span", {
            class: "card__sub",
            text: `A 完成 ${Math.round(cmp.a.finishTimeSeconds)}s · 最大排隊 ${Math.max(0, ...cmp.a.stations.map((s: { maxQueue: number }) => s.maxQueue))}`,
          }),
          el("span", {
            class: "card__sub",
            text: `B 完成 ${Math.round(cmp.b.finishTimeSeconds)}s · 最大排隊 ${Math.max(0, ...cmp.b.stations.map((s: { maxQueue: number }) => s.maxQueue))}`,
          }),
          el("span", { class: "card__sub", text: cmp.reason }),
        ]),
      ]),
    );
  }

  return el("div", {}, body);
}
