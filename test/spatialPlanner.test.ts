import { describe, expect, it } from "vitest";
import {
  buildScheme,
  compareSchemes,
  generateLayoutSchemes,
  projectWithScheme,
  RECOMMENDED_SCHEME,
} from "../src/core/spatialPlanner";
import { validateProject, issueCounts } from "../src/core/validation";
import { createDefaultProject, type Project, type SceneObject } from "../src/core/model";
import { areaBounds } from "../src/core/placement";

function obj(over: Partial<SceneObject> & { id: string }): SceneObject {
  return {
    kind: "table", x: 2, z: 2, rotationDeg: 0, width: 1.2, depth: 0.6, height: 0.74,
    locked: false, hidden: false, surface: "floor", elevation: 0,
    ...over,
  } as SceneObject;
}

/** A room big enough that the schemes differ for reasons other than "it doesn't fit". */
function bigRoom(): Project {
  const p = createDefaultProject();
  p.classroom = { ...p.classroom, length: 14, width: 11 };
  p.corridor = { ...p.corridor, x: 0, z: 11, length: 14, width: 2 };
  p.objects.push(obj({
    id: "door1", kind: "door", x: 7, z: 11, width: 0.9, depth: 0.1, height: 2,
    surface: "wall", assetId: "builtin:door",
  }));
  return p;
}

describe("scheme generation", () => {
  it("produces three named strategies", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 4 });
    expect(r.schemes.map((s) => s.id)).toEqual(["scheme-a", "scheme-b", "scheme-c"]);
    for (const s of r.schemes) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.rationale.length).toBeGreaterThan(0);
    }
  });

  it("gives every scheme the full output the brief asks for", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 4 });
    for (const s of r.schemes) {
      expect(s.objects.length).toBeGreaterThan(0);      // 物件配置
      expect(s.zones.length).toBeGreaterThan(0);        // 區域配置
      expect(s.routes.length).toBeGreaterThan(0);       // 動線配置
      expect(s.estimatedCapacity).toBeGreaterThan(0);   // 預估容量
      expect(s.simulation).not.toBeNull();              // 等待時間
      expect(s.simulation!.avgWaitSeconds).toBeGreaterThanOrEqual(0);
      expect(s.simulation!.maxWaitSeconds).toBeGreaterThanOrEqual(s.simulation!.avgWaitSeconds);
      expect(s.simulation!.busiest).not.toBeNull();     // 最擁擠位置
      expect(s.validation).toBeTruthy();                // Validation 結果
      expect(s.score.total).toBeGreaterThan(0);         // 方案分數
      expect(s.rationale.length).toBeGreaterThan(0);    // 設計理由
      expect(s.risks.length).toBeGreaterThan(0);        // 風險與限制
      expect(s.knowledgeRefs.length).toBeGreaterThan(0);
    }
  });

  it("says when it had to guess the entrance instead of guessing silently", () => {
    const noDoor = createDefaultProject();
    const r = generateLayoutSchemes(noDoor, { participants: 20 });
    expect(r.notes.some((n) => n.includes("沒有門物件"))).toBe(true);

    const withDoor = generateLayoutSchemes(bigRoom(), { participants: 20 });
    expect(withDoor.notes.some((n) => n.includes("沒有門物件"))).toBe(false);
  });

  it("recommends the highest-scoring scheme and says why", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 4 });
    const best = r.schemes.reduce((a, b) => (b.score.total > a.score.total ? b : a));
    expect(r.recommendedId).toBe(best.id);
    expect(r.recommendation).toContain(best.name);
    expect(r.recommendation).toMatch(/可坐 \d+ 人/);
  });

  it("returns nothing rather than a fake plan when the room has no usable area", () => {
    const tiny = createDefaultProject();
    tiny.classroom = { ...tiny.classroom, length: 0.2, width: 0.2 };
    const r = generateLayoutSchemes(tiny, { participants: 60 });
    expect(r.schemes).toEqual([]);
    expect(r.recommendedId).toBeNull();
  });
});

