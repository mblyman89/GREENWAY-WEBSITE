#!/usr/bin/env python3
"""Build the browser-tab favicon set from the black & gold logo.

Source of truth: public/brand/greenway-black-gold-logo.png (the "Black & gold
logo" entry in src/lib/brand/brand-kit-core.ts). The same artwork is written to
BOTH apps so greenwaymarijuana.com and greenwaymerch.com show the same icon:

  src/app/{favicon.ico,icon.png,apple-icon.png}
  merch-site/app/{favicon.ico,icon.png,apple-icon.png}

Next.js 16 file conventions (node_modules/next/dist/docs/01-app/03-api-reference/
03-file-conventions/01-metadata/app-icons.md): favicon.ico must be in the root
app/ segment; icon.png and apple-icon.png emit <link rel="icon"> and
<link rel="apple-touch-icon"> automatically.

Re-run after changing the logo:  python3 scripts/brand/build-favicons.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "public/brand/greenway-black-gold-logo.png"
TARGETS = [ROOT / "src/app", ROOT / "merch-site/app"]
BLACK_THRESHOLD = 40  # pixels darker than this on every channel count as background
PAD_RATIO = 0.04      # small breathing room around the badge


def square_crop(img: Image.Image) -> Image.Image:
    """Trim the wide black border to the badge, then re-square on black."""
    rgb = img.convert("RGB")
    mask = rgb.convert("L").point(lambda v: 255 if v > BLACK_THRESHOLD else 0)
    left, top, right, bottom = mask.getbbox()
    side = max(right - left, bottom - top)
    side = int(side * (1 + 2 * PAD_RATIO))
    cx, cy = (left + right) // 2, (top + bottom) // 2
    canvas = Image.new("RGB", (side, side), (0, 0, 0))
    crop = rgb.crop((left, top, right, bottom))
    canvas.paste(crop, (side // 2 - (cx - left), side // 2 - (cy - top)))
    return canvas


def main() -> None:
    # RGBA (opaque black background): Next's ICO decoder rejects embedded PNGs
    # that are not RGBA ("The PNG is not in RGBA format!"), verified on build.
    art = square_crop(Image.open(SRC)).convert("RGBA")
    for out in TARGETS:
        art.save(out / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])
        art.resize((512, 512), Image.LANCZOS).save(out / "icon.png", optimize=True)
        art.resize((180, 180), Image.LANCZOS).save(out / "apple-icon.png", optimize=True)
        print(f"wrote {out.relative_to(ROOT)}/favicon.ico, icon.png, apple-icon.png")


if __name__ == "__main__":
    main()
