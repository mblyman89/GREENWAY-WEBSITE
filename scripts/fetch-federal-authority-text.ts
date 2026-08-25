/**
 * scripts/fetch-federal-authority-text.ts
 *
 * MIRROR THE FEDERAL SOURCES SO RULE 35 CAN REACH THEM.
 *
 * books-18 could machine-verify its quotes because Michael had supplied the
 * FASB Codification text. books-19 quotes the Internal Revenue Code and the
 * Code of Federal Regulations, and at the start of that slice neither was on
 * disk — so `verify-verbatim-quotes.ts` had to skip all fourteen of the new
 * authorities. A quote nobody can check is a quote standing rule 24 does not
 * actually protect.
 *
 * Unlike the Codification, these are EDICTS OF GOVERNMENT: works of the United
 * States, not subject to copyright (17 U.S.C. §105; Banks v. Manchester, 128
 * U.S. 244 (1888)). There is no licensing reason not to mirror them, so this
 * script does, from the official publishers:
 *
 *   - CFR : the eCFR renderer API, ecfr.gov  (GPO / Office of the Federal Register)
 *   - USC : the House Office of the Law Revision Counsel via Cornell LII
 *
 * Run:  npx tsx scripts/fetch-federal-authority-text.ts
 *
 * The output is deliberately committed rather than fetched at build time. A
 * verifier that needs the network is a verifier that goes green when the
 * network is down (standing rule 15: every test must be provably failable, and
 * failable for the RIGHT reason).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A CFR target defaults to 26 CFR part 1 subchapter A, because that is what
 * every slice before books-25 needed. books-25 quotes two regulations that
 * live elsewhere — the I-9 rule is in TITLE 8 (immigration) and the W-4 rule
 * is in title 26 PART 31 (employment taxes, subchapter C) — so the title, part
 * and subchapter are now overridable. They are optional rather than required
 * so the twenty existing entries did not have to be rewritten to add a slice.
 */
type Target =
  | {
      readonly kind: "cfr";
      readonly section: string;
      readonly title?: number;
      readonly part?: string;
      readonly subchapter?: string;
      /** Filename override. Title 8 §274a.2 must not collide with a title 26 §274a.2. */
      readonly file?: string;
      /** Citation label override, for the same reason. */
      readonly label?: string;
    }
  | { readonly kind: "usc"; readonly section: string }
  /**
   * A published IRS web page, added books-55.
   *
   * WHY A THIRD KIND WAS NEEDED, AND WHY THE ALTERNATIVE WAS WORSE. books-55
   * quotes the IRS's own page "S corporation compensation and medical insurance
   * issues", which is the clearest published statement of how §3121(a)(2) and
   * §3306(b)(2) apply to a shareholder-employee's health premium. It is not a
   * numbered publication, so the corpus router had nothing to route its cite to,
   * and `form-w2-authorities.test.ts` failed with "routes to no mirrored file".
   *
   * The cheap fix was an entry in `KNOWN_UNMIRRORED_AUTHORITY_IDS`. The comment
   * on §6051 above already rejects that reasoning in almost these words: that
   * list "is honest debt, not a parking space", and declaring "cannot check"
   * about a work of the United States Government sitting behind a public URL
   * "would be a choice, not a limitation". Worse, this particular quote is the
   * one Michael is most likely to act on, since it is the paragraph that decides
   * roughly $4,740 of FICA on his own return.
   *
   * `slug` is explicit rather than derived from the URL, because a page title is
   * not a filename and guessing one would produce names nobody can predict.
   */
  | { readonly kind: "irs-page"; readonly slug: string; readonly url: string; readonly label: string };

