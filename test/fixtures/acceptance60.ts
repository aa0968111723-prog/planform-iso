/**
 * Shared acceptance fixture: 60 people, 40 prepaid / 20 onsite, 20 min arrival.
 */

import { createDefaultScenario } from "../../src/core/migrate";
import {
  createDefaultProject,
  type EventScenario,
  type Project,
  type SceneObject,
  uid,
} from "../../src/core/model";

export function acceptance60Project(): Project {
  const p = createDefaultProject();
  p.name = "驗收：60人進場";
  p.description = "報到／收費／鞋子／背包／入座";

  // Door at corridor
  const door: SceneObject = {
    id: uid("obj"),
    kind: "door",
    x: p.corridor.x + p.corridor.length / 2,
    z: p.corridor.z + p.corridor.width / 2,
    rotationDeg: 0,
    width: 0.9,
    depth: 0.12,
    height: 2.1,
    locked: false,
    hidden: false,
    surface: "wall",
    elevation: 0,
  };
  const checkinDesk: SceneObject = {
    id: uid("obj"),
    kind: "regTable",
    x: 2.5,
    z: 6.5,
    rotationDeg: 180,
    width: 1.5,
    depth: 0.7,
    height: 0.74,
    locked: false,
    hidden: false,
    surface: "floor",
    elevation: 0,
    serviceRole: "checkin",
    assetId: "builtin:regTable",
  };
  const paymentDesk: SceneObject = {
    id: uid("obj"),
    kind: "regTable",
    x: 5.0,
    z: 6.5,
    rotationDeg: 180,
    width: 1.5,
    depth: 0.7,
    height: 0.74,
    locked: false,
    hidden: false,
    surface: "floor",
    elevation: 0,
    serviceRole: "payment",
    assetId: "builtin:payment-desk",
  };
  p.objects = [door, checkinDesk, paymentDesk];
  p.zones = [
    {
      id: uid("zn"),
      type: "registration",
      name: "報到區",
      x: 1.5,
      z: 5.5,
      width: 2.5,
      depth: 1.5,
      color: "#38bdf8",
      locked: false,
      hidden: false,
      icon: "👋",
      capacity: 10,
    },
    {
      id: uid("zn"),
      type: "shoe",
      name: "鞋子區",
      x: 1,
      z: 1,
      width: 2,
      depth: 1,
      color: "#fbbf24",
      locked: false,
      hidden: false,
      icon: "👟",
      capacity: 30,
    },
    {
      id: uid("zn"),
      type: "backpack",
      name: "背包區",
      x: 3.5,
      z: 1,
      width: 2,
      depth: 1,
      color: "#fb923c",
      locked: false,
      hidden: false,
      icon: "🎒",
      capacity: 30,
    },
    {
      id: uid("zn"),
      type: "group",
      name: "入座區",
      x: 5,
      z: 2.5,
      width: 4,
      depth: 4,
      color: "#a78bfa",
      locked: false,
      hidden: false,
      icon: "👥",
      capacity: 60,
    },
  ];
  p.routes = [
    {
      id: uid("rt"),
      name: "入場",
      color: "#f97316",
      type: "entry",
      visible: true,
      points: [
        { x: door.x, z: door.z },
        { x: checkinDesk.x, z: checkinDesk.z },
        { x: 2, z: 1.5 },
        { x: 4.5, z: 1.5 },
        { x: 7, z: 4.5 },
      ],
    },
  ];
  return p;
}

export function acceptance60Scenario(project?: Project): EventScenario {
  const p = project ?? acceptance60Project();
  let scn = createDefaultScenario(p, {
    name: "60人報到收費",
    participantCount: 60,
    seed: 42,
  });
  scn = {
    ...scn,
    arrivalWindowSeconds: 20 * 60,
    arrivalProfile: "uniform",
    profiles: [
      {
        id: "prepaid",
        ratio: 40 / 60,
        branch: scn.profiles.find((pr) => pr.id === "prepaid")?.branch ?? [],
      },
      {
        id: "pay-on-site",
        ratio: 20 / 60,
        branch: scn.profiles.find((pr) => pr.id === "pay-on-site")?.branch ?? [],
      },
    ],
    stations: scn.stations.map((st) => {
      if (st.type === "checkin") {
        return { ...st, staffCount: 2, parallelServers: 2, queueDirectionDeg: 0 };
      }
      if (st.type === "payment") {
        return { ...st, staffCount: 1, parallelServers: 1, queueDirectionDeg: 0 };
      }
      return st;
    }),
  };
  return scn;
}
