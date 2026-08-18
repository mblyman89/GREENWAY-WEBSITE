#!/usr/bin/env python3
"""
scripts/compliance/mutate-slice-books-07.py

MUTATION TESTING FOR THE GUIDANCE LAYER (slice books-07).

Standing rule 15: EVERY TEST MUST BE PROVEN CAPABLE OF FAILING. A test suite
that has never been shown to fail is a decoration.

This slice's product is TEXT THAT CLAIMS LEGAL AUTHORITY. The failure that
matters here is not a wrong number — it is a quote that has been silently
altered, a citation that has drifted, or a screen that stops flagging what it
promised to flag. None of those crash. All of them mislead, quietly, in front
of the IRS. So each mutation below breaks exactly ONE guarantee and asserts the
suite notices.

Michael asked whether we could go lighter on testing for this slice since the
surrounding areas are already battle-tested. We went lighter where the risk is
low (no new migration, no new live-PostgreSQL suite — there is no new RLS or
SQL in this slice to prove). We did NOT go lighter here, because this is the
one place where a silent edit is both undetectable by eye and legally material.

Run:  python3 scripts/compliance/mutate-slice-books-07.py
Exit: 0 = every mutation was caught. Non-zero = a test cannot fail.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CORE = REPO / "src/lib/accounting/books-guidance-core.ts"
RUNNER = REPO / "scripts/tmp/_mutation-runner.ts"

RUNNER_SRC = """import { __runBooksGuidanceCoreTests } from "../../src/lib/accounting/books-guidance-core";
__runBooksGuidanceCoreTests();
console.log("PASS");
"""


@dataclass(frozen=True)
class Mutation:
    name: str
    # What guarantee this breaks, in plain English.
    breaks: str
    old: str
    new: str


MUTATIONS: list[Mutation] = [
    Mutation(
        name="quote-drift-silently-accepted",
        breaks="The paraphrased CCA text (which does not appear in the source document) wins the merge.",
        old='    id: "CCA_201504011",\n    field: "quote",\n    winner: "vendor-bill",',
        new='    id: "CCA_201504011",\n    field: "quote",\n    winner: "payroll",',
    ),
    Mutation(
        name="quote-drift-downgraded-to-warning",
        breaks="A citation saying two different things becomes a warning instead of an error.",
        old='  quote: "error",\n  kind: "error",',
        new='  quote: "warn",\n  kind: "error",',
    ),
    Mutation(
        name="kind-drift-not-checked",
        breaks="Legal WEIGHT drift stops being detected, so a Senate Report can claim to be a statute.",
        old='export const DRIFT_CHECKED_FIELDS = ["quote", "kind", "cite"] as const;',
        new='export const DRIFT_CHECKED_FIELDS = ["quote", "cite"] as const;',
    ),
    Mutation(
        name="senate-report-reclassified-as-statute",
        breaks="Persuasive legislative history is presented with the binding force of law.",
        old='    id: "SENATE_REPORT_97_494",\n    field: "kind",\n    winner: "payroll",',
        new='    id: "SENATE_REPORT_97_494",\n    field: "kind",\n    winner: "vendor-bill",',
    ),
    Mutation(
        name="legislative-history-weighted-as-law",
        breaks="The weight table stops distinguishing persuasive material from binding law.",
        old='  legislative_history: 1,',
        new='  legislative_history: 3,',
    ),
    Mutation(
        name="drift-scanner-blinded",
        breaks="The scanner reports nothing, so all four registries appear to agree forever.",
        old="      if (new Set(values.map((v) => v.value)).size <= 1) continue;",
        new="      if (true) continue;",
    ),
    Mutation(
        name="irs-publication-promoted-to-law",
        breaks="IRS Publication 4557 is classified as a regulation — guidance masquerading as binding.",
        old='  if (/\\bIRS Publication\\b/i.test(c) || /\\bPub\\.\\s*\\d/i.test(c)) return "irs_guidance";',
        new='  if (false) return "irs_guidance";',
    ),
    Mutation(
        name="unknown-citation-gets-a-default",
        breaks="An unclassifiable citation silently acquires a plausible-looking legal weight.",
        old="  return null;\n}\n\nfunction fromGate",
        new='  return "regulation";\n}\n\nfunction fromGate',
    ),
    Mutation(
        name="unknown-authority-id-vanishes",
        breaks="A typo'd citation disappears from a list instead of showing as missing.",
        old="    .map((id) => findGuidanceAuthority(id)?.cite ?? `[unknown authority: ${id}]`)",
        new="    .map((id) => findGuidanceAuthority(id)?.cite ?? ``)",
    ),
    Mutation(
        name="trial-balance-claims-completeness",
        breaks='The page starts claiming a balanced trial balance proves every transaction is recorded.',
        old='    claim: "Every transaction that happened is in the books.",\n    proven: false,',
        new='    claim: "Every transaction that happened is in the books.",\n    proven: true,',
    ),
    Mutation(
        name="fingerprint-screen-goes-quiet",
        breaks="The AS 2401.61 screen stops flagging anything at all.",
        old="export function screenForFingerprints(input: FingerprintInput): readonly Fingerprint[] {\n  const out: Fingerprint[] = [];",
        new="export function screenForFingerprints(input: FingerprintInput): readonly Fingerprint[] {\n  if (input) return [];\n  const out: Fingerprint[] = [];",
    ),
    Mutation(
        name="month-end-off-by-one",
        breaks="Month-end detection shifts by a day, so period-end entries stop being flagged.",
        old="  return d === dim;",
        new="  return d === dim - 1;",
    ),
    Mutation(
        name="leap-year-forgotten",
        breaks="February month-end is wrong every leap year.",
        old="  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;\n  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];\n  return d === dim;",
        new="  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];\n  return d === dim;",
    ),
    Mutation(
        name="round-number-check-inverted",
        breaks="Round amounts stop being flagged and fiddly ones get flagged instead.",
        old="  return cents !== 0 && Math.abs(cents) % 100 === 0;",
        new="  return cents !== 0 && Math.abs(cents) % 100 !== 0;",
    ),
    Mutation(
        name="thin-memo-accepted",
        breaks="An entry with no explanation at all stops being questioned.",
        old="export const THIN_MEMO_CHARS = 15;",
        new="export const THIN_MEMO_CHARS = 0;",
    ),
    Mutation(
        name="seldom-used-threshold-disabled",
        breaks="Never-before-used accounts stop being flagged.",
        old="export const SELDOM_USED_THRESHOLD = 3;",
        new="export const SELDOM_USED_THRESHOLD = -1;",
    ),
    Mutation(
        name="two-line-entries-fire-consistent-ending",
        breaks="The .61(e) check fires on ordinary two-line entries, training the owner to ignore it.",
        old="  if (input.lines.length >= 3) {",
        new="  if (input.lines.length >= 2) {",
    ),
    Mutation(
        name="mentor-sequence-scrambled",
        breaks="The journal steps stop starting with the source document.",
        old='    action: "Find the piece of paper first — the receipt, the invoice, the statement, the photo of the receipt.",',
        new='    action: "Pick an account from the chart that looks about right for this.",',
    ),
    Mutation(
        name="accusatory-tone-introduced",
        breaks="The screen starts accusing the owner instead of asking him a question.",
        old='      question: "Is this a real measured amount, or an estimate someone tidied up?",',
        new='      question: "This looks suspicious and may be fraud.",',
    ),
    Mutation(
        name="known-defect-list-quietly-emptied",
        breaks="The two real defects found in other modules stop being reported to the owner.",
        old="  return DIVERGENCE_RULINGS.filter((r) => r.losingRegistryIsDefective);",
        new="  return [];",
    ),
]


def run_tests() -> tuple[bool, str]:
    """Returns (passed, output)."""
    proc = subprocess.run(
        ["npx", "tsx", str(RUNNER)],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=300,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    return ("PASS" in proc.stdout and proc.returncode == 0), out


def main() -> int:
    original = CORE.read_text()
    RUNNER.parent.mkdir(parents=True, exist_ok=True)
    RUNNER.write_text(RUNNER_SRC)

    with tempfile.TemporaryDirectory() as tmp:
        backup = Path(tmp) / "books-guidance-core.ts"
        shutil.copy2(CORE, backup)

        print("=" * 78)
        print("BASELINE: the suite must PASS before any mutation is meaningful.")
        print("=" * 78)
        passed, out = run_tests()
        if not passed:
            print("BASELINE FAILED — fix the suite before mutating.\n")
            print(out[-3000:])
            return 1
        print("baseline: PASS\n")

        survivors: list[Mutation] = []
        not_applied: list[Mutation] = []

        for i, m in enumerate(MUTATIONS, start=1):
            text = original
            if text.count(m.old) != 1:
                not_applied.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: ANCHOR NOT UNIQUE "
                      f"(found {text.count(m.old)}) — mutation could not be applied")
                continue

            CORE.write_text(text.replace(m.old, m.new))
            try:
                passed, out = run_tests()
            finally:
                shutil.copy2(backup, CORE)

            if passed:
                survivors.append(m)
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: *** SURVIVED *** — {m.breaks}")
            else:
                first = next(
                    (ln.strip() for ln in out.splitlines() if "FAILED" in ln or "Error:" in ln),
                    "(no message captured)",
                )
                print(f"[{i:2d}/{len(MUTATIONS)}] {m.name}: caught")
                print(f"          breaks : {m.breaks}")
                print(f"          caught by: {first[:150]}")

        # Restore, and PROVE the restore worked rather than assuming it.
        CORE.write_text(original)
        passed, _ = run_tests()

    RUNNER.unlink(missing_ok=True)

    print()
    print("=" * 78)
    print(f"applied     : {len(MUTATIONS) - len(not_applied)}/{len(MUTATIONS)}")
    print(f"caught      : {len(MUTATIONS) - len(not_applied) - len(survivors)}")
    print(f"SURVIVED    : {len(survivors)}")
    print(f"not applied : {len(not_applied)}")
    print(f"restored+green: {passed}")
    print("=" * 78)

    if not_applied:
        print("\nMUTATIONS THAT COULD NOT BE APPLIED (anchor text moved — fix the anchor):")
        for m in not_applied:
            print(f"  - {m.name}")
    if survivors:
        print("\nSURVIVORS — these are UNTESTED guarantees:")
        for m in survivors:
            print(f"  - {m.name}: {m.breaks}")

    return 0 if (not survivors and not not_applied and passed) else 1


if __name__ == "__main__":
    sys.exit(main())