describe("scheme measurement is honest", () => {
  it("measures with the same validator the manual editor uses", () => {
    const base = bigRoom();
    const r = generateLayoutSchemes(base, { participants: 40, staffCount: 4 });
    for (const s of r.schemes) {
      // Rebuild the project the scheme describes and re-validate independently.
      const rebuilt = projectWithScheme(base, {
        objects: s.objects, zones: s.zones, routes: s.routes, groups: s.groups,
        rationale: [], risks: [], knowledgeRefs: [], serviceBand: 0, serviceModel: "split",
      });
      const counts = issueCounts(validateProject(rebuilt));
      expect(counts.error).toBe(s.validation.errors);
      expect(counts.warning).toBe(s.validation.warnings);
    }
  });

  it("reports a capacity shortfall as a risk instead of rounding it away", () => {
    const small = createDefaultProject();
    small.classroom = { ...small.classroom, length: 6, width: 5 };
    const r = generateLayoutSchemes(small, { participants: 200, staffCount: 4 });
    for (const s of r.schemes) {
      expect(s.estimatedCapacity).toBeLessThan(200);
      expect(s.risks.some((x) => x.includes("少於 200 人"))).toBe(true);
    }
  });

  it("the shared desk and the split desks do not simulate identically", () => {
    // This is the whole point of comparing schemes. Modelling A as "two desks
    // that happen to be adjacent" made A and B report the same wait, and the
    // comparison then told the user nothing.
    const r = generateLayoutSchemes(bigRoom(), { participants: 80, staffCount: 4 });
    const a = r.schemes.find((s) => s.id === "scheme-a")!;
    const b = r.schemes.find((s) => s.id === "scheme-b")!;
    expect(a.simulation!.avgWaitSeconds).not.toBeCloseTo(b.simulation!.avgWaitSeconds, 1);
  });

  it("staffs by offered load, so B is not penalised by a bad roster", () => {
    // Only a third of participants pay on site. An even 2/2 split idles the
    // payment desk while the check-in queue grows; the planner must not let a
    // rostering choice decide which layout wins.
    const r = generateLayoutSchemes(bigRoom(), { participants: 80, staffCount: 4 });
    const b = r.schemes.find((s) => s.id === "scheme-b")!;
    const checkin = b.stations.find((s) => s.type === "checkin")!;
    const payment = b.stations.find((s) => s.type === "payment")!;
    expect(checkin.parallelServers).toBeGreaterThan(payment.parallelServers);
    expect(checkin.parallelServers + payment.parallelServers).toBe(4);
  });

  it("never leaves a station on a branch with zero servers", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 1 });
    for (const s of r.schemes) {
      for (const st of s.stations) {
        if (st.type === "checkin") expect(st.parallelServers).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("the queue and staff areas the scheme already reserves", () => {
  it("every scheme draws them, so the plan shows where the line forms", () => {
    // The geometry always accounted for a service band; nobody setting up the
    // room could see it. A construction plan that does not show where people
    // queue is a plan the volunteers have to guess at.
    const r = generateLayoutSchemes(bigRoom(), { participants: 40, staffCount: 4 });
    for (const s of r.schemes) {
      const names = s.zones.map((z) => z.name);
      expect(names.some((n) => n.includes("排隊")), s.id).toBe(true);
      expect(names, s.id).toContain("工作人員站位");
    }
  });

  it("names the queue after the desk it belongs to", () => {
    const r = generateLayoutSchemes(bigRoom(), {
      participants: 40, staffCount: 4, objectives: ["separate-checkin-payment"],
    });
    const split = r.schemes.find((s) => s.id === "scheme-b")!;
    const names = split.zones.map((z) => z.name);
    expect(names).toContain("報到排隊區");
    expect(names).toContain("收費排隊區");
  });

  it("puts the queue on the side people arrive from", () => {
    // Entering from the south wall, the queue has to form south of the desk —
    // putting it behind means the line runs through the staff.
    const r = generateLayoutSchemes(bigRoom(), { participants: 40, staffCount: 4 });
    const a = r.schemes.find((s) => s.id === "scheme-a")!;
    const desk = a.objects.find((o) => o.serviceRole === "checkin")!;
    const queue = a.zones.find((z) => z.name.includes("排隊"))!;
    const staff = a.zones.find((z) => z.name === "工作人員站位")!;
    expect(queue.z).toBeGreaterThan(desk.z);
    expect(staff.z).toBeLessThan(desk.z);
  });

  it("adds them without creating validation problems", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 40, staffCount: 4 });
    for (const s of r.schemes) {
      expect(s.validation.errors, s.id).toBe(0);
    }
  });

  it("keeps them inside the room", () => {
    const room = bigRoom();
    const b = areaBounds(room.classroom);
    const r = generateLayoutSchemes(room, { participants: 40, staffCount: 4 });
    for (const s of r.schemes) {
      for (const z of s.zones) {
        expect(z.z - z.depth / 2, `${s.id} ${z.name}`).toBeGreaterThanOrEqual(b.minZ - 1e-6);
        expect(z.z + z.depth / 2, `${s.id} ${z.name}`).toBeLessThanOrEqual(b.maxZ + 1e-6);
      }
    }
  });

  it("uses type custom so an older build still reads them", () => {
    // Adding a ZoneType member would be a data-format change; the booth zones
    // set the precedent of riding on `custom` with a descriptive name.
    const r = generateLayoutSchemes(bigRoom(), { participants: 40, staffCount: 4 });
    for (const z of r.schemes[0].zones.filter((x) => x.name.includes("排隊") || x.name === "工作人員站位")) {
      expect(z.type).toBe("custom");
    }
  });
});

