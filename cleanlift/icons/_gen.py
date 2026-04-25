"""Generate brand icons for CleanLift at 16/32/48/128 px using stdlib only.

Design: deep-purple rounded square (brand-deep #27153e); inside, two stacked
cream "page" rectangles, the back tinted teal (brand-teal #76c8c2) suggesting
a lift / extraction motion. Three text bars on the foreground page in pink
(brand-pink #eb548e) — the brand's signature accent.
"""

import math
import struct
import zlib
from pathlib import Path


# Brand palette — keep aligned with cleanlift/popup/popup.css :root tokens.
BG = (39, 21, 62, 255)            # #27153e brand-deep
PAGE = (254, 251, 255, 255)       # #fefbff brand-cream
PAGE_BACK = (118, 200, 194, 255)  # #76c8c2 brand-teal — tinted back page
ACCENT = (235, 84, 142, 255)      # #eb548e brand-pink — text bars
TRANSPARENT = (0, 0, 0, 0)


def blend(top, bottom):
    ta = top[3] / 255.0
    if ta == 0:
        return bottom
    if ta == 1:
        return top
    inv = 1 - ta
    return (
        int(top[0] * ta + bottom[0] * inv),
        int(top[1] * ta + bottom[1] * inv),
        int(top[2] * ta + bottom[2] * inv),
        255,
    )


def make_canvas(size):
    return [[TRANSPARENT for _ in range(size)] for _ in range(size)]


def fill_rounded_rect(canvas, x0, y0, x1, y1, radius, color):
    n = len(canvas)
    for y in range(max(0, y0), min(n, y1 + 1)):
        for x in range(max(0, x0), min(n, x1 + 1)):
            in_corner_tl = x < x0 + radius and y < y0 + radius
            in_corner_tr = x > x1 - radius and y < y0 + radius
            in_corner_bl = x < x0 + radius and y > y1 - radius
            in_corner_br = x > x1 - radius and y > y1 - radius
            if in_corner_tl or in_corner_tr or in_corner_bl or in_corner_br:
                if in_corner_tl:
                    cx, cy = x0 + radius, y0 + radius
                elif in_corner_tr:
                    cx, cy = x1 - radius, y0 + radius
                elif in_corner_bl:
                    cx, cy = x0 + radius, y1 - radius
                else:
                    cx, cy = x1 - radius, y1 - radius
                dx = x - cx
                dy = y - cy
                d = math.hypot(dx, dy)
                if d <= radius:
                    alpha = 1.0
                elif d <= radius + 1:
                    alpha = max(0.0, 1.0 - (d - radius))
                else:
                    continue
                blended = (color[0], color[1], color[2], int(color[3] * alpha))
                canvas[y][x] = blend(blended, canvas[y][x])
            else:
                canvas[y][x] = blend(color, canvas[y][x])


def fill_rect(canvas, x0, y0, x1, y1, color):
    n = len(canvas)
    for y in range(max(0, y0), min(n, y1 + 1)):
        for x in range(max(0, x0), min(n, x1 + 1)):
            canvas[y][x] = blend(color, canvas[y][x])


def draw_icon(size):
    c = make_canvas(size)
    s = size

    # background rounded square — leave a 1px transparent breathe
    pad = max(0, s // 32)
    radius = max(2, s // 5)
    fill_rounded_rect(c, pad, pad, s - 1 - pad, s - 1 - pad, radius, BG)

    # back page (tinted, slightly larger and offset up-left)
    page_w = int(s * 0.46)
    page_h = int(s * 0.58)
    cx = s // 2
    cy = s // 2
    back_x0 = cx - page_w // 2 - max(1, s // 24)
    back_y0 = cy - page_h // 2 - max(1, s // 24)
    back_x1 = back_x0 + page_w
    back_y1 = back_y0 + page_h
    fill_rounded_rect(c, back_x0, back_y0, back_x1, back_y1, max(1, s // 24), PAGE_BACK)

    # front page (white, opaque)
    front_x0 = cx - page_w // 2 + max(1, s // 24)
    front_y0 = cy - page_h // 2 + max(1, s // 24)
    front_x1 = front_x0 + page_w
    front_y1 = front_y0 + page_h
    fill_rounded_rect(c, front_x0, front_y0, front_x1, front_y1, max(1, s // 24), PAGE)

    # text lines on front page (accent bars)
    line_h = max(1, s // 32)
    line_gap = max(2, s // 16)
    margin_x = max(2, s // 16)
    line_x0 = front_x0 + margin_x
    line_x1 = front_x1 - margin_x
    first_line_y = front_y0 + max(3, s // 10)
    line_widths = [1.0, 0.85, 0.95, 0.6]  # ragged-right
    for i, w in enumerate(line_widths):
        ly0 = first_line_y + i * (line_h + line_gap)
        ly1 = ly0 + line_h
        if ly1 > front_y1 - max(2, s // 16):
            break
        lx1 = line_x0 + int((line_x1 - line_x0) * w)
        fill_rect(c, line_x0, ly0, lx1, ly1, ACCENT)

    return c


def encode_png(canvas):
    h = len(canvas)
    w = len(canvas[0])

    raw = bytearray()
    for row in canvas:
        raw.append(0)  # filter type 0 (None)
        for px in row:
            raw.append(px[0])
            raw.append(px[1])
            raw.append(px[2])
            raw.append(px[3])

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return out + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    iend = b""
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", iend)


def main():
    out_dir = Path(__file__).parent
    for size in (16, 32, 48, 128):
        canvas = draw_icon(size)
        png = encode_png(canvas)
        path = out_dir / f"icon{size}.png"
        path.write_bytes(png)
        print(f"wrote {path} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
