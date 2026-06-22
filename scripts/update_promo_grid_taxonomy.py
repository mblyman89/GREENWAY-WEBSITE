#!/usr/bin/env python3
from pathlib import Path

path = Path("greenway-site/src/components/home/PromoGrid.tsx")
text = path.read_text(encoding="utf-8")
text = text.replace('import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";\n\nconst categoryLabels: Record<GreenwayCategory, string> = {\n  flower: "Flower",\n  "pre-roll": "Pre-Rolls",\n  edible: "Edibles",\n  vape: "Vapes",\n  concentrate: "Concentrates",\n  topical: "Topicals",\n  accessory: "Accessories",\n};\n\nconst categoryLinkLabels: Record<GreenwayCategory, string> = {\n  flower: "flower",\n  "pre-roll": "pre-rolls",\n  edible: "edibles",\n  vape: "vapes",\n  concentrate: "concentrates",\n  topical: "topicals",\n  accessory: "accessories",\n};\n', 'import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";\nimport { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";\n')
text = text.replace('.filter((category) => category !== "accessory")', '.filter((category) => category !== "paraphernalia")')
text = text.replace('getLabel={(item) => categoryLabels[item.category]}', 'getLabel={(item) => formatWebsiteCategory(item.category)}')
text = text.replace('getLinkText={(item) => `Shop all ${categoryLinkLabels[item.category]}`}', 'getLinkText={(item) => `Shop all ${formatWebsiteCategory(item.category).toLowerCase()}`}')
path.write_text(text, encoding="utf-8")
print("Updated PromoGrid taxonomy")
