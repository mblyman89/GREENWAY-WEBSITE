/**
 * D252 S1: what broke in production week 11/01 (uploaded 2026-11-17), and the fixes.
 *
 * Evidence (production, 2026-11-18, owner's files):
 *   - Inventory__20261118T020015199.csv: 7 of 3,065 rows refused "Invalid
 *     Product", exactly the 7 rows whose Product name held a garbled accent
 *     copied from the examiner's export. CCRS joins Inventory.Product to
 *     Product.Name by exact text [G L0576] [G L0579].
 *   - Strain_20261118T014836797.csv: 11 "Duplicate Strain" (harmless), among
 *     them the CLEAN "Blueberry Crème Brûlée", so CCRS holds the clean text.
 *   - Sale__20261117T231541807.csv: 313 lines refused "Invalid
 *     InventoryExternalIdentifier" [G L1302-L1304], all on 149 lots that the
 *     same night's Inventory file Inserted. CCRS read the Sale at 23:15 and
 *     the Inventory only at 01:59.
 *   - Production DOES send success emails (4 of them, hours later). D251's
 *     "silence = success" is reverted (guarded in d251-held-back-fixes).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { __runCcrsNameRepairCoreTests, isGarbledName, repairGarbledName, repairLedgerNames } from "@/lib/compliance/ccrs-name-repair-core";
import { __runCcrsUploadGateCoreTests, gateNote, uploadGate } from "@/lib/compliance/ccrs-upload-gate-core";
import { decodeLedgerSlice } from "@/lib/compliance/ccrs-ledger-store-core";
import { resolveProductName, resolveStrainCasing } from "@/lib/compliance/ccrs-ledger-core";
import { subjectEnv } from "@/lib/compliance/ccrs-mail-core";
import { UploadWalkthrough } from "@/components/admin/compliance/UploadWalkthrough";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

// The 7 refused rows: [lot, product id, the garbled name the ledger held, CCRS's clean name].
const REFUSED: [string, string, string, string][] = [
  ["20363830208202336", "C1-110211000114734", "Diamond Dinger -\u00c2\u00a0Grand Salami (S)", "Diamond Dinger -\u00a0Grand Salami (S)"],
  ["16804798861247120", "C1-110211000117211", "Sitka Classic Special Press Hashish (H): Blueberry Cr\u00c3\u00a8me Br\u00c3\u00bbl\u00c3\u00a9e", "Sitka Classic Special Press Hashish (H): Blueberry Cr\u00e8me Br\u00fbl\u00e9e"],
  ["13230460135089837", "C1100018444", "Reserve PH\u00c3\u00b6 - 01g - Blue Lime Pie Badder", "Reserve PH\u00f6 - 01g - Blue Lime Pie Badder"],
  ["GF43647900042675", "C11000111497", "Fire Bros. - Pav\u00c3\u00a9 - 14g", "Fire Bros. - Pav\u00e9 - 14g"],
  ["20363830208206515", "C1-110211000114733", "Diamond Dinger -\u00c2\u00a0Diamond Fog (H)", "Diamond Dinger -\u00a0Diamond Fog (H)"],
  ["20072024913397124", "C1100019820", "Hightide: Live Rosin (73-159\u00c2\u00b5m) - Twin Peaks", "Hightide: Live Rosin (73-159\u00b5m) - Twin Peaks"],
  ["20363830208202207", "C1-110211000114732", "Diamond Dinger -\u00c2\u00a0Big Harbor Kush (H)", "Diamond Dinger -\u00a0Big Harbor Kush (H)"],
];

describe("self-tests", () => {
  it("name repair and upload gate cores pass", () => {
    const a = __runCcrsNameRepairCoreTests();
    const b = __runCcrsUploadGateCoreTests();
    expect(a.failed + b.failed).toBe(0);
    expect(a.passed).toBeGreaterThanOrEqual(17);
    expect(b.passed).toBeGreaterThanOrEqual(11);
  });
});

describe("1. garbled names from the examiner's export are repaired (Invalid Product x7)", () => {
  it("each refused name repairs to the clean text", () => {
    for (const [, , bad, good] of REFUSED) {
      expect(isGarbledName(bad)).toBe(true);
      expect(repairGarbledName(bad)).toBe(good);
    }
  });
  it("the ledger slice hands the planner the clean name, so the Inventory row names what CCRS holds", () => {
    const entries: unknown[] = [];
    for (const [lot, pid, bad] of REFUSED) {
      entries.push(["Product", pid, bad, "seed", null]);
      entries.push(["Inventory", lot, null, "seed", pid]);
    }
    const out = decodeLedgerSlice("prod", { env: "prod", loaded: true, last_stamp: null, entries, product_ids: [] }, null);
    expect(out.kind).toBe("loaded");
    if (out.kind !== "loaded") return;
    for (const [lot, , , good] of REFUSED) {
      const r = resolveProductName(out.ledger.view, lot, "our name");
      expect(r.kind).toBe("filed");
      if (r.kind === "filed") expect(r.name).toBe(good);
    }
  });
  it("a strain filed garbled is matched by its clean spelling (no new Strain row)", () => {
    const g = "Blueberry Cr\u00c3\u00a8me Br\u00c3\u00bbl\u00c3\u00a9e";
    const out = decodeLedgerSlice("prod", { env: "prod", loaded: true, last_stamp: null, entries: [["Strain", g, g, "seed", null]], product_ids: [] }, null);
    if (out.kind !== "loaded") throw new Error("not loaded");
    expect(resolveStrainCasing(out.ledger.view, "Blueberry Cr\u00e8me Br\u00fbl\u00e9e").kind).toBe("filed");
  });
  it("Inventory, Sale and other ids are never rewritten", () => {
    const r = repairLedgerNames([{ fileType: "Inventory", externalId: "A\u00c3\u00a9", filedName: null, state: "seed" }]);
    expect(r[0].externalId).toBe("A\u00c3\u00a9");
  });
  it("the batch ledger and the clean-up both repair at load", () => {
    expect(SRC("src/lib/compliance/ccrs-ledger-store-core.ts")).toContain("buildLedgerView(env, repairLedgerNames(rows), productIdByKey)");
    const eq = SRC("src/lib/compliance/ccrs-equalize-core.ts");
    expect(eq).toContain('buildLedgerView("prod", repairLedgerNames(input.ledger.map(');
    expect(eq).toContain('strainLookup(input.ledger.map((r) => (r.t === "Strain" ? { ...r, id: repairGarbledName(r.id) } : r)))');
  });
});

describe("2. a group waits for CCRS's email on the group before it (Sale x313)", () => {
  // 23:15 on 2026-11-17: everything uploaded, nothing answered yet.
  const night = ["Strain", "Area", "Product", "Inventory"].map((t) => ({ fileType: t, state: "uploaded", fileName: `${t}_413541_20261117220516.csv` }));
  it("Group 3 stays locked while Inventory is unanswered", () => {
    const g = uploadGate(night);
    expect(g.group3.locked).toBe(true);
    expect(g.group3.waitingFor).toContain("Inventory_413541_20261117220516.csv");
    expect(gateNote(g.group3, "Group 3")).toMatch(/hours/);
  });
  it("the walkthrough shows the lock and disables the Group 3 box", () => {
    const html = renderToStaticMarkup(
      createElement(UploadWalkthrough, {
        weekKey: "2026-11-01",
        files: [{ type: "Sale", fileName: "Sale_1.csv", recordCount: 3, empty: false }],
        batchZipHref: "#",
        submittable: true,
        gate: uploadGate(night),
      }),
    );
    expect(html).toContain("Inventory_413541_20261117220516.csv, Product_413541_20261117220516.csv, Strain_413541_20261117220516.csv and Apply it in &quot;CCRS email&quot; below before uploading Group 3");
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("the hub passes this env's waiting files to the gate", () => {
    expect(SRC("src/app/admin/compliance/ccrs/page.tsx")).toContain("gate={uploadGate(waitingHere)}");
  });
});

describe("3. production subjects are now known (U-65, U-66)", () => {
  it("the success and error subjects seen on 2026-11-18 are production, verified", () => {
    expect(subjectEnv("CCRS Processing Successful", "success")).toEqual({ env: "prod", verified: true });
    expect(subjectEnv("CCRS errors for file: Sale_413541_20261117220519_20261117T2315338.csv", "error")).toEqual({ env: "prod", verified: true });
    expect(subjectEnv("PRE: CCRS errors for file: Area_413541_20261117220514_20261117T228383.csv", "error")).toEqual({ env: "preprod", verified: true });
  });
});
