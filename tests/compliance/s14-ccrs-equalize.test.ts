/**
 * S-14 (CCRS Bible Part 17 §E, Part 09 S-14): equalize waves.
 *
 * Why this matters to the license: CCRS holds about 40,000 lots open that the
 * store no longer has. The examiner's direction is "submit an inventory update
 * for all those ids and get them to zero and then an inventory adjustment for
 * those ids, with the reason as reconciliation" [EXAM L0430]. One wrong row
 * zeroes a lot we still sell, invents a cost, or names a strain CCRS rejects.
 * These tests pin:
 *   1. Which lots a wave touches: only lots CCRS holds open, that no lot in our
 *      own system matches (by assigned id, lot code or product key), that the
 *      ledger holds untouched and merged with this exact copy (S-15 first).
 *   2. Every hold, each with its reason, and none of them guessed: dates, cost
 *      [G L0614], strain [G L0358], product, commas/line breaks, duplicates.
 *   3. The exact bytes of the Update and Reconciliation rows, matched to the
 *      PREprod-accepted P20261007A Update shape.
 *   4. The open examiner questions as switches with safe defaults:
 *      Q-B1 same batch (default: no), Q-B3 nominal cost (default: hold),
 *      Q-B6 strain override (default: hold), Q-B7 wave size (default 10,000).
 *   5. The adjustment phase reads only what the database proves landed.
 *   6. The SQL CI runs is the SQL the script sends; the script end to end.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADJUST_PHASE_SQL,
  DEFAULT_EQUALIZE_POLICY,
  EQUALIZE_HOLD_CODES,
  EQUALIZE_PURPOSE,
  EqualizeError,
  __runCcrsEqualizeCoreTests,
  adjustmentRowFor,
  equalizeEmitPayload,
  equalizeEmitSql,
  equalizeReport,
  equalizeSources,
  parseAdjustLine,
  parseCcrsDate,
  planAdjustPhase,
  planEqualizeWave,
  verifyEqualizeFiles,
  waveCheckSql,
  type AdjustLine,
  type EqualizeInput,
  type OurLot,
} from "@/lib/compliance/ccrs-equalize-core";
import { SEED_HEADERS, SEED_SOURCE, buildLedgerSeed, type SeedEntity } from "@/lib/compliance/ccrs-ledger-seed-core";
import type { LedgerRow } from "@/lib/compliance/ccrs-reseed-core";
import { buildLedgerView } from "@/lib/compliance/ccrs-ledger-core";
import { CCRS_COLUMNS, verifyCcrsFile } from "@/lib/compliance/ccrs-batch-core";
import { planOutboxFiles, verifyOutboxAgainstLedger } from "@/lib/compliance/ccrs-outbox-core";
import { buildEqualizePgCheck } from "../../scripts/compliance/equalize-pg-check-fixture";
import { main, sameDayRefusal } from "../../scripts/compliance/equalize-ccrs-wave";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/* ----------------------------- fixtures ----------------------------- */
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
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
const texts = (inv: string[][], extraProducts: string[][] = [], extraStrains: string[][] = []) => ({
  Inventory: csv([[...SEED_HEADERS.Inventory], ...inv]),
  Product: csv([[...SEED_HEADERS.Product], prodRow("P-1", "Blue Dream 1g"), prodRow("P-C", "Bad, Name"), ...extraProducts]),
  Strain: csv([[...SEED_HEADERS.Strain], ["Hybrid", "Blue Dream", "C", "09/01/2026", "", ""], ["Hybrid", "THC", "C", "09/01/2026", "", ""], ["Indica", "Real Kush", "C", "09/01/2026", "", ""], ...extraStrains]),
  Area: csv([[...SEED_HEADERS.Area], ["Sales Floor", "FALSE", "C1100011", "C", "08/22/2024", "", ""]]),
});
/** The ledger exactly as S-15 leaves it after merging this copy: every row = the copy. */
const ledgerFrom = (copy: readonly SeedEntity[], over: Record<string, Partial<LedgerRow>> = {}): LedgerRow[] =>
  copy.map((e) => ({
    t: e.fileType, id: e.externalId, name: e.filedName, prod: e.productExternalId, state: e.state, source: SEED_SOURCE,
    lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789898400000000", payload: e.seedPayload,
    ...(over[`${e.fileType}/${e.externalId}`] ?? {}),
  }));
const input = (inv: string[][], o: Partial<EqualizeInput> = {}, ledgerOver: Record<string, Partial<LedgerRow>> = {}, extraProducts: string[][] = [], extraStrains: string[][] = []): EqualizeInput => {
  const copy = buildLedgerSeed(texts(inv, extraProducts, extraStrains)).entities;
  return {
    copy, ledger: ledgerFrom(copy, ledgerOver), ours: [], copyAsOf: "2026-11-08", snapshotDate: "2026-11-08", waveDate: "2026-11-15", wave: "W1",
    finalUploadDate: "2026-11-01", countedBarcodes: [],
    licenseNumber: "413541", submittedBy: "Greenway Marijuana", policy: { ...DEFAULT_EQUALIZE_POLICY }, ...o,
  };
};
const holdOf = (p: ReturnType<typeof planEqualizeWave>, id: string) => p.holds.find((h) => h.id === id)?.code ?? null;
const our = (o: Partial<OurLot>): OurLot => ({ externalId: null, lotCode: null, posProductKey: null, destroyed: false, ...o });

