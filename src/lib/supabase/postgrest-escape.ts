/**
 * src/lib/supabase/postgrest-escape.ts  (GW-021)
 *
 * PURE helpers for putting a user-typed search term into a PostgREST
 * `.or("col.ilike.%term%,col2.ilike.%term%")` filter safely.
 *
 * The problem (FINDINGS GW-021): the `.or()` argument is FILTER GRAMMAR, not
 * a value. A comma splits conditions, parentheses group them, and `%`/`_`
 * are LIKE wildcards. Interpolating a raw search term means typing
 * `50%,off` in a search box breaks or over-broadens the filter instead of
 * searching for it. (This is NOT SQL injection — Supabase parameterizes the
 * SQL — but it is wrong results and, with pathological patterns, a slow
 * scan.)
 *
 * The codebase already solved this three separate times with three local
 * one-offs (vendors/store.ts, medical/sale-store.ts,
 * purchasing/vendor-platform-store.ts). This module is the ONE shared,
 * self-tested home so every search box behaves the same:
 *
 *   - `escapeLikeWildcards(s)` — backslash-escapes `\`, `%`, `_` so the term
 *     is literal inside a LIKE pattern. Enough on its own for the
 *     `.ilike(col, pattern)` METHOD, whose value is sent as a parameter.
 *   - `escapeIlikeOrTerm(s)`  — for terms embedded in `.or()` STRINGS: also
 *     neutralizes the grammar characters `,` `(` `)` (replaced with a space,
 *     then whitespace collapsed) because inside `or=` they change the filter
 *     shape and PostgREST offers no escape for them outside quoting.
 *   - `ilikeContains(s)`      — convenience: `%<escaped>%` ready to drop
 *     into an `.or()` string (the pattern every list search uses).
 *
 * PURE module — no supabase / "server-only" imports — so the embedded
 * self-tests run under `npx tsx scripts/compliance/run-pure-selftests.ts`.
 */

/** Backslash-escape LIKE wildcards (`%`, `_`) and the escape char itself. */
export function escapeLikeWildcards(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Make a user term safe to embed in a `.or()` filter string:
 * grammar characters (`,` `(` `)`) become spaces, LIKE wildcards are
 * escaped, and whitespace is collapsed/trimmed.
 */
export function escapeIlikeOrTerm(s: string): string {
  const noGrammar = s.replace(/[,()]/g, " ");
  return escapeLikeWildcards(noGrammar).replace(/\s+/g, " ").trim();
}

/**
 * The standard "contains" pattern for a list search box, safe for `.or()`.
 * Returns null when nothing searchable remains (caller skips the filter).
 */
export function ilikeContains(s: string): string | null {
  const term = escapeIlikeOrTerm(s);
  if (!term) return null;
  return `%${term}%`;
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runPostgrestEscapeTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // escapeLikeWildcards
  ok(escapeLikeWildcards("plain") === "plain", "plain text untouched");
  ok(escapeLikeWildcards("50%") === "50\\%", "% escaped");
  ok(escapeLikeWildcards("a_b") === "a\\_b", "_ escaped");
  ok(escapeLikeWildcards("a\\b") === "a\\\\b", "backslash escaped first");
  ok(escapeLikeWildcards("%_%") === "\\%\\_\\%", "every wildcard escaped");
  ok(escapeLikeWildcards("") === "", "empty stays empty");

  // escapeIlikeOrTerm — grammar chars neutralized
  ok(escapeIlikeOrTerm("50%,off") === "50\\% off", "comma becomes space, % escaped");
  ok(escapeIlikeOrTerm("a(b)c") === "a b c", "parens become spaces");
  ok(escapeIlikeOrTerm("O'Neil") === "O'Neil", "apostrophes survive (legit in names)");
  ok(escapeIlikeOrTerm("  padded  ") === "padded", "trimmed");
  ok(escapeIlikeOrTerm("a  ,  b") === "a b", "whitespace collapsed");
  ok(escapeIlikeOrTerm(",,,") === "", "grammar-only input collapses to empty");
  ok(!escapeIlikeOrTerm("x").includes(","), "no comma can survive");
  ok(!escapeIlikeOrTerm("(x)").includes("("), "no paren can survive");

  // ilikeContains
  ok(ilikeContains("sarah") === "%sarah%", "simple contains pattern");
  ok(ilikeContains("50%,off") === "%50\\% off%", "escaped contains pattern");
  ok(ilikeContains("   ") === null, "blank input -> null (skip filter)");
  ok(ilikeContains("()") === null, "grammar-only input -> null");

  if (fail > 0) {
    throw new Error(`postgrest-escape self-tests: ${fail} FAILED (${pass} passed)`);
  }
  console.log(`postgrest-escape: ${pass} self-tests passed`);
}
