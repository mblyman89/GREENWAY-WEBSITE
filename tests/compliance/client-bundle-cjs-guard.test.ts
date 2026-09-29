/**
 * tests/compliance/client-bundle-cjs-guard.test.ts
 *
 * REGRESSION LOCK for the back-office crash reported after R12a (deployment
 * dpl_As9UExDEtqXfzutikm1SGx3iGDEF): every /admin page rendered the route
 * error boundary with
 *
 *     ReferenceError: module is not defined   (chunk 1t5qnrn7hkl-y.js)
 *
 * Root cause (verified in the production chunk, not inferred): S28 made the
 * shared admin UI barrel `src/components/admin/ui/index.ts` export
 * `IssuesList` ("use client"), which imports `lib/admin/issues-core` ->
 * `lib/pos/issue-fix-link-core` -> `lib/inventory/website-category-resolver`.
 * That resolver ended with the tsx convenience guard
 *
 *     if (typeof require !== "undefined" && require.main === module) { ... }
 *
 * Turbopack shims `require` in browser chunks (so the first operand is TRUE)
 * but there is no `module` binding, so evaluating `module` throws. The
 * compiled chunk literally contained `e.z.main===module`. Because the barrel
 * is imported by the admin shell (LoginForm, ConfirmDialog, SectionCard …),
 * every admin route crashed; the customer site does not import the barrel,
 * which is why it kept working.
 *
 * The guard: (1) no file under src/ may use a `require.main` entry guard or
 * declare/reference a CommonJS `module` binding — self-tests run through
 * scripts/compliance/run-pure-selftests.ts and vitest instead; (2) no file
 * reachable (by static value import) from a "use client" module may
 * reference CommonJS globals at all.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Blank out comments and string/template literals, preserving line count. */
export function stripCommentsAndStrings(src: string): string {
  const keepNewlines = (m: string) => m.replace(/[^\n]/g, "");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, keepNewlines)
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

/** CommonJS usages that crash (or are meaningless) in a browser chunk. */
export const CJS_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["require.main", /\brequire\s*(?:as[^)]*\))?\)?\s*\.\s*main\b/],
  ["declare const module", /\bdeclare\s+(?:const|let|var)\s+module\b/],
  ["module.exports", /(?<![\w.$])module\s*\.\s*exports\b/],
  ["=== module", /[=!]==\s*\(?\s*module\b(?![\w$])/],
  ["typeof module", /\btypeof\s+module\b(?![\w$])/],
  ["exports.x =", /(?<![\w.$])exports\s*\.\s*\w+\s*=/],
  ["__dirname", /(?<![\w.$])__dirname\b/],
  ["__filename", /(?<![\w.$])__filename\b/],
];

export function cjsHits(source: string): string[] {
  const code = stripCommentsAndStrings(source);
  return CJS_PATTERNS.filter(([, re]) => re.test(code)).map(([n]) => n);
}

const files = walk(SRC);
const fileSet = new Set(files);
const text = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(type\s+)?(?:[^;"'`()]*?\sfrom\s*)?["']([^"'\n]+)["']|import\(\s*["']([^"'\n]+)["']\s*\)/g;

function valueDeps(file: string): string[] {
  const out: string[] = [];
  const src = text.get(file) ?? "";
  // comments only (keep strings — the specifiers ARE strings)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "");
  for (const m of code.matchAll(IMPORT_RE)) {
    if (m[1]) continue; // `import type` / `export type` — erased at compile time
    const r = resolveSpec(file, m[2] ?? m[3]);
    if (r) out.push(r);
  }
  return out;
}

const depCache = new Map<string, string[]>();
function depsOf(file: string): string[] {
  let d = depCache.get(file);
  if (!d) depCache.set(file, (d = valueDeps(file)));
  return d;
}

/** First statement is the given directive (skipping whitespace and comments). Linear scan. */
export function hasDirective(src: string, directive: string): boolean {
  let i = 0;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith("//", i)) {
      const nl = src.indexOf("\n", i);
      if (nl < 0) return false;
      i = nl + 1;
    } else if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return false;
      i = end + 2;
    } else break;
  }
  return src.startsWith(`"${directive}"`, i) || src.startsWith(`'${directive}'`, i);
}
const dirCache = new Map<string, boolean>();
const isDirective = (f: string, d: string) => {
  const k = `${d}\0${f}`;
  let v = dirCache.get(k);
  if (v === undefined) dirCache.set(k, (v = hasDirective(text.get(f) ?? "", d)));
  return v;
};

