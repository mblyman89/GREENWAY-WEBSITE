import io
NL=chr(10)
p="tests/compliance/pipeline-fix-links-connected.test.ts"
s=io.open(p,encoding="utf-8").read()
a="    \"gold\\u2192factWorklist.length > 0\", // Round 13: open fact flags for the pinned delivery"+NL
b=a+"    'danger\\u2192lookupResult.tone === \"error\"', // R19 S13: result of pressing Look up all / Stop (closed set, lookupBanner)"+NL
if "R19 S13: result of pressing" not in s:
    assert s.count(a)==1; s=s.replace(a,b)
io.open(p,"w",encoding="utf-8").write(s)
print("ok")
