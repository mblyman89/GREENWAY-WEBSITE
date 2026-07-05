"use client";

/**
 * Client forms for the Sage 50 export pipeline (migration 0091):
 *   • SageExportSettingsForm  — store-wide accounts / tax ids
 *   • SageCategoryAccountsForm — per-bucket customer + G/L trio
 *   • SageCategoryMapForm     — menu category → bucket mapping
 * All post to the settings.manage-gated server actions.
 */

import { useState, useTransition } from "react";
import {
  saveSageExportSettingsAction,
  saveSageCategoryAccountAction,
  saveSageCategoryMapAction,
  deleteSageCategoryMapAction,
  type SageMappingResult,
} from "@/app/admin/reports/accounting/sage-mapping-actions";
import type { SageCategoryAccount, SageExportSettings, SageBucket } from "@/lib/accounting/sage-exports-core";
import { SAGE_BUCKETS } from "@/lib/accounting/sage-exports-core";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30 disabled:opacity-50";
const btnCls =
  "rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50";

function StatusMsg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <span className={`text-xs font-bold ${msg.ok ? "text-[var(--admin-accent)]" : "text-orange-400"}`}>{msg.text}</span>
  );
}

// ---------------------------------------------------------------------------
// Store-wide settings
// ---------------------------------------------------------------------------

const SETTINGS_FIELDS: { name: string; key: keyof SageExportSettings; label: string; hint: string }[] = [
  { name: "gl_cash_on_hand", key: "glCashOnHand", label: "Cash on hand", hint: "Receipts cash account (e.g. 10000-GRNWY)" },
  { name: "gl_bank_account", key: "glBankAccount", label: "Bank / checking", hint: "Payments cash account (e.g. 10005-GRNWY)" },
  { name: "gl_ap_account", key: "glApAccount", label: "Accounts payable", hint: "e.g. 30000-GRNWY" },
  { name: "gl_purchases_default", key: "glPurchasesDefault", label: "Purchases default G/L", hint: "Manifest lines (e.g. 20009-GRNWY)" },
  { name: "sales_tax_id_cannabis", key: "salesTaxIdCannabis", label: "Sales Tax ID — cannabis", hint: "e.g. WA_LCB01" },
  { name: "sales_tax_id_other", key: "salesTaxIdOther", label: "Sales Tax ID — other", hint: "e.g. WA_DOR01" },
];

