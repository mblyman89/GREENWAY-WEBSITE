/**
 * books-20 — PERMANENT TRIPWIRE: every cited authority id must resolve.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The books-20 suite caught a real defect on its first run: the refusal that
 * tells the owner to physically count ending inventory cited
 * `INVENTORY_COUNTED` in its `authorityIds` array. `INVENTORY_COUNTED` is a
 * real identifier — but it is a PERIOD-CLOSE CHECKLIST ITEM id, declared in
 * `period-close-core.ts`, not a `GuidanceAuthority` id. Two different
 * namespaces, both plain uppercase strings, and one leaked into the other.
 *
 * That is a nasty defect class because it is invisible to the compiler
 * (`authorityIds` is `readonly string[]`) and invisible to the eye (the id
 * looks exactly like an authority id). It only shows up at the moment the
 * owner clicks "why?" and the citation panel comes back empty — which is
 * precisely the moment the citation mattered.
 *
 * Rule 23 says fix the CLASS, not the instance. So rather than only correcting
 * that one line, this file walks EVERY `.ts`/`.tsx` file under `src/`, pulls
 * out every string literal that appears inside an `authorityIds` array or an
 * `authorityIds.push(...)` call, and asserts that each one resolves through
 * `findGuidanceAuthority`. Any future citation typo, any future namespace
 * leak, any authority deleted while a citation to it survives, goes red here.
 *
 * Rule 15 says every test must be provably failable. Part 2 proves this one is
 * — it runs the extractor over synthetic source text containing a known-bad id
 * and asserts the id is found, so a future refactor cannot quietly turn the
 * extractor into a no-op that scans nothing and passes.
 *
 * Rule 39 says a self-check that re-implements the gate tests nothing. The
 * extractor here is used by BOTH the real scan and the failability proof, so
 * the thing proven failable is the same code that guards the repo.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { stripTypeScriptComments } from "@/lib/payroll/mentor-quote-gate";

const srcDir = join(__dirname, "..", "..", "src");

/** Every .ts/.tsx file under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * Pull every quoted id that sits inside an `authorityIds: [...]` array literal
 * or an `authorityIds.push(...)` call.
 *
 * BOOKS-21 CORRECTION — THIS GUARD HAD A HOLE THE SIZE OF A NAMING CONVENTION.
 *
 * As shipped in books-20 this extractor matched only SCREAMING_SNAKE literals,
 * and the comment justifying that said it was "the shape every authority id in
 * this repo has". That was not true when it was written. `tax-penalty-authorities.ts`
 * already used lower-kebab ids (`rcw-82-32-050-dor-interest` and 18 others), so
 * 29 of the repo's 80 authority ids were invisible to the tripwire — including
 * every id in the books-21 interest module. A citation typo in any of them would
 * have sailed through.
 *
 * This is standing rule 42 arriving on schedule: two namespaces of strings that
 * look alike will eventually trade places, and here the SECOND namespace was
 * simply not being read. It is also standing rule 22 — the guard was the
 * suspect, and the reassuring comment was the alibi.
 *
 * So it now matches BOTH shapes. Inside an `authorityIds` position every string
 * is by definition an authority id, so widening cannot produce a false positive
 * here; the narrow pattern was buying nothing and costing coverage.
 *
 * A dynamically built id would still not be caught — and that remains a good
 * reason never to build one dynamically.
 */
export function extractCitedAuthorityIds(source: string): string[] {
  const found: string[] = [];
  const re =
    /authorityIds(?:\s*:\s*(?:readonly\s+)?(?:string\[\]\s*=\s*)?\[([^\]]*)\]|\.push\(([^)]*)\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const body = m[1] ?? m[2] ?? "";
    // Both conventions in use: SCREAMING_SNAKE and lower-kebab.
    for (const q of body.matchAll(/"([A-Z0-9_]{3,}|[a-z][a-z0-9-]{2,})"/g)) found.push(q[1]);
  }
  // SINGULAR `authorityId: "..."`, the second books-21 correction. The penalty
  // engine's caveats each cite ONE authority through a singular field, and the
  // books-20 extractor matched only the plural name — so all 25 of those
  // citations, every one in the module that tells the owner what a late filing
  // costs, were outside the tripwire. Same defect class as the naming
  // convention above (rule 23: fix the class, not the instance).
  for (const q of source.matchAll(
    /\bauthorityId\s*:\s*"([A-Z0-9_]{3,}|[a-z][a-z0-9-]{2,})"/g,
  )) {
    found.push(q[1]!);
  }
  return found;
}