describe("client bundles never evaluate CommonJS globals (admin crash regression)", () => {
  it("the pattern set catches the exact guard that crashed production", () => {
    const crashed =
      'declare const require: undefined | { main?: unknown };\n' +
      "// eslint-disable-next-line @next/next/no-assign-module-variable\n" +
      "declare const module: unknown;\n" +
      'if (typeof require !== "undefined" && (require as { main?: unknown }).main === (module as unknown)) {\n  run();\n}\n';
    expect(cjsHits(crashed)).toEqual(expect.arrayContaining(["require.main", "declare const module", "=== module"]));
    expect(cjsHits('if (typeof require !== "undefined" && require.main === module) { run(); }')).toEqual(
      expect.arrayContaining(["require.main", "=== module"]),
    );
    expect(cjsHits("module.exports = { a: 1 };")).toContain("module.exports");
    expect(cjsHits("const p = __dirname;")).toContain("__dirname");
  });

  it("directive detection skips leading comments and rejects late directives", () => {
    expect(hasDirective('/** doc */\n// x\n"use client";\nimport a from "b";', "use client")).toBe(true);
    expect(hasDirective("'use server';", "use server")).toBe(true);
    expect(hasDirective('import a from "b";\n"use client";', "use client")).toBe(false);
    expect(hasDirective('"use server";', "use client")).toBe(false);
  });

  it("comments, strings and ordinary words are not flagged", () => {
    expect(cjsHits("// require.main === module was removed\nconst a = 1;")).toEqual([]);
    expect(cjsHits('const s = "CCRS exports — every module"; const t = `module ${s}`;')).toEqual([]);
    expect(cjsHits("const moduleName = 1; const reExports = 2; obj.module = 3;")).toEqual([]);
  });

  it("no src file carries a require.main / CommonJS-module entry guard", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const hits = cjsHits(text.get(f) ?? "").filter((h) =>
        ["require.main", "declare const module", "=== module", "typeof module", "module.exports"].includes(h),
      );
      if (hits.length) offenders.push(`${path.relative(ROOT, f)}: ${hits.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the import walker sees the real chain that crashed (barrel -> IssuesList -> resolver)", () => {
    const barrel = path.join(SRC, "components/admin/ui/index.ts");
    const seen = new Set<string>([barrel]);
    const stack = [barrel];
    while (stack.length) {
      const f = stack.pop()!;
      for (const d of depsOf(f)) {
        if (seen.has(d)) continue;
        seen.add(d);
        stack.push(d);
      }
    }
    expect(seen.has(path.join(SRC, "components/admin/ui/IssuesList.tsx"))).toBe(true);
    expect(seen.has(path.join(SRC, "lib/inventory/website-category-resolver.ts"))).toBe(true);
  });

  it("nothing reachable from a \"use client\" module references CommonJS globals", () => {
    const clients = files.filter((f) => isDirective(f, "use client"));
    expect(clients.length).toBeGreaterThan(50);
    // One multi-source BFS with parent pointers (memoised) — linear in the graph.
    const parent = new Map<string, string | null>(clients.map((c) => [c, null]));
    const queue = [...clients];
    for (let i = 0; i < queue.length; i++) {
      for (const d of depsOf(queue[i])) {
        // server-action modules become RPC stubs in the client bundle
        if (parent.has(d) || isDirective(d, "use server")) continue;
        parent.set(d, queue[i]);
        queue.push(d);
      }
    }
    const offenders = new Set<string>();
    for (const f of queue) {
      const hits = cjsHits(text.get(f) ?? "");
      if (!hits.length) continue;
      const trail: string[] = [];
      for (let p: string | null | undefined = f; p; p = parent.get(p)) trail.unshift(path.relative(SRC, p));
      offenders.add(`${trail.join(" -> ")}: ${hits.join(", ")}`);
    }
    expect([...offenders]).toEqual([]);
  });
});
