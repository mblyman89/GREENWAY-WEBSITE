/**
 * tests/compliance/r50-cultivera-manifest-groups.test.ts — R50 S1.
 *
 * Re-measures, on every CI run, the numbers the R50 bible (§1.1) records
 * about the store's REAL Cultivera export, through the SAME path the
 * reconstruct executor uses: transformWorkbooks().lotSources →
 * planCultiveraManifests. A measurement written in a doc rots; this pins it.
 *
 * It also cross-checks the core against an INDEPENDENT re-implementation
 * written here from the rule's plain-English statement (same vendor, same
 * Pacific day, consecutive gap ≤ G), so a bug shared by the core and its own
 * self-tests cannot hide.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { transformWorkbooks } from "@/lib/pos/transform";
import { planImportLots, parseUsDate, type ImportLotSource } from "@/lib/pos/import-lot-core";
import {
  planCultiveraManifests,
  parseCultiveraTimestamp,
  cultiveraVendorKey,
  isReconstructedManifest,
  isMigrationManifest,
  buildReconstructedLineage,
  reconstructedDedupeKey,
  __runCultiveraManifestGroupCoreTests,
  type CultiveraGroupRow,
} from "@/lib/inventory/cultivera-manifest-group-core";

const INV = "normalized_cultivera/INVENTORIES_NORMALIZED.xlsx";
const PROD = "normalized_cultivera/PRODUCTS_NORMALIZED.xlsx";
const TODAY = "2026-10-12";

/** The committed Products workbook lacks the Description column the transform requires; add it blank. */
function productsBuffer(): Buffer {
  const wb = XLSX.read(fs.readFileSync(PROD));
  const rows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" })
    .map((r) => ({ ...r, Description: "" }));
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(rows), "Sheet1");
  return XLSX.write(out, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const transformed = transformWorkbooks({
  productsBuffer: productsBuffer(),
  inventoriesBuffer: fs.readFileSync(INV),
  productsSheet: "Sheet1",
  inventoriesSheet: "Inventories",
});
const sources: ImportLotSource[] = transformed.lotSources;
const rows: CultiveraGroupRow[] = sources.map((s) => ({
  barcode: s.barcode,
  vendor: s.vendor,
  receivedDateRaw: s.receivedDateRaw,
  units: s.units,
  productName: s.productName,
}));

/** Independent oracle: the rule in plain code, no shared helpers except the parser output. */
function oracle(gapMin: number) {
  const byBarcode = new Map<string, { vendor: string; times: number[] }>();
  for (const s of sources) {
    if (s.units <= 0 || !s.barcode.trim()) continue;
    const e = byBarcode.get(s.barcode) ?? { vendor: s.vendor.replace(/\s+/g, " ").trim().toUpperCase(), times: [] };
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(s.receivedDateRaw.trim());
    if (m) e.times.push(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Number((m[7] ?? "0").padEnd(3, "0").slice(0, 3))));
    byBarcode.set(s.barcode, e);
  }
  const perVendor = new Map<string, number[]>();
  const undatedVendors = new Set<string>();
  let undated = 0;
  for (const e of byBarcode.values()) {
    if (!e.times.length) {
      undated++;
      undatedVendors.add(e.vendor);
      continue;
    }
    const l = perVendor.get(e.vendor) ?? [];
    l.push(Math.min(...e.times));
    perVendor.set(e.vendor, l);
  }
  const sizes: number[] = [];
  for (const ts of perVendor.values()) {
    ts.sort((a, b) => a - b);
    let cur = 1;
    for (let i = 1; i < ts.length; i++) {
      const sameDay = Math.floor(ts[i] / 86400000) === Math.floor(ts[i - 1] / 86400000);
      if (!sameDay || ts[i] - ts[i - 1] > gapMin * 60000) {
        sizes.push(cur);
        cur = 1;
      } else cur++;
    }
    sizes.push(cur);
  }
  return { sessions: sizes.length, singletons: sizes.filter((n) => n === 1).length, largest: Math.max(...sizes), undated, undatedVendors: undatedVendors.size, lots: byBarcode.size };
}

