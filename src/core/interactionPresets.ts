/**
 * Starting flows. All of them are DATA — there is no dice code, no quiz code
 * and no booth code anywhere in the core, and these five files' worth of
 * activity is expressed with the same three primitives an organiser gets:
 * `step`, `chance`, `match`.
 *
 * 心情 OK 蹦 is not an example invented to show the model off. It is the
 * activity the club planned, transcribed from their own two planning documents
 * (`淡大擺攤區`, 2026-02-14): the four questions, the exact option wording, the
 * four monster labels and all sixteen cells of the 4×4 quote matrix are theirs.
 *
 * What is NOT theirs, and is marked as such on the template's own note: every
 * DURATION and every CROWD number. The documents say what happens, never how
 * long it takes or how many people come. Those are honest starting estimates
 * to be replaced by a stopwatch on the day — the tool says so in the panel and
 * on the 場刊圖 rather than quietly presenting them as measured.
 */

import type {
  InteractionOption,
  InteractionStep,
  InteractionTemplate,
  MatchRule,
} from "./model";

export interface InteractionPreset {
  id: string;
  name: string;
  /** One line in the picker. */
  summary: string;
  build: () => InteractionTemplate;
}

/**
 * Station positions come from the 戶外攤位 venue template: the table where the
 * old talk station stood, the visitor side where the queue formed, the card
 * table where flyers were handed out. A plan that lands on top of the tent it
 * describes is the whole point of the 3D view.
 */
const OK_STATIONS = [
  { id: "st_front", name: "攤位前", role: "greeter", x: 3.5, z: 6.1, servers: 2, capacity: 6 },
  { id: "st_table", name: "桌前", role: "host", x: 3.5, z: 4.85, servers: 2, capacity: 6 },
  { id: "st_card", name: "發卡處", role: "helper", x: 2.45, z: 4.85, servers: 1, capacity: 4 },
] as const;

/** Q1 真心話檢測 — the club's own four options, wording and tags intact. */
const Q1_OPTIONS: InteractionOption[] = [
  { id: "passion", label: "依然熱愛，這就是我要的！", weight: 1, value: "passion" },
  { id: "disillusion", label: "讀了才發現跟想像不一樣⋯（有點想逃）", weight: 1, value: "disillusion" },
  { id: "neutral", label: "不討厭也不喜歡，就順順讀完吧", weight: 1, value: "neutral" },
  { id: "burnout", label: "曾經滿腔熱血，但現在只剩疲憊⋯", weight: 1, value: "burnout" },
];

/** Q3 怪獸圖鑑 — likewise. */
const Q3_OPTIONS: InteractionOption[] = [
  { id: "relations", label: "人際／感情（心好累）", weight: 1, value: "relations" },
  { id: "future", label: "課業／未來（好迷惘）", weight: 1, value: "future" },
  { id: "expectation", label: "家庭／期待（壓力大）", weight: 1, value: "expectation" },
  { id: "self", label: "自我懷疑／想太多（腦袋停不下來）", weight: 1, value: "self" },
];

/**
 * The 4×4 matrix, exactly as the club wrote it: Q1 down the side, Q3 across
 * the top, one card per cell.
 *
 * `label` is the cell, so the readout can say 「疲憊 × 未來 12 人」 in a line
 * that fits; `prompt` is what actually gets printed on the OK 蹦. Sixteen
 * rules and not one line of engine code — adding a seventeenth quote is a
 * data edit, which is the property the whole model exists for.
 */
