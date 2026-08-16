/**
 * pos-tokens.css guard (Capacitor Phase 0, slice 0.1).
 *
 * The register runs in two places: the browser PWA at /pos (Next.js) and the
 * packaged iPad app (Vite). Both mount the SAME components, so both must
 * resolve the SAME --pos-* values. These tests protect that arrangement:
 *
 *   1. Every --pos-* token a register screen USES must actually be DEFINED.
 *      An undefined token silently falls back (or renders unstyled), which is
 *      exactly the kind of bug nobody notices until it is on a counter iPad.
 *   2. The light register theme must re-tint every token the dark theme sets,
 *      or a bright-room register inherits a dark-theme color.
 *   3. globals.css must keep importing the shared file and must NOT re-declare
 *      the tokens itself (that is how two copies drift apart).
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TOKENS_CSS = fs.readFileSync(path.join(ROOT, "src/app/pos-tokens.css"), "utf8");
const GLOBALS_CSS = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

const REGISTER_FILES = [
  "src/app/pos/RegisterShell.tsx",
  "src/app/pos/SaleFlow.tsx",
];

/** Names declared in a given CSS block, e.g. "--pos-surface". */
function declaredIn(css: string): Set<string> {
  const names = new Set<string>();
  for (const m of css.matchAll(/(--pos-[a-z0-9-]+)\s*:/g)) names.add(m[1]);
  return names;
}

/** Extract the body of the first block matching a selector. */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

const DARK = declaredIn(block(TOKENS_CSS, ":root"));
const LIGHT = declaredIn(block(TOKENS_CSS, 'html[data-pos-theme="light"]'));
const ALL_DECLARED = declaredIn(TOKENS_CSS);

describe("pos-tokens.css — single source of truth", () => {
  it("defines a meaningful number of tokens", () => {
    expect(DARK.size).toBeGreaterThan(40);
  });

  it("is imported by globals.css", () => {
    expect(GLOBALS_CSS).toContain('@import "./pos-tokens.css"');
  });

  it("is the ONLY place --pos-* tokens are declared", () => {
    // globals.css may reference tokens, but must not re-declare them.
    const reDeclared = [...declaredIn(GLOBALS_CSS)];
    expect(reDeclared).toEqual([]);
  });

  it("declares the .pos-shell and .pos-tile rules the register depends on", () => {
    expect(TOKENS_CSS).toContain(".pos-shell");
    expect(TOKENS_CSS).toContain(".pos-tile");
  });

  it("is self-contained: brand values it builds on are declared here too", () => {
    // The packaged app never loads the website stylesheet.
    for (const dep of ["--greenway", "--gold", "--orange", "--admin-shadow"]) {
      expect(TOKENS_CSS).toContain(`${dep}:`);
    }
  });
});

describe("every --pos-* token the register uses is defined", () => {
  const used = new Set<string>();
  for (const rel of REGISTER_FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of src.matchAll(/(--pos-[a-z0-9-]+)/g)) used.add(m[1]);
  }

  it("finds tokens in use (sanity: the scan works)", () => {
    expect(used.size).toBeGreaterThan(20);
  });

  it.each([...used].sort())("%s is defined", (token) => {
    expect(ALL_DECLARED.has(token)).toBe(true);
  });

  it("uses no token with an inline CSS fallback", () => {
    // var(--x, #fallback) hides a missing token and freezes one theme's color
    // into both themes. If a value is needed, it belongs in pos-tokens.css.
    for (const rel of REGISTER_FILES) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const withFallback = [...src.matchAll(/var\(\s*--pos-[a-z0-9-]+\s*,[^)]*\)/g)].map(
        (m) => m[0],
      );
      expect(withFallback).toEqual([]);
    }
  });
});

describe("light register theme re-tints the dark theme", () => {
  // Tokens that are intentionally identical in both themes.
  const SHARED_BY_DESIGN = new Set([
    "--pos-chrome-ink", // white ink on chrome in both themes
    "--pos-info-solid", // same blue reads on white and on charcoal
  ]);

  const missing = [...DARK].filter(
    (t) => !LIGHT.has(t) && !SHARED_BY_DESIGN.has(t),
  );

  it("overrides every dark token (or names it shared by design)", () => {
    expect(missing).toEqual([]);
  });

  it("does not introduce light-only tokens the dark theme lacks", () => {
    const extra = [...LIGHT].filter((t) => !DARK.has(t));
    expect(extra).toEqual([]);
  });
});
