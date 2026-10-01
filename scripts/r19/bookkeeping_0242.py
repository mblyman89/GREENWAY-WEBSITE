"""R19 S13: idempotent bookkeeping for migration 0242 (re-runnable)."""
import glob
NL = chr(10)

def edit(path, old, new, marker):
    s = open(path).read()
    if marker in s:
        print("already:", path); return
    assert s.count(old) == 1, (path, s.count(old))
    open(path, "w").write(s.replace(old, new)); print("edited:", path)

# 1. migration-execution-gate pins
old = NL.join([
 '    expect(listed[listed.length - 1]).toMatch(/^0241_/);',
 '    // Exact name, not just a prefix (S08 mutation M58: a loosened prefix',
 '    // regex such as /^023[56]_/ still passed while the file was last).',
 '    expect(listed[listed.length - 1]).toBe("0241_inventory_lot_pos_potency.sql");',
 '    expect(listed[listed.length - 2]).toBe("0240_factory_reset_scales.sql");',
 '    expect(listed[listed.length - 3]).toBe("0239_intake_merge_decisions.sql");',
 '    expect(listed[listed.length - 4]).toBe("0238_factory_reset_reaches_every_guard.sql");',
 '    expect(listed[listed.length - 5]).toBe("0237_fact_review_for_versions.sql");',
 '    expect(listed[listed.length - 6]).toBe("0236_publish_archive_rule.sql");'])
new = NL.join([
 '    // R19 S13 added 0242_lookup_jobs.sql (lookup_jobs + lookup_job_items for',
 '    // the "Look up all N products on this manifest" button; one active job per',
 '    // manifest by a partial unique index; RLS on, no policy; idempotent).',
 '    // Verified in the build sandbox on Postgres 15 with',
 '    // scripts/recon/lookup-jobs-pg-check.sql: applied twice in a rolled-back',
 '    // transaction, every constraint refused its bad row, and a non-unique',
 '    // index mutant failed the check. The owner applies it by hand.',
 '    expect(listed[listed.length - 1]).toMatch(/^0242_/);',
 '    // Exact name, not just a prefix (S08 mutation M58: a loosened prefix',
 '    // regex such as /^023[56]_/ still passed while the file was last).',
 '    expect(listed[listed.length - 1]).toBe("0242_lookup_jobs.sql");',
 '    expect(listed[listed.length - 2]).toBe("0241_inventory_lot_pos_potency.sql");',
 '    expect(listed[listed.length - 3]).toBe("0240_factory_reset_scales.sql");',
 '    expect(listed[listed.length - 4]).toBe("0239_intake_merge_decisions.sql");',
 '    expect(listed[listed.length - 5]).toBe("0238_factory_reset_reaches_every_guard.sql");',
 '    expect(listed[listed.length - 6]).toBe("0237_fact_review_for_versions.sql");',
 '    expect(listed[listed.length - 7]).toBe("0236_publish_archive_rule.sql");'])
edit("tests/compliance/migration-execution-gate.test.ts", old, new, "R19 S13 added 0242_lookup_jobs.sql")

# 2. factory reset KEEP rules
anchor = '  { table: "product_classification_overrides", disposition: "KEEP"'
add = NL.join([
 '  // lookup_jobs / lookup_job_items (0242, bible S13): the record of each',
 '  // "Look up all N products on this manifest" press. KEEP, not WIPE: the',
 '  // 0240 wipe list is fixed SQL, and these tables hold no money, stock or',
 '  // customer data. They have no foreign key into any emptied table',
 '  // (manifest_id / draft_id are stamps), and lookup_job_items -> lookup_jobs',
 '  // is KEEP -> KEEP, so keeping them never leaves a dangling link. After a',
 '  // wipe, a job naming a gone manifest is simply never shown again.',
 '  { table: "lookup_jobs", disposition: "KEEP", because: "The record of each batch product lookup you started (which manifest, when, by whom). It holds no money, stock or customer data, and after a wipe a job for a manifest that is gone is simply never shown again." },',
 '  { table: "lookup_job_items", disposition: "KEEP", because: "One line per product inside a batch lookup, with its short result and how many paid AI lookups it used. It goes with its batch record and holds no money, stock or customer data." },',
 ''])
edit("src/lib/accounting/factory-reset-core.ts", anchor, add + anchor, '{ table: "lookup_jobs"')

# 3. d82 never-wipe list
p = glob.glob("tests/compliance/d82*.test.ts")[0]
edit(p, '      "intake_merge_decisions",' + NL + '    ]) {',
     '      "intake_merge_decisions",' + NL + '      "lookup_jobs",' + NL + '      "lookup_job_items",' + NL + '    ]) {',
     '"lookup_job_items",')
