/**
 * POS Slice B44 — light/dark mode per device (pure core).
 *
 * Toast lets each terminal pick its own display mode: a register facing a
 * bright front window runs light, the one in the corner runs dark. The
 * choice is PER DEVICE (localStorage, like favorites/held-sale) — it never
 * touches the server, works offline, and survives restarts.
 *
 * How the flip works (verified against this codebase, not guessed):
 *  - Every POS surface reads `--pos-*` design tokens (globals.css, B35/B38),
 *    and B44 moved the last hard-coded status colors (amber warnings, red
 *    errors, sky info, emerald ok) onto semantic tokens too.
 *  - RegisterShell sets `data-pos-theme` on <html>; a single
 *    `html[data-pos-theme="light"]` block in globals.css overrides the
 *    tokens, so ONE attribute flips the whole register.
 *
 * Pure: no I/O, no React. Self-tested below (registered in
 * scripts/compliance/run-pure-selftests.ts) and mirrored in vitest.
 */

/** localStorage key (per device, like gw-pos-favorites). */
export const THEME_KEY = "gw-pos-theme";

export const POS_THEMES = ["dark", "light"] as const;
export type PosTheme = (typeof POS_THEMES)[number];

/**
 * Light is the default (Task AO): the owner approved a Dutchie-style light
 * register design — white/light canvas, navy chrome, green accents. Dark
 * remains available as the per-device toggle for dim rooms. Devices that
 * previously CHOSE dark keep it (their stored "dark" still parses).
 */
export const DEFAULT_THEME: PosTheme = "light";

/**
 * Parse a stored/untrusted value into a theme. Anything unexpected (null,
 * corruption, a value from a future version) degrades to the default —
 * a bad blob can never break the register.
 */
export function parseTheme(raw: unknown): PosTheme {
  return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME;
}

export function toggleTheme(theme: PosTheme): PosTheme {
  return theme === "dark" ? "light" : "dark";
}

/** Button label: names the mode you'd SWITCH TO (standard toggle wording). */
export function themeToggleLabel(theme: PosTheme): string {
  return theme === "dark" ? "Light mode" : "Dark mode";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runThemeCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  ok(THEME_KEY === "gw-pos-theme", "stable localStorage key");
  ok(DEFAULT_THEME === "light", "light is the default (Task AO approved design)");

  // parseTheme — valid values pass through (a device that CHOSE dark keeps it).
  ok(parseTheme("dark") === "dark", "parse dark");
  ok(parseTheme("light") === "light", "parse light");
  // parseTheme — everything else degrades to the default, never throws.
  ok(parseTheme(null) === "light", "null degrades to default");
  ok(parseTheme(undefined) === "light", "undefined degrades to default");
  ok(parseTheme("") === "light", "empty string degrades to default");
  ok(parseTheme("LIGHT") === "light", "case-sensitive (stored by us, so exact)");
  ok(parseTheme("sepia") === "light", "unknown mode degrades to default");
  ok(parseTheme(42) === "light", "number degrades to default");
  ok(parseTheme({ theme: "light" }) === "light", "object degrades to default");

  // toggleTheme — a strict two-state flip.
  ok(toggleTheme("dark") === "light", "dark toggles to light");
  ok(toggleTheme("light") === "dark", "light toggles to dark");
  ok(toggleTheme(toggleTheme("dark")) === "dark", "double toggle round-trips");

  // themeToggleLabel — names the DESTINATION mode.
  ok(themeToggleLabel("dark") === "Light mode", "dark register offers Light mode");
  ok(themeToggleLabel("light") === "Dark mode", "light register offers Dark mode");

  console.log(`theme-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`theme-core self-tests failed: ${failures.join("; ")}`);
  }
}