/** The sources books-19 and books-20 quote. Extend as later slices need more. */
const TARGETS: readonly Target[] = [
  // books-19 \u2014 basis and AAA
  { kind: "cfr", section: "1.1361-1" },
  { kind: "cfr", section: "1.1367-1" },
  { kind: "cfr", section: "1.1367-2" },
  { kind: "cfr", section: "1.1368-1" },
  { kind: "cfr", section: "1.1368-2" },
  { kind: "usc", section: "1361" },
  { kind: "usc", section: "1366" },
  { kind: "usc", section: "1367" },
  { kind: "usc", section: "1368" },
  // books-20 \u2014 cost of goods sold, inventories, and methods of accounting
  { kind: "cfr", section: "1.446-1" },
  { kind: "cfr", section: "1.471-1" },
  { kind: "cfr", section: "1.471-2" },
  { kind: "cfr", section: "1.471-3" },
  { kind: "cfr", section: "1.61-3" },
  { kind: "usc", section: "446" },
  { kind: "usc", section: "471" },
  { kind: "usc", section: "481" },
  { kind: "usc", section: "280E" },
  { kind: "usc", section: "162" },
  // books-21 \u2014 interest on underpayments and the failure-to-file minimum.
  //
  // These three are quoted because Michael supplied the RATES from memory and
  // from a table, and standing rule 1 does not make an exception for the
  // owner. The rate ADDITIONS (three points, five points, half a point) and
  // the compounding period are written in the statute; a summary of them is
  // not a source. \u00a76622 in particular was not mentioned to me at all, and it
  // is the provision that turns a small balance into a large one, so it is
  // mirrored here to be quoted rather than paraphrased.
  { kind: "usc", section: "6621" },
  { kind: "usc", section: "6622" },
  { kind: "usc", section: "6651" },
  // \u00a76699 is the penalty for filing Form 1120-S late, and it did not appear
  // anywhere in this codebase before books-21. It is mirrored because it is the
  // provision that actually applies to Greenway: \u00a76651 charges a percentage of
  // the tax shown on the return, an S corporation normally shows none, so the
  // penalty engine reported a year-late 1120-S as costing $0.00. The real floor
  // is $195 (as adjusted) per shareholder per month.
  { kind: "usc", section: "6699" },
  // books-25 — hiring paperwork: the W-4 and the I-9.
  //
  // Michael asked the system to teach him how to answer an employee who asks
  // "how do I fill this out?", and to refuse rather than warn when a form is
  // not valid. Both of those need the actual rule, not a payroll vendor's
  // summary of it, so both are mirrored here.
  //
  // 26 CFR §31.3402(f)(2)-1 is the WITHHOLDING CERTIFICATE regulation: what a
  // valid W-4 is, what an employer must do with an invalid one, and what to
  // withhold when an employee furnishes nothing at all. Note the part number —
  // 31, not 1 — which is why `part` and `subchapter` had to become parameters.
  {
    kind: "cfr",
    section: "31.3402(f)(2)-1",
    part: "31",
    subchapter: "C",
    label: "26 CFR §31.3402(f)(2)-1",
  },
  // 8 CFR §274a.2 is the I-9 regulation: the three-business-day deadline, the
  // retention period, the rule that only unexpired documents count, and the
  // limitation that makes I-9 data legally quarantined from everything else in
  // this system.
  {
    kind: "cfr",
    section: "274a.2",
    title: 8,
    part: "274a",
    subchapter: "B",
    file: "cfr-8-274a.2.txt",
    label: "8 CFR §274a.2",
  },
  // books-25, second pass — §3401(b), the DEFINITION OF A PAYROLL PERIOD.
  //
  // Mirrored because of a defect this slice found and fixed. Pub. 15-T's
  // Worksheet 1A carries a small table of pay cadences ("Table 3") that lists
  // seven of them and does NOT list "Annually" — while migration 0195 accepts
  // a pay_frequency of 'annually' for Michael's own once-a-year salary. The
  // engine had transcribed Table 3 faithfully, so an annual period produced
  // `undefined` periods per year and then threw a message about floats.
  //
  // The fix rests entirely on this statute naming the annual payroll period
  // outright, so the statute belongs on disk where rule 35 can check the quote
  // rather than in a comment asserting what it says.
  { kind: "usc", section: "3401" },
  // books-43 — §6051, THE STATUTE THAT MAKES THE W-2 EXIST AT ALL.
  //
  // Everything the annual-forms slice quotes about Form W-2 comes from the
  // INSTRUCTIONS, which are `irs_guidance`: the agency's view of its own form,
  // persuasive but not law. That is a fine source for "which box does this go
  // in", and a poor one for "why must I do this at all". §6051(a) is the
  // answer to the second question — it is the duty itself, and it is a
  // statute, so it outranks every instruction quoted alongside it.
  //
  // MIRRORED RATHER THAN ADDED TO `KNOWN_UNMIRRORED_AUTHORITY_IDS`. That list
  // is honest debt, not a parking space: each entry is a quote no script can
  // check. §6051 is a work of the United States Government, freely available,
  // and one HTTP request away — so declaring it "cannot check" while the text
  // sits behind a public URL would be a choice, not a limitation. books-26 and
  // books-37 both paid down this list the same way, and books-37 found a
  // reassembled quote the moment it did.
  //
  // It also carries the two facts the engine downstream actually enforces and
  // which the Instructions state only as deadlines in passing: the statement
  // is due to the EMPLOYEE by January 31 following the calendar year, and the
  // duty attaches to "every person required to deduct and withhold" — which is
  // why an S corporation paying its owner-employee cannot opt out of it.
  { kind: "usc", section: "6051" },
  // books-55 — §3121 AND §3306, THE TWO DEFINITIONS OF "WAGES" THAT DECIDE
  // WHETHER A SHAREHOLDER-EMPLOYEE'S HEALTH PREMIUM IS TAXED TWICE.
  //
  // Mirrored because Michael told me, in as many words, that HE prepared the
  // 2025 W-2s and the W-3 and that it is "very likely I did it wrong" — and
  // asked that the lessons be built "based on legal authoritative text rather
  // than trusting my bad accounting."
  //
  // Until this slice the codebase had no statute for the rule it was teaching.
  // `form-w2-authorities.ts` quoted the INSTRUCTIONS' box-3 carve-out, which
  // says the premium goes in box 1 "but only if not excludable under section
  // 3121(a)(2)(B)" — a cross-reference to a statute that was not on disk. So
  // the operative condition, the part that decides the answer, was the one
  // part no script could check. That is exactly the hole standing rule 24
  // exists to close, and it was hiding inside a quote that itself passed.
  //
  // §3121(a)(2)(B) is the FICA side: Social Security and Medicare, boxes 3
  // through 6 of the W-2 and lines 5a/5c of the 941.
  { kind: "usc", section: "3121" },
  // §3306(b)(2)(B) is the FUTA side, and it is here because the same premium
  // appears a THIRD time on Form 940 line 3 with line 4a "Fringe benefits"
  // unchecked. Mirroring only the FICA statute would have taught two thirds of
  // the question and left the unemployment third resting on an IRS web page.
  // The two provisions are near-identical in wording, which is itself the
  // teaching point: one condition governs three forms.
  { kind: "usc", section: "3306" },
  // books-55 — the IRS's plain-language application of both statutes above to an
  // S corporation shareholder-employee. Mirrored rather than exempted; see the
  // note on the "irs-page" kind for why the exemption was refused.
  {
    kind: "irs-page",
    slug: "irs-scorp-compensation-and-medical-insurance",
    url: "https://www.irs.gov/businesses/small-businesses-self-employed/s-corporation-compensation-and-medical-insurance-issues",
    label: "IRS, S corporation compensation and medical insurance issues",
  },
];

