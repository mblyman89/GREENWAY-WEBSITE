import csv
import json
from collections import Counter
from pathlib import Path

full_path = Path('pos-data/generated/greenway_pos_menu_preview.json')
sample_path = Path('src/data/pos-menu-sample-preview.json')
items = json.loads(full_path.read_text())
sample_path.write_text(json.dumps(items[:60], indent=2, ensure_ascii=False) + '\n')
print(f'wrote optional inspection sample {sample_path} with {min(60, len(items))} items; app imports full pos-menu-preview.json')

# Build lookup from match CSV by generated productName for authoritative source fields.
matches = []
with Path('pos-data/analysis/priority_matches_v2.csv').open(newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        matches.append(row)
by_product_name = {}
for row in matches:
    by_product_name.setdefault(row.get('product_name', ''), row)

bad_names = []
bad_strains = []
missing_descriptions = []
with_descriptions = 0
for item in items:
    product_name = item.get('productName', '')
    source = by_product_name.get(product_name)
    if source:
        category = item.get('category')
        expected_source_name = product_name if category in {'edible-solid', 'edible-liquid', 'topical'} else (source.get('product_strain') or source.get('inventory_strain') or product_name)
        expected_name = ' '.join((expected_source_name or '').split())
        if item.get('name') != expected_name:
            bad_names.append((item.get('id'), item.get('category'), item.get('name'), expected_name, product_name))
        def norm_type(value):
            v = (value or '').lower()
            if 'cbd' in v: return 'cbd'
            if 'indica' in v: return 'indica'
            if 'sativa' in v: return 'sativa'
            if 'hybrid' in v: return 'hybrid'
            return 'unknown'
        expected_strain = norm_type(source.get('product_type', ''))
        if item.get('strainType') != expected_strain:
            bad_strains.append((item.get('id'), item.get('strainType'), expected_strain, source.get('product_type')))
    desc = (item.get('description') or '').strip()
    if desc and not desc.startswith('Description pending'):
        with_descriptions += 1
    else:
        missing_descriptions.append((item.get('id'), item.get('name'), product_name))

print('total items:', len(items))
print('category counts:', dict(sorted(Counter(i['category'] for i in items).items())))
print('strain counts:', dict(sorted(Counter(i['strainType'] for i in items).items())))
print('items with real descriptions:', with_descriptions)
print('items with pending descriptions:', len(missing_descriptions))
print('bad display names:', len(bad_names))
print('bad strain mappings:', len(bad_strains))
print('sample items:')
for item in items[:12]:
    print({
        'name': item.get('name'),
        'productName': item.get('productName'),
        'category': item.get('category'),
        'strainType': item.get('strainType'),
        'strainName': item.get('strainName'),
        'description': item.get('description', '')[:90],
    })
if bad_names[:5]:
    print('bad name examples:', bad_names[:5])
if bad_strains[:5]:
    print('bad strain examples:', bad_strains[:5])
if bad_names or bad_strains:
    raise SystemExit(1)
