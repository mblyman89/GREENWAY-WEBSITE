/**
 * src/lib/merch/merch-webhook-core.ts  (D232 slice M-6, SOP-11 G-89 + G-83)
 *
 * Owner (D232, verbatim): "I want to build all things, serious to not
 * serious. The big to the small."
 *
 * PURE planner for the "Register the Printful webhook" button on Merch
 * Health. Printful v1 (developers.printful.com/docs, Webhook API):
 *   GET  /webhooks  -> { url, types[], params }
 *   POST /webhooks  { url, types[], params: { stock_updated: { product_ids } } }
 *   "only one webhook URL can be active for a store, so calling this method
 *    disables all existing webhook configuration."
 *   "Setting up the Stock updated webhook requires passing IDs for products
 *    that need to be monitored for changes."
 * So the plan always sends EVERY type we need (the 4 order types plus
 * stock_updated), keeps any extra type already there, and lists every
 * garment in the catalog under params.stock_updated.product_ids.
 *
 * The URL carries Token C (PRINTFUL_WEBHOOK_TOKEN, F-11-18). It is never
 * returned for display: maskWebhookUrl() hides everything after /webhook/.
 * No fetch, no env, no React.
 */

/** The 4 order events the shop handles plus stock_updated (G-83). */
export const PRINTFUL_ORDER_TYPES = ["package_shipped", "order_failed", "order_canceled", "order_put_hold"] as const;
export const PRINTFUL_WEBHOOK_TYPES_ALL = [...PRINTFUL_ORDER_TYPES, "stock_updated"] as const;
/** The shop's webhook route (merch-site/app/api/printful/webhook/[token]/route.ts). */
export const SHOP_WEBHOOK_PATH = "/api/printful/webhook/";
/** merch-site secretMatches() refuses a secret shorter than this (orders-core.ts L54). */
export const MIN_WEBHOOK_TOKEN = 16;
/** Printful documents no limit; keep the request small and predictable. */
export const MAX_WATCHED_PRODUCTS = 100;
/** A body the shop's route reads as "ignore" and answers 200 to, only when the token matches. */
export const PROBE_EVENT = { type: "greenway_probe" } as const;

export interface WebhookInfo { url: string; types: string[]; productIds: number[]; params: Record<string, unknown> }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ids = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b) : []);

/** Read Printful's GET /webhooks result (null / junk -> empty). */
export function readWebhookInfo(raw: unknown): WebhookInfo {
  const r = isObj(raw) ? raw : {};
  const params = isObj(r.params) ? r.params : {};
  const su = isObj(params.stock_updated) ? params.stock_updated : {};
  return {
    url: typeof r.url === "string" ? r.url.trim() : "",
    types: Array.isArray(r.types) ? [...new Set(r.types.map(String))] : [],
    productIds: ids(su.product_ids),
    params,
  };
}

/** Never show Token C: everything after /webhook/ becomes "…". */
export function maskWebhookUrl(url: string): string {
  return url.replace(/\/webhook\/.+$/i, "/webhook/…");
}

const shopPrefix = (shopOrigin: string) => `${shopOrigin.replace(/\/+$/, "")}${SHOP_WEBHOOK_PATH}`;

/** True when the URL is the shop's webhook route with a token long enough to be real. */
export function isShopWebhookUrl(url: string, shopOrigin: string): boolean {
  const want = shopPrefix(shopOrigin);
  if (!url.toLowerCase().startsWith(want.toLowerCase())) return false;
  const tok = url.slice(want.length);
  return tok.length >= MIN_WEBHOOK_TOKEN && /^[A-Za-z0-9._~-]+$/.test(tok);
}

export type WebhookPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Full URL (contains Token C): send to Printful, never display. */
      url: string;
      urlSource: "kept" | "env";
      body: { url: string; types: string[]; params: Record<string, unknown> };
      /** Plain-English list of what changes; empty = already right. */
      changes: string[];
      noChange: boolean;
      /** Safe to show. */
      shown: { url: string; types: string[]; productIds: number[] };
    };

/**
 * Decide what to send. URL: Token C from the main project's env if it is set
 * (the owner keeps it the same in both projects), else the shop URL that is
 * already registered (it already carries Token C), else refuse with the fix.
 * The caller must PROBE the chosen URL (PROBE_EVENT, expect 200) before it
 * registers anything, so a wrong token can never replace a working webhook.
 */
