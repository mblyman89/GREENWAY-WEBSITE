/**
 * D198i–D198l: ATM Settings page (daily fill amount) + loud ATM top-off banner on Deposit bags.
 *
 * Owner, verbatim: "it should be a simple settings page in atm page in the lyman drop down menu.
 * from there I should be able to set a daily fill amount so it always starts the day off with the
 * same amount. it should be loud on the deposit bag page that the atm needs x amount to be topped
 * off properly."
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runAtmDailyFillTests,
  atmTopOff,
  parseDailyFillDollars,
  pendingSinceReading,
  type PendingLoad,
} from "../../src/lib/registers/atm-daily-fill-core";
import { parseBagAtmPull } from "../../src/lib/registers/deposit-bag-atm-pull-core";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const NOW = "2026-11-07T15:00:00.000Z";
const minsAgo = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();

describe("D198i core: daily fill amount", () => {
  it("embedded self-tests all pass", () => {
    const r = __runAtmDailyFillTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(43);
  });

  it("accepts whole $20s with $ and commas, blank clears", () => {
    expect(parseDailyFillDollars("$4,000")).toEqual({ ok: true, cents: 400_000 });
    expect(parseDailyFillDollars("4000.00")).toEqual({ ok: true, cents: 400_000 });
    expect(parseDailyFillDollars("")).toEqual({ ok: true, cents: null });
  });

  it("refuses (never rounds) amounts that are not whole $20s, and out of range", () => {
    const r = parseDailyFillDollars("4010");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("$4,000.00");
      expect(r.error).toContain("$4,020.00");
      expect(r.error).toContain("Nothing was saved");
    }
    expect(parseDailyFillDollars("10").ok).toBe(false);
    expect(parseDailyFillDollars("100020").ok).toBe(false);
    expect(parseDailyFillDollars("abc").ok).toBe(false);
    expect(parseDailyFillDollars("-40").ok).toBe(false);
  });
});

describe("D198j/D198k: top-off banner", () => {
  const base = { fillToCents: 400_000, nowIso: NOW, maxTwentiesPerLoad: 200, terminalId: "T1" };

  it("says loudly how many $20s, rounded down", () => {
    const t = atmTopOff({ ...base, reading: { balanceCents: 123_000, capturedAt: minsAgo(5) }, pending: [] });
    expect(t.kind).toBe("needs");
    expect(t.tone).toBe("danger");
    expect(t.needTwenties).toBe(138); // 2,770 / 20 = 138.5 -> 138
    expect(t.headline).toContain("138 x $20");
    expect(t.headline).toContain("start the day at $4,000.00");
  });

  it("full, no reading, no target", () => {
    expect(atmTopOff({ ...base, reading: { balanceCents: 400_000, capturedAt: minsAgo(1) }, pending: [] }).kind).toBe("full");
    expect(atmTopOff({ ...base, reading: null, pending: [] }).kind).toBe("no_reading");
    expect(atmTopOff({ ...base, fillToCents: null, reading: null, pending: [] }).kind).toBe("no_target");
  });

  it("a stale reading is called out", () => {
    const t = atmTopOff({ ...base, reading: { balanceCents: 100_000, capturedAt: minsAgo(120) }, pending: [] });
    expect(t.stale).toBe(true);
    expect(t.headline).toContain("the reading is old");
  });

  it("$20s already taken since the reading count as loaded (no double top-off)", () => {
    const pending: PendingLoad[] = [
      { atIso: minsAgo(3), amountMinor: 200_000, kind: "bag_pull", who: "Ann" },
      { atIso: minsAgo(30), amountMinor: 99_999_00, kind: "till_drop", who: "Old" }, // before the reading: ignored
    ];
    const reading = { balanceCents: 200_000, capturedAt: minsAgo(10) };
    expect(pendingSinceReading(pending, reading.capturedAt, NOW).totalMinor).toBe(200_000);
    const t = atmTopOff({ ...base, reading, pending });
    expect(t.kind).toBe("full");
    expect(t.detail).toContain("Ann");
  });

  it("over one load's bill limit is flagged", () => {
    const t = atmTopOff({ ...base, maxTwentiesPerLoad: 50, reading: { balanceCents: 0, capturedAt: minsAgo(1) }, pending: [] });
    expect(t.overLoadCap).toBe(true);
    expect(t.detail).toContain("50 x $20");
  });

  it("the bag pull's OVER_NEED check uses the pending figure", () => {
    expect(typeof parseBagAtmPull).toBe("function");
    expect(read("src/lib/registers/deposit-bag-atm-pull-core.ts")).toContain("pendingSinceReadingMinor");
    expect(read("src/app/admin/registers/deposit-bags/actions.ts")).toContain("pendingSinceReadingMinor");
  });
});

describe("D198i wiring", () => {
  it("settings page and action are owner only (finances.view)", () => {
    const page = read("src/app/admin/atm/settings/page.tsx");
    const actions = read("src/app/admin/atm/settings/actions.ts");
    expect(page).toContain('requirePermission("finances.view")');
    expect(actions).toContain('requirePermission("finances.view")');
    expect(actions).toMatch(/^"use server";/m);
  });

  it("changes are audited, stale saves refused, other ATM settings kept", () => {
    const actions = read("src/app/admin/atm/settings/actions.ts");
    expect(read("src/lib/registers/atm-daily-fill-store.ts")).toContain('DAILY_FILL_AUDIT_ACTION = "atm.daily_fill_set"');
    expect(actions).toContain("action: DAILY_FILL_AUDIT_ACTION");
    expect(actions).toContain('formData.get("seen_cents")');
    expect(actions).toContain("...before, fillToCents: after");
    expect(read("src/app/admin/atm/settings/page.tsx")).toContain('name="seen_cents"');
  });

  it("ATM Settings is in the Lyman menu and linked from the ATM page", () => {
    const nav = read("src/components/admin/admin-nav-data.ts");
    expect(nav).toMatch(/label: "ATM Settings", href: "\/admin\/atm\/settings", permission: "finances.view"[^}]*group: "Lyman"/);
    expect(read("src/app/admin/atm/page.tsx")).toContain('href="/admin/atm/settings"');
  });

  it("one place to set it: ATM Drops carries the amount through unchanged", () => {
    const drops = read("src/app/admin/atm/drops/actions.ts");
    expect(drops).toContain("fillToCents: before.fillToCents");
    expect(drops).not.toContain('get("fill_to")');
    expect(read("src/app/admin/atm/drops/page.tsx")).not.toContain('name="fill_to"');
  });

  it("Deposit bags shows the loud banner from the shared core", () => {
    const page = read("src/app/admin/registers/deposit-bags/page.tsx");
    expect(page).toContain('data-testid="atm-top-off"');
    expect(page).toContain("atmTopOff(");
    expect(page).toContain("atmLoadsSince(");
    expect(read("src/app/admin/registers/deposit-bags/actions.ts")).toContain("atmTopOff(");
    expect(read("src/components/admin/registers/AtmCashCard.tsx")).toContain("needTone");
  });

  it("docs follow the standing rules", () => {
    const verbatim = read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md");
    expect(verbatim).toContain("recorded verbatim, D198i");
    expect(verbatim).toContain("set a daily fill amount so it always starts the day off with the same amount");
    const sop3 = read("docs/sop/SOP-03-eod-close-deposit.md");
    expect(sop3).toMatch(/\| \*\*Version\*\* \| 1\.12 /);
    expect(sop3).toContain("| 1.12 draft |");
    expect(sop3).toContain("ATM top-off");
    expect(read("docs/sop/SOP-02-master-till-safe.md")).toContain("D198i");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("D198i");
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("atm-daily-fill-core", __runAtmDailyFillTests(), 43)');
  });
});
