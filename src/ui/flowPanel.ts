/**
 * 互動流程 — one panel for every plan this tool rehearses.
 *
 * It replaces `simPanel.ts` (classroom quick setup) and `boothSimPanel.ts`
 * (booth parameters). Two panels meant two ideas of what a plan is, and the
 * booth one could only ever edit the eight things its engine knew about.
 *
 * Two shapes, decided by the plan itself:
 *   A. no step list yet → the quick setup the classroom has always had, plus a
 *      READ-ONLY view of the flow it produces and one button to take it over;
 *   B. a step list → the list itself, editable, with the fork of each step
 *      inline underneath it.
 *
 * The rule that keeps shape B a list rather than a node editor: THE ROW ORDER
 * IS THE FLOW. ↑/↓ swap two rows and the flow genuinely changes; a jump is
 * written only by a skip option or a table result, and when one exists the row
 * says so in words.
 */

import type { App } from "../app/App";
import { audienceJoiners, stationChoices } from "../core/interactionCompile";
import type {
  InteractionOption,
  InteractionStep,
  InteractionTemplate,
} from "../core/model";
import { button, el, num, section, selectField, textField } from "./dom";

export function buildFlowPanel(app: App): HTMLElement {
  const root = el("div", { class: "sim-panel flow-panel" });
  refreshFlowPanel(root, app);
  return root;
}

/** Structure last drawn into a root, so playback can patch instead of rebuild. */
const lastStructure = new WeakMap<HTMLElement, string>();

/**
 * Playback pushes new numbers several times a second. Rebuilding the whole
 * panel that often replaced every node between a finger going down and coming
 * up — 暫停 was genuinely unclickable while the crowd was walking. So when only
 * the live numbers changed, those alone are patched in place.
 */
export function refreshFlowPanel(root: HTMLElement, app: App): void {
  const sig = structureSignature(app);
  if (lastStructure.get(root) === sig && root.firstChild) {
    patchLiveValues(root, app);
    return;
  }
  lastStructure.set(root, sig);
  root.innerHTML = "";
  root.append(render(app));
}

/** Everything whose change adds, removes or relabels a control. */
function structureSignature(app: App): string {
  const t = app.flowTemplate();
  const s = app.session;
  return JSON.stringify({
    flow: t
      ? {
        id: t.id,
        steps: t.steps.map((step) => [
          step.id, step.name, step.stationId ?? "", step.avgSeconds, step.next ?? "",
          step.branch?.kind ?? "",
          step.branch?.kind === "chance" ? step.branch.options.map((o) => [o.id, o.label, o.weight, o.extraSeconds ?? 0, o.next ?? ""]) : null,
          step.branch?.kind === "match" ? [step.branch.on, step.branch.rules.map((r) => [r.when, r.label])] : null,
        ]),
        stations: t.stations.map((st) => [st.id, st.name, st.staffRoleId ?? "", st.selfService ?? false, st.parallelServers, st.queueCapacity]),
        staff: t.staff.map((r) => [r.id, r.name, r.count]),
        audience: t.audience,
        mine: app.myFlowTemplates().map((m) => [m.id, m.name, m.stepCount]),
      }
      : null,
    quick: t ? null : s.simQuick,
    scenarioSteps: t ? null : (app.activeScenario()?.stations.map((st) => st.name) ?? []),
    playing: s.simPlaying,
    paused: s.simPaused,
    hasResult: !!s.simResult,
    resultId: s.simResult?.scenarioId ?? null,
    finish: s.simResult?.finishTimeSeconds ?? 0,
    compare: !!s.simCompare,
  });
}

function patchLiveValues(root: HTMLElement, app: App): void {
  const node = root.querySelector<HTMLElement>("[data-live-clock]");
  if (node) node.textContent = liveClockText(app);
}

function liveClockText(app: App): string {
  const s = app.session;
  if (!s.simPlaying) return "";
  return `播放中 · 已進行 ${fmt(s.simTime)} · 場上 ${s.simPositions.length} 人`;
}

function fmt(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const rest = total % 60;
  if (m < 60) return rest ? `${m} 分 ${rest} 秒` : `${m} 分鐘`;
  const h = Math.floor(m / 60);
  const restM = m % 60;
  return restM ? `${h} 小時 ${restM} 分` : `${h} 小時`;
}

