/**
 * tests/compliance/pai-discovery.test.ts
 *
 * Vitest mirror for the PURE PAI report-field discovery core. This is the
 * no-F12 mechanism that asks PAI itself for each report's REAL date-filter
 * column name (via the Data API's ReportConfigs list + FIND_CONFIG fields),
 * so Bank Deposits / Cash Loads can be backfilled with the correct F_<Column>
 * filter instead of PAI's default current-month window. Everything here is
 * deterministic parsing/matching/selection — NO network, NO guessing (ambiguous
 * inputs return `confident:false` and are excluded from the applied override).
 */
import { describe, expect, it } from "vitest";
import {
  PAI_LIST_CONFIGS_QUERY,
  parseReportConfigIds,
  matchReportConfig,
  parseReportFields,
  pickDateField,
  buildDiscovery,
  toDateFieldOverride,
  summarizeDiscovery,
  candidateLabel,
  normalizeName,
  resolveReportChoice,
  parseReportSelection,
  summarizeProbeCsv,
  scoreProbe,
  PAI_EXPECTED_DATE_COLUMN,
  type PaiReportConfigId,
  type PaiReportField,
  __runPaiDiscoveryTests,
} from "@/lib/atm/pai-discovery";

const IDS: PaiReportConfigId[] = [
  { reportGuid: "G-CASH", externalName: "ATMCashLoad", name: "ATM Cash Load Report" },
  { reportGuid: "G-SS", externalName: "TerminalTrx", name: "Simple Summary Report" },
  { reportGuid: "G-FM", externalName: "FundsMovement", name: "Funds Movement By Account By Day" },
];

describe("PAI_LIST_CONFIGS_QUERY (matches PAI's own example client)", () => {
  it("selects all report configs ordered by name", () => {
    expect(PAI_LIST_CONFIGS_QUERY).toBe("SELECT * FROM ReportConfigs r ORDER BY r.Name");
  });
});

describe("parseReportConfigIds (Data-API report list)", () => {
  it("parses PascalCase rows and keeps GUID + names", () => {
    const rows = parseReportConfigIds(
      JSON.stringify([{ ReportGUID: "G", ExternalName: "X", Name: "N" }]),
    );
    expect(rows).toEqual([{ reportGuid: "G", externalName: "X", name: "N" }]);
  });

  it("tolerates a wrapper object and camelCase keys", () => {
    const rows = parseReportConfigIds(JSON.stringify({ results: [{ reportGUID: "Z", name: "Zed" }] }));
    expect(rows[0].reportGuid).toBe("Z");
    expect(rows[0].name).toBe("Zed");
  });

  it("drops rows with no GUID (never invents one) and survives bad JSON", () => {
    expect(parseReportConfigIds(JSON.stringify([{ Name: "no guid" }]))).toEqual([]);
    expect(parseReportConfigIds("not json")).toEqual([]);
    expect(parseReportConfigIds("")).toEqual([]);
  });
});

describe("matchReportConfig (tolerant + transparent, never guesses on ambiguity)", () => {
  it("matches each of the three reports confidently by title hint", () => {
    expect(matchReportConfig("cashLoad", IDS).best?.reportGuid).toBe("G-CASH");
    expect(matchReportConfig("simpleSummary", IDS).best?.reportGuid).toBe("G-SS");
    expect(matchReportConfig("fundsMovement", IDS).best?.reportGuid).toBe("G-FM");
  });

  it("is NOT confident when two rows could be the same report", () => {
    const dup: PaiReportConfigId[] = [
      { reportGuid: "A", externalName: "", name: "ATM Cash Load Report" },
      { reportGuid: "B", externalName: "", name: "ATM Cash Load Report (backup)" },
    ];
    const m = matchReportConfig("cashLoad", dup);
    expect(m.confident).toBe(false);
    expect(m.candidates).toHaveLength(2);
    expect(m.best).toBeNull();
  });

  it("returns no candidates when nothing matches", () => {
    const m = matchReportConfig("cashLoad", [{ reportGuid: "Z", externalName: "", name: "User Report" }]);
    expect(m.candidates).toHaveLength(0);
  });
});

