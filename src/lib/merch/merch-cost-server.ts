/**
 * src/lib/merch/merch-cost-server.ts  (D285 slice C)
 *
 * Nightly Printful cost check (run by the 12:40 UTC tick of /api/cron/merch-stock). For each LIVE product, asks Printful what its
 * priciest variant costs today (POST /orders/estimate-costs, v1, free, creates
 * nothing) with the product's real print files and a Washington address, and
 * compares it with the cost saved at publish (variant.printfulCents). A move
 * of 25c / 3% or more emails the owner once per day per set (claimed in
 * compliance_reminder_log, merch-cost:<day>:...). Also catches a garment that
 * Printful can no longer make (the estimate fails). Audited as
 * merch.cost_checked. Never throws; prices are never changed automatically.
 */
import "server-only";
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { pacificToday } from "@/lib/reports/timezone";
import { formatCents } from "@/lib/merch-studio/garment-catalog-core";
import { printful, printfulConfigured } from "@/lib/merch-studio/printful-client";
import { readMerchCatalog } from "./merch-inventory-store";
import { costDrifts, costProbes, estimateSubtotalCents, type CostCheck, type CostDrift } from "./merch-inventory-core";

const WA = { name: "Greenway cost check", address1: "1 Main St", city: "Seattle", state_code: "WA", country_code: "US", zip: "98101" };
const esc = (s: string) => s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");

export interface CostRunResult { ok: boolean; checked: number; drifts: number; failed: number; emailed: boolean; problem: string }

export async function runMerchCostCheck(): Promise<CostRunResult> {
  if (!printfulConfigured()) return { ok: false, checked: 0, drifts: 0, failed: 0, emailed: false, problem: "PRINTFUL_API_TOKEN is not set." };
  const cur = await readMerchCatalog();
  if (cur.readError) return { ok: false, checked: 0, drifts: 0, failed: 0, emailed: false, problem: cur.readError };
  const probes = costProbes(cur.catalog).slice(0, 40);
  const checks: CostCheck[] = []; const failed: string[] = [];
  await Promise.all(probes.map(async (p) => {
    const r = await printful<unknown>("POST", "/orders/estimate-costs", { recipient: WA, items: [{ variant_id: p.v.printfulVariantId, quantity: 1, files: p.files, options: p.options }] });
    const now = r.ok ? estimateSubtotalCents(r.result) : null;
    if (now === null) { failed.push(`${p.title} (${p.v.color} / ${p.v.size}): ${r.ok ? "no price in the answer" : r.error}`); return; }
    checks.push({ handle: p.handle, title: p.title, color: p.v.color, size: p.v.size, variantId: p.v.printfulVariantId, retailCents: p.v.retailCents, profitCents: p.v.profitCents, savedCents: p.v.printfulCents, nowCents: now });
  }));
  const drifts = costDrifts(checks);
  const emailed = drifts.length || failed.length ? await emailCost(drifts, failed) : false;
  await recordAudit({ actorId: null, actorEmail: "cron:merch-cost", action: "merch.cost_checked", entityType: "merch_catalog", entityId: "merch_catalog", after: { checked: checks.length, drifts: drifts.map((d) => ({ handle: d.handle, variantId: d.variantId, deltaCents: d.deltaCents })), failed: failed.length } });
  return { ok: true, checked: checks.length, drifts: drifts.length, failed: failed.length, emailed, problem: failed.slice(0, 3).join("; ") };
}

async function emailCost(drifts: readonly CostDrift[], failed: readonly string[]): Promise<boolean> {
  const to = (process.env.ORDER_STAFF_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const apiKey = process.env.RESEND_API_KEY ?? ""; const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from || !to.length) return false;
  const key = `merch-cost:${pacificToday()}:${drifts.map((d) => `${d.variantId}${d.deltaCents}`).join(",")}:${failed.length}`.slice(0, 200);
  const subject = `Merch: Printful cost changed on ${drifts.length} product${drifts.length === 1 ? "" : "s"}${failed.length ? ` (${failed.length} couldn't be priced)` : ""}`;
  try {
    const { error } = await createSupabaseAdminClient().from("compliance_reminder_log").insert({ dedupe_key: key, stage: "merch_cost", week_key: null, channel: "email", subject, recipients: to.join(", ").slice(0, 1000) });
    if (error && error.code === "23505") return false;
  } catch { /* send anyway */ }
  const rows = drifts.map((d) => `<li><b>${esc(d.title)}</b> (${esc(d.color)} / ${esc(d.size)}): Printful ${formatCents(d.savedCents)} &rarr; ${formatCents(d.nowCents)} (${d.deltaCents > 0 ? "+" : ""}${formatCents(d.deltaCents)}). Profit now about ${formatCents(d.newProfitCents)} (${(d.newMarginBps / 100).toFixed(0)}% margin).</li>`).join("");
  const bad = failed.map((f) => `<li>${esc(f)}</li>`).join("");
  const r = await sendStaffAlertEmail({ apiKey, from, to, subject, html: `<p>Tonight's Printful price check. Nothing was changed on the site; adjust prices in Merch Inventory &rarr; Edit if you want to.</p>${rows ? `<ul>${rows}</ul>` : ""}${bad ? `<p>Couldn't be priced (Printful may no longer make it):</p><ul>${bad}</ul>` : ""}<p><a href="${publicSiteOrigin(process.env)}/admin/inventory/merch">Open Merch Inventory</a></p>` }).catch(() => ({ ok: false }));
  return r.ok;
}
