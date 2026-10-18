/**
 * tests/compliance/server-calls-client-export.test.ts   (R73 fix)
 *
 * A SERVER FILE MAY ONLY IMPORT COMPONENTS (and types) FROM A "use client" FILE.
 *
 * Why: on the server, every export of a "use client" file is a stand-in
 * reference, not the real value. Rendering <Thing /> is fine. Reading or
 * calling anything else (STUDIO_TAB_IDS.find(...), payDateLine(...)) throws
 * "Cannot access X.find on the server" and the whole page dies with
 * "This page hit a snag". That broke /admin/merch-studio on every device.
 * tsc, eslint and the rest of the suite all passed, because none of them know
 * about the client boundary. This test does: it flags any non-component name
 * (anything not starting with a capital letter followed by a lowercase one)
 * that a server file imports from a "use client" file.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const isClient = (s: string) => /^\s*["']use client["']/m.test(s.slice(0, 800));
const noExt = (p: string) => p.replace(/\.(ts|tsx)$/, "");

function resolve(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return path.join(SRC, spec.slice(2));
  if (spec.startsWith(".")) return path.resolve(path.dirname(fromFile), spec);
  return null;
}

describe("server files never use a non-component export of a \"use client\" file", () => {
  it("finds no offenders", () => {
    const files = walk(SRC);
    const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
    const clientFiles = new Set(files.filter((f) => isClient(text.get(f)!)).map(noExt));
    const offenders: string[] = [];
    for (const f of files) {
      const s = text.get(f)!;
      if (isClient(s)) continue;
      for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        if (/^\s*import\s+type\b/.test(m[0])) continue;
        const target = resolve(f, m[2]);
        if (!target) continue;
        const key = noExt(target);
        const hit = clientFiles.has(key) ? key : clientFiles.has(path.join(key, "index")) ? path.join(key, "index") : null;
        if (!hit) continue;
        for (const raw of m[1].split(",")) {
          const n = raw.trim();
          if (!n || n.startsWith("type ")) continue;
          const name = n.split(/\s+as\s+/)[0].trim();
          if (/^[A-Z][a-z]/.test(name)) continue; // a component - fine to render
          offenders.push(`${path.relative(ROOT, f)} imports "${name}" from ${m[2]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the Merch Studio page reads its tab list from the plain module", () => {
    const page = readFileSync(path.join(SRC, "app/admin/merch-studio/page.tsx"), "utf8");
    expect(page).toContain('from "@/lib/merch-studio/studio-tabs-core"');
    expect(page).not.toMatch(/STUDIO_TAB_IDS[^\n]*from "@\/components\/admin\/merch-studio\/MerchStudio"/);
  });
});
