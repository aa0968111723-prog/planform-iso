/**
 * Built-in prop definitions (§5) and the four golden assemblies (§65-68).
 *
 * All DATA. The dice is not a DiceEngine: it is a box part whose faces render
 * from six chance options, a station's worth of parameters, and four anchors —
 * the same three primitives a user's own prop gets. Ten props, not fifty; the
 * brief is explicit about resisting the catalog instinct.
 *
 * Every interaction fragment obeys the wiring contract from the plan:
 * the last step carries an explicit `next: null`, and every internal jump is
 * an explicit id — a fragment is spliced into a list it does not control, and
 * row-order reachability is how a prop becomes silently unreachable.
 *
 * Durations are ESTIMATES and say so in each definition's naming convention —
 * the same honesty rule the interaction presets follow: the club's documents
 * record what happens, never how long it takes.
 */

import type { InteractionOption, PropDefinition } from "./model";

const face = (i: number, color: string): InteractionOption => ({
  id: `f${i}`,
  label: `第 ${i} 面`,
  weight: 1,
  color,
});

const FACE_COLORS = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c"];

/** 🎲 大型活動骰 — 60 cm, six faces, roll then talk. */
function dice(): PropDefinition {
  return {
    id: "prop_dice",
    name: "大型骰子",
    category: "互動",
    dimensions: { width: 0.6, depth: 0.6, height: 0.6 },
    parts: [
      {
        id: "cube",
        shape: "box",
        size: { width: 0.6, depth: 0.6, height: 0.6 },
        offset: { x: 0, y: 0, z: 0 },
        color: "#f4f4f5",
        finish: "plastic-matte",
        facesFromOptions: true,
      },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.9 },
      { id: "staff", role: "staff", x: 0.9, z: 0.3 },
      { id: "queue", role: "queue", x: 0, z: 1.6, facingDeg: 0 },
      { id: "exit", role: "exit", x: -1.2, z: 0.6 },
    ],
    interaction: {
      steps: [
        {
          id: "roll",
          name: "擲骰子",
          avgSeconds: 15,
          prompt: "擲出你的題目",
          branch: {
            kind: "chance",
            record: "face",
            options: FACE_COLORS.map((c, i) => face(i + 1, c)),
          },
        },
        { id: "talk", name: "依骰面對談", avgSeconds: 90, next: null },
      ],
      station: { meanServiceSeconds: 105, parallelServers: 1, queueCapacity: 6 },
      staffRole: { name: "骰子站", count: 1 },
      skipRate: 0.35,
    },
    clearance: 1.2,
    interactionZone: 1.2,
    icon: "🎲",
    version: 1,
    source: "preset:dice",
  };
}

/** 🎡 桌上轉盤 — base, pole, flat disc, pointer. */
function spinner(): PropDefinition {
  return {
    id: "prop_spinner",
    name: "轉盤",
    category: "互動",
    dimensions: { width: 0.8, depth: 0.8, height: 1.1 },
    parts: [
      { id: "base", shape: "cylinder", size: { width: 0.5, depth: 0.5, height: 0.08 }, offset: { x: 0, y: 0, z: 0 }, color: "#475569", finish: "painted-metal" },
      { id: "pole", shape: "cylinder", size: { width: 0.06, depth: 0.06, height: 0.85 }, offset: { x: 0, y: 0.08, z: 0 }, color: "#64748b", finish: "brushed-metal" },
      { id: "disc", shape: "cylinder", size: { width: 0.8, depth: 0.8, height: 0.05 }, offset: { x: 0, y: 0.93, z: 0 }, color: "#fbbf24", finish: "plastic-gloss", facesFromOptions: true },
      { id: "pointer", shape: "box", size: { width: 0.05, depth: 0.16, height: 0.04 }, offset: { x: 0, y: 0.99, z: 0.42 }, color: "#ef4444", finish: "plastic-gloss" },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.8 },
      { id: "staff", role: "staff", x: 0.8, z: 0.2 },
      { id: "queue", role: "queue", x: 0, z: 1.5, facingDeg: 0 },
      { id: "exit", role: "exit", x: -1.1, z: 0.4 },
    ],
    interaction: {
      steps: [
        {
          id: "spin",
          name: "轉轉盤",
          avgSeconds: 10,
          branch: {
            kind: "chance",
            record: "wedge",
            options: FACE_COLORS.map((c, i) => ({ id: `w${i + 1}`, label: `區塊 ${i + 1}`, weight: 1, color: c })),
          },
        },
        { id: "task", name: "完成對應任務", avgSeconds: 60, next: null },
      ],
      station: { meanServiceSeconds: 70, parallelServers: 1, queueCapacity: 5 },
      staffRole: { name: "轉盤站", count: 1 },
      skipRate: 0.35,
    },
    clearance: 1.0,
    interactionZone: 1.0,
    icon: "🎡",
    version: 1,
    source: "preset:spinner",
  };
}

