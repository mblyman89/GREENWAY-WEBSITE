import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  __runDrawerCloseSlipTests,
  buildDrawerCloseSlipHtml,
  countTableRows,
  drawerRef,
  parseCloseSlipInfo,
  parseViewedSessionId,
} from "../../src/lib/registers/drawer-close-slip-core";
import { validatePrintJob } from "../../src/lib/pos/star-printer-core";

/**
 * D151–D155 (owner, 2026-11-03): "I want it to print a short receipt with the
 * employee name and register number and other such important details so they
 * can leave it with the till for the second counter to know who's till they
 * are counting. The Second counter should have an option to see the numbers
 * they input after submitting their count. ... Read only."
 */
const root = path.resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const SHELL = read("src/app/(site)/pos/RegisterShell.tsx");
const TILL = read("src/app/api/pos/till/route.ts");
const ACTIONS = read("src/app/admin/registers/actions.ts");
const PAGE = read("src/app/admin/registers/page.tsx");
const HISTORY = read("src/app/admin/registers/history/[id]/page.tsx");
const TABLE = read("src/components/admin/registers/CountTableReadOnly.tsx");
const STORE = read("src/lib/registers/store.ts");
const CORE = read("src/lib/registers/drawer-close-slip-core.ts");

const INFO = {
  sessionId: "2385cd9e-0000-4000-8000-000000000001",
  registerName: "Sales Register 1",
  closedByName: "Jamie Cashier",
  openedByName: "Alex Opener",
  businessDay: "2026-11-03",
  openedAt: "2026-11-03T16:00:00.000Z",
  closedAt: "2026-11-04T05:04:00.000Z",
  deviceName: "Front iPad",
};

describe("D151–D153 drawer close slip (pure)", () => {
  it("self-tests pass", () => {
    const r = __runDrawerCloseSlipTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
  });

  it("shows whose till, which register, when, and the drawer ref", () => {
    const html = buildDrawerCloseSlipHtml(INFO);
    expect(html).toContain("DRAWER CLOSED &mdash; LEAVE WITH THE TILL");
    expect(html).toContain("Sales Register 1");
    expect(html).toContain("Jamie Cashier");
    expect(html).toContain("Alex Opener");
    expect(html).toContain("Tue, Nov 3, 2026");
    expect(html).toContain(drawerRef(INFO.sessionId));
    expect(html).toContain("Second counter:");
  });

  it("D153: never prints a money amount (the count stays blind)", () => {
    const html = buildDrawerCloseSlipHtml(INFO);
    expect(html).not.toMatch(/\$\s?\d/);
    expect(html).not.toMatch(/expected|variance|over\/short/i);
    // The slip info type has no money field at all.
    const parsed = parseCloseSlipInfo({ ...INFO, countedMinor: 41200, expectedMinor: 40000, tipsMinor: 900 });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!)).not.toContain("countedMinor");
    expect(Object.keys(parsed!)).not.toContain("expectedMinor");
    expect(Object.keys(parsed!)).not.toContain("tipsMinor");
  });

  it("D152: the printer refuses a close slip that would pop the drawer", () => {
    expect(validatePrintJob({ html: "<p>x</p>", openDrawer: true, jobKind: "drawer_close" })).not.toBeNull();
    expect(validatePrintJob({ html: "<p>x</p>", openDrawer: false, jobKind: "drawer_close" })).toBeNull();
  });

  it("is browser-safe (RegisterShell imports it)", () => {
    expect(CORE).not.toMatch(/from "next\//);
    expect(CORE).not.toMatch(/import "server-only"/);
    expect(CORE).not.toMatch(/from "node:/);
  });
});

describe("D151 till API returns the slip details, never amounts", () => {
  it("the close response carries closeSlip with who/which/when", () => {
    expect(TILL).toMatch(/let closeSlip: Record<string, string \| null> \| null = null;/);
    expect(TILL).toMatch(/registerName: reg\?\.name/);
    expect(TILL).toMatch(/closedByName: employee\.full_name/);
    expect(TILL).toMatch(/\.\.\.\(closeSlip \? \{ closeSlip \} : \{\}\)/);
  });

  it("the closeSlip block has no money in it", () => {
    const start = TILL.indexOf("let closeSlip");
    const end = TILL.indexOf("} catch {", start);
    const block = TILL.slice(start, end);
    expect(block).not.toMatch(/Minor|closing_count|expected|over_short|tips/i);
  });
});

describe("D152 the iPad prints the slip after a close", () => {
  it("TillModal hands the server's closeSlip back to the shell", () => {
    expect(SHELL).toMatch(/closeSlip\?: unknown;/);
    expect(SHELL).toMatch(/resBody\.closeSlip \?\? null,/);
  });

  it("the shell prints it with the drawer shut, and falls back to local details", () => {
    expect(SHELL).toMatch(/parseCloseSlipInfo\(closeSlipRaw\) \?\?\s*fallbackCloseSlipInfo\(/);
    expect(SHELL).toMatch(/printSlip\(buildDrawerCloseSlipHtml\(slip\), false, "drawer_close"\)/);
    expect(SHELL).toMatch(/Leave the printed drawer close slip with the till\./);
  });

  it("MORE can reprint the last close slip, never popping the drawer", () => {
    expect(SHELL).toMatch(/Reprint drawer close slip/);
    expect(SHELL).toMatch(/buildDrawerCloseSlipHtml\(lastCloseSlip, \{ reprint: true \}\), false, "drawer_close"/);
  });
});

describe("D154 the second counter can see the numbers they entered, read only", () => {
  it("the save redirect carries the drawer id", () => {
    expect(ACTIONS).toMatch(/second_session=\$\{encodeURIComponent\(sessionId\)\}/);
  });

  it("the store reads the saved second-count row and writes nothing", () => {
    const start = STORE.indexOf("export async function getSecondCountBreakdown");
    const end = STORE.indexOf("\n}\n", start);
    const fn = STORE.slice(start, end);
    expect(fn).toMatch(/\.from\("drawer_counts"\)/);
    expect(fn).toMatch(/\.eq\("count_type", "second"\)/);
    expect(fn).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  });

  it("the page shows 'See the numbers you entered' after saving and on saved cards", () => {
    expect(PAGE).toMatch(/parseViewedSessionId\(sp\.second_session\)/);
    expect(PAGE).toMatch(/See the numbers you entered/);
    expect(PAGE).toMatch(/function SecondCountSavedCard/);
    expect(PAGE).toMatch(/breakdown=\{breakdowns\.get\(a\.sessionId\) \?\? null\}/);
  });

  it("the read-only table has no inputs, forms or buttons", () => {
    expect(TABLE).not.toMatch(/<input|<form|<button|<Input|<Button|"use client"/);
    expect(TABLE).toMatch(/Read only\./);
  });

  it("the till summary shows the second count table too", () => {
    expect(HISTORY).toMatch(/getSecondCountBreakdown\(session\.id\)/);
    expect(HISTORY).toMatch(/history-second-count-table/);
  });

  it("table rows follow the count form, $100 down to 1¢", () => {
    const t = countTableRows({ hundreds: 1, ones: 3, pennies: 2 });
    expect(t.rows.map((r) => r.label)[0]).toBe("$100");
    expect(t.rows.at(-1)?.label).toBe("1¢");
    expect(t.totalMinor).toBe(10000 + 300 + 2);
  });

  it("only a real uuid is accepted from the URL", () => {
    expect(parseViewedSessionId(INFO.sessionId)).toBe(INFO.sessionId);
    expect(parseViewedSessionId("' or 1=1")).toBeNull();
  });
});
