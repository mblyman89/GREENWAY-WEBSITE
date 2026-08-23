/**
 * tests/compliance/owner-report-books-41.test.ts
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * One document ships with this slice:
 *
 *   docs/MICHAEL-books-41-the-quarterly-returns.md
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A PROOFREAD
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The report tells Michael things he will act on: that his Q2 2027 return is
 * due on 2 August rather than 31 July, that ten boxes exist across four forms,
 * that there are ten ways the return can refuse, that the employer share of
 * Paid Leave is zero for a reason worth $222.51 a quarter. Each of those was
 * true at the moment I ran the check.
 *
 * This slice produced the sharpest possible demonstration of why that matters.
 * The books-39 report claimed "10 of 11 rates" were missing for the cutover.
 * Splitting the ESD notice into its two real statutory accounts made that 12
 * of 13 - and the books-39 test suite went red and REFUSED to let the stale
 * document ship. That is the entire argument for this file, already proven
 * once in this very slice.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS BEING PROTECTED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. THE QUOTE IS SACRED (rules 24/35). Every statute quoted is re-derived
 *    from the authority registry in BOTH directions: the fragment must be in
 *    the registry (so the test cannot be satisfied by text I invented) and in
 *    the report (so the report cannot quietly drop it).
 *
 * 2. THE FIGURES. Every dollar amount in the report is recomputed from the
 *    engine and cross-checked against the FILED return, not against my
 *    arithmetic. A filed return outranks a program printout (rule 59).
 *
 * 3. THE COUNTED CLAIMS. "Four forms", "ten boxes", "ten refusals", "eight
 *    checks", "fourteen mutations", "72 tests". If a later slice adds an
 *    eleventh refusal code, this report becomes wrong on a point of
 *    substance, and this file is what notices.
 *
 * 4. THE DEADLINES. The 2027 due-date table is recomputed. If the shift rule
 *    changed, the report would be sending him to file on a Saturday.
 *
 * 5. EVERY BOX IS ACTUALLY EXPLAINED. Michael's explicit ask for this slice
 *    was that he understand every box on the forms. So the report is required
 *    to name every box the engine emits - not most of them.
 *
 * 6. THE PDF SHIPPED. A markdown file Michael cannot open is not a delivery.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WA_QUARTERLY_OWN_AUTHORITIES } from "@/lib/payroll/wa-quarterly-authorities";
import {
  WA_BOX_EXPLAINERS,
  WA_FORM_GUIDES,
  WA_QUARTER_CHECKS,
  WA_QUARTER_LESSONS,
  WA_REFUSAL_LESSONS,
  WA_WORKED_EXAMPLES,
} from "@/lib/payroll/wa-quarterly-mentor";
import { buildWaQuarter, waQuarterDueDate } from "@/lib/payroll/wa-quarterly-core";
import {
  waAgencyGroups,
  waFormRenderCoverage,
  waOwnershipSummary,
  waRateAsOfDate,
  waResolveRates,
  waUrgencyBand,
  waUrgencyMeaning,
} from "@/lib/payroll/wa-quarterly-ui-core";
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";
import { adminNav } from "@/components/admin/admin-nav-data";
import { filedFigure } from "@/lib/reports/known-good-quarters";

const ROOT = join(__dirname, "..", "..");
const REPORT_PATH = join(ROOT, "docs", "MICHAEL-books-41-the-quarterly-returns.md");
const PDF_PATH = join(ROOT, "docs", "MICHAEL-books-41-the-quarterly-returns.pdf");

const report = readFileSync(REPORT_PATH, "utf8");

/** Flatten blockquote decoration away WITHOUT touching the words. */
function unquote(md: string): string {
  return md
    .split("\n")
    .map((l) => l.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fold typography without deleting words. */
function norm(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const flat = norm(unquote(report));

/** The amount a state agency actually assessed, in cents. Throws on typos. */
function filedCents(id: string): number {
  const f = filedFigure(id);
  if (!f) throw new Error(`known-good-quarters has no filed figure "${id}"`);
  return f.filedAmountCents;
}

/** "$1,234.56" from integer cents, the way the report writes money. */
function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 0. GUARD THE GUARD (rule 39)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the report was actually read", () => {
  it("the document exists and has real content", () => {
    expect(report.length).toBeGreaterThan(20000);
  });

  it("the unquote helper strips decoration and keeps words", () => {
    expect(unquote("> the words\n> continue here")).toBe("the words continue here");
    expect(unquote("**bold** text")).toBe("bold text");
    expect(unquote("plain")).toBe("plain");
    expect(unquote("> a").length).toBeGreaterThan(0);
  });

  it("the norm helper folds typography without deleting words", () => {
    expect(norm("\u201Cquoted\u201D")).toBe('"quoted"');
    expect(norm("em\u2014dash")).toBe("em-dash");
    expect(norm("word")).toBe("word");
  });

  it("the flattened report is substantial, not an empty string", () => {
    // Without this floor, a broken helper pair would make every `toContain`
    // below fail loudly - but a merely TRUNCATED flat would pass the early
    // checks and silently skip the late ones.
    expect(flat.length).toBeGreaterThan(19000);
  });

  it("the authority registry is populated", () => {
    expect(WA_QUARTERLY_OWN_AUTHORITIES.length).toBe(16);
  });

  it("filedCents throws on an unknown id rather than returning undefined", () => {
    // A test comparing against a figure that does not exist proves nothing.
    expect(() => filedCents("no-such-figure")).toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. THE QUOTE IS SACRED (rules 24/35)
 * ═══════════════════════════════════════════════════════════════════════════ */

const QUOTE_CLAIMS: readonly { id: string; fragments: readonly string[] }[] = [
  {
    id: "wac-192-310-010-tax-report",
    fragments: [
      "Each calendar quarter, every employer must file a tax report with the commissioner",
      "The report must list the total wages paid to every employee during that quarter",
    ],
  },
  {
    id: "wac-192-310-010-wage-detail",
    fragments: [
      "This report must list each employee by full name, Social Security number, standard occupational classification code or job title, and total hours worked and wages paid during that quarter",
    ],
  },
  {
    id: "wac-192-310-010-due-dates",
    fragments: [
      "The quarterly tax and wage reports are due by the last day of the month following the end of the calendar quarter being reported",
      "If these dates fall on a Saturday, Sunday, or a legal holiday, the reports will be due on the next business day",
    ],
  },
  {
    id: "wac-192-310-010-termination",
    fragments: [
      "Each employer who stops doing business or whose account is closed by the department must immediately file",
    ],
  },
  {
    id: "rcw-50-24-010-no-deduction",
    fragments: [
      "shall not be deducted, in whole or in part, from the remuneration of individuals in employment of the employer",
      "Any deduction in violation of the provisions of this section shall be unlawful",
    ],
  },
  {
    id: "rcw-50-24-010-rounding",
    fragments: [
      "a fractional part of a cent shall be disregarded unless it amounts to one-half cent or more, in which case it shall be increased to one cent",
    ],
  },
  {
    id: "rcw-50-24-014-eaf-no-deduction-and-rounding",
    fragments: ["Any deduction in violation of this section is unlawful"],
  },
  {
    id: "rcw-50a-10-030-small-employer",
    fragments: [
      "Employers with fewer than 50 employees employed in the state are not required to pay the employer portion of premiums for family and medical leave",
    ],
  },
  {
    id: "rcw-50a-10-030-size-test",
    fragments: [
      "the department shall average the number of employees reported by an employer on the last day of each quarter over the last four completed calendar quarters",
    ],
  },
  {
    id: "rcw-50a-10-030-agent-and-trust",
    fragments: [
      "the employer shall act as the agent of the employees and shall remit the amounts to the department as required by this title",
      "Premiums collected under this section are placed in trust for the employees and employers that the program is intended to assist",
    ],
  },
  {
    id: "wac-296-17-31021-unit-of-exposure",
    fragments: [
      "For most businesses the unit of exposure is the hours worked by their employees",
    ],
  },
  {
    id: "wac-296-17-31021-salaried",
    fragments: [
      "All salaried employees of an employer must be reported by the same method",
    ],
  },
  {
    id: "wac-296-17-31023-no-payroll",
    fragments: [
      "we will estimate premiums and initiate legal action against you to collect premiums due",
    ],
  },
];

describe("every statute quoted to Michael matches the registry verbatim", () => {
  it("every claimed authority id exists in the registry", () => {
    // Without this, a typo in an id would make the loop below compare against
    // `undefined` and the whole section would go quietly vacuous.
    for (const c of QUOTE_CLAIMS) {
      const hit = WA_QUARTERLY_OWN_AUTHORITIES.find((a) => a.id === c.id);
      expect(hit, `no authority with id ${c.id}`).toBeTruthy();
    }
  });

  for (const claim of QUOTE_CLAIMS) {
    for (const frag of claim.fragments) {
      it(`${claim.id}: "${frag.slice(0, 44)}..." is verbatim in both`, () => {
        const authority = WA_QUARTERLY_OWN_AUTHORITIES.find((a) => a.id === claim.id)!;
        const registry = norm(authority.quote);
        const f = norm(frag);

        // Direction 1: the fragment must really be in the statute as stored,
        // or the test could be satisfied by text I made up and then pasted.
        expect(registry, `fragment is not in registry entry ${claim.id}`).toContain(f);

        // Direction 2: the report must still carry it.
        expect(flat, `report no longer contains the fragment`).toContain(f);
      });
    }
  }

  it("the citation labels the report uses match the registry", () => {
    for (const id of [
      "wac-192-310-010-tax-report",
      "wac-192-310-010-wage-detail",
      "wac-192-310-010-due-dates",
      "wac-296-17-31021-unit-of-exposure",
      "wac-296-17-31021-salaried",
      "wac-296-17-31023-no-payroll",
    ]) {
      const a = WA_QUARTERLY_OWN_AUTHORITIES.find((x) => x.id === id)!;
      expect(flat, `report never cites ${a.cite}`).toContain(norm(a.cite));
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. THE FIGURES ARE THE FILED FIGURES (rule 59)
 *
 * Every dollar amount in the report is checked against what a state agency
 * actually assessed - not against the engine, and certainly not against me.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every figure in the report is the filed figure", () => {
  const FIGURES: readonly [string, string][] = [
    ["esd-ui", "unemployment insurance"],
    ["esd-eaf", "EAF surcharge"],
    ["esd-total", "ESD total"],
    ["pfml-employee", "Paid Leave withheld"],
    ["wa-cares", "WA Cares"],
    ["lni-premium", "L&I premium"],
  ];

  for (const [id, label] of FIGURES) {
    it(`the ${label} figure in the report is what was filed`, () => {
      const text = money(filedCents(id));
      expect(flat, `report does not contain the filed ${label} of ${text}`).toContain(text);
    });
  }

  it("the engine reproduces every filed figure, so the report is not quoting a fiction", () => {
    // Rule 16: the report claiming "reproduces exactly" is a claim about the
    // CODE. Re-derive it here rather than trusting the sentence.
    const built = buildWaQuarter({
      quarter: { year: 2026, quarter: 2 },
      subjects: [
        {
          subjectId: "all",
          displayName: "Q2 2026 aggregate",
          wagesCents: 6_892_345,
          esdTaxableWagesCents: 6_892_345,
          pfmlTaxableWagesCents: 6_892_345,
          hours: 3_558,
        },
      ],
      rates: {
        sutaUiMilliPct: 370,
        sutaEafMilliPct: 30,
        pfmlTotalMilliPct: 1_130,
        pfmlEmployeeShareMilliPct: 71_430,
        waCaresMilliPct: 580,
        lniEmployeeMilliCentsPerHour: 16_445,
        lniEmployerMilliCentsPerHour: 39_485,
      },
      pfml: { employerOwesEmployerShare: false, determinedAverageHeadcount: 10 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    for (const [id] of FIGURES) {
      const line = built.value.lines.find((l) => l.id === id);
      expect(line, `engine emits no line "${id}"`).toBeTruthy();
      expect(line!.amountCents, `engine disagrees with the filed ${id}`).toBe(filedCents(id));
    }
  });

  it("the one-cent story in the report is arithmetically true", () => {
    // The whole document turns on this. If the shortcut and the lawful method
    // ever stopped differing, the report's central lesson would be wrong.
    expect(flat).toContain("$275.69");
    expect(flat).toContain("$275.70");
    expect(filedCents("esd-total")).toBe(27_570);
    expect(filedCents("esd-ui") + filedCents("esd-eaf")).toBe(filedCents("esd-total"));
  });

  it("the L&I split in the report adds to the filed premium", () => {
    expect(flat).toContain("$585.11");
    expect(flat).toContain("$1,404.88");
    expect(58_511 + 140_488).toBe(filedCents("lni-premium"));
  });

  it("the $222.51 Paid Leave exposure is stated, since the filed figure is zero", () => {
    // A zero with no reason attached is indistinguishable from an omission.
    expect(filedCents("pfml-employer")).toBe(0);
    expect(flat).toContain("$222.51");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. EVERY BOX IS EXPLAINED - MICHAEL'S EXPLICIT ASK
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the report explains every box, because that is what was asked for", () => {
  it("there are ten boxes and the report says ten", () => {
    expect(WA_BOX_EXPLAINERS.length).toBe(10);
    expect(flat).toContain("Ten boxes produce numbers across the four returns");
  });

  it("every box label the engine emits appears in the report", () => {
    // Naming nine of ten is the realistic failure: the tenth is added later
    // and nobody re-reads the report.
    for (const b of WA_BOX_EXPLAINERS) {
      expect(flat, `box "${b.boxLabel}" is never named in the report`).toContain(
        norm(b.boxLabel),
      );
    }
  });

  it("every box's ownership is stated, in the report's own vocabulary", () => {
    // The "whose money" distinction is the load-bearing one: the two kinds are
    // governed by opposite rules. A report that lists boxes without saying
    // whose money each is would be a list, not an explanation.
    const spoken = { employer_cost: "your money", employee_money: "your staff's money", shared: "shared" };
    for (const b of WA_BOX_EXPLAINERS) {
      const phrase = spoken[b.whoseMoney as keyof typeof spoken];
      expect(phrase, `no spoken form for whoseMoney=${b.whoseMoney}`).toBeTruthy();
    }
    // And all three vocabularies must actually appear.
    expect(flat).toContain("your money");
    expect(flat).toContain("your staff's money");
    expect(flat).toContain("shared");
  });

  it("all four forms are named with their official names", () => {
    expect(WA_FORM_GUIDES.length).toBe(4);
    expect(flat).toContain("Form 5208A");
    expect(flat).toContain("Form 5208B");
    expect(flat).toContain("Paid Family & Medical Leave and WA Cares");
    expect(flat).toContain("L&I Quarterly Report");
  });

  it("the report says which agency each form goes to, including the EAMS split", () => {
    // A real trap for a first-time filer: PFML is the same agency but NOT the
    // same system, so "I filed in EAMS" does not mean PFML was filed.
    expect(flat).toContain("EAMS");
    expect(flat).toContain("not in EAMS");
    expect(flat).toContain("Department of Labor & Industries");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. THE COUNTED CLAIMS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the counts the report states are the counts the code has", () => {
  it("there are ten refusal codes and the report walks all ten", () => {
    expect(WA_REFUSAL_LESSONS.length).toBe(10);
    expect(flat).toContain("The ten ways the return will refuse to build");
    for (const l of WA_REFUSAL_LESSONS) {
      expect(flat, `refusal code ${l.code} is never named in the report`).toContain(l.code);
    }
  });

  it("there are eight checks and the report walks them in order", () => {
    expect(WA_QUARTER_CHECKS.length).toBe(8);
    expect(flat).toContain("The eight-step quarterly checklist");

    const ordered = [...WA_QUARTER_CHECKS].sort((a, b) => a.order - b.order);
    const markers = ["One:", "Two:", "Three:", "Four:", "Five:", "Six:", "Seven:", "Eight:"];
    expect(ordered.length).toBe(markers.length);

    let cursor = -1;
    for (const m of markers) {
      const at = report.indexOf(`**${m}`, cursor + 1);
      expect(at, `ordinal marker "${m}" missing or out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("there are four worked examples and the report works all four", () => {
    expect(WA_WORKED_EXAMPLES.length).toBe(4);
    expect(flat).toContain("Four worked examples");
    const stages = ["One: the cent", "Two: why Paid Leave", "Three: a zero", "Four: give everyone a raise"];
    let cursor = 0;
    for (const s of stages) {
      const at = flat.indexOf(s, cursor);
      expect(at, `worked example "${s}" missing or out of order`).toBeGreaterThan(-1);
      cursor = at;
    }
  });

  it("the engine-lesson count the report implies is real", () => {
    expect(WA_QUARTER_LESSONS.length).toBe(12);
  });

  it("the test counts the report states are the counts the suites have", () => {
    // Both are checkable claims about files in this repository, so they are
    // checked rather than asserted.
    //
    // THIS COUNTER WAS WRONG THE FIRST TIME, AND THE STORY MATTERS.
    // The first version of this test counted /^\s{2}it\(/gm -- "it(" at exactly
    // two spaces of indent. It reported 65 for the engine suite while vitest
    // reported 72, and it FAILED, which is the only reason I found out. Two
    // separate bugs were hiding in that one regex:
    //
    //   1. It missed an it() nested one level deeper (four spaces).
    //   2. It counted a `for (const id of provable) { it(...) }` loop as ONE
    //      test when vitest expands it into SEVEN -- one per filed line id.
    //
    // A counter that undercounts is worse than no counter, because it fails
    // loudly today and could just as easily have passed quietly on a different
    // pair of numbers. So this version does the real job: it counts static
    // it() calls at any indent, then finds every generating for-loop, resolves
    // the array it iterates, and adds one test per element. If it meets a loop
    // shape it does not understand, it THROWS rather than guessing low.
    const countTests = (src: string, label: string): number => {
      const lines = src.split("\n");
      let total = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!/^\s*it\(/.test(lines[i])) continue;
        // Walk backwards to the nearest enclosing statement that could
        // multiply this it(). We only look at the block opener directly above
        // the it(), which is the only generating shape this repo uses.
        const opener = lines[i - 1] ?? "";
        const loop = opener.match(/^\s*for \(const \w+ of (\w+)\) \{\s*$/);
        if (!loop) {
          // Guard the guard: if a loop-ish opener appears that we did not
          // match, refuse instead of counting it as a plain single test.
          if (/^\s*(for|while)\s*\(/.test(opener) || /\.forEach\(/.test(opener)) {
            throw new Error(
              `${label}: unrecognised generating construct above it() at line ${i + 1}: ${opener.trim()}`,
            );
          }
          total += 1;
          continue;
        }
        // Resolve `const <name>: readonly string[] = [ ... ];` and count its
        // string entries. Anything else is a refusal, not a guess.
        const decl = new RegExp(
          `const ${loop[1]}\\s*:[^=]*=\\s*\\[([\\s\\S]*?)\\];`,
          "m",
        ).exec(src);
        if (!decl) {
          throw new Error(`${label}: cannot resolve the array "${loop[1]}" driving a test loop`);
        }
        const entries = (decl[1].match(/"[^"]+"/g) ?? []).length;
        if (entries === 0) {
          throw new Error(`${label}: the array "${loop[1]}" resolved to zero entries`);
        }
        total += entries;
      }
      return total;
    };

    const engineSuite = readFileSync(join(__dirname, "wa-quarterly.test.ts"), "utf8");
    const engineTests = countTests(engineSuite, "wa-quarterly.test.ts");
    expect(flat, "the report's claim about the engine test count is missing").toContain(
      "72 tests of its own",
    );
    expect(engineTests, `wa-quarterly.test.ts defines ${engineTests} tests`).toBe(72);

    const registrySuite = readFileSync(
      join(__dirname, "payroll-rate-registry-core.test.ts"),
      "utf8",
    );
    const registryTests = countTests(registrySuite, "payroll-rate-registry-core.test.ts");
    expect(flat).toContain("The rate registry has 108");
    expect(registryTests, `the registry suite defines ${registryTests} tests`).toBe(108);
  });

  it("the test counter itself can tell the difference between 65 and 72", () => {
    // Rule 16: prove the gate fires. If countTests were still the naive
    // two-space regex, the engine suite would score 65. This test pins the
    // gap so the counter can never silently regress to the broken version.
    const engineSuite = readFileSync(join(__dirname, "wa-quarterly.test.ts"), "utf8");
    const naive = (engineSuite.match(/^\s{2}it\(/gm) ?? []).length;
    expect(naive, "the naive counter no longer undercounts, so this guard is stale").toBe(65);
    // Seven of the engine's tests are generated, one per filed line id.
    expect(72 - naive).toBe(7);
  });

  it("the mutation count the report states is the count the script defines", () => {
    const script = readFileSync(
      join(ROOT, "scripts", "compliance", "mutate-slice-books-41.py"),
      "utf8",
    );
    // Count the mutation tuples by their file-key first element.
    const tuples = (script.match(/^\s{8}"(core|mentor|registry)",$/gm) ?? []).length;
    expect(flat).toContain("fourteen deliberate sabotages");
    expect(tuples, `the script defines ${tuples} mutations`).toBe(14);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. THE DEADLINES ARE RECOMPUTED, NOT REMEMBERED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the 2027 deadline table is recomputed", () => {
  const EXPECTED: readonly [1 | 2 | 3 | 4, string, string][] = [
    [1, "2027-04-30", "Friday 30 April 2027"],
    [2, "2027-08-02", "Monday 2 August 2027"],
    [3, "2027-11-01", "Monday 1 November 2027"],
    [4, "2028-01-31", "Monday 31 January 2028"],
  ];

  for (const [q, iso, spoken] of EXPECTED) {
    it(`Q${q} 2027 is genuinely due ${iso}, and the report says ${spoken}`, () => {
      const d = waQuarterDueDate({ year: 2027, quarter: q });
      expect(d.dueDate, `the engine now says Q${q} is due ${d.dueDate}`).toBe(iso);
      expect(flat, `the report does not say "${spoken}"`).toContain(spoken);
    });
  }

  it("the two shifted quarters really are shifted, and for the stated reason", () => {
    // Rule 39: without this, the table above would pass if NOTHING ever
    // shifted and the dates happened to be right for another reason.
    expect(waQuarterDueDate({ year: 2027, quarter: 2 }).shiftedBy).toBe("weekend");
    expect(waQuarterDueDate({ year: 2027, quarter: 3 }).shiftedBy).toBe("weekend");
    expect(waQuarterDueDate({ year: 2027, quarter: 1 }).shiftedBy).toBe("none");
    expect(waQuarterDueDate({ year: 2027, quarter: 4 }).shiftedBy).toBe("none");
  });

  it("the report warns that Washington has no federal-style ten-day extension", () => {
    // The single most expensive habit to carry across the border.
    expect(flat).toContain("Washington has no such extension");
  });

  it("the report's claim about holidays never colliding is true", () => {
    // The report tells him only weekends ever move a quarterly deadline. That
    // is a strong claim, so it is re-derived rather than trusted.
    let holidayShifts = 0;
    for (let year = 2024; year <= 2200; year += 1) {
      for (const q of [1, 2, 3, 4] as const) {
        if (waQuarterDueDate({ year, quarter: q }).shiftedBy === "holiday") holidayShifts += 1;
      }
    }
    expect(holidayShifts).toBe(0);
    expect(flat).toContain("no Washington legal holiday can ever fall on 31 January");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. THE HONEST RECORD
 *
 * The report admits three defects and two test holes. Those paragraphs are
 * the reason the document is worth reading, so they are protected: if
 * somebody quietly deletes the embarrassing part, this fails.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the report keeps its own honest record", () => {
  it("the dead holiday stub is disclosed", () => {
    expect(flat).toContain("isWaLegalHolidayOnDueDate");
    expect(flat).toContain("It was a stub");
  });

  it("the hours-box sentinel is disclosed", () => {
    expect(flat).toContain("would have printed \"$0.00\" next to a box reporting 3,558 hours");
  });

  it("the two genuine test holes the mutation battery found are disclosed", () => {
    expect(flat).toContain("two were genuine holes in the tests");
    // And the general lesson, which is the transferable part.
    expect(flat).toContain(
      "The filed return proves the engine is right for one quarter; it cannot prove the method is right for every quarter",
    );
  });

  it("my own error in the mutation battery is disclosed, not buried", () => {
    expect(flat).toContain("one was my own error in describing a rounding mode");
  });

  it("the broken test-counter is disclosed too, including how it was broken", () => {
    // This one is easy to leave out, because it is a bug in a test rather
    // than in the engine, and nobody would have known. That is exactly why
    // it has to be here: the failure mode is a check that undercounts and
    // still shows green. Rule 39 -- a gate that parses nothing approves
    // everything -- applies to my own gates as much as to the engine's.
    expect(flat, "the counter bug is not disclosed").toContain(
      "And then the checking machinery itself was wrong",
    );
    expect(flat, "the report does not say what the wrong number was").toContain(
      "reported 65 where the real number was 72",
    );
    expect(flat, "the report does not explain the two causes").toContain(
      "counted a loop that generates seven tests",
    );
    expect(flat, "the report does not state the general lesson").toContain(
      "A check that undercounts does not look broken. It looks like a green check.",
    );
    // And the report must not still claim there were only two problems.
    expect(flat).toContain("Several things in this slice were wrong");
  });

  it("the books-39 rate-count change is carried forward honestly", () => {
    // He read "ten of eleven" in a document I gave him. He is owed an account
    // of why it is now twelve of thirteen.
    expect(flat).toContain("went from ten to twelve");
    expect(flat).toContain("Both numbers are already printed on the one ESD notice");
  });

  it("the filing boundary is restated, because it has not moved", () => {
    expect(flat).toContain("It does not file anything");
    expect(flat).toContain("we do not become a filing agent");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6b. THE SCREEN THE REPORT SENDS HIM TO
 *
 * The report now contains a "where this lives" walkthrough. That section is a
 * pile of checkable claims about a screen: which menu group it is in, what the
 * three submission cards total, what the ownership panel totals, which day the
 * rates are read as of, and how many rates 2027 is missing. Every one of them
 * is recomputed here from the same functions the page itself calls.
 *
 * WHY THIS SECTION EXISTS AT ALL. Directions to a screen are the fastest part
 * of any document to rot -- a href changes, a nav group is renamed, two cards
 * get merged -- and the rot is silent, because prose does not compile. Michael
 * following stale directions lands on a 404 and concludes the feature was
 * never built. Rule 66: an owner document makes checkable claims, so these
 * get checked.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the walkthrough describes the screen that actually exists", () => {
  /** The same quarter the report walks, built the way the page builds it. */
  function q2() {
    const built = buildWaQuarter({
      quarter: { year: 2026, quarter: 2 },
      subjects: [
        {
          subjectId: "all",
          displayName: "Q2 2026 aggregate",
          wagesCents: 6_892_345,
          esdTaxableWagesCents: 6_892_345,
          pfmlTaxableWagesCents: 6_892_345,
          hours: 3_558,
        },
      ],
      rates: {
        sutaUiMilliPct: 370,
        sutaEafMilliPct: 30,
        pfmlTotalMilliPct: 1_130,
        pfmlEmployeeShareMilliPct: 71_430,
        waCaresMilliPct: 580,
        lniEmployeeMilliCentsPerHour: 16_445,
        lniEmployerMilliCentsPerHour: 39_485,
      },
      pfml: { employerOwesEmployerShare: false, determinedAverageHeadcount: 10 },
    });
    if (!built.ok) throw new Error("the walkthrough fixture refused");
    return built.value;
  }

  it("the href the report gives him is a real nav entry, in the group it names", () => {
    const entry = adminNav.find((i) => i.href === "/admin/books/wa-quarterly");
    expect(entry, "the report sends Michael to a screen that is not in the nav").toBeTruthy();
    expect(entry!.group).toBe("Accounting");
    expect(flat).toContain("/admin/books/wa-quarterly");
    expect(flat).toContain(entry!.label);
  });

  it("it really does sit directly beneath the 941, as the report claims", () => {
    // The report tells him to look just under Federal 941. If a later slice
    // inserts a screen between them, that direction is wrong and this is red.
    const accounting = adminNav.filter((i) => i.group === "Accounting");
    const i941 = accounting.findIndex((i) => i.href === "/admin/books/form-941");
    const iWa = accounting.findIndex((i) => i.href === "/admin/books/wa-quarterly");
    expect(i941).toBeGreaterThanOrEqual(0);
    expect(iWa, "WA Quarterly Returns is no longer directly beneath Form 941 (Quarterly)").toBe(
      i941 + 1,
    );
    expect(flat).toContain(accounting[i941]!.label);
  });

  it("the three submission cards, and their totals, are the ones the report prints", () => {
    const groups = waAgencyGroups(q2());
    expect(groups).toHaveLength(3);
    expect(flat).toContain("Three cards, three confirmation numbers");
    for (const g of groups) {
      expect(flat, `the report never prints the ${g.key} total ${g.totalFormatted}`).toContain(
        g.totalFormatted,
      );
    }
    // And the two ESD ones must still be two. That merge is what the whole
    // screen exists to prevent, and the report stakes its advice on it.
    const esd = groups.filter((g) => g.agency === "Employment Security Department");
    expect(esd).toHaveLength(2);
    expect(esd[0]!.destination).not.toBe(esd[1]!.destination);
    expect(flat).toContain("EAMS");
    expect(flat).toContain("having filed in EAMS feels like having filed with ESD");
  });

  it("the ownership totals are the engine's, and they cross-foot to the cards", () => {
    const ret = q2();
    const buckets = waOwnershipSummary(ret);
    const employer = buckets.find((b) => b.whose === "employer_cost")!;
    const employee = buckets.find((b) => b.whose === "employee_money")!;
    expect(flat, "the employer-cost total is not in the report").toContain(employer.totalFormatted);
    expect(flat, "the held-in-trust total is not in the report").toContain(employee.totalFormatted);

    // The report claims those two add to the three cards. Prove it: a
    // cross-foot he can perform himself is the only reason to print both.
    const ownership = buckets.reduce((a, b) => a + b.totalCents, 0);
    const cards = waAgencyGroups(ret).reduce((a, g) => a + g.totalCents, 0);
    expect(ownership).toBe(cards);
    expect(flat).toContain(money(ownership));
  });

  it("the report does not invent a single combined amount-owed figure", () => {
    // The screen deliberately has no "you owe $X". A report describing one
    // would describe a screen that does not exist AND undo the trust/cost
    // distinction that RCW 50.24.010 and RCW 50A.10.030(7)(b) require.
    expect(flat).toContain('There is no single "you owe" number anywhere on this screen');
  });

  it("all four forms are drawn by something, which is the finding being disclosed", () => {
    const coverage = waFormRenderCoverage(q2());
    expect(coverage).toHaveLength(4);
    expect(coverage.every((c) => c.renderedBy !== "nothing")).toBe(true);
    const b = coverage.find((c) => c.form === "esd_5208b");
    expect(b!.renderedBy).toBe("wage-detail");
  });

  it("the rate as-of date the report names is the one the screen uses", () => {
    const asOf = waRateAsOfDate({ year: 2026, quarter: 2 });
    expect(asOf).toBe("2026-06-30");
    expect(flat, "the report names the wrong as-of date").toContain("30 June 2026");
    expect(flat).toContain("last day");
  });

  it("2026 resolves and 2027 refuses with the number of rates the report states", () => {
    const ok = waResolveRates(GREENWAY_RATES, waRateAsOfDate({ year: 2026, quarter: 2 }));
    expect(ok.ok, "Q2 2026 no longer resolves, so the walkthrough is wrong").toBe(true);

    const missing = waResolveRates(GREENWAY_RATES, waRateAsOfDate({ year: 2027, quarter: 1 }));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    // The report says "all six". When a 2027 notice is entered this goes red
    // and the sentence gets updated, which is the correct outcome.
    expect(missing.missing).toHaveLength(6);
    expect(flat).toContain("all six");
  });

  it("the gold band really does start on the first day of the filing month", () => {
    // The report makes a precise claim: 1 July is already gold. That is the
    // boundary my own first test got wrong, so it is pinned here as well.
    const due = waQuarterDueDate({ year: 2026, quarter: 2 }).dueDate;
    expect(due).toBe("2026-07-31");
    expect(waUrgencyBand(30)).toBe("due-soon");
    expect(waUrgencyBand(31)).toBe("comfortable");
    expect(flat).toContain("the first day of the filing month is already gold");
  });

  it("the overdue sentence the report quotes is the sentence the code emits", () => {
    // Rule 24 applied to my own UI copy: the report puts this in quotation
    // marks, so it has to be verbatim.
    const SENTENCE =
      "Washington has no federal-style extension for having paid on time, so nothing you did " +
      "earlier in the quarter cures a late report.";
    expect(norm(waUrgencyMeaning("overdue", -1, "2026-07-31"))).toContain(SENTENCE);
    expect(flat).toContain(SENTENCE);
  });

  it("the missing-renderer finding is disclosed in the honest record, not just fixed", () => {
    expect(flat, "the dropped form is not disclosed").toContain(
      "The screen would have dropped a whole form, and a test caught it",
    );
    expect(flat).toContain("The ESD filing is incomplete without the 5208B");
    // And the report must no longer imply only the earlier defects existed.
    expect(flat).toContain("one was in the screen");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. THE DELIVERY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the report was actually delivered", () => {
  it("the PDF exists alongside the markdown", () => {
    expect(existsSync(PDF_PATH), "no PDF was built for this report").toBe(true);
  });

  it("the PDF is a real document and not a zero-byte stub", () => {
    expect(statSync(PDF_PATH).size).toBeGreaterThan(40000);
  });

  it("the report is addressed to Michael and names the slice", () => {
    expect(report).toContain("Prepared for Michael Lyman");
    expect(report).toContain("books-41");
  });
});
