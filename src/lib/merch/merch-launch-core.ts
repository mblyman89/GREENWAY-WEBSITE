/**
 * src/lib/merch/merch-launch-core.ts  (D232 slice M-3a, SOP-11 B.5 item 1, G-78)
 *
 * Owner (D231, verbatim, the coaching he asked for): "first step, do this,
 * done great, step two…". D232: "I want to build all things, serious to not
 * serious. The big to the small."
 *
 * PURE. The Setup & Launch coach: one card per SOP-11 §4.2 step S-1 … S-12
 * plus the §4.5 test order. A step is proved done by Merch Health checks
 * (M-2) where a check exists, and by the owner's tick where only a human can
 * see it (a Printful billing page, a Resend domain). A step whose check goes
 * red later re-opens itself ("needs you"), even if it was ticked.
 *
 * Progress is stored in site_settings key `merch_launch_progress` (no
 * migration). The Printful token expiry stays in `merch_health_settings`
 * (M-2), so the date typed on the coach also drives H-3.
 */
import type { MerchCheck, MerchCheckLevel, MerchHealthReport } from "./merch-health-core";

export const MERCH_LAUNCH_KEY = "merch_launch_progress";
export const MERCH_LAUNCH_LABEL = "Merch Setup & Launch progress (D232 M-3)";
export const MERCH_LAUNCH_PAGE = "/admin/merch-studio/launch";
export const MERCH_LAUNCH_RECORD_PAGE = "/admin/merch-studio/launch/record";

export type LaunchStepId = "S-1" | "S-2" | "S-3" | "S-4" | "S-5" | "S-6" | "S-7" | "S-8" | "S-9" | "S-10" | "S-11" | "S-12" | "T";

/** A Merch Health check that proves (part of) a step, and the levels that count as passed. */
export interface LaunchProof { id: string; accept: readonly MerchCheckLevel[] }

export interface LaunchCopy { label: string; value: string }

export interface LaunchStep {
  id: LaunchStepId;
  title: string;
  minutes: number;
  /** Three to six short lines: exact clicks. */
  todo: readonly string[];
  /** "You know it worked when…" (SOP-11 §4.2, verbatim meaning). */
  doneWhen: string;
  links: readonly { label: string; href: string }[];
  copy: readonly LaunchCopy[];
  proofs: readonly LaunchProof[];
  /** True when only the owner can see it is done (needs the tick). */
  manual: boolean;
  /** Form 8.1 note field shown on this card (saved with the progress). */
  note?: { key: LaunchNoteKey; label: string; type: "text" | "date" };
  sop: string;
}

export type LaunchNoteKey = "storeName" | "certStatus" | "liveDate" | "analyticsTokenExpires" | "signedBy" | "signedOn";
export const LAUNCH_NOTE_KEYS: readonly LaunchNoteKey[] = ["storeName", "certStatus", "liveDate", "analyticsTokenExpires", "signedBy", "signedOn"];

const OK: readonly MerchCheckLevel[] = ["ok"];
const OK_WARN: readonly MerchCheckLevel[] = ["ok", "warn"];

export const STRIPE_WEBHOOK_URL = "https://greenwaymerch.com/api/stripe/webhook";
export const STRIPE_WEBHOOK_EVENTS = "checkout.session.completed, checkout.session.async_payment_succeeded";
export const CATALOG_URL_WWW = "https://www.greenwaymarijuana.com/api/merch-catalog";

