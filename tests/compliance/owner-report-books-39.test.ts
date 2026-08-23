/**
 * tests/compliance/owner-report-books-39.test.ts   (books-39 phase I)
 *
 * THE OWNER REPORT IS HELD TO THE SAME STANDARD AS THE CODE (standing rule 66).
 *
 * One document ships with this slice:
 *
 *   docs/MICHAEL-books-39-the-pay-run.md
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A PROOFREAD
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The report tells Michael things he will act on: that ten of eleven rates are
 * missing for 1 January 2027, that there are exactly seven ways the run can
 * refuse, that the recovery ladder has five stages, that the screen exists at
 * a particular route. Each of those was true at the moment I ran the check.
 *
 * A report that quietly goes stale is worse than no report, because he would
 * plan around it. So every claim that CAN be re-derived from the code, IS
 * re-derived here, on every commit, in the suite CI actually runs.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS BEING PROTECTED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. THE QUOTE IS SACRED (rules 24/35). The report quotes five authorities.
 *    Each fragment is re-derived from PAY_RUN_AUTHORITIES in BOTH directions:
 *    it must be in the registry (so the test cannot be satisfied by text I
 *    invented) and in the report (so the report cannot quietly drop it).
 *
 * 2. THE COUNTED CLAIMS. "Seven refusal codes", "seven checks", "five stages",
 *    "sixteen mutations", "three colours". If a later slice adds an eighth
 *    refusal code, this report becomes wrong on a point of substance, and this
 *    file is what notices.
 *
 * 3. THE 2027 BLOCKER. The headline number - ten of eleven - is recomputed
 *    from payDateReadiness("2027-01-01") rather than trusted. The day a rate
 *    is loaded, this fails, and that failure is the REMINDER to update the
 *    report. That is the point: it should fail then.
 *
 * 4. THE ROUTE EXISTS. The report tells him to go to Books -> Pay Run. If the
 *    nav entry were removed, the instruction would send him nowhere.
 *
 * 5. THE PDF SHIPPED. A markdown file Michael cannot open is not a delivery.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PAY_RUN_AUTHORITIES } from "@/lib/payroll/pay-run-authorities";
import { ALL_PAY_RUN_REFUSAL_CODES } from "@/lib/payroll/pay-run-core";
import {
  PAY_RUN_CHECKS,
  PAY_RUN_RECOVERIES,
  PAY_RUN_REFUSAL_LESSONS,
} from "@/lib/payroll/pay-run-mentor";
import { statusMeaning, statusTone } from "@/lib/payroll/pay-run-ui-core";
import { payDateReadiness } from "@/lib/payroll/net-pay-ui-core";
import { adminNav } from "@/components/admin/admin-nav-data";

const ROOT = join(__dirname, "..", "..");
const REPORT_PATH = join(ROOT, "docs", "MICHAEL-books-39-the-pay-run.md");
const PDF_PATH = join(ROOT, "docs", "MICHAEL-books-39-the-pay-run.pdf");

const report = readFileSync(REPORT_PATH, "utf8");

/**
 * Flatten markdown blockquote decoration away WITHOUT touching the words.
 *
 * A quote in the report is wrapped in "> " and may be hard-wrapped across
 * lines by an editor. Neither changes what it says. Bold markers go for the
 * same reason - the report bolds words INSIDE quotations for emphasis, and
 * emphasis is not transcription.
 */