/**
 * Mirror only the targets a slice actually needs.
 *
 * Every run before books-55 re-fetched all forty sources and rewrote all forty
 * files. That is fine the first time and harmful afterwards: a slice about the
 * FICA treatment of health premiums would have shown up in review as forty
 * changed authority files, with the two that mattered buried among thirty-eight
 * whose only difference was a new "Retrieved" date. Reviewing a diff nobody
 * can read is not reviewing it.
 *
 * Usage:  npx tsx scripts/fetch-federal-authority-text.ts --only=usc-3121.txt,usc-3306.txt
 *
 * With no `--only` the behaviour is exactly as before, so re-mirroring the
 * whole corpus is still one command.
 */
function selectedTargets(argv: readonly string[]): readonly Target[] {
  const flag = argv.find((a) => a.startsWith("--only="));
  if (flag === undefined) return TARGETS;
  const wanted = new Set(
    flag
      .slice("--only=".length)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  if (wanted.size === 0) {
    throw new Error("--only was given with no filenames; refusing to fetch nothing silently");
  }
  const picked = TARGETS.filter((t) => wanted.has(fileNameFor(t)));
  // A typo'd filename must not quietly mirror less than asked. Naming a file
  // that is not a target is a mistake, and a mistake that prints "wrote 1
  // file" and exits 0 is the kind standing rule 39 is about.
  const missing = [...wanted].filter((w) => !TARGETS.some((t) => fileNameFor(t) === w));
  if (missing.length > 0) {
    throw new Error(
      `--only named ${missing.length} file(s) that are not declared targets: ${missing.join(", ")}. ` +
        `Add the target to TARGETS first.`,
    );
  }
  return picked;
}

/**
 * The on-disk filename for a target.
 *
 * Extracted from `main` in books-55 so `--only` and the writer cannot disagree
 * about what a target is called. When two places compute the same name from the
 * same shape, one of them eventually stops matching the other.
 */
function fileNameFor(t: Target): string {
  if (t.kind === "cfr") return t.file ?? `cfr-${t.section}.txt`;
  if (t.kind === "irs-page") return `${t.slug}.txt`;
  return `usc-${t.section}.txt`;
}

function urlFor(t: Target): string {
  if (t.kind === "irs-page") return t.url;
  if (t.kind === "cfr") {
    const title = t.title ?? 26;
    const part = t.part ?? "1";
    const subchapter = t.subchapter ?? "A";
    return (
      `https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-${title}` +
      `?chapter=I&subchapter=${subchapter}&part=${part}&section=${t.section}`
    );
  }
  return `https://www.law.cornell.edu/uscode/text/26/${t.section}`;
}

/**
 * Strip markup to plain text.
 *
 * Anchors are unwrapped rather than removed because Cornell wraps defined
 * terms in links MID-SENTENCE — dropping the whole element would silently eat
 * words out of the statute, which is the exact failure this whole apparatus
 * exists to prevent.
 */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Cornell renders a subsection heading as its own span that runs STRAIGHT
    // into the body text, with no punctuation between them:
    //
    //   <span class="heading">Increases in basis</span><span>The basis of...
    //
    // Rendered naively that becomes "Increases in basisThe basis of", which is
    // not a sentence and matches nothing. The printed statute puts a full stop
    // there, so this does too. That is a TYPOGRAPHIC decision about how to
    // linearise nested markup, not an edit to the words \u2014 no word is added,
    // removed, or reordered.
    .replace(/<span class="heading[^"]*"[^>]*>\s*([^<]*?)\s*<\/span>/gi, "$1. ")
    // The matching problem in the other direction: the paragraph NUMBER span
    // has no space after it either, giving "(b)S corporation" and
    // "(1)Increases in basis". One space, added consistently, then collapsed
    // by `normalise` on both sides of the later comparison.
    .replace(/<span class="num[^"]*"[^>]*>\s*([^<]*?)\s*<\/span>/gi, "$1 ")
    // Inline elements are unwrapped with NO separator. eCFR italicises the
    // defined term inside "( noncapital, nondeductible expenses )" and numbers
    // paragraphs as "<i>1</i>", so replacing these with a space corrupts the
    // regulation into text that matches nothing. Anchors get the same
    // treatment because Cornell wraps defined terms mid-sentence.
    .replace(/<\/?(?:a|em|i|b|strong|span|sup|sub|cite|abbr|small|u)\b[^>]*>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main(): Promise<void> {
  const outDir = join(process.cwd(), "docs", "authorities", "federal");
  mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);

  const targets = selectedTargets(process.argv.slice(2));

  for (const t of targets) {
    const url = urlFor(t);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`FETCH FAILED ${res.status} for ${url}`);
    }
    const body = toText(await res.text());
    if (body.length < 2000) {
      throw new Error(
        `SUSPICIOUSLY SHORT (${body.length} chars) for ${url} — refusing to write a stub`,
      );
    }
    const label =
      t.kind === "cfr"
        ? (t.label ?? `26 CFR §${t.section}`)
        : t.kind === "irs-page"
          ? t.label
          : `26 U.S.C. §${t.section}`;
    const name = fileNameFor(t);
    const header =
      `SOURCE TEXT — ${label}\n` +
      `Retrieved ${stamp} from ${url}\n` +
      `Work of the United States Government; not subject to copyright (17 U.S.C. §105).\n` +
      `${"=".repeat(78)}\n\n`;
    writeFileSync(join(outDir, name), header + body + "\n", "utf8");
    // eslint-disable-next-line no-console
    console.log(`wrote ${name}  (${body.length} chars)`);
  }
}

void main();
