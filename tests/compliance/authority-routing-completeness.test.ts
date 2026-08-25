/**
 * tests/compliance/authority-routing-completeness.test.ts   (books-55)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO QUOTE MAY GO UNVERIFIED WHILE ITS SOURCE SITS ON DISK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT THIS EXISTS TO END, WHICH HAS NOW HAPPENED FOUR TIMES.
 *
 * `scripts/verify-verbatim-quotes.ts` maps a citation to a mirrored text file
 * and compares the quote against it. When the mapping does not match, it
 * returns null, and null means "we hold no local copy" — a legitimate, common
 * state, since most authorities here are statutes and cases whose text lives at
 * a URL. Those are counted and reported as skipped.
 *
 * So a BROKEN MAPPING and a DOCUMENT WE DELIBERATELY DO NOT HOLD are the same
 * observation. Every occurrence of this defect has been the same: the file was
 * on disk, the pattern did not match, the quote was silently unverified behind
 * a passing run.
 *
 *   1. §280E resolved to `usc-280.txt` — wrong file, four slices.
 *   2. Three FASB CON 8 quotes — no pattern for "FASB Concepts Statement No. 8".
 *   3. Thirteen Form 941 instruction cites — written "IRS, Instructions for
 *      Form 941" with a comma the router's regex could not match (books-40,
 *      recorded in books-43, fixed later). Re-measured in books-55: all 13
 *      now route.
 *   4. books-55, found by probe: THREE W-4 authorities cited exactly as the
 *      eCFR prints them, `26 C.F.R. § 31.3402(f)(2)-1(a)(4)`, with A SPACE
 *      AFTER THE SECTION SIGN. Both the router branch and the mirrored-corpora
 *      table demanded `§31.` with no space, so the cite matched NEITHER — which
 *      also meant rule 48's loud failure could not fire. Meanwhile
 *      `federal/cfr-31.3402(f)(2)-1.txt` held all three quotes verbatim.
 *      Verified count went 332 → 335 on fixing two characters.
 *
 * Each previous fix was a new branch plus a comment saying the same thing had
 * happened one part number to the left. Four occurrences is not bad luck, it is
 * a missing gate: nothing ever asked the question "is there a file on disk that
 * contains this quote, which the router failed to find?"
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT SIMPLY "EVERY AUTHORITY MUST ROUTE"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Because that would be false, and forcing it true would mean either
 * downloading 130 more documents or — far worse — inventing a mapping to a file
 * that does not contain the text, which is exactly defect (1). Most skipped
 * authorities are genuinely unmirrored: Tax Court opinions, Chief Counsel
 * Advice, agency web pages, ISA and PCAOB standards.
 *
 * So the assertion is narrower and provable: FOR EVERY AUTHORITY THE ROUTER
 * SKIPS, no file we already hold may contain its quote. If one does, either the
 * router is broken or the quote is misattributed. Both are defects, and neither
 * can be argued away.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";
import {
  KNOWN_UNMIRRORED_AUTHORITY_IDS,
  expectedCorpusFile,
  sourceFileFor,
} from "../../scripts/verify-verbatim-quotes";

const ROOT = process.cwd();
const AUTHORITY_DIR = join(ROOT, "docs", "authorities");

function allHeldFiles(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allHeldFiles(full));
    else if (entry.name.endsWith(".txt")) out.push(full);
  }
  return out;
}

const HELD = allHeldFiles(AUTHORITY_DIR);

/** Whitespace-normalised text of every mirrored file, read once. */
const CORPUS: readonly (readonly [string, string])[] = HELD.map(
  (f) => [f.replace(ROOT + "/", ""), readFileSync(f, "utf8").replace(/\s+/g, " ")] as const,
);

const UNMIRRORED = new Set<string>(KNOWN_UNMIRRORED_AUTHORITY_IDS);

/**
 * The probe length used to ask "is this quote in that file".
 *
 * 60 characters of normalised text. Long enough that a collision is not
 * credible; short enough to survive a quote that begins with an ellipsis
 * segment or a bracketed editorial insertion. Quotes shorter than this are
 * compared whole.
 */
const PROBE = 60;

function probeOf(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  // Start after a leading ellipsis so the probe is real text, not punctuation.
  const cleaned = flat.replace(/^\s*(\.\.\.|…)\s*/, "");
  return cleaned.slice(0, Math.min(PROBE, cleaned.length));
}