function render(app: App): HTMLElement {
  const template = app.flowTemplate();
  return template ? renderFlow(app, template) : renderQuickSetup(app);
}

// --- shape A: quick setup, plus the flow it produces -----------------------

function renderQuickSetup(app: App): HTMLElement {
  const q = app.session.simQuick;
  const onsiteCount = Math.round(q.participants * (1 - q.prepaidRatio));
  const scenario = app.activeScenario();

  const setup = section("模擬活動", [
    el("p", { class: "hint", text: "填人數與人力，按「▶ 模擬」看會不會塞車。不用網路、不用 AI。" }),
    el("div", { class: "row wrap" }, [
      num("人數", q.participants, 5, (v) => app.updateSimQuick({ participants: Math.max(1, Math.round(v)) }), 1),
      num("其中現場繳費", onsiteCount, 1, (v) => {
        const cnt = Math.max(0, Math.min(q.participants, Math.round(v)));
        app.updateSimQuick({
          prepaidRatio: q.participants > 0 ? 1 - cnt / q.participants : 1,
          hasOnsitePayment: cnt > 0,
        });
      }, 0),
    ]),
    el("div", { class: "row wrap" }, [
      num("報到人力", q.checkinStaff, 1, (v) => app.updateSimQuick({ checkinStaff: Math.max(1, Math.round(v)) }), 1),
      num("收費人力", q.paymentStaff, 1, (v) => app.updateSimQuick({ paymentStaff: Math.max(1, Math.round(v)) }), 1),
      num("多久內到齊 (分)", Math.round(q.arrivalWindowSeconds / 60), 5,
        (v) => app.updateSimQuick({ arrivalWindowSeconds: Math.max(1, v) * 60 }), 1),
    ]),
  ]);

  // The classroom flow, visible for the first time. Read-only: these numbers
  // come from the settings above, and editing them in two places would mean
  // two answers to the same question.
  const rows = (scenario?.stations ?? []).map((st, i) =>
    el("div", { class: "list__row" }, [
      el("span", { class: "readout__label", text: `${i + 1}.` }),
      el("span", { class: "list__grow", text: st.name }),
      el("span", { class: "hint", text: `${Math.round(st.meanServiceSeconds)} 秒` }),
    ]));

  const flowPreview = section("這一場的流程（照著跑）", [
    ...(rows.length ? rows : [el("span", { class: "hint", text: "還沒有站點。按「▶ 模擬」會依現在的場佈自動排一組。" })]),
    el("p", { class: "hint", text: "這是從上面的設定自動排出來的。想改順序、加步驟、加分岔，按下面。" }),
    button("改成我自己的流程", () => app.convertScenarioToFlow(), "btn btn--ghost"),
  ]);

  return el("div", {}, [setup, transport(app), ...resultBlocks(app), flowPreview, advancedSection(app)]);
}

// --- shape B: the step list ------------------------------------------------

function renderFlow(app: App, t: InteractionTemplate): HTMLElement {
  return el("div", {}, [
    audienceSection(app, t),
    staffSection(app, t),
    stepsSection(app, t),
    transport(app),
    ...resultBlocks(app),
    presetSection(app, t),
    advancedSection(app),
  ]);
}

