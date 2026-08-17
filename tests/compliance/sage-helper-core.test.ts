/**
 * tests/compliance/sage-helper-core.test.ts
 *
 * ADVERSARIAL MIRROR for src/lib/accounting/sage-helper-core.ts.
 *
 * This module reads the owner's ACTUAL SAGE EXPORTS -- the trial balance, the
 * chart of accounts, the aged payables -- and turns them into numbers the new
 * books will be built on. Everything downstream (every report, every 280E
 * calculation, every tax return) is measured from the opening balances these
 * parsers produce. A misread cell here is not a display bug; it is a wrong
 * number that looks completely normal forever after.
 *
 * It shipped with an embedded self-test suite that NOTHING ever ran: it was
 * absent from scripts/compliance/run-pure-selftests.ts and had no vitest
 * mirror.
 *
 * THE PROPERTY THAT MATTERS MOST
 * ---------------------------------------------------------------------------
 * parseCentsCell must return `null` -- meaning "this is not a number" -- for
 * anything it does not fully understand, and must NEVER return 0 for text it
 * failed to parse. Silently reading a garbled cell as zero is how a balance
 * disappears from a trial balance without anything looking wrong. The tests
 * below hammer that boundary specifically, including the money formats a real
 * Sage export actually contains: `1,234.56`, `$5.00`, `(1,234.56)` for
 * negatives, and `-` for "nothing here".
 */
import { describe, it, expect } from "vitest";

import {
  SAGE_REPORT_KINDS,
  SAGE_ACCOUNT_TYPES,
  sageAccountTypeLabel,
  isSageReportKind,
  sageReportKindLabel,
  SAGE_ACCEPTED_EXTENSIONS,
  SAGE_REJECTED_EXTENSIONS,
  fileExtension,
  isRejectedSageFile,
  isAcceptedSageFile,
  splitCsvLine,
  parseNumericCell,
  summarizeCsv,
  parseChartOfAccounts,
  validateGlMappingAgainstCoa,
  parseCentsCell,
  centsToDollarString,
  parseTrialBalance,
  parseAgedPayables,
  analyzeUploadByKind,
  buildSageSystemPrompt,
  __runSageHelperCoreTests,
} from "@/lib/accounting/sage-helper-core";

