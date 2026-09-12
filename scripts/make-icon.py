#!/usr/bin/env python3
"""Generates build/icon.icns (and a PNG preview) for MarkItDown.

The mark is the app's own idea in miniature: a sheet of paper on the slate
workbench, carrying Markdown's heading character in highlighter gold. Drawn
geometrically rather than set in a typeface, so the weight stays legible when
macOS scales it down to 16px and there's no font dependency.

Run: service/.venv/bin/python scripts/make-icon.py
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

SIZE = 1024
SUPERSAMPLE = 2  # draw large, downsample once, for clean edges

SLATE_TOP = (39, 47, 62)
SLATE_BOTTOM = (18, 21, 28)
PAPER = (252, 252, 250)
GOLD = (242, 193, 78)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return mask


def vertical_gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    width, height = size
    gradient = Image.new("RGB", (1, height))
    pixels = gradient.load()
    for y in range(height):
        t = y / max(1, height - 1)
        pixels[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return gradient.resize((width, height), Image.BILINEAR)


def hash_mark(draw: ImageDraw.ImageDraw, cx: float, cy: float, span: float) -> None:
    """A '#' built from four bars, italicised the way editors render it."""
    bar = span * 0.17  # stroke weight
    gap = span * 0.235  # distance from centre to each bar
    slant = span * 0.11  # horizontal lean of the vertical strokes
    half = span / 2

    # Vertical strokes, leaning right toward the top.
    for direction in (-1, 1):
        x = cx + direction * gap
        draw.polygon(
            [
                (x + slant - bar / 2, cy - half),
                (x + slant + bar / 2, cy - half),
                (x - slant + bar / 2, cy + half),
                (x - slant - bar / 2, cy + half),
            ],
            fill=GOLD,
        )

    # Horizontal strokes.
    for direction in (-1, 1):
        y = cy + direction * gap
        draw.rounded_rectangle(
            [cx - half * 0.92, y - bar / 2, cx + half * 0.92, y + bar / 2],
            radius=bar / 2,
            fill=GOLD,
        )


def build_icon() -> Image.Image:
    scale = SUPERSAMPLE
    canvas_size = SIZE * scale
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    # --- the squircle body, following macOS's 1024 grid with ~100px padding ---
    pad = round(100 * scale)
    body_size = canvas_size - pad * 2
    body = vertical_gradient((body_size, body_size), SLATE_TOP, SLATE_BOTTOM).convert("RGBA")
    body.putalpha(rounded_mask((body_size, body_size), round(180 * scale)))

    # Soft drop shadow beneath the body, as macOS icons carry.
    shadow = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    shadow_mask = rounded_mask((body_size, body_size), round(180 * scale))
    shadow.paste((0, 0, 0, 110), (pad, pad + round(16 * scale)), shadow_mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(18 * scale)))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(body, (pad, pad))

    # --- the sheet of paper ---
    sheet_w, sheet_h = round(440 * scale), round(530 * scale)
    sheet_x = (canvas_size - sheet_w) // 2
    sheet_y = (canvas_size - sheet_h) // 2

    sheet_shadow = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    sheet_shadow.paste(
        (0, 0, 0, 130),
        (sheet_x, sheet_y + round(18 * scale)),
        rounded_mask((sheet_w, sheet_h), round(34 * scale)),
    )
    sheet_shadow = sheet_shadow.filter(ImageFilter.GaussianBlur(round(22 * scale)))
    canvas.alpha_composite(sheet_shadow)

    sheet = Image.new("RGBA", (sheet_w, sheet_h), PAPER + (255,))
    sheet.putalpha(rounded_mask((sheet_w, sheet_h), round(34 * scale)))
    canvas.alpha_composite(sheet, (sheet_x, sheet_y))

    # --- the heading mark ---
    draw = ImageDraw.Draw(canvas)
    hash_mark(
        draw,
        cx=canvas_size / 2,
        cy=sheet_y + sheet_h / 2,
        span=sheet_w * 0.55,
    )

    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def build_dmg_background(icon: Image.Image) -> None:
    """The installer window: drag the app onto Applications, and nothing else.

    Sized 660x420 to match the dmg window in electron-builder.yml; the @2x
    variant is what Retina displays actually show.
    """
    for scale, name in ((1, "dmg-background.png"), (2, "dmg-background@2x.png")):
        width, height = 660 * scale, 420 * scale
        panel = vertical_gradient((width, height), SLATE_TOP, SLATE_BOTTOM).convert("RGBA")
        draw = ImageDraw.Draw(panel)

        # A quiet arrow between the two drop points, at icon centre height.
        y = 170 * scale
        x_start, x_end = 268 * scale, 392 * scale
        thickness = max(1, round(2 * scale))
        draw.line([(x_start, y), (x_end - 10 * scale, y)], fill=(120, 132, 152), width=thickness)
        head = 9 * scale
        draw.polygon(
            [
                (x_end, y),
                (x_end - head, y - head * 0.62),
                (x_end - head, y + head * 0.62),
            ],
            fill=(120, 132, 152),
        )

        panel.save(BUILD / name)


def main() -> int:
    BUILD.mkdir(parents=True, exist_ok=True)
    icon = build_icon()

    master = BUILD / "icon.png"
    icon.save(master)

    iconset = BUILD / "icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()

    for base in (16, 32, 128, 256, 512):
        icon.resize((base, base), Image.LANCZOS).save(iconset / f"icon_{base}x{base}.png")
        icon.resize((base * 2, base * 2), Image.LANCZOS).save(
            iconset / f"icon_{base}x{base}@2x.png"
        )

    result = subprocess.run(
        ["iconutil", "--convert", "icns", str(iconset), "--output", str(BUILD / "icon.icns")],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        return 1

    shutil.rmtree(iconset)
    build_dmg_background(icon)
    size_kb = (BUILD / "icon.icns").stat().st_size / 1024
    print(f"Wrote {BUILD / 'icon.icns'} ({size_kb:.0f} KB) and {master}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
