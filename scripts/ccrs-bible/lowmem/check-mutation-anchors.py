# Checks every mutate_check.py tuple: id unique, old text found exactly once, test file exists.
# Run from the repo root: python3 scripts/ccrs-bible/lowmem/check-mutation-anchors.py
import importlib.util,sys,os
spec=importlib.util.spec_from_file_location("m","scripts/ccrs-bible/mutate_check.py");m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
bad=0
ids=[x[0] for x in m.MUTATIONS]
print("total",len(ids),"dup ids",len(ids)-len(set(ids)))
for mid,path,old,new,t,w in m.MUTATIONS:
    c=open(path).read().count(old)
    if c!=1 or not os.path.exists(t): bad+=1; print("BAD",mid,c,t)
print("bad",bad)
