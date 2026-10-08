#!/usr/bin/env python3
"""
scripts/r28/mutate_panels_vitest.py

R28 - mutation loop for the lot / KB page actions, the rendered panels and
the server reader. Each mutant is applied to the source, the R28 vitest
suites (panels, server reader, identity-schema pins) are run, and the file is restored (finally). A mutant the suite still passes
SURVIVES - a gap in the tests. A snippet that is not found exactly once is
INVALID (the harness itself is stale). Exit 0 only when every mutant dies.
"""
import subprocess, sys
from pathlib import Path

ACT = "src/app/admin/inventory/actions.ts"
DRA = "src/app/admin/inventory/drafts/actions.ts"
CMP = "src/components/admin/inventory/LabCertificatePanels.tsx"
PFP = "src/app/admin/inventory/drafts/ProductFactsPanel.tsx"
EXT = "src/lib/inventory/coa-extract.ts"
PSV = "src/lib/inventory/coa-panel-server.ts"
RUNNER = ["npx", "vitest", "run", "tests/compliance/r28-coa-panels.test.ts", "tests/compliance/r28-coa-extract-server.test.ts", "tests/compliance/product-identity-schema.test.ts"]

MUTANTS = [
    (ACT, 'const session = await requirePermission("inventory.manage");\n  const { extractCoaForLot }', 'const session = await requirePermission("products.enrich");\n  const { extractCoaForLot }'),
    (ACT, 'if (run.read > 0 && run.manifestId) {', 'if (run.manifestId) {'),
    (ACT, 'if (run.read > 0 && run.manifestId) {', 'if (run.read > 0) {'),
    (ACT, 'restaged = outcome.staged;', 'restaged = true;'),
    (ACT, 'action: "inventory_lot.coa_reread",', 'action: "inventory_lot.update",'),
    (ACT, 'revalidatePath("/admin/knowledge-base/products");\n  redirect(`/admin/inventory/${lotId}?coa=', 'redirect(`/admin/inventory/${lotId}?coa='),
    (ACT, '${restaged ? "&restaged=1" : ""}#${LAB_CERT_ANCHOR}', '#${LAB_CERT_ANCHOR}'),
    (ACT, 'summary.restage = { error: err instanceof Error ? err.message : String(err) };', ''),
    (DRA, 'const returnTo = safeFactReturnPath(get("return_to"));', 'const returnTo = get("return_to") || null;'),
    (DRA, 'const returnTo = safeFactReturnPath(get("return_to"));', 'const returnTo = null as string | null;'),
    (DRA, '#${PRODUCT_FACTS_ANCHOR}`', '`'),
    (DRA, 'if (returnTo) revalidatePath(returnTo);', ''),
    (CMP, '{rereadAction && view.state !== "no-lab" && (', '{rereadAction && ('),
    (CMP, 'data-testid="coa-facts-held"', 'data-testid="coa-facts-x"'),
    (CMP, '{!canEdit ? (', '{false ? ('),
    (CMP, 'returnTo={returnTo}\n', '\n'),
    (CMP, '!ctx.migrated ? (', 'false ? ('),
    (PFP, 'name="return_to"', 'name="returnTo"'),
    (EXT, 'if (isMissingIdentityColumnError("inventory_lots", lotsErr)) return { filled: 0, errors };', 'if (false) return { filled: 0, errors };'),
    (EXT, 'if (error) errors.push(`knowledge base fill: product ${kb.id} was not updated (${error.message})`);\n    else filled += 1;', 'if (!error) filled += 1;'),
    (EXT, 'if (kbErr) return { filled: 0, errors: [', 'if (false) return { filled: 0, errors: ['),
    (EXT, 'for (const e of kb.errors) run.errors.push(`${lab.id}: ${e}`);', ''),
    (EXT, 'opts.force || r.coa_extract_status !== "ok"', 'r.coa_extract_status !== "ok"'),
    (PSV, 'if (linked.error && !isMissingIdentityColumnError("inventory_lots", linked.error)) lotsOk = false;', 'if (linked.error) lotsOk = false;'),
]


def passes() -> bool:
    try:
        return subprocess.run(RUNNER, capture_output=True, text=True, timeout=200).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def main() -> int:
    if not passes():
        print("baseline FAILED - fix the tests before mutating")
        return 2
    killed, survived, invalid = 0, [], []
    for n, (rel, old, new) in enumerate(MUTANTS, 1):
        p = Path(rel)
        src = p.read_text()
        if src.count(old) != 1:
            invalid.append(n)
            print(f"[{n}] INVALID (snippet found {src.count(old)}x) {old[:60]!r}")
            continue
        try:
            p.write_text(src.replace(old, new, 1))
            alive = passes()
        finally:
            p.write_text(src)
        if alive:
            survived.append(n)
            print(f"[{n}] SURVIVED {rel}: {old[:70]!r}")
        else:
            killed += 1
            print(f"[{n}] killed")
    print(f"\npanels-vitest: {len(MUTANTS)} mutants, {killed} killed, {len(survived)} survived, {len(invalid)} invalid")
    return 0 if not survived and not invalid else 1


if __name__ == "__main__":
    sys.exit(main())
