/**
 * scripts/verify-verbatim-quotes.ts
 *
 * STANDING RULE 35 MADE MECHANICAL.
 *
 * Rule 24 says the quote is sacred. This proves it, rather than asking anyone
 * to trust that it was typed carefully. Every authority whose primary source
 * exists on disk under `docs/authorities/` has its `quote` checked as an EXACT
 * substring of that source, after normalising whitespace on both sides.
 *
 * A paraphrase that reads identically to the eye — "representationally
 * faithful" becoming "representationally accurate" — fails this check in
 * milliseconds. That is the entire point.
 *
 * Run:  npx tsx scripts/verify-verbatim-quotes.ts
 * Exits non-zero on any failure, so it can gate a build.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";

const AUTHORITY_DIR = join(process.cwd(), "docs", "authorities");

/**
 * Map a citation to the text file that should contain it.
 *
 * Returns null when this system holds no local copy of the source. That is not
 * a failure — most authorities here are statutes and cases, whose text lives in
 * the `source` field's URL rather than on disk. Only claims we CAN check are
 * checked; pretending to verify the rest would be theatre.
 */
export function sourceFileFor(cite: string, dir: string = AUTHORITY_DIR): string | null {
  const asc = /^FASB ASC (\d{3})-/.exec(cite);
  if (asc) {
    const p = join(dir, "fasb-codification", `asc-${asc[1]}.txt`);
    return existsSync(p) ? p : null;
  }

  // 26 CFR §1.1367-1(f)  ->  federal/cfr-1.1367-1.txt
  //
  // BOTH SPELLINGS. The registry contains "26 CFR §" and "26 C.F.R. §" in
  // roughly equal numbers, because different slices were written by different
  // hands on different days. The original pattern matched only the first, so
  // twenty-eight regulation quotes were being SKIPPED and reported as "no
  // local copy to check against" while their source text sat on disk the whole
  // time. A verifier that quietly declines to check the thing you asked it to
  // check is worse than no verifier, because it produces a green line of
  // output that means nothing. Found while wiring books-20, which added six
  // more C.F.R. quotes and noticed the verified count had not moved by six.
  const cfr = /^26 C\.?F\.?R\.? §(1\.\d+-\d+)/.exec(cite);
  if (cfr) {
    const p = join(dir, "federal", `cfr-${cfr[1]}.txt`);
    return existsSync(p) ? p : null;
  }

  // 26 U.S.C. §1366(d)(1)  ->  federal/usc-1366.txt
  const usc = /^26 U\.S\.C\. §(\d+)/.exec(cite);
  if (usc) {
    const p = join(dir, "federal", `usc-${usc[1]}.txt`);
    return existsSync(p) ? p : null;
  }

  // Rev. Proc. 2015-13, §8.01  ->  federal/revproc-2015-13.txt
  // books-20. The method-change procedure is quoted from the official Internal
  // Revenue Bulletin, which is mirrored here in full, so these quotes are
  // checkable rather than merely cited.
  const rp = /^Rev\. Proc\. (\d{4})-(\d+)/.exec(cite);
  if (rp) {
    const p = join(dir, "federal", `revproc-${rp[1]}-${rp[2]}.txt`);
    return existsSync(p) ? p : null;
  }

  // RCW 69.50.328  ->  state-wa/rcw-69.50.328.txt
  // books-20. Washington statutes decide whether Greenway is a reseller or a
  // producer, which decides which half of §1.471-3 applies to it. A conclusion
  // that consequential is not allowed to rest on an unverifiable paraphrase.
  const rcw = /^RCW ([\d.]+)/.exec(cite);
  if (rcw) {
    const p = join(dir, "state-wa", `rcw-${rcw[1]}.txt`);
    return existsSync(p) ? p : null;
  }

  return null;
}

/**
 * Collapse whitespace and strip the Codification's own provenance brackets.
 *
 * The ASC prints the standard a sentence descends from inline, like
 * `[ ARB 43 Ch. 4 Statement 3 169 ]`. Those markers are the FASB's editorial
 * apparatus, NOT part of the rule, so they are removed from the source before
 * comparison. They are never included in a stored quote either, so both sides
 * are treated identically and the comparison stays honest.
 */
function normalise(text: string): string {
  return text
    .replace(/\u2014/g, "-")
    .replace(/\u2019/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\[\s*(?:ARB|FAS|FIN|ASU|EITF|SOP|APB|CON)[^\]]*\]/g, " ")
    .replace(/[[\]]/g, " ")
    .replace(/\s+/g, " ")
    // Publishers disagree about whether a dash introducing a list is hugged
    // ("proper)- (1)") or spaced ("proper) - (1)"). That is typesetting, not
    // law, and it is applied to BOTH sides so neither is given latitude the
    // other lacks. No word is affected.
    .replace(/\s*-\s*/g, " - ")
    .trim();
}