describe("parseReportFields (FIND_CONFIG columns)", () => {
  it("reads fields under a success wrapper", () => {
    const fields = parseReportFields(
      JSON.stringify({
        SuccessResponse: true,
        fields: [
          { type: "text", readonly: false, name: "Terminal Number" },
          { type: "date", readonly: false, name: "Settlement Date" },
        ],
      }),
    );
    expect(fields).toHaveLength(2);
    expect(fields[1]).toEqual({ name: "Settlement Date", type: "date", readonly: false });
  });

  it("accepts a top-level fields array and survives bad JSON", () => {
    expect(parseReportFields(JSON.stringify([{ name: "X", type: "date" }]))).toHaveLength(1);
    expect(parseReportFields("nope")).toEqual([]);
  });
});

describe("pickDateField (chooses the real date column, never guesses)", () => {
  const ssFields: PaiReportField[] = [
    { name: "Terminal Number", type: "text", readonly: false },
    { name: "Settlement Date", type: "date", readonly: false },
    { name: "Surch", type: "money", readonly: true },
  ];

  it("prefers the exact expected column with the real name (spaces preserved)", () => {
    const p = pickDateField("simpleSummary", ssFields);
    expect(p.confident).toBe(true);
    expect(p.fieldName).toBe("Settlement Date");
    expect(p.filterKey).toBe("F_Settlement Date");
    expect(p.reason).toBe("expected-column");
  });

  it("falls back to a single date-typed column (by-type)", () => {
    const fm: PaiReportField[] = [
      { name: "Account", type: "text", readonly: false },
      { name: "Post Date", type: "date", readonly: false },
    ];
    const p = pickDateField("fundsMovement", fm);
    expect(p.filterKey).toBe("F_Post Date");
    expect(p.reason).toBe("by-type");
  });

  it("is NOT confident when two date columns are present and none is expected", () => {
    const ambig: PaiReportField[] = [
      { name: "Start Date", type: "date", readonly: false },
      { name: "End Date", type: "date", readonly: false },
    ];
    const p = pickDateField("fundsMovement", ambig);
    expect(p.confident).toBe(false);
    expect(p.fieldName).toBe("");
    expect(p.dateCandidates).toEqual(["Start Date", "End Date"]);
  });

  it("reports none when there is no date-ish column", () => {
    const p = pickDateField("cashLoad", [{ name: "Amount", type: "money", readonly: false }]);
    expect(p.confident).toBe(false);
    expect(p.reason).toBe("none");
    expect(p.dateCandidates).toEqual([]);
  });
});