export const LAUNCH_STEPS: readonly LaunchStep[] = [
  {
    id: "S-1", title: "Make the secret tokens", minutes: 5, manual: true, sop: "§4.2 S-1, §4.3",
    todo: [
      "Open Terminal on your Mac and run: openssl rand -hex 32",
      "Run it four times. Each answer is one token.",
      "Save them in your password manager as Merch Token A (catalog), B (order desk), C (Printful webhook) and D (Merch Health).",
      "Never use the same value twice.",
    ],
    doneWhen: "You have four different long strings saved and none of them has a space.",
    links: [], copy: [{ label: "Command", value: "openssl rand -hex 32" }], proofs: [],
  },
  {
    id: "S-2", title: "Printful: the LLC account and its store", minutes: 10, manual: true, sop: "§4.2 S-2",
    todo: [
      "Sign in at printful.com with the LLC's login (not a personal one).",
      "Stores: there should be exactly one Manual order platform / API store.",
      "Settings → Store settings: set the packing slip to the Greenway Goods return address and email.",
      "Type the store name below.",
    ],
    doneWhen: "Stores shows exactly one API/manual store for greenwaymerch.com.",
    links: [{ label: "Printful dashboard", href: "https://www.printful.com/dashboard" }], copy: [],
    proofs: [{ id: "H-4", accept: OK_WARN }],
    note: { key: "storeName", label: "Store name", type: "text" },
  },
  {
    id: "S-3", title: "Printful: billing card, legal info, WA resale certificate", minutes: 15, manual: true, sop: "§4.2 S-3",
    todo: [
      "Billing → Legal info: the LLC's legal name and address.",
      "Billing → Billing methods: add the LLC's card (Printful charges it when you Confirm an order).",
      "Billing → Resale certificates → Add certificate → Washington (MTC or SSUTA form), sign it.",
      "Type the certificate status below (Approved, or Pending review and the date).",
    ],
    doneWhen: "Billing shows the card as the default method and the certificate says Approved (or Pending review).",
    links: [{ label: "Printful billing", href: "https://www.printful.com/dashboard/billing" }], copy: [], proofs: [],
    note: { key: "certStatus", label: "Certificate status", type: "text" },
  },
  {
    id: "S-4", title: "Printful: the private token", minutes: 10, manual: false, sop: "§4.2 S-4",
    todo: [
      "developers.printful.com → Your tokens → Create token, name greenway-websites.",
      "Access level: A single store → the store from step 2.",
      "Tick orders, webhooks, file_library, and stores_list if offered.",
      "Choose the longest expiry. Copy the token now (Printful shows it once).",
      "Type the expiry date below; Merch Health warns you 30 and 7 days before.",
    ],
    doneWhen: "Merch Health says the token works, has the permissions and the expiry date is saved.",
    links: [{ label: "Printful tokens", href: "https://developers.printful.com/tokens" }], copy: [{ label: "Token name", value: "greenway-websites" }],
    proofs: [{ id: "H-1", accept: OK }, { id: "H-2", accept: OK_WARN }, { id: "H-3", accept: OK }],
  },
  {
    id: "S-5", title: "Stripe: the LLC account", minutes: 20, manual: true, sop: "§4.2 S-5",
    todo: [
      "dashboard.stripe.com → top-left, pick (or create) Greenway Merchandising LLC. Never a dispensary account.",
      "Settings → Business details: entity, EIN and payout bank, until payments and payouts are enabled.",
      "Settings → Public details: statement descriptor GREENWAY GOODS, support email contact@greenwaymerch.com.",
    ],
    doneWhen: "The dashboard has no \"Activate payments\" banner and you can see the Test mode switch.",
    links: [{ label: "Stripe dashboard", href: "https://dashboard.stripe.com" }], copy: [{ label: "Support email", value: "contact@greenwaymerch.com" }], proofs: [],
  },
  {
    id: "S-6", title: "Stripe: the secret key (test first)", minutes: 5, manual: false, sop: "§4.2 S-6",
    todo: [
      "Test mode ON → Developers → API keys → copy the Secret key (sk_test_…).",
      "It goes into the merch project in step 9 as STRIPE_SECRET_KEY.",
      "When you go live, repeat with Test mode OFF (sk_live_…).",
    ],
    doneWhen: "Merch Health shows a Stripe secret key (test or live).",
    links: [{ label: "Stripe API keys", href: "https://dashboard.stripe.com/apikeys" }], copy: [{ label: "Variable", value: "STRIPE_SECRET_KEY" }],
    proofs: [{ id: "H-9", accept: OK_WARN }],
  },
  {
    id: "S-7", title: "Stripe: the webhook endpoint", minutes: 5, manual: false, sop: "§4.2 S-7",
    todo: [
      "Developers → Webhooks → Add endpoint (or Add destination → Webhook endpoint).",
      "URL exactly as below, no www.",
      "Events: the two below, nothing else needed.",
      "Open it → Signing secret → Reveal → copy whsec_… into STRIPE_WEBHOOK_SECRET (step 9).",
      "Test and live have separate endpoints: do it again in live mode.",
    ],
    doneWhen: "Merch Health shows the endpoint registered, enabled, with both events.",
    links: [{ label: "Stripe webhooks", href: "https://dashboard.stripe.com/webhooks" }],
    copy: [{ label: "Endpoint URL", value: STRIPE_WEBHOOK_URL }, { label: "Events", value: STRIPE_WEBHOOK_EVENTS }],
    proofs: [{ id: "H-10", accept: OK }],
  },
  {
    id: "S-8", title: "Stripe Tax (Washington)", minutes: 15, manual: false, sop: "§4.2 S-8",
    todo: [
      "Tax → Get started: head office = the LLC's WA address.",
      "Registrations → Add → United States → Washington with the LLC's sales-tax details.",
      "Only then add MERCH_STRIPE_AUTOMATIC_TAX = true in the merch project and redeploy.",
    ],
    doneWhen: "Merch Health shows Stripe Tax on.",
    links: [{ label: "Stripe Tax", href: "https://dashboard.stripe.com/tax" }], copy: [{ label: "Variable", value: "MERCH_STRIPE_AUTOMATIC_TAX" }, { label: "Value", value: "true" }],
    proofs: [{ id: "H-12", accept: OK }],
  },
  {
    id: "S-9", title: "Vercel: the merch project's variables", minutes: 15, manual: false, sop: "§4.2 S-9, §4.4.1",
    todo: [
      "Vercel → the greenwaymerch.com project → Settings → Environment Variables.",
      "Add every required row of SOP-11 §4.4.1 (Stripe, shipping cents, Resend, Printful, Tokens A, B, C and D).",
      "Mark secrets Sensitive.",
      "Deployments → ⋯ → Redeploy (variables only work after a redeploy).",
    ],
    doneWhen: "Merch Health shows checkout open and the catalog reaching the shop with no redirect.",
    links: [{ label: "Vercel", href: "https://vercel.com/dashboard" }],
    copy: [{ label: "MERCH_CATALOG_URL (optional)", value: CATALOG_URL_WWW }, { label: "Shipping example", value: "MERCH_SHIP_FLAT_CENTS = 599" }],
    proofs: [{ id: "H-11", accept: OK }, { id: "H-7", accept: OK_WARN }, { id: "H-8", accept: OK }],
  },
  {
    id: "S-10", title: "Printful: register the shipped webhook", minutes: 5, manual: false, sop: "§4.2 S-10",
    todo: [
      "Add PRINTFUL_WEBHOOK_TOKEN (Token C) to the MAIN Greenway project too, with the SAME value as the merch project, and redeploy.",
      "After step 9 is deployed, open Merch Health and press Register / repair the Printful webhook. It shows what is registered now, checks the shop accepts Token C, then sets all 5 events.",
      "Press it again after Token C changes or after you publish a new garment (H-5 tells you).",
    ],
    doneWhen: "Merch Health shows the webhook registered to the shop with all 5 events.",
    links: [{ label: "Merch Health", href: "/admin/merch-studio/health" }], copy: [{ label: "Event types", value: "package_shipped, order_failed, order_canceled, order_put_hold, stock_updated" }],
    proofs: [{ id: "H-5", accept: OK }],
  },
  {
    id: "S-11", title: "Resend (emails)", minutes: 15, manual: true, sop: "§4.2 S-11",
    todo: [
      "resend.com → Domains: greenwaymerch.com must say Verified (add its DNS records; keep the Google MX records).",
      "API Keys: a Sending access key → RESEND_API_KEY in the merch project.",
      "MERCH_EMAIL_FROM and MERCH_ORDER_ALERT_EMAIL as below, then redeploy.",
    ],
    doneWhen: "Resend → Domains says Verified (tick it) and Merch Health shows the shop's email set up.",
    links: [{ label: "Resend domains", href: "https://resend.com/domains" }],
    copy: [{ label: "MERCH_EMAIL_FROM", value: "Greenway Merch <orders@greenwaymerch.com>" }, { label: "MERCH_ORDER_ALERT_EMAIL", value: "orders@greenwaymerch.com" }],
    proofs: [{ id: "H-13", accept: OK }],
  },
  {
    id: "S-12", title: "Vercel: the main project's variables", minutes: 5, manual: false, sop: "§4.2 S-12, §4.4.2",
    todo: [
      "Main Greenway project → add MERCH_CATALOG_TOKEN (Token A, the same value as the shop).",
      "PRINTFUL_API_TOKEN (the same token as step 4); PRINTFUL_STORE_ID only for an Account token.",
      "MERCH_HEALTH_TOKEN (Token D, the same value as the shop).",
      "Optional for Reports → Merch: VERCEL_ANALYTICS_TOKEN, MERCH_VERCEL_PROJECT. Redeploy.",
    ],
    doneWhen: "Merch Health shows Printful connected and the catalog reaching the shop.",
    links: [{ label: "Vercel", href: "https://vercel.com/dashboard" }], copy: [],
    proofs: [{ id: "H-1", accept: OK }, { id: "H-7", accept: OK_WARN }],
    note: { key: "analyticsTokenExpires", label: "Vercel analytics token expires", type: "date" },
  },
  {
    id: "T", title: "The first test order (test, then live)", minutes: 30, manual: true, sop: "§4.5",
    todo: [
      "Publish a cheap test product; it shows on greenwaymerch.com within about a minute.",
      "Check out with a Washington address and test card 4242 4242 4242 4242.",
      "Stripe shows it Succeeded; Printful shows a Draft. In test mode, cancel it at Printful.",
      "Try an Oregon address: the hold is released and you get the \"not charged\" alert.",
      "Go live (live key, live webhook, live whsec_), redeploy, place one real order, then type the live date below.",
    ],
    doneWhen: "All 9 checks of SOP-11 §4.5 passed and form 8.1 is filled and signed.",
    links: [{ label: "greenwaymerch.com", href: "https://greenwaymerch.com" }], copy: [{ label: "Test card", value: "4242 4242 4242 4242" }], proofs: [],
    note: { key: "liveDate", label: "Went live on", type: "date" },
  },
];

