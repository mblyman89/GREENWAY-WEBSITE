"""
scripts/compliance/mutate-fix-p2-6.py

Fix Phase 2.6a (G-04 deposit bag screen, G-14 the seal wire; F-00-6, F-03-9,
F-03-10). Rule 13c: a test that cannot fail is worse than no test. This breaks
the deposit bag flow on purpose, one edit at a time, and demands that the
suite NOTICE.

Rule 133g: several mutations SEVER THE DOOR (the seal action stops calling the
poster, the poster stops posting, the screen stops rendering a form, Register
Activity loses its button). Rule 137: every anchor must match EXACTLY once or
the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-6.py
"""
import io
import subprocess
import sys

CORE = "src/lib/registers/deposit-bag-flow-core.ts"
POSTER = "src/lib/accounting/seal-bag-posting-service.ts"
ACTIONS = "src/app/admin/registers/deposit-bags/actions.ts"
PAGE = "src/app/admin/registers/deposit-bags/page.tsx"
ACTIVITY = "src/app/admin/registers/page.tsx"
SAFE = "src/lib/accounting/safe-bag-core.ts"
CENSUS = "src/lib/accounting/ledger-census-data.ts"

TESTS = [
    "tests/compliance/fix-p2-6-deposit-bags.test.ts",
    "tests/compliance/posting-services-are-reachable.test.ts",
    "tests/compliance/safe-bag.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── the pure rules ────────────────────────────────────────────────────
    ("1  the same employee may recount their own night count (D24)",
     CORE, "  if (input.nightCounterId && input.nightCounterId === input.recounterId) return { ok: false, error: RECOUNT_SAME_PERSON_ERROR };",
     "  // same-person check removed"),
    ("2  two bags allowed for one business day",
     CORE, "  if (input.existingBagNoForDay !== null) {", "  if (false && input.existingBagNoForDay !== null) {"),
    ("3  night count saved without the closer's PIN",
     CORE, "  if (!input.closerId) return", "  if (false) return"),
    ("4  the morning recount is no longer blind",
     CORE, "  return b.morningCountMinor !== null || b.sealedAt !== null || b.bankedOn !== null;", "  return true;"),
    ("5  a >$5 difference declares without a reason",
     CORE, '  if (!cmp.needsReason || (reason !== null && reason !== "")) {', "  if (true) {"),
    ("6  a bag may be sealed twice",
     CORE, "  if (bag.sealedAt !== null) return", "  if (false) return"),
    ("7  a bag may be sealed before the morning recount",
     CORE, "  if (bag.morningCountMinor === null || bag.morningCountedBy === null) {", "  if (false) {"),
    ("8  a bag over $5 out may be sealed without a reason",
     CORE, "    if (cmp.needsReason && !bag.varianceReason) {", "    if (false) {"),
    ("9  seal saved without the sealer's PIN",
     CORE, "  if (!input.sealerId) return", "  if (false) return"),
    ("10 the seal takes the NIGHT figure instead of the morning recount",
     CORE, "  return { ok: true, bagNo, amountMinor: bag.morningCountMinor };",
     "  return { ok: true, bagNo, amountMinor: bag.nightCountMinor ?? bag.morningCountMinor };"),
    ("11 the seal source ref is not per-bag",
     CORE, "  return `seal-bag:${bagId}`;", "  return `seal-bag`;"),
    ("12 an unsealed bag goes to the bank",
     CORE, "    if (!b.sealedAt) return { ok: false, error: `Bag ${b.bagNo} is not sealed.",
     "    if (false) return { ok: false, error: `Bag ${b.bagNo} is not sealed."),
    ("13 a bag goes to the bank twice",
     CORE, "    if (b.bankedOn) return { ok: false", "    if (false) return { ok: false"),
    ("14 a bag goes to the bank before its own business day",
     CORE, "    if (day.day < b.businessDay)", "    if (false)"),
    ("15 an open drawer makes the expected deposit a number",
     CORE, "    expectedMinor: problems.length === 0 ? takings + dropsTotal : null,",
     "    expectedMinor: takings + dropsTotal,"),

    # ── the poster (DOOR) ─────────────────────────────────────────────────
    ("16 DOOR  an unsealed bag is posted",
     POSTER, '  if (!bag.sealed_at || bag.status !== "deposited") {', "  if (false) {"),
    ("17 a bag with no amount is posted",
     POSTER, "  if (bag.amount_minor == null) {", "  if (false && bag.amount_minor == null) {"),
    ("18 the entry is dated today, not on the business day",
     POSTER, "    journalDate: bag.business_day,", "    journalDate: new Date().toISOString().slice(0, 10),"),
    ("19 the entry is left as a draft",
     POSTER, "      autoPost: true,", "      autoPost: false,"),
    ("20 the journal id is overwritten even when already set",
     POSTER, "  if (journalId && !bag.seal_journal_id) {", "  if (journalId && !bag.seal_journal_id && false) {"),
    ("21 a failed read is treated as a missing bag",
     POSTER, '  if (error) return { kind: "failed", bagId, sourceRef: null, code: "READ_FAILED"',
     '  if (error) return { kind: "refused", bagId, code: "READ_FAILED"'),

    # ── the actions (DOOR) ────────────────────────────────────────────────
    ("22 DOOR  the seal action stops calling the poster",
     ACTIONS, "  const post = await postSealForBag(bag.id);", "  const post = { kind: \"failed\" as const, bagId: bag.id, sourceRef: null, code: \"X\", message: \"x\" };"),
    ("23 the bank run is open to any staff",
     ACTIONS, "export async function bankRunAction(formData: FormData): Promise<void> {\n  const session = await requireBooksAccess();",
     "export async function bankRunAction(formData: FormData): Promise<void> {\n  const session = await requirePermission(\"orders.manage\");"),
    ("24 a same-person recount attempt is not audited",
     ACTIONS, '        action: "deposit_bag.recount_refused",\n        entityType: "deposit_bag",\n        entityId: bag.id,\n        after: { bagNo: bag.bagNo, reason: "same_person_as_night_count"',
     '        action: "deposit_bag.other",\n        entityType: "deposit_bag",\n        entityId: bag.id,\n        after: { bagNo: bag.bagNo, reason: "same_person_as_night_count"'),
    ("25 the seal is saved before it is checked",
     ACTIONS, "  const chk = checkSeal(bag, { bagNo: str(formData, \"seal_bag_no\") || bag.bagNo, sealerId: sealer.id });\n  if (!chk.ok) fail(chk.error);\n\n  const saved = await saveSeal(",
     "  const saved0 = await saveSeal({ bagId: bag.id, bagNo: bag.bagNo, amountMinor: 0, sealerId: sealer.id });\n  const chk = checkSeal(bag, { bagNo: str(formData, \"seal_bag_no\") || bag.bagNo, sealerId: sealer.id });\n  if (!chk.ok) fail(chk.error);\n\n  const saved = await saveSeal("),
    ("26 the PIN throttle is skipped",
     ACTIONS, "  const locked = await pinPadBlocked(DEPOSIT_BAG_PIN_SCOPE);", "  const locked = null as string | null;"),

    # ── the screens (DOOR) ────────────────────────────────────────────────
    ("27 DOOR  the screen stops rendering the seal form",
     PAGE, 'name="seal_pin"', 'name="seal_pin_gone"'),
    ("28 the screen shows the night figure to the morning recounter",
     PAGE, "const shown = showNightFigure(b);", "const shown = true;"),
    ("29 DOOR  Register Activity loses the Deposit bags button",
     ACTIVITY, "            <Button href={`${BASE}/deposit-bags`} variant=\"neutral\" size=\"sm\">",
     "            <Button href={`${BASE}/safe`} variant=\"neutral\" size=\"sm\">"),
    ("30 Register Activity stops warning about undeclared bags",
     ACTIVITY, "  const undeclaredWarning = undeclaredBagWarning(", "  const undeclaredWarning = null && undeclaredBagWarning("),

    # ── D27 and the census ────────────────────────────────────────────────
    ("31 D27  the undeclared warning goes silent",
     SAFE, "  if (open.length === 0) return null;", "  if (true) return null;"),
    ("32 census claims the seal unreachable",
     CENSUS, '        status: "PRESENT",\n        evidence:\n          "Fix Phase 2.6 (G-04, G-14): until then no screen sealed a bag.',
     '        status: "MISSING",\n        evidence:\n          "Fix Phase 2.6 (G-04, G-14): until then no screen sealed a bag.'),
]


def run_tests() -> bool:
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        hits = original.count(find)
        # Rule 137: exactly one, or this is not a probe.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}", flush=True)
            else:
                caught += 1
                print(f"  caught    {label}", flush=True)
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