describe("S-14 pure self-tests", () => {
  it("ccrs-equalize-core self-tests pass", () => {
    const r = __runCcrsEqualizeCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(15);
  });
});

describe("S-14 dates (CreatedDate is read strictly; never guessed)", () => {
  it("reads M/D/YYYY and MM/DD/YYYY, and refuses everything else", () => {
    expect(parseCcrsDate("8/30/2024")).toBe("2024-08-30");
    expect(parseCcrsDate("08/30/2024")).toBe("2024-08-30");
    expect(parseCcrsDate("12/01/2026")).toBe("2026-12-01");
    for (const bad of ["", "2024-08-30", "13/01/2024", "02/30/2024", "8/30/24", " 8/30/2024", "8/30/2024 ", "8-30-2024", "0/10/2024", "1/0/2024", "8/30/2024 10:00"]) {
      expect(parseCcrsDate(bad), bad).toBeNull();
    }
    expect(parseCcrsDate("2/29/2024")).toBe("2024-02-29");
    expect(parseCcrsDate("2/29/2025")).toBeNull();
  });
});

describe("S-14 which lots a wave zeroes", () => {
  it("a stale open lot becomes one Update to 0 with every filed value kept, in the P20261007A shape", () => {
    const p = planEqualizeWave(input([invRow("STALE-1")]));
    expect(p.lots.map((l) => l.id)).toEqual(["STALE-1"]);
    expect(p.inventoryRows).toEqual([[
      "413541", "Blue Dream", "Sales Floor", "Blue Dream 1g", "10", "0", "25.00", "False", "STALE-1", "Cultivera", "08/30/2024", "Greenway Marijuana", "11/15/2026", "Update",
    ]]);
    expect(CCRS_COLUMNS.Inventory.length).toBe(p.inventoryRows[0].length);
    expect(p.lots[0].qty).toBe("4");
  });
  it("matches the accepted P20261007A Update row column for column (title-case False, by/date repeated)", () => {
    const accepted = read("docs/ccrs-bible/evidence/P20261007A/files/Inventory_413541_20261006222853.csv").split("\r\n").find((l) => l.endsWith(",Update"))!.split(",");
    const ours = planEqualizeWave(input([invRow("STALE-1")])).inventoryRows[0];
    expect(accepted.length).toBe(ours.length);
    expect(ours[7]).toBe(accepted[7]); // IsMedical "False"
    expect(ours[13]).toBe(accepted[13]); // "Update"
    expect(ours[11]).toBe(accepted[11]); // UpdatedBy = the submitter
    expect(accepted[9]).toBe(accepted[11]);
  });
  it("closed lots (QoH 0 in the copy) are counted, never sent (Q-B2 default)", () => {
    const p = planEqualizeWave(input([invRow("Z-1", { "Quantity on Hand": "0" }), invRow("Z-2", { "Quantity on Hand": "0.000" }), invRow("OPEN")]));
    expect(p.lots.map((l) => l.id)).toEqual(["OPEN"]);
    expect(p.counts.alreadyZero).toBe(2);
    expect(p.counts.copyOpen).toBe(1);
  });
  it("a lot in our own system is never zeroed: by assigned id, by lot code, by product key (exact bytes)", () => {
    const p = planEqualizeWave(input([invRow("OURS"), invRow("BYCODE"), invRow("BYKEY"), invRow("DEAD"), invRow("ours"), invRow("STALE")], {
      ours: [our({ externalId: "OURS" }), our({ lotCode: " BYCODE " }), our({ posProductKey: "BYKEY" }), our({ externalId: "DEAD", destroyed: true })],
    }));
    expect(p.lots.map((l) => l.id)).toEqual(["STALE", "ours"]);
    expect(p.counts.ours).toBe(1);
    expect(holdOf(p, "BYCODE")).toBe("H_POSSIBLY_OURS");
    expect(holdOf(p, "BYKEY")).toBe("H_POSSIBLY_OURS");
    expect(holdOf(p, "DEAD")).toBe("H_OURS_DESTROYED");
    expect(holdOf(p, "OURS")).toBeNull();
  });
  it("lots are taken in exact byte order and the wave stops at maxLots (Q-B7); the rest wait for the next wave", () => {
    const ids = ["b", "B", "a.1", "A", "c"];
    const p = planEqualizeWave(input(ids.map((i) => invRow(i)), { policy: { ...DEFAULT_EQUALIZE_POLICY, maxLots: 3 } }));
    expect(p.lots.map((l) => l.id)).toEqual(["A", "B", "a.1"]);
    expect(p.nextWave).toEqual(["b", "c"]);
    expect(p.counts.wave).toBe(3);
    expect(p.counts.nextWave).toBe(2);
  });
  it("sums the quantity removed exactly (no floating point)", () => {
    const p = planEqualizeWave(input([invRow("A", { "Quantity on Hand": "0.1" }), invRow("B", { "Quantity on Hand": "0.2" }), invRow("C", { "Quantity on Hand": "3.50" })]));
    expect(p.counts.sumRemoved).toBe("3.8");
    expect(p.lots.map((l) => l.qty)).toEqual(["0.1", "0.2", "3.50"]);
  });
});