describe("furniture the brief asked for by name", () => {
  const brief = (over: Record<string, unknown> = {}) => ({
    participants: 40, staffCount: 4,
    requiredAssets: [
      { assetId: "builtin:table", count: 3 },
      { assetId: "builtin:screen", count: 2 },
    ],
    ...over,
  });

  it("places every requested piece in every scheme", () => {
    const r = generateLayoutSchemes(bigRoom(), brief());
    for (const s of r.schemes) {
      expect(s.objects.filter((o) => o.assetId === "builtin:table").length, s.id).toBe(3);
      expect(s.objects.filter((o) => o.assetId === "builtin:screen").length, s.id).toBe(2);
    }
  });

  it("does not put them on top of the seats or the desks", () => {
    const r = generateLayoutSchemes(bigRoom(), brief());
    for (const s of r.schemes) {
      // The scheme's own validation is the arbiter: an overlap would raise one.
      const overlaps = s.validation.issues.filter((i) => i.code === "overlap" || i.code === "mat-overlap");
      expect(overlaps, `${s.id}: ${overlaps.map((o) => o.message).join("; ")}`).toEqual([]);
    }
  });

  it("mounts a wall asset on a wall, not in the middle of the floor", () => {
    // A screen dropped on the floor lattice failed the product's own wall-off
    // check — the planner must not hand the user a layout its validator rejects.
    const r = generateLayoutSchemes(bigRoom(), brief());
    for (const s of r.schemes) {
      expect(s.validation.issues.filter((i) => i.code === "wall-off"), s.id).toEqual([]);
      for (const screen of s.objects.filter((o) => o.assetId === "builtin:screen")) {
        expect(screen.surface).toBe("wall");
        expect(screen.elevation).toBeGreaterThan(0);
      }
    }
  });

  it("reports what it could not fit instead of dropping it", () => {
    const small = createDefaultProject();
    small.classroom = { ...small.classroom, length: 4, width: 3 };
    const r = generateLayoutSchemes(small, {
      participants: 10,
      requiredAssets: [{ assetId: "builtin:table", count: 20 }],
    });
    for (const s of r.schemes) {
      expect(s.risks.join(" "), s.id).toMatch(/只排得下/);
    }
  });

  it("reports an asset id it cannot resolve", () => {
    const r = generateLayoutSchemes(bigRoom(), {
      participants: 20,
      requiredAssets: [{ assetId: "builtin:teleporter", count: 1 }],
    });
    expect(r.schemes[0].risks.join(" ")).toContain("找不到素材");
  });

  it("puts a zone-tagged asset nearer that zone than the room centre", () => {
    const r = generateLayoutSchemes(bigRoom(), {
      participants: 40, staffCount: 4,
      requiredZones: ["registration", "payment", "meditation"],
      requiredAssets: [{ assetId: "builtin:table", count: 1, zone: "registration" }],
    });
    const scheme = r.schemes.find((s) => s.id === "scheme-b")!;
    const zone = scheme.zones.find((z) => z.type === "registration")!;
    const table = scheme.objects.find((o) => o.assetId === "builtin:table")!;
    const toZone = Math.hypot(table.x - zone.x, table.z - zone.z);
    const centre = { x: (r.brief.usable.minX + r.brief.usable.maxX) / 2, z: (r.brief.usable.minZ + r.brief.usable.maxZ) / 2 };
    const toCentre = Math.hypot(table.x - centre.x, table.z - centre.z);
    expect(toZone).toBeLessThanOrEqual(toCentre);
  });

  it("changes nothing when the brief names no extra furniture", () => {
    const without = generateLayoutSchemes(bigRoom(), { participants: 40, staffCount: 4 });
    for (const s of without.schemes) {
      expect(s.objects.filter((o) => o.assetId === "builtin:table")).toEqual([]);
    }
  });
});

