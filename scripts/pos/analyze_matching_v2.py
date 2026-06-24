#!/usr/bin/env python3
"""Improved POS workbook matching analysis.

This script does not modify website code. It reads the two POS exports and writes
analysis artifacts used to design a safe inventory/product merge strategy.
"""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

BASE_CANDIDATES = [Path('pos-data'), Path.cwd().parent / 'research' / 'pos-data-analysis']
BASE = next((candidate for candidate in BASE_CANDIDATES if (candidate / 'raw').exists()), BASE_CANDIDATES[0])
RAW = BASE / 'raw'
OUT = BASE / 'analysis'
OUT.mkdir(parents=True, exist_ok=True)

def read_excel_flexible(path: Path, preferred_sheet: str) -> pd.DataFrame:
    """Read a POS workbook, falling back to the first sheet if the old sheet name changed."""
    try:
        return pd.read_excel(path, sheet_name=preferred_sheet, dtype=str).fillna('')
    except ValueError:
        xls = pd.ExcelFile(path)
        return pd.read_excel(path, sheet_name=xls.sheet_names[0], dtype=str).fillna('')


inv = read_excel_flexible(RAW / 'INVENTORIES.xlsx', 'Inventories')
prod = read_excel_flexible(RAW / 'PRODUCTS.xlsx', 'Products')
for df in (inv, prod):
    df.columns = [str(c).strip() for c in df.columns]

STOP_WORDS = {'greenway', 'marijuana', 'the', 'by'}
UNIT_MAP = {
    'ounce': 'oz', 'ounces': 'oz', 'oz': 'oz',
    'fluidounce': 'floz', 'fluidounces': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz', 'floz': 'floz', 'fl oz': 'floz',
    'gram': 'g', 'grams': 'g', 'g': 'g',
    'milligram': 'mg', 'milligrams': 'mg', 'mg': 'mg',
    'milliliter': 'ml', 'milliliters': 'ml', 'ml': 'ml',
    'each': 'ea', 'ea': 'ea', 'unit': 'ea', 'units': 'ea',
}


def clean_number(num: str) -> str:
    if num is None or str(num).strip() == '':
        return ''
    s = str(num).strip().replace(',', '')
    try:
        f = float(s)
        if abs(f - round(f)) < 1e-9:
            return str(int(round(f)))
        return (f'{f:.6f}').rstrip('0').rstrip('.')
    except ValueError:
        return re.sub(r'\.0+$', '', s)


def norm_unit(unit: str) -> str:
    u = str(unit or '').lower().strip()
    u = re.sub(r'[^a-z]+', ' ', u).strip()
    compact = u.replace(' ', '')
    if compact in UNIT_MAP:
        return UNIT_MAP[compact]
    if u in UNIT_MAP:
        return UNIT_MAP[u]
    return compact or u