describe("S-14 holds (each one has its reason; nothing is guessed)", () => {
  it("the ledger must hold the lot untouched and merged with this copy (S-15 first)", () => {
    const p = planEqualizeWave(input([invRow("UNC"), invRow("UNK"), invRow("DEL"), invRow("CLOSED"), invRow("TOUCHED"), invRow("FILED"), invRow("OLD"), invRow("MISSING"), invRow("OK")], {}, {
      "Inventory/UNC": { state: "uncertain" }, "Inventory/UNK": { state: "unknown" }, "Inventory/DEL": { state: "deleted" }, "Inventory/CLOSED": { state: "closed" },
      "Inventory/TOUCHED": { lastFile: "f1", lastOp: "Update" }, "Inventory/FILED": { state: "filed", source: "file:Inventory_413541_20261101120000.csv" },
      "Inventory/OLD": { payload: { "Quantity on Hand": "9" } },
    }));
    const missing = p; // MISSING is removed from the ledger below
    expect(holdOf(p, "UNC")).toBe("H_LEDGER_STATE");
    expect(holdOf(p, "UNK")).toBe("H_LEDGER_STATE");
    expect(holdOf(p, "DEL")).toBe("H_LEDGER_STATE");
    expect(holdOf(p, "CLOSED")).toBe("H_LEDGER_STATE");
    expect(holdOf(p, "TOUCHED")).toBe("H_LEDGER_TOUCHED");
    expect(holdOf(p, "FILED")).toBe("H_LEDGER_TOUCHED");
    expect(holdOf(p, "OLD")).toBe("H_LEDGER_NOT_MERGED");
    expect(missing.lots.map((l) => l.id)).toEqual(["MISSING", "OK"]);
    const i2 = input([invRow("MISSING"), invRow("OK")]);
    i2.ledger = i2.ledger.filter((r) => r.id !== "MISSING");
    expect(holdOf(planEqualizeWave(i2), "MISSING")).toBe("H_LEDGER_MISSING");
  });
  it("CreatedDate unreadable, on/after the snapshot, or after the wave day is held [G L0242]", () => {
    const p = planEqualizeWave(input([invRow("BAD", { CreatedDate: "2024-08-30" }), invRow("SAME", { CreatedDate: "11/08/2026" }), invRow("AFTER", { CreatedDate: "11/09/2026" }), invRow("BEFORE", { CreatedDate: "11/07/2026" })]));
    expect(holdOf(p, "BAD")).toBe("H_CREATED_DATE");
    expect(holdOf(p, "SAME")).toBe("H_CREATED_ON_OR_AFTER_SNAPSHOT");
    expect(holdOf(p, "AFTER")).toBe("H_CREATED_ON_OR_AFTER_SNAPSHOT");
    expect(p.lots.map((l) => l.id)).toEqual(["BEFORE"]);
  });
  it("TotalCost 0 is held unless the nominal-cost switch is set (Q-B3); a negative cost is always held [G L0614]", () => {
    const rows = [invRow("ZERO", { TotalCost: "0.00" }), invRow("NEG", { TotalCost: "-1.00" }), invRow("BLANK", { TotalCost: "" }), invRow("OK")];
    const p = planEqualizeWave(input(rows));
    expect(holdOf(p, "ZERO")).toBe("H_ZERO_COST");
    expect(holdOf(p, "NEG")).toBe("H_COST");
    expect(holdOf(p, "BLANK")).toBe("H_COST");
    const q = planEqualizeWave(input(rows, { policy: { ...DEFAULT_EQUALIZE_POLICY, nominalTotalCost: "0.01" } }));
    expect(q.lots.map((l) => l.id)).toEqual(["OK", "ZERO"]);
    expect(q.inventoryRows.find((r) => r[8] === "ZERO")![6]).toBe("0.01");
    expect(q.counts.nominalCost).toBe(1);
    expect(holdOf(q, "NEG")).toBe("H_COST");
  });
  it("a reserved strain (THC/Other/Unknown/blank) is held unless the override names a filed, real strain (Q-B6) [G L0358]", () => {
    const rows = [invRow("THC", { Strain: "THC" }), invRow("OTH", { Strain: " other " }), invRow("UNK", { Strain: "Unknown" }), invRow("BLANK", { Strain: "" }), invRow("OK")];
    const p = planEqualizeWave(input(rows));
    for (const id of ["THC", "OTH", "UNK", "BLANK"]) expect(holdOf(p, id), id).toBe("H_STRAIN_RESERVED");
    const q = planEqualizeWave(input(rows, { policy: { ...DEFAULT_EQUALIZE_POLICY, strainOverride: "Real Kush" } }));
    expect(q.lots.length).toBe(5);
    expect(q.inventoryRows.filter((r) => r[1] === "Real Kush").length).toBe(4);
    expect(q.counts.strainOverride).toBe(4);
    expect(() => planEqualizeWave(input(rows, { policy: { ...DEFAULT_EQUALIZE_POLICY, strainOverride: "Not Filed" } }))).toThrow(EqualizeError);
    expect(() => planEqualizeWave(input(rows, { policy: { ...DEFAULT_EQUALIZE_POLICY, strainOverride: "THC" } }))).toThrow(EqualizeError);
  });
  it("a strain is written in its FILED casing; a strain CCRS does not hold is held [G L0555]", () => {
    const p = planEqualizeWave(input([invRow("CASE", { Strain: "blue dream" }), invRow("NEW", { Strain: "Never Filed" })]));
    expect(p.inventoryRows[0][1]).toBe("Blue Dream");
    expect(holdOf(p, "NEW")).toBe("H_STRAIN_NOT_FILED");
  });
  it("the product name comes from the Product ledger by the lot's Product Identifier; unresolved or unencodable is held [G L0579]", () => {
    const p = planEqualizeWave(input([invRow("NOPROD", { "Product Identifier": "P-GONE" }), invRow("COMMA", { "Product Identifier": "P-C" }), invRow("NAMEDIFF", { Name: "Report Display Name" })]));
    expect(holdOf(p, "NOPROD")).toBe("H_PRODUCT");
    expect(holdOf(p, "COMMA")).toBe("H_UNENCODABLE");
    expect(p.inventoryRows[0][3]).toBe("Blue Dream 1g");
  });
  it("other unreadable values are held: Initial, IsMedical, CreatedBy, license, negative QoH, duplicate delivery rows, long adjustment id", () => {
    const longId = "L" + "x".repeat(96);
    const p = planEqualizeWave(input([
      invRow("INIT", { "Initial Quantity": "ten" }), invRow("MED", { IsMedical: "Y" }), invRow("BY", { CreatedBy: "" }), invRow("BY36", { CreatedBy: "x".repeat(36) }),
      invRow("LIC", { "License Number": "999999" }), invRow("NEGQ", { "Quantity on Hand": "-2" }), invRow("DUP"), invRow("DUP", { "Quantity on Hand": "5" }), invRow(longId),
      invRow("MEDT", { IsMedical: "true" }),
    ]));
    expect(holdOf(p, "INIT")).toBe("H_INITIAL");
    expect(holdOf(p, "MED")).toBe("H_ISMEDICAL");
    expect(holdOf(p, "BY")).toBe("H_CREATED_BY");
    expect(holdOf(p, "BY36")).toBe("H_CREATED_BY");
    expect(holdOf(p, "LIC")).toBe("H_LICENSE");
    expect(holdOf(p, "NEGQ")).toBe("H_NEGATIVE_QOH");
    expect(holdOf(p, "DUP")).toBe("H_DELIVERY_CONFLICT");
    expect(holdOf(p, longId)).toBe("H_ADJ_ID_TOO_LONG");
    expect(p.inventoryRows.map((r) => [r[8], r[7]])).toEqual([["MEDT", "True"]]);
  });
  it("held lots are listed in exact byte order of their ids, whatever the copy's order", () => {
    const p = planEqualizeWave(input([invRow("Z9", { TotalCost: "0.00" }), invRow("A1", { Strain: "THC" }), invRow("M5", { "Initial Quantity": "x" })]));
    expect(p.holds.map((h) => h.id)).toEqual(["A1", "M5", "Z9"]);
  });
  it("every hold code is listed in the counts, in a fixed order, so --expect is stable", () => {
    const p = planEqualizeWave(input([invRow("OK")]));
    expect(Object.keys(p.counts.held)).toEqual([...EQUALIZE_HOLD_CODES]);
    expect(JSON.stringify(planEqualizeWave(input([invRow("OK")])).counts)).toBe(JSON.stringify(p.counts));
  });
});

