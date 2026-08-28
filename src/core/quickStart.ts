/**
 * Quick Start — turn "今天要排什麼？" answers into a ready-to-edit project.
 *
 * Pure functions only: pick a venue preset, tick what the event needs, give a
 * head count, and get back a Project with zones, desks, mats and a starter
 * route already placed. Everything it creates is a normal editable entity —
 * this is a starting point, never a locked template.
 */

import { areaBounds } from "./placement";
import { BUILTIN_CATALOG } from "./catalog";
import { generateLayouts } from "./smartLayout";
import {
  uid,
  ZONE_DEFAULTS,
  type Project,
  type EventScenario,
  type ServiceStation,
  type SceneObject,
  type Zone,
  type ZoneType,
} from "./model";
import { routePreset } from "./routes";
import { createProjectFromVenuePreset, type VenuePreset } from "./venues";

export interface QuickStartNeeds {
  mats: boolean;
  checkin: boolean;
  payment: boolean;
  life?: boolean;
  shoe: boolean;
  backpack: boolean;
  teacher: boolean;
  groups: boolean;
  staffRoute: boolean;
}

export interface QuickStartConfig {
  venue: VenuePreset;
  eventName: string;
  participants: number;
  needs: QuickStartNeeds;
  /** Keep a central aisle when laying mats (default true). */
  centralAisle: boolean;
}

export const DEFAULT_NEEDS: QuickStartNeeds = {
  mats: true,
  checkin: true,
  payment: false,
  life: false,
  shoe: true,
  backpack: true,
  teacher: false,
  groups: false,
  staffRoute: false,
};

function makeZone(type: ZoneType, x: number, z: number): Zone {
  const d = ZONE_DEFAULTS[type];
  return {
    id: uid("zone"),
    type,
    name: d.label,
    x,
    z,
    width: d.width,
    depth: d.depth,
    color: d.color,
    locked: false,
    hidden: false,
    icon: d.icon,
    capacity: null,
  };
}

function deskObject(assetId: "builtin:regTable" | "builtin:payment-desk", x: number, z: number, rotationDeg: number): SceneObject {
  const entry = BUILTIN_CATALOG.find((e) => e.id === assetId)!;
  return {
    id: uid("obj"),
    kind: entry.kind,
    x,
    z,
    rotationDeg,
    width: entry.dimensions.width,
    depth: entry.dimensions.depth,
    height: entry.dimensions.height,
    locked: false,
    hidden: false,
    surface: "floor",
    elevation: 0,
    assetId,
    serviceRole: entry.serviceRole,
  };
}

/**
 * 教室自己的一體式課桌椅，推到側牆當背包架。
 *
 * 照片實況：這些椅子不是「多出來的家具」，它們是被清出墊區、沿側牆排好的
 * 教室原有課桌椅，然後大家把背包放在板子與座位上。
 */
function deskChairObject(x: number, z: number): SceneObject {
  const entry = BUILTIN_CATALOG.find((e) => e.id === "builtin:chair")!;
  return {
    id: uid("obj"), kind: entry.kind, x, z, rotationDeg: 270,
    width: entry.dimensions.width, depth: entry.dimensions.depth, height: entry.dimensions.height,
    locked: false, hidden: false, surface: "floor", elevation: 0,
    assetId: entry.id, note: "推到側邊的課桌椅，板子上放背包",
  };
}

function tabletopObject(assetId: "builtin:computer" | "builtin:payment-box", parent: SceneObject): SceneObject {
  const entry = BUILTIN_CATALOG.find((e) => e.id === assetId)!;
  return {
    id: uid("obj"), kind: entry.kind, x: parent.x, z: parent.z, rotationDeg: 0,
    width: entry.dimensions.width, depth: entry.dimensions.depth, height: entry.dimensions.height,
    locked: false, hidden: false, surface: "tabletop", elevation: entry.defaultElevation ?? parent.height,
    parentId: parent.id, assetId: entry.id, serviceRole: entry.serviceRole,
  };
}

/**
 * Where the people come in: the door's position, or the corridor-side wall
 * center when no door exists yet.
 */
function entranceOf(project: Project): { x: number; z: number } {
  const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
  if (door) return { x: door.x, z: door.z };
  const c = project.classroom;
  return { x: c.x + c.length / 2, z: c.z + c.width };
}

