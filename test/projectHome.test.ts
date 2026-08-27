import { describe, expect, it } from "vitest";
import { cardSubtitle } from "../src/ui/projectHome";
import type { ProjectMeta } from "../src/state/projectRepository";

function meta(partial: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id: "prj_test",
    name: "社課",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("cardSubtitle", () => {
  it("shows venue, head count, and event date when they exist", () => {
    expect(cardSubtitle(meta({
      venueName: "E310",
      participants: 60,
      eventDate: "2026-09-24",
    }))).toBe("E310 · 60 人 · 2026-09-24");
  });

  it("falls back when the card has no venue yet", () => {
    expect(cardSubtitle(meta())).toBe("尚未設定場地");
  });
});