/** ▯ 立牌 — a poster board on a base; physical, no interaction. */
function standee(): PropDefinition {
  return {
    id: "prop_standee",
    name: "立牌",
    category: "指示",
    dimensions: { width: 0.6, depth: 0.4, height: 1.6 },
    parts: [
      { id: "base", shape: "box", size: { width: 0.5, depth: 0.4, height: 0.05 }, offset: { x: 0, y: 0, z: 0 }, color: "#475569", finish: "painted-metal" },
      { id: "board", shape: "plane", size: { width: 0.6, depth: 0.02, height: 1.5 }, offset: { x: 0, y: 0.05, z: 0 }, color: "#f8fafc", text: "活動海報" },
    ],
    anchors: [],
    icon: "🪧",
    version: 1,
    source: "preset:standee",
  };
}

/** ▣ 箱子 — a plain box with a front label; physical. */
function box(): PropDefinition {
  return {
    id: "prop_box",
    name: "箱子",
    category: "家具",
    dimensions: { width: 0.5, depth: 0.4, height: 0.45 },
    parts: [
      { id: "body", shape: "box", size: { width: 0.5, depth: 0.4, height: 0.45 }, offset: { x: 0, y: 0, z: 0 }, color: "#c8b6a6", finish: "light-wood", text: "物資" },
    ],
    anchors: [],
    icon: "📦",
    version: 1,
    source: "preset:box",
  };
}

/** ▱ 桌子 — a trestle table: top plus four legs; physical. */
function table(): PropDefinition {
  const leg = (id: string, x: number, z: number) => ({
    id,
    shape: "box" as const,
    size: { width: 0.05, depth: 0.05, height: 0.7 },
    offset: { x, y: 0, z },
    color: "#6b7280",
    finish: "painted-metal" as const,
  });
  return {
    id: "prop_table",
    name: "活動桌",
    category: "家具",
    dimensions: { width: 1.8, depth: 0.6, height: 0.74 },
    parts: [
      { id: "top", shape: "box", size: { width: 1.8, depth: 0.6, height: 0.04 }, offset: { x: 0, y: 0.7, z: 0 }, color: "#c8b6a6", finish: "light-wood" },
      leg("l1", -0.82, -0.24), leg("l2", 0.82, -0.24), leg("l3", -0.82, 0.24), leg("l4", 0.82, 0.24),
    ],
    anchors: [],
    icon: "🛎",
    version: 1,
    source: "preset:table",
  };
}

/** 🔘 大型按鈕 — base plus a red dome. */
function button(): PropDefinition {
  return {
    id: "prop_button",
    name: "互動按鈕",
    category: "互動",
    dimensions: { width: 0.35, depth: 0.35, height: 0.3 },
    parts: [
      { id: "base", shape: "cylinder", size: { width: 0.35, depth: 0.35, height: 0.12 }, offset: { x: 0, y: 0, z: 0 }, color: "#334155", finish: "painted-metal" },
      { id: "dome", shape: "sphere", size: { width: 0.24, depth: 0.24, height: 0.24 }, offset: { x: 0, y: 0.02, z: 0 }, color: "#ef4444", finish: "plastic-gloss" },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.5 },
      { id: "exit", role: "exit", x: -0.8, z: 0.3 },
    ],
    interaction: {
      steps: [
        { id: "press", name: "按下按鈕", avgSeconds: 5, next: null },
      ],
      station: { meanServiceSeconds: 5, parallelServers: 1, queueCapacity: 4, selfService: true },
      skipRate: 0.2,
    },
    icon: "🔘",
    version: 1,
    source: "preset:button",
  };
}

