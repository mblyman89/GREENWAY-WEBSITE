"use client";

import { useState, useTransition } from "react";
import { saveAccountingSettingsAction } from "@/app/admin/reports/accounting/actions";
import type { AccountingSettings } from "@/lib/accounting/sage50";

const FIELDS: { name: string; key: keyof AccountingSettings; label: string; hint: string }[] = [
  { name: "gl_cash_clearing", key: "glCashClearing", label: "Cash / card clearing", hint: "Debit — total collected" },
  { name: "gl_sales_cannabis", key: "glSalesCannabis", label: "Sales — cannabis", hint: "Credit — pre-tax" },
  { name: "gl_sales_non_cannabis", key: "glSalesNonCannabis", label: "Sales — non-cannabis", hint: "Credit — pre-tax" },
  { name: "gl_sales_tax_payable", key: "glSalesTaxPayable", label: "Sales tax payable", hint: "Credit — 9.3%" },
  { name: "gl_excise_tax_payable", key: "glExciseTaxPayable", label: "Excise tax payable", hint: "Credit — 37%" },
  { name: "gl_cogs", key: "glCogs", label: "Cost of goods sold", hint: "Debit" },
  { name: "gl_inventory", key: "glInventory", label: "Inventory asset", hint: "Credit — relief" },
  { name: "gl_discounts", key: "glDiscounts", label: "Sales discounts (optional)", hint: "Informational" },
];

export function AccountingSettingsForm({
  settings,
  canEdit,
}: {
  settings: AccountingSettings;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onSubmit(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = await saveAccountingSettingsAction(formData);
      if (res.ok) setMsg({ ok: true, text: "Saved." });
      else setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FIELDS.map((f) => (
          <label key={f.name} className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-[0.1em] text-white/50">{f.label}</span>
            <input
              name={f.name}
              defaultValue={String(settings[f.key] ?? "")}
              disabled={!canEdit}
              placeholder="GL acct id"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30 disabled:opacity-50"
            />
            <span className="mt-1 block text-[0.65rem] text-white/30">{f.hint}</span>
          </label>
        ))}
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-[0.1em] text-white/50">Reference prefix</span>
          <input
            name="journal_ref_prefix"
            defaultValue={settings.journalRefPrefix}
            disabled={!canEdit}
            maxLength={12}
            placeholder="GW"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition focus:border-white/30 disabled:opacity-50"
          />
          <span className="mt-1 block text-[0.65rem] text-white/30">e.g. GW → GW20250309</span>
        </label>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save GL mapping"}
          </button>
          {msg ? (
            <span className={`text-xs font-bold ${msg.ok ? "text-[var(--admin-accent)]" : "text-orange-400"}`}>
              {msg.text}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-white/40">You don’t have permission to edit the GL mapping.</p>
      )}
    </form>
  );
}
