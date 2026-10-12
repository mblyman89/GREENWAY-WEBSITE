/**
 * tests/compliance/r50-cultivera-manifest-plan-live.test.ts — R50 S10.
 *
 * Rule v2 (bible §3b.4) on the store's REAL rehearsal #2a harvest (2026-10-12, Cultivera POS,
 * read-only). The fixture normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json holds exactly what
 * the planner reads and nothing else (no prices, no addresses, no people):
 *   rows      = transformWorkbooks(assembled workbooks).lotSources → [barcode, vendor, receivedDateRaw, units]
 *   links     = list-API IncomingTransferId per barcode (linksFromListLots)
 *   transfers = transferIndexFromDetails(transfer_details.jsonl)  (equal to build-transfer-index.py on 644/644)
 *
 * Independent checks:
 *   1. The counts are pinned (re-measured, not copied from the bible).
 *   2. The per-lot answer equals the SHA-256 of an independent Python oracle
 *      (/workspace/r50/s10/oracle.py at build time: openpyxl + Cultivera's raw JSON,
 *      none of this repo's parsers).
 *   3. The §3b.6 gate passes and every claim it makes is re-derived here by hand.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import {
  planTransferManifests,
  manifestPlanGate,
  buildTransferLineage,
  type TransferIndexEntry,
  type LotTransferDecision,
} from "@/lib/inventory/cultivera-transfer-match-core";
import { cultiveraVendorKey, type CultiveraGroupRow } from "@/lib/inventory/cultivera-manifest-group-core";

const FX = JSON.parse(fs.readFileSync("normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json", "utf8")) as {
  transferDetailsSha256: string;
  rows: [string, string, string, number][];
  links: [string, number[]][];
  transfers: TransferIndexEntry[];
};
const rows: CultiveraGroupRow[] = FX.rows.map(([barcode, vendor, receivedDateRaw, units]) => ({ barcode, vendor, receivedDateRaw, units }));
const links = new Map(FX.links);
const plan = planTransferManifests(rows, FX.transfers, { pacificToday: "2026-10-12", links });
const vendorOf = new Map<string, string>();
for (const r of rows) if (!vendorOf.has(String(r.barcode))) vendorOf.set(String(r.barcode), cultiveraVendorKey(r.vendor));
const matched = plan.decisions.filter((d): d is Extract<LotTransferDecision, { matched: true }> => d.matched);

describe("R50 S10: rule v2 on the real rehearsal #2a harvest", () => {
  it("reads the fixture it claims to (guards the test itself)", () => {
    expect(FX.rows.length).toBe(3824);
    expect(new Set(FX.rows.map((r) => r[0])).size).toBe(3762);
    expect(FX.transfers.length).toBe(644);
    expect(links.size).toBe(3615);
    expect(FX.transferDetailsSha256).toBe("228160043afd299b5827197930e15daa1e855b9fba4e3899016dd5fe32688186");
    const text = fs.readFileSync("normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json", "utf8");
    for (const banned of ["UnitPrice", "TotalPrice", '"Total"', "Address", "AcceptedBy", "Employee", "Bearer", "password"]) {
      expect(text.includes(banned), banned).toBe(false);
    }
  });

  it("pins the re-measured §3b.4 numbers", () => {
    expect(plan.summary).toMatchObject({
      lots: 3762,
      matched: 3615,
      matchedOnlyReceipt: 3496,
      matchedFirstAfter: 119,
      unmatched: { no_receipt: 147, ambiguous_no_time: 0, ambiguous_none_after: 0, ambiguous_tie: 0, vendor_mismatch: 0 },
      transfersUsed: 641,
      transfersInIndex: 644,
      fallbackGroups: 38,
      largestTransferGroup: 56,
      matchedVendorByLink: 24,
      lotsAlsoOn: 119,
      link: { agree: 3609, differ: 6, none: 0, unmatchedLinked: 0 },
    });
    expect(plan.fallbackGroups.every((g) => g.kind === "undated")).toBe(true);
    expect(plan.numberCollisions).toEqual([]);
  });

  it("without links the v1 rule refuses exactly the 24 distributor lots (rule v2 adds nothing else)", () => {
    const v1 = planTransferManifests(rows, FX.transfers, { pacificToday: "2026-10-12" });
    expect(v1.summary.matched).toBe(3591);
    expect(v1.summary.unmatched.vendor_mismatch).toBe(24);
    const v1Pick = new Map(v1.decisions.map((d) => [d.barcode, d.matched ? d.transferId : null]));
    let changed = 0;
    for (const d of plan.decisions) {
      const before = v1Pick.get(d.barcode);
      const after = d.matched ? d.transferId : null;
      if (before !== after) {
        changed++;
        expect(before, d.barcode).toBeNull();
        expect(d.matched && d.vendorByLink, d.barcode).toBe(true);
      }
    }
    expect(changed).toBe(24);
  });

  it("equals the independent Python oracle, lot by lot (SHA-256)", () => {
    const lines = plan.decisions
      .map((d) => (d.matched ? `${d.barcode}\t${d.transferId}\t${d.alsoOn.join(";")}` : `${d.barcode}\t-\t${d.reason}`))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(lines.length).toBe(3762);
    expect(crypto.createHash("sha256").update(lines.join("\n")).digest("hex")).toBe(
      "0e70edf65b44d53021caab67880c7e83c5afa66e83f16d63cc15c1050db2cbd7",
    );
  });

  it("the 24 aliases are a brand shipped by its distributor, and the barcode IS on that transfer", () => {
    const byId = new Map(FX.transfers.map((t) => [t.id, t]));
    const aliases = matched.filter((d) => d.vendorByLink);
    expect(aliases.length).toBe(24);
    const pairs = new Map<string, number>();
    for (const d of aliases) {
      const t = byId.get(d.transferId)!;
      expect(t.lines.some((l) => l[0] === d.barcode && l[1] > 0), d.barcode).toBe(true);
      expect(links.get(d.barcode), d.barcode).toEqual([d.transferId]);
      expect(d.receipts).toBe(1);
      const k = `${vendorOf.get(d.barcode)} <- ${t.vendor.toUpperCase()}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    expect(Object.fromEntries([...pairs].sort())).toEqual({
      "CASSIDY CANNABIS LLC <- GREEN NETWORK": 3,
      "DOPE SYNERGY <- R&B GROUP": 6,
      "DOPE SYNERGY <- TTL HOLDINGS LLC": 2,
      "FIRE BROS. <- FIREBROS": 1,
      "GREEN NETWORK <- CASSIDY CANNABIS LLC": 1,
      "HOMETOWN HERBS <- SOUTH BAY MASTER GROWERS": 4,
      "PASTIME BRANDS <- MY WEED BUNNY": 1,
      "R&B GROUP <- SUSTAINABLE ORGANIC SOLUTIONS": 1,
      "TTL HOLDINGS LLC <- R&B GROUP": 5,
    });
  });

  it("the 6 link differences are one re-delivery: filed on the first transfer, Cultivera points at the second", () => {
    const g = manifestPlanGate(plan, vendorOf, links);
    expect(g.pass).toBe(true);
    expect(g.problems).toEqual([]);
    expect(g.multiReceiptDiffers.length).toBe(6);
    expect(new Set(g.multiReceiptDiffers.map((d) => `${d.transferId}->${d.linkIds.join("/")}`))).toEqual(new Set(["1108->1109"]));
    const t1108 = FX.transfers.find((t) => t.id === 1108)!;
    const t1109 = FX.transfers.find((t) => t.id === 1109)!;
    // Both GROW OP FARMS, accepted 8 minutes apart on 2026-08-20; the lots were received 08:45:57 PT = 15:45:57Z, before both.
    expect([t1108.number, t1109.number]).toEqual(["WA413287.TR0WKU", "WA413287.TRHNST"]);
    expect(Date.parse(t1109.acceptedAt!) - Date.parse(t1108.acceptedAt!)).toBe(483_574);
    // GROW OP FARMS re-used these barcodes on earlier deliveries too (962, 1036); every one remembers 1109,
    // and every earlier receipt was accepted BEFORE the lot's received time (so it cannot be this lot's delivery).
    const receivedMs = Date.parse("2026-08-20T15:45:57.457Z");
    const allAlso = new Map<string, number[]>();
    for (const d of g.multiReceiptDiffers) {
      const dec = matched.find((m) => m.barcode === d.barcode)!;
      allAlso.set(d.barcode, dec.alsoOn);
      expect(dec.alsoOn.includes(1109), d.barcode).toBe(true);
      for (const id of dec.alsoOn.filter((x) => x !== 1109)) {
        expect(Date.parse(FX.transfers.find((t) => t.id === id)!.acceptedAt!), `${d.barcode}@${id}`).toBeLessThan(receivedMs - 60_000);
      }
    }
    expect(Object.fromEntries(allAlso)).toEqual({
      "WA413287.IN6ESO": [1036, 1109],
      "WA413287.INBIZ6": [962, 1036, 1109],
      "WA413287.INE2HR": [1036, 1109],
      "WA413287.INOJ1F": [1036, 1109],
      "WA413287.INUC8M": [1109],
      "WA413287.INXQAW": [1036, 1109],
    });
  });

  it("is a partition, vendors never mixed except the named aliases, every alsoOn is a real receipt", () => {
    const all = [...plan.transferGroups.flatMap((g) => g.barcodes), ...plan.fallbackGroups.flatMap((g) => g.barcodes)];
    expect(all.length).toBe(3762);
    expect(new Set(all).size).toBe(3762);
    const byId = new Map(FX.transfers.map((t) => [t.id, t]));
    for (const g of plan.transferGroups) {
      const alias = new Set(g.vendorByLink);
      for (const b of g.barcodes) if (!alias.has(b)) expect(vendorOf.get(b), b).toBe(g.vendorKey);
      for (const [b, ids] of Object.entries(g.alsoOn)) {
        expect(ids.includes(g.transferId)).toBe(false);
        for (const id of ids) expect(byId.get(id)!.lines.some((l) => l[0] === b && l[1] > 0), `${b}@${id}`).toBe(true);
      }
    }
    for (const g of plan.fallbackGroups) for (const b of g.barcodes) expect(vendorOf.get(b)).toBe(g.vendorKey);
  });

  it("lineage carries alsoOn + aliases and stays accounting-inert", () => {
    const g = plan.transferGroups.find((x) => x.transferId === 1108)!;
    const lin = buildTransferLineage({ importId: "imp", sourceManifestId: "src", sourceManifestNumber: "POS-IMPORT-x", group: g });
    expect(lin.kind).toBe("cultivera-reconstructed");
    expect(lin.rule_version).toBe(2);
    expect(Object.keys(lin.also_on).length).toBeGreaterThanOrEqual(6);
    const aliasGroups = plan.transferGroups.filter((x) => x.vendorByLink.length > 0);
    expect(aliasGroups.reduce((n, x) => n + x.vendorByLink.length, 0)).toBe(24);
  });
});
