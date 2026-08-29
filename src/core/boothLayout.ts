/**
 * Booth layouts — the three strategies a 3 × 3 stall actually has.
 *
 * The classroom builders in `spatialPlanner.ts` assume a room you walk into and
 * sit down in. A stall is the opposite shape: people walk PAST it in an aisle,
 * and the whole design problem is getting them to stop without blocking the
 * aisle for everyone else. Seating is nearly irrelevant; frontage is everything.
 *
 * Two research findings drive every layout here
 * (see `booth-module-3x3` and `booth-entry-clear` in `spatialKnowledge.ts`):
 *
 * 1. Stalls come in a 3 m module, and which sides are open decides where people
 *    can enter from.
 * 2. **The queue must stay inside the stall.** A line that spills into the main
 *    aisle blocks its own visitors and everyone else's — so a layout that
 *    parks the table across the full frontage is buying attention with other
 *    people's circulation.
 *
 * The furniture is the real booth catalogue (tent, booth table, stools, display
 * board, banner) so what the planner proposes is what the club actually owns.
 */
import { boothCatalogExtras } from "./boothCatalog";
import {
  uid,
  type ProjectCatalogExtra,
  type Route,
  type SceneObject,
  type Zone,
} from "./model";

/** Where the stall sits and which way the passing aisle runs. */
export interface BoothFrame {
  /** Centre of the stall footprint. */
  cx: number;
  cz: number;
  /** Module size in metres. */
  width: number;
  depth: number;
  /**
   * Which edge faces the main aisle. Visitors arrive along it, so this is the
   * side that must stay walkable.
   */
  frontage: "north" | "south";
}

export interface BoothParts {
  /**
   * Does the queue fit inside the stall?
   *
   * False for the front-open layout: with the table across the frontage the
   * line has nowhere to form but the aisle. That is a legitimate trade, and
   * `booth-entry-clear` is the research finding that says so — but when the
   * brief says 「不能阻擋主要通道」 it stops being a trade and becomes a
   * disqualification.
   */
  queueContained: boolean;
  objects: SceneObject[];
  zones: Zone[];
  routes: Route[];
  catalogExtras: ProjectCatalogExtra[];
  rationale: string[];
  risks: string[];
  knowledgeRefs: string[];
}

const TENT = "custom:booth-tent";

const TABLE = "custom:booth-table";

const STOOL = "custom:red-stool";

const BOARD = "custom:display-board";

const BANNER = "custom:banner";

/** The booth table’s depth; rotated 90° it becomes the footprint along X. */
const TABLE_DEPTH = 0.75;

const DIMS: Record<string, { width: number; depth: number; height: number; kind: SceneObject["kind"] }> = {
  [TENT]: { width: 3, depth: 3, height: 2.5, kind: "table" },
  [TABLE]: { width: 1.8, depth: 0.75, height: 0.74, kind: "regTable" },
  [STOOL]: { width: 0.32, depth: 0.32, height: 0.45, kind: "chair" },
  [BOARD]: { width: 0.9, depth: 0.05, height: 1.8, kind: "screen" },
  [BANNER]: { width: 0.8, depth: 0.05, height: 2.0, kind: "screen" },
};

function place(assetId: string, x: number, z: number, rotationDeg = 0, role?: SceneObject["serviceRole"]): SceneObject {
  const d = DIMS[assetId];
  return {
    id: uid("obj"),
    kind: d.kind,
    assetId,
    ...(role ? { serviceRole: role } : {}),
    x, z,
    rotationDeg,
    width: d.width,
    depth: d.depth,
    height: d.height,
    locked: false,
    hidden: false,
    surface: "floor",
    elevation: 0,
  };
}

function zone(name: string, icon: string, color: string, x: number, z: number, w: number, d: number): Zone {
  return {
    id: uid("zone"),
    type: "custom",
    name,
    x, z,
    width: Math.max(0.3, w),
    depth: Math.max(0.3, d),
    color,
    icon,
    capacity: null,
    locked: false,
    hidden: false,
  };
}

function route(name: string, color: string, points: { x: number; z: number }[]): Route {
  return { id: uid("route"), name, color, type: "entry", points, visible: true };
}