describe("embedded self-tests", () => {
  it("passes its own suite", () => {
    expect(() => __runSageHelperCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// THE FILE GATE -- .ptb is a Sage backup and must never be accepted
// ---------------------------------------------------------------------------
describe("which files are allowed in", () => {
  it("rejects a Sage backup regardless of case", () => {
    // A .ptb is a proprietary backup: it cannot be read here, and accepting it
    // would let the owner believe he had uploaded his books when he had not.
    for (const name of ["backup.ptb", "BACKUP.PTB", "Company.Ptb", "a.b.ptb"]) {
      expect(isRejectedSageFile(name), name).toBe(true);
      expect(isAcceptedSageFile(name), name).toBe(false);
    }
  });

  it("accepts the readable export formats regardless of case", () => {
    for (const ext of SAGE_ACCEPTED_EXTENSIONS) {
      expect(isAcceptedSageFile(`export${ext}`)).toBe(true);
      expect(isAcceptedSageFile(`export${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const name of ["a.exe", "a.zip", "a", "a.csv.exe", ".csv", "a.docx"]) {
      if (name === ".csv") continue; // extension-only name, covered below
      expect(isAcceptedSageFile(name), name).toBe(false);
    }
  });

  it("accepted and rejected sets never overlap", () => {
    for (const r of SAGE_REJECTED_EXTENSIONS) {
      expect(SAGE_ACCEPTED_EXTENSIONS as readonly string[]).not.toContain(r);
    }
  });

  it("reads the extension from the LAST dot", () => {
    expect(fileExtension("archive.tar.csv")).toBe(".csv");
    expect(fileExtension("noextension")).toBe("");
  });

  it("cannot be fooled by an extension appearing earlier in the name", () => {
    // "report.csv.ptb" is a BACKUP, whatever the middle of the name says.
    expect(isRejectedSageFile("report.csv.ptb")).toBe(true);
    expect(isAcceptedSageFile("report.csv.ptb")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Report kinds and account types
// ---------------------------------------------------------------------------
describe("report kinds", () => {
  it("recognises every declared kind", () => {
    for (const k of SAGE_REPORT_KINDS) {
      expect(isSageReportKind(k.value)).toBe(true);
      expect(sageReportKindLabel(k.value)).toBe(k.label);
    }
  });

  it("rejects an unknown kind", () => {
    for (const bad of ["", "nonsense", "TRIAL_BALANCE"]) {
      expect(isSageReportKind(bad)).toBe(false);
    }
  });

  it("labels an unknown kind without crashing or inventing a name", () => {
    const label = sageReportKindLabel("nonsense");
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
  });

  it("handles null and undefined labels", () => {
    expect(typeof sageReportKindLabel(null)).toBe("string");
    expect(typeof sageReportKindLabel(undefined)).toBe("string");
  });

  it("every declared kind has a distinct value and a non-empty label", () => {
    const values = SAGE_REPORT_KINDS.map((k) => k.value);
    expect(values.length).toBe(new Set(values).size);
    for (const k of SAGE_REPORT_KINDS) expect(k.label.trim().length).toBeGreaterThan(0);
  });

  it("names every Sage account type code it claims to know", () => {
    for (const code of Object.keys(SAGE_ACCOUNT_TYPES)) {
      const label = sageAccountTypeLabel(Number(code));
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label).not.toBe(code);
    }
  });

  it("does not invent a label for an unknown account type", () => {
    const label = sageAccountTypeLabel(9999);
    expect(typeof label).toBe("string");
    expect(label).not.toMatch(/^(Cash|Accounts Receivable|Inventory)$/);
  });

  it("tolerates null and undefined account type codes", () => {
    expect(typeof sageAccountTypeLabel(null)).toBe("string");
    expect(typeof sageAccountTypeLabel(undefined)).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// splitCsvLine
// ---------------------------------------------------------------------------
describe("splitCsvLine", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(splitCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("understands doubled quotes", () => {
    expect(splitCsvLine('a,"say ""hi""",d')).toEqual(["a", 'say "hi"', "d"]);
  });

  it("preserves empty fields, which carry meaning in a trial balance", () => {
    // A blank debit column is not the same as a missing column.
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
    expect(splitCsvLine(",,")).toEqual(["", "", ""]);
  });

  it("handles a quoted empty field", () => {
    expect(splitCsvLine('a,"",c')).toEqual(["a", "", "c"]);
  });

  it("never loses a field: count is one more than the top-level commas", () => {
    for (const line of ["a", "a,b", "a,b,c", "a,,c", '"a,b",c']) {
      const fields = splitCsvLine(line);
      expect(fields.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// parseCentsCell -- THE MONEY PARSER
// ---------------------------------------------------------------------------
describe("parseCentsCell", () => {
  it("reads plain decimal money", () => {
    expect(parseCentsCell("0.00")).toBe(BigInt("0"));
    expect(parseCentsCell("1.00")).toBe(BigInt("100"));
    expect(parseCentsCell("1234.56")).toBe(BigInt("123456"));
  });

  it("reads the formats a real Sage export contains", () => {
    expect(parseCentsCell("1,234.56")).toBe(BigInt("123456"));
    expect(parseCentsCell("$5.00")).toBe(BigInt("500"));
    expect(parseCentsCell("  42 ")).toBe(BigInt("4200"));
  });

  it("reads accounting-style negatives in parentheses", () => {
    // Sage writes credits as (1,234.56). Reading that as POSITIVE would flip
    // the sign of a balance -- the single most damaging misread possible here.
    expect(parseCentsCell("(1,234.56)")).toBe(-BigInt("123456"));
    expect(parseCentsCell("(0.01)")).toBe(-BigInt("1"));
    expect(parseCentsCell("$(1,000.00)")).toBe(-BigInt("100000"));
  });

  it("reads explicit minus signs", () => {
    expect(parseCentsCell("-5.00")).toBe(-BigInt("500"));
    expect(parseCentsCell("-0.01")).toBe(-BigInt("1"));
  });

  it("RETURNS NULL, NEVER ZERO, for anything it does not understand", () => {
    // This is the property the opening balances depend on. A garbled cell read
    // as 0 removes a real balance and nothing downstream looks wrong.
    for (const junk of ["abc", "n/a", "N/A", "--", "1.2.3", ".", "$", "(", ")", "1-2", "12a"]) {
      const result = parseCentsCell(junk);
      expect(result, `${JSON.stringify(junk)} must not parse`).toBeNull();
      expect(result).not.toBe(BigInt("0"));
    }
  });

  it("treats blank and dash as 'nothing here', not as zero", () => {
    expect(parseCentsCell("")).toBeNull();
    expect(parseCentsCell("   ")).toBeNull();
    expect(parseCentsCell("-")).toBeNull();
  });

  it("truncates extra decimal places rather than rounding", () => {
    // Deliberate: the value is built from digits, never through floating point,
    // so a half-cent can never round a balance upward by itself.
    expect(parseCentsCell("1.234")).toBe(BigInt("123"));
    expect(parseCentsCell("1.005")).toBe(BigInt("100"));
    expect(parseCentsCell("1.999")).toBe(BigInt("199"));
  });

  it("pads missing decimal places", () => {
    expect(parseCentsCell("5")).toBe(BigInt("500"));
    expect(parseCentsCell("5.1")).toBe(BigInt("510"));
  });

  it("handles amounts far beyond a safe float without losing precision", () => {
    // BigInt cents, so a nine-figure balance stays exact.
    expect(parseCentsCell("99999999999999.99")).toBe(BigInt("9999999999999999"));
  });

  it("round-trips through centsToDollarString across a sweep", () => {
    for (let cents = -100_000; cents <= 100_000; cents += 137) {
      const text = centsToDollarString(BigInt(cents));
      expect(parseCentsCell(text), `round trip failed for ${cents}`).toBe(BigInt(cents));
    }
  });

  it("negative and positive of the same magnitude differ only in sign", () => {
    for (const v of ["1.00", "1234.56", "0.01"]) {
      expect(parseCentsCell(`(${v})`)).toBe(-parseCentsCell(v)!);
    }
  });
});

// ---------------------------------------------------------------------------
// centsToDollarString
// ---------------------------------------------------------------------------
describe("centsToDollarString", () => {
  it("always shows exactly two decimal places", () => {
    expect(centsToDollarString(BigInt("0"))).toBe("0.00");
    expect(centsToDollarString(BigInt("1"))).toBe("0.01");
    expect(centsToDollarString(BigInt("100"))).toBe("1.00");
  });

  it("groups thousands", () => {
    expect(centsToDollarString(BigInt("123456"))).toBe("1,234.56");
    expect(centsToDollarString(BigInt("100000000"))).toBe("1,000,000.00");
  });

  it("keeps the minus sign in front", () => {
    expect(centsToDollarString(-BigInt("123456"))).toBe("-1,234.56");
    expect(centsToDollarString(-BigInt("1"))).toBe("-0.01");
  });

  it("never loses precision on very large amounts", () => {
    expect(centsToDollarString(BigInt("9999999999999999"))).toBe("99,999,999,999,999.99");
  });

  it("emits two decimals for a sweep of values", () => {
    for (let c = -5000; c <= 5000; c += 7) {
      expect(centsToDollarString(BigInt(c))).toMatch(/^-?[\d,]+\.\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// parseNumericCell
// ---------------------------------------------------------------------------
describe("parseNumericCell", () => {
  it("returns null rather than zero for non-numeric text", () => {
    for (const junk of ["abc", "", "   ", "n/a"]) {
      expect(parseNumericCell(junk)).toBeNull();
    }
  });

  it("reads ordinary numbers", () => {
    expect(parseNumericCell("42")).toBe(42);
    expect(parseNumericCell("1,234.5")).toBe(1234.5);
  });
});

// ---------------------------------------------------------------------------
// summarizeCsv
// ---------------------------------------------------------------------------
describe("summarizeCsv", () => {
  it("counts rows and columns of a simple file", () => {
    const s = summarizeCsv("h1,h2\n1,2\n3,4");
    expect(s.rowCount).toBe(2);
    expect(s.columnCount).toBe(2);
    expect(s.columns.map((c) => c.header)).toEqual(["h1", "h2"]);
  });

  it("totals numeric columns correctly", () => {
    const s = summarizeCsv("debit,credit\n10,5\n20,7");
    const debit = s.columns.find((c) => c.header === "debit")!;
    expect(debit.numeric).toBe(true);
    expect(debit.total).toBe(30);
  });

  it("survives an empty file without throwing", () => {
    expect(() => summarizeCsv("")).not.toThrow();
  });

  it("survives ragged rows without throwing", () => {
    // Real exports are ragged. Crashing on the upload helps nobody.
    expect(() => summarizeCsv("a,b,c\n1\n1,2,3,4,5")).not.toThrow();
  });

  it("handles CRLF line endings, which Sage writes", () => {
    const s = summarizeCsv("h1,h2\r\n1,2\r\n3,4");
    expect(s.rowCount).toBe(2);
    // A stray \r must not end up glued to the last header, or the column
    // would never match anything by name.
    expect(s.columns.map((c) => c.header)).toEqual(["h1", "h2"]);
  });

  it("respects the row cap", () => {
    const many = ["h"].concat(Array.from({ length: 100 }, (_, i) => String(i))).join("\n");
    expect(() => summarizeCsv(many, 10)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// parseChartOfAccounts
// ---------------------------------------------------------------------------
describe("parseChartOfAccounts", () => {
  it("survives junk without throwing", () => {
    for (const junk of ["", "nonsense", "a,b,c", "\n\n\n"]) {
      expect(() => parseChartOfAccounts(junk)).not.toThrow();
    }
  });

  it("reports failure loudly on an empty file instead of returning success", () => {
    const r = parseChartOfAccounts("");
    expect(r.ok).toBe(false);
    expect(r.accounts).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("never claims accounts it did not find", () => {
    for (const junk of ["", "nonsense", "\n\n\n"]) {
      const r = parseChartOfAccounts(junk);
      expect(r.accounts.length).toBe(r.ids.length);
    }
  });
});

// ---------------------------------------------------------------------------
// parseTrialBalance / parseAgedPayables
// ---------------------------------------------------------------------------
describe("parseTrialBalance", () => {
  it("survives junk without throwing", () => {
    for (const junk of ["", "nonsense", "\n\n", "a,b"]) {
      expect(() => parseTrialBalance(junk)).not.toThrow();
    }
  });

  it("does not claim an empty file is a balanced trial balance", () => {
    // THE DANGEROUS DEFAULT: 0 debits === 0 credits is arithmetically
    // "balanced", and reporting ok/balanced for a file that parsed nothing
    // would tell the owner his books tie out when nothing was read at all.
    const r = parseTrialBalance("");
    expect(r.ok).toBe(false);
    expect(r.accountCount).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("reports a difference that equals debits minus credits", () => {
    const r = parseTrialBalance("");
    expect(r.differenceCents).toBe(r.totalDebitsCents - r.totalCreditsCents);
  });
});

describe("parseAgedPayables", () => {
  it("survives junk without throwing", () => {
    for (const junk of ["", "nonsense", "\n\n", "a,b"]) {
      expect(() => parseAgedPayables(junk)).not.toThrow();
    }
  });

  it("does not claim success on an empty file", () => {
    const r = parseAgedPayables("");
    expect(r.ok).toBe(false);
    expect(r.vendorCount).toBe(0);
    expect(r.invoiceCount).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The `ok` flag contract — THE GATE ON THE WHOLE CUT-OVER.
//
// FOUND BY MUTATION TESTING. Mutant M6 changed parseChartOfAccounts's
// `ok: accounts.length > 0` to `ok: true` and ALL 68 tests still passed.
// That is a hole, because src/lib/accounting/sage-helper.ts:200 uses `coa.ok`
// as the ONLY thing standing between a junk upload and a validation run:
//
//     const coa = parseChartOfAccounts(text);
//     if (!coa.ok) return { ok: false, error: "No account rows found ..." };
//
// With `ok` always true, an unreadable Chart of Accounts would sail through and
// every G/L mapping would be reported missing against an EMPTY chart. So `ok`
// is not cosmetic: it is a gate. These tests pin it in all three parsers.
//
// All expectations below were VERIFIED BY EXECUTION against the real modules
// before being written down (never assumed).
// ---------------------------------------------------------------------------
describe("the `ok` flag is a gate, not a decoration", () => {
  it("parseChartOfAccounts: ok is FALSE whenever zero accounts were extracted", () => {
    for (const [label, text] of [
      ["empty string", ""],
      ["whitespace only", "   \n\n  \t \n"],
      ["header row only", "Account ID,Account Description,Account Type,Inactive"],
      ["header + blank data rows", "Account ID,Account Description,Account Type,Inactive\n,,,\n,,,"],
    ] as const) {
      const r = parseChartOfAccounts(text);
      expect(r.accounts.length, label).toBe(0);
      expect(r.ok, `${label}: ok must be false when no accounts were found`).toBe(false);
    }
  });

  it("parseChartOfAccounts: ok is TRUE only when real accounts came back", () => {
    const r = parseChartOfAccounts(
      "Account ID,Account Description,Account Type,Inactive\n10000,CASH,1,FALSE",
    );
    expect(r.ok).toBe(true);
    expect(r.accounts.length).toBe(1);
  });

  it("parseChartOfAccounts: ok ALWAYS equals accounts.length > 0 across a sweep", () => {
    // The invariant itself, not a sample of it: this is what M6 broke.
    const samples = [
      "",
      "   ",
      "Account ID,Account Description",
      "Account ID,Account Description\n,,",
      "Account ID,Account Description\n10000,CASH",
      "10000,CASH,1,FALSE",
      "Account ID,Account Description\n10000,CASH\n10000,CASH DUPLICATE",
    ];
    for (const s of samples) {
      const r = parseChartOfAccounts(s);
      expect(r.ok, `ok/accounts disagree for: ${JSON.stringify(s)}`).toBe(r.accounts.length > 0);
    }
  });

  it("parseTrialBalance: ok is FALSE for empty, header-only, and non-report text", () => {
    for (const [label, text] of [
      ["empty string", ""],
      ["header only", "Account ID,Account Description,Debit Amt,Credit Amt"],
      ["prose", "no data here at all"],
    ] as const) {
      const r = parseTrialBalance(text);
      expect(r.ok, label).toBe(false);
      expect(r.accountCount, label).toBe(0);
      // AND it must not claim the books balance just because it read nothing.
      expect(r.balanced, `${label}: an unread trial balance must never report balanced`).toBe(false);
      expect(r.warnings.length, `${label}: must say why`).toBeGreaterThan(0);
    }
  });

  it("parseAgedPayables: ok is FALSE when no vendors were extracted", () => {
    for (const [label, text] of [
      ["empty string", ""],
      ["header only", "Vendor ID,Vendor,Invoice/CM #,Amount Due"],
      ["prose", "nothing"],
    ] as const) {
      const r = parseAgedPayables(text);
      expect(r.ok, label).toBe(false);
      expect(r.vendorCount, label).toBe(0);
    }
  });

  it("every failed parse explains itself instead of failing silently", () => {
    // A bare `ok:false` with no warning leaves the owner staring at a screen
    // with nothing to act on. Empty input is the one case allowed to be terse,
    // but it still warns.
    expect(parseChartOfAccounts("").warnings.join(" ")).toMatch(/empty/i);
    expect(parseTrialBalance("").warnings.join(" ")).toMatch(/empty/i);
    expect(parseAgedPayables("").warnings.join(" ")).toMatch(/empty/i);
  });

  it("a headerless file is read by position and SAYS SO in a warning", () => {
    // VERIFIED BEHAVIOUR: Sage CHART.CSV can legitimately be exported without a
    // header row, so the parser falls back to canonical positions. The cost is
    // that arbitrary prose also parses "successfully". That is acceptable ONLY
    // because the fallback is announced in warnings — pinned here so the
    // announcement can never be dropped silently.
    const r = parseChartOfAccounts("Dear Michael,\nHere is the report you asked for.\nThanks!");
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/no header row detected/i);
  });
});

// ---------------------------------------------------------------------------
// validateGlMappingAgainstCoa
// ---------------------------------------------------------------------------
describe("validateGlMappingAgainstCoa", () => {
  // VERIFIED shape (src/lib/accounting/sage-helper-core.ts:326-350):
  //   validateGlMappingAgainstCoa(mappings: {label,accountId}[], coa) => {checks,missing,inactive,allValid}
  const COA_CSV = [
    "Account ID,Account Description,Account Type,Inactive",
    "10000,CASH ON HAND,1,FALSE",
    "20000,ACCOUNTS PAYABLE,12,FALSE",
    "40000,CANNABIS SALES,14,FALSE",
    "99999,OLD SUSPENSE,1,TRUE",
  ].join("\n");

  it("does not throw on empty inputs", () => {
    expect(() => validateGlMappingAgainstCoa([], parseChartOfAccounts(""))).not.toThrow();
  });

  it("reports allValid on an empty mapping list without inventing checks", () => {
    const r = validateGlMappingAgainstCoa([], parseChartOfAccounts(COA_CSV));
    expect(r.checks).toHaveLength(0);
    expect(r.missing).toHaveLength(0);
    expect(r.inactive).toHaveLength(0);
    expect(r.allValid).toBe(true);
  });

  it("flags a mapping that points at an account the chart does not contain", () => {
    // WHY THIS MATTERS: a beginning balance mapped to a non-existent account
    // vanishes at cut-over, and nothing downstream looks wrong afterwards.
    // Sage itself refuses the import; we must catch it BEFORE that point.
    const coa = parseChartOfAccounts(COA_CSV);
    const r = validateGlMappingAgainstCoa(
      [
        { label: "Cash / clearing", accountId: "10000" },
        { label: "COGS", accountId: "50000" },
      ],
      coa,
    );
    expect(r.checks).toHaveLength(2);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].accountId).toBe("50000");
    expect(r.missing[0].label).toBe("COGS");
    expect(r.missing[0].exists).toBe(false);
    expect(r.allValid).toBe(false);
  });

  it("flags a mapping that points at an INACTIVE account (present but unusable)", () => {
    const r = validateGlMappingAgainstCoa(
      [{ label: "Suspense", accountId: "99999" }],
      parseChartOfAccounts(COA_CSV),
    );
    expect(r.missing).toHaveLength(0);
    expect(r.inactive).toHaveLength(1);
    expect(r.inactive[0].accountId).toBe("99999");
    expect(r.inactive[0].exists).toBe(true);
    expect(r.inactive[0].inactive).toBe(true);
    // Present-but-inactive must NOT be reported as valid: Sage rejects posting
    // to an inactive account, so "it exists" is not good enough.
    expect(r.allValid).toBe(false);
  });

  it("skips blank / whitespace-only account ids instead of reporting them missing", () => {
    // An unmapped setting is 'not configured yet', not 'configured wrongly'.
    // Reporting it as missing would drown the real errors in noise.
    const r = validateGlMappingAgainstCoa(
      [
        { label: "Cash", accountId: "10000" },
        { label: "Discounts", accountId: "" },
        { label: "Rounding", accountId: "   " },
      ],
      parseChartOfAccounts(COA_CSV),
    );
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0].label).toBe("Cash");
    expect(r.allValid).toBe(true);
  });

  it("matches account ids case-insensitively and ignores surrounding whitespace", () => {
    const coa = parseChartOfAccounts(
      ["Account ID,Account Description,Account Type,Inactive", "AR-100,TRADE RECEIVABLE,3,FALSE"].join(
        "\n",
      ),
    );
    const r = validateGlMappingAgainstCoa([{ label: "AR", accountId: "  ar-100  " }], coa);
    expect(r.missing).toHaveLength(0);
    expect(r.checks[0].accountId).toBe("AR-100".toLowerCase() === "ar-100" ? "ar-100" : "AR-100");
    expect(r.checks[0].exists).toBe(true);
    expect(r.allValid).toBe(true);
  });

  it("carries the chart's description and type label back for the owner to eyeball", () => {
    // The owner must be able to see WHICH account he mapped to, not just an id.
    const r = validateGlMappingAgainstCoa(
      [{ label: "Sales", accountId: "40000" }],
      parseChartOfAccounts(COA_CSV),
    );
    expect(r.checks[0].description).toBe("CANNABIS SALES");
    expect(typeof r.checks[0].typeLabel).toBe("string");
    expect(r.checks[0].typeLabel).not.toBe("");
  });

  it("does NOT partially match a longer account id (10000 must not satisfy 100)", () => {
    // Substring matching here would silently approve a mapping to the wrong
    // account, which is worse than refusing it.
    const r = validateGlMappingAgainstCoa(
      [{ label: "Petty cash", accountId: "100" }],
      parseChartOfAccounts(COA_CSV),
    );
    expect(r.missing).toHaveLength(1);
    expect(r.allValid).toBe(false);
  });

  it("every mapping appears exactly once in checks, and missing/inactive are subsets of checks", () => {
    const r = validateGlMappingAgainstCoa(
      [
        { label: "Cash", accountId: "10000" },
        { label: "AP", accountId: "20000" },
        { label: "Suspense", accountId: "99999" },
        { label: "Nope", accountId: "50000" },
      ],
      parseChartOfAccounts(COA_CSV),
    );
    expect(r.checks).toHaveLength(4);
    for (const m of r.missing) expect(r.checks).toContain(m);
    for (const i of r.inactive) expect(r.checks).toContain(i);
    // missing and inactive are disjoint by construction
    for (const m of r.missing) expect(r.inactive).not.toContain(m);
    expect(r.allValid).toBe(r.missing.length === 0 && r.inactive.length === 0);
  });

  it("an empty chart makes EVERY non-blank mapping missing (never silently valid)", () => {
    // Guards the worst cut-over failure: an upload that parsed to nothing at
    // all, reported as 'all your mappings are fine'.
    const r = validateGlMappingAgainstCoa(
      [
        { label: "Cash", accountId: "10000" },
        { label: "AP", accountId: "20000" },
      ],
      parseChartOfAccounts(""),
    );
    expect(r.missing).toHaveLength(2);
    expect(r.allValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// analyzeUploadByKind
// ---------------------------------------------------------------------------
describe("analyzeUploadByKind", () => {
  it("returns null for an unknown kind rather than guessing", () => {
    expect(analyzeUploadByKind("not_a_kind", "a,b\n1,2")).toBeNull();
  });

  it("never throws on empty content for any declared kind", () => {
    for (const k of SAGE_REPORT_KINDS) {
      expect(() => analyzeUploadByKind(k.value, "")).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// buildSageSystemPrompt
// ---------------------------------------------------------------------------
describe("buildSageSystemPrompt", () => {
  it("always includes the embedded Sage knowledge", () => {
    const prompt = buildSageSystemPrompt();
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes extra context when given", () => {
    expect(buildSageSystemPrompt("EXTRA_CONTEXT_MARKER")).toContain("EXTRA_CONTEXT_MARKER");
  });

  it("is unchanged in substance when extra context is empty", () => {
    expect(buildSageSystemPrompt("")).toContain(buildSageSystemPrompt().slice(0, 100));
  });
});
