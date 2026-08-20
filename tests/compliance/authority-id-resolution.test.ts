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

describe("PERMANENT TRIPWIRE: every cited authority id resolves", () => {
  it("no file under src/ cites an authority that does not exist", () => {
    const unresolved: string[] = [];
    for (const file of walk(srcDir)) {
      const rel = file.slice(srcDir.length + 1);
      for (const id of extractCitedAuthorityIds(readFileSync(file, "utf8"))) {
        if (!findGuidanceAuthority(id)) unresolved.push(`${id} (cited in src/${rel})`);
      }
    }
    expect(unresolved, `unresolved authority citations:\n${unresolved.join("\n")}`).toEqual(
      [],
    );
  });
});