export function planWebhook(input: { current: WebhookInfo; shopOrigin: string; envToken: string; catalogProductIds: readonly number[] }): WebhookPlan {
  const { current, shopOrigin } = input;
  const envToken = input.envToken.trim();
  let url = ""; let urlSource: "kept" | "env" = "kept";
  if (envToken) {
    if (envToken.length < MIN_WEBHOOK_TOKEN || !/^[A-Za-z0-9._~-]+$/.test(envToken)) return { ok: false, error: `PRINTFUL_WEBHOOK_TOKEN in this (main) project must be at least ${MIN_WEBHOOK_TOKEN} letters/numbers with no spaces or symbols (openssl rand -hex 32 makes one). Use the SAME value as the merch project.` };
    url = `${shopPrefix(shopOrigin)}${envToken}`; urlSource = "env";
  } else if (isShopWebhookUrl(current.url, shopOrigin)) {
    url = current.url; urlSource = "kept";
  } else {
    return { ok: false, error: `No working shop webhook is registered${current.url ? ` (it points to ${maskWebhookUrl(current.url)})` : ""}, and this project does not know Token C. Add PRINTFUL_WEBHOOK_TOKEN to the MAIN Greenway project in Vercel with the SAME value as the merch project, redeploy, and press the button again (SOP-11 S-10).` };
  }
  const extra = current.types.filter((t) => !(PRINTFUL_WEBHOOK_TYPES_ALL as readonly string[]).includes(t));
  const types = [...PRINTFUL_WEBHOOK_TYPES_ALL, ...extra];
  const want = ids(input.catalogProductIds);
  if (want.length > MAX_WATCHED_PRODUCTS) return { ok: false, error: `The catalog has ${want.length} different garments; the stock watch is limited to ${MAX_WATCHED_PRODUCTS}. The 6-hour stock copy still covers all of them.` };
  const params: Record<string, unknown> = { ...current.params, stock_updated: { product_ids: want } };
  const changes: string[] = [];
  if (!current.url) changes.push("Register the webhook (none is registered).");
  else if (url !== current.url) changes.push(isShopWebhookUrl(current.url, shopOrigin) ? "Use Token C from this project (the registered address has a different token)." : `Move it from ${maskWebhookUrl(current.url)} to the shop.`);
  const missing = PRINTFUL_WEBHOOK_TYPES_ALL.filter((t) => !current.types.includes(t));
  if (missing.length) changes.push(`Add event${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  const newIds = want.filter((n) => !current.productIds.includes(n));
  const goneIds = current.productIds.filter((n) => !want.includes(n));
  if (newIds.length) changes.push(`Watch stock for garment${newIds.length === 1 ? "" : "s"} ${newIds.map((n) => `#${n}`).join(", ")}.`);
  if (goneIds.length) changes.push(`Stop watching garment${goneIds.length === 1 ? "" : "s"} no longer in the catalog: ${goneIds.map((n) => `#${n}`).join(", ")}.`);
  return { ok: true, url, urlSource, body: { url, types, params }, changes, noChange: changes.length === 0, shown: { url: maskWebhookUrl(url), types, productIds: want } };
}

/** What a probe answer means (the shop answers 200 only when Token C matches). */
export function probeProblem(status: number): string {
  if (status === 200) return "";
  if (status === 404) return "The shop answered 404 for this webhook address, so Token C does not match the merch project's PRINTFUL_WEBHOOK_TOKEN (or the shop is not deployed). Nothing was registered. Make the two values the same, redeploy, and try again.";
  if (status >= 300 && status < 400) return "The shop address redirected. Set MERCH_SHOP_URL to the final address (no www for greenwaymerch.com). Nothing was registered.";
  if (status === 0) return "Could not reach the shop. Nothing was registered.";
  return `The shop answered ${status}. Nothing was registered.`;
}

/** H-5 extra: garments in the catalog that the stock watch does not cover. */
export function unwatchedProducts(info: WebhookInfo, catalogProductIds: readonly number[]): number[] {
  if (!info.types.includes("stock_updated")) return [];
  return ids(catalogProductIds).filter((n) => !info.productIds.includes(n));
}

export function __runMerchWebhookTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0; const failures: string[] = [];
  const ok = (c: boolean, name: string) => { if (c) passed += 1; else failures.push(name); };
  const shop = "https://greenwaymerch.com";
  const tok = "abcdefghijklmnopqrstuvwxyz123456";
  const good = `${shop}/api/printful/webhook/${tok}`;

  const info = readWebhookInfo({ url: ` ${good} `, types: ["package_shipped", "package_shipped", "order_failed"], params: { stock_updated: { product_ids: [12, "5", -1, 5] } } });
  ok(info.url === good && info.types.join() === "package_shipped,order_failed" && info.productIds.join() === "5,12", "readWebhookInfo trims, dedupes, cleans ids");
  ok(readWebhookInfo(null).url === "" && readWebhookInfo("x").types.length === 0, "junk -> empty");
  ok(maskWebhookUrl(good) === `${shop}/api/printful/webhook/…` && !maskWebhookUrl(good).includes(tok), "mask hides Token C");
  ok(isShopWebhookUrl(good, shop) && isShopWebhookUrl(good, `${shop}/`), "shop url recognised");
  ok(!isShopWebhookUrl(`${shop}/api/printful/webhook/short`, shop) && !isShopWebhookUrl("https://old.example.com/api/printful/webhook/" + tok, shop), "short token / other host refused");

  const none = readWebhookInfo(null);
  const p0 = planWebhook({ current: none, shopOrigin: shop, envToken: "", catalogProductIds: [71] });
  ok(!p0.ok && p0.error.includes("PRINTFUL_WEBHOOK_TOKEN") && p0.error.includes("MAIN"), "nothing registered + no env token -> refuse with the fix");
  const p1 = planWebhook({ current: none, shopOrigin: shop, envToken: tok, catalogProductIds: [71, 71, 12] });
  ok(p1.ok && p1.urlSource === "env" && p1.url === good && p1.body.types.join() === "package_shipped,order_failed,order_canceled,order_put_hold,stock_updated", "env token -> all 5 types");
  ok(p1.ok && JSON.stringify(p1.body.params) === JSON.stringify({ stock_updated: { product_ids: [12, 71] } }), "product ids sorted, deduped, under params.stock_updated");
  ok(p1.ok && p1.changes[0].startsWith("Register") && !p1.noChange && !JSON.stringify(p1.shown).includes(tok), "changes listed; shown has no token");
  const p2 = planWebhook({ current: readWebhookInfo({ url: good, types: [...PRINTFUL_ORDER_TYPES] }), shopOrigin: shop, envToken: "", catalogProductIds: [71] });
  ok(p2.ok && p2.urlSource === "kept" && p2.url === good && p2.changes.some((c) => c.includes("stock_updated")), "kept url; adds stock_updated");
  const p3 = planWebhook({ current: readWebhookInfo({ url: good, types: [...PRINTFUL_WEBHOOK_TYPES_ALL, "product_updated"], params: { stock_updated: { product_ids: [71] }, other: { a: 1 } } }), shopOrigin: shop, envToken: "", catalogProductIds: [71] });
  ok(p3.ok && p3.noChange && p3.body.types.includes("product_updated") && (p3.body.params as { other?: unknown }).other !== undefined, "already right -> noChange; extra type and params kept");
  const p4 = planWebhook({ current: readWebhookInfo({ url: "https://old.example.com/hook", types: [...PRINTFUL_ORDER_TYPES] }), shopOrigin: shop, envToken: "", catalogProductIds: [] });
  ok(!p4.ok && p4.error.includes("old.example.com"), "foreign url + no env token -> refuse, names where it points");
  const p5 = planWebhook({ current: readWebhookInfo({ url: "https://old.example.com/api/printful/webhook/SECRETSECRETSECRET", types: [] }), shopOrigin: shop, envToken: tok, catalogProductIds: [] });
  ok(p5.ok && p5.changes[0].startsWith("Move it from") && !p5.changes.join().includes("SECRET"), "foreign url moved; old token not printed");
  const p6 = planWebhook({ current: readWebhookInfo({ url: `${shop}/api/printful/webhook/zzzzzzzzzzzzzzzzzzzz`, types: [...PRINTFUL_WEBHOOK_TYPES_ALL] }), shopOrigin: shop, envToken: tok, catalogProductIds: [] });
  ok(p6.ok && p6.url === good && p6.changes.some((c) => c.includes("different token")), "env token wins over a different registered token");
  ok(!planWebhook({ current: none, shopOrigin: shop, envToken: "short", catalogProductIds: [] }).ok && !planWebhook({ current: none, shopOrigin: shop, envToken: "has space in it 1234567", catalogProductIds: [] }).ok, "bad env token refused");
  const p7 = planWebhook({ current: readWebhookInfo({ url: good, types: [...PRINTFUL_WEBHOOK_TYPES_ALL], params: { stock_updated: { product_ids: [1, 2] } } }), shopOrigin: shop, envToken: "", catalogProductIds: [2, 3] });
  ok(p7.ok && p7.changes.some((c) => c.includes("#3")) && p7.changes.some((c) => c.includes("no longer") && c.includes("#1")), "new and gone garments listed");
  ok(!planWebhook({ current: none, shopOrigin: shop, envToken: tok, catalogProductIds: Array.from({ length: 101 }, (_, n) => n + 1) }).ok, "over 100 garments refused");
  ok(probeProblem(200) === "" && probeProblem(404).includes("Token C") && probeProblem(308).includes("redirect") && probeProblem(0).includes("reach") && probeProblem(500).includes("500"), "probe answers explained");
  ok(unwatchedProducts(readWebhookInfo({ url: good, types: ["stock_updated"], params: { stock_updated: { product_ids: [1] } } }), [1, 2]).join() === "2" && unwatchedProducts(readWebhookInfo({ url: good, types: [] }), [1]).length === 0, "unwatched garments");
  return { passed, failed: failures.length, failures };
}
