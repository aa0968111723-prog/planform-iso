/**
 * Event-flow simulation — Registration Wizard + playback + optimizer cards.
 */

import type { App } from "../app/App";
import { formatSimDuration } from "../core/eventFlow";
import type { OptimizationObjective } from "../core/eventOptimization";
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
  const candidates = app.session.layoutCandidates;
  const opt = app.session.optReport;
  const prepaidCount = Math.round(q.participants * q.prepaidRatio);
  const onsiteCount = q.hasOnsitePayment ? q.participants - prepaidCount : 0;

  const setup = section("報到流程設定", [
    el("p", {
      class: "hint",
      text: "填人數與現場繳費 → 比較方案 → ▶ 播放。不必懂排隊模型。",
    }),
    el("div", { class: "row wrap" }, [
      num("今天幾人", q.participants, 5, (v) => app.updateSimQuick({ participants: Math.max(1, Math.round(v)) }), 1),
      num(
        "多久內到（分）",
        Math.round(q.arrivalWindowSeconds / 60),
        1,
        (v) => app.updateSimQuick({ arrivalWindowSeconds: Math.max(1, v) * 60 }),
        1,
      ),
    ]),
    el("div", { class: "row wrap" }, [
      num(
        "已繳人數",
        prepaidCount,
        1,
        (v) => {
          const prepaid = Math.max(0, Math.min(q.participants, Math.round(v)));
          app.updateSimQuick({
            prepaidRatio: prepaid / Math.max(1, q.participants),
            hasOnsitePayment: prepaid < q.participants,
          });
        },
        0,
      ),
      num(
        "現場繳費",
        onsiteCount,
        1,
        (v) => {
          const onsite = Math.max(0, Math.min(q.participants, Math.round(v)));
          app.updateSimQuick({
            prepaidRatio: (q.participants - onsite) / Math.max(1, q.participants),
            hasOnsitePayment: onsite > 0,
          });
        },
        0,
      ),
    ]),
    el("div", { class: "row wrap" }, [
      num("報到人員", q.checkinStaff, 1, (v) => app.updateSimQuick({ checkinStaff: Math.max(1, Math.round(v)) }), 1),
      num("收費人員", q.paymentStaff, 1, (v) => app.updateSimQuick({ paymentStaff: Math.max(0, Math.round(v)) }), 0),
    ]),
    el("div", { class: "row wrap" }, [
      arrivalChip(app, "uniform", "平均抵達"),
      arrivalChip(app, "front-loaded", "提早到"),
      arrivalChip(app, "back-loaded", "最後到"),
    ]),
    el("div", { class: "row wrap" }, [
      button("比較 A/B/C 方案", () => {
        const list = app.runLayoutWizard();
        app.onToast?.(`已比較 ${list.length} 個場佈方案`);
      }, "btn btn--primary"),
      button("建立流程", () => {
        app.ensureEventScenario(true);
        app.onToast?.("已建立活動流程站點");
      }, "btn btn--ghost"),
    ]),
  ]);

  // Candidates sit directly under the wizard so mobile half/full sheets show
  // metrics without scrolling past transport / advanced blocks.
  const candidateBlock =
    candidates?.length
      ? el("div", { class: "sim-candidates" }, [
          el("div", { class: "subhead", text: "方案比較" }),
          ...candidates.map((c) =>
            el("div", { class: "card smart" }, [
              el("span", { class: "card__body" }, [
                el("span", { class: "card__title", text: c.name }),
                el("span", {
                  class: "card__sub",
                  text: `完成 ${formatSimDuration(c.result.finishTimeSeconds)} · 平均等待 ${formatSimDuration(c.result.avgWaitSeconds)} · 最大排隊 ${c.result.maxQueue} · 人力 ${c.result.staffUsed}`,
                }),
                c.result.bottleneckName
                  ? el("span", { class: "card__sub", text: `瓶頸：${c.result.bottleneckName}` })
                  : el("span", { class: "card__sub", text: "無明顯瓶頸" }),
              ]),
              button("套用", () => app.applyWizardCandidate(c.id), "chip chip--sm chip--primary"),
              button("播放", () => {
                app.session.simResult = c.result;
                app.startEventPlayback();
              }, "chip chip--sm"),
            ]),
          ),
        ])
      : null;

  const advanced = section(
    "進階",
    [
      el("div", { class: "row wrap" }, [
        button("比較同桌／分桌", () => {
          const c = app.compareCheckinPayment();
          app.onToast?.(c.reason);
        }, "chip chip--sm"),
        button(
          q.showHeatmap ? "✓ 熱力圖" : "熱力圖",
          () => app.setShowHeatmap(!q.showHeatmap),
          q.showHeatmap ? "chip chip--sm chip--primary" : "chip chip--sm",
        ),
      ]),
    ],
    q.showAdvanced,
  );

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
    button("最壅塞時刻", () => app.jumpToPeakCongestion(), "chip chip--sm"),
  ]);

  const body: HTMLElement[] = [setup];
  if (candidateBlock) body.push(candidateBlock);
  body.push(advanced, transport);

  if (result) {
    const maxT = Math.max(1, result.finishTimeSeconds);
    const scrub = el("input", {
      type: "range",
      class: "sim-scrubber",
      min: "0",
      max: String(Math.ceil(maxT)),
      step: "1",
      value: String(Math.round(app.session.simTime)),
    }) as HTMLInputElement;
    scrub.addEventListener("input", () => {
      app.seekSimulation(parseFloat(scrub.value));
    });
    body.push(
      el("div", { class: "sim-timeline" }, [
        el("div", {
          class: "hint",
          text: `時間軸 ${formatSimDuration(app.session.simTime)} / ${formatSimDuration(maxT)}`,
        }),
        scrub,
      ]),
    );
  }

  if (playing || result) {
    const lines: string[] = [];
    if (playing) {
      lines.push(
        `播放中 · ${Math.round(app.session.simTime)}s · 場上 ${app.session.simPositions.length} 人`,
      );
    }
    if (result) {
      lines.push(
        `最大排隊 ${result.maxQueue} · 平均等待 ${formatSimDuration(result.avgWaitSeconds)} · 完成 ${formatSimDuration(result.finishTimeSeconds)} · 人力 ${result.staffUsed}`,
      );
      if (result.bottleneckName) {
        lines.push(
          `最塞：${result.bottleneckName}（壅塞約 ${Math.round(result.bottleneckDurationSeconds)}s）`,
        );
      }
    }
    body.push(
      el("div", {
        class: `readout ${result?.bottleneckStationId ? "readout--warn" : ""}`,
      }, lines.map((t) => el("div", { text: t }))),
    );
  }

  if (app.session.simSpatialIssues.length) {
    body.push(el("div", { class: "subhead", text: "空間問題" }));
    for (const iss of app.session.simSpatialIssues.slice(0, 6)) {
      body.push(
        button(
          iss.message,
          () => app.focusSpatialIssue(iss),
          iss.severity === "error" ? "chip chip--sm chip--danger" : "chip chip--sm",
        ),
      );
    }
  }

  body.push(
    section("幫我改善（本地優化）", [
      el("div", { class: "row wrap" }, [
        optBtn(app, "fastest", "最快完成"),
        optBtn(app, "least-wait", "最少等待"),
        optBtn(app, "lowest-max-queue", "最低最大排隊"),
        optBtn(app, "least-staff", "最省人力"),
        optBtn(app, "smoothest-flow", "最順動線"),
      ]),
    ]),
  );

  if (opt) {
    const cards: HTMLElement[] = [
      el("span", { class: "card__title", text: "目前 vs 改善" }),
      el("span", { class: "card__sub", text: opt.summary }),
    ];
    for (const d of opt.deltas) {
      cards.push(el("span", { class: "card__sub", text: `${d.label}：${d.display}` }));
    }
    if (opt.improved) {
      cards.push(
        button("套用改善方案", () => app.applyOptimizedCandidate(), "chip chip--sm chip--primary"),
        button("播放改善方案", () => {
          if (!opt.improved) return;
          app.session.simResult = opt.improved.result;
          app.startEventPlayback();
        }, "chip chip--sm"),
      );
    }
    body.push(el("div", { class: "card smart" }, [el("span", { class: "card__body" }, cards)]));
  }

  if (cmp) {
    body.push(
      el("div", { class: "card smart" }, [
        el("span", { class: "card__body" }, [
          el("span", { class: "card__title", text: "A / B 比較" }),
          el("span", {
            class: "card__sub",
            text: `A 完成 ${formatSimDuration(cmp.a.finishTimeSeconds)} · 最大排隊 ${cmp.a.maxQueue}`,
          }),
          el("span", {
            class: "card__sub",
            text: `B 完成 ${formatSimDuration(cmp.b.finishTimeSeconds)} · 最大排隊 ${cmp.b.maxQueue}`,
          }),
          el("span", { class: "card__sub", text: cmp.reason }),
        ]),
      ]),
    );
  }

  return el("div", {}, body);
}

function arrivalChip(
  app: App,
  profile: "uniform" | "front-loaded" | "back-loaded",
  label: string,
): HTMLButtonElement {
  const on = app.session.simQuick.arrivalProfile === profile;
  return button(
    label,
    () => app.updateSimQuick({ arrivalProfile: profile }),
    on ? "chip chip--sm chip--primary" : "chip chip--sm",
  );
}

function optBtn(app: App, objective: OptimizationObjective, label: string): HTMLButtonElement {
  return button(label, () => app.runOptimizer(objective), "chip chip--sm");
}