export const LAUNCH_STEP_IDS: readonly LaunchStepId[] = LAUNCH_STEPS.map((s) => s.id);

// ---------------------------------------------------------------------------
// Stored progress
// ---------------------------------------------------------------------------
export interface LaunchTick { at: string; by: string | null }
export interface LaunchProgress { v: 1; ticks: Partial<Record<LaunchStepId, LaunchTick>>; notes: Partial<Record<LaunchNoteKey, string>> }

export const emptyLaunchProgress = (): LaunchProgress => ({ v: 1, ticks: {}, notes: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanNote(key: LaunchNoteKey, v: unknown): string {
  const s = (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  if (key === "liveDate" || key === "analyticsTokenExpires" || key === "signedOn") return DATE_RE.test(s) ? s : "";
  return s;
}

export function normalizeLaunchProgress(v: unknown): LaunchProgress {
  const out = emptyLaunchProgress();
  if (!isObj(v)) return out;
  const ticks = isObj(v.ticks) ? v.ticks : {};
  for (const id of LAUNCH_STEP_IDS) {
    const t = ticks[id];
    if (isObj(t) && typeof t.at === "string" && t.at) out.ticks[id] = { at: t.at.slice(0, 40), by: typeof t.by === "string" ? t.by.slice(0, 120) : null };
  }
  const notes = isObj(v.notes) ? v.notes : {};
  for (const k of LAUNCH_NOTE_KEYS) {
    const n = cleanNote(k, notes[k]);
    if (n) out.notes[k] = n;
  }
  return out;
}

export function setTick(p: LaunchProgress, id: LaunchStepId, done: boolean, tick: LaunchTick): LaunchProgress {
  const ticks = { ...p.ticks };
  if (done) ticks[id] = tick;
  else delete ticks[id];
  return { ...p, ticks };
}

export function setNote(p: LaunchProgress, key: LaunchNoteKey, value: string): LaunchProgress {
  const notes = { ...p.notes };
  const v = cleanNote(key, value);
  if (v) notes[key] = v;
  else delete notes[key];
  return { ...p, notes };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
export type LaunchStatus = "done" | "needs-you" | "in-progress" | "not-started";

export interface LaunchStepState {
  step: LaunchStep;
  status: LaunchStatus;
  /** Each proof with what Merch Health saw. */
  proofs: { id: string; title: string; level: MerchCheckLevel; passed: boolean; detail: string; fix: string }[];
  ticked: boolean;
  /** One line: why it is in this state. */
  why: string;
}

export interface LaunchSummary {
  steps: LaunchStepState[];
  done: number;
  total: number;
  minutesLeft: number;
  /** The first step that is not done (the "Next:" card), or null when all done. */
  next: LaunchStepState | null;
  /** The first step that re-opened (a red check), for the Studio header. */
  needsYou: LaunchStepState | null;
  /** True when no shop check could be read (MERCH_HEALTH_TOKEN not set up yet). */
  shopUnknown: boolean;
}

export function stepState(step: LaunchStep, checks: readonly MerchCheck[], progress: LaunchProgress): LaunchStepState {
  const ticked = !!progress.ticks[step.id];
  const proofs = step.proofs.map((p) => {
    const c = checks.find((x) => x.id === p.id);
    const level: MerchCheckLevel = c?.level ?? "unknown";
    return { id: p.id, title: c?.title ?? p.id, level, passed: p.accept.includes(level), detail: c?.detail ?? "Not checked yet.", fix: c?.fix ?? "" };
  });
  const red = proofs.filter((p) => p.level === "fail");
  const allPassed = proofs.every((p) => p.passed);
  const anyPassed = proofs.some((p) => p.passed);
  let status: LaunchStatus;
  let why: string;
  if (red.length > 0 && (ticked || anyPassed)) {
    status = "needs-you";
    why = `${red[0].id} ${red[0].title} is red: ${red[0].detail}`;
  } else if (allPassed && (!step.manual || ticked)) {
    status = "done";
    why = proofs.length ? (step.manual ? "Merch Health agrees and you ticked it." : "Merch Health confirms it.") : "You ticked it.";
  } else if (anyPassed || ticked) {
    status = "in-progress";
    why = !allPassed ? `Waiting on ${proofs.filter((p) => !p.passed).map((p) => `${p.id} ${p.title}`).join(", ")}.` : "Merch Health agrees. Tick it when you have checked the page yourself.";
  } else {
    status = "not-started";
    why = proofs.length ? (red.length ? `${red[0].id}: ${red[0].detail}` : "Not done yet.") : "Tick it when it is done.";
  }
  return { step, status, proofs, ticked, why };
}

export function summarizeLaunch(report: Pick<MerchHealthReport, "checks"> | null, progress: LaunchProgress): LaunchSummary {
  const checks = report?.checks ?? [];
  const steps = LAUNCH_STEPS.map((s) => stepState(s, checks, progress));
  const done = steps.filter((s) => s.status === "done").length;
  const minutesLeft = steps.filter((s) => s.status !== "done").reduce((a, s) => a + s.step.minutes, 0);
  const shopIds = ["H-7", "H-9", "H-10", "H-11", "H-12", "H-13"];
  const shopUnknown = shopIds.every((id) => (checks.find((c) => c.id === id)?.level ?? "unknown") === "unknown");
  return {
    steps,
    done,
    total: steps.length,
    minutesLeft,
    next: steps.find((s) => s.status !== "done") ?? null,
    needsYou: steps.find((s) => s.status === "needs-you") ?? null,
    shopUnknown,
  };
}

export function stepNumber(id: LaunchStepId): string {
  return id === "T" ? "Test order" : `Step ${id.slice(2)}`;
}

export function progressLine(s: Pick<LaunchSummary, "done" | "total" | "minutesLeft">): string {
  if (s.done === s.total) return `All ${s.total} done. greenwaymerch.com is set up.`;
  const h = Math.floor(s.minutesLeft / 60);
  const m = s.minutesLeft % 60;
  const left = h > 0 ? `about ${h} h${m ? ` ${m} min` : ""}` : `about ${m} minutes`;
  return `${s.done} of ${s.total} done · ${left} left`;
}

// ---------------------------------------------------------------------------
// Self-tests (run by tests/compliance/d232-merch-m3a-launch.test.ts)
// ---------------------------------------------------------------------------
export function __runMerchLaunchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-launch-core: ${name}`); } };
  const chk = (id: string, level: MerchCheckLevel): MerchCheck => ({ id, group: "Printful", title: id, level, detail: `${id} ${level}`, fix: "", sop: "" });

  ok(LAUNCH_STEPS.length === 13 && new Set(LAUNCH_STEP_IDS).size === 13, "13 unique steps");
  ok(LAUNCH_STEPS.every((s) => s.todo.length >= 3 && s.todo.length <= 6), "3 to 6 lines each");
  ok(LAUNCH_STEPS.every((s) => s.proofs.length > 0 || s.manual), "every step can be finished");
  ok(LAUNCH_STEPS.reduce((a, s) => a + s.minutes, 0) === 155, "about 2 h 35 min in total");

  const empty = summarizeLaunch(null, emptyLaunchProgress());
  ok(empty.done === 0 && empty.next?.step.id === "S-1" && empty.shopUnknown && !empty.needsYou, "nothing done, start at step 1");
  ok(progressLine(empty) === "0 of 13 done · about 2 h 35 min left", "progress line");

  const p1 = setTick(emptyLaunchProgress(), "S-1", true, { at: "2026-11-11T00:00:00Z", by: "o@x" });
  ok(summarizeLaunch(null, p1).steps[0].status === "done", "a manual-only step is done by the tick");
  ok(setTick(p1, "S-1", false, { at: "", by: null }).ticks["S-1"] === undefined, "untick");

  const s4ok = [chk("H-1", "ok"), chk("H-2", "warn"), chk("H-3", "ok")];
  ok(stepState(LAUNCH_STEPS[3], s4ok, emptyLaunchProgress()).status === "done", "S-4 done by checks alone (H-2 amber accepted)");
  ok(stepState(LAUNCH_STEPS[3], [chk("H-1", "ok"), chk("H-2", "ok"), chk("H-3", "warn")], emptyLaunchProgress()).status === "in-progress", "no expiry date -> in progress");
  ok(stepState(LAUNCH_STEPS[3], [chk("H-1", "fail"), chk("H-2", "unknown"), chk("H-3", "ok")], emptyLaunchProgress()).status === "needs-you", "token refused after it worked -> re-opens");
  ok(stepState(LAUNCH_STEPS[3], [chk("H-1", "fail")], emptyLaunchProgress()).status === "not-started", "red but never started -> not started");

  const s2 = LAUNCH_STEPS[1];
  ok(stepState(s2, [chk("H-4", "ok")], emptyLaunchProgress()).status === "in-progress", "manual + proof: health alone is not enough");
  ok(stepState(s2, [chk("H-4", "ok")], setTick(emptyLaunchProgress(), "S-2", true, { at: "x", by: null })).status === "done", "manual + proof + tick -> done");
  ok(stepState(s2, [chk("H-4", "fail")], setTick(emptyLaunchProgress(), "S-2", true, { at: "x", by: null })).status === "needs-you", "ticked but the check is red -> needs you");

  const n = normalizeLaunchProgress({ ticks: { "S-1": { at: "2026", by: "a" }, "S-99": { at: "x" }, "S-2": "junk" }, notes: { storeName: " Greenway \u0007 Goods ", liveDate: "tomorrow", signedOn: "2026-11-11", other: "x" } });
  ok(Object.keys(n.ticks).join() === "S-1", "only known steps with a time are kept");
  ok(n.notes.storeName === "Greenway   Goods" && n.notes.liveDate === undefined && n.notes.signedOn === "2026-11-11", "notes cleaned; dates must be dates");
  ok(normalizeLaunchProgress("junk").v === 1, "junk -> empty");
  ok(setNote(n, "storeName", "").notes.storeName === undefined, "an empty note clears it");
  return { passed, failed };
}
