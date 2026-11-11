/**
 * D232 M-2 (G-77, SOP-11 Appendix B.4) - Merch Health: turns the raw answers
 * from Printful, the shop's /api/health, the public status pages and our own
 * catalog into the checks H-1 ... H-19, each green / amber / red with the
 * exact fix. PURE: no fetch, no env, no database.
 *
 * Owner basis (D231, verbatim): "we need a printful store and stripe health
 * maybe so we know when things break or go offline."
 */

export type MerchCheckLevel = "ok" | "warn" | "fail" | "unknown";

export interface MerchCheck {
  id: string;
  group: "Printful" | "Shop & Stripe" | "Email" | "Catalog" | "Services";
  title: string;
  level: MerchCheckLevel;
  detail: string;
  /** What to do, in words, when not ok. */
  fix: string;
  /** SOP-11 section with the full steps. */
  sop: string;
}

export interface MerchHealthReport {
  status: "ok" | "warn" | "fail";
  summary: string;
  checks: MerchCheck[];
  at: string;
}

/** A call we made: HTTP status (0 = network) and the parsed `result` / body. */
export interface CallResult { status: number; body: unknown }

/** Shape of merch-site/lib/health.ts ShopHealth (version 1) that we read. */
export interface ShopHealthLike {
  version?: number;
  feed?: { ok?: boolean; status?: number; products?: number; problem?: string; at?: string } | null;
  products?: number;
  checkout?: { open?: boolean; problem?: string };
  shipping?: { set?: boolean; flatCents?: number | null; extraItemCents?: number | null; freeOverCents?: number | null; problem?: string };
  stripe?: {
    keyMode?: string;
    webhookSecretSet?: boolean;
    automaticTax?: boolean;
    endpoint?: { found?: boolean; enabled?: boolean; missingEvents?: string[]; wrongHost?: string[]; livemode?: boolean | null; problem?: string } | null;
    held?: { count?: number; over3Days?: number; oldestDays?: number; problem?: string } | null;
  };
  email?: { resendKeySet?: boolean; fromSet?: boolean; alertToSet?: boolean };
  printful?: { tokenSet?: boolean; storeIdSet?: boolean; webhookTokenSet?: boolean };
  autoConfirm?: boolean;
}

export interface MerchHealthInput {
  nowIso: string;
  shopOrigin: string;
  printfulConfigured: boolean;
  scopes: CallResult | null;
  stores: CallResult | null;
  webhooks: CallResult | null;
  drafts: CallResult | null;
  /** Owner-entered Printful token expiry (YYYY-MM-DD) or "". */
  tokenExpires: string;
  /** null = the shop was not asked (no MERCH_HEALTH_TOKEN here). */
  shop: { status: number; body: ShopHealthLike | null; problem?: string } | null;
  statusPages: { printful: CallResult | null; stripe: CallResult | null; resend: CallResult | null };
  /** productIds (M-6): every garment in the catalog, for H-5's stock watch. */
  catalog: { readError: string | null; live: number; oldestStockSyncIso: string | null; neverSynced: number; productIds?: number[] };
  buckets: { media: boolean | null; merchFiles: boolean | null };
}

/** The four Printful order events the shop handles (merch-site/app/api/printful/webhook/[token]/route.ts). */
export const PRINTFUL_WEBHOOK_TYPES = ["package_shipped", "order_failed", "order_canceled", "order_put_hold"] as const;
/** D232 M-6 (G-83): plus stock_updated, relayed to /api/merch-stock. */
export const PRINTFUL_STOCK_TYPE = "stock_updated";
/** Required: orders (create, confirm, cancel). Recommended: webhooks (register + check), stores_list (H-4). */
export const PRINTFUL_SCOPES_REQUIRED = ["orders"] as const;
export const PRINTFUL_SCOPES_RECOMMENDED = ["webhooks", "stores_list"] as const;

const DAY_MS = 86_400_000;

export function daysUntil(dateYmd: string, nowIso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
  const end = Date.parse(`${dateYmd}T23:59:59Z`);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  return Math.floor((end - now) / DAY_MS);
}

/** Printful GET /oauth/scopes result -> scope strings. */
export function scopeList(body: unknown): string[] {
  const s = (body as { scopes?: unknown } | null)?.scopes;
  return Array.isArray(s) ? s.map((x) => String((x as { scope?: unknown })?.scope ?? "")).filter(Boolean) : [];
}

/** "orders" covers "orders/read"; a "/read" scope does NOT cover the write scope. */
export function hasScope(list: readonly string[], want: string): boolean {
  return list.includes(want);
}

