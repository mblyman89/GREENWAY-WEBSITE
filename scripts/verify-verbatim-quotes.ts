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
function sourceFileFor(cite: string): string | null {
  const asc = /^FASB ASC (\d{3})-/.exec(cite);
  if (asc) {
    const p = join(AUTHORITY_DIR, "fasb-codification", `asc-${asc[1]}.txt`);
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
    .trim();
}

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

    if (haystack.includes(needle)) {
      checked.push(a.id);
      console.log(`  VERBATIM OK   ${a.id}  (${needle.length} chars)`);
      continue;
    }

    // Locate the divergence so the failure is actionable rather than a shrug.
    let detail = "no common prefix with the source at all";
    for (let cut = needle.length - 1; cut > 20; cut -= 5) {
      const prefix = needle.slice(0, cut);
      const at = haystack.indexOf(prefix);
      if (at !== -1) {
        detail =
          `matches the first ${cut} characters, then diverges\n` +
          `      OURS  : ...${needle.slice(Math.max(0, cut - 50), cut + 60)}\n` +
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
