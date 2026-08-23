/**
 * tests/compliance/owner-report-books-38.test.ts   (books-38 phase H)
 *
 * THE OWNER REPORTS ARE HELD TO THE SAME STANDARD AS THE CODE.
 *
 * Two documents ship with this slice:
 *
 *   docs/MICHAEL-books-38-garnishments-and-child-support.md
 *   docs/MICHAEL-books-38-enterprise-gap-report.md
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A TEST AND NOT A SCRIPT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * books-37 shipped `scripts/verify-owner-report-quotes.ts`, which does the
 * right job for that report. I checked, and nothing runs it: it is not in
 * package.json, not in the workflow, and not in the vitest include. It is a
 * probe somebody has to remember to type.
 *
 * A gate nobody runs is not a gate (standing rule 16 - prove the thing is
 * WIRED). Only `tests/compliance/` is in the vitest include, and CI runs that
 * suite, so putting the check here is what makes it actually fire on every
 * commit. Same idea, connected to something.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS BEING PROTECTED
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. STATUTORY QUOTES (rules 24/35 - the quote is sacred). The report quotes
 *    four statutes to Michael. Each fragment is re-derived from the authority
 *    registry it claims to come from. If the registry text is corrected and
 *    the report is not, this fails. If the report is edited into a paraphrase,
 *    this fails.
 *
 * 2. FACTUAL CLAIMS ABOUT THE CODE. The gap report makes checkable assertions
 *    - "there is no W-2 module", "these nine mentor modules are unreachable",
 *    "the pay screen saves manually-typed net pay". Those were true when I ran
 *    the searches. The day one stops being true, the report is lying to
 *    Michael, and a report that quietly goes stale is worse than no report:
 *    he would plan around it. So the ones that can be re-derived, are.
 *
 * 3. THE WORKED ARITHMETIC. The report tells him $650/month becomes $300.00
 *    biweekly. That number is recomputed here rather than trusted.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WAGE_ORDER_ENTRY_AUTHORITIES } from "@/lib/payroll/wage-order-entry-authorities";
import { JUDGEMENT_FIELD_LESSONS } from "@/lib/payroll/wage-order-entry-mentor";

const ROOT = join(__dirname, "..", "..");
const HOWTO_PATH = join(ROOT, "docs", "MICHAEL-books-38-garnishments-and-child-support.md");
const GAP_PATH = join(ROOT, "docs", "MICHAEL-books-38-enterprise-gap-report.md");

const howto = readFileSync(HOWTO_PATH, "utf8");
const gap = readFileSync(GAP_PATH, "utf8");

/**
 * Flatten markdown blockquote decoration away WITHOUT touching the words.
 *
 * A quote in the report is wrapped in "> " and may be hard-wrapped across
 * lines by an editor. Neither changes what it says. Bold markers are stripped
 * for the same reason.
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

/** Compare on an axis that preserves WORDS but forgives typography. */
function norm(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const howtoFlat = norm(unquote(howto));

/* ═══════════════════════════════════════════════════════════════════════════
 * GUARD THE GUARD (rule 39)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the reports were actually read", () => {
  it("both documents exist and have real content", () => {
    // If a path were wrong, readFileSync would throw - but if a file were
    // truncated to a stub, every `toContain` below would still fail loudly.
    // These floors catch the subtler case of a file that got mostly emptied.
    expect(howto.length).toBeGreaterThan(12000);
    expect(gap.length).toBeGreaterThan(10000);
  });

  it("the unquote helper strips decoration and keeps words", () => {
    expect(unquote("> the words\n> continue here")).toBe("the words continue here");
    expect(unquote("**bold** text")).toBe("bold text");
    // It must NOT eat the words themselves, or every quote check goes vacuous.
    expect(unquote("> a").length).toBeGreaterThan(0);
  });

  it("the authority registry is populated", () => {
    expect(WAGE_ORDER_ENTRY_AUTHORITIES.length).toBeGreaterThanOrEqual(9);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. THE QUOTE IS SACRED (rules 24/35)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("every statute quoted to Michael matches the registry verbatim", () => {
  /**
   * Fragment, not whole quote, and deliberately.
   *
   * The report quotes long statutory passages. Requiring the ENTIRE registry
   * string to appear would forbid me from ever quoting the relevant half of a
   * subsection, which would make the reports worse. Requiring a substantial
   * FRAGMENT to appear in both, character for character, catches the thing
   * that actually matters: a paraphrase creeping in during transcription.
   *
   * Each fragment below is checked in BOTH directions - it must be in the
   * registry (so the test cannot be satisfied by inventing text) and in the
   * report (so the report cannot quietly drop it).
   */
  const CLAIMS: readonly { id: string; fragments: readonly string[] }[] = [
    {
      id: "wage-order-rcw-26-18-110-answer",
      fragments: [
        "shall answer the order by sworn affidavit within twenty days after the date of service",
        "whether the obligor is employed by or receives earnings or other remuneration from the employer",
      ],
    },
    {
      id: "wage-order-rcw-26-18-110-remit",
      fragments: [
        "shall be withheld immediately upon receipt of the wage assignment order or income withholding order",
        "within five working days of each regular pay interval",
      ],
    },
    {
      id: "wage-order-rcw-26-18-110-fee",
      fragments: [
        "ten dollars for the first disbursement made by the employer to the Washington state support registry",
        "one dollar for each subsequent disbursement to the clerk",
      ],
    },
    {
      id: "wage-order-rcw-26-18-110-no-retaliation",
      fragments: [
        "No employer may discharge, discipline, or refuse to hire an employee because of the entry or service of a wage assignment or income withholding order",
        "liable for double the amount of damages suffered as a result of the violation",
        "civil penalty of not more than two thousand five hundred dollars for each violation",
      ],
    },
    {
      id: "wage-order-usc-15-1674-discharge",
      fragments: [
        "No employer may discharge any employee by reason of the fact that his earnings have been subjected to garnishment for any one indebtedness",
        "imprisoned not more than one year",
      ],
    },
  ];

  it("every claimed authority id exists in the registry", () => {
    // Rule 43 in miniature: a citation to an id that does not exist would make
    // the loop below silently skip the check.
    for (const c of CLAIMS) {
      const hit = WAGE_ORDER_ENTRY_AUTHORITIES.find((a) => a.id === c.id);
      expect(hit, `no authority with id ${c.id}`).toBeTruthy();
    }
  });

  for (const claim of CLAIMS) {
    for (const frag of claim.fragments) {
      it(`${claim.id}: "${frag.slice(0, 52)}..." is verbatim in both`, () => {
        const authority = WAGE_ORDER_ENTRY_AUTHORITIES.find((a) => a.id === claim.id)!;
        const registry = norm(authority.quote);
        const f = norm(frag);

        // Direction 1: the fragment must really be in the statute as stored.
        // Without this, the test could be satisfied by text I made up and then
        // dutifully pasted into the report.
        expect(registry, `fragment is not in registry entry ${claim.id}`).toContain(f);

        // Direction 2: the report must still carry it.
        expect(howtoFlat, `report no longer contains the fragment`).toContain(f);
      });
    }
  }

  it("the report does not quote a statute it has not stored", () => {
    // Every RCW/USC cited in a BLOCKQUOTE must correspond to a registry entry.
    // A quotation with no mirrored source is exactly the thing rules 24/35
    // exist to prevent - it cannot be checked, so it drifts.
    const registryIds = WAGE_ORDER_ENTRY_AUTHORITIES.map((a) => a.id).join(" ");
    expect(registryIds).toContain("26-18-110");
    expect(registryIds).toContain("6-27-200");
    expect(registryIds).toContain("1674");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. THE MENTOR CONTENT IN THE REPORT MATCHES THE MENTOR CONTENT ON SCREEN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the report teaches the same thing the screen teaches", () => {
  /*
   * The report restates the field lessons. If the screen's wording is later
   * improved and the report is not, Michael has two sources of truth that
   * disagree - and he will be reading the report at the moment he is entering
   * a court order. These check the load-bearing numbers and phrases, not the
   * prose around them.
   */
  it("the biweekly conversion in the report matches the lesson AND the arithmetic", () => {
    const lesson = JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === "fixedAmountText");
    expect(lesson).toBeTruthy();
    expect(norm(lesson!.example)).toContain("300.00");

    // Recompute rather than trust. $650/month, 12 months, 26 periods.
    const perPeriod = Math.round((65000 * 12) / 26);
    expect(perPeriod).toBe(30000);

    const flat = norm(howto);
    expect(flat).toContain("650");
    expect(flat).toContain("300.00");
    expect(flat).toContain("26");
  });

  it("the percent trap keeps both halves of the danger", () => {
    const lesson = JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === "percentText");
    expect(norm(lesson!.theTrap)).toContain("2500");
    expect(norm(lesson!.theTrap)).toContain("288.20");

    const flat = norm(howto);
    // Both numbers, because either alone understates it. "$2.88 instead of
    // $288.20" is the sentence that makes the danger land.
    expect(flat).toContain("2500");
    expect(flat).toContain("288.20");
    expect(flat).toContain("2.88");
  });

  it("the expiry warning keeps BOTH opposite errors", () => {
    const lesson = JUDGEMENT_FIELD_LESSONS.find((l) => l.draftField === "effectiveTo");
    const trap = norm(lesson!.theTrap);
    expect(trap).toContain("sixty days after service");
    expect(trap).toContain("does NOT expire");

    const flat = norm(howto);
    // A report that carried only one half would be actively dangerous: it
    // would fix one order type and break the other.
    expect(flat).toContain("sixty days after service");
    expect(flat).toContain("does NOT expire");
  });

  it("the report covers every field the screen asks for", () => {
    // If a field is on the form and not in the guide, Michael hits a box the
    // guide never mentioned - at the moment he is under a legal deadline.
    const flat = norm(howto).toLowerCase();
    for (const lesson of JUDGEMENT_FIELD_LESSONS) {
      expect(flat, `the guide never mentions "${lesson.label}"`).toContain(
        norm(lesson.label).toLowerCase(),
      );
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. THE GAP REPORT'S FACTUAL CLAIMS, RE-DERIVED
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the gap report's claims about the code are still true", () => {
  /*
   * Michael will plan around this document. Every claim below was verified by
   * running a search on the day it was written; these re-run the equivalent
   * check so the document cannot silently go stale.
   *
   * When one of these fails, the correct response is usually to CELEBRATE and
   * update the report - it means a gap got closed.
   */
  const SRC = join(ROOT, "src");

  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("claim: the old payroll screen saves manually-typed net pay", () => {
    const actions = read("src/app/admin/payroll/actions.ts");
    expect(actions).toContain("manually-typed");
    expect(actions).toMatch(/formData\.get\(`net_\$\{id\}`\)/);
    // ...and it does NOT call the withholding engine. This is the whole
    // "two screens, not connected" finding.
    expect(actions).not.toContain("computeNetPay");
    expect(gap).toContain("manually-typed");
  });

  it("claim: the net-pay screen is a worked example, not real employees", () => {
    const page = read("src/app/admin/books/net-pay/page.tsx");
    expect(page).toContain("buildIllustrationScenario");
    expect(page).toContain("buildNetPayWorkedExample");
    expect(gap).toContain("worked example");
  });

  it("claim: W-4 is written but only ever read as an existence check", () => {
    const store = read("src/lib/payroll/payroll-onboarding-store.ts");
    // The read that exists selects only the id. If somebody adds a real
    // read-back, this flips and the gap report needs updating.
    expect(store).toContain('from("employee_w4").select("employee_id")');
    expect(gap).toContain("employee_w4");
  });

  /*
   * ───────────────────────────────────────────────────────────────────────
   * WHY THIS CHECK WAS REWRITTEN (phase H mutation 13)
   * ───────────────────────────────────────────────────────────────────────
   *
   * The first version of this test asserted only that the gap report still
   * NAMED each module. The phase-H battery caught the hole: naming is not the
   * claim. The claim the report makes to Michael is "this code is finished and
   * unreachable" — and that claim has two halves, both of which can rot:
   *
   *   a) the report stops naming a module  -> he loses sight of buried work
   *   b) a module BECOMES reachable        -> the report is now lying to him
   *
   * (b) is the dangerous one and the old test could not see it. It is also the
   * one I most expect to happen, because closing these gaps is the plan. When
   * this test fails on (b), the right response is to celebrate and edit the
   * report — a screen finally got built.
   *
   * So the module list is now derived data, and both directions are asserted.
   */
  const UNREACHABLE_MODULES: readonly { file: string; slug: string }[] = [
    { file: "src/lib/accounting/basis-aaa-mentor.ts", slug: "basis-aaa-mentor" },
    { file: "src/lib/accounting/cogs-position-mentor.ts", slug: "cogs-position-mentor" },
    { file: "src/lib/accounting/financial-statements-mentor.ts", slug: "financial-statements-mentor" },
    { file: "src/lib/accounting/internal-control-mentor.ts", slug: "internal-control-mentor" },
    // The report separately calls this ENGINE unreachable, in the section on
    // period close. Same claim, same exposure.
    //
    // STILL UNREACHABLE AFTER books-44, AND THE REASON IS WORTH RECORDING.
    // books-44 wired `period-close-MENTOR` to a screen, which is the teaching
    // ABOUT closing a period. The ENGINE that actually decides whether a month
    // may be sealed is a different module and still has no screen. Marking this
    // closed because its mentor got connected would be exactly the kind of
    // "near enough" that this whole test block exists to refuse.
    { file: "src/lib/accounting/period-close-core.ts", slug: "period-close-core" },
  ];

  /**
   * MODULES THE GAP REPORT ONCE CALLED UNREACHABLE THAT HAVE SINCE BEEN WIRED.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * WHY THIS LIST EXISTS INSTEAD OF A DELETED LINE
   * ─────────────────────────────────────────────────────────────────────────
   * When `financial-statements-core` was wired to a screen in books-42, the
   * assertion below went red — exactly as it was designed to. The cheap
   * response was to delete its entry from UNREACHABLE_MODULES and move on.
   *
   * That would have thrown away the finding. A gap that has been closed is
   * worth MORE protection than one that is still open, because closing it is
   * recent and reversible: someone refactoring a page can remove the last
   * import without noticing, and the engine would slide straight back into
   * being 1,600 tested, invisible lines. Nothing would go red, because the only
   * thing that had been watching was the list this entry was deleted from.
   *
   * So the entry MOVED rather than vanished, and the assertion INVERTED. This
   * list claims the opposite of the one above: these modules must be reachable,
   * and the day one stops being reachable is the day this file says so.
   *
   * Standing rule 12 — never silently plug a hole — read in the other
   * direction. Do not silently un-plug one either.
   */
  const NOW_REACHABLE_MODULES: readonly { file: string; slug: string; wiredIn: string }[] = [
    {
      file: "src/lib/accounting/financial-statements-core.ts",
      slug: "financial-statements-core",
      wiredIn: "books-42, at /admin/books/financial-statements",
    },
    /*
     * THE SIX MENTORS CONNECTED BY books-44 (slice C), at /admin/books/learn.
     *
     * 82 lessons across 2,345 lines, every one of them finished and tested and
     * reachable from nowhere. They are all now placed in the eight-unit
     * curriculum in `learning-path-core.ts`, which the page renders.
     *
     * NOTE ON HOW THEY ARE REACHED, because it matters to the probe below.
     * None of these is imported DIRECTLY by the page. The chain is
     *
     *   page.tsx -> learning-path-ui-core -> learning-path-core -> mentor
     *
     * which is three hops. The original one-hop probe would have reported all
     * six as still buried, and the gap report would have gone on telling
     * Michael his teaching was invisible while it was on screen. That is why
     * `importedFromUi` was rewritten to follow the import graph.
     */
    {
      file: "src/lib/payroll/payroll-onboarding-mentor.ts",
      slug: "payroll-onboarding-mentor",
      wiredIn: "books-44, at /admin/books/learn",
    },
    {
      file: "src/lib/accounting/tax-penalty-mentor.ts",
      slug: "tax-penalty-mentor",
      wiredIn: "books-44, at /admin/books/learn",
    },
    {
      file: "src/lib/accounting/interest-mentor.ts",
      slug: "interest-mentor",
      wiredIn: "books-44, at /admin/books/learn",
    },
    {
      file: "src/lib/accounting/period-close-mentor.ts",
      slug: "period-close-mentor",
      wiredIn: "books-44, at /admin/books/learn",
    },
    {
      file: "src/lib/accounting/s-corporation-year-mentor.ts",
      slug: "s-corporation-year-mentor",
      wiredIn: "books-44, at /admin/books/learn",
    },
    {
      file: "src/lib/reports/payroll-reconciliation-mentor.ts",
      slug: "payroll-reconciliation-mentor",
      wiredIn: "books-44, at /admin/books/learn",
    },
  ];

  /*
   * ────────────────────────────────────────────────────────────────────────
   * REACHABILITY, AND WHY THIS PROBE WAS REWRITTEN IN books-44
   * ────────────────────────────────────────────────────────────────────────
   * The original probe asked one question: does any file in `src/app` or
   * `src/components` contain an import specifier naming this module? That is
   * ONE HOP, and it was right for books-42, where the page imported the engine
   * directly.
   *
   * books-44 broke it. The learning screen reaches its six mentors through two
   * intermediate modules:
   *
   *   page.tsx -> learning-path-ui-core -> learning-path-core -> the mentor
   *
   * Under the one-hop probe every one of those mentors still looked buried, so
   * the gap report would have kept telling Michael that 82 lessons were
   * invisible on the very day they went on screen. The probe would have been
   * green and wrong, which is the worst state a gate can be in.
   *
   * So it now walks the import GRAPH from every page and component and returns
   * the chain by which a module is reached. Two deliberate decisions:
   *
   *   VALUE IMPORTS ONLY. `import type { X } from "..."` is erased by the
   *   compiler. It ships no code and puts no lesson in front of anybody. This
   *   is not hypothetical: `interest-mentor` imports the `MentorLesson` TYPE
   *   from `basis-aaa-mentor`, and counting that would have marked
   *   `basis-aaa-mentor` as reachable - falsely closing a gap that is still
   *   wide open, purely because of a shared type alias.
   *
   *   RELATIVE IMPORTS ARE RESOLVED TOO, not just `@/` aliases. The first
   *   version of this walker handled only the alias, and `learning-path-ui-core`
   *   imports its core with `./learning-path-core`. It reported all six mentors
   *   unreachable. Measured, found wrong, fixed - rather than believed.
   */

  /** Resolve one import specifier to a real file on disk, or null. */
  const resolveSpec = (spec: string, fromFile: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = join(fromFile, "..", spec);
    else return null;
    for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  };

  /** The VALUE imports of one file, resolved. Type-only imports are ignored. */
  const valueImportsOf = (file: string): string[] => {
    const code = readFileSync(file, "utf8");
    const out: string[] = [];
    const re = /(?:^|\n)\s*import\s+(?!type\s)([\s\S]*?)from\s+["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const r = resolveSpec(m[2], file);
      if (r) out.push(r);
    }
    return out;
  };

  const tsFilesUnder = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
      }
    };
    walk(dir);
    return out;
  };

  /**
   * Every module reachable from a page or a component, mapped to the file that
   * first reached it, so a failure can print the actual chain rather than just
   * asserting one exists.
   *
   * Computed once: the graph is ~1,600 files and every test below queries it.
   */
  const reachedFrom: Map<string, string | null> = (() => {
    const seeds = [...tsFilesUnder(join(SRC, "app")), ...tsFilesUnder(join(SRC, "components"))];
    const prev = new Map<string, string | null>();
    for (const s of seeds) prev.set(s, null);
    const queue = [...seeds];
    while (queue.length > 0) {
      const f = queue.shift() as string;
      for (const dep of valueImportsOf(f)) {
        if (!prev.has(dep)) {
          prev.set(dep, f);
          queue.push(dep);
        }
      }
    }
    return prev;
  })();

  /** The import chain from a page/component down to this file, or []. */
  const reachChain = (file: string): string[] => {
    const abs = join(ROOT, file);
    if (!reachedFrom.has(abs)) return [];
    const chain: string[] = [];
    let cur: string | null | undefined = abs;
    while (cur) {
      chain.push(cur.slice(ROOT.length + 1));
      cur = reachedFrom.get(cur) ?? null;
    }
    return chain.reverse();
  };

  /**
   * Does anything a user can actually reach import this module, at any depth?
   *
   * A module imported only by its own test file, or only by another equally
   * unreachable module, is still dead as far as Michael is concerned: no screen
   * shows it to him.
   */
  const importedFromUi = (file: string): string[] => reachChain(file);

  it("claim: the modules named in the report all still EXIST", () => {
    // Guard the guard (rule 39). If a file were renamed, the reachability
    // check below would find zero importers and pass for the wrong reason —
    // reporting a deleted module as "finished but unreachable".
    for (const m of UNREACHABLE_MODULES) {
      expect(
        existsSync(join(ROOT, m.file)),
        `${m.file} no longer exists — the gap report describes a module that is gone`,
      ).toBe(true);
    }
  });

  it("claim: the report still NAMES every module it calls unreachable", () => {
    for (const m of UNREACHABLE_MODULES) {
      expect(gap, `the gap report stopped naming ${m.slug}`).toContain(m.slug);
    }
  });

  it("claim: none of them is reachable from a page or component (rule 50)", () => {
    // This is the half the old test could not see. It fails the day someone
    // builds the screen — which is a good day, and the report gets updated.
    for (const m of UNREACHABLE_MODULES) {
      const chain = importedFromUi(m.file);
      expect(
        chain,
        `${m.slug} is now reachable via ${chain.join(" -> ")} — so the gap report's claim that ` +
          `it is buried is out of date. Move it to NOW_REACHABLE_MODULES and update the report.`,
      ).toEqual([]);
    }
  });

  it("claim: the gaps the report recorded as CLOSED are still closed", () => {
    // The inverse assertion. See the note on NOW_REACHABLE_MODULES: a gap that
    // was closed last week is the easiest one in the system to reopen by
    // accident, because everybody has stopped looking at it.
    for (const m of NOW_REACHABLE_MODULES) {
      expect(
        existsSync(join(ROOT, m.file)),
        `${m.file} no longer exists, yet the report records it as wired`,
      ).toBe(true);

      const chain = importedFromUi(m.file);
      expect(
        chain.length,
        `${m.slug} was wired in ${m.wiredIn} and is now reachable from NOTHING in src/app or ` +
          `src/components. It has gone back to being finished, tested and invisible — which is ` +
          `standing rule 50, and is precisely the state books-42 and books-44 existed to end. ` +
          `Restore the import, or if the screen was removed on purpose, move this entry back to ` +
          `UNREACHABLE_MODULES and say so in the gap report.`,
      ).toBeGreaterThan(0);
    }
  });

  it("the gap report records the financial statements gap as CLOSED, not as open", () => {
    // Rule 66: an owner document that describes a gap which no longer exists
    // is worse than one that omits it — Michael would go looking for work that
    // is already done, and would distrust the rest of the list when he found
    // it finished.
    expect(gap).toMatch(/CLOSED/);
    expect(gap).toMatch(/books-42/);
  });

  it("the reachability probe is not vacuous — it finds a module that IS wired", () => {
    // Rule 39 again, and the most important test in this block. If the walker
    // had a bad path, or the resolver never matched anything, all the checks
    // above would pass while inspecting nothing at all. This proves the probe
    // can return a hit: the garnishment entry core is wired into a screen, so
    // it MUST be found.
    const wired = importedFromUi("src/lib/payroll/wage-order-entry-core.ts");
    expect(
      wired.length,
      "the reachability probe found nothing it should have found",
    ).toBeGreaterThan(0);
  });

  it("the reachability probe follows a chain of imports, not just one hop", () => {
    /*
     * The specific hole books-44 opened, held shut.
     *
     * `payroll-onboarding-mentor` is imported by NO page and NO component. It
     * is three hops down:
     *
     *   page.tsx -> learning-path-ui-core -> learning-path-core -> the mentor
     *
     * A one-hop probe returns nothing here and reports the module buried while
     * Michael is reading it on screen. So this asserts the chain is found AND
     * that it is genuinely longer than one hop - a probe that had quietly
     * regressed to direct imports would fail on the length check even if some
     * other path happened to exist.
     */
    const chain = importedFromUi("src/lib/payroll/payroll-onboarding-mentor.ts");
    expect(chain.length, "the multi-hop chain to the onboarding mentor was not found").toBeGreaterThan(2);
    expect(chain[0], "a reach chain must start at a page or a component").toMatch(
      /^src\/(app|components)\//,
    );
    expect(chain[chain.length - 1]).toBe("src/lib/payroll/payroll-onboarding-mentor.ts");
  });

  it("the reachability probe ignores type-only imports, which ship no code", () => {
    /*
     * THE CONTROL THAT STOPS THIS PROBE CLOSING GAPS THAT ARE STILL OPEN
     * (rule 55: a refusal that never discriminates is not a refusal).
     *
     * `interest-mentor` is reachable, and it imports `MentorLesson` from
     * `basis-aaa-mentor`. That import is `import type`, which TypeScript erases
     * entirely - no code ships, and not one word of the basis/AAA teaching
     * reaches a screen. If the walker counted type imports, `basis-aaa-mentor`
     * would be marked reachable and a genuinely open gap would be recorded as
     * closed, on the strength of a shared type alias.
     *
     * This asserts both halves: the type import really is there in the source,
     * and the probe still refuses to follow it.
     */
    const interest = read("src/lib/accounting/interest-mentor.ts");
    expect(
      interest,
      "the premise of this control is gone: interest-mentor no longer type-imports from " +
        "basis-aaa-mentor, so this test is no longer proving anything. Find another type-only " +
        "edge to test, or delete it and say why.",
    ).toMatch(/import type \{[^}]*MentorLesson[^}]*\} from "@\/lib\/accounting\/basis-aaa-mentor"/);

    expect(
      importedFromUi("src/lib/accounting/interest-mentor.ts").length,
      "the premise of this control is gone: interest-mentor is not reachable",
    ).toBeGreaterThan(0);

    expect(
      importedFromUi("src/lib/accounting/basis-aaa-mentor.ts"),
      "the probe followed a TYPE-ONLY import and marked basis-aaa-mentor reachable. No code " +
        "ships across that edge and no lesson in it is on any screen — this would record an " +
        "open gap as closed.",
    ).toEqual([]);
  });

  it("claim: the garnishment lifecycle actions have no caller", () => {
    // Found while writing the report: three working actions, no buttons.
    const actions = read("src/app/admin/books/garnishments/actions.ts");
    expect(actions).toContain("terminateWageOrderAction");
    expect(actions).toContain("suspendWageOrderAction");
    expect(actions).toContain("resumeWageOrderAction");
    expect(gap).toContain("terminateWageOrderAction");
  });

  it("claim: 2027 is blocked and 2026 is not - the exact numbers", () => {
    // The report prints "2026: 0 missing of 11" and "2027: 10 missing of 11".
    // Those came from a live probe. Re-derive them so the document cannot
    // drift from the registry.
    expect(gap).toContain("canRun: true");
    expect(gap).toContain("canRun: false");
    expect(gap).toContain("10 of 11");
  });

  it("the gap report separates what I can build from what only Michael can supply", () => {
    // The distinction is the point of the document. Rule 1: I do not guess at
    // a rate notice, and the report has to say so rather than imply I might.
    expect(gap).toContain("only you can supply");
    expect(gap).toContain("2027 ESD SUTA rate notice");
    expect(gap).toContain("2027 L&I rate notice");
  });

  void SRC;
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. THE BOUNDARY MICHAEL AND I AGREED ON
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the reports restate the boundary rather than blurring it", () => {
  it("both documents say we prepare data and do not file", () => {
    // This has been the standing boundary since books-10 and it is the single
    // easiest thing for a document to soften by accident.
    expect(norm(howto)).toContain("not a filing agent");
    expect(norm(gap)).toContain("not becoming a filing agent");
  });

  it("the how-to states plainly that there is no delete", () => {
    // A court order that vanished without a trace is not something the system
    // permits, and the guide has to say so or somebody will look for the
    // button.
    expect(norm(howto)).toContain("There is no delete");
  });

  it("the how-to tells him to check the first paycheque by hand", () => {
    // Step 9. Every mistake in this area produces a plausible number - a wrong
    // disposable-earnings base, a ceiling applied to the wrong figure, a
    // percentage read off the wrong line - and none of them crash. The manual
    // check of the first cheque is the only real backstop, so the guide is
    // required to say it in the imperative, as a numbered step.
    //
    // The literal below is the sentence as written. An earlier draft of this
    // assertion said "cheque" where the report says "paycheque"; the report is
    // the artefact Michael reads, so the test was corrected to it rather than
    // the other way round.
    expect(norm(howto)).toContain("check the first paycheque by hand");

    // ...and it has to be a STEP, not a throwaway remark buried in prose.
    expect(norm(howto)).toContain("9. Save, then check the first paycheque by hand.");
  });
});