export function buildQuickStartProject(config: QuickStartConfig): Project {
  const project = createProjectFromVenuePreset(config.venue, config.eventName || "未命名活動");
  const c = project.classroom;
  const entry = entranceOf(project);
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const inX = (x: number, halfW: number) => clamp(x, c.x + halfW + 0.2, c.x + c.length - halfW - 0.2);
  const inZ = (z: number, halfD: number) => clamp(z, c.z + halfD + 0.2, c.z + c.width - halfD - 0.2);
  const needs = config.needs;
  const backWallZ = c.z + c.width; // entrance side (door faces the corridor)

  /*
   * 報到桌在教室裡，不在走廊。
   *
   * 這一段原本把報到與收費排成一條走廊服務鏈，那是從「活動流程文字」推出來的，
   * 不是看來的。88 張活動實況照裡：走廊一次都沒有出現，沒有任何人在走廊排隊或
   * 設站；報到位置固定在**教室內側牆後段**，用一張白色摺疊桌加上教室自己的
   * 課桌椅拼成，桌上有筆電、簽到表、名牌、收錢袋。
   * 詳見 docs/field-research/REFERENCE_MAPPING.md 第三節。
   *
   * 收費也不在入口：社費是活動後段「各家座談」時各家自己收（牛皮紙袋 ×6）。
   * 所以收費桌預設緊鄰報到桌，是同一個工作區，而不是動線上的第二個關卡。
   */
  const serviceChain: ZoneType[] = [];
  if (needs.checkin) serviceChain.push("registration");
  if (needs.payment) serviceChain.push("payment");
  // 服務桌沿「側牆後段」擺；鞋子與背包不在這條鏈上（見下面各自的實照位置）。
  let cursor = Math.min(entry.x - 0.95, c.x + c.length - 0.2);
  for (const type of serviceChain) {
    const d = ZONE_DEFAULTS[type];
    const centerX = inX(cursor - d.width / 2, d.width / 2);
    const centerZ = inZ(backWallZ - 0.35 - d.depth / 2, d.depth / 2);
    const zone = makeZone(type, centerX, centerZ);
    project.zones.push(zone);
    // 面向房間內側：工作人員坐在桌後看著門與整個場地（實照如此）。
    if (type === "registration") project.objects.push(deskObject("builtin:regTable", zone.x, zone.z, 180));
    if (type === "payment") project.objects.push(deskObject("builtin:payment-desk", zone.x, zone.z, 180));
    cursor = centerX - d.width / 2 - 0.3;
  }
  if (needs.teacher) {
    const d = ZONE_DEFAULTS.meditation;
    const platform = project.objects.find((o) => o.assetId === "builtin:stage-platform");
    const platformFront = platform ? platform.z + platform.depth / 2 : c.z + 1.2;
    // 有講台時，講師帶是講台前的一條窄走動帶（照片實況），壓縮深度留座位空間。
    const depth = platform ? 1.2 : d.depth;
    const zone = makeZone("meditation", c.x + c.length / 2, inZ(platformFront + depth / 2 + 0.25, depth / 2));
    zone.depth = depth;
    project.zones.push(zone);
  }
  if (needs.life) {
    const d = ZONE_DEFAULTS.life;
    project.zones.push(makeZone("life", inX(c.x + c.length - d.width / 2 - 0.5, d.width / 2), inZ(backWallZ - d.depth / 2 - 0.35, d.depth / 2)));
  }
  if (needs.groups) {
    const d = ZONE_DEFAULTS.group;
    project.zones.push(makeZone("group", inX(c.x + c.length - d.width / 2 - 0.5, d.width / 2), c.z + c.width / 2));
  }

  // Mats face the front (screen side, min-Z), leaving room near the entrance.
  if (needs.mats && config.participants > 0) {
    const bounds = areaBounds(c);
    const inset = 0.4;
    // 只有真正擺在後段的服務桌會壓縮座位深度。鞋子與背包是**側邊**的東西
    // （照片：鞋子排在墊區左右邊緣的裸地板、背包在側牆課桌椅上），把它們算進
    // 後方保留帶等於重複扣一次，60 人的場會被算成坐不下。
    const rearZones = project.zones.filter((z) =>
      (z.type === "registration" || z.type === "payment") &&
      z.z <= backWallZ && z.z > c.z + c.width / 2);
    const rearFront = rearZones.length ? Math.min(...rearZones.map((z) => z.z - z.depth / 2)) : backWallZ - 0.2;
    const entranceReserve = Math.max(0.6, backWallZ - rearFront + 0.95);
    // Reserve exactly what the front actually occupies (stage platform and/or
    // the teacher strip), instead of a hardcoded depth.
    const teacherZone = project.zones.find((z) => z.type === "meditation");
    const platformObj = project.objects.find((o) => o.assetId === "builtin:stage-platform");
    const frontObstacleZ = Math.max(
      platformObj ? platformObj.z + platformObj.depth / 2 : c.z,
      teacherZone ? teacherZone.z + teacherZone.depth / 2 : c.z,
    );
    const frontReserve = Math.max(inset, frontObstacleZ - c.z + 0.25);
    // 側邊要留的東西：小組區（+X 側），以及**鞋子的兩條裸地帶**與背包用的
    // 課桌椅——照片裡墊區本來就不貼牆，四周留一圈裸地板。
    const shoeStrip = needs.shoe ? 0.8 : 0;
    const bagStrip = needs.backpack ? 0.9 : 0;
    const sideReserve = (needs.groups ? ZONE_DEFAULTS.group.width + 1.0 : inset) + shoeStrip + bagStrip;
    const matArea = {
      minX: bounds.minX + inset + shoeStrip,
      maxX: bounds.maxX - sideReserve,
      minZ: bounds.minZ + frontReserve,
      maxZ: bounds.maxZ - entranceReserve,
    };
    // 禪學社的地墊習慣直向、一排排相黏（gap 0）；走道另外留。
    const candidates = generateLayouts({
      participants: config.participants,
      matWidth: 0.6,
      matDepth: 1.8,
      gap: 0,
      aisleWidth: 0.9,
      bounds: matArea,
      mode: project.venuePresetId === "venue:tku-classroom" || project.venuePresetId === "venue:tku-e310" ? "field" : "individual",
    });
    const preferred =
      (config.centralAisle ? candidates.find((cand) => cand.id === "aisle" || cand.id === "field-aisle") : null) ??
      candidates.find((cand) => cand.fits) ??
      candidates[0];
    if (preferred) {
      preferred.groups.forEach((g, i) => {
        project.groups.push({
          id: uid("grp"),
          name: `地墊區 ${preferred.groups.length > 1 ? String.fromCharCode(65 + i) : ""}`.trim() || "地墊區",
          sourceKind: "mat",
          rows: g.rows,
          cols: g.cols,
          itemWidth: g.itemWidth,
          itemDepth: g.itemDepth,
          itemHeight: 0.04,
          gapX: g.gapX,
          gapZ: g.gapZ,
          rotationDeg: g.rotationDeg,
          anchorX: g.anchorX,
          anchorZ: g.anchorZ,
          locked: false,
          hidden: false,
          numberPrefix: preferred.groups.length > 1 ? String.fromCharCode(65 + i) : "M",
          numberOrder: "row",
          numberStart: "nw",
        });
      });
    }
  }

  /*
   * 鞋子與背包依照片實況擺，而不是排進入口的服務鏈。
   *
   *  - 鞋子：脫在**墊區邊緣的裸地板**上，成對排列、鞋尖朝外，而且**左右兩側各一列**
   *    （三路獨立看照片都確認）。所以做成兩條沿墊區長邊的窄帶，不是門口一塊方形區。
   *  - 背包：放在側牆**停放的課桌椅**上（座位、板子、椅背、椅下鐵籃），不是後牆長桌。
   *    所以背包區疊在課桌椅那一側，並實際放幾張課桌椅當作載體。
   */
  const matField = project.groups.find((g) => g.sourceKind === "mat");
  if (needs.shoe && matField) {
    const fieldMinX = matField.anchorX;
    const fieldMaxX = matField.anchorX + matField.cols * matField.itemWidth;
    const fieldMinZ = matField.anchorZ;
    const fieldMaxZ = matField.anchorZ + matField.rows * matField.itemDepth;
    const midZ = (fieldMinZ + fieldMaxZ) / 2;
    const stripDepth = Math.min(3.0, fieldMaxZ - fieldMinZ);
    const existing = project.zones.find((z) => z.type === "shoe");
    if (existing) project.zones.splice(project.zones.indexOf(existing), 1);
    for (const [side, x] of [["左", fieldMinX - 0.45], ["右", fieldMaxX + 0.45]] as [string, number][]) {
      const zone = makeZone("shoe", inX(x, 0.35), inZ(midZ, stripDepth / 2));
      zone.name = `鞋子｜${side}側`;
      zone.color = side === "左" ? "#eab308" : "#f59e0b";
      zone.width = 0.7;
      zone.depth = stripDepth;
      project.zones.push(zone);
    }
  }
  if (needs.backpack) {
    // 背包區在這裡才建立：它的位置由墊區決定（側牆課桌椅那一側），
    // 所以不能跟報到桌一起排在後段服務鏈上。
    const bag = makeZone("backpack", c.x + c.length / 2, c.z + c.width / 2);
    project.zones.push(bag);
    if (matField) {
      // 課桌椅那一側：墊區右緣之外的裸地板帶。
      const fieldMaxX = matField.anchorX + matField.cols * matField.itemWidth;
      bag.x = inX(fieldMaxX + 1.3, bag.width / 2);
      bag.z = inZ((matField.anchorZ + matField.anchorZ + matField.rows * matField.itemDepth) / 2, bag.depth / 2);
      bag.name = "背包｜課桌椅";
      // 三張課桌椅當載體，背包實際就是放在這些板子上。
      for (let i = -1; i <= 1; i++) {
        project.objects.push(deskChairObject(bag.x, inZ(bag.z + i * 0.95, 0.3)));
      }
    }
  }

  /*
   * 入場動線：門 → 報到（教室內）→ 脫鞋（墊區邊緣）→ 座區前緣。
   *
   * 沒有走廊段：實況照裡人是直接走進教室、在教室內側牆報到的。
   * 收費不在這條線上——社費在活動後段各家座談時收。
   */
  const routeStops: { x: number; z: number }[] = [];
  const checkinZone = project.zones.find((z) => z.type === "registration");
  const shoeZones = project.zones.filter((z) => z.type === "shoe");
  routeStops.push({ x: entry.x, z: inZ(backWallZ - 0.4, 0) });
  if (checkinZone) routeStops.push({ x: checkinZone.x, z: checkinZone.z });
  // 兩側鞋區時走靠門的那一側，不要讓動線橫穿整個場地。
  const shoeZone = shoeZones.length
    ? shoeZones.reduce((best, z) => (Math.abs(z.x - entry.x) < Math.abs(best.x - entry.x) ? z : best))
    : undefined;
  if (shoeZone) routeStops.push({ x: shoeZone.x, z: shoeZone.z });
  const fieldGroup = project.groups.find((g) => g.sourceKind === "mat");
  const seatingEdgeZ = fieldGroup
    ? fieldGroup.anchorZ + fieldGroup.rows * fieldGroup.itemDepth + 0.3
    : needs.mats
      ? c.z + c.width - 2.3
      : c.z + c.width / 2;
  routeStops.push({ x: c.x + c.length / 2, z: inZ(seatingEdgeZ, 0) });
  if (routeStops.length >= 2) {
    const preset = routePreset("entry");
    project.routes.push({
      id: uid("route"),
      name: preset.label,
      color: preset.color,
      points: routeStops,
      visible: true,
      type: "entry",
    });
  }
  if (needs.staffRoute) {
    const preset = routePreset("staff");
    project.routes.push({
      id: uid("route"),
      name: preset.label,
      color: preset.color,
      points: [
        { x: c.x + 0.8, z: c.z + c.width - 0.8 },
        { x: c.x + 0.8, z: c.z + 0.8 },
        { x: c.x + c.length - 0.8, z: c.z + 0.8 },
      ],
      visible: true,
      type: "staff",
    });
  }

  project.description = `${config.participants} 人`;
  // Open in the 3D isometric view so the result reads as a real room, not a
  // flat diagram; 俯視 stays one tap away in 視角.
  project.view = "iso";
  return project;
}

