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

type Target =
  | { readonly kind: "cfr"; readonly section: string }
  | { readonly kind: "usc"; readonly section: string };

/** Exactly the sources books-19 quotes. Extend as later slices need more. */
const TARGETS: readonly Target[] = [
  { kind: "cfr", section: "1.1361-1" },
  { kind: "cfr", section: "1.1367-1" },
  { kind: "cfr", section: "1.1367-2" },
  { kind: "cfr", section: "1.1368-1" },
  { kind: "cfr", section: "1.1368-2" },
  { kind: "usc", section: "1361" },
  { kind: "usc", section: "1366" },
  { kind: "usc", section: "1367" },
  { kind: "usc", section: "1368" },
];

function urlFor(t: Target): string {
  if (t.kind === "cfr") {
    return (
      "https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-26" +
      `?chapter=I&subchapter=A&part=1&section=${t.section}`
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
    const label = t.kind === "cfr" ? `26 CFR §${t.section}` : `26 U.S.C. §${t.section}`;
    const name = t.kind === "cfr" ? `cfr-${t.section}.txt` : `usc-${t.section}.txt`;
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
