#!/usr/bin/env node
/**
 * scripts/recon/db-call-inventory.mjs
 *
 * SLICE L-25 — which database calls can one acknowledge click reach, and
 * which of them are still unbounded?
 *
 * ===========================================================================
 * WHY THIS SCRIPT EXISTS
 * ===========================================================================
 * The acknowledge hang has now survived two fixes. Both were correct and
 * both were incomplete, because both were chosen from a hypothesis rather
 * than from an inventory. L-17 bounded the fetch connection. L-23 bounded
 * the response body. Neither author had a list of every blocking call the
 * click could make, so neither could see that the DATABASE — fourteen-odd
 * calls per click — was bounded nowhere at all.
 *
 * This script produces that list mechanically. It walks the real static
 * import graph out of the server action and reports every `.from("table")`
 * query it can reach, marking each BOUNDED or UNBOUNDED by looking for an
 * `.abortSignal(` in the same statement.
 *
 * ── WHY STATIC ANALYSIS AND NOT A RUNTIME TRACE ─────────────────────────
 * A runtime trace only shows the calls that a particular run happened to
 * make. The hang is intermittent and environment-dependent, so the run that
 * matters is precisely the one we cannot reproduce on demand. The import
 * graph is a superset: if a query is not reachable here, no run can reach
 * it. Over-reporting is safe; under-reporting is how we got here.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CLAIM ─────────────────────────────────
 * Reachable is not the same as executed. A query behind `if (false)` is
 * still reported. This is an inventory to review, not a proof of execution
 * count — the per-click counts in `db-deadline-core.ts` were established by
 * reading each path by hand, and this script is the check that no path was
 * missed, not a replacement for that reading.
 *
 * Usage:  node scripts/recon/db-call-inventory.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");

const ENTRIES = [
  "src/app/admin/orders/leafly-actions.ts",
  "src/app/admin/orders/page.tsx",
];

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx"];

/** Resolve one import specifier to a real file on disk, or null. */
function resolveSpecifier(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules — not our code, not our bug

  for (const ext of EXTS) {
    if (existsSync(base + ext)) return base + ext;
  }
  if (existsSync(base)) {
    for (const ext of EXTS) {
      const idx = join(base, "index" + ext);
      if (existsSync(idx)) return idx;
    }
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

/**
 * Dynamic `await import("./x")`.
 *
 * ── WHY THIS IS NOT OPTIONAL ────────────────────────────────────────────
 * The first version of this script omitted it and under-reported, which is
 * the one failure mode the header calls unacceptable. `order-ack-server.ts`
 * reaches TWO of its most important collaborators this way:
 *
 *   order-ack-server.ts:480  await import("./webhook-server")
 *   order-ack-server.ts:525  await import("./bridge-server")
 *
 * `bridge-server.ts` is where an accepted Leafly order is written into our
 * own orders / order_lines / order_events tables — the heaviest write on
 * the whole click. A static-import-only walk cannot see it, declares the
 * acknowledge path clean, and sends the next person hunting elsewhere. That
 * is precisely how this bug survived two slices.
 */
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function importsOf(source, file) {
  const out = new Set();
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const target = resolveSpecifier(m[1], file);
      if (target) out.add(target);
    }
  }
  return [...out];
}

/**
 * Blank out comments, preserving every newline so line numbers stay exact.
 *
 * ── WHY THIS IS REQUIRED, FOUND BY THE PROBE FAILING ────────────────────
 * The statement window below is capped at 600 characters. Every deadline
 * added in this slice carries a paragraph of comment explaining WHY that
 * particular query must not hang — which is the house style and is right —
 * and those paragraphs pushed the `.abortSignal(` call past the cap. The
 * probe then reported freshly-bounded queries as UNBOUNDED.
 *
 * Measured: the audit-log insert's statement is 862 characters with its
 * comment and well under 600 without it.
 *
 * That direction of error is the harmless one — it over-reports work still
 * to do rather than declaring a false all-clear — but it is still wrong,
 * and a probe that cries wolf gets ignored, which is how a real gap slips
 * through. Comments are not code; the scanner should not see them.
 *
 * Handles line comments, block comments, and the three string forms so a
 * `//` inside a URL string is not mistaken for a comment. Regex literals
 * are NOT tracked: a regex containing `//` or `/*` would confuse this, and
 * none exists in the scanned files. If one is ever added the symptom is
 * over-reporting, not a false all-clear.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        // Keep newlines so reported line numbers match the real file.
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Find every `.from("x")` and decide whether its STATEMENT carries an
 * `.abortSignal(`.
 *
 * "Statement" is the comment-stripped text from the `.from(` to whichever
 * comes first: the next semicolon, or the next `.from(`.
 *
 * ── WHY NOT A FIXED CHARACTER CAP ───────────────────────────────────────
 * The first version capped the window at 600 characters on the assumption
 * that no query in this repository is longer. That assumption was false and
 * the probe caught it: `recordAttempt`'s insert in `order-ack-server.ts` is
 * 1025 characters of column payload, so its `.abortSignal()` — which is
 * right there in the source — fell outside the window and the query was
 * reported UNBOUNDED when it is bounded.
 *
 * Raising the cap to some larger number would just move the same bug
 * further away. The real boundary is structural: a chained PostgREST query
 * is exactly one statement, so the semicolon ends it, and the next `.from(`
 * guarantees we never attribute one query's deadline to the query after it
 * even if a semicolon is somehow missing.
 *
 * The residual failure mode is reading too much text and calling something
 * bounded when it is not. The `.from(` guard is what keeps that bounded in
 * turn: the most this can over-read is the tail of its own statement.
 */
