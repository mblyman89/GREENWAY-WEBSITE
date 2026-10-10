/**
 * tests/compliance/r39-ach-authorization-core.test.ts   (R39 S1)
 *
 * The pure ACH rules, tested against the MIRRORED SOURCES rather than against
 * numbers retyped into the test. Three tables in the core are data copied
 * from documents (the FRB holiday calendar, the return/NOC labels, the
 * transaction codes); each is re-derived here from the document itself, so a
 * typo in the core cannot be "confirmed" by the same typo in the test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACH_CODES,
  ACH_NOTIFY_PUBLIC,
  resolveNotifyContacts,
  CONTACT_LOOKBACK_DAYS,
  FRB_HOLIDAYS,
  MICRO_ENTRY_DESCRIPTION,
  PAYROLL_DESCRIPTION,
  REVERSAL_DESCRIPTION,
  __runAchAuthorizationCoreTests,
  addBankingDays,
  allocateSplit,
  fedAchClosures,
  isFedAchBankingDay,
  prenoteLiveEligibleDate,
  retentionVerdict,
  transactionCodeFor,
  weekday,
  NOC_DEADLINE_BANKING_DAYS,
  PRENOTE_WAIT_BANKING_DAYS,
  RETURN_WINDOW_BANKING_DAYS,
  REVERSAL_WINDOW_BANKING_DAYS,
  WAC_RETENTION_YEARS,
  NACHA_RETENTION_YEARS,
  type SplitAccount,
} from "@/lib/payments/ach-authorization-core";
import { achAuthorityById } from "@/lib/payments/ach-authorities";

const CORPUS = join(__dirname, "..", "..", "docs", "authorities");
const read = (f: string) => readFileSync(join(CORPUS, f), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const quote = (id: string) => flat(achAuthorityById(id)!.quote);

describe("self-tests", () => {
  it("run, and run enough assertions to mean something", () => {
    const r = __runAchAuthorizationCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(63);
  });
});

describe("FRB holiday table is the mirrored FRB table, not memory", () => {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Parse the FedCash table block: header row "2026 2027 2028 2029 2030", then
  // per holiday a name followed by five "Month D" cells, some with * or **.
  const text = read("ach/frbservices-holiday-schedule.txt");
  const block = text.slice(text.indexOf("A listing of the 2026"), text.indexOf("*For holidays falling on Saturday"));
  const cells = [...block.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\s*(\*{0,2})/g)];

  it("the parse found 11 holidays x 5 years (guard: an empty parse would pass every loop)", () => {
    expect(cells.length).toBe(55);
  });

  it("every parsed date equals the core's table, column by column", () => {
    const years = [2026, 2027, 2028, 2029, 2030];
    for (let i = 0; i < cells.length; i += 1) {
      const y = years[i % 5];
      const m = String(MONTHS.indexOf(cells[i][1]) + 1).padStart(2, "0");
      const d = cells[i][2].padStart(2, "0");
      const iso = `${y}-${m}-${d}`;
      expect(FRB_HOLIDAYS[y], `${y}`).toContain(iso);
    }
    for (const y of years) expect(FRB_HOLIDAYS[y].length).toBe(11);
  });

  it("the FRB's own * (Saturday) and ** (Sunday) markers agree with the computed weekday", () => {
    const years = [2026, 2027, 2028, 2029, 2030];
    let marked = 0;
    for (let i = 0; i < cells.length; i += 1) {
      const y = years[i % 5];
      const iso = `${y}-${String(MONTHS.indexOf(cells[i][1]) + 1).padStart(2, "0")}-${cells[i][2].padStart(2, "0")}`;
      const stars = cells[i][3];
      if (stars === "*") {
        marked += 1;
        expect(weekday(iso), `${iso} marked * must be Saturday`).toBe(6);
      } else if (stars === "**") {
        marked += 1;
        expect(weekday(iso), `${iso} marked ** must be Sunday`).toBe(0);
      }
    }
    expect(marked).toBeGreaterThanOrEqual(6);
  });

  it("the Saturday/Sunday rule the core applies is the one the FRB states", () => {
    expect(quote("ach-fedach-saturday-sunday")).toContain("open the preceding Friday");
    expect(quote("ach-fedach-saturday-sunday")).toContain("closed the following Monday");
    expect(fedAchClosures(2026)).not.toContain("2026-07-03");
    expect(fedAchClosures(2026)).not.toContain("2026-07-04");
    expect(fedAchClosures(2027)).toContain("2027-07-05");
  });

  it("is NOT the DC tax-deposit calendar (Emancipation Day is a banking day)", () => {
    expect(isFedAchBankingDay("2026-04-16")).toBe(true);
    expect(isFedAchBankingDay("2027-04-16")).toBe(true);
  });

  it("fails loudly outside the mirrored years (rule 48)", () => {
    expect(() => addBankingDays("2030-12-30", 5)).toThrow(/no FRB holiday schedule/);
  });
});

describe("timing constants are the numbers in the quoted sources", () => {
  it("prenote 3, returns 2nd day, NOC 6, reversal 5, descriptions", () => {
    expect(quote("ach-prenote-three-banking-days")).toContain("three (3) banking days");
    expect(PRENOTE_WAIT_BANKING_DAYS).toBe(3);
    expect(quote("ach-returns-second-banking-day")).toContain("second banking day");
    expect(RETURN_WINDOW_BANKING_DAYS).toBe(2);
    expect(quote("ach-noc-six-banking-days")).toContain("six banking days");
    expect(NOC_DEADLINE_BANKING_DAYS).toBe(6);
    expect(quote("ach-reversal-five-banking-days")).toContain("five (5) banking days");
    expect(REVERSAL_WINDOW_BANKING_DAYS).toBe(5);
    expect(quote("ach-reversal-description")).toContain(`“${REVERSAL_DESCRIPTION}”`);
    expect(quote("ach-payroll-description")).toContain(`contain ${PAYROLL_DESCRIPTION}, all capitalized`);
    expect(quote("ach-micro-entry-acctverify")).toContain(MICRO_ENTRY_DESCRIPTION);
  });

  it("retention years match WAC 314-55-087 and the Nacha 2-year summaries", () => {
    expect(quote("ach-wac-087-five-years")).toContain("five-year period");
    expect(WAC_RETENTION_YEARS).toBe(5);
    expect(quote("ach-authorization-two-years-united")).toContain("two years following the termination");
    expect(NACHA_RETENTION_YEARS).toBe(2);
    // and the policy pads beyond both:
    const v = retentionVerdict({ signedOn: "2026-01-01", endedOn: "2027-01-01", legalHold: false, today: "2027-02-01" });
    expect(v.kind === "keep_until" && v.until).toBe("2033-01-01");
  });

  it("a prenote that settles before a long weekend waits for banking days, not calendar days", () => {
    // Fri Jul 2 2027; Mon Jul 5 is closed (Jul 4 Sunday) -> Tue 6, Wed 7, Thu 8.
    expect(prenoteLiveEligibleDate("2027-07-02")).toBe("2027-07-08");
  });
});

describe("transaction codes are the First Citizens credit codes, and only credits", () => {
  it("live 22/32 and prenote 23/33 appear in the quoted spec", () => {
    const q = quote("ach-prenote-codes");
    expect(q).toContain(`${transactionCodeFor("checking", true)} - Checking Credits`);
    expect(q).toContain(`${transactionCodeFor("savings", true)} - Savings Credits`);
    expect(q).toContain(`${transactionCodeFor("checking", false)} - Checking Credits`);
    expect(q).toContain(`${transactionCodeFor("savings", false)} - Savings Credits`);
  });
});

describe("return / NOC labels are copied from the mirrored newsletter", () => {
  const text = flat(read("ach/odfi-peoples-bank-2026-originators-newsletter.txt"));
  it("every catalogued code + label appears verbatim as '• CODE label'", () => {
    expect(Object.keys(ACH_CODES).length).toBe(20);
    for (const [code, v] of Object.entries(ACH_CODES)) {
      expect(text.includes(`• ${code} ${v.label}`), `${code} ${v.label}`).toBe(true);
    }
  });
  it("mutation: a reworded label is not found (the check can say no)", () => {
    expect(text.includes("• R02 Account was closed")).toBe(false);
  });
});

describe("split deposits", () => {
  const three: SplitAccount[] = [
    { accountKey: "a", priority: 1, rule: { kind: "percent", basisPoints: 3333 } },
    { accountKey: "b", priority: 2, rule: { kind: "percent", basisPoints: 3333 } },
    { accountKey: "c", priority: 3, rule: { kind: "remainder" } },
  ];
  it("always sums to net, for many amounts (property)", () => {
    for (let net = 0; net < 20000; net += 37) {
      const r = allocateSplit(net, three);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.lines.reduce((t, l) => t + l.cents, 0)).toBe(net);
    }
  });
});

describe("owner-supplied facts", () => {
  it("no personal phone number is committed to this PUBLIC repo's ACH code", () => {
    // Owner gave the cells in an earlier round (answer D17); they belong in
    // the environment, not in git. The store line is already public.
    expect(ACH_NOTIFY_PUBLIC.stephen.phone).toBeNull();
    expect(ACH_NOTIFY_PUBLIC.michael.phone).toBeNull();
    const src = readFileSync(join(__dirname, "..", "..", "src", "lib", "payments", "ach-authorization-core.ts"), "utf8");
    const phones = [...src.matchAll(/\b\d{3}-\d{3}-\d{4}\b/g)].map((m) => m[0]);
    for (const p of phones) expect(["360-443-6988", "360-555-0100", "360-555-0101"], p).toContain(p);
  });
  it("store contact is the published store line and site address", () => {
    expect(ACH_NOTIFY_PUBLIC.store.phone).toBe("360-443-6988");
    const po = readFileSync(join(__dirname, "..", "..", "src", "lib", "purchasing", "po-document-core.ts"), "utf8");
    expect(po).toContain("(360) 443-6988");
  });
  it("missing phones are reported, never silently dropped (rule 48)", () => {
    const r = resolveNotifyContacts({});
    expect(r.problems.length).toBe(2);
    expect(r.contacts.stephen.email).toBe("stephen@greenwaymarijuana.com");
  });
  it("the look-back is padded beyond a 60-day cycle", () => {
    expect(CONTACT_LOOKBACK_DAYS).toBeGreaterThanOrEqual(90);
  });
});
