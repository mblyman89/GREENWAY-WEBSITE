/**
 * pos-theme-contrast.test.ts
 *
 * Reads the REAL src/app/pos-tokens.css and proves the register's text/surface
 * pairs are readable in BOTH themes. This exists because a live browser audit
 * of the packaged register found three light-mode failures that no test could
 * have caught: the primary green under white ink at 4.35:1, the "Online" chip
 * at 3.57:1, and the helper text under every button at 2.69:1 — plus the
 * brand wordmark rendering white-on-near-white, i.e. invisible.
 *
 * The point of this file is that those fixes cannot silently rot. If someone
 * re-tints a token for looks, this test re-does the arithmetic against the
 * actual file on disk and fails with the measured number.
 *
 * WHAT THIS DOES NOT DO
 * It does not render anything. It cannot see layout, spacing, or whether a
 * screen is attractive. It checks the pairs that are declared in the token
 * file and known to be used together. A human still has to look.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  __runThemeContrastCoreTests,
  contrastOf,
  meetsAA,
  parseTokenBlock,
} from "@/lib/pos/theme-contrast-core";

const ROOT = process.cwd();
const TOKENS_PATH = path.join(ROOT, "src/app/pos-tokens.css");
const css = fs.readFileSync(TOKENS_PATH, "utf8");

/** Pull the body of a top-level block by its selector. */
function blockBody(selector: string): string {
  const idx = css.indexOf(selector);
  expect(idx, `selector ${selector} not found in pos-tokens.css`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  expect(open, `no opening brace after ${selector}`).toBeGreaterThan(-1);
  expect(close, `no closing brace after ${selector}`).toBeGreaterThan(open);
  return css.slice(open + 1, close);
}

const DARK = parseTokenBlock(blockBody(":root"));
const LIGHT = parseTokenBlock(blockBody('html[data-pos-theme="light"]'));

/** Resolve a token to a literal color, following ONE level of var() aliasing. */
function resolve(tokens: Record<string, string>, name: string): string | undefined {
  const raw = tokens[name];
  if (raw === undefined) return undefined;
  const m = raw.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (!m) return raw;
  // Brand aliases (--greenway etc.) are declared in the :root block.
  return DARK[m[1]] ?? tokens[m[1]];
}

/**
 * Text/background pairs the register actually paints, per theme.
 * Each entry: [text token, opaque background token, human label].
 * Backgrounds must be OPAQUE — the core refuses translucent backdrops rather
 * than inventing a page color, which is the behavior we want here.
 */
const PAIRS: Array<[string, string, string]> = [
  ["--pos-text", "--pos-canvas", "body text on the canvas"],
  ["--pos-text", "--pos-surface", "body text on a card"],
  ["--pos-text", "--pos-surface-2", "body text on a raised card"],
  ["--pos-text", "--pos-surface-hover", "body text on a pressed row"],
  ["--pos-text-muted", "--pos-canvas", "muted text on the canvas"],
  ["--pos-text-muted", "--pos-surface", "muted text on a card"],
  ["--pos-text-muted", "--pos-surface-2", "muted text on a raised card"],
  ["--pos-text-faint", "--pos-canvas", "helper text on the canvas"],
  ["--pos-text-faint", "--pos-surface", "helper text on a card"],
  ["--pos-text-faint", "--pos-surface-2", "helper text on a raised card"],
  ["--pos-accent-ink", "--pos-accent", "ink on the primary button (GO, Start sale)"],
  ["--pos-gold-ink", "--pos-gold", "ink on a gold fill"],
  ["--pos-chrome-ink", "--pos-chrome", "ink on the top bar"],
  ["--pos-chrome-muted", "--pos-chrome", "muted ink on the top bar"],
  ["--pos-accent", "--pos-surface", "accent text on a card"],
  ["--pos-danger", "--pos-surface", "error text on a card"],
  ["--pos-warn", "--pos-surface", "warning text on a card"],
  ["--pos-info", "--pos-surface", "info text on a card"],
  ["--pos-ok", "--pos-surface", "ok text on a card"],
];

/** Category chip text, which the light theme had to re-tint wholesale. */
const CATEGORY_TEXT = [
  "--pos-cat-fuchsia",
  "--pos-cat-rose",
  "--pos-cat-teal",
  "--pos-cat-indigo",
  "--pos-cat-orange",
];

describe("pos theme contrast core", () => {
  it("passes its own pure self-tests", () => {
    const r = __runThemeContrastCoreTests();
    console.log(`theme-contrast-core self-tests: ${r.passed} passed`);
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(40);
  });
});

for (const [themeName, tokens] of [
  ["dark", DARK],
  ["light", LIGHT],
] as const) {
  describe(`${themeName} register theme is readable`, () => {
    it("declares the tokens this audit depends on", () => {
      // Guard against a token being RENAMED and this whole file quietly
      // passing because every lookup returned undefined.
      const required =
        themeName === "dark"
          ? ["--pos-text", "--pos-text-faint", "--pos-accent", "--pos-canvas"]
          : ["--pos-text", "--pos-text-faint", "--pos-accent", "--pos-canvas"];
      for (const t of required) {
        expect(resolve(tokens, t), `${themeName} is missing ${t}`).toBeDefined();
      }
    });

    for (const [fgName, bgName, label] of PAIRS) {
      it(`${label} meets WCAG AA (4.5:1)`, () => {
        const fg = resolve(tokens, fgName);
        const bg = resolve(tokens, bgName);
        if (fg === undefined || bg === undefined) {
          // A pair that does not exist in this theme is not a failure, but a
          // pair that exists and cannot be PARSED is — see the next check.
          return;
        }
        const ratio = contrastOf(fg, bg);
        expect(ratio, `could not measure ${fgName} (${fg}) on ${bgName} (${bg})`).not.toBeNull();
        expect(
          meetsAA(ratio as number),
          `${label}: ${fgName} (${fg}) on ${bgName} (${bg}) = ${(ratio as number).toFixed(2)}:1, needs 4.5:1`,
        ).toBe(true);
      });
    }

    for (const catName of CATEGORY_TEXT) {
      it(`${catName} chip text meets WCAG AA on a card`, () => {
        const fg = resolve(tokens, catName);
        const bg = resolve(tokens, "--pos-surface");
        if (fg === undefined || bg === undefined) return;
        const ratio = contrastOf(fg, bg);
        expect(ratio, `could not measure ${catName} (${fg})`).not.toBeNull();
        expect(
          meetsAA(ratio as number),
          `${catName} (${fg}) on --pos-surface (${bg}) = ${(ratio as number).toFixed(2)}:1, needs 4.5:1`,
        ).toBe(true);
      });
    }
  });
}

describe("the brand wordmark is visible in both themes", () => {
  // The shipped /pos/wordmark.png is a WHITE transparent PNG. On the dark
  // canvas that is correct; on the light canvas it is invisible (1.32:1).
  // Light mode therefore MUST define a recolor filter, and the register must
  // apply it — on every wordmark that is NOT sitting on the navy top bar.
  it("light mode defines a wordmark recolor filter", () => {
    const filter = LIGHT["--pos-wordmark-filter"];
    expect(filter, "light theme must define --pos-wordmark-filter").toBeDefined();
    expect(filter).not.toBe("none");
    expect(filter).toMatch(/brightness\(\s*0\s*\)/);
  });

  it("dark mode leaves the white wordmark alone", () => {
    expect(DARK["--pos-wordmark-filter"]).toBe("none");
  });

  it("declares the .pos-wordmark rule that applies the filter", () => {
    expect(css).toMatch(/\.pos-wordmark\s*\{[^}]*filter:\s*var\(--pos-wordmark-filter\)/);
  });

  it("declares the .pos-wordmark-on-chrome opt-out", () => {
    expect(css).toMatch(/\.pos-wordmark-on-chrome\s*\{[^}]*filter:\s*none/);
  });

  it("every register wordmark is classed either .pos-wordmark or .pos-wordmark-on-chrome", () => {
    const shell = fs.readFileSync(path.join(ROOT, "src/app/pos/RegisterShell.tsx"), "utf8");
    const imgs = [...shell.matchAll(/<img[^>]*wordmark\.png[^>]*>/g)].map((m) => m[0]);
    expect(imgs.length, "expected the register to render the wordmark").toBeGreaterThan(0);
    for (const tag of imgs) {
      expect(
        /pos-wordmark(-on-chrome)?[\s"]/.test(tag),
        `wordmark <img> is missing the theme class: ${tag.slice(0, 120)}`,
      ).toBe(true);
    }
  });

  it("the top-bar wordmark opts OUT (navy chrome in both themes)", () => {
    const shell = fs.readFileSync(path.join(ROOT, "src/app/pos/RegisterShell.tsx"), "utf8");
    const onChrome = [...shell.matchAll(/<img[^>]*pos-wordmark-on-chrome[^>]*>/g)];
    expect(onChrome.length, "exactly one wordmark sits on the navy top bar").toBe(1);
  });
});

describe("the register uses no dark-tuned hardcoded text colors", () => {
  // Tailwind's -300/-400 shades are tuned for a dark canvas and go illegible
  // on the light theme's white cards. Every one of them belongs on a token.
  const FILES = ["src/app/pos/RegisterShell.tsx", "src/app/pos/SaleFlow.tsx"];

  for (const rel of FILES) {
    it(`${rel} has no text-<color>-300/400 utilities`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      const hits = [...src.matchAll(/\btext-(?:red|amber|yellow|emerald|green|sky|blue|purple|fuchsia|rose|teal|indigo|orange|neutral|gray|slate)-(?:200|300|400)\b/g)].map(
        (m) => m[0],
      );
      expect(hits, `move these onto --pos-* tokens: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
