/**
 * Keeping zone labels off each other.
 *
 * Pure geometry, deliberately in its own module: it has no three.js in it, so
 * it can be tested in node — and the rule needs testing, because the version
 * that lived inline was wrong in a way nobody could see from the code.
 *
 * It compared the ZONE rectangles and stepped by 0.55 m. But the thing that
 * collides on screen is the LABEL, which is a fixed-size sprite whatever the
 * zone measures: a 0.7 m shoe strip beside a 2 m backpack zone counted as one
 * overlap and got one step, and 0.55 m is less than the sprite is tall at the
 * default isometric camera. The result on the shipped E310 example was that
 * 「鞋子｜右側」 sat almost entirely behind 「背包｜課桌椅」.
 *
 * That is not a cosmetic loss. Given that render with no other context, a
 * reader reported the plan as putting shoes on one side only — the exact
 * arrangement the field research corrected — because the second shoe zone was
 * not visible. A hidden label does not just look untidy; it makes a correct
 * plan read as a wrong one.
 */

/** The label sprite's world size. Fixed, regardless of the zone beneath it. */
export const LABEL_SIZE = { width: 1.6, height: 0.4 } as const;

export interface PlacedLabel {
  x: number;
  z: number;
  y: number;
}

/**
 * The height to draw this label at, given the ones already placed.
 *
 * Steps up until the sprite clears every label whose pill could overlap it on
 * screen. Both ground axes are compared against the label's WIDTH because an
 * isometric camera maps x and z onto the same screen plane.
 */
export function stackedLabelY(
  at: { x: number; z: number },
  placed: readonly PlacedLabel[],
  baseY: number,
): number {
  const step = LABEL_SIZE.height * 1.9;
  const clearance = LABEL_SIZE.height * 1.6;
  let y = baseY;
  let guard = 0;
  while (
    guard++ < 32
    && placed.some((other) =>
      Math.abs(at.x - other.x) < LABEL_SIZE.width
      && Math.abs(at.z - other.z) < LABEL_SIZE.width
      && Math.abs(y - other.y) < clearance)
  ) {
    y += step;
  }
  return y;
}
