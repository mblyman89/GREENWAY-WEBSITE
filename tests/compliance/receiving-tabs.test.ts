/**
 * tests/compliance/receiving-tabs.test.ts
 *
 * Slice H15d — the Receiving page's two-tab resolution logic.
 *
 * The stakes: every manual-form server action redirects failures to
 * `/admin/inventory/intake?error=<code>` WITHOUT a tab param. If the page
 * defaulted to the email hero tab on those redirects, the error banner and
 * the form the user was mid-way through would vanish behind the other tab.
 * These tests pin the auto-selection contract and keep MANUAL_ERROR_CODES
 * in lockstep with the errorMsg mapping in intake/page.tsx.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveReceivingTab,
  MANUAL_ERROR_CODES,
  RECEIVING_TABS,
} from "@/lib/inventory/receiving-tabs-core";

describe("H15d — resolveReceivingTab", () => {
  it("defaults to the email hero tab with no params", () => {
    expect(resolveReceivingTab({})).toBe("email");
  });

  it("honors an explicit ?tab=manual", () => {
    expect(resolveReceivingTab({ tab: "manual" })).toBe("manual");
  });

  it("honors an explicit ?tab=email", () => {
    expect(resolveReceivingTab({ tab: "email" })).toBe("email");
  });

  it("explicit ?tab= wins over an error code (user clicked a tab)", () => {
    expect(resolveReceivingTab({ tab: "email", error: "parse" })).toBe("email");
    expect(resolveReceivingTab({ tab: "manual", error: "parse" })).toBe("manual");
  });

  it("auto-opens Manual tools for every manual-form error code", () => {
    for (const code of MANUAL_ERROR_CODES) {
      expect(resolveReceivingTab({ error: code }), `error=${code}`).toBe("manual");
    }
  });

  it("auto-opens Manual tools when the KB backfill result banner is present", () => {
    expect(resolveReceivingTab({ kbdone: "12" })).toBe("manual");
  });

  it("falls back to the email tab for unknown ?tab= or ?error= values", () => {
    expect(resolveReceivingTab({ tab: "bogus" })).toBe("email");
    expect(resolveReceivingTab({ error: "not-a-real-code" })).toBe("email");
  });
});

describe("H15d — MANUAL_ERROR_CODES stays in sync with the page's redirects", () => {
  // Every error code the page.tsx errorMsg mapping renders a banner for must
  // auto-open Manual tools, and vice versa — read the actual source so a new
  // code added in one place without the other fails loudly here.
  const pageSrc = readFileSync(
    join(process.cwd(), "src/app/admin/inventory/intake/page.tsx"),
    "utf8",
  );
  const actionsSrc = readFileSync(
    join(process.cwd(), "src/app/admin/inventory/intake/actions.ts"),
    "utf8",
  );

  it("every code in the page's errorMsg mapping is a manual code", () => {
    const codes = [...pageSrc.matchAll(/error === "([a-z]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(13);
    for (const code of codes) {
      expect(MANUAL_ERROR_CODES.has(code), `page errorMsg code "${code}"`).toBe(true);
    }
  });

  it("every ?error= redirect in actions.ts is a manual code", () => {
    const codes = [
      ...actionsSrc.matchAll(/\/admin\/inventory\/intake\?error=([a-z]+)/g),
    ].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(MANUAL_ERROR_CODES.has(code), `actions.ts redirect code "${code}"`).toBe(true);
    }
  });
});

describe("H15d — RECEIVING_TABS metadata", () => {
  it("email is first (the hero) and manual second; hrefs stay on the one route", () => {
    expect(RECEIVING_TABS.map((t) => t.key)).toEqual(["email", "manual"]);
    for (const t of RECEIVING_TABS) {
      expect(t.href.startsWith("/admin/inventory/intake?tab=")).toBe(true);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});