/** 🖥 互動螢幕 — stand plus a glass panel that can show another prop's result. */
function screen(): PropDefinition {
  return {
    id: "prop_screen",
    name: "互動螢幕",
    category: "互動",
    dimensions: { width: 0.9, depth: 0.5, height: 1.5 },
    parts: [
      { id: "base", shape: "box", size: { width: 0.6, depth: 0.5, height: 0.06 }, offset: { x: 0, y: 0, z: 0 }, color: "#334155", finish: "painted-metal" },
      { id: "pole", shape: "cylinder", size: { width: 0.06, depth: 0.06, height: 0.7 }, offset: { x: 0, y: 0.06, z: 0 }, color: "#475569", finish: "brushed-metal" },
      { id: "panel", shape: "box", size: { width: 0.9, depth: 0.05, height: 0.6 }, offset: { x: 0, y: 0.76, z: 0 }, color: "#0f172a", finish: "screen-glass", text: "題目" },
    ],
    anchors: [],
    icon: "🖥",
    version: 1,
    source: "preset:screen",
  };
}

/** 🃏 抽卡箱 — 20 cards as 20 equal options (§28). */
function cardBox(): PropDefinition {
  return {
    id: "prop_cardbox",
    name: "抽卡箱",
    category: "互動",
    dimensions: { width: 0.45, depth: 0.35, height: 0.5 },
    parts: [
      { id: "body", shape: "box", size: { width: 0.45, depth: 0.35, height: 0.42 }, offset: { x: 0, y: 0, z: 0 }, color: "#a78bfa", finish: "paper", text: "抽一張" },
      { id: "slot", shape: "box", size: { width: 0.3, depth: 0.02, height: 0.04 }, offset: { x: 0, y: 0.42, z: 0.1 }, color: "#1f2937", finish: "plastic-matte" },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.6 },
      { id: "staff", role: "staff", x: 0.7, z: 0.1 },
      { id: "queue", role: "queue", x: 0, z: 1.3, facingDeg: 0 },
      { id: "exit", role: "exit", x: -0.9, z: 0.3 },
    ],
    interaction: {
      steps: [
        {
          id: "draw",
          name: "抽一張卡",
          avgSeconds: 10,
          branch: {
            kind: "chance",
            record: "card",
            options: Array.from({ length: 20 }, (_, i) => ({
              id: `card${i + 1}`,
              label: `第 ${i + 1} 張`,
              weight: 1,
            })),
          },
        },
        { id: "read", name: "讀卡對談", avgSeconds: 45, next: null },
      ],
      station: { meanServiceSeconds: 55, parallelServers: 1, queueCapacity: 5 },
      staffRole: { name: "抽卡站", count: 1 },
      skipRate: 0.4,
    },
    clearance: 0.8,
    interactionZone: 0.9,
    icon: "🃏",
    version: 1,
    source: "preset:cardbox",
  };
}

/** 📸 拍照框 — a big frame to stand behind; self-service. */
function photoFrame(): PropDefinition {
  const bar = (id: string, w: number, h: number, x: number, y: number) => ({
    id,
    shape: "box" as const,
    size: { width: w, depth: 0.06, height: h },
    offset: { x, y, z: 0 },
    color: "#fbbf24",
    finish: "plastic-gloss" as const,
  });
  return {
    id: "prop_photoframe",
    name: "拍照框",
    category: "互動",
    dimensions: { width: 1.4, depth: 0.5, height: 1.9 },
    parts: [
      { id: "baseL", shape: "box", size: { width: 0.4, depth: 0.5, height: 0.05 }, offset: { x: -0.55, y: 0, z: 0 }, color: "#475569", finish: "painted-metal" },
      { id: "baseR", shape: "box", size: { width: 0.4, depth: 0.5, height: 0.05 }, offset: { x: 0.55, y: 0, z: 0 }, color: "#475569", finish: "painted-metal" },
      bar("left", 0.08, 1.5, -0.66, 0.35),
      bar("right", 0.08, 1.5, 0.66, 0.35),
      bar("bottom", 1.4, 0.08, 0, 0.35),
      bar("top", 1.4, 0.08, 0, 1.77),
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: -0.3 },
      { id: "exit", role: "exit", x: 1.0, z: 0.5 },
    ],
    interaction: {
      steps: [
        { id: "pose", name: "拍照", avgSeconds: 25, next: null },
      ],
      station: { meanServiceSeconds: 25, parallelServers: 1, queueCapacity: 3, selfService: true },
      skipRate: 0.6,
    },
    icon: "📸",
    version: 1,
    source: "preset:photoframe",
  };
}