describe("S-14 refusals (the whole wave stops)", () => {
  const ok = () => input([invRow("A")]);
  it("the pair must be same-day or newer: a snapshot older than the copy is refused (D-14 item 2)", () => {
    expect(() => planEqualizeWave({ ...ok(), snapshotDate: "2026-11-07" })).toThrow(/older than the copy/);
    expect(() => planEqualizeWave({ ...ok(), waveDate: "2026-11-07", snapshotDate: "2026-11-08" })).toThrow(EqualizeError);
    expect(planEqualizeWave({ ...ok(), snapshotDate: "2026-11-10", waveDate: "2026-11-10" }).lots.length).toBe(1);
  });
  it("bad dates, wave label, license, policy values are refused", () => {
    for (const bad of [{ copyAsOf: "2026-02-30" }, { waveDate: "11/15/2026" }, { wave: "w1" }, { wave: "W-1" }, { wave: "" }, { wave: "W1234567890123" }, { licenseNumber: "" }, { submittedBy: "" }, { submittedBy: "a,b" }]) {
      expect(() => planEqualizeWave({ ...ok(), ...bad } as EqualizeInput), JSON.stringify(bad)).toThrow(EqualizeError);
    }
    for (const pol of [{ maxLots: 0 }, { maxLots: 1.5 }, { maxLots: 1_000_001 }, { nominalTotalCost: "0" }, { nominalTotalCost: "-0.01" }, { nominalTotalCost: "1,00" }, { nominalTotalCost: "abc" }]) {
      expect(() => planEqualizeWave({ ...ok(), policy: { ...DEFAULT_EQUALIZE_POLICY, ...pol } }), JSON.stringify(pol)).toThrow(EqualizeError);
    }
  });
  it("no Sales Floor Area on file, a duplicate ledger id, or a duplicate our-lot id stops the wave", () => {
    const i = ok();
    expect(() => planEqualizeWave({ ...i, ledger: i.ledger.filter((r) => r.t !== "Area") })).toThrow(/Sales Floor/);
    expect(() => planEqualizeWave({ ...i, ledger: [...i.ledger, i.ledger[0]] })).toThrow(/duplicate/);
    expect(() => planEqualizeWave({ ...i, ours: [our({ externalId: "X" }), our({ externalId: "X" })] })).toThrow(/twice/);
  });
});

