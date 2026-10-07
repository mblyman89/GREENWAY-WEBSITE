#!/usr/bin/env python3
"""
S-12c TypeScript mutation harness: "test the tests".

Each mutant is ONE exact edit to an S-12c source file (the old text must occur
exactly once, otherwise the harness stops: a mutant that silently matches
nothing proves nothing). For every mutant the S-12c vitest file (which also
runs the embedded __run*Tests self-tests) must go RED. A surviving mutant is a
hole in the tests and the script exits 1.

The file is always restored from an in-memory copy in a finally-block.

Usage:  python3 scripts/ccrs-bible/mutate_s12c_ts.py
"""
from __future__ import annotations

import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEST = "tests/compliance/s12c-ccrs-upload-lifecycle.test.ts"
LIFE = "src/lib/compliance/ccrs-lifecycle-core.ts"
OUTC = "src/lib/compliance/ccrs-outcome-core.ts"
PANEL = "src/components/admin/compliance/CcrsFilesPanel.tsx"
OUTBOX = "src/lib/compliance/ccrs-outbox-core.ts"

MUTANTS: list[tuple[str, str, str, str]] = [
    # --- lifecycle core: Pacific time ---
    ("hour 24 accepted", LIFE, "h > 23 ||", "h > 24 ||"),
    ("month 13 accepted", LIFE, "mo > 12 ||", "mo > 13 ||"),
    ("Feb 30 accepted", LIFE, "if (d > dim) return null;", "if (d > dim + 1) return null;"),
    # --- success email parsing ---
    ("12 AM not midnight", LIFE, "const h = (h12 % 12) + (pm ? 12 : 0);", "const h = h12 + (pm ? 12 : 0);"),
    ("PM ignored", LIFE, "(pm ? 12 : 0)", "(pm ? 0 : 0)"),
    ("date read from whole paste", LIFE, "const to = i + 1 < hits.length ? hits[i + 1].at : pasted.length;", "const to = pasted.length;"),
    ("date read before the name", LIFE, "const from = hits[i].end;", "const from = 0;"),
    # --- matching ---
    ("tolerance widened", LIFE, "export const UPLOAD_TIME_TOLERANCE_MINUTES = 15;", "export const UPLOAD_TIME_TOLERANCE_MINUTES = 90;"),
    ("not-waiting files recorded", LIFE, 'else if (f.state !== "uploaded" || !f.uploadedAt)', 'else if (!f.uploadedAt)'),
    ("record order reversed", LIFE, "(stamp(a.id) < stamp(b.id) ? -1 : stamp(a.id) > stamp(b.id) ? 1 : 0)", "(stamp(a.id) < stamp(b.id) ? 1 : stamp(a.id) > stamp(b.id) ? -1 : 0)"),
    # --- decoders ---
    ("mark: override flag unchecked", LIFE, 'need(data.overridden === (data.waiting_on as string[]).length > 0, fn, "overridden disagrees with waiting_on");', ""),
    ("outcome: any state", LIFE, '(OUTCOME_FINAL_STATES[outcome] ?? []).includes(data.state)', 'true'),
    ("outcome: counts unchecked", LIFE, "r.rejected + r.uncertain + r.landed <= r.total", "true"),
    ("outcome: outcome unchecked", LIFE, 'need(data.outcome === outcome, fn, "another outcome");', ""),
    ("outcome: fatal may land", LIFE, 'if (outcome === "error-fatal") need(r.landed === 0, fn, "a fatal file landed rows");', ""),
    ("abandon: state unchecked", LIFE, 'data.state === "abandoned" &&', ""),
    ("error text: hints dropped", LIFE, "return hint ? `${hint} (${m[2].trim() || m[1]})` : raw;", "return raw;"),
    # --- portal URLs ---
    ("preprod url = prod", LIFE, 'preprod: "https://precannabisreporting.lcb.wa.gov/"', 'preprod: "https://cannabisreporting.lcb.wa.gov/"'),
    # --- outcome core: classifyEcho ---
    ("longest match not preferred", OUTC, "m.text.length > best.text.length", "m.text.length < best.text.length"),
    ("twice-listed row allowed", OUTC, "if (seenRow.has(rowNo)) {", "if (false) {"),
    ("fatal not fatal", OUTC, 'if (out.some((l) => l.cls === "file-fatal")) {', "if (false) {"),
    ("unknown message guessed", OUTC, "if (unknown.length > 0 || unmatched.length > 0) {", "if (unmatched.length > 0) {"),
    ("ledger contradiction certain", OUTC, 'uncertain: l.cls === "row-contradicts-ledger"', "uncertain: false"),
    ("benign never benign", OUTC, "if (rejected.length === 0) {", "if (false) {"),
    ("no-email at 59 min", OUTC, "now.getTime() >= noEmailAllowedAt(uploadedAt).getTime()", "now.getTime() + 60_000 >= noEmailAllowedAt(uploadedAt).getTime()"),
    ("SLA 30 min", OUTC, "export const CCRS_EMAIL_SLA_MINUTES = 60;", "export const CCRS_EMAIL_SLA_MINUTES = 30;"),
    ("emitted cannot abandon", OUTC, 'return ["download", "mark-uploaded", "abandon"];', 'return ["download", "mark-uploaded"];'),
    ("sale id column wrong", OUTC, '"SaleDetailExternalIdentifier"', '"ExternalIdentifier"'),
    # --- outbox README ---
    ("preprod README unmarked", OUTBOX, "PREPROD TEST SITE, not production", "test site"),
]


def run_tests() -> bool:
    r = subprocess.run(["npx", "vitest", "run", TEST], cwd=REPO, capture_output=True, text=True, timeout=300)
    return r.returncode == 0


def main() -> int:
    if not run_tests():
        print("BASELINE RED: fix the tests before mutating")
        return 2
    survived, killed = [], 0
    for name, rel, old, new in MUTANTS:
        p = os.path.join(REPO, rel)
        src = open(p, encoding="utf8").read()
        count = src.count(old)
        if count != 1:
            print(f"BAD MUTANT ({count} matches): {name}")
            return 2
        try:
            open(p, "w", encoding="utf8").write(src.replace(old, new, 1))
            if run_tests():
                survived.append(name)
                print(f"SURVIVED  {name}")
            else:
                killed += 1
                print(f"killed    {name}")
        finally:
            open(p, "w", encoding="utf8").write(src)
    print(f"\n{killed}/{len(MUTANTS)} killed")
    if survived:
        print("SURVIVORS: " + "; ".join(survived))
        return 1
    print("S-12c TS MUTATION: ALL KILLED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
