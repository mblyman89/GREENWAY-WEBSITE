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
 * Corpora this repository mirrors, and how to turn a citation into a filename.
 *
 * WHY THIS EXISTS SEPARATELY FROM `sourceFileFor`. Standing rule 48: a check
 * that cannot classify its input must FAIL, never skip. `sourceFileFor`
 * answers one question — "is there a file for this citation?" — and returns
 * null for two completely different reasons that it cannot tell apart:
 *
 *   1. We do not mirror this KIND of document at all (a court case, a WAC, an
 *      IRS Publication). Skipping is correct and honest.
 *   2. We DO mirror this kind of document, the citation names one, and the file
 *      is absent or misnamed. Skipping is a silent hole.
 *
 * Case 2 is what hid §280E for four slices: the pattern captured "280" out of
 * "§280E", `usc-280.txt` did not exist, null came back, and the run printed a
 * cheerful green line. `expectedCorpusFile` re-answers the question with the
 * reason attached so `main` can fail on case 2 while still skipping case 1.
 */
const MIRRORED_CORPORA: ReadonlyArray<{
  readonly name: string;
  readonly re: RegExp;
  readonly file: (m: RegExpExecArray) => readonly string[];
}> = [
  { name: "FASB ASC", re: /^FASB ASC (\d{3})-/, file: (m) => ["fasb-codification", `asc-${m[1]}.txt`] },
  {
    name: "FASB Concepts Statement",
    re: /^FASB Concepts Statement No\. 8/,
    file: () => ["fasb-concepts", "conceptual-framework.txt"],
  },
  { name: "26 CFR part 1", re: /^26 C\.?F\.?R\.? §(1\.\d+-\d+)/, file: (m) => ["federal", `cfr-${m[1]}.txt`] },
  {
    name: "26 CFR part 31",
    re: /^26 C\.?F\.?R\.? §(31\.[\d.]+\([a-z]\)\(\d+\)-\d+)/,
    file: (m) => ["federal", `cfr-${m[1]}.txt`],
  },
  { name: "8 CFR", re: /^8 C\.?F\.?R\.? §(\d+[a-z]?\.\d+)/, file: (m) => ["federal", `cfr-8-${m[1]}.txt`] },
  { name: "26 U.S.C.", re: /^26 U\.S\.C\. §(\d+[A-Z]?)/, file: (m) => ["federal", `usc-${m[1]}.txt`] },
  { name: "Rev. Proc.", re: /^Rev\. Proc\. (\d{4})-(\d+)/, file: (m) => ["federal", `revproc-${m[1]}-${m[2]}.txt`] },
  { name: "RCW", re: /^RCW ([\d.]+)/, file: (m) => ["state-wa", `rcw-${m[1]}.txt`] },
  {
    name: "IRS Publication",
    re: /^IRS Pub\. (\d+)(-[A-Z])? \((\d{4})\)/,
    file: (m) => ["federal", `irs-pub-${m[1]}${(m[2] ?? "").toLowerCase()}-${m[3]}.txt`],
  },
];

/**
 * What file SHOULD hold this citation, if it belongs to a corpus we mirror.
 *
 * Returns null only when the citation belongs to no mirrored corpus — the
 * honest skip. When it does belong to one, the path is returned whether or not
 * the file exists, so the caller can tell "we do not mirror this" apart from
 * "we mirror this and the file is missing".
 */
export function expectedCorpusFile(
  cite: string,
  dir: string = AUTHORITY_DIR,
): { readonly corpus: string; readonly path: string } | null {
  for (const c of MIRRORED_CORPORA) {
    const m = c.re.exec(cite);
    if (m) return { corpus: c.name, path: join(dir, ...c.file(m)) };
  }
  return null;
}

/**
 * Map a citation to the text file that should contain it.
 *
 * Returns null when this system holds no local copy of the source. That is not
 * a failure — most authorities here are statutes and cases, whose text lives in
 * the `source` field's URL rather than on disk. Only claims we CAN check are
 * checked; pretending to verify the rest would be theatre.
 *
 * The per-corpus branches below are kept as explicit, commented code rather
 * than collapsed into `MIRRORED_CORPORA` because each one records WHY it
 * exists and what broke without it. The two must agree, and a test asserts
 * they do for every authority in the registry.
 */
