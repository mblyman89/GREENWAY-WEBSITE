/**
 * D250 S4 - the two late weeks (11/01-11/07, 11/08-11/14): one verdict and the
 * exact steps per week, every held row with a named reason, the delivery load
 * first, waiting files answered first, the examiner's spacing [EXAM2 L0029],
 * and the hand-over day finding (Cultivera's 93 lines dated 11/01).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HANDOVER_DAY,
  HANDOVER_DAY_SPLIT,
  SPACING_NOTE,
  classifyHeldRow,
  groupHeld,
  lateWeekReadiness,
  lateWeeksOf,
  type LateWeekInput,
} from "@/lib/compliance/ccrs-late-weeks-core";
import { CULTIVERA_NOT_ON_RECORD_REASON } from "@/lib/compliance/ccrs-identity-guard-core";
import { NO_PRODUCT_ID_REASON } from "@/lib/compliance/ccrs-ledger-core";
import { dropEventRowsForHeldLots } from "@/lib/compliance/ccrs-held-back-core";
import { CCRS_COLUMNS } from "@/lib/compliance/ccrs-batch-core";

const read = (p: string) => readFileSync(p, "utf8");
const W1 = { key: "W-2026-11-01", start: "2026-11-01", end: "2026-11-07", due: "2026-11-08" };
const W2 = { key: "W-2026-11-08", start: "2026-11-08", end: "2026-11-14", due: "2026-11-15" };
const files = [
  { type: "Strain", recordCount: 0, empty: true },
  { type: "Inventory", recordCount: 900, empty: false },
  { type: "Sale", recordCount: 1332, empty: false },
];
const input = (over: Partial<LateWeekInput> = {}): LateWeekInput => ({
  env: "prod",
  week: W1,
  status: "overdue",
  delivery: { applied: true, waiting: false, migrationMissing: false },
  build: { error: null, blockingErrors: 0, files, held: [] },
  waitingFiles: 0,
  ...over,
});

describe("lateWeekReadiness - the order of work", () => {
  it("production, delivery not loaded: load it first (nothing else first)", () => {
    const r = lateWeekReadiness(input({ delivery: { applied: false, waiting: false, migrationMissing: false }, waitingFiles: 3 }));
    expect(r.verdict).toBe("load-delivery");
    expect(r.steps.join(" ")).toMatch(/CCRS Records/);
    expect(r.steps.join(" ")).toMatch(/type LOAD/);
  });
  it("0368 missing: apply the migration first", () => {
    const r = lateWeekReadiness(input({ delivery: { applied: false, waiting: false, migrationMissing: true } }));
    expect(r.verdict).toBe("load-delivery");
    expect(r.steps[0]).toContain("0368_ccrs_delivery_loads.sql");
  });
  it("planned but not loaded: press LOAD", () => {
    const r = lateWeekReadiness(input({ delivery: { applied: false, waiting: true, migrationMissing: false } }));
    expect(r.steps[0]).toMatch(/type LOAD and press/);
  });
  it("PREprod never waits for the production delivery", () => {
    expect(lateWeekReadiness(input({ env: "preprod", delivery: { applied: false, waiting: false, migrationMissing: false } })).verdict).toBe("ready");
  });
  it("loaded, files waiting for an answer: answer them before building", () => {
    const r = lateWeekReadiness(input({ waitingFiles: 2 }));
    expect(r.verdict).toBe("answer-waiting");
    expect(r.headline).toContain("2 file(s)");
  });
  it("blocking errors are fixed before upload", () => {
    expect(lateWeekReadiness(input({ build: { error: null, blockingErrors: 1, files, held: [] } })).verdict).toBe("fix-errors");
  });
  it("a build error or no build is never 'ready'", () => {
    expect(lateWeekReadiness(input({ build: { error: "boom", blockingErrors: 0, files: [], held: [] } })).verdict).toBe("not-built");
    expect(lateWeekReadiness(input({ build: null })).verdict).toBe("not-built");
  });
  it("ready: counts rows, lists only non-empty files, spacing per the examiner", () => {
    const r = lateWeekReadiness(input());
    expect(r.verdict).toBe("ready");
    expect(r.records).toBe(2232);
    expect(r.steps[0]).toBe("Download the zip for week 2026-11-01 to 2026-11-07 (Inventory 900, Sale 1332).");
    expect(r.steps[1]).toBe(SPACING_NOTE);
    expect(SPACING_NOTE).toContain("[EXAM2 L0029]");
    expect(r.steps.join(" ")).toMatch(/Record week 2026-11-01 to 2026-11-07 in Step 3/);
  });
  it("recorded week: nothing to do", () => {
    expect(lateWeekReadiness(input({ status: "submitted" })).verdict).toBe("recorded");
    expect(lateWeekReadiness(input({ status: "nothing_to_report" })).verdict).toBe("recorded");
  });
});

describe("the hand-over day (2026-11-01)", () => {
  it("the 11/01 week carries the measured finding with its pins; the next week does not", () => {
    const n = lateWeekReadiness(input()).notes.join(" ");
    expect(HANDOVER_DAY).toBe("2026-11-01");
    expect(HANDOVER_DAY_SPLIT).toEqual({ cultiveraLines: 93, cultiveraLots: 84, ourLines: 89, ourLots: 80, sharedLots: 9, sharedLotAndAmount: 0 });
    expect(n).toContain("93 sale lines");
    expect(n).toContain("[G L1390]");
    expect(n).toContain("[EXAM2 L0008-L0009]");
    expect(lateWeekReadiness(input({ week: W2 })).notes).toEqual([]);
    expect(lateWeekReadiness(input({ week: { key: "W-2026-10-25", start: "2026-10-25", end: "2026-10-31", due: "2026-11-01" } })).notes).toEqual([]);
  });
  it("our 11/01 lines in the sent PREprod file carry our own GWY- sale ids", () => {
    const csv = read("docs/ccrs-bible/evidence/2026-11-10-preprod/sent/Sale_413541_20261110101609.csv").split("\r\n");
    const head = csv[3].split(",");
    const d = head.indexOf("SaleDate");
    const sid = head.indexOf("SaleExternalIdentifier");
    const nov1 = csv.slice(4).filter(Boolean).map((l) => l.split(",")).filter((r) => r[d] === "11/01/2026");
    expect(nov1.length).toBe(HANDOVER_DAY_SPLIT.ourLines);
    expect(nov1.every((r) => r[sid].startsWith("GWY-"))).toBe(true);
    expect(new Set(nov1.map((r) => r[2])).size).toBe(HANDOVER_DAY_SPLIT.ourLots);
  });
});

describe("every held row has a named reason and a next step", () => {
  const SUFFIX = "is not in this Inventory.csv and CCRS does not hold it";
  it("the E56 detail texts the builder writes are the ones classified", () => {
    const C = CCRS_COLUMNS.Sale;
    const row = (lot: string, id: string) => C.map((c) => (c === "InventoryExternalIdentifier" ? lot : c === "SaleDetailExternalIdentifier" ? id : "x"));
    const out = dropEventRowsForHeldLots("Sale", [row("L1", "S1"), row("L2", "S2")], new Set(), new Map([["L1", CULTIVERA_NOT_ON_RECORD_REASON]]));
    const by = Object.fromEntries(out.dropped.map((d) => [d.id, classifyHeldRow("E56_EVENT_ROW_LOT_HELD", d.detail, "prod")]));
    expect(by.S1.key).toBe("lot:cultivera-not-on-record");
    expect(by.S2.key).toBe("event-lot-not-on-record");
    expect(out.dropped[1].detail.endsWith(SUFFIX)).toBe(true);
  });
  it("groups: released-by-load marked, examples capped at 5, largest first", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `S${i}`, label: `S${i}`, detail: `lot L${i} ${SUFFIX}` }));
    const g = groupHeld(
      [
        { file: "Sale", code: "E56_EVENT_ROW_LOT_HELD", rows },
        { file: "Inventory", code: "E41_LEDGER_WITHHELD", rows: [{ id: "a", label: "a", detail: `its product is withheld: ${NO_PRODUCT_ID_REASON}` }] },
      ],
      "prod",
    );
    expect(g.total).toBe(8);
    expect(g.unnamed).toBe(0);
    expect(g.groups[0]).toMatchObject({ key: "event-lot-not-on-record", count: 7, releasedByLoad: true });
    expect(g.groups[0].examples).toHaveLength(5);
    expect(g.groups[1]).toMatchObject({ key: "no-product-id", releasedByLoad: false });
    expect(g.groups[1].nextStep).toMatch(/Assign CCRS Product ids/);
  });
  it("a held Cultivera lot (E52) and its sales are released by the load", () => {
    const g = groupHeld(
      [
        { file: "Inventory", code: "E52_CULTIVERA_LOT_NOT_ON_RECORD", rows: [{ id: "l1", label: "L1", detail: CULTIVERA_NOT_ON_RECORD_REASON }] },
        { file: "Sale", code: "E56_EVENT_ROW_LOT_HELD", rows: [{ id: "S1", label: "S1", detail: `lot L1 is held back: ${CULTIVERA_NOT_ON_RECORD_REASON}` }] },
      ],
      "prod",
    );
    expect(g.groups.map((x) => [x.key, x.releasedByLoad])).toEqual([
      ["cultivera-not-on-record", true],
      ["lot:cultivera-not-on-record", true],
    ]);
  });
  it("a held row without any reason is counted and shouted", () => {
    const r = lateWeekReadiness(input({ build: { error: null, blockingErrors: 0, files, held: [{ file: "Sale", code: "E56_EVENT_ROW_LOT_HELD", rows: [{ id: "S9", label: "S9" }] }] } }));
    expect(r.unnamed).toBe(1);
    expect(r.headline).toMatch(/1 held row\(s\) have NO reason/);
  });
  it("E7 points at the examiner's nominal 0.01 [EXAM2 L0033]", () => {
    expect(classifyHeldRow("E7_TOTALCOST_ZERO", "x", "prod").nextStep).toContain("[EXAM2 L0033]");
  });
});

describe("lateWeeksOf", () => {
  it("only unrecorded completed weeks, oldest first", () => {
    const ws = [
      { week: { ...W2 }, status: "overdue" as const },
      { week: { ...W1 }, status: "overdue" as const },
      { week: { key: "W-2026-10-25", start: "2026-10-25", end: "2026-10-31", due: "2026-11-01" }, status: "before_start" as const },
      { week: { key: "W-2026-10-18", start: "2026-10-18", end: "2026-10-24", due: "2026-10-25" }, status: "submitted" as const },
    ];
    expect(lateWeeksOf(ws).map((w) => w.week.key)).toEqual([W1.key, W2.key]);
  });
});

describe("wiring", () => {
  const page = read("src/app/admin/compliance/ccrs/page.tsx");
  it("the hub shows the late-weeks panel above Step 1, built from the same week build", () => {
    expect(page).toContain('title="Late weeks: ready to upload?"');
    expect(page.indexOf('title="Late weeks: ready to upload?"')).toBeLessThan(page.indexOf("Step 1"));
    expect(page).toMatch(/Promise\.all\(\[weekP, deliveryP\]\)/);
    expect(page).toContain("lateWeeksOf(overview.weeks)");
    expect(page).toContain("waitingFiles: waitingHere.length");
    expect(page).toContain('applied: rows.some((x) => x.status === "applied")');
  });
  it("registered in the pure self-tests", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("ccrs-late-weeks-core", __runCcrsLateWeeksTests\(\), 19\)/);
  });
  it("the panel lists steps and groups", () => {
    const panel = read("src/components/admin/compliance/CcrsLateWeeksPanel.tsx");
    expect(panel).toContain('data-testid="ccrs-late-week-verdict"');
    expect(panel).toContain("released by the delivery load");
  });
});
