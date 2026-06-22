#!/usr/bin/env python3
"""Update legacy category query links to the POS-aware website taxonomy."""

from pathlib import Path

replacements = {
    "/menu?category=pre-roll": "/menu?category=preroll",
    "/menu?category=edible": "/menu?category=edible-solid",
    "/menu?category=vape": "/menu?category=cartridge",
    "/menu?category=accessory": "/menu?category=paraphernalia",
    '"pre-roll"': '"preroll"',
    '"edible"': '"edible-solid"',
    '"vape"': '"cartridge"',
    '"accessory"': '"paraphernalia"',
}

paths = [
    Path("greenway-site/src/components/site/navigation-data.ts"),
    Path("greenway-site/src/components/site/MobileNavigation.tsx"),
    Path("greenway-site/src/components/specials/SpecialsPreview.tsx"),
    Path("greenway-site/src/components/home/Hero.tsx"),
]

for path in paths:
    text = path.read_text(encoding="utf-8")
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = text.replace("Vapes", "Cartridges")
    text = text.replace("vape and cartridge-style", "cartridge-style")
    text = text.replace("mock menu", "POS menu")
    text = text.replace("mock category set", "POS category set")
    path.write_text(text, encoding="utf-8")

print("Updated category query links")
