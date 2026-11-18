/**
 * D250 S5: the clean-up made easy, with the examiner's 10/29 answers.
 *
 * Why this matters to the license: after Cultivera, CCRS still holds lots open
 * that the store no longer has. Brian: "Ideally, we would like that old
 * information cleaned up" [EXAM2 L0031]. The clean-up must read the WHOLE CCRS
 * picture (the 9/18 seed plus the 11/17 delivery), write what Brian said to
 * write (cost 0.01 [EXAM2 L0033], the strain already filed [EXAM2 L0035]),
 * send the Update first and the Reconciliation after it [EXAM2 L0029], and
 * never zero a lot we still hold.
 * These tests pin:
 *   1. BRIAN_EQUALIZE_POLICY's values and that the default policy is unchanged.
 *   2. keepFiledStrain: THC/Other/Unknown written unchanged, blank still held,
 *      never together with an override.
 *   3. compositeCopy: refuses until the delivery is loaded; seed + delivery;
 *      never a lot our own files touched, never a proof-only lot.
 *   4. The CLI: --composite --brian end to end, and every conflict exits 2.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIAN_EQUALIZE_POLICY,
  DEFAULT_EQUALIZE_POLICY,
  EqualizeError,
  compositeCopy,
  equalizeReport,
  planEqualizeWave,
  type EqualizeInput,
} from "@/lib/compliance/ccrs-equalize-core";
import { SEED_HEADERS, SEED_SOURCE, buildLedgerSeed, type SeedEntity } from "@/lib/compliance/ccrs-ledger-seed-core";
import type { LedgerRow } from "@/lib/compliance/ccrs-reseed-core";
import { main, policyOf } from "../../scripts/compliance/equalize-ccrs-wave";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const DELIVERY = "seed:2026-11-17-delivery";

/* ----------------------------- fixtures ----------------------------- */
const csv = (rows: string[][]) => rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
type InvOver = Partial<Record<(typeof SEED_HEADERS.Inventory)[number], string>>;
const invRow = (id: string, over: InvOver = {}): string[] => {
  const base: Record<string, string> = {
    "License Number": "413541", Strain: "Blue Dream", "Inventory Type": "Usable Cannabis", Name: "Blue Dream 1g", "Product Identifier": "P-1",
    "Product Name": "desc", IsMedical: "FALSE", "InventoryIdentifier (ExternalIdentifier on inventory.csv)": id, "Initial Quantity": "10",
    "Quantity on Hand": "4", TotalCost: "25.00", CreatedBy: "Cultivera", CreatedDate: "8/30/2024", Updatedby: "", UpdatedDate: "",
  };
  return SEED_HEADERS.Inventory.map((h) => over[h] ?? base[h]);
};
const prodRow = (id: string, name: string) => ["Usable Cannabis", name, "desc", "1", id, "C", "09/01/2026", "", "", ""];
const texts = (inv: string[][]) => ({
  Inventory: csv([[...SEED_HEADERS.Inventory], ...inv]),
  Product: csv([[...SEED_HEADERS.Product], prodRow("P-1", "Blue Dream 1g")]),
  Strain: csv([[...SEED_HEADERS.Strain], ["Hybrid", "Blue Dream", "C", "09/01/2026", "", ""], ["Hybrid", "THC", "C", "09/01/2026", "", ""]]),
  Area: csv([[...SEED_HEADERS.Area], ["Sales Floor", "FALSE", "C1100011", "C", "08/22/2024", "", ""]]),
});
/** The ledger after the 9/18 seed and the 11/17 delivery are both loaded. `delivered` ids carry the delivery source. */
const ledgerOf = (copy: readonly SeedEntity[], delivered: readonly string[] = [], over: Record<string, Partial<LedgerRow>> = {}): LedgerRow[] =>
  copy.map((e) => ({
    t: e.fileType, id: e.externalId, name: e.filedName, prod: e.productExternalId, state: e.state,
    source: e.fileType === "Inventory" && delivered.includes(e.externalId) ? DELIVERY : SEED_SOURCE,
    lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789898400000000", payload: e.seedPayload,
    ...(over[`${e.fileType}/${e.externalId}`] ?? {}),
  }));