describe("S-14 files: bytes, self-check, emit payload", () => {
  it("separate mode (default, Q-B1): the Inventory file only; it passes the format verifier and the ledger self-check", () => {
    const i = input([invRow("A"), invRow("B")]);
    const p = planEqualizeWave(i);
    const sources = equalizeSources(p, "inventory");
    expect(sources.map((s) => s.type)).toEqual(["Inventory"]);
    expect(verifyCcrsFile("Inventory", sources[0].csv).filter((x) => x.severity === "error")).toEqual([]);
    const files = planOutboxFiles(sources, { licenseNumber: "413541", now: new Date("2026-11-15T20:00:00Z"), lastStamp: null });
    const { view } = buildLedgerView("prod", i.ledger.map((r) => ({ fileType: r.t, externalId: r.id, filedName: r.name, state: r.state, productExternalId: r.prod })));
    expect(verifyOutboxAgainstLedger(view, files)).toEqual([]);
    expect(sources[0].csv.split("\r\n")[1]).toBe("SubmittedDate,11/15/2026");
    expect(() => equalizeSources(p, "both")).toThrow(EqualizeError);
  });
  it("same-batch mode (Q-B1 answered yes): Inventory + Reconciliation adjustments in one emission, both pass", () => {
    const i = input([invRow("A"), invRow("B", { "Quantity on Hand": "2.5" })], { policy: { ...DEFAULT_EQUALIZE_POLICY, sameBatchAdjust: true } });
    const p = planEqualizeWave(i);
    expect(p.adjustmentRows).toEqual([
      ["413541", "A", "Reconciliation", "Inventory audit cleanup - equalize wave W1 - lot not on hand", "4", "11/15/2026", "EQ-W1-A", "Greenway Marijuana", "11/15/2026", "Greenway Marijuana", "11/15/2026", "Insert"],
      ["413541", "B", "Reconciliation", "Inventory audit cleanup - equalize wave W1 - lot not on hand", "2.5", "11/15/2026", "EQ-W1-B", "Greenway Marijuana", "11/15/2026", "Greenway Marijuana", "11/15/2026", "Insert"],
    ]);
    const sources = equalizeSources(p, "both");
    expect(sources.map((s) => s.type)).toEqual(["Inventory", "InventoryAdjustment"]);
    for (const s of sources) expect(verifyCcrsFile(s.type, s.csv).filter((x) => x.severity === "error"), s.type).toEqual([]);
    const files = planOutboxFiles(sources, { licenseNumber: "413541", now: new Date("2026-11-15T20:00:00Z"), lastStamp: null });
    const { view } = buildLedgerView("prod", i.ledger.map((r) => ({ fileType: r.t, externalId: r.id, filedName: r.name, state: r.state, productExternalId: r.prod })));
    expect(verifyEqualizeFiles(view, files, new Set(["A", "B"]))).toEqual([]);
  });
  it("Reconciliation never needs a detail, but ours has one with no comma; quantity is never negative [G L1109] [G L1119]", () => {
    const r = adjustmentRowFor({ licenseNumber: "413541", lotId: "L.1", qty: "0.5", wave: "W2", adjustmentDate: "2026-11-15", createdDate: "2026-11-22", by: "Greenway Marijuana" });
    expect(r[2]).toBe("Reconciliation");
    expect(r[3].includes(",")).toBe(false);
    expect(r[3].length).toBeLessThanOrEqual(250);
    expect(r[5]).toBe("11/15/2026");
    expect(r[8]).toBe("11/22/2026");
    expect(() => adjustmentRowFor({ licenseNumber: "413541", lotId: "L", qty: "-1", wave: "W2", adjustmentDate: "2026-11-15", createdDate: "2026-11-22", by: "G" })).toThrow(EqualizeError);
    expect(() => adjustmentRowFor({ licenseNumber: "413541", lotId: "L", qty: "0", wave: "W2", adjustmentDate: "2026-11-15", createdDate: "2026-11-22", by: "G" })).toThrow(EqualizeError);
  });
  it("10,001 lots become two Inventory chunks of 10,000 and 1 (CCRS_CHUNK_ROWS)", () => {
    const rows = Array.from({ length: 10_001 }, (_, n) => invRow(`L${String(n).padStart(5, "0")}`));
    const p = planEqualizeWave(input(rows, { policy: { ...DEFAULT_EQUALIZE_POLICY, maxLots: 20_000 } }));
    const files = planOutboxFiles(equalizeSources(p, "inventory"), { licenseNumber: "413541", now: new Date("2026-11-15T20:00:00Z"), lastStamp: null });
    expect(files.map((f) => [f.chunkNo, f.chunkOf, f.recordCount])).toEqual([[1, 2, 10_000], [2, 2, 1]]);
  });
  it("the emit payload carries purpose cleanup:stale and the exact bytes", () => {
    const p = planEqualizeWave(input([invRow("A")]));
    const files = planOutboxFiles(equalizeSources(p, "inventory"), { licenseNumber: "413541", now: new Date("2026-11-15T20:00:00Z"), lastStamp: null });
    const pay = equalizeEmitPayload(files);
    expect(EQUALIZE_PURPOSE).toBe("cleanup:stale");
    expect(pay.map((x) => x.purpose)).toEqual(["cleanup:stale"]);
    expect(pay[0].content).toBe(files[0].csv);
  });
  it("the emit SQL is one transaction that also records the wave label, and refuses a payload containing its quote tag", () => {
    const p = planEqualizeWave(input([invRow("A")]));
    const pay = equalizeEmitPayload(planOutboxFiles(equalizeSources(p, "inventory"), { licenseNumber: "413541", now: new Date("2026-11-15T20:00:00Z"), lastStamp: null }));
    const sql = equalizeEmitSql("W1", pay);
    expect(sql.startsWith("begin;\n")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).toContain("public.ccrs_emit_files('prod', $ccrseq$");
    expect(sql).toContain("set wave = 'W1'");
    expect(() => equalizeEmitSql("W1", [{ ...pay[0], content: pay[0].content + "$ccrseq$" }])).toThrow(EqualizeError);
    expect(() => equalizeEmitSql("w1", pay)).toThrow(EqualizeError);
  });
});