describe("an explicit requirement is a constraint, not a weight", () => {
  it("a combined-desk scheme is ineligible when 分流 was asked for", () => {
    const r = generateLayoutSchemes(bigRoom(), {
      participants: 60, staffCount: 4, objectives: ["separate-checkin-payment"],
    });
    const a = r.schemes.find((s) => s.id === "scheme-a")!;
    expect(a.eligible).toBe(false);
    expect(a.ineligibleReason).toContain("分流");
    // It is still shown — the user asked for three options — and the reason is
    // on its risk list, not hidden.
    expect(a.risks.join(" ")).toContain("分流");
  });

  it("never recommends a scheme that breaks a stated requirement, even if it scores highest", () => {
    // This is the case that made the tool contradict itself: A outscored B and
    // C, so the engine recommended a shared desk to someone who had just said
    // 「收費另外分流」 in words.
    const r = generateLayoutSchemes(bigRoom(), {
      participants: 60, staffCount: 4, objectives: ["separate-checkin-payment"],
    });
    const a = r.schemes.find((s) => s.id === "scheme-a")!;
    const recommended = r.schemes.find((s) => s.id === r.recommendedId)!;
    expect(recommended.eligible).toBe(true);
    expect(a.score.total).toBeGreaterThan(0);
    expect(r.recommendedId).not.toBe("scheme-a");
  });

  it("the applied layout really has two service desks", () => {
    const built = buildScheme(bigRoom(), RECOMMENDED_SCHEME, {
      participants: 60, staffCount: 4, objectives: ["separate-checkin-payment"],
    })!;
    expect(built.scheme.objects.filter((o) => o.serviceRole === "checkin").length).toBe(1);
    expect(built.scheme.objects.filter((o) => o.serviceRole === "payment").length).toBe(1);
  });

  it("every scheme stays eligible when nothing structural was asked for", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 4 });
    expect(r.schemes.every((s) => s.eligible)).toBe(true);
  });

  it("the comparison table carries eligibility so the UI can show it", () => {
    const rows = compareSchemes(generateLayoutSchemes(bigRoom(), {
      participants: 60, staffCount: 4, objectives: ["separate-checkin-payment"],
    }));
    const a = rows.find((x) => x.id === "scheme-a")!;
    expect(a.eligible).toBe(false);
    expect(a.ineligibleReason).toBeTruthy();
  });
});

