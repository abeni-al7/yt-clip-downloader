"""Generate the toolbar/store icons without any imaging dependency (zlib + struct only).

A red rounded square, a white "play" triangle and a diagonal cut mark. Run: python3 scripts/icons.py
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
RED = (255, 61, 61)
WHITE = (255, 255, 255)


def png(width: int, height: int, rgba_rows: list[bytes]) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + row for row in rgba_rows)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )


def inside_rounded_square(x: float, y: float, size: float, radius: float) -> bool:
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def inside_triangle(x: float, y: float, size: float) -> bool:
    left, right = size * 0.36, size * 0.72
    top, bottom = size * 0.28, size * 0.72
    if x < left or x > right:
        return False
    half = (bottom - top) / 2 * (1 - (x - left) / (right - left))
    center = (top + bottom) / 2
    return center - half <= y <= center + half


def on_cut_mark(x: float, y: float, size: float) -> bool:
    # A dashed diagonal line from bottom-left to top-right.
    d = abs((x - (size - y)) / 1.4142)
    along = (x + (size - y)) / 2
    return d <= size * 0.035 and size * 0.12 <= along <= size * 0.88 and int(along / (size * 0.11)) % 2 == 0


def render(size: int, supersample: int = 4) -> list[bytes]:
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(supersample):
                for sx in range(supersample):
                    x = px + (sx + 0.5) / supersample
                    y = py + (sy + 0.5) / supersample
                    if not inside_rounded_square(x, y, size, size * 0.22):
                        continue
                    color = WHITE if (inside_triangle(x, y, size) or on_cut_mark(x, y, size)) else RED
                    r += color[0]
                    g += color[1]
                    b += color[2]
                    a += 255
            n = supersample * supersample
            if a:
                row += bytes((round(r / (a / 255)), round(g / (a / 255)), round(b / (a / 255)), round(a / n)))
            else:
                row += b"\x00\x00\x00\x00"
        rows.append(bytes(row))
    return rows


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in (16, 48, 128):
        (OUT / f"icon{size}.png").write_bytes(png(size, size, render(size)))
    print(f"icons written to {OUT}")
