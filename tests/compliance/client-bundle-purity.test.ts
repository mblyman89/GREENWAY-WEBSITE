/**
 * tests/compliance/client-bundle-purity.test.ts   (books-33)
 *
 * NO `"use client"` COMPONENT MAY REACH A NODE-ONLY MODULE.
 *
 * WHY THIS FILE EXISTS. Every Vercel deployment - preview and production -
 * failed for several slices with this, and nobody could see any new work:
 *
 *     ./src/components/admin/books/TimesheetWorkbench.tsx
 *     Code generation for chunk item errored
 *     Caused by:
 *     - the chunking context (unknown) does not support external modules
 *       (request: node:fs)
 *
 * The cause was not exotic. `TimesheetWorkbench.tsx` and
 * `CompanyInformationForm.tsx` are client components. They imported their
 * mentor modules for lesson text. Those mentors also held the rule-26 coverage
 * gates, which call `readFileSync` to read the engine off disk. Turbopack has
 * to bundle a client component's whole import graph for a browser, a browser
 * has no filesystem, and so the build died.
 *
 * THE PART THAT MATTERS MORE THAN THE BUG. The full compliance suite passed the
 * entire time. `tsc --noEmit` passed. The migration job passed. GitHub Actions
 * was green on every single merge to main. None of it looked at the one thing
 * that was broken, because CI never runs `next build`. That is standing rule 50
 * wearing its most convincing disguise: a wall of green checks, none of which
 * examined the failing surface.
 *
 * So this test examines it, in the suite, in seconds, without a bundler:
 * start at every `"use client"` file, walk its LOCAL imports transitively, and
 * fail if the graph reaches a node-only builtin. A developer adding
 * `readFileSync` to a mentor gets a red test here in the same run that would
 * otherwise have shipped a broken deployment.
 *
 * Standing rule 65: if a build system can catch it, a test should catch it
 * first - and the test must name the exact import chain, because "the build
 * failed" is a symptom and the chain is the explanation (rule 64a).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/**
 * Builtins that break a BROWSER bundle outright.
 *
 * This list is deliberately the enforced one and the only one. An earlier draft
 * of this file also declared a longer `NODE_ONLY` array "for reference" that
 * nothing read - which is precisely the dead-code-wearing-a-green-check habit
 * this whole slice exists to stamp out (rule 50). If a builtin is not fatal,
 * it does not belong in a list that looks like a policy.
 *
 * NOT included, on purpose: `node:path`, `node:crypto`, `node:stream`,
 * `node:os`, `node:zlib`, `node:http(s)`. Bundlers polyfill or shim these, they
 * do NOT produce the chunking error, and failing on them would be a false
 * alarm. A test that cries wolf gets disabled, and a disabled test protects
 * nothing.
 */
const FATAL = new Set<string>([
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:net",
  "node:tls",
  "node:dns",
  "node:worker_threads",
  "node:cluster",
  "node:v8",
  "node:vm",
  "node:readline",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const ALL_FILES = walk(SRC);

/** Files whose FIRST meaningful line is the client directive. */
function isClientComponent(file: string): boolean {
  const text = readFileSync(file, "utf8");
  // The directive must be the first statement; comments may precede it.
  const stripped = text
    .replace(/^#!.*\n/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
  return /^["']use client["']/.test(stripped);
}

/**
 * Every module specifier this file imports (static imports and re-exports).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `import type` IS SKIPPED, AND THAT IS A CORRECTION, NOT A RELAXATION
 * ────────────────────────────────────────────────────────────────────────────
 * Found in books-44. The learning page reaches, at four hops,
 * `payroll-reconciliation-mentor`, which does:
 *
 *     import type { MentorLesson } from "@/lib/reports/reports-presentation-mentor";
 *
 * and that module reads from disk. The walker reported the page as reaching
 * `node:fs` and the build would have been blocked on a defect that does not
 * exist: TypeScript ERASES a whole-clause `import type` completely. Verified
 * rather than assumed - compiling
 *
 *     import type { Foo } from "./other";
 *     export const x: Foo = ...;
 *
 * emits `export const x = 1;` and no import statement at all. No module edge
 * exists in the output, so no bundler can follow one, so Turbopack cannot fail
 * on it.
 *
 * This makes the walker MORE accurate, never blinder: the only edges it stops
 * following are ones that ship no code. And a false alarm is not a harmless
 * kind of wrong - the header on FATAL says it plainly, "a test that cries wolf
 * gets disabled, and a disabled test protects nothing."
 *
 * DELIBERATELY CONSERVATIVE: only the whole-clause `import type {...} from`
 * form is skipped. The inline form, `import { type A, b } from "..."`, still
 * counts, because it can carry a value binding alongside the type and the
 * import survives in the emitted code. When in doubt this over-reports, which
 * is the safe direction to be wrong in.
 */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)) {
    specs.push(m[1]);
  }
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) specs.push(m[1]);
  for (const m of text.matchAll(/^\s*export\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm)) {
    specs.push(m[1]);
  }
  return specs;
}

