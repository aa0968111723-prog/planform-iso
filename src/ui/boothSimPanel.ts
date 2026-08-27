/**
 * 攤位模擬 — the 模擬 tab of an outdoor booth plan.
 *
 * Reads like a planning conversation, not a queueing-theory readout: 換人流,
 * press ▶, and the numbers say whether three people behind the table can
 * absorb the rush. The per-station table (dwell time / service seats) is the
 * knob that actually changes the answer, so it stays on the first level.
 */

import type { App } from "../app/App";
import { BOOTH_SIM_PRESETS, BOOTH_STATION_TYPES, type BoothStats } from "../core/boothFlow";
import type { BoothScenarioId } from "../core/model";
import { button, el, num, section } from "./dom";

export function buildBoothSimPanel(app: App): HTMLElement {
  const root = el("div", { class: "sim-panel booth-panel" });
  refreshBoothSimPanel(root, app);
  return root;
}

/** Panel structure last drawn into a root, so playback can patch instead of rebuild. */
const lastStructure = new WeakMap<HTMLElement, string>();

/**
 * Playback pushes new statistics several times a second. Rebuilding the whole
 * panel that often replaced every node between a finger going down and coming
 * up — 暫停 was genuinely unclickable while the crowd was walking. So when only
 * the live numbers changed, the numbers alone are patched in place, and the
 * panel is rebuilt only when its structure actually differs.
 */
export function refreshBoothSimPanel(root: HTMLElement, app: App): void {
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
  const booth = app.store.getState().booth;
  const s = app.session.booth;
  return JSON.stringify({
    hasBooth: !!booth,
    scenario: booth?.scenarioId ?? null,
    params: booth?.params ?? null,
    stations: booth?.stations.map((st) => [st.id, st.enabled !== false, st.meanServiceSeconds, st.parallelServers]) ?? [],
    playing: s.playing,
    finished: !!s.stats && !s.stats.running,
    speed: s.speed,
    compare: !!s.compare,
    warnings: warningLines(app, s.stats),
    hasStats: !!s.stats,
  });
}

function patchLiveValues(root: HTMLElement, app: App): void {
  const stats = app.session.booth.stats;
  const rows = statRows(stats);
  root.querySelectorAll<HTMLElement>("[data-stat]").forEach((node) => {
    const i = Number(node.dataset.stat);
    if (rows[i]) node.textContent = rows[i][1];
  });
  const live = new Map((stats?.stations ?? []).map((s) => [s.id, s]));
  root.querySelectorAll<HTMLElement>("[data-station-stat]").forEach((node) => {
    node.textContent = stationLiveText(live.get(node.dataset.stationStat ?? ""));
  });
}

function stationLiveText(live: { served: number; maxQueue: number } | undefined): string {
  return live && live.served ? `${live.served} 人 · 最多排 ${live.maxQueue}` : "—";
}