const plan = (inv: string[][], delivered: string[], policy = BRIAN_EQUALIZE_POLICY, o: Partial<EqualizeInput> = {}) => {
  const ledger = ledgerOf(buildLedgerSeed(texts(inv)).entities, delivered);
  return planEqualizeWave({
    copy: compositeCopy(ledger, "2026-11-17"), ledger, ours: [], copyAsOf: "2026-11-17", snapshotDate: "2026-11-23", waveDate: "2026-11-23",
    wave: "W1", finalUploadDate: "2026-11-01", countedBarcodes: [], licenseNumber: "413541", submittedBy: "Greenway Marijuana", policy: { ...policy }, ...o,
  });
};

describe("D250 S5 Brian's answers as one policy", () => {
  it("BRIAN_EQUALIZE_POLICY = separate files (4a), nominal 0.01 (4c), the filed strain (4d)", () => {
    expect(BRIAN_EQUALIZE_POLICY).toEqual({ sameBatchAdjust: false, nominalTotalCost: "0.01", strainOverride: null, maxLots: 10_000, keepFiledStrain: true });
    expect(Object.isFrozen(BRIAN_EQUALIZE_POLICY)).toBe(true);
  });
  it("the default policy is unchanged: holds a zero cost and a reserved strain", () => {
    expect(DEFAULT_EQUALIZE_POLICY.keepFiledStrain).toBe(false);
    expect(DEFAULT_EQUALIZE_POLICY.nominalTotalCost).toBeNull();
    const p = plan([invRow("C", { TotalCost: "0" }), invRow("T", { Strain: "THC" })], ["C"], DEFAULT_EQUALIZE_POLICY);
    expect(p.holds.map((h) => `${h.id}:${h.code}`).sort()).toEqual(["C:H_ZERO_COST", "T:H_STRAIN_RESERVED"]);
  });
  it("the policy cites Brian's answers by line", () => {
    const core = read("src/lib/compliance/ccrs-equalize-core.ts");
    for (const pin of ["[EXAM2 L0029]", "[EXAM2 L0031]", "[EXAM2 L0033]", "[EXAM2 L0035]"]) expect(core).toContain(pin);
  });
});

describe("D250 S5 the strain already filed (Brian 4d)", () => {
  it("writes THC unchanged and counts it; writes 0.01 where the cost is 0", () => {
    const p = plan([invRow("T", { Strain: "THC", TotalCost: "0" })], ["T"]);
    expect(p.holds).toEqual([]);
    expect(p.inventoryRows[0][1]).toBe("THC");
    expect(p.inventoryRows[0][6]).toBe("0.01");
    expect(p.inventoryRows[0][5]).toBe("0");
    expect(p.counts.keptFiledStrain).toBe(1);
    expect(p.counts.nominalCost).toBe(1);
    expect(p.counts.strainOverride).toBe(0);
    expect(equalizeReport(p)).toContain("the strain already filed (Brian 4d)");
  });
  it("a normal strain is not counted as kept", () => {
    expect(plan([invRow("N")], ["N"]).counts.keptFiledStrain).toBe(0);
  });
  it("a blank strain is still held (there is no name to keep)", () => {
    const p = plan([invRow("E", { Strain: "" })], ["E"]);
    expect(p.holds.map((h) => h.code)).toEqual(["H_STRAIN_RESERVED"]);
    expect(p.inventoryRows).toEqual([]);
  });
  it("keeping the filed strain and an override together is refused", () => {
    expect(() => plan([invRow("A")], ["A"], { ...BRIAN_EQUALIZE_POLICY, strainOverride: "Hybrid" })).toThrow(/not both/);
    expect(() => plan([invRow("A")], ["A"], { ...BRIAN_EQUALIZE_POLICY, keepFiledStrain: "yes" as unknown as boolean })).toThrow(EqualizeError);
  });
});

