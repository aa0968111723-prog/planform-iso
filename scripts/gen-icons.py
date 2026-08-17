#!/usr/bin/env python3
"""Generate PWA app icons (no third-party deps).

Draws a dark rounded background with a cyan isometric grid motif and writes
valid PNGs to public/icons/. Re-run after changing the design.
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")

BG = (15, 23, 42)       # slate-900
LINE = (56, 189, 248)   # sky-400
DOT = (226, 232, 240)   # slate-200


def blend(base, top, alpha):
    return tuple(round(b + (t - b) * alpha) for b, t in zip(base, top))


def make_icon(size: int) -> bytearray:
    px = [[BG for _ in range(size)] for _ in range(size)]

    cx, cy = size / 2, size / 2
    step = size / 8.0
    # Isometric grid: two families of parallel lines at +/-30 degrees.
    slope = 0.5
    for fam in (slope, -slope):
        c = -3.5 * step
        while c <= 3.5 * step:
            for x in range(size):
                y = cy + fam * (x - cx) + c
                yi = int(round(y))
                for dy in (-1, 0, 1):
                    yy = yi + dy
                    if 0 <= yy < size:
                        a = 0.9 if dy == 0 else 0.35
                        px[yy][x] = blend(px[yy][x], LINE, a)
            c += step

    # Center marker dot.
    r = size * 0.06
    for y in range(size):
        for x in range(size):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                px[y][x] = DOT

    # Rounded-corner mask (transparent outside radius).
    radius = size * 0.18
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            r_, g_, b_ = px[y][x]
            a = 255
            # corner rounding
            for (ccx, ccy) in ((radius, radius), (size - radius, radius),
                               (radius, size - radius), (size - radius, size - radius)):
                inside_corner = (
                    (x < radius and y < radius and ccx == radius and ccy == radius)
                    or (x > size - radius and y < radius and ccx == size - radius and ccy == radius)
                    or (x < radius and y > size - radius and ccx == radius and ccy == size - radius)
                    or (x > size - radius and y > size - radius and ccx == size - radius and ccy == size - radius)
                )
                if inside_corner and (x - ccx) ** 2 + (y - ccy) ** 2 > radius * radius:
                    a = 0
            raw += bytes((r_, g_, b_, a))
    return raw


def write_png(path: str, size: int, raw: bytearray) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (192, 512):
        raw = make_icon(size)
        out = os.path.join(OUT_DIR, f"icon-{size}.png")
        write_png(out, size, raw)
        print(f"wrote {os.path.relpath(out)} ({size}x{size})")


if __name__ == "__main__":
    main()
