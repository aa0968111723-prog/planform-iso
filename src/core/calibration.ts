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
  project.calibration.note = note;
  if (path === "classroom-length") {
    // Only proportional scaling against a real on-canvas measurement is safe.
    // Absolute assignment turned 「120 cm」 into a 1.2 m-long classroom.
    if (!measuredModelMeters || measuredModelMeters <= 0) return;
    const oldClassroomEnd = project.classroom.z + project.classroom.width;
    const ratio = actualMeters / measuredModelMeters;
    project.classroom.length *= ratio;
    project.classroom.width *= ratio;
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