describe("buildDiscovery + toDateFieldOverride (only confident picks are applied)", () => {
  const fieldsByGuid = new Map<string, PaiReportField[]>([
    ["G-SS", [{ name: "Settlement Date", type: "date", readonly: false }]],
    ["G-FM", [{ name: "Account", type: "text", readonly: false }, { name: "Post Date", type: "date", readonly: false }]],
    ["G-CASH", [{ name: "Trx Time", type: "text", readonly: false }]],
  ]);

  it("produces a confident, correctly-keyed override for all three reports", () => {
    const discoveries = (["cashLoad", "simpleSummary", "fundsMovement"] as const).map((k) =>
      buildDiscovery(k, IDS, fieldsByGuid),
    );
    const override = toDateFieldOverride(discoveries);
    expect(override).toEqual({
      cashLoad: "F_Trx Time",
      simpleSummary: "F_Settlement Date",
      fundsMovement: "F_Post Date",
    });
    expect(summarizeDiscovery(discoveries)).toContain("•");
    // A confident summary must NOT dump a numbered candidate list.
    expect(summarizeDiscovery(discoveries)).not.toContain("    1. ");
  });

  it("candidateLabel prefers the portal (external) name and falls back safely", () => {
    expect(candidateLabel({ reportGuid: "g", externalName: "Bank Deposits", name: "FundsMov" })).toBe(
      "Bank Deposits (FundsMov)",
    );
    expect(candidateLabel({ reportGuid: "g", externalName: "", name: "Only Name" })).toBe("Only Name");
    expect(candidateLabel({ reportGuid: "GUID-X", externalName: "", name: "" })).toBe("GUID-X");
  });

  it("LISTS the numbered candidate names when a report is ambiguous (no audit-log hunting)", () => {
    const rows: PaiReportConfigId[] = [
      { reportGuid: "G-A", externalName: "Bank Deposits Daily", name: "BankDepDaily" },
      { reportGuid: "G-B", externalName: "Bank Deposits Monthly", name: "BankDepMonthly" },
    ];
    const d = buildDiscovery("fundsMovement", rows, new Map());
    expect(d.matched).toBeNull();
    expect(d.configCandidates).toHaveLength(2);
    const summary = summarizeDiscovery([d]);
    expect(summary).toContain("1. Bank Deposits Daily");
    expect(summary).toContain("2. Bank Deposits Monthly");
  });

  it("excludes an ambiguous report from the applied override", () => {
    const ambig = buildDiscovery(
      "fundsMovement",
      IDS,
      new Map([["G-FM", [
        { name: "Start Date", type: "date", readonly: false },
        { name: "End Date", type: "date", readonly: false },
      ]]]),
    );
    expect(ambig.datePick.confident).toBe(false);
    expect(toDateFieldOverride([ambig]).fundsMovement).toBeUndefined();
  });

  it("notes an unmatched report without inventing a config", () => {
    const missing = buildDiscovery("cashLoad", [{ reportGuid: "Z", externalName: "", name: "User Report" }], new Map());
    expect(missing.matched).toBeNull();
    expect(missing.note.toLowerCase()).toContain("couldn");
  });
});

describe("normalizeName + expected columns", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeName("  Settlement   Date ")).toBe("settlement date");
  });
  it("keeps the confirmed expected date columns", () => {
    expect(PAI_EXPECTED_DATE_COLUMN.cashLoad).toBe("Trx Time");
    expect(PAI_EXPECTED_DATE_COLUMN.simpleSummary).toBe("Settlement Date");
    expect(PAI_EXPECTED_DATE_COLUMN.fundsMovement).toBe("Settlement Date");
  });
});

