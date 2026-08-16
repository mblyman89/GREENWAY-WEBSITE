/**
 * Guard tests for the packaged register build (Capacitor Phase 0.3).
 *
 * WHY THIS FILE EXISTS
 * register-app/ compiles src/app/pos/RegisterShell.tsx — the SAME file Next.js
 * serves at /pos — into a static bundle for the iPad app. That only works
 * because the register's entire import graph is framework-free: pure modules
 * under src/lib/**, plus React.
 *
 * Nothing stops a future edit from adding `import { headers } from "next/headers"`
 * to a file deep in that graph. The Next.js build would stay green. The iPad
 * build would break — or, far worse, would still build and then fail on a
 * customer, because a register that cannot reach the server cannot record a
 * sale, and an unrecorded sale is a traceability failure.
 *
 * These tests walk the real import graph on disk, so they fail the moment that
 * happens, in the pull request that caused it, with a message naming the file.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(REPO_ROOT, "src");
const ENTRY = path.join(SRC, "app", "pos", "RegisterShell.tsx");
const REGISTER_APP = path.join(REPO_ROOT, "register-app");

/** Resolve an import specifier the way Vite/Next would. */
function resolveImport(spec: string, fromFile: string): string | null | { missing: string } {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare package — reported separately

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return { missing: base };
}

type GraphReport = {
  files: string[];
  externals: string[];
  nextImports: string[];
  serverOnly: string[];
  nodeBuiltins: string[];
  unresolved: string[];
};

/** Walk the whole transitive import graph from the register entry. */
function walkRegisterGraph(): GraphReport {
  const seen = new Set<string>();
  const externals = new Set<string>();
  const nextImports: string[] = [];
  const serverOnly: string[] = [];
  const nodeBuiltins: string[] = [];
  const unresolved: string[] = [];

  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);

    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      return;
    }

    const rel = path.relative(REPO_ROOT, file);
    if (/^\s*import\s+["']server-only["']/m.test(src)) serverOnly.push(rel);

    const specs: string[] = [];
    for (const m of src.matchAll(/^\s*import\s+(?:type\s+)?[^;]*?from\s*["']([^"']+)["']/gm)) {
      specs.push(m[1]);
    }
    for (const m of src.matchAll(/^\s*export\s+(?:type\s+)?[^;]*?from\s*["']([^"']+)["']/gm)) {
      specs.push(m[1]);
    }
    for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);

    for (const spec of specs) {
      if (spec === "next" || spec.startsWith("next/")) {
        nextImports.push(`${rel} imports ${spec}`);
        continue;
      }
      if (spec.startsWith("node:")) {
        nodeBuiltins.push(`${rel} imports ${spec}`);
        continue;
      }
      const resolved = resolveImport(spec, file);
      if (resolved === null) {
        externals.add(spec);
        continue;
      }
      if (typeof resolved === "object") {
        unresolved.push(`${rel} imports ${spec}`);
        continue;
      }
      visit(resolved);
    }
  };

  visit(ENTRY);

  return {
    files: [...seen].map((f) => path.relative(REPO_ROOT, f)).sort(),
    externals: [...externals].sort(),
    nextImports,
    serverOnly,
    nodeBuiltins,
    unresolved,
  };
}

describe("packaged register build guards", () => {
  const graph = walkRegisterGraph();

  it("the register entry point exists where both builds expect it", () => {
    expect(existsSync(ENTRY)).toBe(true);
  });

  it("pulls in a real graph (the walker is not silently finding nothing)", () => {
    // If a refactor broke the walker, every other assertion here would pass
    // vacuously. Anchor it: the register is a large component with many pure
    // modules behind it.
    expect(graph.files.length).toBeGreaterThan(40);
    expect(graph.files).toContain("src/app/pos/RegisterShell.tsx");
    expect(graph.files).toContain("src/app/pos/SaleFlow.tsx");
    expect(graph.files).toContain("src/lib/pos/pos-fetch.ts");
  });

  it("contains NO next/* import anywhere", () => {
    expect(graph.nextImports).toEqual([]);
  });

  it("contains NO server-only module", () => {
    expect(graph.serverOnly).toEqual([]);
  });

  it("contains NO node builtin", () => {
    expect(graph.nodeBuiltins).toEqual([]);
  });

  it("has no unresolved imports", () => {
    expect(graph.unresolved).toEqual([]);
  });

  it("needs only react as an external package", () => {
    // Every extra package here has to be installed, licensed, security-reviewed
    // and shipped inside the app. Keeping this at one is deliberate.
    expect(graph.externals).toEqual(["react"]);
  });
});

describe("packaged register app files", () => {
  const read = (rel: string) => readFileSync(path.join(REGISTER_APP, rel), "utf8");

  it("has the four files the build needs", () => {
    for (const f of ["index.html", "vite.config.ts", "src/main.tsx", "src/register.css"]) {
      expect(existsSync(path.join(REGISTER_APP, f))).toBe(true);
    }
  });

  // A point-of-sale must not fetch code from anyone else's server. Beyond the
  // obvious supply-chain risk, a remote <script> in the shell would also be a
  // request the app makes on every launch, including offline.
  it("index.html loads NOTHING from a remote origin", () => {
    const html = read("index.html");
    const remote = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi) ?? [];
    expect(remote).toEqual([]);
    expect(html).not.toContain("//cdn.");
  });

  it("index.html mounts into #root, which main.tsx looks for", () => {
    expect(read("index.html")).toContain('id="root"');
    expect(read("src/main.tsx")).toContain('getElementById("root")');
  });

  // The viewport must match the Next /pos route: a pinch-zoom mid-sale leaves
  // the cashier looking at a magnified fragment of the till.
  it("index.html disables zoom the same way the /pos route does", () => {
    const html = read("index.html");
    expect(html).toContain("maximum-scale=1");
    expect(html).toContain("user-scalable=no");
    expect(html).toContain("width=device-width");
  });

  it("index.html carries the same theme colour as the /pos route", () => {
    const posPage = readFileSync(path.join(SRC, "app", "pos", "page.tsx"), "utf8");
    const themeColor = posPage.match(/themeColor:\s*["']([^"']+)["']/)?.[1];
    expect(themeColor).toBeTruthy();
    expect(read("index.html")).toContain(`content="${themeColor}"`);
  });

  it("mounts the SAME RegisterShell the website uses — never a copy", () => {
    const main = read("src/main.tsx");
    expect(main).toContain('from "@/app/pos/RegisterShell"');
    expect(main).toContain("resolveRegisterHostConfig");
    // It must honour the fatal path rather than booting a dead register.
    expect(main).toContain("config.ok");
  });

  it("the stylesheet uses the SHARED token file, not a copy", () => {
    const css = read("src/register.css");
    expect(css).toContain("../../src/app/pos-tokens.css");
    // Tailwind v4 only generates classes for files it is told to scan, and the
    // register's source lives outside this folder. Without these the app would
    // build cleanly and render as unstyled HTML.
    expect(css).toContain('@source "../../src/app/pos"');
    expect(css).toContain('@source "../../src/lib"');
  });

  it("does not keep its own copy of the register images", () => {
    // A second copy of the wordmark would drift the day it is updated: the
    // website would change and the iPads would keep the old one.
    expect(existsSync(path.join(REGISTER_APP, "public"))).toBe(false);
    expect(read("vite.config.ts")).toContain("publicDir: false");
  });

  it("bakes the server address in at build time from REGISTER_API_BASE", () => {
    const cfg = read("vite.config.ts");
    expect(cfg).toContain("REGISTER_API_BASE");
    expect(cfg).toContain("__REGISTER_API_BASE__");
  });
});
