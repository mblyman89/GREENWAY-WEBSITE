"""
scripts/compliance/mutate-fix-p3-1.py

Fix Phase 3.1 (G-16, F-04-1): receive part of a line ("18 of 20").
Owner, verbatim:
  "So we need the ability to tell the system that we are only accepting a
   part of the manifest and the rest was rejected. There are several
   instances where the vendor forgot to send an item, or it broke in
   transit, etc." (docs/ccrs-rejection-and-returns.md L15-21)
  D29: "we need a way to accept less than what came in, please add this to
       the list of serious issues to fix"
  Owner message 6: "please begin work on phase 3, receiving: accept "18 of 20""

Rule 13c: a test that cannot fail is worse than no test. Rule 137: every
anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p3-1.py
"""
import io
import subprocess
import sys

CORE = "src/lib/inventory/intake-count-core.ts"
STORE = "src/lib/inventory/intake-store.ts"
LABEL = "src/lib/inventory/finalize-label-core.ts"
ACT = "src/app/admin/inventory/intake/actions.ts"
PAGE = "src/app/admin/inventory/intake/[id]/page.tsx"
COMP = "src/components/admin/inventory/ManifestLotDisposition.tsx"

TESTS = [
    "tests/compliance/fix-p3-1-partial-receive.test.ts",
    "tests/compliance/r31-manifest-review-walk.test.tsx",
]

# (label, file, find, replace)
MUTATIONS = [
    # --- the pure rules
    ("core: an overage is received", CORE,
     "  if (counted > shipped) {", "  if (counted > shipped + 1e9) {"),
    ("core: counted 0 is a short line, not a refusal", CORE,
     '  if (counted === 0) return { ok: true, kind: "refuse_whole", shipped, reasonCode: code, reasonText };',
     "  // zero refusal removed"),
    ("core: no reason needed", CORE,
     "  if (!isShortReasonCode(code)) {", "  if (false && !isShortReasonCode(code)) {"),
    ("core: Other needs no text", CORE,
     '  if (code === "other" && !text) {', "  if (false) {"),
    ("core: a finalized line can be counted", CORE,
     '  if (line.status !== "quarantine" && line.status !== "pending") {', "  if (false) {"),
    ("core: a refused line can be counted", CORE,
     '  if (line.disposition === "rejected_at_dock") {\n    return {\n      ok: false,\n      code: "refused_line",',
     '  if (false) {\n    return {\n      ok: false,\n      code: "refused_line",'),
    ("core: fractions of whole units accepted", CORE,
     "  if (Number.isInteger(shipped) && !Number.isInteger(counted)) {", "  if (false) {"),
    ("core: equal count does not clear", CORE,
     '    return { ok: true, kind: "clear", shipped };', '    return { ok: false, code: "same_as_now", error: "x" };'),
    ("core: refused quantity wrong", CORE,
     "refused: q(shipped - counted),", "refused: q(shipped),"),
    ("core: a short line does not make the delivery partial", CORE,
     '  if (status === "accepted" && shortGoingIn > 0) return "partially_accepted";', "  // partial rule removed"),
    ("core: adjustment note drops the count", CORE,
     "at the dock count: ${fmtCountQty(shortLine.counted)} of ${fmtCountQty(shortLine.shipped)} shipped",
     "at the dock count"),
    # --- the store
    ("store: short count does not keep the manifest quantity", STORE,
     "      shipped_qty: plan.shipped,\n      short_reason_code: plan.reasonCode,",
     "      shipped_qty: null,\n      short_reason_code: plan.reasonCode,"),
    ("store: short count does not lower on_hand", STORE,
     "      received_qty: plan.counted,\n      on_hand_qty: plan.counted,",
     "      received_qty: plan.counted,\n      on_hand_qty: plan.shipped,"),
    ("store: no race guard on the count", STORE,
     '    .eq("received_qty", receivedBefore)\n    .select("id");', '    .select("id");'),
    ("store: missing 0319 reported as success", STORE,
     "  if (!written || (written as unknown[]).length !== 1) {", "  if (false) {"),
    ("store: refusal keeps the short count", STORE,
     "    const back = await restoreShippedQtyOnRefusal(admin, [lotId], actorId);",
     "    const back = { error: null as string | null };"),
    ("store: whole-manifest refusal keeps the short count", STORE,
     '      rows.filter((r) => r.status !== "active" && r.status !== "sold_out").map((r) => r.id),',
     "      [],"),
    ("store: restore may touch a finalized lot", STORE,
     '      .eq("id", r.id)\n      .not("status", "in", "(active,sold_out)");',
     '      .eq("id", r.id);'),
    ("store: finalize ignores a failed count read", STORE,
     '  if (shortRead.kind === "error") {\n    return { ok: false, error: `The dock counts could not be read',
     '  if (false) {\n    return { ok: false, error: `The dock counts could not be read'),
    ("store: a refused short line still counts as short", STORE,
     '    if (!s || r.disposition === "rejected_at_dock") continue;', "    if (!s) continue;"),
    ("store: the adjustment note ignores the count", STORE,
     "        note: receiveAdjustmentNote(shortForLot(lotId)),", "        note: receiveAdjustmentNote(null),"),
    ("store: the timeline drops the short summary", STORE,
     "refused at dock.${finalizeShortSummary(shortGoingIn)}", "refused at dock."),
    # --- the label and the wiring
    ("label: short lines do not need the note", LABEL,
     "    if (l.shortCounted) short += 1;", "    // short count removed"),
    ("action: no permission check", ACT,
     'export async function setLotDockCountAction(manifestId: string, lotId: string, formData: FormData) {\n  const session = await requirePermission("inventory.manage");',
     'export async function setLotDockCountAction(manifestId: string, lotId: string, formData: FormData) {\n  const session = { userId: "x" };'),
    ("page: button shown before 0319", PAGE,
     'const countOn = shortCounts.kind === "loaded";', "const countOn = true;"),
    ("page: button plan ignores short lines", PAGE,
     "      shortCounted: shortByLot.has(l.id),", "      shortCounted: false,"),
    ("component: no Count short button", COMP,
     "      data-count-short={lotId}", "      data-count-gone={lotId}"),
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