/**
 * Split a normalised quote on its ellipses.
 *
 * Returns null when any segment is too short to be evidence of anything. A
 * quote of "the" separated by "..." from "corporation" would match virtually
 * any statute, so allowing it would turn this verifier into decoration.
 */
export function quoteSegments(normalisedQuote: string): string[] | null {
  const parts = normalisedQuote
    .split(/\s*\.\.\.\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts;
  return parts.every((p) => p.length >= MIN_SEGMENT_CHARS) ? parts : null;
}

/** Every segment appears in the source, each one after the previous. */
export function matchesInOrder(haystack: string, segments: readonly string[]): boolean {
  let from = 0;
  for (const seg of segments) {
    const at = haystack.indexOf(seg, from);
    if (at === -1) return false;
    from = at + seg.length;
  }
  return true;
}

/** Shortest passage an elided segment may be and still prove anything. */
const MIN_SEGMENT_CHARS = 40;

function main(): void {
  const checked: string[] = [];
  const failures: string[] = [];
  let skipped = 0;

  for (const a of GUIDANCE_AUTHORITIES) {
    const file = sourceFileFor(a.cite);
    if (!file) {
      skipped += 1;
      continue;
    }
    const haystack = normalise(readFileSync(file, "utf8"));
    const needle = normalise(a.quote);

    // A quote may skip material with an explicit ellipsis, which is how one
    // cites §1368(b), (d) and (e)(1)(A) without reproducing (c). Each SEGMENT
    // between ellipses must still appear verbatim, and they must appear IN
    // ORDER. That is a real constraint: it forbids inventing words inside a
    // segment and forbids quoting subsections out of sequence. What it will
    // not catch is a misleading elision, so `quoteSegments` also refuses a
    // segment short enough to match by accident.
    const segments = quoteSegments(needle);
    if (segments === null) {
      failures.push(
        `${a.id} (${a.cite}) — an elided quote segment is too short to be ` +
          `meaningful; a "..." must join substantial passages, not fragments`,
      );
      continue;
    }

    if (matchesInOrder(haystack, segments)) {
      checked.push(a.id);
      const how = segments.length > 1 ? `${segments.length} segments, ` : "";
      console.log(`  VERBATIM OK   ${a.id}  (${how}${needle.length} chars)`);
      continue;
    }

    // Report on the SEGMENT that actually failed, not on the whole quote.
    // Reporting "matches the first 517 characters" when segment one matched
    // perfectly and segment three did not is a lie that costs an hour.
    let cursor = 0;
    let failingIndex = 0;
    let failing = segments[0];
    for (let i = 0; i < segments.length; i += 1) {
      const at = haystack.indexOf(segments[i], cursor);
      if (at === -1) {
        failingIndex = i;
        failing = segments[i];
        break;
      }
      cursor = at + segments[i].length;
    }
    const where =
      segments.length > 1 ? `segment ${failingIndex + 1} of ${segments.length}: ` : "";
    const searchFrom = failingIndex === 0 ? 0 : cursor;

    // Locate the divergence so the failure is actionable rather than a shrug.
    let detail = `${where}no common prefix with the source at all`;
    for (let cut = failing.length - 1; cut > 20; cut -= 5) {
      const prefix = failing.slice(0, cut);
      const at = haystack.indexOf(prefix, searchFrom);
      if (at !== -1) {
        detail =
          `${where}matches the first ${cut} characters, then diverges\n` +
          `      OURS  : ...${failing.slice(Math.max(0, cut - 50), cut + 60)}\n` +
          `      SOURCE: ...${haystack.slice(Math.max(0, at + cut - 50), at + cut + 60)}`;
        break;
      }
    }
    failures.push(`${a.id} (${a.cite}) — ${detail}`);
  }

  console.log(
    `\n${checked.length} verified against local sources, ` +
      `${skipped} have no local copy to check against.`,
  );

  if (failures.length > 0) {
    console.error("\nRULE 24/35 VERIFICATION FAILED:\n");
    for (const f of failures) console.error(`  - ${f}\n`);
    process.exit(1);
  }
  if (checked.length === 0) {
    console.error(
      "\nNOTHING WAS ACTUALLY CHECKED. Either docs/authorities/ is missing or " +
        "the cite-to-file mapping is broken. A verifier that verifies nothing " +
        "and reports success is worse than no verifier at all.",
    );
    process.exit(1);
  }
  console.log("RULE 24/35 VERIFICATION PASSED.");
}

main();
