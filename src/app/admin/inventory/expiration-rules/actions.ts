"use server";

/**
 * src/app/admin/inventory/expiration-rules/actions.ts  (R34)
 *
 * Save rules (one form, all-or-nothing), preview, and apply. Every write is
 * audited. Apply only proceeds when the plan still matches the preview the
 * owner saw (planFingerprint); otherwise it bounces back to a fresh preview.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { EXPIRY_CITATIONS } from "@/lib/inventory/expiry-research-core";
import {
  planFingerprint,
  planRuleSaves,
  describeRule,
  type RuleFormRow,
} from "@/lib/inventory/expiry-rules-core";
import {
  applyExpiryRules,
  deleteExpiryRule,
  listExpiryRules,
  previewExpiryRules,
  saveExpiryRule,
} from "@/lib/inventory/expiry-rules-store";

const BASE = "/admin/inventory/expiration-rules";
const KNOWN_CITATIONS = new Set(EXPIRY_CITATIONS.map((c) => c.key));

function back(params: Record<string, string>): never {
  const q = new URLSearchParams(params);
  redirect(`${BASE}?${q.toString()}`);
}

/** Read the page's row-indexed fields (row_<i>_<field>) into form rows. */
function readRuleRows(formData: FormData): RuleFormRow[] {
  const count = Math.min(Number(formData.get("row_count") ?? 0) || 0, 500);
  const rows: RuleFormRow[] = [];
  const g = (i: number, f: string) => String(formData.get(`row_${i}_${f}`) ?? "");
  for (let i = 0; i < count; i += 1) {
    if (!g(i, "key")) continue;
    rows.push({
      scope: g(i, "scope"),
      key: g(i, "key"),
      label: g(i, "label"),
      mode: g(i, "mode"),
      amount: g(i, "amount"),
      fixedDate: g(i, "fixed_date"),
      basis: g(i, "basis") || "received_on",
      override: formData.get(`row_${i}_override`) === "on",
      citationKey: g(i, "citation"),
      notes: g(i, "notes"),
    });
  }
  return rows;
}

export async function saveExpiryRulesAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const rows = readRuleRows(formData);
  const existing = await listExpiryRules();
  if (!existing.ok) back({ error: existing.error });
  const plan = planRuleSaves(rows, existing.rules, pacificToday(), KNOWN_CITATIONS);
  if (!plan.ok) {
    back({ error: plan.errors.map((e) => `${e.label}: ${e.error}`).join(" | ").slice(0, 900) });
  }
  let saved = 0;
  let removed = 0;
  const failures: string[] = [];
  for (const u of plan.upserts) {
    const r = await saveExpiryRule(
      {
        scope: u.scope,
        scopeKey: u.scopeKey,
        scopeLabel: u.scopeLabel,
        value: u.value,
        overrideManual: u.overrideManual,
        enabled: true,
        notes: u.notes,
        citationKey: u.citationKey,
      },
      session.userId,
    );
    if (!r.ok) {
      failures.push(`${u.scopeLabel}: ${r.error}`);
      continue;
    }
    saved += 1;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: r.before ? "inventory_expiry_rule.updated" : "inventory_expiry_rule.created",
      entityType: "inventory_expiry_rule",
      entityId: r.after.id,
      before: r.before ? { ...r.before, summary: describeRule(r.before) } : null,
      after: { ...r.after, summary: describeRule(r.after) },
    });
  }
  for (const d of plan.deletes) {
    const r = await deleteExpiryRule(d.id);
    if (!r.ok) {
      failures.push(`${d.scope_label ?? d.scope_key}: ${r.error}`);
      continue;
    }
    removed += 1;
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "inventory_expiry_rule.deleted",
      entityType: "inventory_expiry_rule",
      entityId: d.id,
      before: { ...d, summary: describeRule(d) },
      after: null,
    });
  }
  revalidatePath(BASE);
  const params: Record<string, string> = { saved: String(saved), removed: String(removed), unchanged: String(plan.unchanged) };
  if (failures.length) params.error = failures.join(" | ").slice(0, 900);
  back(params);
}

/**
 * Preview: writes NOTHING. The page itself plans from the live rules and
 * lots (so a bookmarked / refreshed preview is always current); this action
 * only carries the owner's choices into the URL.
 */
export async function previewExpiryRulesAction(formData: FormData) {
  await requirePermission("inventory.manage");
  const override = formData.get("override_manual") === "on";
  const onlyRuleId = String(formData.get("only_rule_id") ?? "") || null;
  const params: Record<string, string> = { preview: "1", override: override ? "1" : "0" };
  if (onlyRuleId) params.rule = onlyRuleId;
  back(params);
}

/** Apply: re-plan, refuse if the plan moved since the preview, then write. */
export async function applyExpiryRulesAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const override = formData.get("override_manual") === "on" || formData.get("override_manual") === "1";
  const onlyRuleId = String(formData.get("only_rule_id") ?? "") || null;
  const fp = String(formData.get("fp") ?? "");
  const fresh = await previewExpiryRules({ overrideManual: override, onlyRuleId });
  if (!fresh.ok) back({ error: fresh.error });
  const nowFp = planFingerprint(fresh.plan.writes);
  if (!fp || fp !== nowFp) {
    const params: Record<string, string> = {
      preview: "1",
      fp: nowFp,
      override: override ? "1" : "0",
      stale: "1",
    };
    if (onlyRuleId) params.rule = onlyRuleId;
    back(params);
  }
  const res = await applyExpiryRules({ overrideManual: override, onlyRuleId }, session.userId);
  if (!res.ok) back({ error: res.error });
  // Only lots whose guarded UPDATE actually matched (not failed, not "changed since preview").
  const written = res.writtenDecisions;
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "inventory_lot.expiry_rules_applied",
    entityType: "inventory_lot",
    entityId: onlyRuleId ?? "all-rules",
    before: {
      planned: res.plan.counts,
      skipped_by_reason: res.plan.skipCounts,
      fingerprint: nowFp,
    },
    after: {
      written: res.written,
      changed_since_preview: res.changed,
      failed: res.failed,
      by_kind: res.byKind,
      override_manual: override,
      only_rule_id: onlyRuleId,
      // Per-lot from/to so any single date can be traced and undone.
      lots: written.slice(0, 2000).map((w) => ({ id: w.lotId, kind: w.kind, from: w.prev, to: w.date, rule: w.ruleId })),
      lots_truncated: written.length > 2000,
      changed_lot_ids: res.changedLotIds.slice(0, 500),
      failures: res.failures.slice(0, 200),
      basis:
        "Owner expiration rules (R34). Document dates (manifest / JSON / COA / POS) and unsourced legacy dates were never changed; owner-typed dates only with override on. WAC 314-55-105(8): a best-by date is optional label information.",
    },
  });
  revalidatePath(BASE);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/reports/expiration");
  revalidatePath("/admin/inventory/cycle-counts");
  revalidatePath("/admin/inventory/audits");
  back({
    applied: String(res.written),
    fill: String(res.byKind.fill),
    recompute: String(res.byKind.recompute),
    overrode: String(res.byKind.override),
    cleared: String(res.byKind.clear),
    changed: String(res.changed),
    failed: String(res.failed),
  });
}