/** Statuspage.io /api/v2/status.json -> level + description. */
export function statusPageLevel(r: CallResult | null): { level: MerchCheckLevel; text: string } {
  if (!r || r.status !== 200) return { level: "unknown", text: "Status page did not answer." };
  const st = (r.body as { status?: { indicator?: unknown; description?: unknown } } | null)?.status;
  const ind = String(st?.indicator ?? "");
  const text = String(st?.description ?? "") || "No description.";
  if (ind === "none") return { level: "ok", text };
  if (ind === "minor" || ind === "maintenance") return { level: "warn", text };
  if (ind === "major" || ind === "critical") return { level: "fail", text };
  return { level: "unknown", text };
}

const pfProblem = (r: CallResult): string =>
  r.status === 401 ? "Printful refused the token (expired, revoked or wrong)." : r.status === 403 ? "The token is missing the permission for this." : r.status === 0 ? "Could not reach Printful." : `Printful answered ${r.status}.`;

const cents = (n: number | null | undefined) => (typeof n === "number" ? `$${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}` : "-");

export function buildMerchHealth(i: MerchHealthInput): MerchHealthReport {
  const checks: MerchCheck[] = [];
  const add = (c: MerchCheck) => checks.push(c);
  const shop = i.shop?.status === 200 ? i.shop.body : null;
  const shopWhy = !i.shop
    ? "MERCH_HEALTH_TOKEN is not set in this (main) Vercel project, so the shop was not asked."
    : i.shop.status === 404
      ? "The shop answered 404: MERCH_HEALTH_TOKEN is missing in the merch project, shorter than 32 characters, or not the same value in both projects (or the shop has not redeployed since M-2)."
      : i.shop.problem || `The shop answered ${i.shop.status}.`;
  const shopFix = "Set MERCH_HEALTH_TOKEN (the same 32+ character value) in BOTH Vercel projects and redeploy both (SOP-11 §4.3).";
  const unknownShop = (id: string, group: MerchCheck["group"], title: string, sop: string): MerchCheck => ({ id, group, title, level: "unknown", detail: shopWhy, fix: shopFix, sop });

  // ---------------- Printful (main project token) ----------------
  if (!i.printfulConfigured) {
    add({ id: "H-1", group: "Printful", title: "Printful token works", level: "fail", detail: "PRINTFUL_API_TOKEN is not set in the main project.", fix: "Add the LLC's Printful private token in the main Vercel project and redeploy.", sop: "§4.2 S-4, S-12" });
  } else if (i.scopes && i.scopes.status === 200) {
    add({ id: "H-1", group: "Printful", title: "Printful token works", level: "ok", detail: "Printful accepted the token.", fix: "", sop: "§4.2 S-4" });
  } else {
    add({ id: "H-1", group: "Printful", title: "Printful token works", level: "fail", detail: i.scopes ? pfProblem(i.scopes) : "Not checked.", fix: "Make a new private token at developers.printful.com (Your tokens) and replace PRINTFUL_API_TOKEN in BOTH projects.", sop: "§4.2 S-4" });
  }
  const scopes = i.scopes?.status === 200 ? scopeList(i.scopes.body) : [];
  if (i.scopes?.status === 200) {
    const missReq = PRINTFUL_SCOPES_REQUIRED.filter((s) => !hasScope(scopes, s));
    const missRec = PRINTFUL_SCOPES_RECOMMENDED.filter((s) => !hasScope(scopes, s) && !hasScope(scopes, `${s}/read`));
    add({
      id: "H-2", group: "Printful", title: "Printful permissions",
      level: missReq.length ? "fail" : missRec.length ? "warn" : "ok",
      detail: missReq.length ? `Missing required: ${missReq.join(", ")}.` : missRec.length ? `Missing recommended: ${missRec.join(", ")} (has ${scopes.join(", ") || "none"}).` : `Has ${scopes.join(", ")}.`,
      fix: missReq.length || missRec.length ? "Make a new token with the missing permissions ticked (a token's permissions cannot be edited), then replace it in both projects." : "",
      sop: "§4.2 S-4",
    });
  } else {
    add({ id: "H-2", group: "Printful", title: "Printful permissions", level: "unknown", detail: "Needs a working token (H-1).", fix: "", sop: "§4.2 S-4" });
  }
  const left = daysUntil(i.tokenExpires, i.nowIso);
  add({
    id: "H-3", group: "Printful", title: "Printful token expiry",
    level: left === null ? "warn" : left <= 7 ? "fail" : left <= 30 ? "warn" : "ok",
    detail: left === null ? "No expiry date saved. Printful tokens expire; type the date from the token list below." : left < 0 ? `Expired ${-left} day(s) ago (${i.tokenExpires}).` : `${left} day(s) left (expires ${i.tokenExpires}).`,
    fix: left === null ? "Enter the expiry date on this page." : left <= 30 ? "Make a new token before it expires, replace it in both projects, then save the new date here." : "",
    sop: "§4.2 S-4",
  });
  if (i.stores && i.stores.status === 200) {
    const list = Array.isArray(i.stores.body) ? i.stores.body : [];
    const names = list.map((s) => String((s as { name?: unknown })?.name ?? "")).filter(Boolean);
    add({ id: "H-4", group: "Printful", title: "Printful store", level: list.length === 1 ? "ok" : list.length === 0 ? "fail" : "warn", detail: list.length === 1 ? `Store: ${names[0] ?? "(no name)"}.` : list.length === 0 ? "The token sees no store." : `The token sees ${list.length} stores (${names.join(", ")}); orders go to PRINTFUL_STORE_ID.`, fix: list.length === 1 ? "" : "Use a token made for the one Greenway store, or set PRINTFUL_STORE_ID.", sop: "§4.2 S-4" });
  } else {
    add({ id: "H-4", group: "Printful", title: "Printful store", level: i.stores && (i.stores.status === 401 || i.stores.status === 403) && i.scopes?.status === 200 ? "warn" : "unknown", detail: i.stores ? `${pfProblem(i.stores)} The store list needs the stores_list permission.` : "Not checked.", fix: "Optional: tick stores_list on the next token you make.", sop: "§4.2 S-4" });
  }
  if (i.webhooks && i.webhooks.status === 200) {
    const w = (i.webhooks.body ?? {}) as { url?: unknown; types?: unknown };
    const url = typeof w.url === "string" ? w.url.trim() : "";
    const types = Array.isArray(w.types) ? w.types.map(String) : [];
    const want = `${i.shopOrigin.replace(/\/+$/, "")}/api/printful/webhook/`;
    const missing = [...PRINTFUL_WEBHOOK_TYPES, PRINTFUL_STOCK_TYPE].filter((t) => !types.includes(t));
    const urlOk = url.toLowerCase().startsWith(want.toLowerCase()) && url.length > want.length + 15;
    const pw = (w as { params?: { stock_updated?: { product_ids?: unknown } } }).params?.stock_updated?.product_ids;
    const watched = Array.isArray(pw) ? pw.map(Number) : [];
    const unwatched = types.includes(PRINTFUL_STOCK_TYPE) ? [...new Set(i.catalog.productIds ?? [])].filter((n) => !watched.includes(n)) : [];
    add({
      id: "H-5", group: "Printful", title: "Printful webhook (shipped emails, stock)",
      level: !url ? "fail" : !urlOk ? "fail" : missing.length || unwatched.length ? "warn" : "ok",
      detail: !url ? "No webhook is registered, so customers get no shipped email and you get no failure alerts." : !urlOk ? `The webhook points somewhere else: ${url.replace(/\/webhook\/.+$/, "/webhook/…")}.` : missing.length ? `Registered, but missing: ${missing.join(", ")}.` : unwatched.length ? `Registered with all 5 events, but the stock watch does not cover garment${unwatched.length === 1 ? "" : "s"} ${unwatched.map((n) => `#${n}`).join(", ")} (published since the last registration).` : "Registered to the shop with all 5 events (4 order events + stock_updated).",
      fix: !url || !urlOk || missing.length || unwatched.length ? "Press Register / repair the Printful webhook on this page. It reads what is there first and keeps any other event type." : "",
      sop: "§4.2 S-10",
    });
  } else {
    add({ id: "H-5", group: "Printful", title: "Printful webhook (shipped emails)", level: i.webhooks && i.webhooks.status === 403 ? "warn" : "unknown", detail: i.webhooks ? `${pfProblem(i.webhooks)} Reading the webhook needs the webhooks permission.` : "Needs a working token (H-1).", fix: "Tick webhooks on the next token.", sop: "§4.2 S-10" });
  }
  const pf = statusPageLevel(i.statusPages.printful);
  add({ id: "H-6", group: "Services", title: "Printful service status", level: pf.level, detail: `printfulstatus.com: ${pf.text}`, fix: pf.level === "ok" ? "" : "Nothing to fix on our side; orders may be slow. Watch printfulstatus.com.", sop: "§6" });

  // ---------------- Catalog round-trip (H-7, H-8) ----------------
  if (shop) {
    const feed = shop.feed ?? null;
    const shown = typeof shop.products === "number" ? shop.products : 0;
    const redirect = !!feed && !feed.ok && /redirect/i.test(feed.problem ?? "");
    add({
      id: "H-7", group: "Catalog", title: "Catalog reaches the shop",
      level: i.catalog.readError ? "unknown" : !feed ? "warn" : !feed.ok ? "fail" : i.catalog.live > 0 && shown === 0 ? "fail" : shown < i.catalog.live ? "warn" : "ok",
      detail: i.catalog.readError ? `Could not read our catalog: ${i.catalog.readError}` : !feed ? "The shop has not fetched the catalog yet." : !feed.ok ? `The shop's last feed call failed: ${feed.problem ?? "unknown"}` : `${i.catalog.live} live here, ${shown} on the shop.`,
      fix: !feed || feed.ok ? (shown < i.catalog.live ? "Wait a minute (the shop refreshes every 60 s) and run again. Products with no sellable variant are not shown." : "") : "Follow the message: usually MERCH_CATALOG_TOKEN differs between the projects.",
      sop: "§4.4.1, §6.1",
    });
    add({ id: "H-8", group: "Catalog", title: "Feed address (no redirect)", level: redirect ? "fail" : feed ? "ok" : "unknown", detail: redirect ? (feed?.problem ?? "") : feed ? "The shop reaches the back office without a redirect." : "Not fetched yet.", fix: redirect ? "Set MERCH_CATALOG_URL to the address in the message (with www) in the merch project, or delete a wrong value, and redeploy." : "", sop: "§4.4.1 (F-11-1)" });
  } else {
    add(unknownShop("H-7", "Catalog", "Catalog reaches the shop", "§4.4.1"));
    add(unknownShop("H-8", "Catalog", "Feed address (no redirect)", "§4.4.1"));
  }

  // ---------------- Shop & Stripe (H-9 ... H-13, H-15, H-19) ----------------
  if (shop) {
    const s = shop.stripe ?? {};
    const mode = String(s.keyMode ?? "missing");
    add({ id: "H-9", group: "Shop & Stripe", title: "Stripe secret key", level: mode === "live" ? "ok" : mode === "test" ? "warn" : "fail", detail: mode === "live" ? "Live key set." : mode === "test" ? "TEST key: no real card is charged." : mode === "invalid" ? "STRIPE_SECRET_KEY is not a secret key (a publishable pk_ key?)." : "STRIPE_SECRET_KEY is not set in the merch project.", fix: mode === "live" ? "" : "Stripe dashboard (Greenway Merchandising LLC) → Developers → API keys → copy the secret key into the merch project, redeploy.", sop: "§4.2 S-6" });
    const ep = s.endpoint ?? null;
    const epLevel: MerchCheckLevel = !s.webhookSecretSet ? "fail" : !ep ? "unknown" : ep.problem ? "warn" : !ep.found ? "fail" : !ep.enabled ? "fail" : (ep.missingEvents ?? []).length ? "fail" : "ok";
    add({
      id: "H-10", group: "Shop & Stripe", title: "Stripe webhook endpoint",
      level: epLevel,
      detail: !s.webhookSecretSet ? "STRIPE_WEBHOOK_SECRET (whsec_...) is not set in the merch project." : !ep ? "Needs a working Stripe key (H-9)." : ep.problem ? ep.problem : !ep.found ? `No endpoint for ${i.shopOrigin}/api/stripe/webhook.${(ep.wrongHost ?? []).length ? " One points at www, which redirects; Stripe does not follow redirects." : ""}` : !ep.enabled ? "Stripe DISABLED the endpoint (usually after days of failures)." : (ep.missingEvents ?? []).length ? `Missing events: ${(ep.missingEvents ?? []).join(", ")}.` : "Registered, enabled, both events.",
      fix: epLevel === "ok" ? "" : "Stripe → Developers → Webhooks: endpoint https://greenwaymerch.com/api/stripe/webhook (no www), events checkout.session.completed + checkout.session.async_payment_succeeded; copy its signing secret into STRIPE_WEBHOOK_SECRET.",
      sop: "§4.2 S-7",
    });
    const co = shop.checkout ?? {};
    const sh = shop.shipping ?? {};
    add({ id: "H-11", group: "Shop & Stripe", title: "Checkout open", level: co.open ? "ok" : "fail", detail: co.open ? `Open. Shipping ${cents(sh.flatCents)} first item, ${cents(sh.extraItemCents)} each extra, free over ${sh.freeOverCents ? cents(sh.freeOverCents) : "(off)"}.` : `Closed: ${co.problem || "unknown reason"}`, fix: co.open ? "" : "Set the variable named in the message in the merch project and redeploy.", sop: "§4.4.1" });
    add({ id: "H-12", group: "Shop & Stripe", title: "Stripe Tax", level: s.automaticTax ? "ok" : "warn", detail: s.automaticTax ? "Automatic tax is on." : "MERCH_STRIPE_AUTOMATIC_TAX is not true: no sales tax is charged at checkout.", fix: s.automaticTax ? "" : "Finish Stripe Tax setup (WA registration), then set MERCH_STRIPE_AUTOMATIC_TAX=true.", sop: "§4.2 S-8" });
    const em = shop.email ?? {};
    const emailOk = !!em.resendKeySet && !!em.fromSet;
    add({ id: "H-13", group: "Email", title: "Shop email (receipts, alerts)", level: emailOk ? (em.alertToSet ? "ok" : "warn") : "fail", detail: emailOk ? (em.alertToSet ? "Resend key, sender and owner alert address set." : "MERCH_ORDER_ALERT_EMAIL is not set: owner alerts only go to the logs.") : `Missing: ${[!em.resendKeySet && "RESEND_API_KEY", !em.fromSet && "MERCH_EMAIL_FROM"].filter(Boolean).join(", ")}. Shipped emails and owner alerts only go to the logs.`, fix: emailOk && em.alertToSet ? "" : "Add the missing variables in the merch project (SOP-11 S-11) and redeploy.", sop: "§4.2 S-11" });
    const held = s.held ?? null;
    add({ id: "H-15", group: "Shop & Stripe", title: "Card holds waiting", level: !held ? "unknown" : held.problem ? "warn" : (held.over3Days ?? 0) > 0 ? "fail" : (held.count ?? 0) > 0 ? "warn" : "ok", detail: !held ? "Needs a working Stripe key (H-9)." : held.problem ? held.problem : (held.count ?? 0) === 0 ? "No card is waiting for capture." : `${held.count} card hold(s) waiting; oldest ${held.oldestDays} day(s). Stripe releases a hold after about 7 days.`, fix: held && (held.count ?? 0) > 0 ? "Stripe → Payments → Uncaptured: capture (WA order you will fill) or cancel each one." : "", sop: "§4.20" });
    add({ id: "H-19", group: "Shop & Stripe", title: "Auto-confirm", level: shop.autoConfirm ? "warn" : "ok", detail: shop.autoConfirm ? "MERCH_PRINTFUL_AUTO_CONFIRM is on: paid orders go to production with no review." : "Off: every paid order waits as a Printful draft for your Confirm (recommended until 20+ clean orders).", fix: shop.autoConfirm ? "Remove MERCH_PRINTFUL_AUTO_CONFIRM in the merch project unless you mean it." : "", sop: "§4.18" });
  } else {
    for (const [id, group, title, sop] of [["H-9", "Shop & Stripe", "Stripe secret key", "§4.2 S-6"], ["H-10", "Shop & Stripe", "Stripe webhook endpoint", "§4.2 S-7"], ["H-11", "Shop & Stripe", "Checkout open", "§4.4.1"], ["H-12", "Shop & Stripe", "Stripe Tax", "§4.2 S-8"], ["H-13", "Email", "Shop email (receipts, alerts)", "§4.2 S-11"], ["H-15", "Shop & Stripe", "Card holds waiting", "§4.20"], ["H-19", "Shop & Stripe", "Auto-confirm", "§4.18"]] as const) add(unknownShop(id, group, title, sop));
  }
  const st = statusPageLevel(i.statusPages.stripe);
  const rs = statusPageLevel(i.statusPages.resend);
  const worst = (a: MerchCheckLevel, b: MerchCheckLevel): MerchCheckLevel => (["fail", "warn", "unknown", "ok"] as const).find((l) => l === a || l === b) ?? "ok";
  add({ id: "H-14", group: "Services", title: "Stripe and Resend service status", level: worst(st.level, rs.level), detail: `Stripe: ${st.text} · Resend: ${rs.text}`, fix: st.level === "ok" && rs.level === "ok" ? "" : "Nothing to fix on our side; watch stripestatus.com / resend-status.com.", sop: "§6" });

  // ---------------- Orders, stock, storage (H-16 ... H-18) ----------------
  if (i.drafts && i.drafts.status === 200) {
    const list = Array.isArray(i.drafts.body) ? i.drafts.body : [];
    const now = Date.parse(i.nowIso) / 1000;
    const old = list.filter((o) => { const c = Number((o as { created?: unknown })?.created); return Number.isFinite(c) && now - c > DAY_MS / 1000; });
    add({ id: "H-16", group: "Printful", title: "Drafts waiting for Confirm", level: old.length ? "warn" : "ok", detail: list.length === 0 ? "No draft orders." : `${list.length} draft(s); ${old.length} older than a day.`, fix: old.length ? "Orders → Merch → open each draft → Confirm (or Cancel)." : "", sop: "§4.17" });
  } else {
    add({ id: "H-16", group: "Printful", title: "Drafts waiting for Confirm", level: "unknown", detail: i.drafts ? pfProblem(i.drafts) : "Needs a working token (H-1).", fix: "", sop: "§4.17" });
  }
  const syncAge = i.catalog.oldestStockSyncIso ? (Date.parse(i.nowIso) - Date.parse(i.catalog.oldestStockSyncIso)) / DAY_MS : null;
  add({ id: "H-17", group: "Catalog", title: "Stock copied from Printful", level: i.catalog.live === 0 ? "ok" : i.catalog.neverSynced > 0 || syncAge === null || syncAge > 1 ? "warn" : "ok", detail: i.catalog.live === 0 ? "No live products." : i.catalog.neverSynced > 0 ? `${i.catalog.neverSynced} live product(s) never had stock copied.` : syncAge === null ? "Unknown." : `Oldest stock copy ${Math.floor(syncAge * 24)} hour(s) ago.`, fix: i.catalog.live > 0 && (i.catalog.neverSynced > 0 || syncAge === null || syncAge > 1) ? "Merch Inventory → Copy Printful stock. The automatic copy runs every 6 hours (M-6); if it is over a day old, check Vercel → the main project → Cron Jobs → /api/cron/merch-stock." : "", sop: "§4.15" });
  const bucketsOk = i.buckets.media !== false && i.buckets.merchFiles !== false;
  add({ id: "H-18", group: "Catalog", title: "File storage", level: i.buckets.media === null || i.buckets.merchFiles === null ? "unknown" : bucketsOk ? "ok" : "fail", detail: `media bucket (published print files): ${i.buckets.media === null ? "?" : i.buckets.media ? "yes" : "MISSING"} · merch-files bucket (proofs, mockups): ${i.buckets.merchFiles === null ? "?" : i.buckets.merchFiles ? "yes" : "MISSING"}.`, fix: bucketsOk ? "" : "Apply the missing migration in Supabase (media: 0012, merch-files: 0281).", sop: "§4.9" });

  checks.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
  const fails = checks.filter((c) => c.level === "fail");
  const warns = checks.filter((c) => c.level === "warn");
  const status = fails.length ? "fail" : warns.length ? "warn" : "ok";
  const summary = status === "ok" ? `All ${checks.length} merch checks are green.` : `${fails.length} red, ${warns.length} amber: ${[...fails, ...warns].slice(0, 4).map((c) => c.title).join("; ")}${fails.length + warns.length > 4 ? "; …" : ""}.`;
  return { status, summary, checks, at: i.nowIso };
}

