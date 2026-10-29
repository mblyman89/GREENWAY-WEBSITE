"""
scripts/compliance/mutate-fix-p3-3.py

Fix Phase 3.3 (F-04-22, F-04-23): GrowFlow emails read whole, one delivery
one row, Dismiss duplicate for a second copy under another number, quiet
build log. Owner, verbatim:
  "i think it would be worth adding a button to dismiss duplicate manifests
   that somehow make it to the table. we should have logic in place to
   prevent this, so it may need hardening."

Rule 13c: a test that cannot fail is worse than no test. Rule 137: every
anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p3-3.py
"""
import io
import subprocess
import sys

TESTS = [
    "tests/compliance/fix-p3-3-growflow-intake.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    ('qa routed first', 'src/lib/inventory/coa-bundle-core.ts', '  if (looksLikeGrowFlowQaResults(raw)) return readGrowFlowQaResults(raw, docLabel);\n', ''),
    ('qa detector needs QA Results', 'src/lib/inventory/coa-bundle-core.ts', '  return /\\bQA Results\\b/i.test(t) && GF_QA_BLOCK.test(t);', '  return false && GF_QA_BLOCK.test(t);'),
    ('qa every block read', 'src/lib/inventory/coa-bundle-core.ts', '    out.push(readGrowFlowQaBlock(block, docLabel, k + 1));', '    if (k === 0) out.push(readGrowFlowQaBlock(block, docLabel, k + 1));'),
    ('transfer log ccrs id first', 'src/lib/inventory/pdf-transferlog-core.ts', '  if (ccrs) return ccrs[1].toUpperCase();', '  void ccrs;'),
    ('transfer log ubi refused', 'src/lib/inventory/pdf-transferlog-core.ts', '  if (digits && !ubis.has(digits.slice(0, 9))) return digits;', '  if (digits) return digits;'),
    ('invoice cents carried', 'src/lib/inventory/pdf-growflow-invoice-core.ts', '    unit_cost_minor_units: r.unit_cost_minor_units,\n    unit_weight: null,', '    unit_cost_minor_units: null,\n    unit_weight: null,'),
    ('invoice lot carried', 'src/lib/inventory/pdf-growflow-invoice-core.ts', '    lot_code: r.lot_code,\n    pos_product_key: null,', '    lot_code: null,\n    pos_product_key: null,'),
    ('invoice donor wired', 'src/lib/inbound-email/inbound-store.ts', '      if (gfInvoice && gfInvoice.rows.length > 0) priceDonors.push(growFlowInvoiceAsPriceDonor(gfInvoice));', '      void gfInvoice;'),
    ('transfer log sorted last', 'src/lib/inbound-email/inbound-store.ts', '|| isLog(a) - isLog(b),', '|| 0,'),
    ('sibling same vendor', 'src/lib/inventory/manifest-sibling-core.ts', '  if (!a.vendor_id || !b.vendor_id || a.vendor_id !== b.vendor_id) return null;', '  if (!a.vendor_id || !b.vendor_id) return null;'),
    ('sibling shared lot required', 'src/lib/inventory/manifest-sibling-core.ts', '  if (shared === 0) return null;', '  if (false) return null;'),
    ('sibling different invoices refused', 'src/lib/inventory/manifest-sibling-core.ts', '  if (ia && ib) return null;', '  if (false) return null;'),
    ('sibling identical qty', 'src/lib/inventory/manifest-sibling-core.ts', '      if (q === null || q2 === null || q2 === undefined || q !== q2) return null;', '      if (q === null || q2 === null || q2 === undefined) return null;'),
    ('sibling 2+ lots', 'src/lib/inventory/manifest-sibling-core.ts', '  if (la.size >= 2 && la.size === lb.size && shared === la.size) {', '  if (la.size >= 1 && shared >= 1) {'),
    ('twins keep must be live', 'src/lib/inventory/manifest-sibling-core.ts', '      if (o.id === r.id || !isBlockingStatus(o.status)) continue;', '      if (o.id === r.id) continue;'),
    ('label: field words', 'src/lib/inventory/manifest-sibling-core.ts', '  return words.length > 0 && words.every((w) => LABEL_WORDS.has(w));', '  return false;'),
    ('label: numbers', 'src/lib/inventory/manifest-sibling-core.ts', '  if (/^\\d[\\d\\s-]*$/.test(t)) return true; // a number is not a name\n', ''),
    ('stage: label guard', 'src/lib/inventory/intake-store.ts', '  if (parsed.vendor_label !== null && cleanVendorLabel(parsed.vendor_label) === null) {', '  if (false) {'),
    ('stage: sibling dedupe', 'src/lib/inventory/intake-store.ts', '    const sibling = await findStagingSibling(admin, vendorId, parsed, meta?.invoiceNumber ?? null);\n    if (sibling) {', '    const sibling = await findStagingSibling(admin, vendorId, parsed, meta?.invoiceNumber ?? null);\n    if (false && sibling) {'),
    ('dismiss sibling accepted', 'src/lib/inventory/inbound-dedupe-core.ts', '  if ((!a || !b || a !== b) && !(typeof sibling === "string" && sibling.trim())) {', '  if (!a || !b || a !== b) {'),
    ('dismiss sibling passed', 'src/lib/inventory/intake-store.ts', '    rows.find((r) => r.id === keepId) ?? null,\n    sibling,\n  );', '    rows.find((r) => r.id === keepId) ?? null,\n    null,\n  );'),
    ('sql guard uses sibling', 'supabase/migrations/0321_inbound_sibling_dismiss.sql', '     and not public.inbound_manifest_sibling(p_dup, p_keep) then', '     then'),
    ('pdf reader label guard', 'src/lib/inventory/pdf-manifest-core.ts', '      if (m) vendor_label = cleanVendorLabel(m[1].trim());', '      if (m) vendor_label = m[1].trim();'),
    ('ai vendor label guard', 'src/lib/inbound-email/intake-harden-core.ts', 'printed(ai.vendorName, 3) ? cleanVendorLabel(ai.vendorName) : null', 'printed(ai.vendorName, 3) ? ai.vendorName : null'),
    ('build phase detected', 'src/lib/enrichment/enrichment-identity-core.ts', '  return String(raw ?? "").trim() === NEXT_BUILD_PHASE;', '  return false;'),
    ('build gate reads env', 'src/lib/enrichment/enrichment-identity-server.ts', '  return isNextBuildPhase(process.env[NEXT_PHASE_VAR]);', '  return false;'),
    ('network warn throttled', 'src/lib/enrichment/enrichment-identity-core.ts', '  if (lastNetworkLogAt !== null && now - lastNetworkLogAt < IDENTITY_FAIL_LOG_INTERVAL_MS) return "silent";\n', ''),
    ('query errors stay errors', 'src/lib/enrichment/enrichment-identity-core.ts', '  if (!isTransientNetworkError(message)) return "error";\n', ''),
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
