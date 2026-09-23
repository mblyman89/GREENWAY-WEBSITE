#!/usr/bin/env node
/**
 * RECON ONLY (L-25). Walk the static import graph from an entry file and report
 * every module that contains a bare `fetch(` call, plus whether that module
 * routes through the bounded helper.
 *
 * Not a test, not shipped behaviour. This exists so the acknowledge-hang
 * investigation can answer "does the redirect target make an outbound network
 * call during render?" with a measurement instead of an opinion.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules / bare
  const cands = [
    base + ".ts",
    base + ".tsx",
    join(base, "index.ts"),
    join(base, "index.tsx"),
    base,
  ];
  for (const c of cands) if (existsSync(c) && !c.endsWith("/")) {
    try { if (readFileSync(c)) return c; } catch { /* dir */ }
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*import\s+(?:[\s\S]*?)\s*from\s*["']([^"']+)["']/g;
const DYNIMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

const seen = new Set();
const findings = [];

function walk(file, depth, path) {
  if (seen.has(file) || depth > 12) return;
  seen.add(file);
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return; }

  // Strip line comments and block comments so commented-out fetches don't score.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const bare = [...code.matchAll(/(?<![.\w])fetch\s*\(/g)].length;
  const bounded = /leaflyFetchWithDeadline|fetchWithDeadline/.test(code);
  if (bare > 0) {
    findings.push({
      file: file.replace(ROOT + "/", ""),
      bareFetchCalls: bare,
      usesBoundedHelper: bounded,
      depth,
      via: path.slice(-3).map((p) => p.replace(ROOT + "/", "")),
    });
  }

  const specs = new Set();
  for (const m of code.matchAll(IMPORT_RE)) specs.add(m[1]);
  for (const m of code.matchAll(DYNIMPORT_RE)) specs.add(m[1]);
  for (const s of specs) {
    const r = resolveSpec(s, file);
    if (r) walk(r, depth + 1, [...path, file]);
  }
}

const entry = resolve(ROOT, process.argv[2]);
walk(entry, 0, [entry]);

console.log(`ENTRY: ${process.argv[2]}`);
console.log(`modules reached: ${seen.size}`);
console.log(`modules containing a bare fetch(): ${findings.length}`);
console.log("");
for (const f of findings.sort((a, b) => a.depth - b.depth)) {
  console.log(
    `  depth ${String(f.depth).padStart(2)}  ${f.usesBoundedHelper ? "BOUNDED " : "UNBOUNDED"}  x${f.bareFetchCalls}  ${f.file}`,
  );
  console.log(`            via ${f.via.join(" -> ")}`);
}