/** The ids that are red, sorted, for "did anything change since last run?". */
export function redIds(r: Pick<MerchHealthReport, "checks"> | null | undefined): string[] {
  return (r?.checks ?? []).filter((c) => c.level === "fail").map((c) => c.id).sort();
}

/** Email only when the set of red checks changed (new red, or a red cleared), plus a Monday digest. */
export function shouldAlert(prev: Pick<MerchHealthReport, "checks"> | null, next: Pick<MerchHealthReport, "checks">, isMonday: boolean): { send: boolean; why: "changed" | "weekly" | "none" } {
  const a = redIds(prev).join();
  const b = redIds(next).join();
  if (prev && a !== b) return { send: true, why: "changed" };
  if (!prev && b) return { send: true, why: "changed" };
  if (isMonday) return { send: true, why: "weekly" };
  return { send: false, why: "none" };
}

export const MERCH_HEALTH_KIND = "merch_health";
export const MERCH_HEALTH_SETTINGS_KEY = "merch_health_settings";
export const MERCH_HEALTH_PAGE = "/admin/merch-studio/health";

export function normalizeHealthSettings(v: unknown): { printfulTokenExpires: string } {
  const d = String((v as { printfulTokenExpires?: unknown } | null)?.printfulTokenExpires ?? "");
  return { printfulTokenExpires: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "" };
}

