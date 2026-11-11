/**
 * D232 slice M-7 (SOP-11 B.6): held-card monitor (G-84), merch alerts inbox
 * (G-85), cancel-and-refund in one guided step with the refund button (G-86,
 * owner "Q4: guidance first, but build the button too please and all that
 * goes with it."), and the auto-confirm switch built and left off (owner
 * "Q7: I agree with you. Build the auto confirm too and all that goes along
 * with it so it's ready.").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runMerchPaymentsTests } from "@/lib/merch/merch-payments-core";
import { __runMerchAlertsTests } from "@/lib/merch/merch-alerts-core";
import { __runAutoConfirmTests, MIN_CLEAN_ORDERS } from "@/lib/merch/merch-autoconfirm-core";
import { __runMerchHealthCoreTests } from "@/lib/merch/merch-health-core";
import { ALL_PERMISSIONS, can, PERMISSION_LABELS } from "@/lib/auth/roles";
import { __runPaymentsCoreTests } from "../../merch-site/lib/payments-core";
import { __runHealthCoreTests } from "../../merch-site/lib/health-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-7: pure rules", () => {
  it("back-office payment rules pass", () => {
    const r = __runMerchPaymentsTests();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(19);
  });
  it("alert rules pass", () => expect(__runMerchAlertsTests().failures).toEqual([]));
  it("auto-confirm rules pass; 20 clean orders", () => {
    expect(__runAutoConfirmTests().failures).toEqual([]);
    expect(MIN_CLEAN_ORDERS).toBe(20);
  });
  it("Merch Health core passes (H-15 names the held orders)", () => expect(__runMerchHealthCoreTests().failed).toBe(0));
  it("shop payments-core and health-core pass", () => {
    expect(__runPaymentsCoreTests().failed).toBe(0);
    expect(__runHealthCoreTests().failed).toBe(0);
  });
});

describe("D232 M-7: merch.refund is owner and admin only", () => {
  it("matrix, list, label", () => {
    expect(can("owner", "merch.refund")).toBe(true);
    expect(can("admin", "merch.refund")).toBe(true);
    for (const r of ["manager", "content_editor", "staff", "readonly"] as const) expect(can(r, "merch.refund")).toBe(false);
    expect(ALL_PERMISSIONS.filter((p) => p === "merch.refund")).toHaveLength(1);
    expect(PERMISSION_LABELS["merch.refund"]).toContain("owner & admin");
  });
});

describe("D232 M-7: wiring", () => {
  const shopPay = read("merch-site/app/api/payments/route.ts");
  const actions = read("src/app/admin/orders/merch-actions.ts");
  const page = read("src/app/admin/orders/merch/[ref]/page.tsx");
  const healthServer = read("src/lib/merch/merch-health-server.ts");
  const paySrv = read("src/lib/merch/merch-payments-server.ts");
  const alertsRoute = read("src/app/api/merch-alerts/route.ts");
  const fulfillment = read("merch-site/lib/fulfillment.ts");
  const feed = read("src/app/api/merch-catalog/route.ts");
  const stripeHook = read("merch-site/app/api/stripe/webhook/route.ts");
  const catalog = read("merch-site/lib/catalog.ts");
  const hActions = read("src/app/admin/merch-studio/health/actions.ts");
  const sql = read("supabase/migrations/0361_merch_alerts.sql");

  it("shop: reads with the health token, moves money only with its own token, re-reads Stripe first, fixed idempotency key", () => {
    expect(shopPay).toContain('allowed(req, "MERCH_HEALTH_TOKEN")');
    expect(shopPay).toContain('allowed(req, "MERCH_PAYMENTS_TOKEN")');
    const look = shopPay.indexOf("const before = await lookup(key, ref)");
    const plan = shopPay.indexOf("planPaymentAction(before.payment, action, ref)");
    const post = shopPay.indexOf('"Idempotency-Key": plan.idempotencyKey');
    expect(look).toBeGreaterThan(0);
    expect(plan).toBeGreaterThan(look);
    expect(post).toBeGreaterThan(plan);
  });
  it("back office: owner/admin, typed reference, audited, never follows a redirect", () => {
    expect(actions).toMatch(/moveMerchPaymentAction[\s\S]*requirePermission\("merch\.refund"\)[\s\S]*typed !== handle[\s\S]*movePayment\(handle, kind\)[\s\S]*merch\.payment_refund/);
    expect(paySrv).toContain('redirect: "manual"');
    expect(page).toContain('can(session.profile.role, "merch.refund")');
    expect(page).toContain("stripeDashboardUrl");
    expect(page).toContain("bothHalves");
  });
  it("held-card reminders ride the daily cron only, claimed once per hold and stage", () => {
    const cronOnly = healthServer.indexOf('if (opts.source !== "cron") return');
    const send = healthServer.indexOf("await sendHeldReminders(admin, held)");
    expect(cronOnly).toBeGreaterThan(0);
    expect(send).toBeGreaterThan(cronOnly);
    expect(paySrv).toContain('stage: "merch_held"');
    expect(read("src/lib/merch/merch-payments-core.ts")).toContain("key: `merch-held:${h.id}:${stage}`");
  });
  it("alerts: token-secured endpoint, shop posts every alert, email stays", () => {
    expect(alertsRoute).toContain("timingSafeEqualStr(provided, token)");
    expect(alertsRoute).toContain("MERCH_CATALOG_TOKEN");
    const post = fulfillment.indexOf("await postToBackOffice(subject, lines)");
    const mail = fulfillment.indexOf('const to = env("MERCH_ORDER_ALERT_EMAIL")', post);
    expect(post).toBeGreaterThan(0);
    expect(mail).toBeGreaterThan(post);
    expect(fulfillment).toContain('redirect: "manual"');
  });
  it("migration 0361: RLS on, service role only, unique fingerprint, no FK", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.merch_alerts from public, anon, authenticated");
    expect(sql).toContain("grant select, insert, update, delete on table public.merch_alerts to service_role");
    expect(sql).toContain("unique (fingerprint)");
    expect(sql).not.toMatch(/references\s/i);
    expect(read("supabase/rollbacks/0361_merch_alerts.rollback.sql")).toContain("drop table if exists public.merch_alerts");
  });
  it("auto-confirm: feed carries the switch, a failed feed means off, owner-only ON with reason and 20 orders", () => {
    expect(feed).toContain("autoConfirm: auto.error === null && auto.setting.on");
    expect(catalog).toContain("lastFeed?.ok === true && lastAutoConfirm");
    expect(stripeHook).toContain('process.env.MERCH_PRINTFUL_AUTO_CONFIRM === "true" || feedAutoConfirm()');
    expect(hActions).toMatch(/setAutoConfirmAction[\s\S]*requirePermission\("settings\.manage"\)[\s\S]*checkSwitch\(/);
    expect(hActions).toContain("merch.auto_confirm_on");
  });
});
