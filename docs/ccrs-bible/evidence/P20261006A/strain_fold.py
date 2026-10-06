#!/usr/bin/env python3
"""Does production CCRS hold Inventory rows whose Strain matches a filed Strain
only case-insensitively? Evidence for interpreting the S-11 control (file 5)."""
import csv, io
from collections import Counter
W = '/workspace'
def load(p):
    t = open(p, 'rb').read().decode('utf-8-sig')
    r = list(csv.reader(io.StringIO(t)))
    return r[0], r[1:]
ih, inv = load(f'{W}/Inventory.csv'); c = {h: i for i, h in enumerate(ih)}
sh, st = load(f'{W}/analysis2/sheets/Strains.csv'); s = {h: i for i, h in enumerate(sh)}
names = [r[s['Name']] for r in st]
exact = set(names); fold = {}
for n in names: fold.setdefault(n.casefold(), set()).add(n)
print('strain header', sh)
print('inventory header', ih)
caseonly = [r for r in inv if r[c['Strain']] not in exact and r[c['Strain']].casefold() in fold]
print('inventory rows (all) strain exact-missing but casefold-present:', len(caseonly))
years = Counter(r[c['CreatedDate']].split('/')[-1][:4] for r in caseonly)
print('by CreatedDate year:', dict(sorted(years.items())))
pairs = Counter((r[c['Strain']], tuple(sorted(fold[r[c['Strain']].casefold()]))) for r in caseonly)
print('distinct (used, filed) pairs:', len(pairs))
for (u, f), n in pairs.most_common(8): print(f'  {n:5d}  used={u!r}  filed={list(f)!r}')
recent = [r for r in caseonly if r[c['CreatedDate']].split('/')[-1][:4] in ('2025', '2026')]
print('rows created 2025-2026:', len(recent))
for r in recent[:5]: print('  ', r[c['CreatedDate']], repr(r[c['Strain']]), '->', sorted(fold[r[c['Strain']].casefold()]))
print('--- rows whose strain is absent even case-insensitively ---')
hard = [r for r in inv if r[c['Strain']].casefold() not in fold]
print('rows:', len(hard))
print('by year:', dict(sorted(Counter(r[c['CreatedDate']].split('/')[-1][:4] for r in hard).items())))
print('by creator:', dict(Counter(r[c['CreatedBy']] for r in hard)))
for r in sorted(hard, key=lambda r: r[c['CreatedDate']][-10:])[-12:]:
    print('  ', r[c['CreatedDate']], r[c['CreatedBy']], repr(r[c['Strain']]))