function audienceSection(app: App, t: InteractionTemplate): HTMLElement {
  const a = t.audience;
  const passingBy = a.stopRate < 1;
  const rows: HTMLElement[] = [];

  if (passingBy) {
    const perHour = Math.round(a.count / Math.max(1, a.windowSeconds / 3600));
    rows.push(el("div", { class: "row wrap" }, [
      num("每小時大概幾個人經過", perHour, 10, (v) => {
        const hours = Math.max(0.25, a.windowSeconds / 3600);
        app.updateFlowAudience({ count: Math.max(0, Math.round(Math.max(0, v) * hours)) });
      }, 0),
      num("擺多久（小時）", Math.round((a.windowSeconds / 3600) * 10) / 10, 0.5, (v) => {
        const hours = Math.max(0.25, v);
        app.updateFlowAudience({
          windowSeconds: Math.round(hours * 3600),
          count: Math.max(0, Math.round(perHour * hours)),
        });
      }, 0.25),
    ]));
    rows.push(el("div", { class: "row wrap" }, [
      num("大概幾成會停下來看 (%)", Math.round(a.stopRate * 100), 5,
        (v) => app.updateFlowAudience({ stopRate: Math.min(1, Math.max(0, v / 100)) }), 0),
      num("停下來的人，幾成會參加 (%)", Math.round(a.joinRate * 100), 5,
        (v) => app.updateFlowAudience({ joinRate: Math.min(1, Math.max(0, v / 100)) }), 0),
    ]));
  } else {
    rows.push(el("div", { class: "row wrap" }, [
      num("來幾個人", a.count, 5, (v) => app.updateFlowAudience({ count: Math.max(0, Math.round(v)) }), 0),
      num("多久內到齊（分）", Math.round(a.windowSeconds / 60), 5,
        (v) => app.updateFlowAudience({ windowSeconds: Math.max(60, Math.round(v * 60)) }), 1),
      button(a.stopRate < 1 ? "這是攤位" : "改成攤位（有人只是路過）",
        () => app.updateFlowAudience({ stopRate: 0.3, joinRate: 0.7 }), "chip chip--sm"),
    ]));
  }

  rows.push(el("div", { class: "row wrap" }, [
    num("排多久會走掉（分）", Math.round((a.patienceSeconds / 60) * 10) / 10, 1,
      (v) => app.updateFlowAudience({ patienceSeconds: Math.max(0, Math.round(v * 60)) }), 0),
    el("span", { class: "hint", text: a.patienceSeconds > 0 ? "0 = 不會走" : "現在設定成沒有人會中途離開" }),
  ]));

  // The funnel, computed the same way the engine computes it — this line IS
  // the input, not a marketing summary of it.
  const f = audienceJoiners(a);
  rows.push(el("p", {
    class: "hint",
    text: passingBy
      ? `經過 ${f.passed} 人 → 停下來 ${f.stopped} 人 → 真的參加 ${f.joined} 人。模擬跑的是這 ${f.joined} 個人。`
      : `模擬跑的是這 ${f.joined} 個人。`,
  }));

  if (t.note) rows.push(el("p", { class: "hint", text: `ⓘ ${t.note}` }));

  return section("這場活動", rows);
}

function staffSection(app: App, t: InteractionTemplate): HTMLElement {
  const rows: HTMLElement[] = [];
  for (const role of t.staff) {
    const mine = t.stations.filter((st) => st.staffRoleId === role.id);
    rows.push(el("div", { class: "list__row" }, [
      el("span", { class: "list__grow", text: role.name }),
      num("人", role.count, 1, (v) => app.setFlowStaffCount(role.id, v), 0),
      ...t.stations.map((st) => button(
        st.name,
        () => app.setStationRole(st.id, st.staffRoleId === role.id ? undefined : role.id),
        st.staffRoleId === role.id ? "chip chip--sm chip--primary" : "chip chip--sm",
      )),
      button("刪除", () => app.removeFlowRole(role.id), "chip chip--sm"),
    ]));
    if (mine.length) {
      rows.push(el("span", { class: "hint", text: `ⓘ ${role.name} ${role.count} 人，顧：${mine.map((s) => s.name).join("、")}。` }));
    }
  }

  const orphans = t.stations.filter((st) => !st.staffRoleId && !st.selfService);
  if (orphans.length) {
    rows.push(el("span", {
      class: "hint",
      text: `⚠ 還沒有人顧：${orphans.map((s) => s.name).join("、")}（目前照「服務位」開，不會停擺）`,
    }));
  }

  rows.push(el("div", { class: "row wrap" }, [
    button("＋ 新增角色", () => app.addFlowRole(`角色 ${t.staff.length + 1}`), "chip chip--sm"),
  ]));

  // Self-service is a property of the place, so it lives with the places.
  rows.push(el("div", { class: "subhead", text: "地點" }));
  for (const st of t.stations) {
    rows.push(el("div", { class: "list__row" }, [
      el("span", { class: "list__grow", text: st.name }),
      num("同時幾人", st.parallelServers, 1,
        (v) => app.updateFlowStation(st.id, { parallelServers: Math.max(1, Math.round(v)) }), 1),
      num("排隊容量", st.queueCapacity, 1,
        (v) => app.updateFlowStation(st.id, { queueCapacity: Math.max(1, Math.round(v)) }), 1),
      button(st.selfService ? "✓ 不用人顧" : "不用人顧",
        () => app.updateFlowStation(st.id, { selfService: !st.selfService }),
        st.selfService ? "chip chip--sm chip--primary" : "chip chip--sm"),
    ]));
  }

  return section("人手", rows);
}