export function sourceFileFor(cite: string, dir: string = AUTHORITY_DIR): string | null {
  const asc = /^FASB ASC (\d{3})-/.exec(cite);
  if (asc) {
    const p = join(dir, "fasb-codification", `asc-${asc[1]}.txt`);
    return existsSync(p) ? p : null;
  }

  // FASB Concepts Statement No. 8, Chapter 7, ¶PR33  ->
  //   fasb-concepts/conceptual-framework.txt
  //
  // books-27. THE WHOLE OF CON 8 IS ONE MIRRORED FILE, so the chapter and
  // paragraph pinpoints in the citation are deliberately discarded — they
  // locate the quote for a human reader, not the file for this script.
  //
  // THIS BRANCH CLOSES A SILENT HOLE, and it is the same hole §280E fell
  // through. Three CON 8 quotes have been in the registry since books-17, and
  // `conceptual-framework.txt` has been on disk the whole time, but no pattern
  // here matched "FASB Concepts Statement No. 8" — so all three returned null
  // and were counted as "no local copy to check against". Three unverifiable
  // quotes, reported as a cheerful green line, for ten slices.
  //
  // Found while adding the books-27 reporting authorities, because seven NEW
  // CON 8 quotes would have inherited exactly the same free pass. Standing
  // rule 39: a read that cannot fail is not a check. Note the payoff is
  // immediate and retroactive — wiring this branch verifies the three old
  // quotes for the first time, not just the new ones.
  const con8 = /^FASB Concepts Statement No\. 8/.exec(cite);
  if (con8) {
    const p = join(dir, "fasb-concepts", "conceptual-framework.txt");
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

  // 26 CFR §31.3402(f)(2)-1  ->  federal/cfr-31.3402(f)(2)-1.txt
  //
  // books-25. The pattern above is deliberately anchored to `1.` because that
  // is the income tax part. The EMPLOYMENT tax regulations live in part 31 and
  // their section numbers contain PARENTHESES, which the part-1 pattern cannot
  // match and which no previous slice needed. Without this branch the four
  // W-4 validity quotes would have been reported as "no local copy to check
  // against" while their source sat on disk — the exact failure the comment
  // above this describes, repeated one part number to the left.
  const cfr31 = /^26 C\.?F\.?R\.? §(31\.[\d.]+\([a-z]\)\(\d+\)-\d+)/.exec(cite);
  if (cfr31) {
    const p = join(dir, "federal", `cfr-${cfr31[1]}.txt`);
    return existsSync(p) ? p : null;
  }

  // 8 CFR §274a.2(b)(1)(ii)  ->  federal/cfr-8-274a.2.txt
  //
  // books-25. Title 8 is IMMIGRATION, not tax, so the filename carries the
  // title number to keep it unambiguous against a title-26 section that might
  // one day share digits. Only the SECTION is used to pick the file; the
  // paragraph pinpoint in the citation is deliberately discarded because one
  // mirrored file holds the whole section.
  const cfr8 = /^8 C\.?F\.?R\.? §(\d+[a-z]?\.\d+)/.exec(cite);
  if (cfr8) {
    const p = join(dir, "federal", `cfr-8-${cfr8[1]}.txt`);
    return existsSync(p) ? p : null;
  }

  // 26 U.S.C. §1366(d)(1)  ->  federal/usc-1366.txt
  // 26 U.S.C. §280E        ->  federal/usc-280E.txt
  //
  // THE TRAILING LETTER IS PART OF THE SECTION NUMBER, and omitting it from
  // this pattern was a live defect found by books-25 while proving the new
  // branches above were failable. `§(\d+)` captured "280" out of "§280E" and
  // looked for `usc-280.txt`, which does not exist — so §280E was reported as
  // "no local copy to check against" while `usc-280E.txt` sat on disk. That is
  // the WORST possible record for this to happen to: §280E is the provision
  // that disallows every deduction a cannabis retailer would otherwise take,
  // it is quoted twice in this codebase, and it is the reason most of the
  // accounting in this product exists. §263A was silently skipped the same way.
  //
  // Standing rule 23 — fix the class, not the instance: the letter is now part
  // of the capture for every section, not special-cased for the three that
  // happen to have one today.
  const usc = /^26 U\.S\.C\. §(\d+[A-Z]?)/.exec(cite);
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

  // IRS Pub. 15 (2026), section 8   ->  federal/irs-pub-15-2026.txt
  // IRS Pub. 15-T (2026), ...       ->  federal/irs-pub-15-t-2026.txt
  //
  // books-25. UNTIL NOW NO IRS PUBLICATION WAS MIRRORED AT ALL, and that was a
  // hole rather than an omission. The publications are where the WITHHOLDING
  // RULES live - Pub. 15-T's worksheets are what this payroll engine implements
  // line by line - so they were the most-quoted and least-checkable sources in
  // the codebase. Every Pub. 15/15-T quote returned null here and was reported
  // as "no local copy to check against": a green line of output meaning nothing.
  //
  // Found by mutation testing, not by reading: corrupting a word inside a
  // freshly hand-verified Pub. 15 quote ("usually pay wages" -> "normally pay
  // wages") and running every authority suite produced 201 passed, 0 failed. A
  // quote I had personally checked character-for-character an hour earlier was
  // protected by absolutely nothing. Hand verification is a one-time act; a
  // corpus entry is a standing one.
  //
  // The YEAR is part of the filename because these are revised annually and a
  // 2026 quote must not be validated against a 2027 file.
  const pub = /^IRS Pub\. (\d+)(-[A-Z])? \((\d{4})\)/.exec(cite);
  if (pub) {
    const suffix = (pub[2] ?? "").toLowerCase();
    const p = join(dir, "federal", `irs-pub-${pub[1]}${suffix}-${pub[3]}.txt`);
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
/*
 * A NOTE ON DOT LEADERS, RECORDED BECAUSE THE OBVIOUS FIX WAS THE WRONG ONE.
 *
 * IRS worksheets are FORMS. Every line trails a run of periods leading the eye
 * to the entry box: "...enter -0- . . . . . . . . 1i $". Three stored quotes
 * failed against the newly mirrored publications because of them, and the
 * tempting fix was a normalisation step here that collapsed any run of three or
 * more spaced periods to a single space on both sides.
 *
 * It worked. It was still removed, for two reasons.
 *
 * First, it was doing the wrong job. Those quotes failed because they ended with
 * a full stop the form does not actually print - what looks like the end of the
 * sentence is the FIRST DOT of the leader. The honest fix is for the quote to
 * end on the last word, which is all that can be verified. Normalising the
 * source instead would have papered over a quote asserting a character that is
 * not there.
 *
 * Second, once the quotes were corrected the rule became dead code: deleting it
 * changed nothing, 95 quotes verified either way. Standing rule 40 - an
 * unreachable guard is an untested guard - so it does not get to sit here
 * looking protective. If a future quote genuinely needs it, it can come back
 * WITH a failing case that proves it is load-bearing.
 */
function normalise(text: string): string {
  return text
    // NO DOT-LEADER RULE HERE, DELIBERATELY - see the note below.
    //
    // books-27: PAGE FURNITURE FROM A PDF IS NOT PART OF THE SENTENCE.
    //
    // The FASB Concepts corpus is a PDF text dump, and a sentence that runs
    // across a page break has the page number physically embedded in the
    // middle of it. CON 8 PR39 really does read, on disk:
    //
    //   "...more homogeneous classes of items and usually\n\n\n\n\n   151\n\f
    //    are more useful to resource providers..."
    //
    // The "151" is the printed page number and the \f is the page break. A
    // quote that omits them is CORRECT; a quote that included them would be
    // transcribing the typesetting rather than the standard. So the page
    // break and its number are stripped BEFORE whitespace collapses, because
    // afterwards "151" is indistinguishable from a real number in the text.
    //
    // Deliberately narrow: only a run of blank lines, then digits alone on a
    // line, then a form feed. That shape is a page footer and nothing else.
    // A figure inside a sentence never looks like this.
    //
    // THIS RULE IS LOAD-BEARING AND PROVEN SO (standing rule 40, which killed
    // the previous dot-leader rule for being dead code): deleting it makes
    // CON8_CH7_PR39_HOMOGENEITY fail. There is a test asserting exactly that.
    .replace(/\n\s*\n\s*\d{1,4}\s*\n?\f/g, "\n")
    // Footnote reference markers glued to the end of a sentence: "concepts.4"
    // is "concepts." followed by footnote 4, not a version number. Same
    // reasoning - it is apparatus, not text. Narrow on purpose: only a single
    // digit immediately after a full stop and immediately before a newline,
    // which is where a footnote marker lands and where a decimal never does.
    // Load-bearing: deleting it makes CON8_CH7_PR12_NOTE_NOT_SUBSTITUTE fail.
    .replace(/\.\d(?=\n)/g, ".")
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

/**
 * AUTHORITIES IN A MIRRORED CORPUS WHOSE SOURCE TEXT IS NOT YET ON DISK.
 *
 * This list is DEBT, recorded rather than hidden. Every id here cites a statute
 * or regulation from a corpus this repository mirrors, so the rule-48 guard in
 * `main` is right to object — but downloading forty more sources is its own
 * slice, and standing rule 4 is one feature per pull request. books-25 needed
 * the guard for its own three new sources; it did not need, and must not
 * quietly perform, a forty-file expansion of the corpus.
 *
 * WHY THIS IS NOT A LOOPHOLE. The list is exact and it is checked in BOTH
 * directions (standing rule 34):
 *
 *   - An id NOT on this list whose file is missing FAILS the run. That is what
 *     stops the next §280E from hiding.
 *   - An id ON this list whose file now EXISTS also fails the run, as a stale
 *     entry. So the moment someone mirrors RCW 82.32.090, this list must
 *     shrink. It can never silently grow stale in the safe direction.
 *   - An id on this list that no longer exists in the registry fails too.
 *
 * The pattern is deliberately the same one `knownDefectsInOtherModules()` uses
 * in books-guidance-core: a known problem stated as data, with a test that
 * fails when the data stops matching reality.
 *
 * MOST OF THESE ARE PAYROLL. That is worth saying out loud, because payroll is
 * what Michael is most afraid of getting wrong: the FICA and FUTA sections, the
 * L&I premium rules, and Washington's wage-deduction statutes are all quoted
 * from URLs rather than from mirrored text. Their quotes may well be perfect —
 * §280E's were — but "may well be" is exactly what rule 35 exists to replace.
 */
export const KNOWN_UNMIRRORED_AUTHORITY_IDS: readonly string[] = [
  // Internal Revenue Code — employment taxes and the trust-fund rules
  "irc-3101-employee-fica",
  "irc-3111-employer-fica",
  "irc-3301-futa-rate",
  "irc-3302-futa-credit",
  "irc-3306-futa-wage-base",
  "irc-6672-trust-fund-penalty-payroll",
  "irc-7501-trust-fund-payroll",
  "IRC_6672_TRUST_PENALTY",
  "IRC_7501_TRUST",
  // Internal Revenue Code — deductions, substantiation and accuracy penalties
  "IRC_163_A_INTEREST",
  "IRC_263A_FLUSH",
  "IRC_448C_2026",
  "IRC_6001_SUBSTANTIATION",
  "IRC_6662_A_TWENTY_PERCENT",
  // Treasury regulations not yet fetched
  "REG_1_162_1_A",
  "REG_1_461_4_G_6_TAX_ECONOMIC_PERFORMANCE",
  "REG_1_6001_1_A_PERMANENT_BOOKS",
  "REG_1_6001_1_RECORDS",
  "REG_1_6662_3_B_1_NEGLIGENCE",
  // Washington — wages, paid leave, long-term care
  // books-26 PAID THIS DEBT: RCW_49_46_020_MINWAGE used to sit here, and while
  // it did, its quote was a paraphrase nobody could catch. The statute is now
  // mirrored at docs/authorities/state-wa/rcw-49.46.020.txt and the quote is
  // verified verbatim on every run. This is what paying down the list looks
  // like - each removal turns an honest "cannot check" into a real check.
  "rcw-49-52-050-wage-rebate",
  "rcw-49-52-060-authorized-withholding",
  "rcw-50a-10-030-pfml",
  "rcw-50b-04-080-wa-cares",
  // Washington — unemployment insurance
  "rcw-50-12-220-esd-late-penalty",
  "rcw-50-12-220-6-penalty-waiver",
  "rcw-50-24-040-esd-interest",
  // Washington — industrial insurance (L&I)
  "rcw-51-16-035-lni-classification",
  "rcw-51-16-060-lni-hours",
  "rcw-51-16-140-lni-deduction",
  "rcw-51-16-150-lni-injunction",
  "rcw-51-32-073-supplemental-pension-split",
  "rcw-51-32-090-stay-at-work-split",
  "rcw-51-48-210-lni-late-penalty",
  // Washington — excise, revenue administration, and time computation
  "RCW_69_50_535",
  "rcw-69-50-535-excise-trust",
  "rcw-82-32-050-dor-interest",
  "rcw-82-32-090-dor-late-penalty",
  "rcw-82-32-090-8-penalties-stack",
  "rcw-1-12-040-time-computation",
] as const;

const UNMIRRORED = new Set<string>(KNOWN_UNMIRRORED_AUTHORITY_IDS);

function main(): void {
  const checked: string[] = [];
  const failures: string[] = [];
  const knownUnmirroredSeen: string[] = [];
  let skipped = 0;

  for (const a of GUIDANCE_AUTHORITIES) {
    const file = sourceFileFor(a.cite);
    if (!file) {
      // RULE 48. Before accepting a skip, ask WHY there is no file. If the
      // citation names a corpus this repository mirrors, then a missing file is
      // a broken mapping or a missing download — not a document we chose not to
      // hold — and it must fail loudly. This is the guard that would have
      // caught §280E being checked against `usc-280.txt` for four slices.
      const expected = expectedCorpusFile(a.cite);
      if (expected && !UNMIRRORED.has(a.id)) {
        failures.push(
          `${a.id} (${a.cite}) — this citation is in the ${expected.corpus} corpus, which this ` +
            `repository MIRRORS, but no file was found at ${expected.path.replace(process.cwd(), ".")}. ` +
            `Either the cite-to-file mapping is wrong or the source was never fetched. ` +
            `A quote in a mirrored corpus must be verified, not skipped. If this source genuinely ` +
            `cannot be mirrored yet, add the id to KNOWN_UNMIRRORED_AUTHORITY_IDS with a reason — ` +
            `do not widen the skip.`,
        );
        continue;
      }
      if (expected) knownUnmirroredSeen.push(a.id);
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

  // RULE 34 — the debt list is checked in BOTH directions, so it can only ever
  // shrink. An entry that has been mirrored, or that names an authority nobody
  // declares any more, is a stale exemption and stale exemptions are how a
  // temporary allowance becomes permanent.
  const seen = new Set(knownUnmirroredSeen);
  for (const id of KNOWN_UNMIRRORED_AUTHORITY_IDS) {
    if (seen.has(id)) continue;
    const authority = GUIDANCE_AUTHORITIES.find((a) => a.id === id);
    if (!authority) {
      failures.push(
        `KNOWN_UNMIRRORED_AUTHORITY_IDS lists "${id}", which is not in the registry at all. ` +
          `Remove the stale entry.`,
      );
      continue;
    }
    const file = sourceFileFor(authority.cite);
    if (file) {
      failures.push(
        `KNOWN_UNMIRRORED_AUTHORITY_IDS lists "${id}" (${authority.cite}), but its source is NOW ` +
          `on disk at ${file.replace(process.cwd(), ".")} and was verified. Delete the entry — the ` +
          `debt is paid, and leaving it here would exempt a future regression.`,
      );
    }
  }

  console.log(
    `\n${checked.length} verified against local sources, ` +
      `${skipped} have no local copy to check against ` +
      `(${knownUnmirroredSeen.length} of those are recorded debt in ` +
      `KNOWN_UNMIRRORED_AUTHORITY_IDS).`,
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

/**
 * Only run when invoked as a script, not when imported.
 *
 * books-25 imports `sourceFileFor`, `expectedCorpusFile`, `quoteSegments`,
 * `matchesInOrder` and `KNOWN_UNMIRRORED_AUTHORITY_IDS` from this file so the
 * vitest suite tests the REAL mapping rather than a copy of it (standing rule
 * 39: a self-check that re-implements the gate tests nothing). Before this
 * guard, that import re-ran the entire verification — printing two hundred
 * lines into the test output and, far worse, giving this module the power to
 * call `process.exit(1)` in the middle of a test run. A failing quote would
 * have killed the whole suite with no attribution to any test.
 */
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv.some((arg) => arg.includes("verify-verbatim-quotes"));

if (invokedDirectly) {
  main();
}