/** Sign of "into the stall" from the aisle. */
function inward(frame: BoothFrame): number {
  return frame.frontage === "south" ? -1 : 1;
}

/** The aisle-facing edge's z, and the back edge's z. */
function edges(frame: BoothFrame): { front: number; back: number } {
  const half = frame.depth / 2;
  return frame.frontage === "south"
    ? { front: frame.cz + half, back: frame.cz - half }
    : { front: frame.cz - half, back: frame.cz + half };
}

function shell(frame: BoothFrame): SceneObject[] {
  return [place(TENT, frame.cx, frame.cz)];
}

/**
 * A — 正面開放.
 *
 * The table runs across the frontage. It is the most visible arrangement and
 * the one every club reaches for first, which is exactly why its cost is worth
 * stating: the queue has nowhere to go but the aisle.
 */
export function buildBoothFrontOpen(frame: BoothFrame): BoothParts {
  const inn = inward(frame);
  const { front, back } = edges(frame);
  const tableZ = front + inn * 0.6;
  const objects = [
    ...shell(frame),
    place(TABLE, frame.cx, tableZ, frame.frontage === "south" ? 180 : 0, "checkin"),
    place(STOOL, frame.cx - 0.5, tableZ + inn * 0.7),
    place(STOOL, frame.cx + 0.5, tableZ + inn * 0.7),
    place(BOARD, frame.cx, back + -inn * 0.1, frame.frontage === "south" ? 180 : 0),
  ];
  const zones = [
    zone("工作人員區", "🦺", "#f43f5e", frame.cx, tableZ + inn * 0.8, frame.width - 0.4, 0.8),
    zone("訪客站立區", "🧍", "#38bdf8", frame.cx, front - inn * 0.1, frame.width, 0.6),
  ];
  return {
    queueContained: false,
    objects,
    zones,
    routes: [route("參觀動線", "#38bdf8", [
      { x: frame.cx - frame.width, z: front + inn * -0.4 },
      { x: frame.cx, z: front + inn * -0.4 },
      { x: frame.cx + frame.width, z: front + inn * -0.4 },
    ])],
    catalogExtras: boothCatalogExtras(),
    rationale: [
      "攤位桌橫在正面，路過的人一眼看到，是最容易吸引注意的排法。",
      "工作人員站在桌後，動線最單純，兩個人就能顧。",
    ],
    risks: [
      "**排隊的人只能站在主通道上**——人一多會同時擋住自己的訪客和別攤的人。",
      "桌子擋滿正面，想進來體驗的人沒有地方可以站進來。",
    ],
    knowledgeRefs: ["booth-module-3x3", "booth-entry-clear", "queue-single-line"],
  };
}

/**
 * B — 側面入口.
 *
 * The table turns 90° and runs along one side, leaving the other half of the
 * frontage open as a way in. The queue then folds along the table INSIDE the
 * stall, which is what `booth-entry-clear` actually asks for.
 */