describe("S-14 adjustment phase (separate mode): only what the database proves landed", () => {
  const line = (o: Partial<AdjustLine>): AdjustLine => ({ id: "A", file: "Inventory_413541_20261115120000.csv", fileState: "succeeded", rowState: "submitted", entityState: "closed", lastOp: "Update", lastFileName: "Inventory_413541_20261115120000.csv", qoh: "4", ...o });
  it("a lot whose wave Update landed (closed, last touched by the wave file) gets its Reconciliation", () => {
    const r = planAdjustPhase({ wave: "W1", waveDate: "2026-11-15", adjustDate: "2026-11-22", licenseNumber: "413541", submittedBy: "Greenway Marijuana", lines: [line({})] });
    expect(r.rows).toEqual([["413541", "A", "Reconciliation", "Inventory audit cleanup - equalize wave W1 - lot not on hand", "4", "11/15/2026", "EQ-W1-A", "Greenway Marijuana", "11/22/2026", "Greenway Marijuana", "11/22/2026", "Insert"]]);
    expect(r.lotIds).toEqual(["A"]);
  });
  it("anything not proven is held: rejected row, unanswered file, reopened lot, touched later, no qty", () => {
    const r = planAdjustPhase({ wave: "W1", waveDate: "2026-11-15", adjustDate: "2026-11-22", licenseNumber: "413541", submittedBy: "G", lines: [
      line({ id: "REJ", rowState: "rejected" }), line({ id: "UNC", rowState: "uncertain", entityState: "uncertain" }), line({ id: "WAIT", fileState: "uploaded" }),
      line({ id: "OPEN", entityState: "filed" }), line({ id: "LATER", lastFileName: "Inventory_413541_20261120120000.csv" }), line({ id: "NOQ", qoh: null }), line({ id: "ZQ", qoh: "0" }), line({ id: "OK" }),
    ] });
    expect(r.lotIds).toEqual(["OK"]);
    expect(Object.fromEntries(r.holds.map((h) => [h.id, h.code]))).toEqual({
      REJ: "A_ROW_NOT_LANDED", UNC: "A_ROW_NOT_LANDED", WAIT: "A_FILE_UNANSWERED", OPEN: "A_NOT_CLOSED", LATER: "A_TOUCHED_LATER", NOQ: "A_NO_QUANTITY", ZQ: "A_NO_QUANTITY",
    });
  });
  it("refuses an adjust date before the wave date, a duplicate lot line, and no wave files at all", () => {
    const base = { wave: "W1", waveDate: "2026-11-15", licenseNumber: "413541", submittedBy: "G" };
    expect(() => planAdjustPhase({ ...base, adjustDate: "2026-11-14", lines: [line({})] })).toThrow(EqualizeError);
    expect(() => planAdjustPhase({ ...base, adjustDate: "2026-11-22", lines: [line({}), line({})] })).toThrow(/twice/);
    expect(() => planAdjustPhase({ ...base, adjustDate: "2026-11-22", lines: [] })).toThrow(/no Inventory file/);
  });
  it("the separate-mode self-check accepts a wave lot that is closed (as 0249 ccrs_mark_uploaded does) and nothing else", () => {
    const { view } = buildLedgerView("prod", [
      { fileType: "Inventory", externalId: "A", filedName: null, state: "closed" }, { fileType: "Inventory", externalId: "X", filedName: null, state: "closed" },
    ]);
    const r = planAdjustPhase({ wave: "W1", waveDate: "2026-11-15", adjustDate: "2026-11-22", licenseNumber: "413541", submittedBy: "G", lines: [line({})] });
    const extra = adjustmentRowFor({ licenseNumber: "413541", lotId: "X", qty: "1", wave: "W1", adjustmentDate: "2026-11-15", createdDate: "2026-11-22", by: "G" });
    const files = planOutboxFiles([{ type: "InventoryAdjustment", csv: equalizeSources({ ...r, extraRows: [extra] }, "adjustments")[0].csv }], { licenseNumber: "413541", now: new Date("2026-11-22T20:00:00Z"), lastStamp: null });
    expect(verifyOutboxAgainstLedger(view, files).map((x) => x.code)).toEqual(["L_REF_INVENTORY", "L_REF_INVENTORY"]);
    const got = verifyEqualizeFiles(view, files, new Set(r.lotIds));
    expect(got.map((x) => x.message.includes(" X,") || x.message.includes("lot X"))).toEqual([true]);
  });
  it("the adjustment-phase SQL reads only this wave's Inventory files and is parsed strictly", () => {
    const sql = ADJUST_PHASE_SQL("W1");
    expect(sql).toContain("f.wave = 'W1'");
    expect(sql).toContain("f.purpose = 'cleanup:stale'");
    expect(sql).toContain("f.file_type = 'Inventory'");
    expect(sql).toContain("e.seed_payload->>'Quantity on Hand'");
    expect(() => ADJUST_PHASE_SQL("W1'; drop table x; --")).toThrow(EqualizeError);
    const good = JSON.stringify(line({}));
    expect(parseAdjustLine(good)).toEqual(line({}));
    for (const bad of ["{", JSON.stringify({ ...line({}), id: 5 }), JSON.stringify({ ...line({}), qoh: 4 })]) expect(() => parseAdjustLine(bad), bad).toThrow(EqualizeError);
  });
  it("the pre-check SQL refuses a wave label already used and reads the last stamp", () => {
    const sql = waveCheckSql("W2");
    expect(sql).toContain("wave = 'W2'");
    expect(sql).toContain("max(stamp_at)");
    expect(sql).toContain("like 'EQ-W2-%'");
  });
});