/** 🎁 領取台 — a small counter with a sign; staffed pickup. */
function pickup(): PropDefinition {
  return {
    id: "prop_pickup",
    name: "領取台",
    category: "互動",
    dimensions: { width: 1.2, depth: 0.6, height: 1.0 },
    parts: [
      { id: "counter", shape: "box", size: { width: 1.2, depth: 0.6, height: 0.9 }, offset: { x: 0, y: 0, z: 0 }, color: "#c8b6a6", finish: "light-wood" },
      { id: "sign", shape: "plane", size: { width: 0.8, depth: 0.02, height: 0.25 }, offset: { x: 0, y: 0.95, z: 0.29 }, color: "#f8fafc", text: "領取處" },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.6 },
      { id: "staff", role: "staff", x: 0, z: -0.6 },
      { id: "queue", role: "queue", x: 0, z: 1.3, facingDeg: 0 },
      { id: "exit", role: "exit", x: 1.0, z: 0.6 },
    ],
    interaction: {
      steps: [
        { id: "collect", name: "領取小物", avgSeconds: 15, next: null },
      ],
      station: { meanServiceSeconds: 15, parallelServers: 1, queueCapacity: 8 },
      staffRole: { name: "領取台", count: 1 },
      skipRate: 0.1,
    },
    clearance: 0.8,
    icon: "🎁",
    version: 1,
    source: "preset:pickup",
  };
}

/** 🧩 巧拼地墊 — §50: the club's real mat as a formal definition. */
function mat(): PropDefinition {
  return {
    id: "prop_mat",
    name: "巧拼地墊",
    category: "禪學社",
    dimensions: { width: 0.6, depth: 0.6, height: 0.04 },
    parts: [
      // The measured colour, real thickness, and a slightly darker rim for the
      // interlocking look. Field-sized seating still uses ArrayGroup — one
      // InstancedMesh for seventy mats will always beat seventy groups, so the
      // prop form is for assemblies and singles, and says so here.
      { id: "slab", shape: "box", size: { width: 0.56, depth: 0.56, height: 0.04 }, offset: { x: 0, y: 0, z: 0 }, finish: "mat-soft" },
      { id: "rimN", shape: "box", size: { width: 0.6, depth: 0.02, height: 0.036 }, offset: { x: 0, y: 0, z: 0.29 }, color: "#1d9e8e", finish: "mat-soft" },
      { id: "rimS", shape: "box", size: { width: 0.6, depth: 0.02, height: 0.036 }, offset: { x: 0, y: 0, z: -0.29 }, color: "#1d9e8e", finish: "mat-soft" },
      { id: "rimE", shape: "box", size: { width: 0.02, depth: 0.6, height: 0.036 }, offset: { x: 0.29, y: 0, z: 0 }, color: "#1d9e8e", finish: "mat-soft" },
      { id: "rimW", shape: "box", size: { width: 0.02, depth: 0.6, height: 0.036 }, offset: { x: -0.29, y: 0, z: 0 }, color: "#1d9e8e", finish: "mat-soft" },
    ],
    anchors: [],
    icon: "🧩",
    version: 1,
    source: "preset:mat",
  };
}

// --- golden assemblies (§65-68) ---------------------------------------------