export function SageExportSettingsForm({ settings, canEdit }: { settings: SageExportSettings; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res: SageMappingResult = await saveSageExportSettingsAction(formData);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_FIELDS.map((f) => (
          <label key={f.name} className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-[0.1em] text-white/50">{f.label}</span>
            <input name={f.name} defaultValue={String(settings[f.key] ?? "")} disabled={!canEdit} className={inputCls} />
            <span className="mt-1 block text-[0.65rem] text-white/30">{f.hint}</span>
          </label>
        ))}
      </div>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className={btnCls}>
            {pending ? "Saving…" : "Save export settings"}
          </button>
          <StatusMsg msg={msg} />
        </div>
      ) : (
        <p className="text-xs text-white/40">You don&apos;t have permission to edit these settings.</p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Per-bucket category accounts
// ---------------------------------------------------------------------------

function BucketRow({ acct, canEdit }: { acct: SageCategoryAccount; canEdit: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = await saveSageCategoryAccountAction(formData);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <form action={onSubmit} className="grid items-end gap-2 rounded-xl border border-white/5 bg-black/20 p-3 sm:grid-cols-2 lg:grid-cols-8">
      <input type="hidden" name="bucket" value={acct.bucket} />
      <div className="lg:col-span-1">
        <span className="mb-1 block text-[0.65rem] font-black uppercase tracking-[0.1em] text-white/60">{acct.bucket.replace("_", "-")}</span>
        <label className="flex items-center gap-1 text-[0.65rem] text-white/40">
          <input type="checkbox" name="is_cannabis" defaultChecked={acct.isCannabis} disabled={!canEdit} className="accent-[var(--admin-accent)]" />
          cannabis (37% excise)
        </label>
      </div>
      {(
        [
          ["label", "Label", acct.label],
          ["sales_customer_id", "Sales customer", acct.salesCustomerId],
          ["cogs_customer_id", "COGS customer", acct.cogsCustomerId],
          ["gl_sales", "G/L sales", acct.glSales],
          ["gl_cogs", "G/L COGS", acct.glCogs],
          ["gl_inventory", "G/L inventory", acct.glInventory],
        ] as const
      ).map(([name, label, value]) => (
        <label key={name} className="block">
          <span className="mb-1 block text-[0.6rem] uppercase tracking-[0.08em] text-white/35">{label}</span>
          <input name={name} defaultValue={value} disabled={!canEdit} className={`${inputCls} px-2 py-1.5 text-xs`} />
        </label>
      ))}
      <div className="flex items-center gap-2">
        {canEdit ? (
          <button type="submit" disabled={pending} className={`${btnCls} px-3 py-1.5 text-xs`}>
            {pending ? "…" : "Save"}
          </button>
        ) : null}
        <StatusMsg msg={msg} />
      </div>
    </form>
  );
}

export function SageCategoryAccountsForm({
  accounts,
  canEdit,
}: {
  accounts: SageCategoryAccount[];
  canEdit: boolean;
}) {
  if (accounts.length === 0) {
    return (
      <p className="text-xs text-orange-300/80">
        No Sage category mapping found — apply migration <span className="font-mono">0091_sage50_exports.sql</span> in the
        Supabase SQL editor to create and seed it (it ships pre-filled with your real Sage customer &amp; G/L ids).
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {accounts.map((a) => (
        <BucketRow key={a.bucket} acct={a} canEdit={canEdit} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category → bucket map
// ---------------------------------------------------------------------------

export function SageCategoryMapForm({
  entries,
  unmappedCategories,
  canEdit,
}: {
  entries: { source: string; bucket: SageBucket }[];
  unmappedCategories: string[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onAdd(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = await saveSageCategoryMapAction(formData);
      setMsg(res.ok ? { ok: true, text: "Mapped." } : { ok: false, text: res.error });
    });
  }
  function onDelete(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = await deleteSageCategoryMapAction(formData);
      setMsg(res.ok ? { ok: true, text: "Removed." } : { ok: false, text: res.error });
    });
  }

  return (
    <div className="space-y-4">
      {unmappedCategories.length > 0 ? (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/[0.06] px-4 py-3 text-xs text-orange-100/80">
          <span className="font-black uppercase tracking-[0.1em] text-orange-300">Unmapped menu categories: </span>
          {unmappedCategories.join(", ")} — map them below so their sales reach the right Sage accounts.
        </div>
      ) : null}

      {entries.length > 0 ? (
        <ul className="divide-y divide-white/5 text-sm">
          {entries.map((e) => (
            <li key={e.source} className="flex items-center justify-between gap-2 py-1.5">
              <span>
                <span className="font-mono text-xs text-white/70">{e.source}</span>
                <span className="mx-2 text-white/30">→</span>
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-white/60">{e.bucket.replace("_", "-")}</span>
              </span>
              {canEdit ? (
                <form action={onDelete}>
                  <input type="hidden" name="source_category" value={e.source} />
                  <button type="submit" disabled={pending} className="rounded border border-white/10 px-2 py-0.5 text-xs text-white/50 hover:bg-white/[0.06] hover:text-white/80">
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-white/40">No category mappings yet.</p>
      )}

      {canEdit ? (
        <form action={onAdd} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] flex-col gap-1 text-xs text-white/60">
            Menu category
            <input name="source_category" placeholder="e.g. Vape Cartridges" className={inputCls} list="sage-unmapped-categories" />
            <datalist id="sage-unmapped-categories">
              {unmappedCategories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/60">
            Sage bucket
            <select name="bucket" className={inputCls} defaultValue="flower">
              {SAGE_BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {b.replace("_", "-")}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending} className={btnCls}>
            {pending ? "Saving…" : "Map category"}
          </button>
          <StatusMsg msg={msg} />
        </form>
      ) : null}
    </div>
  );
}