describe("R50 S1: the real export through the executor's path", () => {
  it("reads the committed export (guards the test itself)", () => {
    expect(sources.length).toBe(4346);
    expect(new Set(sources.map((s) => s.barcode)).size).toBe(4256);
    expect(sources.filter((s) => !s.receivedDateRaw.trim()).length).toBe(270);
  });

  it("every non-blank Received date cell is readable with time-of-day (no silent drops)", () => {
    const nonBlank = sources.filter((s) => s.receivedDateRaw.trim());
    const bad = nonBlank.filter((s) => parseCultiveraTimestamp(s.receivedDateRaw)?.precision !== "time");
    expect(bad.map((s) => s.receivedDateRaw)).toEqual([]);
    expect(nonBlank.length).toBe(4076);
  });

  const plan = planCultiveraManifests(rows, { pacificToday: TODAY });

  it("pins the bible §1.1 numbers at the default 60-minute gap", () => {
    expect(plan.gapMinutes).toBe(60);
    expect(plan.summary.lots).toBe(4256);
    expect(plan.summary.lotsTimed).toBe(3987);
    expect(plan.summary.lotsDayOnly).toBe(0);
    expect(plan.summary.lotsUndated).toBe(269);
    expect(plan.summary.sessionGroups).toBe(649);
    expect(plan.summary.singletonSessions).toBe(137);
    expect(plan.summary.largestGroup).toBe(71);
    expect(plan.summary.undatedGroups).toBe(53);
    expect(plan.summary.vendorsWithUndated).toBe(53);
    expect(plan.summary.vendors).toBe(124);
    expect(plan.summary.vendorConflicts).toBe(0);
    expect(plan.summary.undatedReasons).toEqual({ blank: 269, unreadable: 0, out_of_window: 0 });
    expect(plan.groups.length).toBe(649 + 53);
    expect(plan.numberCollisions).toEqual([]);
    expect(plan.unreadableSamples).toEqual([]);
  });

  it("matches the independent oracle at every measured gap", () => {
    const expected: Record<number, [number, number]> = { 10: [654, 138], 30: [652, 138], 60: [649, 137], 120: [649, 137], 240: [649, 137] };
    for (const [g, [sessions, singles]] of Object.entries(expected)) {
      const p = planCultiveraManifests(rows, { pacificToday: TODAY, gapMinutes: Number(g) });
      const o = oracle(Number(g));
      expect(p.summary.sessionGroups, `gap ${g}`).toBe(o.sessions);
      expect(p.summary.singletonSessions, `gap ${g}`).toBe(o.singletons);
      expect(p.summary.largestGroup, `gap ${g}`).toBe(o.largest);
      expect(p.summary.lotsUndated).toBe(o.undated);
      expect(p.summary.vendorsWithUndated).toBe(o.undatedVendors);
      expect(o.sessions).toBe(sessions);
      expect(o.singletons).toBe(singles);
    }
  });

  it("partitions every lot exactly once (nothing lost, nothing doubled)", () => {
    const all = plan.groups.flatMap((g) => g.barcodes);
    expect(all.length).toBe(4256);
    expect(new Set(all).size).toBe(4256);
    expect(new Set(all)).toEqual(new Set(sources.map((s) => s.barcode)));
  });

  it("never mixes vendors inside a group and never crosses a Pacific day", () => {
    const vendorOf = new Map<string, string>();
    for (const s of sources) if (!vendorOf.has(s.barcode)) vendorOf.set(s.barcode, cultiveraVendorKey(s.vendor));
    for (const g of plan.groups) {
      expect(new Set(g.barcodes.map((b) => vendorOf.get(b))).size).toBe(1);
      expect(vendorOf.get(g.barcodes[0])).toBe(g.vendorKey);
      if (g.kind === "session") expect(g.firstWall!.slice(0, 10)).toBe(g.lastWall!.slice(0, 10));
    }
  });

  it("every lot's group day equals the day planImportLots stamps on that lot (lot and manifest agree)", () => {
    const lots = planImportLots(sources).lots;
    const dayOf = new Map(lots.map((l) => [l.ccrsExternalId, l.receivedOn]));
    let checked = 0;
    for (const g of plan.groups) {
      for (const b of g.barcodes) {
        expect(dayOf.has(b)).toBe(true);
        expect(dayOf.get(b) ?? null).toBe(g.day);
        checked++;
      }
    }
    expect(checked).toBe(4256);
    // And R50 fixed the date reader: every dated lot now carries its date.
    expect(lots.filter((l) => l.receivedOn).length).toBe(3987);
  });

  it("known deliveries come out exactly as observed", () => {
    // Largest: TTL HOLDINGS LLC, 2026-06-26 08:23, 71 lots.
    const big = plan.groups.reduce((a, b) => (b.barcodes.length > a.barcodes.length ? b : a));
    expect(big.vendorKey).toBe("TTL HOLDINGS LLC");
    expect(big.firstWall!.startsWith("2026-06-26 08:23:36")).toBe(true);
    expect(big.barcodes.length).toBe(71);
    // Two AGRO COUTURE deliveries on 2025-07-09, 8 h 48 min apart → two manifests.
    const agro = plan.groups.filter((g) => g.vendorKey === "AGRO COUTURE" && g.day === "2025-07-09");
    expect(agro.map((g) => [g.firstWall!.slice(11, 16), g.barcodes.length])).toEqual([
      ["11:45", 2],
      ["20:33", 1],
    ]);
    // The only vendor-day with two sessions.
    const perDay = new Map<string, number>();
    for (const g of plan.groups) if (g.kind === "session") perDay.set(`${g.vendorKey}|${g.day}`, (perDay.get(`${g.vendorKey}|${g.day}`) ?? 0) + 1);
    expect([...perDay].filter(([, n]) => n > 1).map(([k]) => k)).toEqual(["AGRO COUTURE|2025-07-09"]);
    // Longest keyed-in-slowly delivery: I502 DISTRO 2024-10-02, ~113 min span.
    const slow = plan.groups.reduce((a, b) => (b.spanMinutes > a.spanMinutes ? b : a));
    expect(slow.vendorKey).toBe("I502 DISTRO");
    expect(slow.day).toBe("2024-10-02");
    expect(slow.spanMinutes).toBe(113);
    // Biggest undated bucket.
    const und = plan.groups.filter((g) => g.kind === "undated").sort((a, b) => b.barcodes.length - a.barcodes.length)[0];
    expect([und.vendorKey, und.barcodes.length]).toEqual(["CULTIVAR FARMS", 52]);
  });

  it("window: earliest 2024-08-30, latest 2026-07-02, all in store hours 07–22", () => {
    const sessions = plan.groups.filter((g) => g.kind === "session");
    const firsts = sessions.map((g) => g.firstWall!).sort();
    expect(firsts[0].slice(0, 10)).toBe("2024-08-30");
    expect(sessions.map((g) => g.lastWall!).sort().at(-1)!.slice(0, 10)).toBe("2026-07-02");
    for (const g of sessions) {
      const h = Number(g.firstWall!.slice(11, 13));
      expect(h).toBeGreaterThanOrEqual(7);
      expect(h).toBeLessThanOrEqual(22);
    }
  });

  it("is deterministic: shuffled input → byte-identical plan; numbers unique; dedupe keys unique", () => {
    // Shuffle everything, then put each barcode's rows back in their original
    // relative order (the one order the contract keeps: first row labels the lot).
    const idx = rows.map((_, i) => i);
    let seed = 42;
    for (let i = idx.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const slots = new Map<string, number[]>();
    for (const i of idx) slots.set(String(rows[i].barcode), [...(slots.get(String(rows[i].barcode)) ?? []), i]);
    const nextOf = new Map<string, number[]>();
    for (const [b, is] of slots) nextOf.set(b, [...is].sort((x, y) => x - y));
    const shuffled = idx.map((i) => rows[nextOf.get(String(rows[i].barcode))!.shift()!]);
    expect(shuffled.length).toBe(rows.length);
    expect(shuffled.slice(0, 50).map((r) => r.barcode)).not.toEqual(rows.slice(0, 50).map((r) => r.barcode));
    expect(JSON.stringify(planCultiveraManifests(shuffled, { pacificToday: TODAY }))).toBe(JSON.stringify(plan));
    expect(new Set(plan.groups.map((g) => g.manifestNumber)).size).toBe(plan.groups.length);
    expect(new Set(plan.groups.map((g) => g.key)).size).toBe(plan.groups.length);
    expect(new Set(plan.groups.map((g) => reconstructedDedupeKey("imp", g))).size).toBe(plan.groups.length);
  });

  it("lineage of every group is recognized as reconstructed + migration", () => {
    for (const g of plan.groups) {
      const raw = buildReconstructedLineage({ importId: "imp", sourceManifestId: "m", sourceManifestNumber: "POS-IMPORT-x", gapMinutes: 60, group: g });
      expect(isReconstructedManifest({ raw_payload: raw })).toBe(true);
      expect(isMigrationManifest({ raw_payload: raw })).toBe(true);
      expect(raw.lot_count).toBe(g.barcodes.length);
    }
  });

  it("parseUsDate now reads the export (the pre-R50 null bug) through the shared parser", () => {
    expect(parseUsDate("2026-07-02 09:32:07.787000")).toBe("2026-07-02");
    expect(parseUsDate("2026-07-01 20:46:18")).toBe("2026-07-01");
    expect(parseUsDate("06/17/2026")).toBe("2026-06-17");
    expect(parseUsDate("7/2/26")).toBe("2026-07-02");
    expect(parseUsDate("7/2/2026 9:32")).toBe("2026-07-02");
    expect(parseUsDate("Jul 2 2026")).toBeNull();
    expect(parseUsDate("2026-02-30 10:00:00")).toBeNull();
  });

  it("the core's own self-tests pass and keep their floor", () => {
    expect(__runCultiveraManifestGroupCoreTests().passed).toBeGreaterThanOrEqual(110);
  });
});

describe("R50 S1: formats the stored workbook might use instead (never assume which)", () => {
  it("real Excel date cells, read the way transform.ts reads them (raw:false), parse per their number format", () => {
    // Measured with the repo's own xlsx: a true date cell comes back as its
    // FORMATTED text. Default format → "7/2/26" (no time: day precision, never
    // a guessed time); a date-time format → the time survives.
    const read = (dateNF?: string) => {
      const ws = XLSX.utils.aoa_to_sheet([["Received date"], [new Date(Date.UTC(2026, 6, 2, 9, 32, 7))]], { cellDates: true, dateNF } as XLSX.AOA2SheetOpts);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "S");
      const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellDates: false });
      return String(XLSX.utils.sheet_to_json<Record<string, unknown>>(back.Sheets.S, { defval: "", raw: false })[0]["Received date"]);
    };
    const cases: [string | undefined, string, "time" | "day", number][] = [
      [undefined, "7/2/26", "day", 0],
      ["yyyy-mm-dd hh:mm:ss", "2026-07-02 09:32:07", "time", 9],
      ["m/d/yy h:mm", "7/2/26 9:32", "time", 9],
    ];
    for (const [fmt, text, precision, hour] of cases) {
      const got = read(fmt);
      expect(got).toBe(text);
      const t = parseCultiveraTimestamp(got);
      expect(t?.day).toBe("2026-07-02");
      expect(t?.precision).toBe(precision);
      expect(t?.h).toBe(hour);
      expect(parseUsDate(got)).toBe("2026-07-02");
    }
  });

  it("a day-only export still groups (vendor + day), labeled time-unknown", () => {
    const p = planCultiveraManifests(
      [
        { barcode: "1", vendor: "A", receivedDateRaw: "7/2/2026" },
        { barcode: "2", vendor: "A", receivedDateRaw: "07/02/2026" },
        { barcode: "3", vendor: "A", receivedDateRaw: "7/3/2026" },
      ],
      { pacificToday: TODAY },
    );
    expect(p.groups.map((g) => [g.kind, g.day, g.barcodes.length])).toEqual([
      ["day", "2026-07-02", 2],
      ["day", "2026-07-03", 1],
    ]);
  });
});
