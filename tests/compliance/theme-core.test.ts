/**
 * POS Slice B44 — vitest mirror for the per-device display-mode core.
 *
 * Runs the full self-test suite, then pins the behaviors the register shell
 * depends on: corruption ALWAYS degrades to dark (a bad localStorage blob
 * can never break the register), the toggle is a strict two-state flip, and
 * the button names the mode you'd switch TO.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  POS_THEMES,
  THEME_KEY,
  __runThemeCoreTests,
  parseTheme,
  themeToggleLabel,
  toggleTheme,
} from "@/lib/pos/theme-core";

describe("theme-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runThemeCoreTests()).not.toThrow();
  });
});

describe("theme-core pins", () => {
  it("uses a stable per-device localStorage key and defaults dark", () => {
    expect(THEME_KEY).toBe("gw-pos-theme");
    expect(DEFAULT_THEME).toBe("dark");
    expect(POS_THEMES).toEqual(["dark", "light"]);
  });

  it("corruption always degrades to dark, never throws", () => {
    for (const garbage of [null, undefined, "", "sepia", "LIGHT", 1, [], {}, true]) {
      expect(parseTheme(garbage)).toBe("dark");
    }
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("toggle is a strict two-state flip that round-trips", () => {
    expect(toggleTheme("dark")).toBe("light");
    expect(toggleTheme("light")).toBe("dark");
    expect(toggleTheme(toggleTheme("light"))).toBe("light");
  });

  it("the button names the DESTINATION mode", () => {
    expect(themeToggleLabel("dark")).toBe("Light mode");
    expect(themeToggleLabel("light")).toBe("Dark mode");
  });
});