/**
 * BOOKS-39 CORRECTION — THE TRIPWIRE COULD NOT TELL CODE FROM PROSE.
 *
 * The extractor above reads raw source text, so it matches a citation whether
 * that citation is EXECUTED or merely DESCRIBED. For nineteen slices nothing
 * noticed, because nobody had written a comment containing a deliberately
 * wrong citation. books-39 did exactly that: `pay-run-authorities.ts` explains,
 * in the doc comment above the id union, that the W-4 lessons once cited
 *
 *     authorityId: "NO_W4_TREAT_AS_SINGLE"
 *
 * instead of the real id, and that this is why the union exists. The tripwire
 * read the example, could not resolve it, and went red — reporting a defect
 * that had already been fixed, in the very sentence explaining the fix.
 *
 * That is a bad incentive and it is the whole reason to fix this properly.
 * Under the old behaviour the cheapest way to make the suite green is to STOP
 * WRITING DOWN MISTAKES — to delete the example, or mangle it into
 * `NO_W4_TREAT_AS_SINGLE` with a zero-width space, so the guard shuts up. A
 * repo whose tests punish documenting a defect will end up with undocumented
 * defects. Standing rule 26 says the mentor layer teaches; it cannot teach a
 * wrong citation without quoting one.
 *
 * The measurement before changing anything (rule 11 — evidence, not memory):
 * across every `.ts`/`.tsx` file under `src/`, the extractor found 1220
 * citations on raw text and 1219 after comments were removed. Exactly ONE
 * citation in this entire repository lives in prose, and it is the teaching
 * example above. Zero real, executable citations are lost by this change, and
 * zero unresolved citations remain in real code once comments are excluded.
 * So the guard loses no coverage at all — it only stops reading fiction.
 *
 * The instance fix would have been to reword one comment. Rule 23 says fix the
 * CLASS: the next person to document a citation mistake would have hit this
 * again, and the pressure would have been on them to delete their explanation
 * rather than on the guard to be correct.
 *
 * `extractCitedAuthorityIds` is deliberately NOT changed. Its unit tests feed
 * it synthetic one-line strings, and it must keep matching those verbatim, so
 * the comment-blindness is applied HERE, at the point where real files are
 * read. The two vacuity risks this introduces are both pinned below: that
 * stripping returns empty text (the scan would pass by scanning nothing), and
 * that stripping eats code (a real citation would go unguarded).
 */
export function citedAuthorityIdsInRealSource(source: string): string[] {
  return extractCitedAuthorityIds(stripTypeScriptComments(source));
}