const OK_MATRIX: { q1: string; q3: string; cell: string; quote: string }[] = [
  { q1: "passion", q3: "relations", cell: "熱愛 × 人際", quote: "「不用每個人都喜歡你，那樣太擁擠了。」— 佚名" },
  { q1: "passion", q3: "future", cell: "熱愛 × 未來", quote: "「山頂的風景很美，但花是在山腰開的。」— 佚名" },
  { q1: "passion", q3: "expectation", cell: "熱愛 × 期待", quote: "「你的價值不取決於別人如何對待你。」— 佚名" },
  { q1: "passion", q3: "self", cell: "熱愛 × 內耗", quote: "「完美是美好的敵人。」— 伏爾泰" },
  { q1: "disillusion", q3: "relations", cell: "落差 × 人際", quote: "「孤獨是靈魂的洗禮，讓你遇見最真實的自己。」— 叔本華" },
  { q1: "disillusion", q3: "future", cell: "落差 × 未來", quote: "「每一條路都通向某個地方，重點不是終點，而是旅程。」— 赫曼・赫塞" },
  { q1: "disillusion", q3: "expectation", cell: "落差 × 期待", quote: "「這是你的人生，不是他們的續集。」— 佚名" },
  { q1: "disillusion", q3: "self", cell: "落差 × 內耗", quote: "「真正的發現之旅，不在於尋找新大陸，而在於擁有新的眼光。」— 普魯斯特" },
  { q1: "neutral", q3: "relations", cell: "平淡 × 人際", quote: "「平靜不是遠離混亂，而是在混亂中心保持平靜。」— 佚名" },
  { q1: "neutral", q3: "future", cell: "平淡 × 未來", quote: "「答案在風中飄蕩。」— 鮑勃・迪倫" },
  { q1: "neutral", q3: "expectation", cell: "平淡 × 期待", quote: "「安靜下來，世界會對你說話。」— 佚名" },
  { q1: "neutral", q3: "self", cell: "平淡 × 內耗", quote: "「你現在的樣子，就是你過去所有選擇的總和。你很棒。」— 佚名" },
  { q1: "burnout", q3: "relations", cell: "疲憊 × 人際", quote: "「先照顧好自己，你才能照顧好世界。」— 達賴喇嘛" },
  { q1: "burnout", q3: "future", cell: "疲憊 × 未來", quote: "「不要害怕走慢，只怕站著不動。」— 中國諺語" },
  { q1: "burnout", q3: "expectation", cell: "疲憊 × 期待", quote: "「如果你累了，學會休息，而不是放棄。」— 班克斯" },
  { q1: "burnout", q3: "self", cell: "疲憊 × 內耗", quote: "「擔心就像坐在搖椅上，會讓你一直動，但哪裡也去不了。」— 佚名" },
];

function okBandage(): InteractionTemplate {
  const rules: MatchRule[] = OK_MATRIX.map((row) => ({
    when: [row.q1, row.q3],
    label: row.cell,
    prompt: row.quote,
  }));

  const steps: InteractionStep[] = [
    {
      id: "s_greet",
      name: "歡迎打招呼",
      stationId: "st_front",
      avgSeconds: 15,
      prompt: "要不要玩一個一分鐘的小活動？",
    },
    {
      id: "s_q1",
      name: "Q1 真心話檢測",
      stationId: "st_table",
      avgSeconds: 25,
      prompt: "關於你的科系，目前的真心話是？",
      branch: { kind: "chance", record: "q1", options: Q1_OPTIONS },
    },
    {
      id: "s_q2",
      name: "Q2 自由書寫",
      stationId: "st_table",
      avgSeconds: 40,
      // No fork, and it needs none: free writing is a length of time and a
      // prompt. Those 40 seconds are real, and they are in the queue.
      prompt: "承上題，如果用一句話形容這種感覺，你會說：",
    },
    {
      id: "s_q3",
      name: "Q3 怪獸圖鑑",
      stationId: "st_table",
      avgSeconds: 25,
      prompt: "最近的生活中，哪個「怪獸」最常跑出來讓你覺得煩／內耗？",
      branch: { kind: "chance", record: "q3", options: Q3_OPTIONS },
    },
    {
      id: "s_q4",
      name: "Q4 轉念練習",
      stationId: "st_table",
      avgSeconds: 45,
      prompt: "回想大學以來，有沒有哪個瞬間讓你覺得「其實生活還不錯」？（一句話就好）",
    },
    {
      id: "s_pick",
      name: "對出 OK 蹦金句",
      stationId: "st_table",
      avgSeconds: 10,
      // A lookup, not a roll: which quote you get does not change how long you
      // stand at the table, so it costs no randomness and the same plan gives
      // the same queue twice.
      branch: { kind: "match", on: ["q1", "q3"], rules, otherwise: { label: "通用金句", prompt: "「慢慢來，比較快。」— 佚名" } },
    },
    {
      id: "s_back",
      name: "選卡片背面",
      stationId: "st_card",
      avgSeconds: 20,
      prompt: "挑一張你喜歡的背面",
      branch: {
        kind: "chance",
        options: [
          { id: "b1", label: "插畫款", weight: 1 },
          { id: "b2", label: "書籤款", weight: 1 },
          { id: "b3", label: "手寫款", weight: 1 },
        ],
      },
    },
    {
      id: "s_flip",
      name: "翻面看金句",
      stationId: "st_card",
      avgSeconds: 15,
      prompt: "翻過來，就是你的 OK 蹦",
    },
    {
      id: "s_give",
      name: "領 OK 蹦小卡",
      stationId: "st_card",
      avgSeconds: 20,
      prompt: "背面印期初演講的時間、地點與 QR Code",
      supplies: ["OK 蹦小卡", "卡片背面三款", "筆", "印章"],
      next: null,
    },
  ];

  return {
    id: "preset:ok-bandage",
    name: "心情 OK 蹦",
    note:
      "流程、題目、選項與 4×4 金句矩陣：取自社團自己的擺攤企劃（淡大擺攤區，2026-02-14）。"
      + "每一步的秒數、人流與停留比例：估計值，尚未現場實測 — 擺攤當天用碼錶量過再改。",
    steps,
    startStepId: "s_greet",
    stations: OK_STATIONS.map((s) => ({
      id: s.id,
      name: s.name,
      type: "custom" as const,
      staffRoleId: s.role,
      x: s.x,
      z: s.z,
      staffCount: 1,
      parallelServers: s.servers,
      meanServiceSeconds: 30,
      queueCapacity: s.capacity,
    })),
    staff: [
      { id: "greeter", name: "招呼", count: 1 },
      { id: "host", name: "主持", count: 2 },
      { id: "helper", name: "發卡", count: 1 },
    ],
    audience: {
      // Estimates, flagged in `note`: two hours of a lunchtime walkway, three
      // in ten stopping, seven in ten of those actually sitting down.
      count: 600,
      windowSeconds: 7200,
      profile: "uniform",
      stopRate: 0.3,
      joinRate: 0.7,
      patienceSeconds: 180,
    },
    segments: [{ id: "visitor", name: "路過的同學", share: 1, startStepId: "s_greet" }],
    seed: 20260214,
    settings: { speedMetersPerSecond: 1.15 },
  };
}