export function __runMerchHealthCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (name: string, c: boolean) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-health-core: ${name}`); } };
  const now = "2026-11-11T12:00:00Z";
  const base: MerchHealthInput = {
    nowIso: now, shopOrigin: "https://greenwaymerch.com", printfulConfigured: true,
    scopes: { status: 200, body: { scopes: [{ scope: "orders" }, { scope: "webhooks" }, { scope: "stores_list" }] } },
    stores: { status: 200, body: [{ id: 1, name: "greenway-websites" }] },
    webhooks: { status: 200, body: { url: "https://greenwaymerch.com/api/printful/webhook/abcdefghijklmnopqrstuvwxyz123456", types: [...PRINTFUL_WEBHOOK_TYPES, PRINTFUL_STOCK_TYPE], params: { stock_updated: { product_ids: [71] } } } },
    drafts: { status: 200, body: [] },
    tokenExpires: "2027-06-01",
    shop: { status: 200, body: { feed: { ok: true, status: 200, products: 2 }, products: 2, checkout: { open: true }, shipping: { set: true, flatCents: 599, extraItemCents: 200, freeOverCents: 7500 }, stripe: { keyMode: "live", webhookSecretSet: true, automaticTax: true, endpoint: { found: true, enabled: true, missingEvents: [], wrongHost: [] }, held: { count: 0, over3Days: 0, oldestDays: 0 } }, email: { resendKeySet: true, fromSet: true, alertToSet: true }, autoConfirm: false } },
    statusPages: { printful: { status: 200, body: { status: { indicator: "none", description: "All Systems Operational" } } }, stripe: { status: 200, body: { status: { indicator: "none", description: "ok" } } }, resend: { status: 200, body: { status: { indicator: "none", description: "ok" } } } },
    catalog: { readError: null, live: 2, oldestStockSyncIso: "2026-11-11T06:00:00Z", neverSynced: 0, productIds: [71] },
    buckets: { media: true, merchFiles: true },
  };
  const g = buildMerchHealth(base);
  ok("19 checks, H-1..H-19 in order", g.checks.length === 19 && g.checks.map((c) => c.id).join() === Array.from({ length: 19 }, (_, n) => `H-${n + 1}`).join());
  ok("all green", g.status === "ok" && g.checks.every((c) => c.level === "ok"));
  ok("F-11-1 redirect is red on H-8 and H-7", (() => { const r = buildMerchHealth({ ...base, shop: { status: 200, body: { ...base.shop!.body!, feed: { ok: false, status: 308, problem: "The feed address redirects to https://www…" }, products: 0 } } }); return r.checks.find((c) => c.id === "H-8")!.level === "fail" && r.checks.find((c) => c.id === "H-7")!.level === "fail" && r.status === "fail"; })());
  ok("no shop token -> shop checks unknown, not green", (() => { const r = buildMerchHealth({ ...base, shop: null }); return ["H-7", "H-9", "H-10", "H-11", "H-15", "H-19"].every((id) => r.checks.find((c) => c.id === id)!.level === "unknown") && r.checks.find((c) => c.id === "H-9")!.detail.includes("MERCH_HEALTH_TOKEN"); })());
  ok("shop 404 explains the token", buildMerchHealth({ ...base, shop: { status: 404, body: null } }).checks.find((c) => c.id === "H-11")!.detail.includes("same value in both"));
  ok("printful 401 -> H-1 red", buildMerchHealth({ ...base, scopes: { status: 401, body: null } }).checks.find((c) => c.id === "H-1")!.level === "fail");
  ok("no token -> H-1 red", buildMerchHealth({ ...base, printfulConfigured: false, scopes: null }).checks[0].level === "fail");
  ok("missing orders scope red; missing webhooks amber", buildMerchHealth({ ...base, scopes: { status: 200, body: { scopes: [{ scope: "webhooks" }, { scope: "stores_list/read" }] } } }).checks[1].level === "fail" && buildMerchHealth({ ...base, scopes: { status: 200, body: { scopes: [{ scope: "orders" }, { scope: "stores_list" }] } } }).checks[1].level === "warn");
  ok("expiry: none amber, 20 days amber, 5 days red, expired red", [["", "warn"], ["2026-12-01", "warn"], ["2026-11-16", "fail"], ["2026-11-01", "fail"], ["2027-01-01", "ok"]].every(([d, l]) => buildMerchHealth({ ...base, tokenExpires: d }).checks[2].level === l));
  ok("webhook missing / elsewhere red, missing type amber", buildMerchHealth({ ...base, webhooks: { status: 200, body: { url: "", types: [] } } }).checks[4].level === "fail" && buildMerchHealth({ ...base, webhooks: { status: 200, body: { url: "https://old.example.com/hook", types: [...PRINTFUL_WEBHOOK_TYPES] } } }).checks[4].level === "fail" && buildMerchHealth({ ...base, webhooks: { status: 200, body: { url: (base.webhooks!.body as { url: string }).url, types: ["package_shipped"] } } }).checks[4].level === "warn");
  ok("M-6: no stock_updated -> amber; an unwatched garment -> amber naming it", buildMerchHealth({ ...base, webhooks: { status: 200, body: { url: (base.webhooks!.body as { url: string }).url, types: [...PRINTFUL_WEBHOOK_TYPES] } } }).checks[4].level === "warn" && (() => { const c = buildMerchHealth({ ...base, catalog: { ...base.catalog, productIds: [71, 12] } }).checks[4]; return c.level === "warn" && c.detail.includes("#12") && !c.detail.includes("#71"); })());
  ok("webhook detail never prints the token", !buildMerchHealth({ ...base, webhooks: { status: 200, body: { url: "https://old.example.com/api/printful/webhook/SECRETSECRETSECRET", types: [] } } }).checks[4].detail.includes("SECRET"));
  ok("test key amber, missing red", buildMerchHealth({ ...base, shop: { status: 200, body: { ...base.shop!.body!, stripe: { ...base.shop!.body!.stripe!, keyMode: "test" } } } }).checks[8].level === "warn" && buildMerchHealth({ ...base, shop: { status: 200, body: { ...base.shop!.body!, stripe: { ...base.shop!.body!.stripe!, keyMode: "missing" } } } }).checks[8].level === "fail");
  ok("disabled endpoint red; www endpoint explained", (() => { const sb = base.shop!.body!; const a = buildMerchHealth({ ...base, shop: { status: 200, body: { ...sb, stripe: { ...sb.stripe!, endpoint: { found: true, enabled: false, missingEvents: [] } } } } }); const b = buildMerchHealth({ ...base, shop: { status: 200, body: { ...sb, stripe: { ...sb.stripe!, endpoint: { found: false, enabled: false, missingEvents: ["x"], wrongHost: ["https://www.greenwaymerch.com/api/stripe/webhook"] } } } } }); return a.checks[9].level === "fail" && b.checks[9].detail.includes("www"); })());
  ok("checkout closed red with the reason; shipping shown in cents->$", (() => { const sb = base.shop!.body!; const r = buildMerchHealth({ ...base, shop: { status: 200, body: { ...sb, checkout: { open: false, problem: "Shipping price is not set up yet (MERCH_SHIP_FLAT_CENTS)." } } } }); return r.checks[10].level === "fail" && r.checks[10].detail.includes("MERCH_SHIP_FLAT_CENTS") && g.checks[10].detail.includes("$5.99") && g.checks[10].detail.includes("$75.00"); })());
  ok("held card over 3 days red", buildMerchHealth({ ...base, shop: { status: 200, body: { ...base.shop!.body!, stripe: { ...base.shop!.body!.stripe!, held: { count: 1, over3Days: 1, oldestDays: 4 } } } } }).checks[14].level === "fail");
  ok("auto-confirm on amber", buildMerchHealth({ ...base, shop: { status: 200, body: { ...base.shop!.body!, autoConfirm: true } } }).checks[18].level === "warn");
  ok("status page major red, maintenance amber, no answer unknown", statusPageLevel({ status: 200, body: { status: { indicator: "major" } } }).level === "fail" && statusPageLevel({ status: 200, body: { status: { indicator: "maintenance" } } }).level === "warn" && statusPageLevel(null).level === "unknown");
  ok("old draft amber", buildMerchHealth({ ...base, drafts: { status: 200, body: [{ created: Date.parse(now) / 1000 - 2 * 86400 }] } }).checks[15].level === "warn");
  ok("stock never synced amber; missing bucket red", buildMerchHealth({ ...base, catalog: { ...base.catalog, neverSynced: 1 } }).checks[16].level === "warn" && buildMerchHealth({ ...base, buckets: { media: true, merchFiles: false } }).checks[17].level === "fail");
  ok("shouldAlert: change, cleared, weekly, quiet", shouldAlert({ checks: g.checks }, { checks: g.checks }, false).send === false && shouldAlert({ checks: g.checks }, buildMerchHealth({ ...base, printfulConfigured: false, scopes: null }), false).why === "changed" && shouldAlert(buildMerchHealth({ ...base, printfulConfigured: false, scopes: null }), { checks: g.checks }, false).why === "changed" && shouldAlert({ checks: g.checks }, { checks: g.checks }, true).why === "weekly" && shouldAlert(null, { checks: g.checks }, false).send === false);
  ok("settings normalized", normalizeHealthSettings({ printfulTokenExpires: "2027-01-02" }).printfulTokenExpires === "2027-01-02" && normalizeHealthSettings({ printfulTokenExpires: "soon" }).printfulTokenExpires === "" && normalizeHealthSettings(null).printfulTokenExpires === "");
  ok("daysUntil", daysUntil("2026-11-12", now) === 1 && daysUntil("bad", now) === null);
  return { passed, failed };
}
