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
 * Deliberately conservative: it only matches SCREAMING_SNAKE literals, because
 * that is the shape every authority id in this repo has. A dynamically built
 * id would not be caught here — and that is a good reason never to build one
 * dynamically.
 */
export function extractCitedAuthorityIds(source: string): string[] {
  const found: string[] = [];
  const re =
    /authorityIds(?:\s*:\s*(?:readonly\s+)?(?:string\[\]\s*=\s*)?\[([^\]]*)\]|\.push\(([^)]*)\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const body = m[1] ?? m[2] ?? "";
    for (const q of body.matchAll(/"([A-Z0-9_]{3,})"/g)) found.push(q[1]);
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