def norm_text(s):
    s = str(s or '').lower().strip()
    s = s.replace('&', ' and ')
    s = re.sub(r'\b(\d+)\.0+\b', r'\1', s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    toks = [t for t in s.split() if t not in STOP_WORDS]
    return ' '.join(toks)


def norm_package_from_combined(value: str) -> str:
    """Normalize Inventory-style package values like '1.00 Ounce'."""
    s = str(value or '').lower().strip()
    if not s:
        return ''
    s = s.replace('fluidounce', 'fluid ounce')
    m = re.search(r'(\d+(?:\.\d+)?)\s*([a-zA-Z ]+)', s)
    if not m:
        # Try cases already compact, e.g. 3.5g or 10pk
        m2 = re.search(r'(\d+(?:\.\d+)?)(oz|g|mg|ml|floz|ea|pk)', s)
        if m2:
            return clean_number(m2.group(1)) + norm_unit(m2.group(2))
        return re.sub(r'\s+', '', s)
    return clean_number(m.group(1)) + norm_unit(m.group(2))


def norm_package_from_size_uom(size: str, uom: str) -> str:
    """Normalize Products-style separated fields like Package Size='3.200', UOM='Ounce'."""
    size_clean = clean_number(size)
    unit_clean = norm_unit(uom)
    if not size_clean and not unit_clean:
        return ''
    return f'{size_clean}{unit_clean}'


def extract_package_from_name(name: str) -> str:
    """Extract package suffixes embedded in product names when present."""
    s = str(name or '').lower()
    # Common suffix examples: - 3.2oz, 1g, 100mg, 60ml, 10pk, 2ct
    patterns = [
        r'(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid\s*ounce|floz|oz|ounce|ounces)\b',
        r'(\d+(?:\.\d+)?)\s*(grams?|g)\b',
        r'(\d+(?:\.\d+)?)\s*(milligrams?|mg)\b',
        r'(\d+(?:\.\d+)?)\s*(milliliters?|ml)\b',
        r'(\d+(?:\.\d+)?)\s*(pk|pack|ct|count|each|ea)\b',
    ]
    found = []
    for pat in patterns:
        for m in re.finditer(pat, s):
            found.append((m.start(), clean_number(m.group(1)) + norm_unit(m.group(2))))
    if not found:
        return ''
    # Last size-like token is usually the sellable package size.
    return sorted(found)[-1][1]


def remove_package_tokens_from_name(name: str) -> str:
    s = str(name or '').lower()
    s = re.sub(r'[-–—]?\s*\d+(?:\.\d+)?\s*(fl\.?\s*oz|fluid\s*ounce|floz|oz|ounce|ounces|grams?|g|milligrams?|mg|milliliters?|ml|pk|pack|ct|count|each|ea)\b', ' ', s)
    return norm_text(s)


def key(*parts):
    return ' | '.join(str(p or '') for p in parts)

# Normalize fields
inv['__product_norm'] = inv['Product'].map(norm_text)
inv['__product_base_norm'] = inv['Product'].map(remove_package_tokens_from_name)
inv['__brand_norm'] = inv['Brand'].map(norm_text)
inv['__category_norm'] = inv['Category'].map(norm_text)
inv['__strain_norm'] = inv['Strain'].map(norm_text)
inv['__package_norm'] = inv['Package Size'].map(norm_package_from_combined)
inv['__package_from_name'] = inv['Product'].map(extract_package_from_name)
inv['__best_package_norm'] = inv['__package_norm'].where(inv['__package_norm'] != '', inv['__package_from_name'])

prod['__product_norm'] = prod['Product Name'].map(norm_text)
prod['__product_base_norm'] = prod['Product Name'].map(remove_package_tokens_from_name)
prod['__brand_norm'] = prod['Brand'].map(norm_text)
prod['__category_norm'] = prod['Category'].map(norm_text)
prod['__strain_norm'] = prod['Strain'].map(norm_text)
prod['__package_norm'] = prod.apply(lambda r: norm_package_from_size_uom(r.get('Package Size', ''), r.get('UOM', '')), axis=1)
prod['__package_from_name'] = prod['Product Name'].map(extract_package_from_name)
prod['__best_package_norm'] = prod['__package_norm'].where(prod['__package_norm'] != '', prod['__package_from_name'])

for df in (inv, prod):
    df['__name_brand_key'] = df.apply(lambda r: key(r['__product_norm'], r['__brand_norm']), axis=1)
    df['__name_key'] = df['__product_norm']
    df['__base_name_brand_key'] = df.apply(lambda r: key(r['__product_base_norm'], r['__brand_norm']), axis=1)
    df['__name_brand_pack_key'] = df.apply(lambda r: key(r['__product_norm'], r['__brand_norm'], r['__best_package_norm']), axis=1)
    df['__base_name_brand_pack_key'] = df.apply(lambda r: key(r['__product_base_norm'], r['__brand_norm'], r['__best_package_norm']), axis=1)
    df['__name_pack_key'] = df.apply(lambda r: key(r['__product_norm'], r['__best_package_norm']), axis=1)
    df['__base_name_pack_key'] = df.apply(lambda r: key(r['__product_base_norm'], r['__best_package_norm']), axis=1)


def nonblank_key(k):
    return bool(str(k).replace('|', '').strip())


def key_stats(left, right, key_col, left_label='inventory', right_label='products'):
    lcounts = Counter(k for k in left[key_col] if nonblank_key(k))
    rcounts = Counter(k for k in right[key_col] if nonblank_key(k))
    lkeys = set(lcounts)
    rkeys = set(rcounts)
    shared = lkeys & rkeys
    one_to_one = [k for k in shared if lcounts[k] == 1 and rcounts[k] == 1]
    ambiguous = [k for k in shared if lcounts[k] != 1 or rcounts[k] != 1]
    return {
        'key': key_col,
        f'{left_label}_unique_keys': len(lkeys),
        f'{right_label}_unique_keys': len(rkeys),
        'shared_keys': len(shared),
        f'{left_label}_rows_matched': sum(1 for k in left[key_col] if k in shared),
        f'{right_label}_rows_matched': sum(1 for k in right[key_col] if k in shared),
        'one_to_one_shared_keys': len(one_to_one),
        'ambiguous_shared_keys': len(ambiguous),
        'sample_ambiguous': [
            {'key': k, 'inventory_rows': lcounts[k], 'product_rows': rcounts[k]}
            for k in sorted(ambiguous)[:50]
        ],
    }

candidate_keys = [
    '__name_brand_pack_key',
    '__base_name_brand_pack_key',
    '__name_brand_key',
    '__base_name_brand_key',
    '__name_pack_key',
    '__base_name_pack_key',
    '__product_norm',
    '__product_base_norm',
]
summary = {
    'inventory_rows': len(inv),
    'product_rows': len(prod),
    'candidate_key_stats': [key_stats(inv, prod, k) for k in candidate_keys],
    'inventory_package_examples': inv[['Product', 'Package Size', '__package_norm', '__package_from_name', '__best_package_norm']].head(50).to_dict('records'),
    'product_package_examples': prod[['Product Name', 'UOM', 'Package Size', '__package_norm', '__package_from_name', '__best_package_norm']].head(50).to_dict('records'),
    'inventory_uom_package_counts': Counter(inv['__best_package_norm']).most_common(50),
    'product_uom_package_counts': Counter(prod['__best_package_norm']).most_common(50),
    'image_flags': Counter(prod.get('Image Attached Y/N', pd.Series(dtype=str))).most_common(),
    'inventory_zero_or_blank_cannabinoids': {
        col: int(inv[col].astype(str).str.strip().isin(['', '0', '0.0', '0.00', '0.000']).sum())
        for col in ['Cbd', 'Thc', 'Total'] if col in inv.columns
    },
}

# Choose a practical priority ladder for website-safe matching.
priority_keys = [
    ('exact_name_brand_package', '__name_brand_pack_key'),
    ('exact_base_name_brand_package', '__base_name_brand_pack_key'),
    ('exact_name_brand', '__name_brand_key'),
]
prod_groups_by_key = {}
for label, kcol in priority_keys:
    groups = defaultdict(list)
    for pidx, prow in prod.iterrows():
        k = prow[kcol]
        if nonblank_key(k):
            groups[k].append(pidx)
    prod_groups_by_key[label] = (kcol, groups)

matches = []
unmatched = []
ambiguous = []
for iidx, irow in inv.iterrows():
    base = {
        'inventory_index': int(iidx),
        'inventory_id': irow.get('Id', ''),
        'barcode': irow.get('Barcode', ''),
        'inventory_product': irow.get('Product', ''),
        'inventory_brand': irow.get('Brand', ''),
        'inventory_category': irow.get('Category', ''),
        'inventory_strain': irow.get('Strain', ''),
        'inventory_package_size': irow.get('Package Size', ''),
        'inventory_package_key': irow.get('__best_package_norm', ''),
        'units_available': irow.get('Units Available For Sale', ''),
        'units_in_stock': irow.get('Units In Stock', ''),
        'product_price_inventory': irow.get('Product Price', ''),
        'thc': irow.get('Thc', ''),
        'cbd': irow.get('Cbd', ''),
        'total': irow.get('Total', ''),
        'vendor': irow.get('Vendor', ''),
        'received_date': irow.get('Received date', ''),
    }
    resolved = False
    ambiguous_candidates = []
    for label, kcol in priority_keys:
        k = irow[kcol]
        candidates = prod_groups_by_key[label][1].get(k, [])
        if len(candidates) == 1:
            pidx = candidates[0]
            prow = prod.loc[pidx]
            matches.append({
                **base,
                'product_index': int(pidx),
                'product_name': prow.get('Product Name', ''),
                'product_brand': prow.get('Brand', ''),
                'product_category': prow.get('Category', ''),
                'product_inventory_type': prow.get('Inventory Type', ''),
                'product_type': prow.get('Type', ''),
                'product_strain': prow.get('Strain', ''),
                'product_description': prow.get('Description', ''),
                'product_uom': prow.get('UOM', ''),
                'product_package_size': prow.get('Package Size', ''),
                'product_package_key': prow.get('__best_package_norm', ''),
                'product_price_master': prow.get('Price', ''),
                'cannabis_y_n': prow.get('Cannabis Y/N', ''),
                'prepacked_bulk': prow.get('Pre Packed/Bulk', ''),
                'image_attached': prow.get('Image Attached Y/N', ''),
                'match_method': label,
                'match_key': k,
                'candidate_count': 1,
            })
            resolved = True
            break
        elif len(candidates) > 1:
            ambiguous_candidates.append((label, k, candidates))
    if resolved:
        continue
    if ambiguous_candidates:
        label, k, candidates = ambiguous_candidates[0]
        ambiguous.append({
            **base,
            'match_method': 'ambiguous_' + label,
            'match_key': k,
            'candidate_count': len(candidates),
            'candidate_product_indexes': ';'.join(str(int(c)) for c in candidates[:25]),
            'candidate_product_names': ' || '.join(str(prod.loc[c].get('Product Name', '')) for c in candidates[:10]),
        })
    else:
        unmatched.append({**base, 'match_method': 'unmatched', 'match_key': ''})

match_method_counts = Counter(m['match_method'] for m in matches)
summary['priority_ladder_results'] = {
    'matched_rows': len(matches),
    'ambiguous_rows': len(ambiguous),
    'unmatched_rows': len(unmatched),
    'match_method_counts': match_method_counts,
}

# Aggregation sketch: product card grouping by resolved product index/method.
if matches:
    mdf = pd.DataFrame(matches)
    def to_float(x):
        try:
            return float(str(x).replace(',', '').strip() or 0)
        except ValueError:
            return 0.0
    mdf['__units_available_num'] = mdf['units_available'].map(to_float)
    mdf['__units_stock_num'] = mdf['units_in_stock'].map(to_float)
    agg = mdf.groupby(['product_index', 'product_name', 'product_brand', 'product_category'], dropna=False).agg(
        inventory_row_count=('inventory_index', 'count'),
        total_units_available=('__units_available_num', 'sum'),
        total_units_in_stock=('__units_stock_num', 'sum'),
        package_variants=('inventory_package_key', lambda s: ', '.join(sorted(set(x for x in s if x)))),
        barcodes=('barcode', lambda s: ', '.join(sorted(set(x for x in s if x))[:10])),
        match_methods=('match_method', lambda s: ', '.join(sorted(set(s)))),
    ).reset_index()
else:
    agg = pd.DataFrame()

# Save artifacts
inv.to_csv(OUT / 'inventories_normalized_v2.csv', index=False)
prod.to_csv(OUT / 'products_normalized_v2.csv', index=False)
pd.DataFrame(matches).to_csv(OUT / 'priority_matches_v2.csv', index=False)
pd.DataFrame(ambiguous).to_csv(OUT / 'priority_ambiguous_v2.csv', index=False)
pd.DataFrame(unmatched).to_csv(OUT / 'priority_unmatched_v2.csv', index=False)
agg.to_csv(OUT / 'product_card_grouping_preview_v2.csv', index=False)
(OUT / 'matching_summary_v2.json').write_text(json.dumps(summary, indent=2, default=str))

lines = ['# POS Spreadsheet Matching Summary v2', '']
lines.append(f"Inventory rows: {len(inv)}")
lines.append(f"Product rows: {len(prod)}")
lines.append('')
lines.append('## Candidate key performance')
lines.append('')
lines.append('| Key | Shared keys | Inventory rows matched | Product rows matched | 1:1 keys | Ambiguous keys |')
lines.append('|---|---:|---:|---:|---:|---:|')
for stat in summary['candidate_key_stats']:
    lines.append(f"| `{stat['key']}` | {stat['shared_keys']} | {stat['inventory_rows_matched']} | {stat['products_rows_matched']} | {stat['one_to_one_shared_keys']} | {stat['ambiguous_shared_keys']} |")
lines.append('')
lines.append('## Priority ladder row-level result')
lines.append('')
pl = summary['priority_ladder_results']
lines.append(f"- Matched inventory rows: {pl['matched_rows']} of {len(inv)} ({pl['matched_rows']/len(inv):.1%})")
lines.append(f"- Ambiguous inventory rows: {pl['ambiguous_rows']} of {len(inv)} ({pl['ambiguous_rows']/len(inv):.1%})")
lines.append(f"- Unmatched inventory rows: {pl['unmatched_rows']} of {len(inv)} ({pl['unmatched_rows']/len(inv):.1%})")
lines.append('')
lines.append('### Match method counts')
lines.append('')
for method, count in match_method_counts.most_common():
    lines.append(f"- `{method}`: {count}")
lines.append('')
lines.append('## Image availability in product master')
lines.append('')
for val, count in summary['image_flags']:
    lines.append(f'- {val or "(blank)"}: {count}')
lines.append('')
lines.append('## Cannabinoid zero/blank counts in inventory')
lines.append('')
for col, count in summary['inventory_zero_or_blank_cannabinoids'].items():
    lines.append(f'- {col}: {count}')
lines.append('')
lines.append('## Generated artifacts')
lines.append('')
for fname in [
    'inventories_normalized_v2.csv',
    'products_normalized_v2.csv',
    'priority_matches_v2.csv',
    'priority_ambiguous_v2.csv',
    'priority_unmatched_v2.csv',
    'product_card_grouping_preview_v2.csv',
    'matching_summary_v2.json',
]:
    lines.append(f'- `research/pos-data-analysis/analysis/{fname}`')
(OUT / 'matching_summary_v2.md').write_text('\n'.join(lines))
print(OUT / 'matching_summary_v2.md')