describe("S-14 report", () => {
  it("shows the switches with their open question, every count, and escapes ids", () => {
    const p = planEqualizeWave(input([invRow("A|B"), invRow("THC1", { Strain: "THC" })]));
    const md = equalizeReport(p);
    expect(md).toContain("# CCRS equalize wave W1");
    expect(md).toContain("Q-B1");
    expect(md).toContain("Q-B3");
    expect(md).toContain("Q-B6");
    expect(md).toContain("Q-B7");
    expect(md).toContain("A\\|B");
    expect(md).toContain("H_STRAIN_RESERVED");
    expect(md).toContain("[EXAM L0430]");
  });
});

describe("S-14 the SQL CI runs is the SQL the script sends", () => {
  it("scripts/recon/ccrs-equalize-pg-check.sql equals the generator byte for byte", () => {
    expect(read("scripts/recon/ccrs-equalize-pg-check.sql")).toBe(buildEqualizePgCheck());
  });
  it("is registered for CI's migrations job with its PASSED line", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-equalize-pg-check.sql", mustPrint: "CCRS EQUALIZE CHECK PASSED" });
  });
});

describe("S-14 script end to end (saved files, no database)", () => {
  let dir = "";
  let logs: string[] = [];
  let errs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "s14-"));
    logs = []; errs = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => { errs.push(String(m)); });
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }); });
  const setup = () => {
    const t = texts([invRow("STALE-1"), invRow("STALE-2", { TotalCost: "0.00" }), invRow("OURS")]);
    for (const [k, v] of Object.entries(t)) writeFileSync(path.join(dir, `${k}.csv`), v);
    const copy = buildLedgerSeed(t).entities;
    writeFileSync(path.join(dir, "ledger.jsonl"), ledgerFrom(copy).map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(path.join(dir, "ours.jsonl"), JSON.stringify(our({ externalId: "OURS" })) + "\n");
    return ["x", "equalize-ccrs-wave.ts", "--phase", "inventory", "--wave", "W1", "--wave-date", "2026-11-15", "--copy-as-of", "2026-11-08", "--snapshot-date", "2026-11-08",
      "--inventory", path.join(dir, "Inventory.csv"), "--product", path.join(dir, "Product.csv"), "--strain", path.join(dir, "Strain.csv"), "--area", path.join(dir, "Area.csv"),
      "--ledger-file", path.join(dir, "ledger.jsonl"), "--ours-file", path.join(dir, "ours.jsonl"),
      "--final-upload-date", "2026-11-01", "--no-counted-file"];
  };
  it("plans, writes the report and the review files, and prints the counts line", () => {
    const a = setup();
    const rc = main([...a, "--report", path.join(dir, "w1.md"), "--out", path.join(dir, "out")]);
    expect(errs).toEqual([]);
    expect(rc).toBe(0);
    expect(logs.some((l) => l.startsWith("wave counts: {"))).toBe(true);
    expect(readFileSync(path.join(dir, "w1.md"), "utf8")).toContain("STALE-2");
    const out = readdirSync(path.join(dir, "out"));
    expect(out.length).toBe(1);
    expect(out[0]).toMatch(/^Inventory_413541_\d{14}\.csv$/);
    expect(readFileSync(path.join(dir, "out", out[0]), "utf8")).toContain(",STALE-1,");
    expect(logs.some((l) => /plan only/.test(l))).toBe(true);
  });
  it("refuses to overwrite the report, refuses --emit without --psql, and --expect must match", () => {
    const a = setup();
    writeFileSync(path.join(dir, "w1.md"), "keep");
    expect(main([...a, "--report", path.join(dir, "w1.md")])).toBe(2);
    expect(readFileSync(path.join(dir, "w1.md"), "utf8")).toBe("keep");
    expect(logs.some((l) => l.startsWith("wave counts"))).toBe(false); // refused before any work
    expect(main([...a, "--emit"])).toBe(2); // --emit without --psql
    expect(errs.some((e) => e.includes("--emit needs --psql"))).toBe(true);
    // with a database named but no --expect: refused (1) before anything is sent
    // (the saved ledger/ours files are read, so the bogus URL is never contacted)
    errs = [];
    expect(main([...a, "--psql", "postgres://nobody@invalid.invalid/none", "--emit"])).toBe(1);
    expect(errs.some((e) => e.includes("--expect"))).toBe(true);
    errs = [];
    expect(main([...a, "--psql", "postgres://nobody@invalid.invalid/none", "--emit", "--expect", '{"wave":99}'])).toBe(1);
    expect(errs.some((e) => e.includes("counts differ from --expect"))).toBe(true);
  });
  it("refuses bad arguments with exit 2 and a missing file with exit 2", () => {
    const a = setup();
    expect(main(a.map((x) => (x === "W1" ? "w1" : x)))).toBe(1);
    expect(main([...a.slice(0, 2), "--phase", "both"])).toBe(2);
    expect(main(a.map((x) => (x.endsWith("Area.csv") ? path.join(dir, "nope.csv") : x)))).toBe(2);
    expect(main([...a, "--nominal-cost", "abc"])).toBe(1);
    expect(main([...a, "--max-lots", "ten"])).toBe(2);
  });
  it("the policy switches are wired: --nominal-cost releases the zero-cost lot", () => {
    const a = setup();
    expect(main([...a, "--report", path.join(dir, "a.md")])).toBe(0);
    const before = logs.find((l) => l.startsWith("wave counts: "))!;
    logs = [];
    expect(main([...a, "--nominal-cost", "0.01", "--report", path.join(dir, "b.md")])).toBe(0);
    const after = logs.find((l) => l.startsWith("wave counts: "))!;
    expect(JSON.parse(before.slice(13)).wave).toBe(1);
    expect(JSON.parse(after.slice(13)).wave).toBe(2);
    expect(existsSync(path.join(dir, "b.md"))).toBe(true);
  });
});