/**
 * Photo-grounded 30-person Zen club setup used as the visual release baseline.
 *
 * Unlike the 60-person flow stress case below, this scene only contains what
 * the activity photos repeatedly show: one continuous green mat field, an
 * in-room check-in desk, paired shoes on the bare side strips, bags on the
 * classroom's writing-tablet chairs, a teacher strip and a small life-crew
 * corner.  The corridor stays physically clear and payment is deliberately
 * absent because the evidence places fee collection later in small groups.
 */
export function buildE310ClubGoldenProject(venue: VenuePreset): Project {
  const project = buildQuickStartProject({
    venue,
    eventName: "E310 禪學社社課（30 人）",
    participants: 30,
    needs: {
      mats: true, checkin: true, payment: false, life: true,
      shoe: true, backpack: true, teacher: true, groups: false, staffRoute: false,
    },
    centralAisle: true,
  });
  const checkin = project.objects.find((o) => o.serviceRole === "checkin");
  if (checkin) project.objects.push(tabletopObject("builtin:computer", checkin));
  const route = project.routes[0];
  const door = project.objects.find((o) => o.kind === "door");
  const checkinZone = project.zones.find((z) => z.type === "registration");
  const shoes = project.zones.filter((z) => z.type === "shoe");
  const backpack = project.zones.find((z) => z.type === "backpack");
  const field = project.groups.find((g) => g.sourceKind === "mat");
  if (route && checkinZone && shoes.length && backpack && field) {
    const nearShoe = shoes.reduce((best, zone) => Math.abs(zone.x - (door?.x ?? checkinZone.x)) < Math.abs(best.x - (door?.x ?? checkinZone.x)) ? zone : best);
    const rearZ = field.anchorZ + field.rows * field.itemDepth + 0.28;
    const rightLaneX = Math.max(nearShoe.x, backpack.x);
    route.points = [
      { x: door?.x ?? checkinZone.x, z: project.classroom.z + project.classroom.width - 0.28 },
      { x: checkinZone.x, z: checkinZone.z },
      { x: nearShoe.x, z: nearShoe.z + Math.min(0.8, nearShoe.depth * 0.3) },
      { x: backpack.x, z: backpack.z - Math.min(0.8, backpack.depth * 0.3) },
      { x: rightLaneX, z: rearZ },
      { x: field.anchorX + field.cols * field.itemWidth / 2, z: rearZ },
    ];
  }
  // Keep the everyday editor view photographic and uncluttered. The route is
  // still part of the project and appears in the dedicated route export.
  for (const route of project.routes) route.visible = false;
  project.description = "30 人社課｜綠色連續巧拼｜教室內報到｜走廊淨空";
  project.view = "iso";
  return project;
}

