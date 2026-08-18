/**
 * Uniform-grid spatial hash for broad-phase collision. Instead of O(n²) pair
 * checks across every object, items are bucketed by their footprint AABB and
 * only near neighbours become candidate pairs. Keeps 100+ mats/chairs cheap.
 */

import { footprintBounds, type Rect } from "./placement";

export interface HashItem extends Rect {
  id: string;
}

export class SpatialHash {
  private cell: number;
  private buckets = new Map<string, number[]>(); // cellKey -> item indices
  private items: HashItem[] = [];

  constructor(cellSize = 1) {
    this.cell = Math.max(0.25, cellSize);
  }

  private key(cx: number, cz: number): string {
    return `${cx}|${cz}`;
  }

  insert(item: HashItem): void {
    const idx = this.items.length;
    this.items.push(item);
    const b = footprintBounds(item);
    const x0 = Math.floor(b.minX / this.cell);
    const x1 = Math.floor(b.maxX / this.cell);
    const z0 = Math.floor(b.minZ / this.cell);
    const z1 = Math.floor(b.maxZ / this.cell);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this.key(x, z);
        const arr = this.buckets.get(k);
        if (arr) arr.push(idx);
        else this.buckets.set(k, [idx]);
      }
    }
  }

  /** Unique candidate index pairs whose footprint cells overlap. */
  candidatePairs(): [number, number][] {
    const seen = new Set<number>();
    const pairs: [number, number][] = [];
    for (const arr of this.buckets.values()) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          const lo = Math.min(a, b), hi = Math.max(a, b);
          const key = lo * this.items.length + hi;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push([lo, hi]);
        }
      }
    }
    return pairs;
  }

  /** Candidate item indices near a query rectangle (its footprint cells). */
  queryRect(r: Rect): number[] {
    const b = footprintBounds(r);
    const x0 = Math.floor(b.minX / this.cell);
    const x1 = Math.floor(b.maxX / this.cell);
    const z0 = Math.floor(b.minZ / this.cell);
    const z1 = Math.floor(b.maxZ / this.cell);
    const out = new Set<number>();
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const arr = this.buckets.get(this.key(x, z));
        if (arr) for (const i of arr) out.add(i);
      }
    }
    return [...out];
  }

  getItem(i: number): HashItem {
    return this.items[i];
  }

  get size(): number {
    return this.items.length;
  }
}