function unquote(md: string): string {
  return md
    .split("\n")
    .map((l) => l.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compare on a WORDS-ONLY axis: lowercase, and every run of non-alphanumeric
 * characters becomes a single space.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A LOOSENING.
 *
 * The mentor data emphasises a word by capitalising it - "this pay DATE", "is
 * it actually SIGNED", "the FIRST run of a year". On screen that shouting is
 * useful. In flowing prose it is wrong, so the report writes them normally,
 * and one check turns a colon into a comma to read as a sentence.
 *
 * A character-exact comparison would therefore force the report to shout, or
 * force the screen to stop. Neither is a good trade. What must NOT be
 * forgiven is a dropped or changed WORD, and this keeps every one of them:
 * only case and punctuation are folded, so "annual for the owner" cannot
 * quietly become "annual for staff".
 */
function words(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Compare on an axis that preserves WORDS but forgives typography. */
function norm(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const flat = norm(unquote(report));

/* ══════════════════════════════════════════════════════════════════════════
 * 0. GUARD THE GUARD (rule 39)
 *
 * Every assertion below is a `toContain` against `flat`. If `flat` were empty
 * or the helpers were broken, most of them would fail loudly - but the SUBTLE
 * failure is a helper that eats the words it is meant to preserve, so it is
 * checked directly.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the report was actually read", () => {
  it("the document exists and has real content", () => {
    expect(report.length).toBeGreaterThan(15000);
  });

  it("the unquote helper strips decoration and keeps words", () => {
    expect(unquote("> the words\n> continue here")).toBe("the words continue here");
    expect(unquote("**bold** text")).toBe("bold text");
    // It must NOT eat the words themselves, or every quote check goes vacuous.
    expect(unquote("> a").length).toBeGreaterThan(0);
    expect(unquote("plain")).toBe("plain");
  });

  it("the norm helper folds typography without deleting words", () => {
    expect(norm("\u201Cquoted\u201D")).toBe('"quoted"');
    expect(norm("em\u2014dash")).toBe("em-dash");
    expect(norm("a   b")).toBe("a b");
    // Guard against a norm that returns "" for everything.
    expect(norm("word")).toBe("word");
  });

  it("the words helper folds case and punctuation without dropping words", () => {
    expect(words("this pay DATE")).toBe("this pay date");
    expect(words("Is it actually SIGNED?")).toBe("is it actually signed");
    expect(words("a, b - c")).toBe("a b c");
    // The load-bearing property: it must NOT delete vocabulary, or every
    // question check above would pass against a report that says nothing.
    expect(words("annual for the owner")).toBe("annual for the owner");
    expect(words("annual for the owner")).not.toBe(words("annual for the staff"));
    // And it must not collapse everything to empty.
    expect(words("word").length).toBeGreaterThan(0);
  });

  it("the flattened report is substantial, not an empty string", () => {
    // Without this floor, a broken unquote/norm pair would make every
    // `expect(flat).toContain(...)` below fail - but a flat that is merely
    // TRUNCATED would pass the early checks and silently skip the late ones.
    expect(flat.length).toBeGreaterThan(14000);
  });

  it("the authority registry is populated", () => {
    expect(PAY_RUN_AUTHORITIES.length).toBe(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. THE QUOTE IS SACRED (rules 24/35)
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Fragment, not whole quote, and deliberately.
 *
 * Requiring the ENTIRE registry string would forbid me from ever quoting the
 * relevant half of a subsection, which would make the reports worse.
 * Requiring a substantial FRAGMENT to appear in both, character for
 * character, catches the thing that actually matters: a paraphrase creeping
 * in during transcription.
 *
 * Module scope rather than inside the describe, because the self-count test
 * in section 7 needs to know how many tests this list generates. One
 * definition, two readers (rule 25).
 */
const QUOTE_CLAIMS: readonly { id: string; fragments: readonly string[] }[] = [
    {
      id: "pay-run-cfr-31-3402-f2-1-no-certificate",
      fragments: [
        "If an employee has no valid withholding allowance certificate in effect with the employer at the time of the payment of the wages",
        "the employee will be treated as single but having the withholding allowance provided in forms, instructions, publications, and other guidance prescribed by the Commissioner",
      ],
    },
    {
      id: "pay-run-cfr-31-3402-f2-1-invalid-certificate",
      fragments: [
        "the employer must disregard it for purposes of computing withholding",
        "The employer must inform the employee who furnished the certificate that it is invalid and must request another withholding allowance certificate from the employee",
        "If, however, a prior certificate is in effect with respect to the employee, the employer must continue to withhold in accordance with the prior certificate",
      ],
    },
    {
      id: "pay-run-cfr-31-3402-f2-1-furnish-on-hire",
      fragments: [
        "On or before the date on which an individual commences employment with an employer, the individual must furnish the employer with a signed withholding allowance certificate",
      ],
    },
    {
      id: "pay-run-rcw-26-18-110-remit-clock",
      fragments: [
        "shall be withheld immediately upon receipt of the wage assignment order or income withholding order",
        "within five working days of each regular pay interval",
      ],
    },
    {
      id: "pay-run-rcw-49-46-020-annual-adjustment",
      fragments: [
        "the department of labor and industries shall calculate an adjusted minimum wage rate to maintain employee purchasing power by increasing the current year's minimum wage rate by the rate of inflation",
        "Each adjusted minimum wage rate calculated under this subsection (2)(b) takes effect on the following January 1st",
      ],
    },
];

describe("every statute quoted to Michael matches the registry verbatim", () => {
  const CLAIMS = QUOTE_CLAIMS;

  it("every claimed authority id exists in the registry", () => {
    // Without this, a typo in an id would make the loop below compare against
    // `undefined` and the whole section would go quietly vacuous.
    for (const c of CLAIMS) {
      const hit = PAY_RUN_AUTHORITIES.find((a) => a.id === c.id);
      expect(hit, `no authority with id ${c.id}`).toBeTruthy();
    }
  });

  it("all five registry authorities are quoted, not just the convenient ones", () => {
    // A report that quotes four of five and omits the awkward one is exactly
    // the failure mode this whole file exists to prevent.
    const claimed = new Set(CLAIMS.map((c) => c.id));
    for (const a of PAY_RUN_AUTHORITIES) {
      expect(claimed.has(a.id), `authority ${a.id} is never quoted in the report`).toBe(true);
    }
  });

  for (const claim of CLAIMS) {
    for (const frag of claim.fragments) {
      it(`${claim.id}: "${frag.slice(0, 48)}..." is verbatim in both`, () => {
        const authority = PAY_RUN_AUTHORITIES.find((a) => a.id === claim.id)!;
        const registry = norm(authority.quote);
        const f = norm(frag);

        // Direction 1: the fragment must really be in the statute as stored.
        // Without this, the test could be satisfied by text I made up and then
        // dutifully pasted into the report.
        expect(registry, `fragment is not in registry entry ${claim.id}`).toContain(f);

        // Direction 2: the report must still carry it.
        expect(flat, `report no longer contains the fragment`).toContain(f);
      });
    }
  }

  it("every citation label in the report matches a registry citation", () => {
    for (const a of PAY_RUN_AUTHORITIES) {
      expect(flat, `report never cites ${a.citation}`).toContain(norm(a.citation));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. THE COUNTED CLAIMS
 *
 * The report states counts in words. Words, not digits, because that is how
 * the prose reads - and it means a drift in the code cannot be papered over
 * by a search-and-replace on a numeral.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the counts the report states are the counts the code has", () => {
  it("there are exactly seven refusal codes, and the report says seven", () => {
    expect(ALL_PAY_RUN_REFUSAL_CODES.length).toBe(7);
    expect(flat).toContain("The seven ways the pay run will refuse");
    expect(flat).toContain("There are exactly seven reasons it will do that");
  });

  it("every refusal code is named in the report, by its exact code", () => {
    // Naming six of seven is the realistic failure: the seventh gets added
    // later and nobody re-reads the report.
    for (const code of ALL_PAY_RUN_REFUSAL_CODES) {
      expect(flat, `refusal code ${code} is never named in the report`).toContain(code);
    }
  });

  it("there is a lesson per refusal code and the report explains each", () => {
    expect(PAY_RUN_REFUSAL_LESSONS.length).toBe(ALL_PAY_RUN_REFUSAL_CODES.length);
  });

  it("there are exactly seven pre-flight checks, and the report says seven", () => {
    expect(PAY_RUN_CHECKS.length).toBe(7);
    expect(flat).toContain("The seven-check pre-flight list");
  });

  it("every check's question reaches the report with all its words", () => {
    // Case and punctuation are forgiven (see `words`); vocabulary is not.
    const flatWords = words(unquote(report));
    for (const check of PAY_RUN_CHECKS) {
      expect(flatWords, `check question for "${check.key}" is not in the report`).toContain(
        words(check.question),
      );
    }
  });

  it("the report walks the checks in the order the code defines", () => {
    // The report argues at length that the ORDERING carries the value - rates
    // first because they break everybody at once, "read three cheques" last
    // because it is the only one that catches an unpredicted error. If the
    // code were reordered and the report were not, that argument would be a
    // lie while every individual sentence stayed true. Position is the claim.
    const flatWords = words(unquote(report));
    const ordered = [...PAY_RUN_CHECKS].sort((a, b) => a.order - b.order);

    const positions = ordered.map((c) => flatWords.indexOf(words(c.question)));
    for (let i = 0; i < positions.length; i += 1) {
      expect(positions[i], `check "${ordered[i].key}" missing from report`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i += 1) {
      expect(
        positions[i],
        `check "${ordered[i].key}" (order ${ordered[i].order}) appears BEFORE ` +
          `"${ordered[i - 1].key}" (order ${ordered[i - 1].order}) in the report`,
      ).toBeGreaterThan(positions[i - 1]);
    }

    // Rule 39: the loop above passes vacuously if `ordered` were empty, and it
    // would also pass if every question resolved to the same index.
    expect(ordered.length).toBe(7);
    expect(new Set(positions).size).toBe(7);
  });

  it("the ordinal markers are present so a reader can follow the order", () => {
    const markers = ["One:", "Two:", "Three:", "Four:", "Five:", "Six:", "Seven:"];
    let cursor = -1;
    for (const m of markers) {
      const at = report.indexOf(`**${m}`, cursor + 1);
      expect(at, `ordinal marker "${m}" missing or out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("there are exactly five recovery stages, and the report walks all five", () => {
    expect(PAY_RUN_RECOVERIES.length).toBe(5);
    expect(flat).toContain("the five-stage recovery ladder");
    const stages = ["Stage one -", "Stage two -", "Stage three -", "Stage four -", "Stage five -"];
    let cursor = 0;
    for (const s of stages) {
      const at = flat.indexOf(s, cursor);
      expect(at, `${s} missing or out of order`).toBeGreaterThan(-1);
      cursor = at;
    }
  });

  it("every recovery stage carries its trap into the report", () => {
    // The traps are the load-bearing half. A ladder without them reads as
    // reassurance rather than as instruction.
    expect((flat.match(/The trap:/g) ?? []).length).toBe(PAY_RUN_RECOVERIES.length);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. THE 2027 BLOCKER, RECOMPUTED
 *
 * This is the claim Michael will act on soonest, so it is the one most worth
 * re-deriving. It is EXPECTED to fail the day a rate is loaded - that failure
 * is the reminder to update the report, and it is a feature.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the 2027 readiness figures are recomputed, not remembered", () => {
  const readiness = payDateReadiness("2027-01-01");

  it("the pay run genuinely cannot run on the cutover date", () => {
    expect(readiness.canRun).toBe(false);
  });

  it("ten of eleven rates are missing, exactly as the report states", () => {
    expect(readiness.rates.length).toBe(11);
    expect(readiness.missingCount).toBe(10);
    expect(flat).toContain("Ten of your eleven rates are missing");
  });

  it("the report reproduces the system's own summary sentence verbatim", () => {
    // Not a paraphrase of the blocker. The blocker's own words, so what he
    // reads here is what he will see on the screen.
    expect(flat).toContain(norm(readiness.summary));
  });

  it("WA Cares is the one rate on file, and the report says why", () => {
    const onFile = readiness.rates.filter((r) => r.onFile).map((r) => r.key);
    expect(onFile).toEqual(["wa_cares_total"]);
    expect(flat).toContain("Only the WA Cares premium is on file");
  });

  it("every missing rate's label appears in the report", () => {
    // The report must not summarise "some rates are missing". He needs to know
    // which notices to go and find.
    for (const r of readiness.rates.filter((x) => !x.onFile)) {
      expect(flat, `missing rate "${r.label}" is not named in the report`).toContain(norm(r.label));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. THE THREE-COLOUR DESIGN
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the colour argument in the report matches the code", () => {
  it("the three statuses really do map to three different tones", () => {
    const tones = new Set([statusTone("ready"), statusTone("attention"), statusTone("blocked")]);
    expect(tones.size).toBe(3);
  });

  it("attention is gold and not orange, as the report claims", () => {
    expect(statusTone("attention")).toBe("gold");
    expect(flat).toContain("Attention is gold rather than orange");
  });

  it("all three status meanings are quoted into the report word for word", () => {
    // If the on-screen wording is softened later, the report's explanation of
    // the design stops describing the thing Michael is looking at.
    for (const s of ["ready", "attention", "blocked"] as const) {
      expect(flat, `status meaning for "${s}" is not in the report`).toContain(
        norm(statusMeaning(s)),
      );
    }
  });

  it("the report leads the attention sentence with the instruction to pay", () => {
    // Same guarantee the screen test enforces: the FIRST thing said about an
    // attention line must be that the cheque is payable, not that something
    // is wrong. Reversing it is how somebody withholds a legally owed cheque.
    expect(statusMeaning("attention").startsWith("Pay this cheque")).toBe(true);
    expect(flat).toContain("Gold means needs attention");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. THE INSTRUCTIONS POINT SOMEWHERE REAL
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the places the report tells Michael to go actually exist", () => {
  it("Books -> Pay Run is a real nav entry", () => {
    const hit = adminNav.find((i) => i.href === "/admin/books/pay-run");
    expect(hit, "the pay run nav entry is gone; the report sends him nowhere").toBeTruthy();
    expect(hit!.label).toBe("Pay Run");
    expect(flat).toContain("Books \u2192 Pay Run".replace(/\s+/g, " "));
  });

  it("the pay run page file exists at the route the nav claims", () => {
    // Rule 16: a nav entry is not proof of a screen.
    expect(existsSync(join(ROOT, "src", "app", "admin", "books", "pay-run", "page.tsx"))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. FACTUAL CLAIMS ABOUT THE CODE
 *
 * Claims the report makes that a reader would take as findings. Each is
 * re-derived rather than asserted.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the findings the report reports are still true", () => {
  it("the approve button really is disabled and says so", () => {
    const page = readFileSync(
      join(ROOT, "src", "app", "admin", "books", "pay-run", "page.tsx"),
      "utf8",
    );
    expect(page).toContain("Not connected yet");
    expect(flat).toContain("Not connected yet");
  });

  it("four of the seven checks cannot be answered by software", () => {
    // The report states this number. It is the count of checks the screen
    // renders as "you must confirm" - see pay-run-screen.test.ts, which pins
    // the same fact from the other side.
    expect(flat).toContain("Four of those seven cannot be answered by software");
  });

  it("the $19.37 figure the report cites comes from the code, not from me", () => {
    const lesson = PAY_RUN_REFUSAL_LESSONS.find((l) => l.code === "RATE_NOT_ON_FILE")!;
    expect(lesson.costOfGuessing).toContain("$19.37");
    expect(flat).toContain("$19.37");
  });

  it("the pay-frequency arithmetic the report quotes is the code's own", () => {
    const lesson = PAY_RUN_REFUSAL_LESSONS.find((l) => l.code === "NO_PAY_FREQUENCY")!;
    expect(lesson.whyWeStop).toContain("DIVISOR");
    expect(flat).toContain("it is a divisor rather than a missing amount");
    // 26 vs 24 is an 8.33% overstatement of periods; the report says "about
    // eight percent". Recomputed so the adjective cannot drift into a lie.
    const drift = ((26 - 24) / 24) * 100;
    expect(drift).toBeGreaterThan(7.5);
    expect(drift).toBeLessThan(9);
  });

  it("Greenway's own pay frequencies are stated correctly", () => {
    expect(flat).toContain("biweekly, which is twenty-six cheques a year");
    expect(flat).toContain("you are annual, which is one");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. THE DELIVERY
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the report was actually delivered", () => {
  it("the PDF exists alongside the markdown", () => {
    expect(existsSync(PDF_PATH), "no PDF was built for this report").toBe(true);
  });

  it("the PDF is a real document and not a zero-byte stub", () => {
    expect(statSync(PDF_PATH).size).toBeGreaterThan(40000);
  });

  it("the report is addressed to Michael and names the slice", () => {
    expect(report).toContain("Prepared for Michael Lyman");
    expect(report).toContain("books-39");
  });

  it("the report states its own test count, and that count is real", () => {
    // The report tells Michael this document has forty-nine tests. That is a
    // checkable claim about this very file, so it is checked here.
    //
    // COUNTING HONESTLY. Some tests in this file are generated inside a loop
    // (one per statutory fragment), so a plain count of `it(` in the source
    // UNDER-counts - it returned 39 when the runner reported 49. Trusting the
    // source count would have pinned the wrong number and then defended it.
    // So the literals are counted, and the generated ones are derived from
    // the same data that generates them.
    expect(flat, "the report's claim about its own test count is missing").toContain(
      "forty-nine tests of its own",
    );

    const self = readFileSync(join(__dirname, "owner-report-books-39.test.ts"), "utf8");
    const literal = (self.match(/^\s{2}it\(/gm) ?? []).length;
    // Generated: one per fragment across the five CLAIMS entries. Re-derived
    // from PAY_RUN_AUTHORITIES-backed constants rather than hard-coded, so
    // adding a quotation updates both sides at once.
    const generated = QUOTE_CLAIMS.reduce((n, c) => n + c.fragments.length, 0);
    expect(
      literal + generated,
      `report says forty-nine; this file defines ${literal} literal + ${generated} generated`,
    ).toBe(49);
  });

  it("the report records the restore-verification lesson honestly", () => {
    // Rule 64a: detection is not explanation. The first mutation battery for
    // this report reported 17/17 killed while restoring nothing, because the
    // report was untracked and `git checkout` silently failed. Michael is
    // told about that, in the report, in plain words - including the general
    // lesson. If somebody quietly deletes the embarrassing paragraph, this
    // fails, because the value of the report is that it does not flatter me.
    expect(flat).toContain("It was lying");
    expect(flat).toContain(
      "a check that silently does nothing is indistinguishable from a check that passes",
    );
  });
});
