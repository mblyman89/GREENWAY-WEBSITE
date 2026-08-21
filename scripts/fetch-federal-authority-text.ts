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
  | { readonly kind: "usc"; readonly section: string };

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
];

function urlFor(t: Target): string {
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

  for (const t of TARGETS) {
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
      t.kind === "cfr" ? (t.label ?? `26 CFR §${t.section}`) : `26 U.S.C. §${t.section}`;
    const name =
      t.kind === "cfr" ? (t.file ?? `cfr-${t.section}.txt`) : `usc-${t.section}.txt`;
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