/** §66 城市微光骰子站 — table + dice + question board + standee, one prop. */
function diceStation(): PropDefinition {
  const t = table();
  const d = dice();
  return {
    id: "prop_dicestation",
    name: "城市微光骰子站",
    category: "互動",
    dimensions: { width: 2.2, depth: 1.2, height: 1.8 },
    parts: [
      ...t.parts.map((p) => ({ ...p, id: `t_${p.id}` })),
      { ...d.parts[0], id: "dice", size: { width: 0.4, depth: 0.4, height: 0.4 }, offset: { x: 0.3, y: 0.74, z: 0 } },
      // §31: during a rehearsal this board shows the face this station just
      // rolled — the whole point of 骰子結果 → 題目螢幕, wired by default so
      // the golden prop demonstrates it without anyone configuring anything.
      { id: "board", shape: "plane", size: { width: 0.7, depth: 0.02, height: 0.5 }, offset: { x: -0.5, y: 0.78, z: -0.1 }, color: "#f8fafc", text: "題目板", showsResultOf: "self" },
      { id: "sign", shape: "plane", size: { width: 0.5, depth: 0.02, height: 1.2 }, offset: { x: 1.35, y: 0.05, z: 0.2 }, color: "#fde68a", text: "城市微光" },
      { id: "signbase", shape: "box", size: { width: 0.4, depth: 0.3, height: 0.05 }, offset: { x: 1.35, y: 0, z: 0.2 }, color: "#475569", finish: "painted-metal" },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.8 },
      { id: "staff", role: "staff", x: 0, z: -0.7 },
      { id: "queue", role: "queue", x: 0, z: 1.6, facingDeg: 0 },
      { id: "exit", role: "exit", x: -1.6, z: 0.5 },
    ],
    interaction: {
      steps: [
        { id: "greet", name: "招呼說明", avgSeconds: 10 },
        {
          id: "roll",
          name: "擲骰子",
          avgSeconds: 15,
          branch: { kind: "chance", record: "face", options: FACE_COLORS.map((c, i) => face(i + 1, c)) },
        },
        { id: "talk", name: "依骰面對談", avgSeconds: 90, next: null },
      ],
      station: { meanServiceSeconds: 115, parallelServers: 1, queueCapacity: 6 },
      staffRole: { name: "骰子站", count: 1 },
      skipRate: 0.35,
    },
    clearance: 1.2,
    interactionZone: 1.4,
    icon: "🎲",
    version: 1,
    source: "preset:dicestation",
  };
}

/** §65 祝福箱 — box + slot + sign; write a card, drop it in. */
function blessingBox(): PropDefinition {
  return {
    id: "prop_blessingbox",
    name: "祝福箱",
    category: "互動",
    dimensions: { width: 1.6, depth: 0.8, height: 1.2 },
    parts: [
      { id: "stand", shape: "box", size: { width: 0.6, depth: 0.6, height: 0.8 }, offset: { x: 0, y: 0, z: 0 }, color: "#c8b6a6", finish: "light-wood" },
      { id: "body", shape: "box", size: { width: 0.45, depth: 0.45, height: 0.4 }, offset: { x: 0, y: 0.8, z: 0 }, color: "#f472b6", finish: "paper", text: "祝福箱" },
      { id: "slot", shape: "box", size: { width: 0.3, depth: 0.02, height: 0.03 }, offset: { x: 0, y: 1.17, z: 0.22 }, color: "#1f2937", finish: "plastic-matte" },
      { id: "sign", shape: "plane", size: { width: 0.5, depth: 0.02, height: 1.1 }, offset: { x: 1.05, y: 0.05, z: 0.1 }, color: "#fbcfe8", text: "寫下祝福" },
      { id: "signbase", shape: "box", size: { width: 0.4, depth: 0.3, height: 0.05 }, offset: { x: 1.05, y: 0, z: 0.1 }, color: "#475569", finish: "painted-metal" },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.7 },
      { id: "staff", role: "staff", x: -0.9, z: 0.2 },
      { id: "queue", role: "queue", x: 0, z: 1.4, facingDeg: 0 },
      { id: "exit", role: "exit", x: 1.3, z: 0.6 },
    ],
    interaction: {
      steps: [
        { id: "card", name: "領祝福卡", avgSeconds: 10 },
        { id: "write", name: "寫祝福", avgSeconds: 60 },
        { id: "drop", name: "投入箱子", avgSeconds: 8, next: null },
      ],
      station: { meanServiceSeconds: 78, parallelServers: 2, queueCapacity: 6 },
      staffRole: { name: "祝福箱", count: 1 },
      skipRate: 0.3,
    },
    clearance: 1.0,
    interactionZone: 1.2,
    icon: "💌",
    version: 1,
    source: "preset:blessingbox",
  };
}