describe("scoring", () => {
  it("weights follow the stated objectives", () => {
    const room = bigRoom();
    const capacity = generateLayoutSchemes(room, { participants: 60, staffCount: 4, objectives: ["maximise-capacity"] });
    const crowding = generateLayoutSchemes(room, { participants: 60, staffCount: 4, objectives: ["reduce-crowding"] });
    const capWeights = capacity.schemes[0].score.weights;
    const crowdWeights = crowding.schemes[0].score.weights;
    expect(capWeights.capacity).toBeGreaterThan(crowdWeights.capacity);
    expect(crowdWeights.waiting).toBeGreaterThan(capWeights.waiting);
  });

  it("weights always sum to one, so a score is comparable across briefs", () => {
    for (const objectives of [
      [], ["clear-doors"], ["reduce-crowding", "easy-to-staff"],
      ["maximise-capacity", "increase-interaction", "separate-checkin-payment"],
    ] as const) {
      const r = generateLayoutSchemes(bigRoom(), { participants: 40, objectives: [...objectives] });
      const w = r.schemes[0].score.weights;
      const sum = w.capacity + w.waiting + w.validation + w.circulation + w.staffing;
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("every score component stays inside 0..1 and the total inside 0..100", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 120, staffCount: 1 });
    for (const s of r.schemes) {
      for (const [k, v] of Object.entries(s.score.breakdown)) {
        expect(v, `${s.id}.${k}`).toBeGreaterThanOrEqual(0);
        expect(v, `${s.id}.${k}`).toBeLessThanOrEqual(1);
      }
      expect(s.score.total).toBeGreaterThanOrEqual(0);
      expect(s.score.total).toBeLessThanOrEqual(100);
    }
  });

  it("lets 「好管理」 actually pick the simpler scheme", () => {
    // Both A (one desk) and B (two desks) are staffable with four people, so a
    // pure staff/desk ratio saturated at 1.0 for both and the objective could
    // not discriminate. Operational simplicity is the second half of "easy to
    // staff", and without it the engine recommended a two-desk layout to
    // someone who asked for fewer moving parts.
    const room = bigRoom();
    const easy = generateLayoutSchemes(room, {
      participants: 60, staffCount: 4, objectives: ["easy-to-staff"],
    });
    expect(easy.recommendedId).toBe("scheme-a");
    const a = easy.schemes.find((s) => s.id === "scheme-a")!;
    const b = easy.schemes.find((s) => s.id === "scheme-b")!;
    expect(a.score.breakdown.staffing).toBeGreaterThan(b.score.breakdown.staffing);
  });

  it("penalises a scheme that needs more desks than there are staff", () => {
    const plenty = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 6 });
    const scarce = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 1 });
    const bPlenty = plenty.schemes.find((s) => s.id === "scheme-b")!;
    const bScarce = scarce.schemes.find((s) => s.id === "scheme-b")!;
    expect(bScarce.score.breakdown.staffing).toBeLessThan(bPlenty.score.breakdown.staffing);
  });
});

describe("applying a scheme", () => {
  it("buildScheme applies exactly what it described", () => {
    const base = bigRoom();
    const built = buildScheme(base, "scheme-b", { participants: 40, staffCount: 4 })!;
    const draft = structuredClone(base);
    built.apply(draft);
    expect(draft.objects.filter((o) => o.serviceRole === "checkin").length).toBe(1);
    expect(draft.objects.filter((o) => o.serviceRole === "payment").length).toBe(1);
    expect(draft.groups.length).toBe(built.scheme.groups.length);
    expect(draft.zones.length).toBe(built.scheme.zones.length);
  });

  it("keeps doors, wall fittings and locked items", () => {
    const base = bigRoom();
    base.objects.push(obj({ id: "locked1", kind: "table", x: 2, z: 2, locked: true }));
    base.objects.push(obj({
      id: "sw1", kind: "switch", x: 0.1, z: 5, width: 0.1, depth: 0.1, height: 0.1,
      surface: "wall", assetId: "builtin:switch",
    }));
    const built = buildScheme(base, "scheme-a", { participants: 30 })!;
    const draft = structuredClone(base);
    built.apply(draft);
    expect(draft.objects.some((o) => o.id === "door1")).toBe(true);
    expect(draft.objects.some((o) => o.id === "sw1")).toBe(true);
    expect(draft.objects.some((o) => o.id === "locked1")).toBe(true);
  });

  it("returns null for an unknown scheme id", () => {
    expect(buildScheme(bigRoom(), "scheme-z")).toBeNull();
  });

  it("RECOMMENDED_SCHEME resolves to the same scheme the engine recommends", () => {
    // One decision, one place. The planner used to choose with its own
    // objective→scheme table while the engine recommended by measured score,
    // so the user could read 「推薦 C（92.9 分）」 and be handed B.
    const room = bigRoom();
    for (const objectives of [
      ["separate-checkin-payment"], ["reduce-crowding"], ["easy-to-staff"], ["maximise-capacity"], [],
    ] as const) {
      const brief = { participants: 60, staffCount: 4, objectives: [...objectives] };
      const result = generateLayoutSchemes(room, brief);
      const built = buildScheme(room, RECOMMENDED_SCHEME, brief)!;
      expect(built.scheme.id, `目標 ${objectives.join("/") || "（無）"} 下推薦與套用不一致`)
        .toBe(result.recommendedId);
    }
  });
});

