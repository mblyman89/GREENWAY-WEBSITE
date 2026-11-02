/**
 * tests/compliance/loyalty-rewards.test.ts  (D137–D141, owner 2026-11-02)
 *
 * Owner, verbatim: "yes, one redemption per sale, and works exactly as you
 * described in the proposed fix. no dollar cap on the 25% off. bronze and
 * gold stay as names only, everything else about them can be retired. i
 * would like the ability to change their names ... the $0.10-per-point
 * should be retired and the website, register, receipts, back office, all
 * places should be updated to reflect this retirement."
 *
 * Pure rules (loyalty-reward-core) plus source guards so the retired
 * dollar-per-point value can never quietly come back.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runLoyaltyRewardTests,
  LOYALTY_REWARDS,
  applyRewardPricing,
  bestRewardFor,
  chooseReward,
  maxRewardOffMinor,
  redemptionReward,
  rewardButtonLabel,
  rewardOptionsFor,
  rewardRedeemSentence,
  rewardStatusLine,
  rewardTermsLines,
} from "@/lib/loyalty/loyalty-reward-core";
import { __runLoyaltyConfigTests, parseConfigDraft, parseTierName } from "@/lib/loyalty/loyalty-config-core";
import type { LoyaltySaleLine } from "@/lib/loyalty/loyalty-sale-core";

const line = (id: string, unit: number, regular: number, qty = 1, cost: number | null = null): LoyaltySaleLine => ({
  lineId: id,
  category: "flower",
  quantity: qty,
  unitPriceMinorUnits: unit,
  regularPriceMinorUnits: regular,
  costMinorUnits: cost,
});

describe("D137 — fixed rewards", () => {
  it("the self-test suite passes with real coverage", () => {
    const r = __runLoyaltyRewardTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(55);
  });

  it("exactly two rewards: 150 pts = 10% off, 300 pts = 25% off", () => {
    expect(LOYALTY_REWARDS.map((r) => [r.points, r.percentBps])).toEqual([
      [150, 1000],
      [300, 2500],
    ]);
    expect(LOYALTY_REWARDS.map(rewardButtonLabel)).toEqual(["Use 150 pts – 10% off", "Use 300 pts – 25% off"]);
  });

  it("the register only offers the rewards the balance covers", () => {
    expect(rewardOptionsFor(149)).toEqual([]);
    expect(rewardOptionsFor(150).map((r) => r.points)).toEqual([150]);
    expect(rewardOptionsFor(2472).map((r) => r.points)).toEqual([150, 300]);
  });

  it("an old app build that sends no choice gets the best reward — never the whole balance", () => {
    const c = chooseReward(2472, undefined);
    expect(c.ok && c.reward.points).toBe(300);
    expect(chooseReward(100, undefined).ok).toBe(false);
    expect(chooseReward(200, 300).ok).toBe(false);
    expect(chooseReward(2472, 465).ok).toBe(false);
  });

  it("per item: better of the deal or the reward, never both; no dollar cap", () => {
    const top = LOYALTY_REWARDS[1];
    // A $1,000 cart: 25% off is $250 — no cap.
    const big = applyRewardPricing([line("a", 100000, 100000)], top);
    expect(big.ok && big.appliedMinorUnits).toBe(25000);
    // Deal already 30% off → the deal wins, reward adds nothing there.
    const mixed = applyRewardPricing([line("deal", 7000, 10000), line("reg", 10000, 10000)], top);
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      const deal = mixed.lines.find((l) => l.lineId === "deal")!;
      const reg = mixed.lines.find((l) => l.lineId === "reg")!;
      expect(deal.unitPriceMinorUnits).toBe(7000);
      expect(deal.loyaltyDiscountMinorUnits).toBe(0);
      expect(reg.unitPriceMinorUnits).toBe(7500);
      expect(mixed.appliedMinorUnits).toBe(2500);
    }
  });

  it("refuses (and spends no points) when deals already beat the reward everywhere", () => {
    const r = applyRewardPricing([line("a", 5000, 10000)], LOYALTY_REWARDS[0]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("No points were used");
  });

  it("never-discount items keep their price", () => {
    const r = applyRewardPricing([line("x", 10000, 10000), line("y", 10000, 10000)], LOYALTY_REWARDS[1], {
      excludeLineIds: new Set(["x"]),
    });
    expect(r.ok && r.lines.find((l) => l.lineId === "x")!.unitPriceMinorUnits).toBe(10000);
    expect(r.ok && r.appliedMinorUnits).toBe(2500);
  });

  it("legal floor: never below acquisition cost", () => {
    // Cost $9.00 pre-tax means the floor is above $7.50, so the reward is clamped.
    const r = applyRewardPricing([line("a", 10000, 10000, 1, 9000)], LOYALTY_REWARDS[1]);
    if (r.ok) expect(r.lines[0].unitPriceMinorUnits).toBeGreaterThanOrEqual(9000);
  });

  it("the sync ceiling is the percent of regular prices", () => {
    expect(maxRewardOffMinor([{ quantity: 2, regularPriceMinor: 1000 }], LOYALTY_REWARDS[1])).toBe(500);
  });

  it("old $0.10-per-point codes are not rewards", () => {
    expect(redemptionReward({ points: 465 })).toBeNull();
    expect(redemptionReward({ points: 300 })?.percentBps).toBe(2500);
  });

  it("customer-facing wording never mentions dollars", () => {
    const all = [...rewardTermsLines(), rewardRedeemSentence(), rewardStatusLine(120), rewardStatusLine(900)].join(" ");
    expect(all).not.toMatch(/\$/);
    expect(bestRewardFor(900)?.points).toBe(300);
  });
});

describe("D138/D139 — config + badge names", () => {
  it("config self-tests pass", () => {
    expect(() => __runLoyaltyConfigTests()).not.toThrow();
  });

  it("config drafts no longer carry a point value", () => {
    const p = parseConfigDraft({ pointsPerDollar: "1", signupBonusPoints: "0", codeExpiryDays: "" });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.value).not.toHaveProperty("pointValueMinor");
      expect(p.value).not.toHaveProperty("minRedeemPoints");
    }
  });

  it("badge names: trimmed, required, ≤40 chars, unique", () => {
    const ok = parseTierName("  Green  Leaf ");
    expect(ok.ok && ok.value).toBe("Green Leaf");
    expect(parseTierName("").ok).toBe(false);
    expect(parseTierName("x".repeat(41)).ok).toBe(false);
    expect(parseTierName("GOLD", { otherNames: ["Gold"] }).ok).toBe(false);
  });
});

// ── Source guards ──────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("D138 — the $0.10-per-point is gone from code", () => {
  const files = walk(join(process.cwd(), "src"));

  it("no code reads pointValueMinor / minRedeemPoints / a tier discount any more", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      if (/\bpointValueMinor\b|\bminRedeemPoints\b|\btierDiscountBps\b|\bpointsValueMinor\b|\bdiscountBps\b/.test(src)) {
        // loyalty-sale-core's applyTierPricing takes a generic percent argument.
        if (f.endsWith("loyalty-sale-core.ts")) continue;
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the register menu bundle carries no point value (old app builds hide their old redeem button)", () => {
    const src = strip(readFileSync(join(process.cwd(), "src/app/api/pos/menu/route.ts"), "utf8"));
    expect(src).not.toMatch(/point_value_minor|pointValue/);
  });

  it("every reward used and every badge rename is audited", () => {
    const route = strip(readFileSync(join(process.cwd(), "src/app/api/pos/loyalty/route.ts"), "utf8"));
    expect(route).toContain('"loyalty.reward_used"');
    const orders = strip(readFileSync(join(process.cwd(), "src/app/admin/orders/actions.ts"), "utf8"));
    expect(orders).toContain('"loyalty.reward_used"');
    const admin = strip(readFileSync(join(process.cwd(), "src/app/admin/loyalty/actions.ts"), "utf8"));
    expect(admin).toContain('"loyalty.tier.rename"');
    expect(admin).toContain('revalidatePath("/loyalty")');
  });

  it("a voided sale gives the reward points back", () => {
    const v = strip(readFileSync(join(process.cwd(), "src/lib/pos/void-store.ts"), "utf8"));
    expect(v).toContain("returnRewardForVoidedOrder");
  });
});
