/**
 * D232 M-2 (G-80, SOP-11 B.4) - the shop's own health answers. PURE: no
 * fetch, no env, no React. lib/health.ts gathers the inputs; the back
 * office's Merch Health page reads the result through /api/health.
 *
 * Nothing here ever returns a secret: only "set / not set", a key's MODE
 * (live or test) and the non-secret shipping amounts.
 */

export type StripeKeyMode = "live" | "test" | "missing" | "invalid";

/** sk_live_ / rk_live_ -> live, sk_test_ / rk_test_ -> test (checkout/route.ts uses the same pattern). */
export function stripeKeyMode(key: string): StripeKeyMode {
  const k = key.trim();
  if (!k) return "missing";
  const m = /^(sk|rk)_(live|test)_/.exec(k);
  return m ? (m[2] as "live" | "test") : "invalid";
}

/** The two Stripe events the shop's webhook handles (app/api/stripe/webhook/route.ts HANDLED). */
export const STRIPE_EVENTS_NEEDED = ["checkout.session.completed", "checkout.session.async_payment_succeeded"] as const;

export interface StripeEndpointCheck {
  found: boolean;
  url: string;
  enabled: boolean;
  missingEvents: string[];
  livemode: boolean | null;
  /** Endpoints that point at the www host (Stripe does not follow redirects, so they fail). */
  wrongHost: string[];
}

/**
 * Stripe GET /v1/webhook_endpoints `data` -> is our endpoint registered,
 * enabled and listening for both events? "*" (all events) counts as both.
 */
export function checkStripeEndpoints(data: unknown, expectedUrl: string): StripeEndpointCheck {
  const list = Array.isArray(data) ? data : [];
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  const want = norm(expectedUrl);
  const wantWww = want.replace("://", "://www.");
  const rows = list.filter((e): e is { url?: unknown; status?: unknown; enabled_events?: unknown; livemode?: unknown } => !!e && typeof e === "object");
  const mine = rows.find((e) => typeof e.url === "string" && norm(e.url) === want);
  const wrongHost = rows.filter((e) => typeof e.url === "string" && norm(e.url) === wantWww).map((e) => String(e.url));
  if (!mine) return { found: false, url: expectedUrl, enabled: false, missingEvents: [...STRIPE_EVENTS_NEEDED], livemode: null, wrongHost };
  const events = Array.isArray(mine.enabled_events) ? mine.enabled_events.map(String) : [];
  const all = events.includes("*");
  return {
    found: true,
    url: String(mine.url),
    enabled: mine.status === "enabled",
    missingEvents: all ? [] : STRIPE_EVENTS_NEEDED.filter((e) => !events.includes(e)),
    livemode: typeof mine.livemode === "boolean" ? mine.livemode : null,
    wrongHost,
  };
}

export interface HeldCards {
  count: number;
  /** Older than 3 days (Stripe releases an uncaptured card hold after about 7). */
  over3Days: number;
  oldestDays: number;
}

/** Stripe GET /v1/payment_intents `data` -> card holds still waiting for capture. */
export function heldCards(data: unknown, nowSec: number): HeldCards {
  const list = Array.isArray(data) ? data : [];
  const ages = list
    .filter((p): p is { status?: unknown; created?: unknown } => !!p && typeof p === "object")
    .filter((p) => p.status === "requires_capture" && typeof p.created === "number")
    .map((p) => Math.max(0, (nowSec - (p.created as number)) / 86400));
  return {
    count: ages.length,
    over3Days: ages.filter((d) => d > 3).length,
    oldestDays: ages.length ? Math.floor(Math.max(...ages) * 10) / 10 : 0,
  };
}

/** One Stripe call's outcome, in words. */
export function stripeCallProblem(status: number): string {
  if (status === 401) return "Stripe refused the key (wrong, revoked or rolled). Make a new secret key: SOP-11 S-6.";
  if (status === 403) return "The key works but is not allowed to read this. Use a standard secret key, or give the restricted key read access.";
  if (status === 429) return "Stripe is rate-limiting; try again in a minute.";
  if (status >= 500) return `Stripe had an error (${status}).`;
  if (status === 0) return "Could not reach Stripe (network error or timeout).";
  return `Stripe answered ${status}.`;
}

export function __runHealthCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site health-core: ${m}`); } };
  ok(stripeKeyMode("sk_live_abc") === "live" && stripeKeyMode("rk_test_x") === "test", "key modes");
  ok(stripeKeyMode("") === "missing" && stripeKeyMode("  ") === "missing" && stripeKeyMode("pk_live_x") === "invalid", "missing / publishable key invalid");
  const url = "https://greenwaymerch.com/api/stripe/webhook";
  const good = checkStripeEndpoints([{ url: `${url}/`, status: "enabled", enabled_events: [...STRIPE_EVENTS_NEEDED], livemode: true }], url);
  ok(good.found && good.enabled && good.missingEvents.length === 0 && good.livemode === true, "registered, enabled, both events (trailing slash ok)");
  const star = checkStripeEndpoints([{ url, status: "enabled", enabled_events: ["*"] }], url);
  ok(star.missingEvents.length === 0 && star.livemode === null, "* covers both");
  const off = checkStripeEndpoints([{ url, status: "disabled", enabled_events: ["checkout.session.completed"] }], url);
  ok(off.found && !off.enabled && off.missingEvents.join() === "checkout.session.async_payment_succeeded", "disabled + one missing");
  const www = checkStripeEndpoints([{ url: "https://www.greenwaymerch.com/api/stripe/webhook", status: "enabled", enabled_events: ["*"] }], url);
  ok(!www.found && www.wrongHost.length === 1 && www.missingEvents.length === 2, "www endpoint is flagged, not accepted");
  ok(!checkStripeEndpoints("nope", url).found, "garbage -> not found");
  const now = 1_800_000_000;
  const h = heldCards([{ status: "requires_capture", created: now - 4 * 86400 }, { status: "requires_capture", created: now - 3600 }, { status: "succeeded", created: now - 9 * 86400 }, null], now);
  ok(h.count === 2 && h.over3Days === 1 && h.oldestDays === 4, "held cards counted, only requires_capture");
  ok(heldCards(undefined, now).count === 0, "no list -> none");
  ok(stripeCallProblem(401).includes("S-6") && stripeCallProblem(0).includes("network"), "call problems in words");
  return { passed, failed };
}