/** A deterministic, editable E310 release example used by Quick Start and tests. */
export function buildE310GoldenProject(venue: VenuePreset): Project {
  const project = buildQuickStartProject({
    venue,
    eventName: "E310 演講活動（範例）",
    participants: 60,
    needs: {
      mats: true, checkin: true, payment: true, life: true,
      shoe: true, backpack: true, teacher: true, groups: false, staffRoute: false,
    },
    centralAisle: true,
  });
  const corr = project.corridor;
  const door = project.objects.find((o) => o.kind === "door");
  const zone = (type: string) => project.zones.find((z) => z.type === type);
  const station = (type: ServiceStation["type"], name: string, x: number, z: number, extra: Partial<ServiceStation> = {}): ServiceStation => ({
    id: uid("stn"), type, name, x, z, staffCount: 1, parallelServers: 1,
    meanServiceSeconds: type === "payment" ? 60 : type === "checkin" ? 45 : 15,
    queueCapacity: 80, ...extra,
  });
  const entrance = station("entrance", "走廊入口", corr.x + 0.6, corr.z + corr.width / 2);
  const guide = station("guide", "走廊引導", corr.x + 2.3, corr.z + 0.4);
  const queue = station("queue", "走廊排隊", corr.x + 4.5, corr.z + 0.4);
  const checkinZone = zone("registration")!;
  const paymentZone = zone("payment")!;
  const shoeZone = zone("shoe")!;
  const backpackZone = zone("backpack")!;
  const field = project.groups[0];
  const seatingPosition = field
    ? { x: field.anchorX + field.cols * field.itemWidth / 2, z: field.anchorZ + field.rows * field.itemDepth / 2 }
    : { x: project.classroom.x + project.classroom.length / 2, z: project.classroom.z + 4 };
  const checkinObj = project.objects.find((o) => o.serviceRole === "checkin");
  const paymentObj = project.objects.find((o) => o.serviceRole === "payment");
  if (checkinObj) project.objects.push(tabletopObject("builtin:computer", checkinObj));
  if (paymentObj) project.objects.push(tabletopObject("builtin:payment-box", paymentObj));
  // 實際要搬的現場物資也擺進範例，物資清單才數得出鞋架/欄杆/立牌。
  const prop = (assetId: string, x: number, z: number, rotationDeg = 0): SceneObject => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === assetId)!;
    return {
      id: uid("obj"), kind: entry.kind, x, z, rotationDeg,
      width: entry.dimensions.width, depth: entry.dimensions.depth, height: entry.dimensions.height,
      locked: false, hidden: false, surface: "floor", elevation: 0,
      assetId: entry.id, serviceRole: entry.serviceRole,
    };
  };
  /*
   * 這裡原本擺了鞋架 ×2、排隊欄杆 ×3 與指示立牌。三樣都拿掉了，因為證據不支持：
   *   - 鞋架：88 張活動照裡沒有任何鞋架，鞋子是直接成對放在墊區邊緣的地板上
   *   - 排隊欄杆／指示立牌：走廊在活動照裡一次都沒出現過，更沒有立過牌或圍過欄
   * 範例場景寧可少擺，也不要把沒人搬去現場的東西寫進物資清單。
   * 桌上的筆電與收錢袋則有照片佐證，保留（見上面 tabletopObject）。
   */
  void prop;
  const stations: ServiceStation[] = [
    entrance, guide, queue,
    station("checkin", "報到", checkinObj?.x ?? checkinZone.x, checkinObj?.z ?? checkinZone.z, { objectId: checkinObj?.id, zoneId: checkinZone.id, staffCount: 2, parallelServers: 2 }),
    station("payment", "現場收費", paymentObj?.x ?? paymentZone.x, paymentObj?.z ?? paymentZone.z, { objectId: paymentObj?.id, zoneId: paymentZone.id }),
    station("shoe", "鞋子", shoeZone.x, shoeZone.z, { zoneId: shoeZone.id }),
    station("backpack", "後牆長桌", backpackZone.x, backpackZone.z, { zoneId: backpackZone.id }),
    station("seating", "巧拼座區", seatingPosition.x, seatingPosition.z),
  ];
  const ids = (types: ServiceStation["type"][]) => types.map((t) => stations.find((s) => s.type === t)!.id);
  const prepaid = ids(["entrance", "guide", "queue", "checkin", "shoe", "backpack", "seating"]);
  const onsite = ids(["entrance", "guide", "queue", "checkin", "payment", "shoe", "backpack", "seating"]);
  const scenario: EventScenario = {
    id: uid("scn"), name: "E310 演講範例（60 人）", participantCount: 60,
    // 15 minutes, front-loaded — the value its own spec records:
    // docs/e310/E310_GOLDEN_SCENARIO.md 「E310 演講範例（60 人）」→「到達窗預設 15 分鐘、front-loaded」.
    //
    // This shipped as 1200 s citing REAL_REFERENCE_CONTRACT.md §8, which is the
    // E310 Golden Scenario Gate and contains no numbers at all — it lists the
    // flow, not the arrival window. Neither 15 nor 20 minutes is field-measured
    // (both are planning assumptions the user can change), so the tie-break is
    // simply: follow the spec that actually says something, and cite it.
    arrivalWindowSeconds: 15 * 60, arrivalProfile: "front-loaded",
    profiles: [
      { id: "prepaid", ratio: 40 / 60, branch: prepaid },
      { id: "pay-on-site", ratio: 20 / 60, branch: onsite },
    ],
    stations, seed: 310, settings: { speedMetersPerSecond: 1.0 },
  };
  project.scenarios = [scenario];
  project.activeScenarioId = scenario.id;
  // The route ends at the mouth of the central aisle on the field's REAR edge
  // (where people actually step onto the mats) — never inside the field.
  const fieldRearZ = field
    ? field.anchorZ + field.rows * field.itemDepth + 0.3
    : project.classroom.z + project.classroom.width / 2;
  const aisleMouthX = project.groups.length >= 2
    ? (project.groups[0].anchorX + project.groups[0].cols * project.groups[0].itemWidth + project.groups[1].anchorX) / 2
    : seatingPosition.x;
  const routePoints = [
    { x: entrance.x, z: entrance.z },
    { x: guide.x, z: guide.z },
    { x: queue.x, z: queue.z },
    { x: checkinZone.x, z: checkinZone.z },
    { x: paymentZone.x, z: paymentZone.z },
    { x: door?.x ?? project.classroom.x + project.classroom.length - 1.4, z: door?.z ?? project.classroom.z + project.classroom.width },
    { x: shoeZone.x, z: shoeZone.z },
    { x: aisleMouthX, z: Math.min(fieldRearZ, project.classroom.z + project.classroom.width - 0.4) },
  ];
  project.routes = [{ id: uid("route"), name: "E310 入場動線", color: "#22c55e", points: routePoints, visible: true, type: "entry" }];
  project.description = "60 人｜40 人預繳／20 人現場繳費｜15 分鐘到達窗";
  return project;
}