/** Resolve a local specifier to a real file, or null when it is a package. */
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules package, or a builtin
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

type Finding = { readonly builtin: string; readonly chain: readonly string[] };

/** Depth-first walk from one client component, returning the first fatal chain. */
function findNodeOnlyReach(entry: string): Finding | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; chain: string[] }> = [
    { file: entry, chain: [relative(ROOT, entry)] },
  ];
  while (stack.length > 0) {
    const { file, chain } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const spec of importsOf(file)) {
      if (FATAL.has(spec)) return { builtin: spec, chain: [...chain, spec] };
      const next = resolveLocal(spec, file);
      // A "server-only" module cannot be imported by a client component at all,
      // so if one appears the chain is already broken for a different reason -
      // still worth surfacing here rather than at build time.
      if (next) stack.push({ file: next, chain: [...chain, relative(ROOT, next)] });
    }
  }
  return null;
}

describe("client bundle purity: no browser file may reach node-only builtins", () => {
  const clientFiles = ALL_FILES.filter(isClientComponent);

  it("actually found client components to inspect", () => {
    // Rule 39: a sweep that inspects nothing passes vacuously. This repo has
    // hundreds of client components; if this ever reads zero, the detector is
    // broken, not the codebase.
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  it("resolves @/ and relative imports rather than silently skipping them", () => {
    // Rule 48: a check that cannot classify its input must say so. If the
    // resolver returned null for everything, the walk above would visit one
    // file and declare victory. Prove it resolves a known-good local import.
    const probe = resolveLocal("@/lib/payroll/timesheet-mentor", join(SRC, "x.ts"));
    expect(probe).not.toBeNull();
    expect(probe!.endsWith("timesheet-mentor.ts")).toBe(true);
  });

  it("no client component can reach node:fs or any other fatal builtin", () => {
    const failures: string[] = [];
    for (const f of clientFiles) {
      const hit = findNodeOnlyReach(f);
      if (hit) {
        failures.push(
          `${relative(ROOT, f)} reaches ${hit.builtin}\n      via: ${hit.chain.join("\n         -> ")}`,
        );
      }
    }
    expect(
      failures.join("\n\n"),
      failures.length === 0
        ? ""
        : `A "use client" component can reach a Node-only builtin. Turbopack will fail the ` +
            `Vercel build with "the chunking context (unknown) does not support external modules". ` +
            `Move the disk-reading code into a sibling *-gates.ts imported only by tests, the way ` +
            `books-33 did for timesheet-mentor and company-identity-mentor.`,
    ).toBe("");
  });

  it("the detector can actually fail (rule 16: prove the gate is wired)", () => {
    // A green sweep is worthless unless the walker can find a violation. Build
    // a synthetic chain that mirrors the real defect and confirm it is caught.
    // We do this against REAL files: timesheet-mentor-gates.ts genuinely does
    // import node:fs, so a walk starting there must report it.
    const gates = join(SRC, "lib", "payroll", "timesheet-mentor-gates.ts");
    expect(existsSync(gates)).toBe(true);
    const hit = findNodeOnlyReach(gates);
    expect(hit).not.toBeNull();
    expect(hit!.builtin).toBe("node:fs");
  });

  it("the two modules that broke Vercel are now clean", () => {
    // Named explicitly, because these are the exact files in the failing build
    // log. A general sweep can drift; a named regression test cannot.
    for (const rel of [
      "src/components/admin/books/TimesheetWorkbench.tsx",
      "src/components/admin/books/CompanyInformationForm.tsx",
    ]) {
      const abs = join(ROOT, rel);
      expect(existsSync(abs), `${rel} should exist`).toBe(true);
      expect(findNodeOnlyReach(abs), `${rel} still reaches a node builtin`).toBeNull();
    }
  });

  it("the mentors themselves no longer import node:fs", () => {
    for (const rel of [
      "src/lib/payroll/timesheet-mentor.ts",
      "src/lib/accounting/company-identity-mentor.ts",
      // ── The four split in books-44 (slice C). ──────────────────────────
      // These had to be split for the same reason as the two above, and the
      // reason is worth restating: the learning screen renders all six mentor
      // modules, so a single `node:fs` import anywhere in that graph is a
      // Turbopack build failure on a page Michael needs. Rule 65b.
      "src/lib/accounting/interest-mentor.ts",
      "src/lib/accounting/period-close-mentor.ts",
      "src/lib/accounting/s-corporation-year-mentor.ts",
      "src/lib/reports/payroll-reconciliation-mentor.ts",
      // Never had it, and must never gain it - they are the two modules the
      // page imports directly.
      "src/lib/accounting/learning-path-core.ts",
      "src/lib/accounting/learning-path-ui-core.ts",
    ]) {
      /*
       * ENFORCES THE `FATAL` LIST, NOT A PRIVATE ONE.
       *
       * The first version of this loop tested its own regex for
       * `node:(fs|path|crypto|os)`, which immediately went red on
       * `company-identity-mentor` - a module that imports `node:path` and is
       * perfectly fine. The header of `FATAL` says why in as many words:
       * bundlers shim `node:path`, it does not produce the chunking error, and
       * "a test that cries wolf gets disabled, and a disabled test protects
       * nothing."
       *
       * So the policy lives in exactly one place and this reads it. Two
       * definitions of "forbidden" in one file is how the strict one gets
       * switched off and the loose one is the only survivor.
       */
      const offending = importsOf(join(ROOT, rel)).filter((s) => FATAL.has(s));
      expect(offending, `${rel} imports a fatal builtin again: ${offending.join(", ")}`).toEqual([]);
    }
  });

  it("the gates that moved are still called by the suite", () => {
    // Rule 50: moving a gate out of the way is only legitimate if it still
    // runs. If someone deletes the test import, the gate becomes dead code
    // wearing a green check, which is exactly what this whole slice is about.
    const t1 = readFileSync(join(ROOT, "tests/compliance/timesheet-mentor.test.ts"), "utf8");
    expect(t1).toContain("timesheet-mentor-gates");
    expect(t1).toContain("assertEveryRefusalCodeIsTaught");

    const t2 = readFileSync(join(ROOT, "tests/compliance/company-identity-mentor.test.ts"), "utf8");
    expect(t2).toContain("company-identity-mentor-gates");
    expect(t2).toContain("assertEveryExportedFunctionIsTaught");
  });

  it("the four gates that moved in books-44 are still called by the suite", () => {
    /*
     * Same discipline, four more modules.
     *
     * Splitting a coverage gate out of a mentor is a refactor that can silently
     * DELETE the gate: the mentor still compiles, the page still renders, every
     * test still passes, and the check that used to prove every exported
     * function is taught simply never runs again. The only thing standing
     * between that and shipping is this test, so it names each moved gate and
     * the test file that must still call it.
     */
    const wired: readonly { test: string; gatesModule: string; gateFn: string }[] = [
      {
        test: "tests/compliance/books-21-mentors.test.ts",
        gatesModule: "interest-mentor-gates",
        gateFn: "assertEveryInterestFunctionIsTaught",
      },
      {
        test: "tests/compliance/books-21-mentors.test.ts",
        gatesModule: "s-corporation-year-mentor-gates",
        gateFn: "assertEverySCorporationYearFunctionIsTaught",
      },
      {
        test: "tests/compliance/period-close-core.test.ts",
        gatesModule: "period-close-mentor-gates",
        gateFn: "assertEveryExportedFunctionIsTaught",
      },
      {
        test: "tests/compliance/payroll-reconciliation-report.test.ts",
        gatesModule: "payroll-reconciliation-mentor-gates",
        gateFn: "assertEveryReconciliationFunctionIsTaught",
      },
    ];

    for (const w of wired) {
      const abs = join(ROOT, w.test);
      expect(existsSync(abs), `${w.test} no longer exists — the gate has no caller`).toBe(true);
      const text = readFileSync(abs, "utf8");
      expect(text, `${w.test} stopped importing ${w.gatesModule}`).toContain(w.gatesModule);
      expect(text, `${w.test} stopped calling ${w.gateFn}`).toContain(w.gateFn);
    }
  });

  it("skipping `import type` did not blind the walker to real value imports", () => {
    /*
     * THE CONTROL FOR THE CHANGE ABOVE (rule 55: a refusal that stops
     * discriminating is not a refusal).
     *
     * `importsOf` was narrowed to ignore whole-clause `import type`. The
     * failure mode of that change is silent and total: widen the exclusion by
     * one character and the walker stops following ordinary imports too, at
     * which point every check in this file passes while inspecting nothing.
     *
     * So this asserts BOTH directions against real files, not fixtures:
     *   - a genuine VALUE import of node:fs is still found;
     *   - a genuine TYPE-only edge is still not followed.
     */
    const gates = join(SRC, "lib", "payroll", "timesheet-mentor-gates.ts");
    expect(existsSync(gates)).toBe(true);
    expect(
      importsOf(gates),
      "the walker stopped seeing an ordinary value import of node:fs — it is now blind",
    ).toContain("node:fs");

    // And an ordinary aliased value import is still returned.
    const uiCore = join(SRC, "lib", "accounting", "learning-path-ui-core.ts");
    expect(existsSync(uiCore)).toBe(true);
    expect(
      importsOf(uiCore),
      "the walker stopped seeing an ordinary relative value import",
    ).toContain("./learning-path-core");

    // The type-only edge that caused the false alarm is genuinely skipped.
    const recon = join(SRC, "lib", "reports", "payroll-reconciliation-mentor.ts");
    const reconText = readFileSync(recon, "utf8");
    expect(
      reconText,
      "the premise of this control is gone: payroll-reconciliation-mentor no longer type-imports " +
        "from reports-presentation-mentor, so this proves nothing. Find another type-only edge " +
        "or delete this test and say why.",
    ).toContain('import type { MentorLesson } from "@/lib/reports/reports-presentation-mentor"');
    expect(
      importsOf(recon),
      "the walker followed a type-only import again — it will report false node:fs reaches",
    ).not.toContain("@/lib/reports/reports-presentation-mentor");
  });

  it("the learning page reaches no node builtin, through any depth of import", () => {
    /*
     * THE WHOLE POINT OF THE SPLIT, ASSERTED AT THE PAGE.
     *
     * The four checks above look at four files. This one walks the entire
     * import graph beneath the learning page, which is the only assertion that
     * actually corresponds to the thing that breaks: Turbopack does not care
     * which file the `node:fs` is in, only that the bundle reaches one.
     *
     * If this ever fails, the message names the chain, so the offending edge is
     * the first thing you see rather than something to go hunting for.
     */
    const rel = "src/app/admin/books/learn/page.tsx";
    const abs = join(ROOT, rel);
    expect(existsSync(abs), `${rel} should exist`).toBe(true);

    const hit = findNodeOnlyReach(abs);
    expect(
      hit,
      hit
        ? `the learning page reaches ${hit.builtin}\n      via: ${hit.chain.join("\n         -> ")}`
        : "",
    ).toBeNull();
  });
});