describe("S-14 the file's name day and its SubmittedDate are the same day", () => {
  it("emits only on the wave day, in Pacific time (the file name is stamped in Pacific [FAQ L0075])", () => {
    expect(sameDayRefusal("2026-11-15", new Date("2026-11-15T20:00:00Z"))).toBeNull();
    // 2026-11-16 06:00 UTC is still 11/15 in Pacific (PST, UTC-8)
    expect(sameDayRefusal("2026-11-15", new Date("2026-11-16T06:00:00Z"))).toBeNull();
    expect(sameDayRefusal("2026-11-15", new Date("2026-11-16T09:00:00Z"))).toMatch(/named for today \(11\/16\/2026/);
    expect(sameDayRefusal("2026-11-15", new Date("2026-11-14T20:00:00Z"))).toMatch(/REFUSED/);
  });
});

describe("S-14 wiring and guards", () => {
  const CORE = read("src/lib/compliance/ccrs-equalize-core.ts");
  const CLI = read("scripts/compliance/equalize-ccrs-wave.ts");
  it("the core is pure: no node:, require, clock, network or database", () => {
    expect(/from "node:|require\(|Date\.now\(|new Date\(\)|supabase|fetch\(/.test(CORE)).toBe(false);
  });
  it("the CLI emits only through ccrs_emit_files in one psql transaction with ON_ERROR_STOP, and needs --expect", () => {
    expect(CLI).toContain('"-v", "ON_ERROR_STOP=1"');
    expect(CLI).toContain("equalizeEmitSql(");
    expect(CLI).toContain("--expect");
    expect(CLI).not.toMatch(/insert into public\.ccrs_files/i);
  });
  it("is registered in the pure self-test runner", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("ccrs-equalize-core", __runCcrsEqualizeCoreTests(), 24)');
  });
  it("no migration was added by this slice", () => {
    const migs = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    expect(migs[migs.length - 1]).toBe("0317_little_safe_exchanges.sql");
  });
  it("the cleanup purpose is one the database allows (0247)", () => {
    expect(read("supabase/migrations/0247_ccrs_ledger.sql")).toContain("'weekly', 'cleanup:stale', 'cleanup:cost', 'cleanup:area'");
  });
});
