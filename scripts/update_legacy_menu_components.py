#!/usr/bin/env python3
"""Patch legacy menu components for the expanded taxonomy labels."""

from pathlib import Path

path = Path("greenway-site/src/components/menu/ProductGrid.tsx")
text = path.read_text(encoding="utf-8")
text = text.replace('import { menuCategories, mockMenuItems } from "@/lib/leafly/mock-menu";\n', 'import { menuCategories, mockMenuItems } from "@/lib/leafly/mock-menu";\nimport { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";\n')
text = text.replace('<h2 className="mt-1 text-3xl font-black capitalize text-white">{category}</h2>', '<h2 className="mt-1 text-3xl font-black text-white">{formatWebsiteCategory(category)}</h2>')
path.write_text(text, encoding="utf-8")

path = Path("greenway-site/src/components/menu/MenuFilters.tsx")
text = path.read_text(encoding="utf-8")
text = text.replace('import { menuCategories, mockMenuItems } from "@/lib/leafly/mock-menu";\n', 'import { menuCategories, mockMenuItems } from "@/lib/leafly/mock-menu";\nimport { formatWebsiteCategory } from "@/lib/pos/category-taxonomy";\n')
text = text.replace('<span className="capitalize">{category}</span>', '<span>{formatWebsiteCategory(category)}</span>')
text = text.replace('Mock</span>', 'Fallback</span>')
path.write_text(text, encoding="utf-8")

print("Updated legacy menu components")
