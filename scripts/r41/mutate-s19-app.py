#!/usr/bin/env python3
"""scripts/r41/mutate-s19-app.py - R41 S19: test the tests for the bank-side
checklist, the ACH glossary, the meeting sheet, the tab and the hover help on
Operations and Approvals.

Each mutant changes ONE thing; then the pure self-tests (run-pure-selftests.ts)
OR the S19 vitest file must FAIL. Files are restored after each mutant and
checked byte-for-byte at the end; a control run must pass first and last. The
tests that read a .last.log are left out of every run (-t), so a stale log can
never "kill" a mutant.

    python3 scripts/r41/mutate-s19-app.py | tee scripts/r41/mutate-s19-app.last.log
"""
import subprocess
import sys

CORE = "src/lib/payments/ach-bank-setup-core.ts"
PAGE = "src/app/admin/settings/banking/bank-setup/page.tsx"
SHEET = "src/app/admin/settings/banking/bank-setup/sheet/route.ts"
TABS = "src/app/admin/settings/banking/BankingHelpTabs.tsx"
OPS = "src/app/admin/settings/banking/operations/page.tsx"
APPROVALS = "src/app/admin/settings/banking/approvals/page.tsx"
T = ["tests/compliance/r41-s19-bank-setup.test.ts"]
PURE = ["timeout", "200", "npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]
VIT = ["timeout", "240", "./node_modules/.bin/vitest", "run", *T, "-t", "^(?!.*last\\.log).*$"]

M = [
    # --- quotes ---
    ("quote reworded", CORE, 'text: "Use ACH blocks. Work with your bank', 'text: "Use ACH blocks. Ask your bank'),
    ("Brenda quote reworded", CORE, 'text: "We can set up dual approval and we prefer that."', 'text: "We can set up dual approval and we recommend that."'),
    ("quote file swapped", CORE, '  brOfac: { text: "Yes we screen for OFAC for each person contained in a file. Cash Management would let you know.", file: BRENDA3_FILE,', '  brOfac: { text: "Yes we screen for OFAC for each person contained in a file. Cash Management would let you know.", file: BRENDA_FILE,'),
    ("owner note relabelled as Brenda", CORE, 'where: "Owner\'s note with email 3 (not Brenda\'s words)"', 'where: "Brenda, email 3"'),
    # --- nothing assumed ---
    ("filter assumed confirmed", CORE, '    id: "filter",\n    title: "ACH filter (ACH positive pay) on the Main account",\n    hint: "A filter lets only listed companies debit the account; anything else waits for review. Bank watch already catches unknown debits after they post; a bank filter stops them first.",\n    status: "ask",', '    id: "filter",\n    title: "ACH filter (ACH positive pay) on the Main account",\n    hint: "A filter lets only listed companies debit the account; anything else waits for review. Bank watch already catches unknown debits after they post; a bank filter stops them first.",\n    status: "confirmed",'),
    ("block given a fake said", CORE, '    onRecord: "Nothing on record. The State Auditor recommends blocks on any account not authorized for ACH.",\n    ask: [\n      "Does Timberland offer an ACH debit block? Which Greenway accounts could have one?",\n      "Is there a fee, and what form turns it on?",\n    ],\n    said: [],', '    onRecord: "Nothing on record. The State Auditor recommends blocks on any account not authorized for ACH.",\n    ask: [\n      "Does Timberland offer an ACH debit block? Which Greenway accounts could have one?",\n      "Is there a fee, and what form turns it on?",\n    ],\n    said: ["brDualPrefer"],'),
    ("dual made confirmed", CORE, '    status: "decide",\n    onRecord: "Dual approval is off', '    status: "ask",\n    onRecord: "Dual approval is off'),
    ("dual loses Brenda off", CORE, '    said: ["brDualOff", "brDualPrefer", "tbDualBox"],', '    said: ["brDualPrefer", "tbDualBox"],'),
    ("limits question left in", CORE, '    onRecord: "$50,000 per transaction and $100,000 per month (Schedule C). Daily is by upload day; monthly is by calendar month.",\n    ask: [],', '    onRecord: "$50,000 per transaction and $100,000 per month (Schedule C). Daily is by upload day; monthly is by calendar month.",\n    ask: ["Are the limits right?"],'),
    ("testing loses test-file yes", CORE, '    said: ["brTestFile", "brTesting"],', '    said: ["brTesting"],'),
    ("phone dropped from portal ask", CORE, '"Who do we call to turn off the login quickly if a phone or token is lost? (The agreement gives " + TIMBERLAND_PHONE + ".)",', '"Who do we call to turn off the login quickly if a phone or token is lost?",'),
    ("item dropped", CORE, '  {\n    id: "ofac",', '  {\n    id: "ofac2",'),
    # --- order / counts ---
    ("decide before ask", CORE, "const rank: Record<ChecklistStatus, number> = { ask: 0, decide: 1, confirmed: 2 };", "const rank: Record<ChecklistStatus, number> = { ask: 1, decide: 0, confirmed: 2 };"),
    ("order unstable", CORE, "rank[a.it.status] - rank[b.it.status] || a.idx - b.idx", "rank[a.it.status] - rank[b.it.status] || b.idx - a.idx"),
    ("counts miscount", CORE, "  for (const i of items) out[i.status]++;", "  for (const i of items) if (i.status !== \"decide\") out[i.status]++;"),
    # --- glossary ---
    ("glossary term dropped", CORE, '  { id: "fedmail", term: "Fed encrypted email",', '  // { id: "fedmail", term: "Fed encrypted email",'),
    ("glossary dead link", CORE, 'source: "gReturn", href: "/admin/settings/banking/operations" },', 'source: "gReturn", href: "/admin/settings/banking/returns" },'),
    ("hint guesses on unknown", CORE, '  return g ? `${g.term}: ${g.plain}` : "";', '  return g ? `${g.term}: ${g.plain}` : id;'),
    ("hint drops term", CORE, '  return g ? `${g.term}: ${g.plain}` : "";', '  return g ? g.plain : "";'),
    # --- sheet ---
    ("sheet tick box", CORE, "    for (const a of it.ask) out.push(`   [ ] ASK: ${a}`);", "    for (const a of it.ask) out.push(`   ASK: ${a}`);"),
    ("sheet glossary dropped", CORE, "  for (const g of ACH_GLOSSARY) out.push(`  ${g.term}: ${g.plain}`);", ""),
    ("sheet counts wrong", CORE, "${c.ask} to ask, ${c.decide} for the owner to decide", "${c.ask + c.decide} to ask, ${c.decide} for the owner to decide"),
    ("digits allowed", CORE, '  return /[0-9]{7,}/.test(s.split(TIMBERLAND_PHONE).join(""));', '  return /[0-9]{17,}/.test(s.split(TIMBERLAND_PHONE).join(""));'),
    # --- page / sheet route / tab / hover ---
    ("staff page", PAGE, '  await requirePermission("settings.manage");', '  await requirePermission("orders.view");'),
    ("page badge dropped", PAGE, '<BankingSubnav active="banksetup" badge={counts.ask ? { banksetup: String(counts.ask) } : undefined} />', '<BankingSubnav active="banksetup" />'),
    ("staff sheet", SHEET, '  const session = await requirePermission("settings.manage");', '  const session = await requirePermission("orders.view");'),
    ("sheet cached", SHEET, '      "Cache-Control": "no-store",', '      "Cache-Control": "max-age=3600",'),
    ("sheet not audited", SHEET, '    action: "ach.bank_setup.sheet",', '    action: "ach.bank_setup",'),
    ("tab dropped", TABS, '  { key: "banksetup", href: "/admin/settings/banking/bank-setup", label: "Bank setup & glossary" },\n', ''),
    ("ops hint dropped", OPS, '<h2 className={h2}>Employee holds ({view.holds.length})<InfoHint ', '<h2 className={h2}>Employee holds ({view.holds.length})<span '),
    ("ops glossary hint dropped", OPS, '${glossaryHint("prenote")}', 'A prenote is a $0 test.'),
    ("approvals hint dropped", APPROVALS, '<h2 className={h2}>Recently decided<InfoHint text="The latest decisions, for the record." /></h2>', '<h2 className={h2}>Recently decided</h2>'),
]

files = sorted({m[1] for m in M})
orig = {f: open(f).read() for f in files}


def run():
    a = subprocess.run(PURE, capture_output=True, text=True)
    if a.returncode != 0 or "ALL PURE SELF-TESTS PASSED" not in a.stdout + a.stderr:
        return 1
    return subprocess.run(VIT, capture_output=True, text=True).returncode


c0 = run()
print("control (before)", "pass" if c0 == 0 else f"FAILED {c0}", flush=True)
if c0 != 0:
    sys.exit(2)
surv = []
for name, f, a, b in M:
    s0 = orig[f]
    if s0.count(a) != 1:
        print(f"ANCHOR count={s0.count(a)} {name}", flush=True)
        surv.append(name)
        continue
    open(f, "w").write(s0.replace(a, b, 1))
    try:
        rc = run()
    finally:
        open(f, "w").write(s0)
    k = rc != 0
    print(f"{'killed  ' if k else 'SURVIVED'} {name}", flush=True)
    if not k:
        surv.append(name)
for f in files:
    assert open(f).read() == orig[f], f
c1 = run()
print("control (after)", "pass" if c1 == 0 else f"FAILED {c1}")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or c1 != 0 else 0)