describe("books-55: the verifier's skip list contains nothing it could have checked", () => {
  it("holds a corpus at all, so this gate is not vacuous", () => {
    // Rule 66d. With no files read, every "is this quote in a held file" test
    // answers no, and the suite passes by searching nothing.
    expect(HELD.length, "no mirrored authority files were found on disk").toBeGreaterThan(50);
    expect(GUIDANCE_AUTHORITIES.length).toBeGreaterThan(400);
  });

  /**
   * THE CORE ASSERTION.
   *
   * For every authority the router skips, no held file may contain its quote.
   * The failure message names the file, so the fix is a routing branch and
   * never a guess.
   */
  it("never skips a quote whose text is already in a file we hold", () => {
    const offenders: string[] = [];
    let skipped = 0;

    for (const a of GUIDANCE_AUTHORITIES) {
      if (sourceFileFor(a.cite) !== null) continue; // routed: already verified
      skipped += 1;
      const probe = probeOf(a.quote);
      if (probe.length < 25) continue; // too short to attribute safely
      for (const [name, text] of CORPUS) {
        if (!text.includes(probe)) continue;
        offenders.push(
          `${a.id} (${a.cite}) is SKIPPED by the verifier, but its quote appears in ` +
            `${name}. Either the cite-to-file router cannot match this citation - which is ` +
            `the §280E / CON 8 / "IRS, Instructions" / "§ 31." defect for the fifth time - ` +
            `or the quote is attributed to the wrong source. Add a routing branch; do not ` +
            `add this id to KNOWN_UNMIRRORED_AUTHORITY_IDS, because the document IS mirrored.`,
        );
        break;
      }
    }

    // Existence before absence: if nothing is skipped the loop proves nothing.
    expect(skipped, "no authorities are skipped at all - has the registry emptied?").toBeGreaterThan(
      0,
    );
    expect(offenders, offenders.join("\n\n")).toEqual([]);
  });

  /**
   * THE ROUTER AND THE RULE-48 TABLE MUST AGREE ABOUT SHAPE.
   *
   * `sourceFileFor` decides where to look; `expectedCorpusFile` decides whether
   * a miss is LOUD or silent. books-55 fixed a case where both were wrong in
   * the same way, and fixing only the first would have left the second blind:
   * the three quotes would verify today, and the next cite of the same shape
   * whose file was genuinely missing would go quiet again.
   *
   * So: any citation that routes must also be recognised as belonging to a
   * mirrored corpus. A cite that resolves to a file while the corpus table
   * denies knowing it is a cite whose future failures will be silent.
   */
  it("recognises every routable citation as belonging to a mirrored corpus", () => {
    const disagreements: string[] = [];
    let routed = 0;
    for (const a of GUIDANCE_AUTHORITIES) {
      if (sourceFileFor(a.cite) === null) continue;
      routed += 1;
      if (expectedCorpusFile(a.cite) === null) {
        disagreements.push(
          `${a.id} (${a.cite}) routes to a mirrored file, but expectedCorpusFile() does not ` +
            `recognise its corpus. Today it verifies. The day that file is renamed or moved, ` +
            `this quote will be SKIPPED IN SILENCE instead of failing loudly, because rule ` +
            `48's guard only fires for citations it can classify.`,
        );
      }
    }
    expect(routed, "nothing routes at all").toBeGreaterThan(300);
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  /**
   * THE RECORDED DEBT MUST STILL BE DEBT.
   *
   * An id in KNOWN_UNMIRRORED_AUTHORITY_IDS is a written admission that a
   * source is not held. Once it IS held, the entry stops being an admission and
   * becomes a licence to skip a checkable quote. books-55 already deleted one
   * such entry (`irc-3306-futa-wage-base`); this makes that a rule rather than
   * a good habit.
   */
  it("keeps no stale entry in the recorded-debt list", () => {
    const stale: string[] = [];
    for (const id of UNMIRRORED) {
      const a = GUIDANCE_AUTHORITIES.find((x) => x.id === id);
      if (!a) continue; // the verifier itself already fails on unknown ids
      if (sourceFileFor(a.cite) !== null) {
        stale.push(
          `${id} is listed as unmirrored debt, but its citation now routes to a file on disk. ` +
            `Delete the entry so the quote is actually checked.`,
        );
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });
});