describe("resolveReportChoice (never guesses)", () => {
  const ROWS: PaiReportConfigId[] = [
    { reportGuid: "G-1", externalName: "Default Simple Summary Report", name: "Terminal Trx Data" },
    { reportGuid: "G-2", externalName: "Simple Summary Report w DCC", name: "Trx Data Report w DCC" },
    { reportGuid: "G-3", externalName: "", name: "Terminal Trx Data" },
  ];

  it("resolves a GUID to exactly one row and prefers the GUID in the selection", () => {
    const r = resolveReportChoice(ROWS, { reportGuid: "G-2" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selection.reportGuid).toBe("G-2");
  });

  it("errors on an unknown GUID (no guess)", () => {
    expect(resolveReportChoice(ROWS, { reportGuid: "NOPE" }).ok).toBe(false);
  });

  it("resolves a unique external name and carries the row's GUID", () => {
    const r = resolveReportChoice(ROWS, { name: "Simple Summary Report w DCC" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.selection.reportGuid).toBe("G-2");
  });

  it("refuses an ambiguous name with no GUID (never guesses)", () => {
    const r = resolveReportChoice(ROWS, { name: "Terminal Trx Data" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("2 reports");
  });

  it("errors on an unknown name and on an empty choice", () => {
    expect(resolveReportChoice(ROWS, { name: "nope" }).ok).toBe(false);
    expect(resolveReportChoice(ROWS, {}).ok).toBe(false);
  });
});

describe("parseReportSelection (null-safe, typed)", () => {
  it("returns {} for non-objects", () => {
    expect(Object.keys(parseReportSelection(null)).length).toBe(0);
    expect(Object.keys(parseReportSelection("x")).length).toBe(0);
  });

  it("trims values, keeps guid+name, drops empties and unknown kinds", () => {
    const sel = parseReportSelection({
      simpleSummary: { reportGuid: " G-2 ", name: " Trx " },
      fundsMovement: { name: "Funds Movement By Account By Day" },
      cashLoad: {},
      bogus: { reportGuid: "Z" },
    });
    expect(sel.simpleSummary?.reportGuid).toBe("G-2");
    expect(sel.simpleSummary?.name).toBe("Trx");
    expect(sel.fundsMovement?.name).toBe("Funds Movement By Account By Day");
    expect(sel.fundsMovement?.reportGuid).toBeUndefined();
    expect(sel.cashLoad).toBeUndefined();
    expect("bogus" in sel).toBe(false);
  });
});

describe("matchReportConfig honors a saved selection", () => {
  const DUP: PaiReportConfigId[] = [
    { reportGuid: "A", externalName: "", name: "ATM Cash Load Report" },
    { reportGuid: "B", externalName: "", name: "ATM Cash Load Report (backup)" },
  ];

  it("uses a saved GUID to become confident even when hints are ambiguous", () => {
    const m = matchReportConfig("cashLoad", DUP, { reportGuid: "B" });
    expect(m.confident).toBe(true);
    expect(m.fromSelection).toBe(true);
    expect(m.best?.reportGuid).toBe("B");
  });

  it("uses a saved exact name", () => {
    const m = matchReportConfig("cashLoad", DUP, { name: "ATM Cash Load Report (backup)" });
    expect(m.confident).toBe(true);
    expect(m.best?.reportGuid).toBe("B");
  });

  it("falls back to hints (not a fake match) when the selection is stale", () => {
    const m = matchReportConfig("cashLoad", IDS, { reportGuid: "GONE" });
    expect(m.fromSelection).not.toBe(true);
    expect(m.best?.reportGuid).toBe("G-CASH");
  });
});

describe("summarizeProbeCsv + scoreProbe (evidence, not guessing)", () => {
  it("counts data rows/columns and finds the date column → score 3", () => {
    const s = summarizeProbeCsv("Terminal,Settlement Date,Amount\nHG26499,2024-03-01,1234\nHG26499,2024-03-02,999");
    expect(s.hasData).toBe(true);
    expect(s.rowCount).toBe(2);
    expect(s.columns.length).toBe(3);
    expect(s.dateColumns).toContain("Settlement Date");
    expect(scoreProbe(s)).toBe(3);
  });

  it("data but no date column → score 2", () => {
    const s = summarizeProbeCsv("Terminal,Amount\nHG26499,1234");
    expect(s.hasData).toBe(true);
    expect(s.dateColumns.length).toBe(0);
    expect(scoreProbe(s)).toBe(2);
  });

  it("header only → score 1", () => {
    const s = summarizeProbeCsv("Terminal,Amount");
    expect(s.hasData).toBe(false);
    expect(s.columns.length).toBe(2);
    expect(scoreProbe(s)).toBe(1);
  });

  it("empty → score 0", () => {
    const s = summarizeProbeCsv("");
    expect(s.hasData).toBe(false);
    expect(scoreProbe(s)).toBe(0);
  });

  it("rejects a PAI HTML error page (not counted as data)", () => {
    const s = summarizeProbeCsv("<!DOCTYPE html><html><body>Session expired</body></html>");
    expect(s.hasData).toBe(false);
    expect(s.note).toContain("web page");
    expect(scoreProbe(s)).toBe(0);
  });
});

describe("pure self-tests", () => {
  it("run without throwing", () => {
    expect(() => __runPaiDiscoveryTests()).not.toThrow();
  });
});
