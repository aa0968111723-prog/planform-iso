/**
 * 模擬活動 — plain-language quick setup + playback + results.
 *
 * First level asks only what a field volunteer knows: 幾個人來、幾個人現場
 * 繳費、幾個工作人員、多久內到齊. Engineering readouts (utilization, per-
 * station tables, A/B internals) live in the collapsed 進階 section.
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

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m <= 0) return `${rest} 秒`;
  if (rest === 0) return `${m} 分鐘`;
  return `${m} 分 ${rest} 秒`;
}

function render(app: App): HTMLElement {
  const q = app.session.simQuick;
  const playing = app.session.simPlaying;
  const paused = app.session.simPaused;
  const result = app.session.simResult;
  const cmp = app.session.simCompare;
  const onsiteCount = Math.round(q.participants * (1 - q.prepaidRatio));

  const setup = section("模擬活動", [
    el("p", {
      class: "hint",
      text: "填人數與人力，按「▶ 模擬」看會不會塞車。不用網路、不用 AI。",
    }),
    el("div", { class: "row wrap" }, [
      num("人數", q.participants, 5, (v) => app.updateSimQuick({ participants: Math.max(1, Math.round(v)) }), 1),
      num(
        "其中現場繳費",
        onsiteCount,
        1,
        (v) => {
          const cnt = Math.max(0, Math.min(q.participants, Math.round(v)));
          app.updateSimQuick({
            prepaidRatio: q.participants > 0 ? 1 - cnt / q.participants : 1,
            hasOnsitePayment: cnt > 0,
          });
        },
        0,
      ),
    ]),
    el("div", { class: "row wrap" }, [
      num("報到人力", q.checkinStaff, 1, (v) => app.updateSimQuick({ checkinStaff: Math.max(1, Math.round(v)) }), 1),
      num("收費人力", q.paymentStaff, 1, (v) => app.updateSimQuick({ paymentStaff: Math.max(1, Math.round(v)) }), 1),
      num(
        "多久內到齊 (分)",
        Math.round(q.arrivalWindowSeconds / 60),
        5,
        (v) => app.updateSimQuick({ arrivalWindowSeconds: Math.max(1, v) * 60 }),
        1,
      ),
    ]),
  ]);

  const transport = el("div", { class: "row wrap sim-transport" }, [
    playing
      ? button(paused ? "繼續" : "暫停", () => app.pauseSimulation(), "btn")
      : button("▶ 模擬", () => app.startSimulation(), "btn btn--primary"),
    button("重開", () => app.restartSimulation(), "chip chip--sm"),
    button("停止", () => app.stopSimulation(), "chip chip--sm"),
    ...([["慢", 90], ["正常", 45], ["快", 20]] as [string, number][]).map(([label, secs]) => {
      const target = Math.max(1, (app.session.simResult?.finishTimeSeconds ?? 600) / secs);
      const active = Math.abs(app.session.simSpeed - target) < 0.01;
      return button(label, () => app.setSimSpeed(target), active ? "chip chip--sm chip--primary" : "chip chip--sm");
    }),
  ]);

  const body: HTMLElement[] = [setup, transport];

  if (playing) {
    const lines = [
      `模擬中 · 已進行 ${fmtDuration(app.session.simTime)} · 場上 ${app.session.simPositions.length} 人`,
    ];
    const bn = app.session.bottlenecks.length;
    if (bn) lines.push(`⚠ 目前 ${bn} 個地方排隊偏多`);
    body.push(el("div", { class: "readout" }, lines.map((t) => el("div", { text: t }))));
  }

  // Finished results and animated playback are separate states.
  if (result && !playing) {
    const maxQueue = result.maxQueue;
    const avgWait = result.avgWaitSeconds;
    const worst = result.stations.find((s) => s.stationId === result.bottleneckStationId) ??
      (result.bottleneckName ? { name: result.bottleneckName } : undefined);
    const lines = [
      `最多排隊：${maxQueue} 人`,
      `平均等待：${fmtDuration(avgWait)}`,
      worst ? `最塞：${worst.name}` : "沒有明顯塞車點 ✅",
      `全部完成：約 ${fmtDuration(result.finishTimeSeconds)}`,
    ];
    for (const b of result.spatialBottlenecks) {
      lines.push(b.kind === "corridor"
        ? `走廊出現排隊溢出：多出 ${b.count} 人，請提早分流或增加人手`
        : `門口通行受阻：約 ${b.count} 人受到影響`);
    }
    body.push(
      el("div", {
        class: `readout sim-result ${result.bottleneckStationId || result.spatialBottlenecks.length ? "readout--warn" : ""}`,
      }, lines.map((t) => el("div", { text: t }))),
    );
    body.push(
      el("div", { class: "row wrap" }, [
        button("✦ 幫我改善", () => app.onImprove?.(), "btn btn--ghost"),
      ]),
    );
  }

    if (result && !playing) body.push(el("div", { class: "row wrap" }, [
      button("▶ 播放走位", () => app.replaySimulation(), "btn btn--ghost"),
    ]));
  if (cmp) {
    body.push(
      el("div", { class: "card smart" }, [
        el("span", { class: "card__body" }, [
          el("span", { class: "card__title", text: "同桌 / 分桌 比較" }),
          el("span", {
            class: "card__sub",
            text: `同桌：約 ${fmtDuration(cmp.a.finishTimeSeconds)} 完成 · 最多排 ${Math.max(0, ...cmp.a.stations.map((s: { maxQueue: number }) => s.maxQueue))} 人`,
          }),
          el("span", {
            class: "card__sub",
            text: `分桌：約 ${fmtDuration(cmp.b.finishTimeSeconds)} 完成 · 最多排 ${Math.max(0, ...cmp.b.stations.map((s: { maxQueue: number }) => s.maxQueue))} 人`,
          }),
          el("span", {
            class: "card__sub",
            text: `C 走廊分流：共 ${fmtDuration(cmp.c.finishTimeSeconds)} 完成・最多排 ${cmp.c.maxQueue} 人`,
          }),
          el("span", { class: "card__sub", text: cmp.reason }),
        ]),
      ]),
    );
  }

  const advancedBody: HTMLElement[] = [
    el("div", { class: "row wrap" }, [
      button("建立／更新流程站點", () => {
        app.ensureEventScenario(true);
        app.onToast?.("已依目前場佈建立報到/收費/入座站點");
      }, "btn btn--ghost"),
      button("比較同桌／分桌", () => {
        const c = app.compareCheckinPayment();
        app.onToast?.(c.reason);
      }, "btn btn--ghost"),
    ]),
  ];
  advancedBody.push(
    el("div", { class: "row wrap" }, [
      button(
        `到場節奏：${q.arrivalProfile === "uniform" ? "陸續到" : "快開始才到"}`,
        () => app.updateSimQuick({ arrivalProfile: q.arrivalProfile === "uniform" ? "front-loaded" : "uniform" }),
        "btn btn--ghost",
      ),
    ]),
  );
  if (result) {
    const top = [...result.stations].sort((a, b) => b.maxQueue - a.maxQueue).slice(0, 6);
    advancedBody.push(
      el("div", { class: "readout" }, [
        ...result.summaryLines.map((t) => el("div", { text: t })),
        ...top.map((s) =>
          el("div", {
            text: `· ${s.name}：最大排隊 ${s.maxQueue} · 平均等待 ${fmtDuration(s.avgWaitSeconds)} · 利用率 ${Math.round(s.utilization * 100)}%`,
          }),
        ),
      ]),
    );
  }
  body.push(section("進階（站點與數據）", advancedBody, false));

  return el("div", {}, body);
}