function fmtSecs(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} 分 ${rest} 秒` : `${m} 分鐘`;
}

function statRows(stats: BoothStats | null): [string, string][] {
  if (!stats) return [["尚未模擬", "按 ▶ 開始"]];
  return [
    ["模擬時間", fmtSecs(stats.time)],
    ["場上人數", `${stats.onSite} 人`],
    ["最大排隊人數", `${stats.maxQueue} 人`],
    ["平均等待", fmtSecs(stats.avgWait)],
    ["最長等待", fmtSecs(stats.maxWait)],
    ["完成互動", `${stats.completed} / ${stats.spawned} 人`],
    ["每分鐘處理", `${stats.throughput.toFixed(1)} 人`],
    ["最容易塞住", stats.bottleneck ? `${stats.bottleneck}（等 ${fmtSecs(stats.bottleneckWait)}）` : "沒有明顯瓶頸"],
  ];
}

function warningLines(app: App, stats: BoothStats | null): string[] {
  const lines: string[] = [];
  const params = app.store.getState().booth?.params;
  if (stats && params) {
    if (stats.balked > 0) {
      lines.push(`有 ${stats.balked} 人因為排隊太長或等太久直接離開`);
    }
    if (stats.blocked.length) {
      lines.push(`${stats.blocked.join("、")}被人流佔住，把排隊區往側邊移`);
    }
    if (stats.maxQueue > params.queueCapacity) {
      lines.push(`最大排隊 ${stats.maxQueue} 人超過排隊區容量 ${params.queueCapacity} 人，會溢到走道上`);
    }
  }
  for (const issue of app.session.issues.filter((i) => i.severity === "error").slice(0, 3)) {
    lines.push(issue.message);
  }
  return lines;
}

function render(app: App): HTMLElement {
  const project = app.store.getState();
  const booth = project.booth;
  if (!booth) {
    return section("攤位模擬", [
      el("p", {
        class: "hint",
        text: "這個專案沒有攤位資料。到「場地 → 場地模板」選「戶外攤位（3×3 帳篷）」就會建立帳篷、攤位桌與站點。",
      }),
      button("套用戶外攤位模板", () => app.applyVenuePresetById("venue:tku-booth"), "btn btn--primary"),
    ]);
  }

  const params = booth.params;
  const stats = app.session.booth.stats;
  const playing = app.session.booth.playing;
  const speed = app.session.booth.speed;
  const compare = app.session.booth.compare;
  const body: HTMLElement[] = [];

  const scenarioChip = (id: BoothScenarioId) => {
    const preset = BOOTH_SIM_PRESETS[id];
    const active = booth.scenarioId === id;
    return button(
      preset.label,
      () => app.applyBoothScenario(id),
      active ? "chip chip--sm chip--primary" : "chip chip--sm",
    );
  };
  body.push(
    el("div", { class: "row wrap" }, [
      scenarioChip("normal"),
      scenarioChip("peak"),
      el("span", {
        class: "hint",
        text: `目前 ${params.arrivalPerMin} 人/分 · 共 ${params.visitorCount} 人 · 桌前 ${params.deskStaff} 人`,
      }),
    ]),
  );

  body.push(el("div", { class: "row wrap sim-transport" }, [
    playing
      ? button("⏸ 暫停", () => app.pauseBoothSim(), "btn")
      : button(stats && !stats.running ? "▶ 再跑一次" : "▶ 模擬", () => app.playBoothSim(), "btn btn--primary"),
    button("重設", () => app.resetBoothSim(), "chip chip--sm"),
    ...([["慢", 6], ["正常", 15], ["快", 40]] as [string, number][]).map(([label, v]) =>
      button(label, () => app.setBoothSpeed(v), speed === v ? "chip chip--sm chip--primary" : "chip chip--sm")),
    button("比較正常／尖峰", () => {
      app.compareBoothScenarios();
      app.onToast?.("已用同一份場佈跑完兩種人流");
    }, "btn btn--ghost"),
  ]));

  body.push(el("div", { class: "readout" }, statRows(stats).map(([label, value], i) =>
    el("div", { class: "readout__row" }, [
      el("span", { class: "readout__label", text: label }),
      el("span", { class: "readout__value", "data-stat": i, text: value }),
    ]))));

  const warnings = warningLines(app, stats);
  if (warnings.length) {
    body.push(el("div", { class: "readout readout--warn" },
      warnings.map((t) => el("div", { text: `⚠ ${t}` }))));
  }

  if (compare) {
    const rows: [string, string, string][] = [
      ["最大排隊", `${compare.a.maxQueue} 人`, `${compare.b.maxQueue} 人`],
      ["平均等待", fmtSecs(compare.a.avgWait), fmtSecs(compare.b.avgWait)],
      ["最長等待", fmtSecs(compare.a.maxWait), fmtSecs(compare.b.maxWait)],
      ["完成互動", `${compare.a.completed} 人`, `${compare.b.completed} 人`],
      ["每分鐘處理", `${compare.a.throughput.toFixed(1)} 人`, `${compare.b.throughput.toFixed(1)} 人`],
      ["中途離開", `${compare.a.balked} 人`, `${compare.b.balked} 人`],
      ["瓶頸站點", compare.a.bottleneck ?? "無", compare.b.bottleneck ?? "無"],
    ];
    body.push(section("正常人流 → 尖峰人流", rows.map(([label, a, b]) =>
      el("div", { class: "list__row" }, [
        el("span", { class: "readout__label", text: label }),
        el("span", { text: a }),
        el("span", { class: "readout__label", text: "→" }),
        el("strong", { text: b }),
      ]))));
  }

  body.push(section("參數", [
    el("div", { class: "grid2" }, [
      num("訪客數量（人）", params.visitorCount, 5, (v) => app.setBoothParams({ visitorCount: Math.max(1, Math.round(v)) }), 1),
      num("每分鐘到達（人）", params.arrivalPerMin, 0.5, (v) => app.setBoothParams({ arrivalPerMin: Math.max(0.1, v) }), 0.1),
      num("平均互動時間（秒）", params.talkSeconds, 5, (v) => app.setBoothParams({ talkSeconds: Math.max(5, v) }), 5),
      num("排隊區容量（人）", params.queueCapacity, 1, (v) => app.setBoothParams({ queueCapacity: Math.max(1, Math.round(v)) }), 1),
      num("桌前工作人員（人）", params.deskStaff, 1, (v) => app.setBoothParams({ deskStaff: Math.max(1, Math.round(v)) }), 1),
      num("展示板停留（秒）", params.boardDwell, 5, (v) => app.setBoothParams({ boardDwell: Math.max(0, v) }), 0),
      num("互動活動停留（秒）", params.gameDwell, 5, (v) => app.setBoothParams({ gameDwell: Math.max(0, v) }), 0),
    ]),
    button(
      params.balk ? "✓ 等太久會離開" : "等太久會離開",
      () => app.setBoothParams({ balk: !params.balk }),
      params.balk ? "chip chip--sm chip--primary" : "chip chip--sm",
    ),
    el("p", { class: "hint", text: "關掉「等太久會離開」代表每個人都排到底 — 用來看理論上限，不是現場會發生的事。" }),
  ]));

  const liveById = new Map((stats?.stations ?? []).map((s) => [s.id, s]));
  const stationRows = booth.stations.map((st) => {
    const live = liveById.get(st.id);
    const enabled = st.enabled !== false;
    return el("div", { class: "list__row" }, [
      button(enabled ? "✓" : "－", () => app.setBoothStationEnabled(st.id, !enabled),
        enabled ? "chip chip--sm chip--primary" : "chip chip--sm"),
      el("span", { class: "list__grow", text: `${BOOTH_STATION_TYPES[st.boothType].icon} ${st.name}` }),
      num("停留 (秒)", st.meanServiceSeconds, 5,
        (v) => app.updateBoothStation(st.id, { meanServiceSeconds: Math.max(0, v) }), 0),
      num("服務位", st.parallelServers, 1,
        (v) => app.updateBoothStation(st.id, { parallelServers: Math.max(1, Math.round(v)) }), 1),
      el("span", { class: "hint", "data-station-stat": st.id, text: stationLiveText(live) }),
    ]);
  });
  body.push(section("站點（停留時間 / 服務位）", [
    el("p", { class: "hint", text: "關掉一個站點就是「這次不辦」；服務位是同時能招呼幾個人。" }),
    ...stationRows,
  ]));

  return section("攤位模擬", body);
}
