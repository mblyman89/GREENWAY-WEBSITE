/**
 * R41 S1: the Timberland profile and its two verbatim sources.
 *
 * What this pins (R41-TIMBERLAND-SLICE-PLAN.md, S1 "Tests"):
 *   - every quote is a substring of its mirror (whitespace flattened)
 *   - routing check digit passes; ODFI = first 8 digits of the routing
 *   - Timberland's 6-day prenote wait >= Nacha's 3
 *   - the restricted and allowed SEC lists don't overlap
 *   - daily limit <= monthly limit
 *   - no 9-digit (or longer) account number in the profile file or mirrors
 * Plus: the mirrors keep the provenance the plan requires, Brenda's emails are
 * byte-for-byte, and the open-question list matches section 9 of the plan.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dfiId8, isValidRouting } from "@/lib/payments/nacha-core";
import { PRENOTE_WAIT_BANKING_DAYS as NACHA_PRENOTE_WAIT } from "@/lib/payments/ach-authorization-core";
import {
  ALLOWED_SEC,
  CREDIT_LEAD_BANKING_DAYS,
  HOLIDAY_SHIFT_CREDITS,
  LIMIT_DAILY_IN_PROCESS_CENTS,
  LIMIT_MONTHLY_CENTS,
  LIMIT_PER_ENTRY_CENTS,
  LIMIT_PER_FILE_CENTS,
  OPEN_QUESTIONS,
  PAYROLL_PLACEMENT_QUOTES,
  PRENOTE_WAIT_BANKING_DAYS,
  RESTRICTED_SEC,
  TIMBERLAND_AGREEMENT_PDF_SHA256,
  TIMBERLAND_ODFI,
  TIMBERLAND_PROFILE,
  TIMBERLAND_ROUTING,
  TIMBERLAND_SOURCE_FILES,
  allTimberlandCites,
  findLongDigitRuns,
  flattenWs,
  timberlandProfileProblems,
  type TimberlandFact,
} from "@/lib/payments/timberland-profile-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const AGREEMENT = read(TIMBERLAND_SOURCE_FILES["timberland-ach-agreement-2026-10-09"]);
const BRENDA = read(TIMBERLAND_SOURCE_FILES["timberland-brenda-2026-10"]);
const PROFILE_SRC = read("src/lib/payments/timberland-profile-core.ts");
const FLAT: Record<string, string> = {
  "timberland-ach-agreement-2026-10-09": flattenWs(AGREEMENT),
  "timberland-brenda-2026-10": flattenWs(BRENDA),
};

describe("R41 S1: every quote is in its mirror", () => {
  const cites = allTimberlandCites();
  it("collects every cite (and there are many)", () => {
    expect(cites.length).toBeGreaterThanOrEqual(60);
  });
  it.each(cites.map((c, i) => [i, c.key, c.cite.source, c.cite.quote] as const))(
    "#%i %s (%s): %s",
    (_i, _key, source, quote) => {
      expect(FLAT[source]).toContain(flattenWs(quote));
    },
  );
  it("a quote with one letter changed is NOT found (the check is exact, not fuzzy)", () => {
    const q = flattenWs(TIMBERLAND_PROFILE.creditLeadBankingDays.cites[0]!.quote);
    const changed = q.replace("credit transactions", "credit transactiens");
    expect(changed).not.toBe(q);
    expect(FLAT["timberland-ach-agreement-2026-10-09"]).not.toContain(changed);
  });
  it("code never quotes the three scan-uncertain words (Intemet, Retum, retums)", () => {
    for (const { cite } of cites) expect(cite.quote).not.toMatch(/Intemet|Internet Banking|Retum|retums/);
  });
});

describe("R41 S1: the profile agrees with itself and with Nacha", () => {
  it("has no consistency problems", () => {
    expect(timberlandProfileProblems()).toEqual([]);
  });
  it("routing passes the ABA check digit and the ODFI is its first 8 digits", () => {
    expect(TIMBERLAND_ROUTING).toBe("325170754");
    expect(isValidRouting(TIMBERLAND_ROUTING)).toBe(true);
    expect(TIMBERLAND_ODFI).toBe(dfiId8(TIMBERLAND_ROUTING));
    expect(TIMBERLAND_ODFI).toBe("32517075");
  });
  it("Timberland's prenote wait (6) is at least Nacha's (3)", () => {
    expect(NACHA_PRENOTE_WAIT).toBe(3);
    expect(PRENOTE_WAIT_BANKING_DAYS).toBe(6);
    expect(PRENOTE_WAIT_BANKING_DAYS).toBeGreaterThanOrEqual(NACHA_PRENOTE_WAIT);
  });
  it("allowed and restricted SEC lists do not overlap", () => {
    expect([...ALLOWED_SEC]).toEqual(["PPD", "CCD"]);
    expect([...RESTRICTED_SEC]).toEqual(["IAT", "CTX", "TEL", "POP", "BOC", "ARC", "RCK"]);
    expect(ALLOWED_SEC.filter((s) => RESTRICTED_SEC.includes(s))).toEqual([]);
  });
  it("entry <= file <= daily <= monthly, all in whole cents", () => {
    for (const c of [LIMIT_PER_ENTRY_CENTS, LIMIT_PER_FILE_CENTS, LIMIT_DAILY_IN_PROCESS_CENTS, LIMIT_MONTHLY_CENTS]) {
      expect(Number.isInteger(c)).toBe(true);
    }
    expect(LIMIT_PER_ENTRY_CENTS).toBeLessThanOrEqual(LIMIT_PER_FILE_CENTS);
    expect(LIMIT_PER_FILE_CENTS).toBeLessThanOrEqual(LIMIT_DAILY_IN_PROCESS_CENTS);
    expect(LIMIT_DAILY_IN_PROCESS_CENTS).toBeLessThanOrEqual(LIMIT_MONTHLY_CENTS);
    expect(LIMIT_DAILY_IN_PROCESS_CENTS).toBe(5_000_000);
    expect(LIMIT_MONTHLY_CENTS).toBe(10_000_000);
  });
  it("the plan's two timing facts: 2 banking days lead, holidays move credits to the PRIOR day", () => {
    expect(CREDIT_LEAD_BANKING_DAYS).toBe(2);
    expect(HOLIDAY_SHIFT_CREDITS).toBe("prior");
  });
  it("every bank fact is cited and labelled; Greenway's own margin is never dressed as a bank rule", () => {
    for (const [key, f] of Object.entries(TIMBERLAND_PROFILE) as [string, TimberlandFact<unknown>][]) {
      expect(f.label.length, key).toBeGreaterThan(0);
      if (f.kind === "bank") expect(f.cites.length, key).toBeGreaterThan(0);
      else expect(f.cites, key).toEqual([]);
    }
    expect(TIMBERLAND_PROFILE.safetyMarginMinutes.kind).toBe("greenway_policy");
  });
});

describe("R41 S1: the public repo never shows the full account number", () => {
  // The redaction rule is checked as a SHAPE, never by writing the real number
  // into this file (which is itself public).
  it.each([
    ["profile core", PROFILE_SRC],
    ["agreement mirror", AGREEMENT],
    ["Brenda mirror", BRENDA],
  ])("%s has no 9+ digit run other than the routing number", (_name, text) => {
    expect(findLongDigitRuns(text)).toEqual([]);
  });
  it("the detector does catch a planted long number", () => {
    expect(findLongDigitRuns("account 123456786048 at the bank")).toEqual(["123456786048"]);
  });
  it("the agreement mirror shows the account only as [ACCOUNT ENDING 6048]", () => {
    expect(AGREEMENT).toContain("[ACCOUNT ENDING 6048]");
    expect(AGREEMENT).not.toMatch(/\d{5,}6048\b/);
  });
  it("no phone other than Timberland's published 1-800 line, and no email address", () => {
    const phones = AGREEMENT.match(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b|\(\d{3}\)\s*\d{3}-\d{4}/g) ?? [];
    expect(phones.every((p) => p === "800-562-8761")).toBe(true);
    for (const t of [AGREEMENT, BRENDA, PROFILE_SRC]) expect(t).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});

describe("R41 S1: provenance of the two mirrors", () => {
  it("the agreement mirror carries the original PDF's sha256, says the PDF is not in the repo, and is final (not DRAFT)", () => {
    expect(TIMBERLAND_AGREEMENT_PDF_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(AGREEMENT).toContain(`sha256 of the original PDF: ${TIMBERLAND_AGREEMENT_PDF_SHA256}`);
    expect(AGREEMENT).toContain("The original PDF is NOT in this repository");
    expect(AGREEMENT.split("\n")[0]).not.toMatch(/DRAFT/);
    expect(AGREEMENT).toContain("provided by the owner");
  });
  it("records the scan-uncertain words honestly instead of guessing", () => {
    expect(AGREEMENT).toMatch(/"Intemet".*kept as it appears/);
    expect(AGREEMENT).toContain('MAY be "Internet"');
    expect(AGREEMENT).toContain("Typos that are in the ORIGINAL and are kept as printed");
  });
  it("has all 12 scan pages, in order, plus the verified form transcription", () => {
    const pages = [...AGREEMENT.matchAll(/===== \[scan page (\d\d)\] =====/g)].map((m) => m[1]);
    expect(pages).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
    expect(AGREEMENT).toContain("===== VERIFIED TRANSCRIPTION OF THE FORM PAGES");
  });
  it("Brenda's emails are kept byte-for-byte (sha256 of each body is pinned)", () => {
    const e1 = BRENDA.slice(BRENDA.indexOf("\u201c Great questions."), BRENDA.indexOf("this process.\u201d") + "this process.\u201d".length);
    const e2 = BRENDA.slice(BRENDA.indexOf("1. GREENWAY MARIJUA"), BRENDA.indexOf("10. Yes") + "10. Yes".length);
    expect(createHash("sha256").update(e1, "utf8").digest("hex")).toBe(E1_SHA);
    expect(createHash("sha256").update(e2, "utf8").digest("hex")).toBe(E2_SHA);
    expect(e1).toContain("\u00a0"); // non-breaking spaces kept as received
  });
  it("says plainly that the numbered questions are not Brenda's words", () => {
    expect(BRENDA).toContain("The questions are NOT Brenda's words.");
    expect(BRENDA).toContain("provided by the owner");
  });
  it("both mirrors are listed in the ACH README", () => {
    const readme = read("docs/authorities/ach/README.md");
    expect(readme).toContain("timberland-ach-agreement-2026-10-09.redacted.txt");
    expect(readme).toContain("timberland-brenda-2026-10.txt");
    expect(readme).toContain(TIMBERLAND_AGREEMENT_PDF_SHA256.slice(0, 16));
  });
  it("the agreement has a MANIFEST row with the PDF's size, hash prefix, and the mirror's real line and byte counts", () => {
    const row = read("docs/authorities/MANIFEST.tsv")
      .split("\n")
      .find((l) => l.startsWith("ach/timberland-ach-agreement-2026-10-09.redacted.txt\t"));
    expect(row).toBeDefined();
    const [, pdf, pdfBytes, sha16, txtBytes, txtLines, pages] = row!.split("\t");
    expect(pdf).toBe("Signed_ACH_Origination_Agreement.pdf");
    expect(pdfBytes).toBe("4406241");
    expect(sha16).toBe(TIMBERLAND_AGREEMENT_PDF_SHA256.slice(0, 16));
    expect(Number(txtBytes)).toBe(Buffer.byteLength(AGREEMENT, "utf8"));
    expect(Number(txtLines)).toBe(AGREEMENT.split("\n").length - (AGREEMENT.endsWith("\n") ? 1 : 0));
    expect(pages).toBe("12");
  });
  it("the pure self-test is registered in CI with a floor of at least 42 assertions", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    const m = runner.match(/assertRan\("timberland-profile-core", __runTimberlandProfileCoreTests\(\), (\d+)\)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(42);
    expect(runner).toMatch(/import \{ __runTimberlandProfileCoreTests \} from "\.\.\/\.\.\/src\/lib\/payments\/timberland-profile-core"/);
  });
});

describe("R41 S1: open questions match plan section 9", () => {
  it("Q1 and Q3-Q13 (Q2 removed by the owner), plus Q14 found in S1", () => {
    expect(OPEN_QUESTIONS.map((q) => q.id)).toEqual(["Q1", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14"]);
  });
  it("only Q1 is information only, and every question has a strict default on screen", () => {
    expect(OPEN_QUESTIONS.filter((q) => q.infoOnly).map((q) => q.id)).toEqual(["Q1"]);
    for (const q of OPEN_QUESTIONS) {
      expect(q.label.length, q.id).toBeGreaterThan(10);
      expect(q.strictDefault.length, q.id).toBeGreaterThan(10);
      for (const k of q.affects) expect(k in TIMBERLAND_PROFILE, `${q.id} -> ${k}`).toBe(true);
    }
  });
  it("the strict defaults the later slices rely on are stated (Q3 both months, Q7 upload, Q9 Fridays closed)", () => {
    const d = Object.fromEntries(OPEN_QUESTIONS.map((q) => [q.id, q.strictDefault]));
    expect(d.Q3).toMatch(/BOTH its upload month and its effective month/);
    expect(d.Q7).toMatch(/earliest upload day/);
    expect(d.Q9).toMatch(/NOT usable/);
  });
  it("Q14 rests on two real sentences from Brenda that point different ways", () => {
    for (const c of PAYROLL_PLACEMENT_QUOTES) expect(FLAT[c.source]).toContain(flattenWs(c.quote));
    expect(PAYROLL_PLACEMENT_QUOTES[0]!.quote).toMatch(/discretionary data field/);
    expect(PAYROLL_PLACEMENT_QUOTES[1]!.quote).toMatch(/Company entry description is good/);
  });
});

// sha256 of each verbatim email body (UTF-8), computed from the owner's pasted
// text in R41 S1. If either changes, the mirror is no longer verbatim.
const E1_SHA = "635869367b4536a30a9b2e2de2ec552124dccdd7177d8438b00b91d922307bbd";
const E2_SHA = "3013ff751f30249c9dd008589da8b2002143c0996fae92d4c03fe71b3e540e32";
