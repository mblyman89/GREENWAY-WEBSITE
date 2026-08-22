/**
 * scripts/compliance/audit-mentor-coverage.ts  (books-36)
 *
 * WHAT THIS ANSWERS
 *
 * Michael asked a question I could not answer honestly by looking: "I read
 * earlier that you had forgotten to add the mentoring guidance in a couple
 * slices - are you able to add that to them, or do we need to go back?"
 *
 * Guessing at that from filenames is exactly the failure this repo keeps
 * finding. My first attempt used a naming heuristic (does <x>-mentor.ts
 * exist?) and it was WRONG: it reported payroll-withholding-core as having no
 * authorities at all, when in fact it imports payroll-tax-authorities and uses
 * it heavily. A wrong inventory would have sent me rewriting files that are
 * already fine while missing the ones that are not.
 *
 * So this script measures the thing that actually matters instead of the thing
 * that is easy to grep. For every payroll and books module it reports:
 *
 *   AUTHORITIES  - does it reach a registry of citations at all?
 *   QUOTES       - how many verbatim quote: fields back those citations?
 *   MENTOR       - is there a teaching layer (lessons / checks / guidance)?
 *   GATE         - is there a test that proves the teaching layer is wired?
 *
 * The four are deliberately separate because they fail separately. A module
 * can cite an authority ID with no verbatim text behind it (a citation the
 * owner cannot check). It can carry beautiful prose with no authority (an
 * opinion wearing a badge). It can have both and never render them (rule 50 -
 * dead code wearing a green check). Only the combination is worth anything.
 *
 * This is a REPORTING tool, not a gate. It prints an inventory and exits 0
 * even when coverage is poor, because its job is to tell the truth about the
 * state of the codebase, not to pass. The gates live in tests/compliance.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Directories whose modules are owner-facing enough to need mentoring. */
const SCAN_DIRS = ["src/lib/payroll", "src/lib/accounting"] as const;

/** Suffixes that ARE the mentoring infrastructure, so they are not audited. */
const INFRA = ["-authorities.ts", "-mentor.ts", "-mentor-gates.ts"] as const;

interface Row {
  readonly file: string;
  readonly lines: number;
  readonly authorities: boolean;
  readonly quotes: number;
  readonly mentor: boolean;
  readonly gateFile: string | null;
  /** For `*-mentor.ts` modules: does any screen actually import this? */
  readonly reachesUi: boolean | null;
}

/*
  THE COLUMN THAT MATTERS MOST, AND THE REASON THIS TOOL EXISTS.

  books-36 was opened by a question from Michael about "mentoring guidance I
  forgot to add." The audit found something worse and more useful: the guidance
  was WRITTEN, and TESTED, and reached no screen. garnishment-mentor.ts is 861
  lines of genuinely good teaching that no page imported, so not one word of it
  had ever been in front of him.

  That is standing rule 50 - dead code wearing a green check - and a test suite
  makes it INVISIBLE rather than obvious, because everything is green. The only
  way to see it is to ask a different question: not "does the lesson exist?" but
  "can Michael read it?" This column asks that question.
*/
function uiConsumers(stem: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        if (readFileSync(join(ROOT, p), "utf8").includes(stem)) out.push(p);
      }
    }
  };
  walk("src/app");
  walk("src/components");
  return out;
}

function listModules(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => !INFRA.some((s) => f.endsWith(s)))
    .map((f) => join(dir, f));
}

/** Every test file's text, so "is this module gated?" is answered by reading. */
function loadTests(): ReadonlyArray<{ readonly name: string; readonly src: string }> {
  const dir = join(ROOT, "tests/compliance");
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  } catch {
    return [];
  }
  return names.map((n) => ({ name: n, src: readFileSync(join(dir, n), "utf8") }));
}

const TESTS = loadTests();

