import type { Project } from "./model";
import { wallAnchorToPosition } from "./placement";

export type CalibrationPath = "record" | "tile" | "door" | "classroom-length";

/** Apply one of the three plain-language field calibration paths in place. */
export function applyCalibrationPath(project: Project, path: CalibrationPath, actualMeters: number, measuredModelMeters?: number, note = ""): void {
  if (!Number.isFinite(actualMeters) || actualMeters <= 0) return;
  if (path === "tile") {
    project.tile.width = actualMeters;
    project.tile.depth = actualMeters;
    project.calibration.referenceLength = actualMeters;
    project.calibration.confirmed.tile = true;
    return;
  }
  if (path === "door") {
    const door = project.objects.find((o) => o.kind === "door" && !o.hidden);
    if (!door) return;
    door.width = actualMeters;
    if (door.wallAnchor) {
      const wallLen = door.wallAnchor.edge === "n" || door.wallAnchor.edge === "s"
        ? project.classroom.length : project.classroom.width;
      door.wallAnchor.offset = Math.min(Math.max(door.wallAnchor.offset, actualMeters / 2), wallLen - actualMeters / 2);
    }
    project.calibration.confirmed.door = true;
    return;
  }
  project.calibration.referenceLength = actualMeters;
  // An empty note must not overwrite one. The booth preset ships its estimate
  // marker in this field, and 記錄結果 — the button whose own hint says the
  // other two 「會改動既有場佈比例」, so it reads as the safe one — used to blank
  // it. That silently cleared the 待校正 badge, dropped the 分享前 checklist
  // line and exported the 場刊圖 with no 尺寸待現場校正 footer, presenting
  // 7×7 攤位範圍 and a 3×3 tent as if somebody had measured them.
  if (note.trim()) project.calibration.note = note;
  if (path === "classroom-length") {
    // Only proportional scaling against a real on-canvas measurement is safe.
    // Absolute assignment turned 「120 cm」 into a 1.2 m-long classroom.
    if (!measuredModelMeters || measuredModelMeters <= 0) return;
    const oldClassroomEnd = project.classroom.z + project.classroom.width;
    const ratio = actualMeters / measuredModelMeters;
    project.classroom.length *= ratio;
    project.classroom.width *= ratio;
    // The corridor runs along the room, so it has to grow with it — otherwise
    // a 12 m walkway is drawn against a 13.2 m room and the plan shows the
    // room overhanging the corridor that serves it.
    //
    // LENGTH only. `corridor.width` is recorded as unknown in the evidence
    // mapping, and scaling it would both invent a measurement and move the
    // 「排隊會排到走道上」 verdict (simSpatial derives the queue lane count from
    // it). An unmeasured width stays unmeasured.
    project.corridor.length *= ratio;
    if (Math.abs(project.corridor.z - oldClassroomEnd) < 1e-6) {
      project.corridor.z = project.classroom.z + project.classroom.width;
    }
    const areas = [project.classroom, project.corridor];
    for (const object of project.objects) {
      if (!object.wallAnchor) continue;
      const area = areas.find((a) => a.id === object.wallAnchor!.areaId);
      if (!area) continue;
      const wallLength = object.wallAnchor.edge === "n" || object.wallAnchor.edge === "s" ? area.length : area.width;
      const half = Math.min(object.width / 2, wallLength / 2);
      object.wallAnchor.offset = Math.min(Math.max(object.wallAnchor.offset, half), wallLength - half);
      const pos = wallAnchorToPosition(object.wallAnchor, areas);
      if (pos) { object.x = pos.x; object.z = pos.z; object.rotationDeg = pos.rotationDeg; }
    }
    // Only an APPLIED room measurement confirms the third calibration item —
    // merely recording a measurement must not clear the badge.
    project.calibration.confirmed.room = true;
  }
}