export function buildBoothSideEntry(frame: BoothFrame): BoothParts {
  const inn = inward(frame);
  const { front, back } = edges(frame);
  const leftX = frame.cx - frame.width / 2;
  // Rotated 90°, the table's 0.75 m depth runs along X. Inset it far enough
  // that a stool fits behind it WITHOUT the two footprints touching and
  // without the staff zone hanging outside the stall — the first attempt did
  // both, and the validator said so.
  const staffX = leftX + 0.26;
  const tableX = leftX + 0.9;
  const queueX = tableX + TABLE_DEPTH / 2 + 0.4;
  const tableZ = frame.cz;
  const objects = [
    ...shell(frame),
    place(TABLE, tableX, tableZ, 90, "checkin"),
    place(STOOL, staffX, tableZ - 0.4),
    place(STOOL, staffX, tableZ + 0.4),
    place(BOARD, frame.cx + frame.width / 2 - 0.3, back + -inn * 0.2, frame.frontage === "south" ? 180 : 0),
    place(BANNER, leftX + 0.15, front + inn * 0.3, frame.frontage === "south" ? 180 : 0),
  ];
  const entryX = frame.cx + frame.width / 4;
  const zones = [
    zone("入口", "🚪", "#f97316", entryX, front + inn * 0.3, frame.width / 2 - 0.2, 0.6),
    // The queue lives inside the stall, running alongside the table.
    zone("排隊區", "⏳", "#facc15", queueX, frame.cz, 0.8, frame.depth - 0.8),
    zone("工作人員區", "🦺", "#f43f5e", staffX, frame.cz, 0.5, frame.depth - 1.0),
    zone("互動體驗區", "🎲", "#a78bfa", frame.cx + frame.width / 2 - 0.45, frame.cz + inn * 0.3, 0.7, frame.depth / 2),
  ];
  return {
    queueContained: true,
    objects,
    zones,
    routes: [route("參觀動線", "#38bdf8", [
      { x: entryX, z: front - inn * 0.5 },
      { x: entryX, z: frame.cz },
      { x: queueX, z: frame.cz },
    ])],
    catalogExtras: boothCatalogExtras(),
    rationale: [
      "攤位桌轉 90 度靠左側，正面留一半當入口，人可以走進來而不是堵在外面。",
      "**排隊區收在攤位裡面**，沿著桌子折返，不會溢到主通道上。",
      "立牌放在入口側，遠遠就看得到這一攤在做什麼。",
    ],
    risks: [
      "正面可見度比 A 低，需要靠立牌和主動招呼補回來。",
      "入口只有一半寬，尖峰時進出的人會互相讓道。",
    ],
    knowledgeRefs: ["booth-entry-clear", "booth-module-3x3", "staff-operations-guidance"],
  };
}

/**
 * C — 體驗優先.
 *
 * Table pushed to the back wall, the whole front and middle left open. Highest
 * dwell time and the most room for an activity, at the cost of the desk being
 * the last thing a passer-by sees rather than the first.
 */
export function buildBoothExperience(frame: BoothFrame): BoothParts {
  const inn = inward(frame);
  const { front, back } = edges(frame);
  // Far enough off the back edge that the staff stools fit BEHIND the table
  // and still inside the stall. At 0.5 m the stools overlapped the table.
  const tableZ = back - inn * 0.9;
  const staffZ = tableZ + inn * 0.55;
  const objects = [
    ...shell(frame),
    place(TABLE, frame.cx, tableZ, frame.frontage === "south" ? 180 : 0, "checkin"),
    place(STOOL, frame.cx - 0.5, staffZ),
    place(STOOL, frame.cx + 0.5, staffZ),
    place(BANNER, frame.cx - frame.width / 2 + 0.15, front + inn * 0.3, frame.frontage === "south" ? 180 : 0),
    place(BANNER, frame.cx + frame.width / 2 - 0.15, front + inn * 0.3, frame.frontage === "south" ? 180 : 0),
  ];
  const zones = [
    zone("入口", "🚪", "#f97316", frame.cx, front + inn * 0.25, frame.width - 0.6, 0.5),
    zone("互動體驗區", "🎲", "#a78bfa", frame.cx, frame.cz + inn * 0.2, frame.width - 0.6, frame.depth / 2),
    zone("排隊區", "⏳", "#facc15", frame.cx, tableZ + -inn * 0.85, frame.width - 0.8, 0.7),
    zone("工作人員區", "🦺", "#f43f5e", frame.cx, staffZ, frame.width - 0.6, 0.5),
  ];
  return {
    queueContained: true,
    objects,
    zones,
    routes: [route("參觀動線", "#38bdf8", [
      { x: frame.cx, z: front - inn * 0.5 },
      { x: frame.cx, z: frame.cz },
      { x: frame.cx, z: tableZ + -inn * 0.85 },
    ])],
    catalogExtras: boothCatalogExtras(),
    rationale: [
      "桌子退到最後面，整個正面和中間都空出來給體驗活動。",
      "停留時間最長，適合要讓人玩一下、聊一下的攤位。",
      "兩側立旗把攤位範圍框出來，路過的人知道可以走進來。",
    ],
    risks: [
      "桌子在最裡面，路過的人不會第一眼看到服務台，需要有人主動招呼。",
      "沒有實體屏障，體驗中的人和排隊的人容易混在一起。",
    ],
    knowledgeRefs: ["booth-entry-clear", "booth-module-3x3", "student-club-staffing"],
  };
}
