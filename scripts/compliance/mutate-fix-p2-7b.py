"""
scripts/compliance/mutate-fix-p2-7b.py

Fix Phase 2.7b (G-02 master till <-> little safe exchange, owner D3; F-00-7;
F-01-8 register swap bills both ways). Rule 13c: a test that cannot fail is
worse than no test. This breaks the 2.7b work on purpose, one edit at a
time, and demands that the suite NOTICE.

Rule 133g: several mutations SEVER THE DOOR (the action stops checking the
PIN, the sides stop being compared, the database stops refusing unequal
sides, the swap retry starts swallowing every error).
Rule 137: every anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-7b.py
"""
import io
import subprocess
import sys

CORE = "src/lib/registers/little-safe-core.ts"
MT = "src/lib/registers/master-till-core.ts"
TILL = "src/lib/pos/till-core.ts"
STORE = "src/lib/registers/safe-store.ts"
ACTIONS = "src/app/admin/registers/safe/actions.ts"
PAGE = "src/app/admin/registers/safe/page.tsx"
SHEET = "src/app/admin/registers/safe/sheet/page.tsx"
ROUTE = "src/app/admin/registers/safe/export/route.ts"
FORM = "src/components/admin/registers/LittleSafeExchangeForm.tsx"
TILL_ROUTE = "src/app/api/pos/till/route.ts"
SHELL = "src/app/(site)/pos/RegisterShell.tsx"
MIG = "supabase/migrations/0317_little_safe_exchanges.sql"
RESET = "src/lib/accounting/factory-reset-core.ts"