function dbCallsIn(rawSource) {
  // Scan CODE, not prose. See `stripComments` for why this is load-bearing.
  const source = stripComments(rawSource);
  const calls = [];
  // Matches BOTH `.from("leafly_orders")` and `.from(TABLE)`.
  //
  // ── WHY THE IDENTIFIER FORM MATTERS ───────────────────────────────────
  // `integration-credentials-store.ts` writes `.from(TABLE)` against a
  // module constant. A literals-only pattern misses it entirely — and that
  // file holds `getIntegrationCredentialsRow()`, the single most-executed
  // read on an acknowledge click (four times per click, once for each
  // credential lookup) and the query this whole slice was traced back to.
  // A probe that cannot see its own root cause is worse than no probe,
  // because it reads as an all-clear.
  //
  // The `(?<!Array)` guard keeps `Array.from(...)` out of the inventory.
  // Without it, `register-claim-server.ts`'s id-list builder was counted as
  // a database query and reported forever unbounded — a phantom finding
  // that sends a reader looking for a query that does not exist.
  const re = /(?<!Array)\.from\(\s*(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const start = m.index;
    const semi = source.indexOf(";", start);
    // The next `.from(` bounds the window so one query's deadline can never
    // be credited to the next one.
    const nextFrom = source.indexOf(".from(", start + 1);
    const candidates = [semi, nextFrom].filter((x) => x !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
    const stmt = source.slice(start, end);
    const line = source.slice(0, start).split("\n").length;
    calls.push({
      // `m[2]` is the identifier form; it is shown in angle brackets so a
      // reader can tell a real table name from a constant to go look up.
      table: m[1] ?? `<${m[2]}>`,
      line,
      bounded: stmt.includes(".abortSignal("),
    });
  }
  return calls;
}

for (const entry of ENTRIES) {
  const entryPath = join(ROOT, entry);
  if (!existsSync(entryPath)) {
    console.log(`\nENTRY: ${entry}  — NOT FOUND, skipped`);
    continue;
  }

  const seen = new Set();
  const stack = [{ file: entryPath, depth: 0 }];
  const findings = [];

  while (stack.length > 0) {
    const { file, depth } = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const call of dbCallsIn(source)) {
      findings.push({ file: file.slice(ROOT.length + 1), depth, ...call });
    }
    for (const next of importsOf(source, file)) {
      stack.push({ file: next, depth: depth + 1 });
    }
  }

  const unbounded = findings.filter((f) => !f.bounded);
  const bounded = findings.filter((f) => f.bounded);

  console.log(`\nENTRY: ${entry}`);
  console.log(
    `  modules reached: ${seen.size} | db queries: ${findings.length} ` +
      `| BOUNDED ${bounded.length} | UNBOUNDED ${unbounded.length}`,
  );

  if (unbounded.length > 0) {
    console.log("  ── UNBOUNDED ──");
    const byFile = new Map();
    for (const f of unbounded) {
      if (!byFile.has(f.file)) byFile.set(f.file, []);
      byFile.get(f.file).push(f);
    }
    for (const [f, list] of [...byFile].sort()) {
      const tables = list.map((x) => `${x.table}@${x.line}`).join(", ");
      console.log(`    ${f}  (${list.length})  ${tables}`);
    }
  }
  if (bounded.length > 0) {
    console.log("  ── BOUNDED ──");
    for (const f of bounded.sort((a, b) => a.file.localeCompare(b.file))) {
      console.log(`    ${f.file}  ${f.table}@${f.line}`);
    }
  }
}

console.log("");