function nextLabel(step: InteractionStep, t: InteractionTemplate): string {
  if (step.next === null) return "到這裡就結束，離開";
  if (step.next === undefined) return "接著做下一項";
  const target = t.steps.find((s) => s.id === step.next);
  return target ? `跳到：${target.name}` : "到這裡就結束，離開";
}

function stepsSection(app: App, t: InteractionTemplate): HTMLElement {
  const choices = stationChoices(t);
  const rows: HTMLElement[] = [];

  t.steps.forEach((step, i) => {
    const head = el("div", { class: "list__row" }, [
      button("↑", () => app.moveFlowStep(step.id, -1), "chip chip--sm"),
      button("↓", () => app.moveFlowStep(step.id, 1), "chip chip--sm"),
      el("span", { class: "readout__label", text: `${i + 1}.` }),
      textField("", step.name, (v) => app.renameFlowStep(step.id, v)),
      selectField("地點", choices.map((c) => ({ value: c.id, label: c.name })),
        step.stationId ?? choices[0]?.id ?? "",
        (v) => app.setFlowStepStation(step.id, v)),
      num("平均秒", step.avgSeconds, 5,
        (v) => app.updateFlowStep(step.id, { avgSeconds: Math.max(0, v) }), 0),
    ]);

    const detail: HTMLElement[] = [
      el("div", { class: "row wrap" }, [
        textField("提示", step.prompt ?? "", (v) => app.updateFlowStep(step.id, { prompt: v || undefined })),
        el("span", { class: "hint", text: nextLabel(step, t) }),
      ]),
    ];

    if (step.avgSeconds === 0) {
      detail.push(el("span", { class: "hint", text: "ⓘ 0 秒＝純粹一個選擇：不排隊、不佔人手。" }));
    }

    if (step.branch?.kind === "chance") {
      detail.push(...chanceRows(app, step, step.branch.options, !!step.branch.record));
    } else if (step.branch?.kind === "match") {
      detail.push(...matchRows(app, t, step));
    }

    detail.push(el("div", { class: "row wrap" }, [
      button("複製這一步", () => app.duplicateFlowStep(step.id), "chip chip--sm"),
      button("刪除", () => app.removeFlowStep(step.id), "chip chip--sm"),
      step.branch
        ? button("移除分岔", () => app.updateFlowStep(step.id, { branch: undefined }), "chip chip--sm")
        : button("加一個分岔", () => app.setFlowOptionCount(step.id, 4), "chip chip--sm"),
      button("在下面加一步", () => app.addFlowStep(i + 1), "chip chip--sm"),
    ]));

    rows.push(el("div", { class: "flow-step" }, [head, ...detail]));
  });

  rows.push(button("＋ 加一步", () => app.addFlowStep(t.steps.length), "btn btn--ghost"));
  return section("互動流程", rows);
}

function chanceRows(
  app: App,
  step: InteractionStep,
  options: InteractionOption[],
  records: boolean,
): HTMLElement[] {
  const total = options.reduce((sum, o) => sum + Math.max(0, o.weight), 0) || 1;
  const rows: HTMLElement[] = [
    el("div", { class: "row wrap" }, [
      el("span", { class: "readout__label", text: "這一步會分岔　面數：" }),
      ...[2, 4, 6, 8].map((n) => button(String(n), () => app.setFlowOptionCount(step.id, n),
        options.length === n ? "chip chip--sm chip--primary" : "chip chip--sm")),
    ]),
  ];

  options.forEach((option, i) => {
    rows.push(el("div", { class: "list__row" }, [
      el("span", { class: "readout__label", text: "·" }),
      textField("", option.label, (v) => app.updateFlow((t) => patchOption(t, step.id, i, { label: v }))),
      // The face's colour — the same option record the 3D dice renders from,
      // so editing it here repaints the placed prop immediately.
      el("input", {
        type: "color", class: "propstudio__color", value: option.color ?? "#38bdf8",
        onchange: (e: Event) => app.updateFlow((t) => patchOption(t, step.id, i, { color: (e.target as HTMLInputElement).value })),
      } as never),
      el("span", { class: "hint", text: `機會 ${Math.round((Math.max(0, option.weight) / total) * 100)} %` }),
      num("權重", option.weight, 1,
        (v) => app.updateFlow((t) => patchOption(t, step.id, i, { weight: Math.max(0, v) })), 0),
      num("多花秒", option.extraSeconds ?? 0, 5,
        (v) => app.updateFlow((t) => patchOption(t, step.id, i, { extraSeconds: v || undefined })), 0),
      el("span", { class: "hint", text: option.next === null ? "選了就離開" : option.next ? "會跳到別步" : "接著下一項" }),
    ]));
  });

  rows.push(el("div", { class: "row wrap" }, [
    button(records ? "☑ 記住這一題的答案" : "☐ 記住這一題的答案", () => app.updateFlow((t) => ({
      ...t,
      steps: t.steps.map((s) => (s.id !== step.id || s.branch?.kind !== "chance" ? s : {
        ...s,
        branch: records
          ? { kind: "chance" as const, options: s.branch.options }
          : { ...s.branch, record: s.id },
      })),
    })), records ? "chip chip--sm chip--primary" : "chip chip--sm"),
    el("span", { class: "hint", text: "記住之後，後面的「結果對照表」才能用這一題的答案。" }),
  ]));
  return rows;
}

