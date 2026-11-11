/**
 * D232 M-2 (G-80) - gather the shop's health facts (server only). Read-only:
 * two GET calls to Stripe with the shop's own key, plus the env shape and
 * the last catalog-feed result. Never returns a secret value.
 */
import { freshProducts, lastFeedStatus } from "./catalog";
import { parseShippingConfig } from "./checkout-core";
import { checkStripeEndpoints, heldCards, stripeCallProblem, stripeKeyMode, type HeldCards, type StripeEndpointCheck, type StripeKeyMode } from "./health-core";
import type { FeedStatus } from "./feed-core";
import { siteUrl } from "./site";

const env = (k: string) => (process.env[k] ?? "").trim();
const long = (k: string, min: number) => env(k).length >= min;

export interface ShopHealth {
  version: 1;
  at: string;
  site: string;
  feed: FeedStatus | null;
  products: number;
  checkout: { open: boolean; problem: string };
  shipping: { set: boolean; flatCents: number | null; extraItemCents: number | null; freeOverCents: number | null; minDays: number | null; maxDays: number | null; problem: string };
  stripe: {
    keyMode: StripeKeyMode;
    webhookSecretSet: boolean;
    automaticTax: boolean;
    endpoint: (StripeEndpointCheck & { problem: string }) | null;
    held: (HeldCards & { problem: string }) | null;
  };
  email: { resendKeySet: boolean; fromSet: boolean; alertToSet: boolean };
  printful: { tokenSet: boolean; storeIdSet: boolean; webhookTokenSet: boolean };
  adminKeySet: boolean;
  catalogTokenSet: boolean;
  autoConfirm: boolean;
}

async function stripeGet(key: string, path: string): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
    return { status: res.status, data: body?.data };
  } catch {
    return { status: 0, data: null };
  }
}

export async function gatherShopHealth(): Promise<ShopHealth> {
  const key = env("STRIPE_SECRET_KEY");
  const keyMode = stripeKeyMode(key);
  const ship = parseShippingConfig(process.env);
  const site = siteUrl();

  // One fresh feed read so `feed` reflects right now, not the last page view.
  const products = await freshProducts().then((p) => p.length).catch(() => 0);

  let endpoint: ShopHealth["stripe"]["endpoint"] = null;
  let held: ShopHealth["stripe"]["held"] = null;
  if (keyMode === "live" || keyMode === "test") {
    const [ep, pi] = await Promise.all([stripeGet(key, "/v1/webhook_endpoints?limit=100"), stripeGet(key, "/v1/payment_intents?limit=100")]);
    endpoint = ep.status === 200
      ? { ...checkStripeEndpoints(ep.data, `${site}/api/stripe/webhook`), problem: "" }
      : { found: false, url: `${site}/api/stripe/webhook`, enabled: false, missingEvents: [], livemode: null, wrongHost: [], problem: stripeCallProblem(ep.status) };
    held = pi.status === 200
      ? { ...heldCards(pi.data, Math.floor(Date.now() / 1000)), problem: "" }
      : { count: 0, over3Days: 0, oldestDays: 0, problem: stripeCallProblem(pi.status) };
  }

  const keyOk = keyMode === "live" || keyMode === "test";
  return {
    version: 1,
    at: new Date().toISOString(),
    site,
    feed: lastFeedStatus(),
    products,
    checkout: {
      open: keyOk && !!ship.config,
      problem: !keyOk ? (keyMode === "missing" ? "STRIPE_SECRET_KEY is not set." : "STRIPE_SECRET_KEY is not a secret key (it must start sk_live_, sk_test_, rk_live_ or rk_test_).") : ship.problem ?? "",
    },
    shipping: {
      set: !!ship.config,
      flatCents: ship.config?.flatCents ?? null,
      extraItemCents: ship.config?.extraItemCents ?? null,
      freeOverCents: ship.config?.freeOverCents ?? null,
      minDays: ship.config?.minDays ?? null,
      maxDays: ship.config?.maxDays ?? null,
      problem: ship.problem ?? "",
    },
    stripe: {
      keyMode,
      webhookSecretSet: /^whsec_/.test(env("STRIPE_WEBHOOK_SECRET")),
      automaticTax: env("MERCH_STRIPE_AUTOMATIC_TAX") === "true",
      endpoint,
      held,
    },
    email: { resendKeySet: env("RESEND_API_KEY").length > 0, fromSet: env("MERCH_EMAIL_FROM").length > 0, alertToSet: env("MERCH_ORDER_ALERT_EMAIL").length > 0 },
    printful: { tokenSet: env("PRINTFUL_API_TOKEN").length > 0, storeIdSet: env("PRINTFUL_STORE_ID").length > 0, webhookTokenSet: long("PRINTFUL_WEBHOOK_TOKEN", 16) },
    adminKeySet: long("MERCH_ADMIN_KEY", 16),
    catalogTokenSet: long("MERCH_CATALOG_TOKEN", 32),
    autoConfirm: env("MERCH_PRINTFUL_AUTO_CONFIRM") === "true",
  };
}
