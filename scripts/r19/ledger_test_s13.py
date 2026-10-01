import io
NL = chr(10)
T = "tests/compliance/intake-env-ledger.test.ts"
s = io.open(T, encoding="utf-8").read()
def r(a, b, marker):
    global s
    if marker in s: return
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)
r('"INTAKE_VENDOR_ID_IDENTITY", "GOLDEN_RECORD_ON_APPROVE"]) expect(flags).toContain(v);',
  '"INTAKE_VENDOR_ID_IDENTITY", "GOLDEN_RECORD_ON_APPROVE", "MANIFEST_BATCH_LOOKUP", "LOOKUP_ITEMS_PER_TICK"]) expect(flags).toContain(v);',
  '"MANIFEST_BATCH_LOOKUP", "LOOKUP_ITEMS_PER_TICK"]) expect(flags)')
r('    for (const s of ["S13", "S20"]) expect(sec).toMatch(',
  '    // S13 shipped (Round 19): MANIFEST_BATCH_LOOKUP (+ LOOKUP_ITEMS_PER_TICK), so its planned row left too.' + NL +
  '    expect(sec).not.toMatch(/^\\| S13 \\|/m);' + NL +
  '    expect(sec).not.toContain("`MANIFEST_BATCH_LOOKUP`");' + NL +
  '    for (const s of ["S20"]) expect(sec).toMatch(',
  'S13 shipped (Round 19): MANIFEST_BATCH_LOOKUP')
r('''  it("section 5 explains ATTACH_POLICY_RING in plain English, matching the code", () => {''',
'''  it("S13 (Round 19) ADDED MANIFEST_BATCH_LOOKUP + LOOKUP_ITEMS_PER_TICK, read only in the server helper", () => {
    const core = read("src/lib/catalog/lookup-job-core.ts");
    expect(core).toContain('export const MANIFEST_BATCH_LOOKUP_ENV = "MANIFEST_BATCH_LOOKUP"');
    expect(core).toContain('export const LOOKUP_ITEMS_PER_TICK_ENV = "LOOKUP_ITEMS_PER_TICK"');
    expect(core).not.toContain("process.env");
    const server = read("src/lib/catalog/lookup-job-server.ts");
    expect(server).toContain("process.env[MANIFEST_BATCH_LOOKUP_ENV]");
    expect(server).toContain("process.env[LOOKUP_ITEMS_PER_TICK_ENV]");
    // the action file and the cron route never read the flag themselves
    expect(read("src/app/admin/inventory/drafts/actions.ts")).not.toContain("process.env");
    expect(read("src/app/api/cron/lookup-jobs/route.ts")).not.toContain("MANIFEST_BATCH_LOOKUP");
    const sec1 = ledger.slice(ledger.indexOf("## 1. Shipped pipeline flags"), ledger.indexOf("## 2."));
    expect(sec1).toMatch(/^\\| `MANIFEST_BATCH_LOOKUP` \\| S13 \\| on \\|/m);
    expect(sec1).toMatch(/^\\| `LOOKUP_ITEMS_PER_TICK` \\| S13 \\| `12` \\|/m);
    expect(ledger).toContain('"Feature flag; per-row lookup remains", is the `MANIFEST_BATCH_LOOKUP` row');
    expect(ledger).toContain('"chunk size configurable" (S13.8), is the `LOOKUP_ITEMS_PER_TICK` row');
    expect(envExample).toContain("# MANIFEST_BATCH_LOOKUP=on");
    expect(envExample).toContain("# LOOKUP_ITEMS_PER_TICK=12");
  });

  it("section 5 explains ATTACH_POLICY_RING in plain English, matching the code", () => {''', 'S13 (Round 19) ADDED MANIFEST_BATCH_LOOKUP')
io.open(T, "w", encoding="utf-8").write(s)
print("ok")