function blank(): InteractionTemplate {
  return {
    id: "preset:blank",
    name: "空白流程",
    steps: [{ id: "s1", name: "第一步", avgSeconds: 30, stationId: "st1", next: null }],
    startStepId: "s1",
    stations: [{
      id: "st1", name: "攤位", type: "custom",
      x: 3.5, z: 5, staffCount: 1, parallelServers: 1,
      meanServiceSeconds: 30, queueCapacity: 8,
    }],
    staff: [],
    audience: { count: 60, windowSeconds: 3600, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds: 0 },
    segments: [{ id: "all", name: "參加者", share: 1, startStepId: "s1" }],
    seed: 1,
    settings: { speedMetersPerSecond: 1.2 },
  };
}

function dice(): InteractionTemplate {
  const t = blank();
  return {
    ...t,
    id: "preset:dice",
    name: "骰子小遊戲",
    note: "六個面先給空名字：把它們改成你真正要辦的關卡，秒數不一樣的面會讓隊伍變長，模擬會告訴你差多少。",
    steps: [
      {
        id: "s_roll", name: "擲骰", stationId: "st1", avgSeconds: 20,
        prompt: "擲出你的關卡",
        branch: {
          kind: "chance",
          record: "face",
          options: Array.from({ length: 6 }, (_, i) => ({
            id: `f${i + 1}`, label: `第 ${i + 1} 面`, weight: 1,
          })),
        },
      },
      { id: "s_play", name: "完成關卡", stationId: "st1", avgSeconds: 45 },
      { id: "s_prize", name: "領小物", stationId: "st1", avgSeconds: 15, next: null },
    ],
    startStepId: "s_roll",
    segments: [{ id: "all", name: "參加者", share: 1, startStepId: "s_roll" }],
  };
}

function quickfire(): InteractionTemplate {
  const t = blank();
  const q = (n: number, seconds: number): InteractionStep => ({
    id: `s_q${n}`,
    name: `第 ${n} 題`,
    stationId: "st1",
    avgSeconds: seconds,
    branch: {
      kind: "chance",
      record: `q${n}`,
      options: [
        { id: "a", label: "A", weight: 1, value: "a" },
        { id: "b", label: "B", weight: 1, value: "b" },
      ],
    },
  });
  return {
    ...t,
    id: "preset:quickfire",
    name: "快問快答",
    note: "三題兩選項。要讓答案組合決定結果，在最後加一個「對照表」步驟。",
    steps: [q(1, 15), q(2, 15), q(3, 15), { id: "s_end", name: "公布結果", stationId: "st1", avgSeconds: 20, next: null }],
    startStepId: "s_q1",
    segments: [{ id: "all", name: "參加者", share: 1, startStepId: "s_q1" }],
  };
}

/**
 * The classroom is deliberately absent from this list. A classroom project
 * already has its scenario, and 「改成我自己的流程」 compiles THAT — the user's
 * own numbers — rather than dropping a canned template on top of them.
 */
export const INTERACTION_PRESETS: InteractionPreset[] = [
  {
    id: "preset:ok-bandage",
    name: "心情 OK 蹦",
    summary: "社團擺攤企劃：四題、4×4 金句矩陣、領小卡",
    build: okBandage,
  },
  { id: "preset:blank", name: "空白流程", summary: "一個步驟，從頭自己排", build: blank },
  { id: "preset:dice", name: "骰子小遊戲", summary: "一個六面分岔，面數可改", build: dice },
  { id: "preset:quickfire", name: "快問快答", summary: "三題兩選項", build: quickfire },
];

export function interactionPreset(id: string): InteractionTemplate | null {
  const preset = INTERACTION_PRESETS.find((p) => p.id === id);
  return preset ? preset.build() : null;
}