/** §67 快問快答台 — table + screen + button + standee. */
function quizStation(): PropDefinition {
  const t = table();
  const s = screen();
  const b = button();
  return {
    id: "prop_quizstation",
    name: "快問快答台",
    category: "互動",
    dimensions: { width: 2.2, depth: 1.0, height: 1.6 },
    parts: [
      ...t.parts.map((p) => ({ ...p, id: `t_${p.id}` })),
      ...s.parts.map((p) => ({
        ...p,
        id: `s_${p.id}`,
        offset: { ...p.offset, x: p.offset.x - 0.6, z: p.offset.z - 0.3 },
        // §31: the screen shows 答對／答錯 as each question is answered.
        ...(p.id === "panel" ? { showsResultOf: "self" } : {}),
      })),
      ...b.parts.map((p) => ({ ...p, id: `b_${p.id}`, offset: { ...p.offset, x: p.offset.x + 0.5, y: p.offset.y + 0.74 } })),
    ],
    anchors: [
      { id: "player", role: "player", x: 0.5, z: 0.7 },
      { id: "staff", role: "staff", x: -0.5, z: -0.6 },
      { id: "queue", role: "queue", x: 0.5, z: 1.4, facingDeg: 0 },
      { id: "exit", role: "exit", x: -1.5, z: 0.5 },
    ],
    interaction: {
      steps: [
        {
          id: "q1", name: "第 1 題", avgSeconds: 15,
          branch: { kind: "chance", record: "q1", options: [{ id: "a", label: "答對", weight: 2 }, { id: "b", label: "答錯", weight: 1 }] },
        },
        {
          id: "q2", name: "第 2 題", avgSeconds: 15,
          branch: { kind: "chance", record: "q2", options: [{ id: "a", label: "答對", weight: 2 }, { id: "b", label: "答錯", weight: 1 }] },
        },
        {
          id: "q3", name: "第 3 題", avgSeconds: 15,
          branch: { kind: "chance", record: "q3", options: [{ id: "a", label: "答對", weight: 2 }, { id: "b", label: "答錯", weight: 1 }] },
        },
        { id: "prize", name: "結算送小物", avgSeconds: 15, next: null },
      ],
      station: { meanServiceSeconds: 60, parallelServers: 1, queueCapacity: 5 },
      staffRole: { name: "快問快答", count: 1 },
      skipRate: 0.4,
    },
    clearance: 1.0,
    interactionZone: 1.2,
    icon: "⚡",
    version: 1,
    source: "preset:quizstation",
  };
}

/** §68 轉盤遊戲站 — the spinner on its own stand with a sign. */
function spinnerStation(): PropDefinition {
  const s = spinner();
  return {
    id: "prop_spinnerstation",
    name: "轉盤遊戲站",
    category: "互動",
    dimensions: { width: 1.8, depth: 1.0, height: 1.6 },
    parts: [
      ...s.parts,
      { id: "sign", shape: "plane", size: { width: 0.5, depth: 0.02, height: 1.2 }, offset: { x: 1.1, y: 0.05, z: 0.1 }, color: "#fde68a", text: "轉轉樂" },
      { id: "signbase", shape: "box", size: { width: 0.4, depth: 0.3, height: 0.05 }, offset: { x: 1.1, y: 0, z: 0.1 }, color: "#475569", finish: "painted-metal" },
    ],
    anchors: s.anchors,
    interaction: s.interaction,
    clearance: 1.0,
    interactionZone: 1.2,
    icon: "🎡",
    version: 1,
    source: "preset:spinnerstation",
  };
}

export const PROP_PRESETS: PropDefinition[] = [
  dice(), spinner(), standee(), box(), table(), button(), screen(),
  cardBox(), photoFrame(), pickup(), mat(),
  diceStation(), blessingBox(), quizStation(), spinnerStation(),
];

export function propPreset(id: string): PropDefinition | null {
  const found = PROP_PRESETS.find((d) => d.id === id || d.source === id);
  return found ? JSON.parse(JSON.stringify(found)) as PropDefinition : null;
}