function audit(file: string): Row {
  const src = readFileSync(join(ROOT, file), "utf8");
  const base = file.split("/").pop() ?? file;
  const stem = base.replace(/\.ts$/, "");

  // Does it reach a citation registry, either by importing one or by being one
  // of the modules that defines its own inline?
  const authorities =
    /from\s+"[^"]*-authorities"/.test(src) ||
    /authorityIds\s*:/.test(src) ||
    /AUTHORITIES\b/.test(src);

  /*
    Verbatim text is counted where it lives: quote: fields in the module, plus
    quote: fields in any authority registry the module imports.

    THE DEFECT THIS COMMENT EXISTS TO RECORD. The first version of this resolver
    only understood "@/lib/..." imports. Modules that import a sibling registry
    relatively - `from "./garnishment-authorities"` - resolved to nothing, so the
    tool reported ZERO verbatim quotes for files that in fact had a full
    registry behind them. An audit that under-reports is worse than no audit: it
    sends you rewriting things that are already correct while the real gaps sit
    untouched. Both import shapes are handled now, and the counter-check is in
    the gate: a module KNOWN to have a registry must report a non-zero count.
  */
  let quotes = (src.match(/\n\s*quote:/g) ?? []).length;
  const seen = new Set<string>();
  for (const m of src.matchAll(/from\s+"(@\/lib\/[^"]*-authorities|\.{1,2}\/[^"]*-authorities)"/g)) {
    const spec = m[1];
    const path = spec.startsWith("@/lib/")
      ? join(ROOT, "src/lib", `${spec.slice("@/lib/".length)}.ts`)
      : join(ROOT, file, "..", `${spec}.ts`);
    if (seen.has(path)) continue;
    seen.add(path);
    try {
      quotes += (readFileSync(path, "utf8").match(/\n\s*quote:/g) ?? []).length;
    } catch {
      /* a missing registry shows up as zero quotes, which is the honest answer */
    }
  }

  const mentor =
    /-mentor"/.test(src) ||
    /LESSON|lessons|whyThisOrder|howToCheck|soWhat|guidance/i.test(src);

  // A gate counts only if a test file actually NAMES this module.
  const gate =
    TESTS.find((t) => t.src.includes(`${stem}"`) || t.src.includes(`${stem}.ts`))?.name ?? null;

  return {
    file,
    lines: src.split("\n").length,
    authorities,
    quotes,
    mentor,
    gateFile: gate,
    reachesUi: null,
  };
}

/** Audit the mentor modules themselves: written is not the same as delivered. */
function auditMentorDelivery(): ReadonlyArray<{ readonly stem: string; readonly lines: number; readonly consumers: readonly string[] }> {
  const out: Array<{ stem: string; lines: number; consumers: string[] }> = [];
  for (const d of SCAN_DIRS) {
    let entries: string[];
    try {
      entries = readdirSync(join(ROOT, d));
    } catch {
      continue;
    }
    for (const f of entries.filter((x) => x.endsWith("-mentor.ts"))) {
      const stem = f.replace(/\.ts$/, "");
      const src = readFileSync(join(ROOT, d, f), "utf8");
      out.push({ stem, lines: src.split("\n").length, consumers: uiConsumers(stem) });
    }
  }
  return out;
}

const rows: Row[] = [];
for (const d of SCAN_DIRS) for (const f of listModules(d)) rows.push(audit(f));

rows.sort((a, b) => b.lines - a.lines);

console.log("MENTOR COVERAGE INVENTORY");
console.log("=========================");
console.log("");
console.log("AUTH = reaches a citation registry   QUOTES = verbatim texts behind it");
console.log("MENTOR = has a teaching layer        GATE = a test names this module");
console.log("");
console.log(
  `${"MODULE".padEnd(46)} ${"LINES".padStart(6)} ${"AUTH".padEnd(5)} ${"QUOTES".padStart(6)} ${"MENTOR".padEnd(7)} GATE`,
);
console.log("-".repeat(100));

const gaps: Row[] = [];
for (const r of rows) {
  const name = r.file.replace("src/lib/", "");
  console.log(
    `${name.padEnd(46)} ${String(r.lines).padStart(6)} ${(r.authorities ? "yes" : "NO").padEnd(5)} ${String(r.quotes).padStart(6)} ${(r.mentor ? "yes" : "NO").padEnd(7)} ${r.gateFile ?? "NONE"}`,
  );
  // A module worth mentoring is one big enough to hold a real decision.
  if (r.lines >= 150 && (!r.authorities || r.quotes === 0 || !r.mentor)) gaps.push(r);
}

console.log("");
console.log(`Modules audited: ${rows.length}`);
console.log(`Substantial modules missing authority, quotes, or a teaching layer: ${gaps.length}`);
console.log("");
console.log("DOES THE TEACHING ACTUALLY REACH A SCREEN?");
console.log("==========================================");
console.log("");
const delivery = auditMentorDelivery();
let undelivered = 0;
for (const d of delivery) {
  if (d.consumers.length > 0) {
    console.log(`  ${d.stem.padEnd(34)} ${String(d.lines).padStart(5)} lines  ->  ${d.consumers.join(", ")}`);
  } else {
    undelivered++;
    console.log(`  ${d.stem.padEnd(34)} ${String(d.lines).padStart(5)} lines  ->  *** NO SCREEN IMPORTS THIS ***`);
  }
}
console.log("");
console.log(`Mentor modules: ${delivery.length}   Never rendered anywhere: ${undelivered}`);
console.log("");
for (const g of gaps) {
  const missing = [
    g.authorities ? null : "no authority registry",
    g.quotes === 0 ? "no verbatim text" : null,
    g.mentor ? null : "no teaching layer",
    g.gateFile ? null : "no gate",
  ].filter((x): x is string => x !== null);
  console.log(`  ${g.file.replace("src/lib/", "").padEnd(46)} ${missing.join(", ")}`);
}