function patchOption(
  t: InteractionTemplate,
  stepId: string,
  index: number,
  patch: Partial<InteractionOption>,
): InteractionTemplate {
  return {
    ...t,
    steps: t.steps.map((s) => (s.id !== stepId || s.branch?.kind !== "chance" ? s : {
      ...s,
      branch: {
        ...s.branch,
        options: s.branch.options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
      },
    })),
  };
}

/**
 * A cell header short enough to sit in front of a text box.
 *
 * The club's own option wording is a sentence — 「人際／感情（心好累）」 — and
 * repeating it in front of all sixteen boxes buries the answers. Their paper
 * matrix used the first word of each, so this does too.
 */
function shortLabel(label: string): string {
  return label.split("（")[0].split("／")[0].trim() || label;
}

/**
 * The outcome table, drawn as a table — which is how the club drew it on paper.
 * Rows are the first remembered question's options, columns the second's.
 */
function matchRows(app: App, t: InteractionTemplate, step: InteractionStep): HTMLElement[] {
  if (step.branch?.kind !== "match") return [];
  const branch = step.branch;
  const axes = branch.on.map((key) => {
    const source = t.steps.find((s) => s.branch?.kind === "chance" && s.branch.record === key);
    const options = source?.branch?.kind === "chance" ? source.branch.options : [];
    return { key, name: source?.name ?? key, options };
  });

  const rows: HTMLElement[] = [
    el("span", { class: "readout__label", text: `結果對照表：依「${axes.map((a) => a.name).join("」×「")}」` }),
  ];

  const [down, across] = axes;
  if (!down) return rows;
  const cellFor = (when: string[]) =>
    branch.rules.find((r) => r.when.length === when.length && r.when.every((w, i) => w === when[i]));

  for (const rowOption of down.options) {
    const cells: HTMLElement[] = [el("span", { class: "readout__label", text: shortLabel(rowOption.label) })];
    const columns = across?.options.length ? across.options : [null];
    for (const colOption of columns) {
      const when = colOption
        ? [rowOption.value ?? rowOption.id, colOption.value ?? colOption.id]
        : [rowOption.value ?? rowOption.id];
      const rule = cellFor(when);
      cells.push(textField(colOption ? shortLabel(colOption.label) : "結果", rule?.label ?? "",
        (v) => app.updateFlow((tt) => setMatchCell(tt, step.id, when, v))));
    }
    rows.push(el("div", { class: "list__row" }, cells));
  }
  rows.push(el("span", { class: "hint", text: "留空的格子會用「其他」那一列的結果。查表不擲骰，不會改變排隊長度。" }));
  return rows;
}

function setMatchCell(
  t: InteractionTemplate,
  stepId: string,
  when: string[],
  label: string,
): InteractionTemplate {
  return {
    ...t,
    steps: t.steps.map((s) => {
      if (s.id !== stepId || s.branch?.kind !== "match") return s;
      const others = s.branch.rules.filter((r) => !(r.when.length === when.length && r.when.every((w, i) => w === when[i])));
      return {
        ...s,
        branch: {
          ...s.branch,
          rules: label.trim() ? [...others, { when, label: label.trim() }] : others,
        },
      };
    }),
  };
}

