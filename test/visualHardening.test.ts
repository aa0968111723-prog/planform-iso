import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boothVenuePreset, createProjectFromVenuePreset } from "../src/core/venues";
import { matBatchVariation, primaryWorkAreaBounds } from "../src/scene/SceneManager";

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("visual hardening mutations", () => {
  it("uses screen-space label declutter, rather than a permanent world-space stack", () => {
    const scene = source("src/scene/SceneManager.ts");
    expect(scene).toContain("applyLabelDeclutter(project, session)");
    expect(scene).toContain("declutterScreenLabels(screenCandidates, maxVisible)");
    expect(scene).toContain("world.clone().project(this.camera)");
    expect(scene).not.toContain("stackedLabelY(zone");
    expect(source("src/app/App.ts")).toContain("showLabels: true");
  });

  it("has no permanent central calibration banner", () => {
    const ui = source("src/ui/UI.ts");
    const css = source("src/style.css");
    expect(ui).toContain('button("", () => this.openCalibrationSheet(), "status-badge")');
    expect(ui).not.toContain("calibrationBanner");
    expect(css).not.toContain(".calibration-banner");
  });

  it("keeps exported plans clean when a label has no clear place", () => {
    const exporter = source("src/export/constructionPlan.ts");
    expect(exporter).toContain("function placeLabel(x: number, y: number, w: number, h: number, step: number): { x: number; y: number } | null");
    expect(exporter).toContain("if (!spot) continue;");
    expect(exporter).not.toContain("labelBoxes.push({ x: cx, y: cy, w, h });\n  return { x: cx, y: cy };");
  });

  it("fits a booth around work, not an oversized roof", () => {
    const project = createProjectFromVenuePreset(boothVenuePreset(), "雙棚測試");
    const roof = project.objects.find((object) => object.assetId === "custom:booth-tent")!;
    roof.width = 36;
    roof.depth = 30;
    roof.x = 18;
    roof.z = 16;
    const bounds = primaryWorkAreaBounds(project);
    expect(bounds.maxX - bounds.minX).toBeLessThan(12);
    expect(bounds.maxZ - bounds.minZ).toBeLessThan(12);
    expect(source("src/scene/SceneManager.ts")).toContain("this.fitBounds(primaryWorkAreaBounds(project))");
  });

  it("keeps foam variation sparse and irregular instead of a teal checkerboard", () => {
    const samples = Array.from({ length: 100 }, (_, i) => matBatchVariation(Math.floor(i / 10), i % 10));
    const varied = samples.filter((value) => value !== 0).length;
    expect(varied).toBeGreaterThan(0);
    expect(varied).toBeLessThan(20);
    expect(samples.slice(0, 9)).not.toEqual([0, 1, -1, 0, 1, -1, 0, 1, -1]);
  });
});
