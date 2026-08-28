/**
 * A station bound to a thing in the plan must stay bound after a save.
 *
 * `migrateInteractionStation` used to whitelist away `objectId` and `zoneId`,
 * so converting the E310 scenario to a step list, saving, and reloading froze
 * every station at the coordinates it was saved at: the plan showed the
 * check-in desk in its new place while the simulation kept queueing people at
 * the old one — silently, forever. `resolveTemplateBindings` re-reading these
 * before every run is the entire mechanism by which "move the desk" changes
 * the answer, and one round trip severed it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { migrateProject, resolveTemplateBindings } from "../src/core/migrate";
import { templateFromScenario } from "../src/core/interactionCompile";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import type { Project } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
beforeEach(() => installLocalStorage());
installLocalStorage();

const roundTrip = (p: Project): Project =>
  migrateProject(JSON.parse(JSON.stringify(p)) as Partial<Project>);

/** The golden project after 「改成我自己的流程」, exactly as the button does it. */
function convertedGolden(): Project {
  const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
  return { ...project, interaction: templateFromScenario(project.scenarios[0]) };
}

describe("station bindings survive a save", () => {
  it("the converted E310 flow still carries its objectId/zoneId bindings", () => {
    const before = convertedGolden();
    const bound = before.interaction!.stations.filter((s) => s.objectId || s.zoneId);
    expect(bound.length, "the golden scenario binds stations to real things").toBeGreaterThan(0);

    const after = roundTrip(before);
    for (const station of bound) {
      const survived = after.interaction!.stations.find((s) => s.id === station.id)!;
      expect(survived.objectId, `${station.name} lost its object binding`).toBe(station.objectId);
      expect(survived.zoneId, `${station.name} lost its zone binding`).toBe(station.zoneId);
    }
  });

  it("so moving the desk still moves the station after a reload", () => {
    const project = roundTrip(convertedGolden());
    const station = project.interaction!.stations.find((s) => s.objectId)!;
    const object = project.objects.find((o) => o.id === station.objectId)!;

    object.x += 2.5;
    const resolved = resolveTemplateBindings(project, project.interaction!);
    const tracked = resolved.stations.find((s) => s.id === station.id)!;
    // Before the fix this stayed at the saved coordinate: the binding was
    // stripped, so the resolver had nothing to follow.
    expect(tracked.x).toBeCloseTo(object.x, 6);
  });

  it("serviceVariance survives too — reload must not change the spread", () => {
    const before = convertedGolden();
    before.interaction!.stations[0].serviceVariance = 12.34;
    const after = roundTrip(before);
    expect(Object.is(after.interaction!.stations[0].serviceVariance, 12.34)).toBe(true);
  });

  it("a binding to a thing that no longer exists is still not invented", () => {
    const before = convertedGolden();
    before.interaction!.stations[0].objectId = undefined;
    const after = roundTrip(before);
    expect("objectId" in after.interaction!.stations[0]).toBe(false);
  });
});
