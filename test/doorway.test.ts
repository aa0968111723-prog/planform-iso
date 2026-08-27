/**
 * WP_B_SIMULATION_SPEC §「agent 進教室必經門節點」/「playback：不穿牆」.
 *
 * Travel used to be a straight segment, or a snap onto the nearest *visible*
 * polyline — neither of which is a geometry constraint. On the release's own
 * default project (the 30-person club setup, whose routes ship hidden) all 30
 * participants walked through the solid back wall about two metres from the
 * only door, and no leg ever recorded a door — so the 門前 bottleneck could
 * never fire and the doorway was unfalsifiable.
 *
 * These tests measure the crossings rather than trusting the path builder.
 */

import { describe, expect, it } from "vitest";
import { buildE310ClubGoldenProject, buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import { buildSimulationSpatial, buildTravelPath, sharedWallZ } from "../src/core/simSpatial";
import type { Project, RoutePoint, SimulationSpatial } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

/** Every point at which a polyline crosses the shared wall. */
function wallCrossings(points: RoutePoint[], wallZ: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const da = a.z - wallZ, db = b.z - wallZ;
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      xs.push(a.x + (b.x - a.x) * (da / (da - db)));
    }
  }
  return xs;
}

function throughADoorway(x: number, spatial: SimulationSpatial, wallZ: number): boolean {
  return spatial.doors.some(
    (d) => Math.abs(d.z - wallZ) <= 0.6 && Math.abs(x - d.x) <= d.width / 2 + 0.1,
  );
}

function corridorToRoomLegs(project: Project): { spatial: SimulationSpatial; wallZ: number } {
  const spatial = buildSimulationSpatial(project);
  const wallZ = sharedWallZ(spatial.classroom, spatial.corridor);
  expect(wallZ, "E310 must have a wall between the room and the corridor").not.toBeNull();
  return { spatial, wallZ: wallZ! };
}

describe("crossing the classroom wall goes through a doorway", () => {
  installLocalStorage();
  const venue = venuePresetById("venue:tku-e310")!;

  for (const [label, build] of [
    ["30 人實景場佈（動線隱藏）", buildE310ClubGoldenProject],
    ["60 人壓力範例（動線可見）", buildE310GoldenProject],
  ] as const) {
    it(`${label}：走廊 → 教室不穿牆`, () => {
      const project = build(venue);
      const { spatial, wallZ } = corridorToRoomLegs(project);
      expect(spatial.doors.length).toBeGreaterThan(0);

      // Walk from a spread of corridor positions to a spread of room positions.
      const room = project.classroom;
      let crossings = 0;
      let throughDoor = 0;
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          const from = { x: room.x + (room.length * (i + 0.5)) / 6, z: wallZ + 0.9 };
          const to = { x: room.x + (room.length * (j + 0.5)) / 6, z: wallZ - 2.4 };
          const path = buildTravelPath(from, to, spatial, 1.2);
          for (const x of wallCrossings(path.points, wallZ)) {
            crossings += 1;
            if (throughADoorway(x, spatial, wallZ)) throughDoor += 1;
          }
        }
      }
      expect(crossings, "no leg crossed the wall at all — the fixture is wrong").toBeGreaterThan(0);
      expect(throughDoor, `${crossings - throughDoor} of ${crossings} legs walked through the wall`)
        .toBe(crossings);
    });

    it(`${label}：穿門的路徑會記錄到那扇門`, () => {
      const project = build(venue);
      const { spatial, wallZ } = corridorToRoomLegs(project);
      const room = project.classroom;
      const path = buildTravelPath(
        { x: room.x + room.length * 0.2, z: wallZ + 0.9 },
        { x: room.x + room.length * 0.5, z: wallZ - 2.4 },
        spatial,
        1.2,
      );
      // Without this, the 門前 bottleneck in eventFlow can never fire, because
      // it only looks at doors a path actually traversed.
      expect(path.doorIds.length, "the leg crossed the wall but recorded no door").toBeGreaterThan(0);
    });
  }

  it("同一側的移動不會被硬拉去繞門", () => {
    const project = buildE310ClubGoldenProject(venue);
    const { spatial, wallZ } = corridorToRoomLegs(project);
    const room = project.classroom;
    const from = { x: room.x + 1, z: wallZ - 4 };
    const to = { x: room.x + room.length - 1, z: wallZ - 3 };
    const path = buildTravelPath(from, to, spatial, 1.2);
    expect(wallCrossings(path.points, wallZ)).toHaveLength(0);
    // A detour would show up as a much longer walk than the straight line.
    expect(path.distance).toBeLessThan(Math.hypot(to.x - from.x, to.z - from.z) * 1.35);
  });

  it("沒有門的場地不會被這條規則卡住", () => {
    const project = buildE310ClubGoldenProject(venue);
    project.objects = project.objects.filter((o) => o.kind !== "door");
    const spatial = buildSimulationSpatial(project);
    const wallZ = sharedWallZ(spatial.classroom, spatial.corridor)!;
    const path = buildTravelPath(
      { x: 3, z: wallZ + 0.9 }, { x: 3, z: wallZ - 2 }, spatial, 1.2,
    );
    expect(path.points.length).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(path.seconds)).toBe(true);
  });
});
