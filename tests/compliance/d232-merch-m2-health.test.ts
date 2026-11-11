/**
 * D232 slice M-2 (SOP-11 B.4): Merch Health H-1..H-19 in the back office and
 * the shop's own /api/health behind MERCH_HEALTH_TOKEN (Michael verbatim:
 * "Q3: yes."). The daily run rides the existing platform-health cron.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  __runMerchHealthCoreTests,
  buildMerchHealth,
  shouldAlert,
  MERCH_HEALTH_KIND,
  type MerchHealthInput,
} from "@/lib/merch/merch-health-core";
import { __runHealthCoreTests, stripeKeyMode, checkStripeEndpoints } from "../../merch-site/lib/health-core";

const read = (p: string) => readFileSync(p, "utf8");

const base: MerchHealthInput = {
  nowIso: "2027-01-10T15:00:00Z",
  shopOrigin: "https://greenwaymerch.com",
  printfulConfigured: false,
  scopes: null,
  stores: null,
  webhooks: null,
  drafts: null,
  tokenExpires: "",
  shop: null,
  statusPages: { printful: null, stripe: null, resend: null },
  catalog: { readError: null, live: 0, oldestStockSyncIso: null, neverSynced: 0 },
  buckets: { media: true, merchFiles: true },
};

describe("D232 M-2: pure cores", () => {
  it("both self-tests pass and the shop one is in the runner", () => {
    expect(__runMerchHealthCoreTests().failed).toBe(0);
    expect(__runHealthCoreTests().failed).toBe(0);
    expect(read("merch-site/scripts/selftest.ts")).toContain("__runHealthCoreTests");
  });
  it("produces all 19 checks, in order, each with an SOP section", () => {
    const r = buildMerchHealth(base);
    expect(r.checks.map((c) => c.id)).toEqual(Array.from({ length: 19 }, (_, i) => `H-${i + 1}`));
    for (const c of r.checks) expect(c.sop).not.toBe("");
    expect(r.status).toBe("fail"); // no Printful token
  });
  it("no MERCH_HEALTH_TOKEN -> shop checks are Unknown with the setup fix", () => {
    const h9 = buildMerchHealth(base).checks.find((c) => c.id === "H-9");
    expect(h9?.level).toBe("unknown");
    expect(h9?.fix).toContain("MERCH_HEALTH_TOKEN");
  });
  it("alerts only on a change of reds, or Monday", () => {
    const r = buildMerchHealth(base);
    expect(shouldAlert(r, r, false).send).toBe(false);
    expect(shouldAlert(r, r, true).why).toBe("weekly");
    expect(shouldAlert(null, r, false).why).toBe("changed");
  });
  it("shop helpers: key mode and the no-www Stripe endpoint", () => {
    expect(stripeKeyMode("sk_live_x")).toBe("live");
    expect(stripeKeyMode("pk_live_x")).toBe("invalid");
    const ep = checkStripeEndpoints([{ url: "https://www.greenwaymerch.com/api/stripe/webhook", status: "enabled", enabled_events: ["*"] }], "https://greenwaymerch.com/api/stripe/webhook");
    expect(ep.found).toBe(false);
    expect(ep.wrongHost.length).toBe(1);
  });
});

describe("D232 M-2: wiring", () => {
  it("the shop route is token-gated with its own token and 404s otherwise", () => {
    const s = read("merch-site/app/api/health/route.ts");
    expect(s).toContain("MERCH_HEALTH_TOKEN");
    expect(s).toContain("expected.length < 32");
    expect(s).toContain("secretMatches(");
    expect(s).toContain('"Cache-Control": "no-store"');
  });
  it("the server asks the shop without following redirects and saves kind merch_health", () => {
    const s = read("src/lib/merch/merch-health-server.ts");
    expect(s).toContain('import "server-only"');
    expect(s).toContain('redirect: "manual"');
    expect(s).toContain("MERCH_HEALTH_TOKEN");
    expect(s).toContain("merch-health:daily:");
    expect(MERCH_HEALTH_KIND).toMatch(/^[a-z][a-z0-9_]{1,40}$/); // 0331 kind check
  });
  it("page and actions are owner/admin (settings.manage); the run is audited", () => {
    expect(read("src/app/admin/merch-studio/health/page.tsx")).toContain('requirePermission("settings.manage")');
    const a = read("src/app/admin/merch-studio/health/actions.ts");
    expect(a.match(/requirePermission\("settings.manage"\)/g)).toHaveLength(5); // M-6 added the webhook preview + register actions (owner/admin); M-7 the auto-confirm switch
    expect(a).toContain("merch.health_check_run");
  });
  it("the daily run rides the platform-health cron (no new cron)", () => {
    expect(read("src/app/api/cron/platform-health/route.ts")).toContain("runMerchHealth({ source: \"cron\" })");
    const v = JSON.parse(read("vercel.json")) as { crons: { path: string }[] };
    expect(v.crons.some((c) => c.path.includes("merch-health"))).toBe(false);
  });
  it("Merch Studio links to it for owner/admin", () => {
    expect(read("src/app/admin/merch-studio/page.tsx")).toContain('href="/admin/merch-studio/health"');
  });
});