describe("the extractor itself is not a no-op (rule 15)", () => {
  it("finds ids in an array literal", () => {
    expect(extractCitedAuthorityIds('authorityIds: ["IRC_280E", "IRC_471_A"],')).toEqual([
      "IRC_280E",
      "IRC_471_A",
    ]);
  });

  it("finds ids in a .push() call", () => {
    expect(extractCitedAuthorityIds('authorityIds.push("IRC_280E");')).toEqual(["IRC_280E"]);
  });

  it("finds ids in an annotated declaration", () => {
    expect(
      extractCitedAuthorityIds('const authorityIds: string[] = ["IRC_162_A"];'),
    ).toEqual(["IRC_162_A"]);
  });

  it("WOULD HAVE CAUGHT the real books-20 defect", () => {
    // This is the exact line that shipped broken and that the books-20 suite
    // caught. INVENTORY_COUNTED is a period-close check id, not an authority.
    const offending =
      'authorityIds: ["REG_1_471_2_D_VERIFY_BY_COUNT", "INVENTORY_COUNTED"],';
    const ids = extractCitedAuthorityIds(offending);
    expect(ids).toContain("INVENTORY_COUNTED");
    expect(findGuidanceAuthority("INVENTORY_COUNTED")).toBeUndefined();
  });

  it("finds LOWER-KEBAB ids, which books-20 silently skipped", () => {
    // The hole itself, as a test. Before books-21 this returned [] and the
    // tripwire below therefore never checked a single interest or WA authority.
    expect(
      extractCitedAuthorityIds('authorityIds: ["rcw-82-32-050-dor-interest"],'),
    ).toEqual(["rcw-82-32-050-dor-interest"]);
    expect(
      extractCitedAuthorityIds('authorityIds: ["irc-6621-c-large-corporate-underpayment"],'),
    ).toEqual(["irc-6621-c-large-corporate-underpayment"]);
  });

  it("finds BOTH conventions side by side in one array", () => {
    // Mixed arrays are real — the books-21 mentor cites one of each.
    expect(
      extractCitedAuthorityIds(
        'authorityIds: ["irc-1361-a-s-and-c-corporation-defined", "IRC_1368_DISTRIBUTIONS_AAA"],',
      ),
    ).toEqual(["irc-1361-a-s-and-c-corporation-defined", "IRC_1368_DISTRIBUTIONS_AAA"]);
  });

  it("would catch a TYPO in a lower-kebab id", () => {
    // The failure mode the hole was hiding: a plausible-looking id that
    // resolves to nothing.
    const ids = extractCitedAuthorityIds('authorityIds: ["irc-6621-c-large-corporate-underpayments"],');
    expect(ids).toContain("irc-6621-c-large-corporate-underpayments");
    expect(findGuidanceAuthority("irc-6621-c-large-corporate-underpayments")).toBeUndefined();
    // And the correctly spelled one does resolve, so this is a typo test and
    // not an "authority missing" test.
    expect(findGuidanceAuthority("irc-6621-c-large-corporate-underpayment")).toBeDefined();
  });

  it("the real tree actually contains ids of BOTH shapes", () => {
    // Rule 39: proves the widening is load-bearing on real source rather than
    // only on the synthetic strings above. If someone renames every id to one
    // convention this goes red and the extractor can be narrowed again on
    // purpose instead of by accident.
    const all = walk(srcDir).flatMap((f) => extractCitedAuthorityIds(readFileSync(f, "utf8")));
    expect(all.some((id) => /^[A-Z0-9_]+$/.test(id))).toBe(true);
    expect(all.some((id) => /^[a-z][a-z0-9-]+$/.test(id))).toBe(true);
  });

  it("finds SINGULAR authorityId citations, which books-20 also skipped", () => {
    // The penalty engine writes caveats with a singular field. Twenty-five
    // citations lived there unchecked.
    expect(extractCitedAuthorityIds('authorityId: "irc-6651-failure-to-file",')).toEqual([
      "irc-6651-failure-to-file",
    ]);
    expect(extractCitedAuthorityIds('  authorityId: "IRC_280E",')).toEqual(["IRC_280E"]);
  });

  it("does not double-count a plural array as singular hits", () => {
    // `authorityIds:` contains the substring `authorityId`, so a careless
    // singular pattern would match it too and report every id twice. The word
    // boundary plus the required colon prevents that; this pins it.
    expect(extractCitedAuthorityIds('authorityIds: ["IRC_280E"],')).toEqual(["IRC_280E"]);
  });

  it("the real tree contains singular citations, so that branch is load-bearing", () => {
    const all = walk(srcDir).flatMap((f) => extractCitedAuthorityIds(readFileSync(f, "utf8")));
    // tax-penalty-core.ts alone carries more than twenty.
    expect(all.filter((id) => id === "irc-6651-failure-to-file").length).toBeGreaterThan(0);
  });

  it("ignores strings that are not inside an authorityIds position", () => {
    expect(extractCitedAuthorityIds('const checkId = "INVENTORY_COUNTED";')).toEqual([]);
  });

  it("scans the real tree and finds a non-trivial number of citations", () => {
    // A vacuous-read guard (rule 39). If a refactor moved src/ or broke the
    // walk, the real scan below would pass by scanning nothing. This forbids
    // that outcome.
    const files = walk(srcDir);
    expect(files.length).toBeGreaterThan(500);
    const total = files.reduce(
      (n, f) => n + extractCitedAuthorityIds(readFileSync(f, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(300);
  });
});

describe("books-39: the comment-blind reader is narrow, and provably so", () => {
  it("still finds a citation that is REAL CODE", () => {
    // The whole risk of this change is that it makes the tripwire lazy. This
    // is the base case: executable citations must survive untouched.
    expect(citedAuthorityIdsInRealSource('authorityIds: ["IRC_280E"],')).toEqual(["IRC_280E"]);
    expect(citedAuthorityIdsInRealSource('  authorityId: "irc-6651-failure-to-file",')).toEqual([
      "irc-6651-failure-to-file",
    ]);
  });

  it("ignores a citation that is only DESCRIBED in a line comment", () => {
    expect(citedAuthorityIdsInRealSource('// authorityId: "NOT_A_REAL_ID"')).toEqual([]);
  });

  it("ignores a citation that is only DESCRIBED in a block comment", () => {
    const doc = [
      "/**",
      " * This is the mistake we used to make:",
      ' *     authorityId: "NO_W4_TREAT_AS_SINGLE"',
      " * ...and this is why it is now impossible to write.",
      " */",
    ].join("\n");
    expect(citedAuthorityIdsInRealSource(doc)).toEqual([]);
  });

  it("reads the CODE on a line that also carries a trailing comment", () => {
    // The dangerous half-measure: dropping any line containing "//" would also
    // drop the citation next to it. This pins that we strip the comment, not
    // the statement.
    const line = 'authorityIds: ["IRC_280E"], // and NOT authorityId: "GHOST_ID"';
    expect(citedAuthorityIdsInRealSource(line)).toEqual(["IRC_280E"]);
  });

  it("is genuinely FAILABLE: a bad id in real code is still caught", () => {
    // Rule 15. If this ever returns [] the tripwire has become decorative.
    const ids = citedAuthorityIdsInRealSource('authorityIds: ["totally-not-an-authority"],');
    expect(ids).toEqual(["totally-not-an-authority"]);
    expect(findGuidanceAuthority("totally-not-an-authority")).toBeUndefined();
  });

  it("does not blank out the real tree (rule 39 vacuity guard)", () => {
    // Named risk #1 from the note above: if `stripTypeScriptComments` ever
    // returned "" the tripwire would pass by reading nothing at all. This
    // repository is heavily commented, so that failure is entirely plausible.
    const total = walk(srcDir).reduce(
      (n, f) => n + citedAuthorityIdsInRealSource(readFileSync(f, "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(1000);
  });

  it("loses at most a handful of citations versus the raw read", () => {
    // Named risk #2: stripping eats CODE, silently un-guarding real citations.
    // Measured at the time of writing: raw 1220, comment-blind 1219 — a single
    // teaching example. A generous ceiling of 10 lets someone document another
    // mistake without a test edit, while a parser bug that swallowed live code
    // would blow straight through it.
    let raw = 0;
    let clean = 0;
    for (const f of walk(srcDir)) {
      const src = readFileSync(f, "utf8");
      raw += extractCitedAuthorityIds(src).length;
      clean += citedAuthorityIdsInRealSource(src).length;
    }
    expect(clean).toBeLessThanOrEqual(raw);
    expect(raw - clean).toBeLessThanOrEqual(10);
  });

  it("the teaching example in pay-run-authorities.ts is the reason this exists", () => {
    // Anchors the change to the real file that provoked it. If that comment is
    // ever reworded away, this goes red and the next reader learns why the
    // comment-blind reader was introduced instead of deleting it.
    const src = readFileSync(
      join(srcDir, "lib", "payroll", "pay-run-authorities.ts"),
      "utf8",
    );
    expect(src).toContain('authorityId: "NO_W4_TREAT_AS_SINGLE"');
    expect(extractCitedAuthorityIds(src)).toContain("NO_W4_TREAT_AS_SINGLE");
    expect(citedAuthorityIdsInRealSource(src)).not.toContain("NO_W4_TREAT_AS_SINGLE");
    // And the id it SHOULD have been is real.
    expect(findGuidanceAuthority("pay-run-cfr-31-3402-f2-1-no-certificate")).toBeDefined();
  });
});

describe("PERMANENT TRIPWIRE: every cited authority id resolves", () => {
  it("no file under src/ cites an authority that does not exist", () => {
    const unresolved: string[] = [];
    for (const file of walk(srcDir)) {
      const rel = file.slice(srcDir.length + 1);
      // Comment-blind (books-39): a citation written down as an EXAMPLE OF A
      // MISTAKE is documentation, not a defect. See the long note above
      // `citedAuthorityIdsInRealSource`. Measured cost: 1 of 1220 citations.
      for (const id of citedAuthorityIdsInRealSource(readFileSync(file, "utf8"))) {
        if (!findGuidanceAuthority(id)) unresolved.push(`${id} (cited in src/${rel})`);
      }
    }
    expect(unresolved, `unresolved authority citations:\n${unresolved.join("\n")}`).toEqual(
      [],
    );
  });
});
