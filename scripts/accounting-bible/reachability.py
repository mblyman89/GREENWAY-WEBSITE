#!/usr/bin/env python3
# Accounting bible: rule-50 reachability scan. Read-only. Run from repo root: python3 scripts/accounting-bible/reachability.py
# Lists src/lib/accounting modules not reachable by import from src/app/** or src/middleware.
import os,re,collections
root='src'
files=[]
for d,_,fs in os.walk(root):
    for f in fs:
        if f.endswith(('.ts','.tsx')): files.append(os.path.join(d,f))
imp=re.compile(r'''(?:from|import)\s*\(?\s*['"]([^'"]+)['"]''')
def resolve(src,spec):
    if spec.startswith('@/'): base=os.path.join('src',spec[2:])
    elif spec.startswith('.'): base=os.path.normpath(os.path.join(os.path.dirname(src),spec))
    else: return None
    for c in [base+'.ts',base+'.tsx',base+'/index.ts',base+'/index.tsx',base]:
        if os.path.isfile(c): return c
    return None
g=collections.defaultdict(set)
for f in files:
    for m in imp.finditer(open(f,errors='ignore').read()):
        r=resolve(f,m.group(1))
        if r: g[f].add(r)
seen=set(); st=[f for f in files if f.startswith('src/app/') or f.startswith('src/middleware')]
while st:
    x=st.pop()
    if x in seen: continue
    seen.add(x); st.extend(g[x])
acc=sorted(f for f in files if f.startswith('src/lib/accounting/'))
print("UNREACHABLE from src/app:")
for f in acc:
    if f not in seen: print(" ",f, sum(1 for _ in open(f)))
print("reachable count",sum(1 for f in acc if f in seen),"of",len(acc))
