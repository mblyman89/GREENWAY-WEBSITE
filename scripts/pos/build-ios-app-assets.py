#!/usr/bin/env python3
"""
Rebuild the iPad register app's icon and launch screen from the real Greenway
brand art.

WHY THIS SCRIPT EXISTS
`npx cap add ios` generates the native project from a stock template, and that
template ships Capacitor's OWN placeholder artwork: a blue-and-white Capacitor
logo for the app icon, and a white splash screen. Both are wrong here, for two
different reasons.

  1. THE ICON IS SOMEONE ELSE'S BRAND. A till on the shop floor showing a
     generic blue logo is not a Greenway product, and Apple review would be
     looking at a placeholder. This is a business's point-of-sale terminal; it
     wears the business's mark.

  2. THE WHITE SPLASH FLASHES. The register boots dark: RegisterShell starts in
     dark mode and only switches after reading the saved preference, and the
     web view background is set to #060807 in capacitor.config.ts. A white
     launch screen in front of a dark app produces a bright flash on every
     single launch. On a till that is woken dozens of times a day, often in a
     dim room, that flash is genuinely unpleasant and makes an otherwise solid
     appliance feel cheap.

If `npx cap add ios` is ever re-run (which wipes and regenerates the folder),
run this script afterwards to put the Greenway artwork back. That is the whole
point of committing it rather than editing the PNGs by hand once: the fix is
reproducible and the reasoning travels with it.

WHAT IT PRODUCES
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
      1024x1024, NO alpha channel. Apple auto-generates every other icon
      variation from this single image (Xcode docs, "Configuring your app icon
      using an asset catalog"), and the App Store icon must be flat RGB —
      an alpha channel is rejected at upload.

  ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png
      2732x2732, the brand logo centred on the register's dark canvas so the
      launch screen and the first painted frame are the same colour.

SOURCE ART
  public/brand/greenway-black-gold-logo.png — the real logo, gold on SOLID
  black, 2853x2853, flat RGB. Used for the app ICON, which must have no alpha.

  public/brand/greenway-black-gold-logo-transparent.png — the same mark with a
  genuinely transparent background. Used for the SPLASH. This distinction is
  not cosmetic: the register canvas is #060807, which is very dark but not pure
  black, so compositing the solid-black version onto it leaves a visible black
  SQUARE floating on the launch screen. Only the transparent version blends
  invisibly. (Verified by rendering both.)

  Gold on near-black is not a compromise here; it is what the dark register
  canvas was designed around.

Run from the repository root:
    python3 scripts/pos/build-ios-app-assets.py
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - environment guard
    sys.exit("Pillow is required: pip install Pillow")

REPO_ROOT = Path(__file__).resolve().parents[2]

SOURCE_LOGO = REPO_ROOT / "public" / "brand" / "greenway-black-gold-logo.png"
SOURCE_LOGO_TRANSPARENT = (
    REPO_ROOT / "public" / "brand" / "greenway-black-gold-logo-transparent.png"
)
ICON_DIR = REPO_ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset"
SPLASH_DIR = REPO_ROOT / "ios/App/App/Assets.xcassets/Splash.imageset"

ICON_PATH = ICON_DIR / "AppIcon-512@2x.png"
SPLASH_NAMES = (
    "splash-2732x2732.png",
    "splash-2732x2732-1.png",
    "splash-2732x2732-2.png",
)

ICON_SIZE = 1024
SPLASH_SIZE = 2732

# --pos-canvas from src/app/pos-tokens.css — the register's dark canvas, and
# the same colour as backgroundColor in capacitor.config.ts. Keeping all three
# identical is what removes the launch flash.
POS_CANVAS = (0x06, 0x08, 0x07)

# The logo occupies this fraction of the splash width. Deliberately modest:
# a launch screen is a held breath, not a billboard.
SPLASH_LOGO_FRACTION = 0.42


def build_icon() -> None:
    """Square 1024x1024 app icon, flat RGB (no alpha — Apple rejects alpha)."""
    logo = Image.open(SOURCE_LOGO).convert("RGB")
    icon = logo.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    icon.save(ICON_PATH, format="PNG", optimize=True)
    print(f"wrote {ICON_PATH.relative_to(REPO_ROOT)} ({ICON_SIZE}x{ICON_SIZE}, RGB)")


def build_splash() -> None:
    """Square launch image: brand logo centred on the register's dark canvas."""
    # MUST be the transparent variant. The solid-black version would paint a
    # visible black square onto the #060807 canvas.
    logo = Image.open(SOURCE_LOGO_TRANSPARENT).convert("RGBA")

    target = int(SPLASH_SIZE * SPLASH_LOGO_FRACTION)
    logo = logo.resize((target, target), Image.LANCZOS)

    canvas = Image.new("RGB", (SPLASH_SIZE, SPLASH_SIZE), POS_CANVAS)
    offset = (SPLASH_SIZE - target) // 2
    # Alpha mask, so only the gold artwork lands and the canvas shows through
    # everywhere else — no square, no seam.
    canvas.paste(logo, (offset, offset), logo)

    SPLASH_DIR.mkdir(parents=True, exist_ok=True)
    for name in SPLASH_NAMES:
        path = SPLASH_DIR / name
        canvas.save(path, format="PNG", optimize=True)
        print(f"wrote {path.relative_to(REPO_ROOT)} ({SPLASH_SIZE}x{SPLASH_SIZE}, RGB)")


def main() -> int:
    for source in (SOURCE_LOGO, SOURCE_LOGO_TRANSPARENT):
        if not source.exists():
            print(f"ERROR: source logo missing at {source}", file=sys.stderr)
            return 1
    if not (REPO_ROOT / "ios").exists():
        print(
            "ERROR: no ios/ folder. Run `npx cap add ios` first.",
            file=sys.stderr,
        )
        return 1
    build_icon()
    build_splash()
    print("iOS app assets rebuilt from Greenway brand art.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
