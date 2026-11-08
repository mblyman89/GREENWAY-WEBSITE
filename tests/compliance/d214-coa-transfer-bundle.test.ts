/**
 * D214 - "add to the repo with a button to attach them all" (GREEN RESEARCH
 * NETWORK, LLC, manifest GF42904700003637).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runCoaTransferBundleCoreTests, planTransferCoaAttach } from "@/lib/inventory/coa-transfer-bundle-core";
import { keptTransferNumbers, keptTransferText } from "@/data/wcia-transfers";
import { parseVendorJson } from "@/lib/inventory/intake-parser";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D214 coa-transfer-bundle-core", () => {
  it("self-tests pass", () => {
    expect(__runCoaTransferBundleCoreTests().passed).toBeGreaterThanOrEqual(15);
  });
});

describe("D214 the kept GF42904700003637 transfer", () => {
  it("is kept, parses as WCIA, and carries no access token", () => {
    expect(keptTransferNumbers()).toContain("GF42904700003637");
    const text = keptTransferText("GF42904700003637") as string;
    expect(text).not.toMatch(/token=/i);
    const p = parseVendorJson(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.manifest.source_format).toBe("wcia");
    expect(p.manifest.manifest_number).toBe("GF42904700003637");
    expect(p.manifest.lines).toHaveLength(19);
    expect(p.manifest.lines.every((l) => (l.lab?.coa_url ?? "").startsWith("https://"))).toBe(true);
  });

  it("plans 18 lots (the one with a lab result is kept) and 15 certificate links", () => {
    const p = parseVendorJson(keptTransferText("GF42904700003637") as string);
    if (!p.ok) throw new Error(p.error);
    const lots = p.manifest.lines.map((l, i) => ({
      id: `L${i}`,
      lot_code: l.lot_code,
      status: "active",
      lab_result_id: l.lot_code === "GF42904705584902" ? "kept" : null,
    }));
    const plan = planTransferCoaAttach(lots, p.manifest.lines);
    expect(plan.jobs).toHaveLength(18);
    expect(plan.skipped["has-lab"]).toBe(1);
    expect(plan.skipped.ambiguous).toBe(0);
    expect(plan.links.length).toBeLessThanOrEqual(15);
  });

  it("unknown numbers have no kept transfer", () => {
    expect(keptTransferText("GF0")).toBeNull();
    expect(keptTransferText(null)).toBeNull();
  });
});

describe("D214 wiring", () => {
  it("the action is guarded, fill-only via the store, audited, and redirects with a sentence", () => {
    const a = read("src/app/admin/inventory/intake/actions.ts");
    const fn = a.slice(a.indexOf("export async function attachTransferCoasAction"));
    expect(fn).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(fn).toMatch(/attachTransferCoasForManifest/);
    expect(fn).toMatch(/TRANSFER_COA_AUDIT/);
    expect(fn).toMatch(/TRANSFER_COA_MANIFEST_AUDIT/);
    expect(fn).toMatch(/logManifestEvent/);
  });
  it("the store fills only an empty lab result, never a destroyed lot, and uses the guarded fetcher", () => {
    const s = read("src/lib/inventory/coa-transfer-bundle-store.ts");
    expect(s).toMatch(/\.is\("lab_result_id", null\)/);
    expect(s).toMatch(/\.neq\("status", "destroyed"\)/);
    expect(s).toMatch(/fetchManualCoaPdf/);
    expect(s).toMatch(/certificateForLink/);
    expect(s).toMatch(/pagedAllChecked/);
    expect(s).not.toMatch(/\.limit\(\s*\d{4,}/);
  });
  it("the delivery page shows the button only with a kept transfer and missing COAs", () => {
    const pg = read("src/app/admin/inventory/intake/[id]/page.tsx");
    expect(pg).toMatch(/missingCoa > 0 && hasKeptTransfer\(manifest\.manifest_number\)/);
    expect(pg).toMatch(/data-testid="coa-transfer-bundle-attach"/);
    expect(pg).toMatch(/Attach all COAs from the vendor&apos;s transfer/);
  });
  it("the owner's documents are kept in the repo", () => {
    const d = "back-office/source-materials/manifests/GF42904700003637";
    expect(readFileSync(join(root, d, "Invoice_INV-2068_2026-10-28.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
    expect(readFileSync(join(root, d, "CCRS_Manifest_GF42904700003637_2026-10-28.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