// --- shared: transport, results, presets -----------------------------------

function transport(app: App): HTMLElement {
  const s = app.session;
  const playing = s.simPlaying;
  const row = el("div", { class: "row wrap sim-transport" }, [
    playing
      ? button(s.simPaused ? "繼續" : "⏸ 暫停", () => app.pauseSimulation(), "btn")
      : button(s.simResult ? "▶ 再跑一次" : (app.hasFlow() ? "▶ 演練一次" : "▶ 模擬"),
        () => app.startSimulation(), "btn btn--primary"),
    button("重來", () => app.restartSimulation(), "chip chip--sm"),
    button("停止", () => app.stopSimulation(), "chip chip--sm"),
    ...([["慢", 90], ["正常", 45], ["快", 20]] as [string, number][]).map(([label, secs]) => {
      const target = Math.max(1, (s.simResult?.finishTimeSeconds ?? 600) / secs);
      const active = Math.abs(s.simSpeed - target) < 0.01;
      return button(label, () => app.setSimSpeed(target), active ? "chip chip--sm chip--primary" : "chip chip--sm");
    }),
  ]);
  return row;
}

function resultBlocks(app: App): HTMLElement[] {
  const s = app.session;
  const out: HTMLElement[] = [];
  if (s.simPlaying) {
    out.push(el("div", { class: "readout" }, [
      el("div", { "data-live-clock": "1", text: liveClockText(app) }),
    ]));
  }
  const result = s.simResult;
  if (!result || s.simPlaying) return out;

  const lines: string[] = [];
  if (result.funnel) {
    const f = result.funnel;
    lines.push(`經過 ${f.passed} 人 → 停下來 ${f.stopped} 人 → 開始參加 ${f.joined} 人 → 完成 ${f.completed} 人`);
  } else {
    lines.push(`完成 ${result.completed} / ${result.participantCount} 人`);
  }
  const worst = result.stations.find((st) => st.stationId === result.bottleneckStationId);
  lines.push(worst
    ? `最多排隊：${worst.maxQueue} 人（在${worst.name}，平均等 ${fmt(worst.avgWaitSeconds)}）`
    : "沒有明顯塞車點 ✅");
  if (result.leftEarly > 0) lines.push(`有 ${result.leftEarly} 人排太久走掉了`);
  if (result.unfinished > 0) lines.push(`還有 ${result.unfinished} 人沒輪到（時間到了或沒有人顧）`);
  lines.push(`全部完成：約 ${fmt(result.finishTimeSeconds)}`);
  for (const b of result.spatialBottlenecks) {
    lines.push(b.kind === "corridor"
      ? `排隊會排到走道上（多出 ${b.count} 人）——桌子往內縮 50 公分`
      : `門口通行受阻：約 ${b.count} 人受到影響`);
  }
  for (const line of result.staffLoad ?? []) lines.push(line.phrase);

  out.push(el("div", {
    class: `readout sim-result ${result.bottleneckStationId || result.leftEarly ? "readout--warn" : ""}`,
  }, lines.map((t) => el("div", { text: t }))));

  // Per-step counts: 「Q3 怪獸 126 人做過，最多的是拖延獸 42 人」.
  const forks = (result.steps ?? []).filter((st) => st.optionCounts?.length);
  if (forks.length) {
    out.push(el("div", { class: "readout" }, forks.map((st) => {
      const top = [...st.optionCounts!].sort((a, b) => b.count - a.count)[0];
      return el("div", { text: `${st.name}：${st.entered} 人做過，最多的是「${top.label}」${top.count} 人` });
    })));
  }

  out.push(el("div", { class: "row wrap" }, [
    button("▶ 播放走位", () => app.replaySimulation(), "btn btn--ghost"),
    button("✦ 幫我改善", () => app.onImprove?.(), "btn btn--ghost"),
  ]));
  return out;
}