describe("comparison", () => {
  it("puts every scheme on the same row shape", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 60, staffCount: 4 });
    const rows = compareSchemes(r);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.id).toBeTruthy();
      expect(row.capacity).toBeGreaterThanOrEqual(0);
      expect(row.avgWaitSeconds).not.toBeNull();
      expect(row.maxWaitSeconds).not.toBeNull();
      expect(row.score).toBeGreaterThan(0);
    }
  });

  it("is deterministic for the same brief", () => {
    const room = bigRoom();
    const a = compareSchemes(generateLayoutSchemes(room, { participants: 60, staffCount: 4 }));
    const b = compareSchemes(generateLayoutSchemes(room, { participants: 60, staffCount: 4 }));
    expect(a).toEqual(b);
  });
});

describe("brief inputs actually change the plan", () => {
  it("a larger door clearance pushes the service band further in", () => {
    const room = bigRoom();
    const near = buildScheme(room, "scheme-a", { participants: 40, doorClearance: 0.6 })!;
    const far = buildScheme(room, "scheme-a", { participants: 40, doorClearance: 2.0 })!;
    // The entrance is on the south wall, so a bigger clearance means a smaller z.
    expect(far.scheme.objects[0].z).toBeLessThan(near.scheme.objects[0].z);
  });

  it("a wider minimum aisle costs seats once the room is the binding constraint", () => {
    // With a headcount the room can absorb, capacity is demand-limited and the
    // aisle changes nothing — the planner lays out seats for the people asked
    // for, not the maximum the floor could hold. Saturate the room first, and
    // the aisle then comes straight off the seat count.
    const room = bigRoom();
    const tight = generateLayoutSchemes(room, { participants: 400, minAisleWidth: 0.9 });
    const wide = generateLayoutSchemes(room, { participants: 400, minAisleWidth: 3.0 });
    const tightA = tight.schemes.find((s) => s.id === "scheme-a")!;
    const wideA = wide.schemes.find((s) => s.id === "scheme-a")!;
    expect(wideA.estimatedCapacity).toBeLessThan(tightA.estimatedCapacity);
  });

  it("does not lay out more seats than the headcount asked for", () => {
    const r = generateLayoutSchemes(bigRoom(), { participants: 30, staffCount: 4 });
    for (const s of r.schemes) {
      // A little slack is inherent to a rectangular field; an order of
      // magnitude is not.
      expect(s.estimatedCapacity).toBeLessThan(30 * 3);
    }
  });

  it("a classroom event seats chairs, a meditation event seats mats", () => {
    const room = bigRoom();
    const classroom = buildScheme(room, "scheme-a", { participants: 30, eventType: "classroom" })!;
    const meditation = buildScheme(room, "scheme-a", { participants: 30, eventType: "meditation" })!;
    expect(classroom.scheme.groups[0].sourceKind).toBe("chair");
    expect(meditation.scheme.groups[0].sourceKind).toBe("mat");
  });

  it("requested zones appear in the plan", () => {
    const built = buildScheme(bigRoom(), "scheme-c", {
      participants: 40,
      requiredZones: ["registration", "payment", "shoe", "backpack", "meditation"],
    })!;
    const types = built.scheme.zones.map((z) => z.type);
    for (const t of ["registration", "payment", "shoe", "backpack", "meditation"]) {
      expect(types, `缺少 ${t} 區`).toContain(t);
    }
  });
});
