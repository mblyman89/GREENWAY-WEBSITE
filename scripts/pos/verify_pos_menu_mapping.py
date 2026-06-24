import csv
import json
from collections import Counter
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_pos_menu_preview import (  # noqa: E402
    display_name_for_product,
    normalize_category,
    normalize_strain_type,
    package_label,
)

full_path = Path('src/data/pos-menu-preview.json')
generated_path = Path.cwd().parent / 'research' / 'pos-data-analysis' / 'generated' / 'greenway_pos_menu_preview.json'
sample_path = Path('src/data/pos-menu-sample-preview.json')
items = json.loads(full_path.read_text())
sample_path.write_text(json.dumps(items[:60], indent=2, ensure_ascii=False) + '\n')
print(f'wrote optional inspection sample {sample_path} with {min(60, len(items))} items; app imports full pos-menu-preview.json')

matches_path = Path.cwd().parent / 'research' / 'pos-data-analysis' / 'analysis' / 'priority_matches_v2.csv'
matches = []
with matches_path.open(newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        matches.append(row)

allowed_strains = {'hybrid', 'sativa', 'indica'}
bad_strains = []
bad_filter_categories = []
bad_variant_labels = []
missing_descriptions = []
with_descriptions = 0
thunderchief_examples = []

for item in items:
    if item.get('strainType') not in allowed_strains:
        bad_strains.append((item.get('id'), item.get('name'), item.get('strainType')))

    filters = item.get('filterCategories') or []
    if item.get('category') not in filters:
        bad_filter_categories.append((item.get('id'), item.get('category'), filters))

    variants = item.get('variants') or []
    if not variants:
        bad_variant_labels.append((item.get('id'), item.get('name'), 'missing variants'))
    labels = [variant.get('label') for variant in variants]
    if any(not label for label in labels):
        bad_variant_labels.append((item.get('id'), item.get('name'), labels))

    desc = (item.get('description') or '').strip()
    if desc and not desc.startswith('Description pending'):
        with_descriptions += 1
    else:
        missing_descriptions.append((item.get('id'), item.get('name'), item.get('productName')))

    if 'ThunderChief - Pre-Rolls 2x0.5g TC - Candy Apple - 1g' in item.get('productName', ''):
        thunderchief_examples.append(item)

# Validate generated names/categories/strain types against the same transformer helpers for included source rows.
by_generated_identity = {}
for row in matches:
    product_name = (row.get('product_name') or row.get('inventory_product') or '').strip()
    category = normalize_category(row.get('product_category', '') or row.get('inventory_category', ''), row.get('product_inventory_type', ''), product_name, package_label(row))
    if not category:
        continue
    strain = normalize_strain_type(row.get('product_type', ''))
    strain_name = (row.get('product_strain') or row.get('inventory_strain') or '').strip()
    expected_name = display_name_for_product(product_name, strain_name, category, row.get('product_category', '') or row.get('inventory_category', ''))
    by_generated_identity.setdefault((product_name, category, strain, expected_name), row)

bad_names = []
for item in items:
    identity = (item.get('productName', ''), item.get('category', ''), item.get('strainType', ''), item.get('name', ''))
    # Flower grouping may use the first source productName for a multi-size card; validate
    # representative identity when the exact productName was present in matches.
    if identity[0] and not any(key[0] == identity[0] and key[1] == identity[1] and key[2] == identity[2] and key[3] == identity[3] for key in by_generated_identity):
        matching_source = [key for key in by_generated_identity if key[0] == identity[0]]
        if matching_source:
            bad_names.append((item.get('id'), item.get('category'), item.get('name'), matching_source[:3], item.get('productName')))

print('total items:', len(items))
print('generated mirror exists:', generated_path.exists())
print('category counts:', dict(sorted(Counter(i['category'] for i in items).items())))
print('strain counts:', dict(sorted(Counter(i['strainType'] for i in items).items())))
print('items with real descriptions:', with_descriptions)
print('items with pending descriptions:', len(missing_descriptions))
print('flower variant histogram:', dict(sorted(Counter(len(i.get('variants', [])) for i in items if i.get('category') == 'flower').items())))
print('bad display names:', len(bad_names))
print('bad strain mappings:', len(bad_strains))
print('bad filter categories:', len(bad_filter_categories))
print('bad variant labels:', len(bad_variant_labels))
print('ThunderChief Candy Apple correction:', [
    {
        'name': item.get('name'),
        'category': item.get('category'),
        'filters': item.get('filterCategories'),
        'posCategory': item.get('posInventoryCategory'),
        'strainType': item.get('strainType'),
    }
    for item in thunderchief_examples
])
print('sample items:')
for item in items[:12]:
    print({
        'name': item.get('name'),
        'productName': item.get('productName'),
        'category': item.get('category'),
        'strainType': item.get('strainType'),
        'strainName': item.get('strainName'),
        'variants': [v.get('label') for v in item.get('variants', [])],
        'description': item.get('description', '')[:90],
    })

if bad_names[:5]:
    print('bad name examples:', bad_names[:5])
if bad_strains[:5]:
    print('bad strain examples:', bad_strains[:5])
if bad_filter_categories[:5]:
    print('bad filter category examples:', bad_filter_categories[:5])
if bad_variant_labels[:5]:
    print('bad variant examples:', bad_variant_labels[:5])
if not thunderchief_examples or thunderchief_examples[0].get('category') not in {'preroll', 'preroll-pack'}:
    raise SystemExit('ThunderChief Candy Apple category correction failed')
if bad_names or bad_strains or bad_filter_categories or bad_variant_labels:
    raise SystemExit(1)