function presetSection(app: App, t: InteractionTemplate): HTMLElement {
  const mine = app.myFlowTemplates();
  let saveName = t.name;
  const body: HTMLElement[] = [
    el("div", { class: "row wrap" }, [
      textField("存成我的範本", saveName, (v) => { saveName = v; }),
      button("儲存", () => app.saveFlowTemplate(saveName), "btn btn--ghost"),
    ]),
    ...(mine.length
      ? [
        el("div", { class: "subhead", text: "我的範本" }),
        ...mine.map((m) => el("div", { class: "list__row" }, [
          el("span", { class: "list__grow", text: `${m.name}（${m.stepCount} 步）` }),
          button("套用", () => {
            if (t.steps.length > 1 && !confirm(`套用「${m.name}」會蓋掉現在的 ${t.steps.length} 個步驟，確定嗎？`)) return;
            app.applyMyFlowTemplate(m.id);
          }, "chip chip--sm"),
          button("刪除", () => app.deleteFlowTemplate(m.id), "chip chip--sm"),
        ])),
        el("p", { class: "hint", text: "範本只記住流程與站點名字，不記座標——換一個場地套用時，會用同名的站點位置。" }),
      ]
      : []),
    el("div", { class: "subhead", text: "起手範本" }),
    el("div", { class: "row wrap" }, app.flowPresets().map((p) =>
      button(p.name, () => {
        if (t.steps.length > 1 && !confirm(`套用「${p.name}」會蓋掉現在的 ${t.steps.length} 個步驟，確定嗎？`)) return;
        app.applyFlowPreset(p.id);
      }, "chip chip--sm"))),
    el("p", { class: "hint", text: "套用範本會換掉整份流程；現在這份如果還要用，先存成我的範本。" }),
  ];
  if (app.activeScenario()) {
    body.push(button("回到快速設定", () => app.discardFlow(), "chip chip--sm"));
  }
  return section("範本", body, false);
}

function advancedSection(app: App): HTMLElement {
  const q = app.session.simQuick;
  const result = app.session.simResult;
  const template = app.flowTemplate();
  const body: HTMLElement[] = [];
  if (!template) {
    body.push(el("div", { class: "row wrap" }, [
      button("建立／更新流程站點", () => {
        app.ensureEventScenario(true);
        app.onToast?.("已依目前場佈建立報到/收費/入座站點");
      }, "btn btn--ghost"),
      button("比較同桌／分桌", () => {
        const c = app.compareCheckinPayment();
        app.onToast?.(c.reason);
      }, "btn btn--ghost"),
    ]));
    body.push(el("div", { class: "row wrap" }, [
      button(`到場節奏：${q.arrivalProfile === "uniform" ? "陸續到" : "快開始才到"}`,
        () => app.updateSimQuick({ arrivalProfile: q.arrivalProfile === "uniform" ? "front-loaded" : "uniform" }),
        "btn btn--ghost"),
    ]));
  } else {
    body.push(el("div", { class: "row wrap" }, [
      button(`到場節奏：${template.audience.profile === "uniform" ? "陸續到" : "快開始才到"}`,
        () => app.updateFlowAudience({
          profile: template.audience.profile === "uniform" ? "front-loaded" : "uniform",
        }),
        "btn btn--ghost"),
      num("亂數種子", template.seed, 1,
        (v) => app.updateFlow((t) => ({ ...t, seed: Math.round(v) })), 0),
      el("span", { class: "hint", text: "同一份場佈、同一個種子，永遠跑出同一個答案。" }),
    ]));
  }
  const cmp = app.session.simCompare;
  if (cmp) {
    body.push(el("div", { class: "readout" }, [
      el("div", { text: `同桌：約 ${fmt(cmp.a.finishTimeSeconds)} 完成 · 最多排 ${cmp.a.maxQueue} 人` }),
      el("div", { text: `分桌：約 ${fmt(cmp.b.finishTimeSeconds)} 完成 · 最多排 ${cmp.b.maxQueue} 人` }),
      el("div", { text: `走廊分流：約 ${fmt(cmp.c.finishTimeSeconds)} 完成 · 最多排 ${cmp.c.maxQueue} 人` }),
      el("div", { text: cmp.reason }),
    ]));
  }
  if (result) {
    const top = [...result.stations].sort((a, b) => b.maxQueue - a.maxQueue).slice(0, 6);
    body.push(el("div", { class: "readout" }, [
      ...result.summaryLines.map((t) => el("div", { text: t })),
      ...top.map((st) => el("div", {
        text: `· ${st.name}：服務位 ${st.servers} · 最大排隊 ${st.maxQueue} · 平均等待 ${fmt(st.avgWaitSeconds)} · 利用率 ${Math.round(st.utilization * 100)}%`,
      })),
    ]));
  }
  return section("進階（站點與數據）", body, false);
}
