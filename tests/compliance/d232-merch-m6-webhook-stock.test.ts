/**
 * D232 slice M-6 (SOP-11 B.6): register the Printful webhook from Merch
 * Health (G-89 / F-11-18) and automatic stock (G-83 / F-11-8): a 6-hourly
 * cron plus Printful's stock_updated event relayed by the shop.
 * Owner: "finish the last three slices."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runMerchWebhookTests, PRINTFUL_WEBHOOK_TYPES_ALL } from "@/lib/merch/merch-webhook-core";
import { __runMerchHealthCoreTests } from "@/lib/merch/merch-health-core";
import { __runOrdersCoreTests } from "../../merch-site/lib/orders-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-6: pure rules", () => {
  it("webhook planner self-tests pass", () => {
    const r = __runMerchWebhookTests();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(19);
  });
  it("all 5 types: the 4 order types plus stock_updated", () => {
    expect([...PRINTFUL_WEBHOOK_TYPES_ALL]).toEqual(["package_shipped", "order_failed", "order_canceled", "order_put_hold", "stock_updated"]);
  });
  it("Merch Health core (H-5 needs stock_updated and every garment watched) passes", () => {
    expect(__runMerchHealthCoreTests().failed).toBe(0);
  });
  it("shop orders-core (stock event reader) passes", () => {
    expect(__runOrdersCoreTests().failed).toBe(0);
  });
});

describe("D232 M-6: wiring", () => {
  const server = read("src/lib/merch/merch-webhook-server.ts");
  const actions = read("src/app/admin/merch-studio/health/actions.ts");
  const stock = read("src/lib/merch/merch-stock-server.ts");
  const cron = read("src/app/api/cron/merch-stock/route.ts");
  const relayIn = read("src/app/api/merch-stock/route.ts");
  const shopHook = read("merch-site/app/api/printful/webhook/[token]/route.ts");
  const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };

  it("register reads first, probes the shop, then POSTs /webhooks", () => {
    const get = server.indexOf("Promise.all([readCurrent(), catalogIds()])", server.indexOf("export async function applyWebhook"));
    const pr = server.indexOf("await probe(plan.url)");
    const post = server.indexOf('printful<unknown>("POST", "/webhooks", plan.body)');
    expect(get).toBeGreaterThan(0);
    expect(pr).toBeGreaterThan(get);
    expect(post).toBeGreaterThan(pr);
    expect(server).toContain("if (problem) return { ok: false");
  });
  it("the button is owner/admin and audited; Token C is never returned", () => {
    expect(actions).toMatch(/registerPrintfulWebhookAction[\s\S]*requirePermission\("settings\.manage"\)[\s\S]*merch\.webhook_registered/);
    expect(server).toContain("maskWebhookUrl");
    expect(server).not.toMatch(/url: plan\.url[,\s}]/);
  });
  it("cron is every 6 hours, fail-closed, and uses the shared stock copy", () => {
    expect(vercel.crons).toContainEqual({ path: "/api/cron/merch-stock", schedule: "40 */6 * * *" });
    expect(cron).toContain("shouldRefuseWhenSecretMissing");
    expect(cron).toContain('runMerchStockCopy({ source: "cron:merch-stock" })');
  });
  it("stock copy reuses loadPrintfulStock + applyStock + the compare-and-set write, audited as a system actor", () => {
    expect(stock).toContain("loadPrintfulStock(ids)");
    expect(stock).toContain("applyStock(c, stock.map");
    expect(stock).toContain("updateMerchCatalog(");
    expect(stock).toMatch(/action: "merch\.stock_synced"[\s\S]*source: opts\.source/);
    expect(stock).toContain("actorEmail: opts.source");
  });
  it("the relay endpoint is token-secured (404) and re-reads Printful, never trusts the body", () => {
    expect(relayIn).toContain("timingSafeEqualStr(provided, token)");
    expect(relayIn).toContain("return notFound()");
    expect(relayIn).toContain('onlyProductIds: [id]');
    expect(relayIn).not.toContain("variant_stock");
  });
  it("the shop relays stock_updated with the catalog token and no redirect follow", () => {
    expect(shopHook).toContain("readStockEvent(raw)");
    expect(shopHook).toContain('new URL("/api/merch-stock", catalogSourceUrl())');
    expect(shopHook).toContain('redirect: "manual"');
    const relay = shopHook.indexOf("readStockEvent(raw)");
    const order = shopHook.indexOf("readPrintfulEvent(raw)");
    expect(relay).toBeGreaterThan(shopHook.indexOf("secretMatches(token"));
    expect(order).toBeGreaterThan(relay);
  });
});
