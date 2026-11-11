/**
 * src/lib/merch/merch-webhook-server.ts  (D232 slice M-6, SOP-11 G-89)
 *
 * Server side of Merch Health's "Register / repair the Printful webhook".
 *   previewWebhook(): GET /webhooks (what is there now) + the plan
 *                     (merch-webhook-core.planWebhook). Changes nothing.
 *   applyWebhook():   re-reads, re-plans, PROBES the shop's webhook URL with
 *                     a harmless event (the shop answers 200 only when Token
 *                     C matches; anything else stops here), then POST
 *                     /webhooks with all 5 types, then GET again to confirm.
 * Printful: "only one webhook URL can be active for a store, so calling this
 * method disables all existing webhook configuration" - which is why the
 * plan keeps any extra type already registered and the probe runs first.
 * Nothing returned contains Token C (only maskWebhookUrl output).
 */
import "server-only";
import { printful, printfulConfigured } from "@/lib/merch-studio/printful-client";
import { readMerchCatalog } from "./merch-inventory-store";
import { merchShopOrigin } from "./merch-health-server";
import { PROBE_EVENT, maskWebhookUrl, planWebhook, probeProblem, readWebhookInfo, type WebhookInfo } from "./merch-webhook-core";

export interface WebhookPreview {
  ok: boolean;
  error: string;
  current: { url: string; types: string[]; productIds: number[] } | null;
  next: { url: string; types: string[]; productIds: number[] } | null;
  changes: string[];
  noChange: boolean;
  urlSource: "kept" | "env" | null;
}

const shown = (i: WebhookInfo) => ({ url: maskWebhookUrl(i.url), types: i.types, productIds: i.productIds });

async function readCurrent(): Promise<{ info: WebhookInfo | null; error: string }> {
  if (!printfulConfigured()) return { info: null, error: "Printful isn't connected here: add PRINTFUL_API_TOKEN to the main project (SOP-11 S-4)." };
  const r = await printful<unknown>("GET", "/webhooks");
  if (!r.ok) return { info: null, error: r.status === 401 || r.status === 403 ? `${r.error}. The token needs the webhooks permission (make a new token with it ticked, SOP-11 S-4).` : r.error };
  return { info: readWebhookInfo(r.result), error: "" };
}

async function catalogIds(): Promise<{ ids: number[]; error: string }> {
  const c = await readMerchCatalog();
  if (c.readError) return { ids: [], error: `Couldn't read the merch catalog: ${c.readError}` };
  return { ids: [...new Set(c.catalog.items.map((i) => i.pkg.product.blank.printfulProductId))], error: "" };
}

export async function previewWebhook(): Promise<WebhookPreview> {
  const [cur, cat] = await Promise.all([readCurrent(), catalogIds()]);
  if (!cur.info) return { ok: false, error: cur.error, current: null, next: null, changes: [], noChange: false, urlSource: null };
  if (cat.error) return { ok: false, error: cat.error, current: shown(cur.info), next: null, changes: [], noChange: false, urlSource: null };
  const plan = planWebhook({ current: cur.info, shopOrigin: merchShopOrigin(), envToken: process.env.PRINTFUL_WEBHOOK_TOKEN ?? "", catalogProductIds: cat.ids });
  if (!plan.ok) return { ok: false, error: plan.error, current: shown(cur.info), next: null, changes: [], noChange: false, urlSource: null };
  return { ok: true, error: "", current: shown(cur.info), next: plan.shown, changes: plan.changes, noChange: plan.noChange, urlSource: plan.urlSource };
}

async function probe(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(PROBE_EVENT), redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    return res.status;
  } catch {
    return 0;
  }
}

export type WebhookApply =
  | { ok: true; before: WebhookPreview["current"]; after: WebhookPreview["current"]; changes: string[] }
  | { ok: false; error: string; before: WebhookPreview["current"] };

export async function applyWebhook(): Promise<WebhookApply> {
  const [cur, cat] = await Promise.all([readCurrent(), catalogIds()]);
  if (!cur.info) return { ok: false, error: cur.error, before: null };
  const before = shown(cur.info);
  if (cat.error) return { ok: false, error: cat.error, before };
  const plan = planWebhook({ current: cur.info, shopOrigin: merchShopOrigin(), envToken: process.env.PRINTFUL_WEBHOOK_TOKEN ?? "", catalogProductIds: cat.ids });
  if (!plan.ok) return { ok: false, error: plan.error, before };
  const status = await probe(plan.url);
  const problem = probeProblem(status);
  if (problem) return { ok: false, error: problem, before };
  const set = await printful<unknown>("POST", "/webhooks", plan.body);
  if (!set.ok) return { ok: false, error: `Printful refused the registration: ${set.error}. Press Check again to see what is registered now.`, before };
  const again = await readCurrent();
  const after = again.info ? shown(again.info) : shown(readWebhookInfo(set.result));
  return { ok: true, before, after, changes: plan.changes };
}
