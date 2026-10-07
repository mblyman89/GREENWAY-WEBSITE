#!/usr/bin/env python3
"""
S-13 TypeScript mutation harness: "test the tests".

Each mutant is ONE exact edit to an S-13 source file (the old text must occur
exactly once, otherwise the harness stops: a mutant that silently matches
nothing proves nothing). For every mutant the S-13 vitest files must go RED.
A surviving mutant is a hole in the tests and the script exits 1.

The file is always restored from an in-memory copy in a finally-block.

Usage:  python3 scripts/ccrs-bible/mutate_s13_ts.py
"""
from __future__ import annotations

import os
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TESTS = ["tests/compliance/s13-ccrs-areas.test.ts", "tests/compliance/p02-area-probe.test.ts"]
CORE = "src/lib/compliance/ccrs-area-core.ts"
BATCH = "src/lib/compliance/ccrs-batch.ts"
PRE = "src/lib/compliance/ccrs-preflight-core.ts"
P02 = "scripts/compliance/generate-p02-area-probe.ts"

MUTANTS: list[tuple[str, str, str, str]] = [
    # --- D-03 config ---
    ("prod mode delete", CORE, '  mode: "update-only",\n}) as AreaPlanConfig;', '  mode: "delete",\n}) as AreaPlanConfig;'),
    ("keep id dropped", CORE, '"C1100011", "C1100012", "C1100013", "C1100014"]', '"C1100011", "C1100012", "C1100013"]'),
    ("retire A65303 dropped", CORE, 'retire: Object.freeze(["A65303", ', 'retire: Object.freeze(['),
    ("prod not frozen", CORE, "export const PROD_AREA_PLAN: AreaPlanConfig = Object.freeze({", "export const PROD_AREA_PLAN: AreaPlanConfig = ({"),
    ("preprod gets prod plan", CORE, 'return env === "prod" ? PROD_AREA_PLAN : PREPROD_AREA_PLAN;', "return PROD_AREA_PLAN;"),
    # --- slug ---
    ("slug no collapse", CORE, '.replace(/[^A-Z0-9]+/g, "-")', '.replace(/[^A-Z0-9]/g, "-")'),
    ("slug no trim", CORE, '.replace(/^-+|-+$/g, "")', ""),
    ("slug empty ok", CORE, "if (!slug) throw new Error", "if (false) throw new Error"),
    ("prefix GWA", CORE, "return `GWA-${slug}`;", "return `AREA-${slug}`;"),
    # --- row shape ---
    ("quarantine TRUE", CORE, '[license, name, "FALSE", id, by, date, "", "", op] : [license, name, "FALSE", id, by, date, by, date, op]', '[license, name, "FALSE", id, by, date, "", "", op] : [license, name, "TRUE", id, by, date, by, date, op]'),
    ("insert quarantine TRUE", CORE, 'op === "Insert" ? [license, name, "FALSE"', 'op === "Insert" ? [license, name, "TRUE"'),
    ("update no UpdatedBy", CORE, '[license, name, "FALSE", id, by, date, by, date, op]', '[license, name, "FALSE", id, by, date, "", "", op]'),
    # --- legacy ---
    ("legacy prod inserts", CORE, "if (config.keep.length > 0) return { rows, inventoryAreaName: SALES_FLOOR_AREA, problems, summary };", ""),
    ("legacy no insert", CORE, "      rows.push(row(name, mintAreaId(name), \"Insert\"));\n      summary.inserts += 1;\n    }\n    return", "    }\n    return"),
    # --- overlap ---
    ("overlap allowed", CORE, "if (overlap.length) throw", "if (false) throw"),
    # --- retire loop ---
    ("deleted re-deleted", CORE, 'if (e?.state === "deleted") continue; // done', ""),
    ("retired absent ok", CORE, "    if (!e || !PRESENT.has(e.state)) {\n      problems.push({ severity: \"error\", id, detail: e ? `retired", "    if (!e) {\n      problems.push({ severity: \"error\", id, detail: e ? `retired"),
    ("retired missing silent", CORE, "detail: e ? `retired Area ${id} is in state \"${e.state}\"; reconcile it first` : `retired Area ${id} is not in the CCRS ledger` });\n      continue;", "detail: \"\" }) && 0;\n      continue;"),
    ("pending not set", CORE, "    summary.retirementPending = true;\n    if (config.mode", "    if (config.mode"),
    ("delete in update-only", CORE, 'if (config.mode === "delete") {\n      const r = routeOperation', 'if (true) {\n      const r = routeOperation'),
    ("delete count off", CORE, "      summary.deletes += 1;", ""),
    # --- keep loop ---
    ("kept unproven ok", CORE, "    if (!e || !PRESENT.has(e.state)) {\n      problems.push({ severity: \"error\", id, detail: e ? `kept", "    if (!e) {\n      problems.push({ severity: \"error\", id, detail: e ? `kept"),
    ("kept no name ok", CORE, "    if (!e.filedName) {", "    if (false) {"),
    ("refresh always", CORE, "    if (!summary.retirementPending) continue;", ""),
    ("refresh never", CORE, "    if (!summary.retirementPending) continue;", "    continue;"),
    ("update count off", CORE, "    summary.updates += 1;", ""),
    # --- needed names ---
    ("retired survives in delete", CORE, 'const survives = (id: string) => !(config.mode === "delete" && retireSet.has(id));', "const survives = (id: string) => true;"),
    ("retired never survives", CORE, 'const survives = (id: string) => !(config.mode === "delete" && retireSet.has(id));', "const survives = (id: string) => !retireSet.has(id);"),
    ("holder any state", CORE, "e.filedName === name && PRESENT.has(e.state) && survives(e.externalId)", "e.filedName === name && survives(e.externalId)"),
    ("unproven ignored", CORE, '(e) => e.filedName === name && (e.state === "uncertain" || e.state === "unknown")', "(e) => false"),
    ("id re-used", CORE, "for (let n = 2; entry(id) && n <= 99; n += 1)", "for (let n = 2; false && n <= 99; n += 1)"),
    ("suffix start 3", CORE, "for (let n = 2; entry(id)", "for (let n = 3; entry(id)"),
    ("dup warning off", CORE, "} else if (holders.length > 1 && !updatedHere.has(name)) {", "} else if (false) {"),
    ("dup warning even if refreshed", CORE, "} else if (holders.length > 1 && !updatedHere.has(name)) {", "} else if (holders.length > 1) {"),
    # --- held status ---
    ("recalled not held", CORE, 'return status === "quarantine" || status === "recalled";', 'return status === "quarantine";'),
    # --- wiring ---
    ("batch env prod always", BATCH, "config: areaPlanFor(env), license", 'config: areaPlanFor("prod"), license'),
    ("area issues dropped", BATCH, "...strain.issues, ...area.issues, ...product.issues", "...strain.issues, ...product.issues"),
    ("inventory area literal", BATCH, "    const area = areaName;", '    const area = "Sales Floor ";'),
    ("held advisory off", BATCH, "    if (isHeldLotStatus(l.status)) e45Rows.push(", "    if (false) e45Rows.push("),
    ("E45 blocking", BATCH, 'severity: "warning",\n      file: "Inventory",\n      code: "E45_HELD_LOT_NOT_AN_AREA",', 'severity: "error",\n      file: "Inventory",\n      code: "E45_HELD_LOT_NOT_AN_AREA",'),
    ("E46 pin", PRE, 'E46_AREA_LEDGER: "[G L0246-L0248]",', 'E46_AREA_LEDGER: "[G L0246]",'),
    ("E45 pin", PRE, 'E45_HELD_LOT_NOT_AN_AREA: "[G L0298-L0299]",', 'E45_HELD_LOT_NOT_AN_AREA: "[G L0298]",'),
    # --- P-02 generator ---
    ("p02 retire first", P02, '[areaIns(N.shared, N.keepId), areaIns(N.lone, N.loneId)]', '[areaIns(N.shared, N.retireId), areaIns(N.lone, N.loneId)]'),
    ("p02 update-only", P02, 'retire: [N.retireId, N.loneId], mode: "delete" }', 'retire: [N.retireId, N.loneId], mode: "update-only" }'),
    ("p02 no prefix", P02, "    lone: `${run} Probe Room`,", '    lone: "Probe Room",'),
    ("p02 same second", P02, "const d = at(sec++);", "const d = at(sec);"),
    ("p02 L03 expects ok", P02, '[inv("L03", N.lone, "Insert")], "Error: Invalid Area"', '[inv("L03", N.lone, "Insert")], OK'),
    ("p02 new id = deleted id", P02, "[areaIns(N.lone, N.newId)]", "[areaIns(N.lone, N.loneId)]"),
    ("p02 overwrite allowed", P02, "  if (existsSync(out)) {", "  if (false) {"),
    ("p02 bad run ok", P02, "  if (!RUN_RE.test(run)) throw", "  if (false) throw"),
]


def run_tests() -> bool:
    r = subprocess.run(["npx", "vitest", "run", *TESTS], cwd=REPO, capture_output=True, text=True, timeout=300)
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
                print(f"SURVIVED  {name}", flush=True)
            else:
                killed += 1
                print(f"killed    {name}", flush=True)
        finally:
            open(p, "w", encoding="utf8").write(src)
    print(f"\n{killed}/{len(MUTANTS)} killed")
    if survived:
        print("SURVIVORS: " + "; ".join(survived))
        return 1
    print("S-13 TS MUTATION: ALL KILLED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