describe("D250 S5 the composite copy (9/18 seed + 11/17 delivery)", () => {
  const copy = buildLedgerSeed(texts([invRow("OLD"), invRow("NEW"), invRow("TOUCHED"), invRow("PROOF")])).entities;
  it("refuses until the delivery is loaded, and refuses a bad date", () => {
    expect(() => compositeCopy(ledgerOf(copy), "2026-11-17")).toThrow(/Load the examiner's delivery first/);
    expect(() => compositeCopy(ledgerOf(copy, ["NEW"]), "2026-11-18")).toThrow(/2026-11-18-delivery/);
    expect(() => compositeCopy(ledgerOf(copy, ["NEW"]), "11/17/2026")).toThrow(EqualizeError);
  });
  it("holds the seed and the delivery, never a lot our files touched or a proof-only lot", () => {
    const ledger = ledgerOf(copy, ["NEW"], {
      "Inventory/TOUCHED": { lastFile: "Inventory_413541_20261108000000.csv", lastOp: "Update" },
      "Inventory/PROOF": { source: "proof:2026-11-17-sales" },
    });
    const ids = compositeCopy(ledger, "2026-11-17").filter((e) => e.fileType === "Inventory").map((e) => e.externalId).sort();
    expect(ids).toEqual(["NEW", "OLD"]);
  });
  it("plans both old (9/18) and new (delivered) stale lots in one wave; our lots are never zeroed", () => {
    const p = plan([invRow("OLD"), invRow("NEW"), invRow("MINE")], ["NEW"], BRIAN_EQUALIZE_POLICY, { ours: [{ externalId: "MINE", lotCode: null, posProductKey: null, destroyed: false }] });
    expect(p.lots.map((l) => l.id)).toEqual(["NEW", "OLD"]);
    expect(p.counts.ours).toBe(1);
    expect(p.adjustmentRows).toEqual([]); // 4a: the Reconciliation waits for the Update's email
  });
  it("lots already at 0 are counted, never sent (4b: focus on going forward)", () => {
    const p = plan([invRow("Z", { "Quantity on Hand": "0" }), invRow("A")], ["A"]);
    expect(p.counts.alreadyZero).toBe(1);
    expect(p.lots.map((l) => l.id)).toEqual(["A"]);
  });
});

describe("D250 S5 the CLI: --composite --brian", () => {
  let dir = "";
  let logs: string[] = [];
  let errs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "d250s5-"));
    logs = []; errs = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => { errs.push(String(m)); });
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
  const setup = (delivered = ["NEW"]) => {
    const copy = buildLedgerSeed(texts([invRow("OLD", { TotalCost: "0" }), invRow("NEW", { Strain: "THC" }), invRow("OURS")])).entities;
    writeFileSync(path.join(dir, "ledger.jsonl"), ledgerOf(copy, delivered).map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(path.join(dir, "ours.jsonl"), JSON.stringify({ externalId: "OURS", lotCode: null, posProductKey: null, destroyed: false }) + "\n");
    return ["x", "equalize-ccrs-wave.ts", "--phase", "inventory", "--wave", "W1", "--wave-date", "2026-11-23", "--composite", "2026-11-17", "--brian",
      "--final-upload-date", "2026-11-01", "--no-counted-file", "--ledger-file", path.join(dir, "ledger.jsonl"), "--ours-file", path.join(dir, "ours.jsonl")];
  };
  const counts = () => JSON.parse(logs.find((l) => l.startsWith("wave counts: "))!.slice(13));
  it("plans from the ledger alone: both stale lots in the wave, none held, the report names Brian 4d", () => {
    const rc = main([...setup(), "--report", path.join(dir, "w1.md")]);
    expect(errs).toEqual([]);
    expect(rc).toBe(0);
    const c = counts();
    expect(c.wave).toBe(2);
    expect(c.ours).toBe(1);
    expect(c.nominalCost).toBe(1);
    expect(c.keptFiledStrain).toBe(1);
    expect(readFileSync(path.join(dir, "w1.md"), "utf8")).toContain("the strain already filed (Brian 4d)");
  });
  it("without --brian the same ledger holds both lots (the default never guesses)", () => {
    expect(main(setup().filter((a) => a !== "--brian"))).toBe(0);
    expect(counts().wave).toBe(0);
  });
  it("refuses (1) before the delivery is loaded", () => {
    expect(main(setup([]))).toBe(1);
    expect(errs.some((e) => /Load the examiner's delivery first/.test(e))).toBe(true);
  });
  it("every conflict exits 2", () => {
    const a = setup();
    for (const extra of [["--nominal-cost", "0.01"], ["--strain-override", "Hybrid"], ["--same-batch"], ["--copy-as-of", "2026-11-17"], ["--inventory", path.join(dir, "Inventory.csv")]]) {
      expect(main([...a, ...extra]), extra.join(" ")).toBe(2);
    }
  });
  it("policyOf: --brian honours --max-lots; the plain path keeps the filed strain off", () => {
    expect(policyOf(["--brian", "--max-lots", "500"])).toEqual({ ...BRIAN_EQUALIZE_POLICY, maxLots: 500 });
    expect(policyOf([]).keepFiledStrain).toBe(false);
    expect(() => policyOf(["--brian", "--same-batch"])).toThrow(/--brian already sets/);
  });
});
