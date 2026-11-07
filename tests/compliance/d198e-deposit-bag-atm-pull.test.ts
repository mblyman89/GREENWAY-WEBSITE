/**
 * tests/compliance/d198e-deposit-bag-atm-pull.test.ts   (D198e - $20s out of the deposit bag for the ATM)
 *
 * Owner (2026-11-07): "I need a way for the morning employees to exclude 20s from the daily deposit
 * for use in the atm. This should be an option while building the deposit bag, so it can reconcile
 * what was taken out, by who, and then the daily sync will match the money to the cash loaded into
 * the machine. There should be a small current cash in atm card on the deposit bag page that acts
 * like a button ..."
 *
 * Pins: migration 0347 (columns, shape CHECKs, witness-other-person, write-once trigger with the
 * factory-reset hatch, precheck), rollback + PG check + POST_APPLY_CHECKS registration, the pure
 * core's self-tests, and the wiring (actions, page, EOD, match store, docs).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runDepositBagAtmPullTests,
  bagTotalAfterPull,
  parseBagAtmPull,
  ATM_READING_FRESH_MINUTES,
  ATM_REFRESH_MIN_SECONDS,
} from "@/lib/registers/deposit-bag-atm-pull-core";
import { __runAtmDropCoreTests, normalizeAtmDropSettings } from "@/lib/registers/atm-drop-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG = read("supabase/migrations/0347_deposit_bag_atm_pull.sql");

describe("D198e migration 0347", () => {
  it("adds the ten pull columns idempotently", () => {
    for (const c of [
      "atm_pull_twenties integer",
      "atm_pull_minor integer",
      "atm_pulled_by uuid",
      "atm_pull_witnessed_by uuid",
      "atm_pulled_at timestamptz",
      "atm_pull_terminal_id text",
      "atm_pull_flags text[] not null default '{}'",
      "atm_pull_balance_seen_cents bigint",
      "atm_pull_balance_seen_at timestamptz",
      "atm_pull_reason text",
    ]) {
      expect(MIG).toContain(`alter table public.deposit_bags add column if not exists ${c}`);
    }
  });

  it("the pull is a whole number of $20s, all or nothing, enforced by the database", () => {
    expect(MIG).toMatch(/atm_pull_twenties between 1 and 2500/);
    expect(MIG).toMatch(/atm_pull_minor = atm_pull_twenties \* 2000/);
    for (const n of ["shape", "witness_other_person", "flags_bounded", "reason_len", "balance_seen"]) {
      expect(MIG).toContain(`add constraint deposit_bags_atm_pull_${n}`);
    }
    expect(MIG).toMatch(/atm_pull_witnessed_by <> atm_pulled_by/);
  });

  it("the pull is write-once, with only the factory-reset hatch", () => {
    expect(MIG).toMatch(/create or replace function public\.deposit_bags_atm_pull_immutable\(\)/);
    expect(MIG).toMatch(/create trigger deposit_bags_atm_pull_immutable/);
    expect(MIG).toContain("DEPOSIT_BAG_ATM_PULL_IMMUTABLE");
    expect(MIG).toContain("gl_factory_reset_active()");
  });

  it("refuses to run out of order", () => {
    expect(MIG).toContain("MIGRATION_OUT_OF_ORDER: 0347 depends on deposit_bags");
    expect(MIG).toContain("MIGRATION_OUT_OF_ORDER: 0347 depends on atm_drop_reviews");
  });

  it("has a rollback, a PG check registered as a post-apply check, and an owner hand-off", () => {
    expect(existsSync(join(ROOT, "supabase/rollbacks/0347_deposit_bag_atm_pull.rollback.sql"))).toBe(true);
    const rb = read("supabase/rollbacks/0347_deposit_bag_atm_pull.rollback.sql");
    expect(rb).toMatch(/night_note/);
    expect(rb).toMatch(/enable trigger trg_deposit_bags_sealed_guard/);
    expect(existsSync(join(ROOT, "scripts/recon/deposit-bag-atm-pull-0347-pg-check.sql"))).toBe(true);
    expect(POST_APPLY_CHECKS.some((c) => c.file === "scripts/recon/deposit-bag-atm-pull-0347-pg-check.sql" && c.mustPrint === "DEPOSIT BAG ATM PULL 0347 CHECK PASSED")).toBe(true);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("supabase/migrations/0347_deposit_bag_atm_pull.sql");
  });
});

describe("D198e pure core", () => {
  it("self-tests all pass", () => {
    const r = __runDepositBagAtmPullTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(58);
    const a = __runAtmDropCoreTests();
    expect(a.failed).toBe(0);
  });

  it("the bag holds expected minus the pull", () => {
    expect(bagTotalAfterPull(500000, 80000)).toBe(420000);
    expect(bagTotalAfterPull(500000, null)).toBe(500000);
  });

  it("the builder cannot witness themselves, and a stale reading needs a reason", () => {
    const now = "2026-11-07T15:00:00.000Z";
    const base: Parameters<typeof parseBagAtmPull>[0] = {
      wanted: true,
      twentiesText: "40",
      maxTwenties: 2500,
      expectedDepositMinor: 500000,
      terminalId: "HG26499",
      builderId: "e1",
      witnessId: "e1",
      witnessPolicy: "recommended",
      reading: null,
      fillToCents: null,
      reason: "",
      nowIso: now,
    };
    const same = parseBagAtmPull(base);
    expect(same.ok).toBe(false);
    const stale = parseBagAtmPull({ ...base, witnessId: "e2" });
    expect(stale.ok).toBe(false);
    const staleWithReason = parseBagAtmPull({ ...base, witnessId: "e2", reason: "PAI down, counted cassette" });
    expect(staleWithReason.ok).toBe(true);
    expect(ATM_READING_FRESH_MINUTES).toBe(30);
    expect(ATM_REFRESH_MIN_SECONDS).toBe(60);
  });

  it("the fill-to level is whole $20s only", () => {
    expect(normalizeAtmDropSettings({ fillToCents: 300000 }).fillToCents).toBe(300000);
    expect(normalizeAtmDropSettings({ fillToCents: 300001 }).fillToCents).toBeNull();
    expect(normalizeAtmDropSettings({}).fillToCents).toBeNull();
  });
});

describe("D198e wiring", () => {
  const actions = read("src/app/admin/registers/deposit-bags/actions.ts");
  const page = read("src/app/admin/registers/deposit-bags/page.tsx");

  it("the server parses, audits and refuses through the core", () => {
    expect(actions).toContain("parseBagAtmPull(");
    expect(actions).toContain('"deposit_bag.atm_pull"');
    expect(actions).toContain('"deposit_bag.atm_pull_refused"');
    expect(actions).toContain('"atm.live_status_refresh"');
    expect(actions).toContain("bagTotalAfterPull(");
    expect(actions).toMatch(/export async function refreshAtmCashAction/);
  });

  it("the page shows the Cash in the ATM card and the pull fields", () => {
    expect(page).toContain("<AtmCashCard");
    expect(page).toContain("<BagAtmPullFields");
    expect(read("src/components/admin/registers/AtmCashCard.tsx")).toContain("useActionState");
  });

  it("the daily match treats each pull as a drop; EOD and the store carry it", () => {
    expect(read("src/lib/atm/atm-drop-match-store.ts")).toContain("bagPullDrop(");
    expect(read("src/lib/atm/sync-server.ts")).toMatch(/export async function refreshLiveAtmStatus/);
    expect(read("src/lib/registers/deposit-bag-store.ts")).toContain("recentBagPulls");
    expect(read("src/lib/registers/eod-sheet-core.ts")).toContain("atmPullMinor");
  });

  it("docs: verbatim request, SOPs and the concierge KB", () => {
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("D198e");
    expect(read("docs/sop/SOP-03-eod-close-deposit.md")).toContain("4.5a $20s out of the deposit for the ATM (D198e)");
    expect(read("docs/sop/SOP-02-master-till-safe.md")).toContain("D198e");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("D198e");
  });
});