TESTS = [
    "tests/compliance/fix-p2-7b-little-safe.test.ts",
    "tests/compliance/fix-p2-7a-master-till.test.ts",
    "tests/compliance/till-core.test.ts",
    "tests/compliance/factory-reset-core.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # pure rules
    ("readDenoms: fractions accepted", CORE, "    if (!/^\\d+$/.test(s)) return", "    if (false) return"),
    ("readDenoms: no piece cap", CORE, "    if (n > EXCHANGE_MAX_PIECES) return", "    if (false) return"),
    ("exchange: empty OUT side accepted", CORE, "  if (outMinor <= 0) {\n", "  if (false) {\n"),
    ("exchange: empty IN side accepted", CORE, "  if (inMinor <= 0) {\n", "  if (false) {\n"),
    ("exchange: unequal sides accepted (door)", CORE, "  if (outMinor !== inMinor) {\n", "  if (false) {\n"),
    ("exchange: no $2,000 cap", CORE, "  if (outMinor > MAX_SWAP_MINOR) {\n", "  if (false) {\n"),
    ("exchange: notes not capped", CORE, "  if (notes.length > SAFE_NOTES_MAX_LEN) {\n", "  if (false) {\n"),
    ("exchange: value from IN side + 1", CORE, "valueMinor: outMinor, notes: notes || null", "valueMinor: outMinor + 1, notes: notes || null"),
    ("swap bills: one side only accepted", CORE,
     "  if (none(inRaw) || none(outRaw) || typeof inRaw",
     "  if (false && (none(inRaw) || none(outRaw)) || typeof inRaw"),
    ("swap bills: IN not checked against amount", CORE, "  if (inMinor !== amountMinor) {\n", "  if (false) {\n"),
    ("swap bills: OUT not checked against amount", CORE, "  if (outMinor !== amountMinor) {\n", "  if (false) {\n"),
    ("swap words: value-only label lost", CORE,
     '  if (!a || !b) return { inWords: VALUE_ONLY_WORDS, outWords: VALUE_ONLY_WORDS };',
     '  if (!a || !b) return { inWords: "", outWords: "" };'),
    ("denomWords: zero rows listed", CORE, "Math.floor(Number(d[f.key] ?? 0)) > 0", "Math.floor(Number(d[f.key] ?? 0)) >= 0"),
    ("till-core: bills not checked", TILL, "    if (!bills.ok) return { ok: false, error: bills.error };", ""),
    # workbook
    ("workbook: Exchanges sheet dropped", MT, "      exchangesSheet(exchanges),\n", ""),
    ("workbook: exchange total wrong", MT,
     "value: exchanges.reduce((a, e) => a + e.valueMinor, 0) / 100",
     "value: exchanges.length"),
    # store
    ("store: exchange business day missing", STORE, "      business_day: businessDayFor(now),\n", ""),
    ("store: pre-0317 exchange shown as saved", STORE,
     "    if (isMissingTable(error)) return { ok: false, error: EXCHANGE_MIGRATION_HINT };",
     "    if (isMissingTable(error)) return { ok: true, id: null };"),
    ("store: sides-equal refusal raw", STORE,
     "    if (/little_safe_exchanges_sides_equal/.test(error.message ?? \"\")) {",
     "    if (false) {"),
    ("store: swap retry swallows every error (door)", STORE,
     "    if (hasBills && isMissingSwapDenoms(error)) {",
     "    if (hasBills) {"),
    ("store: swap bills never sent", STORE,
     "  const hasBills = !!opts.inDenoms && !!opts.outDenoms;",
     "  const hasBills = false;"),
    ("store: exchange log not tiebroken", STORE,
     "      .from(\"little_safe_exchanges\")\n      .select(\"*\")\n      .gte(\"business_day\", from)\n      .lte(\"business_day\", to)\n      .order(\"occurred_at\", { ascending: false })\n      .order(\"id\", { ascending: true })",
     "      .from(\"little_safe_exchanges\")\n      .select(\"*\")\n      .gte(\"business_day\", from)\n      .lte(\"business_day\", to)\n      .order(\"occurred_at\", { ascending: false })"),
    ("store: failed exchange read reported complete", STORE,
     "    return { ready: true, exchanges: read.rows, error: firstError ?? read.verdict.message };",
     "    return { ready: true, exchanges: read.rows, error: null };"),
    # action
    ("action: managers only", ACTIONS,
     "export async function recordLittleSafeExchangeAction(formData: FormData): Promise<void> {\n  const session = await requirePermission(\"orders.manage\");",
     "export async function recordLittleSafeExchangeAction(formData: FormData): Promise<void> {\n  const session = await requirePermission(\"inventory.manage\");"),
    ("action: sides never compared (door)", ACTIONS,
     "  const v = validateExchange({ outDenoms, inDenoms, notes: str(formData, \"exchange_notes\") });\n  if (!v.ok) fail(v.error);",
     "  const v = validateExchange({ outDenoms, inDenoms: outDenoms, notes: str(formData, \"exchange_notes\") });\n  if (!v.ok) fail(v.error);"),
    ("action: no PIN accepted (door)", ACTIONS,
     "  if (!pin) fail(\"Enter your PIN (the employee who did the exchange). Nothing was saved.\");",
     ""),
    ("action: lock ignored", ACTIONS,
     "  const locked = await pinPadBlocked(LITTLE_SAFE_PIN_SCOPE);\n  if (locked) fail(locked);",
     "  await pinPadBlocked(LITTLE_SAFE_PIN_SCOPE);"),
    ("action: unknown PIN saves (door)", ACTIONS,
     "    fail(\"No active employee has that PIN. The exchange must be recorded by an active employee. Nothing was saved.\");",
     "    return;"),
    ("action: audit drops the recorder", ACTIONS, "      recorded_by_name: who.full_name,\n", ""),
    ("action: audit drops the OUT side", ACTIONS, "      out_of_master_till: denomWords(ex.outDenoms),\n", ""),
    ("action: wrong throttle scope", ACTIONS,
     "  await notePinSuccess(LITTLE_SAFE_PIN_SCOPE);\n  const who",
     "  await notePinSuccess(SAFE_COUNT_PIN_SCOPE);\n  const who"),
    # migration
    ("0317: database stops checking sides (door)", MIG,
     "    coalesce(public.cash_denoms_total_minor(out_denoms), -1) = value_minor\n    and coalesce(public.cash_denoms_total_minor(in_denoms), -1) = value_minor",
     "    true"),
    ("0317: fractional counts allowed", MIG, "n < 0 or n > 99999 or n <> trunc(n)", "n < 0 or n > 99999"),
    ("0317: not append-only", MIG, "  before update or delete on public.little_safe_exchanges", "  before delete on public.little_safe_exchanges"),
    ("0317: everyone can read", MIG, "  for select using (public.is_manager());", "  for select using (true);"),
    ("0317: swap bills unchecked", MIG,
     "      coalesce(public.cash_denoms_total_minor(in_denoms), -1) = amount_minor\n",
     "      true\n"),
    # screens
    ("page: exchange form hidden", PAGE, "            <LittleSafeExchangeForm action={recordLittleSafeExchangeAction} />\n", ""),
    ("page: log read for every login", PAGE,
     "    canManage && range.ok ? listLittleSafeExchangesRange(range.from, range.to)",
     "    range.ok ? listLittleSafeExchangesRange(range.from, range.to)"),
    ("page: failed log read hidden", PAGE,
     "    exchangesRes.error ? `Little safe exchanges could not all be read: ${exchangesRes.error}` : null,\n", ""),
    ("form: submit when unequal", FORM, "disabled={!equal || busy}", "disabled={busy}"),
    ("form: PIN field renamed", FORM, 'name="exchange_pin"', 'name="pin"'),
    ("sheet: exchanges not read", SHEET, "listLittleSafeExchangesRange(", "listSafeCountsRange("),
    ("route: exchanges not exported", ROUTE,
     "exportResponse(safeSheetWorkbook(range, counts, swaps, exchanges)",
     "exportResponse(safeSheetWorkbook(range, counts, swaps)"),
    ("till route: bills not in audit", TILL_ROUTE, "        bills_in: till.inDenoms ? denomWords(till.inDenoms) : null,\n", ""),
    ("till route: bills not stored", TILL_ROUTE,
     "      inDenoms: till.inDenoms ? compactDenoms(till.inDenoms) : null,",
     "      inDenoms: null,"),
    ("iPad: unequal swap can be sent", SHELL,
     "amountMinor !== null && swapOutMinor === swapInMinor && approverPin.length >= 4",
     "amountMinor !== null && approverPin.length >= 4"),
    ("iPad: bills not sent", SHELL, "                inDenoms: swapIn,\n", ""),
    # factory reset
    ("reset: exchanges wiped", RESET,
     '  { table: "little_safe_exchanges", disposition: "KEEP",',
     '  { table: "little_safe_exchanges", disposition: "WIPE",'),
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
