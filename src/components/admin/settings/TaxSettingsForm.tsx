"use client";

/**
 * TaxSettingsForm (Slice 63) — edits tax_settings (rates in %, medical
 * endorsement, tax base mode) and the per-category cannabis (excise-eligible)
 * rules in tax_category_rules. Rates are shown as percentages but stored as
 * basis points by the server action (pctToBps). The tax engine + reports read
 * these values, so this is the missing UI for settings the app already uses.
 */
import { useTransition } from "react";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { saveTaxSettingsAction, saveTaxCategoryRulesAction } from "@/app/admin/settings/actions";
import type { TaxSettings } from "@/lib/reports/tax";
import type { TaxCategoryRule } from "@/lib/admin/settings-store";

function bpsToPct(bps: number): string {
  return (bps / 100).toString();
}

export function TaxSettingsForm({
  settings,
  rules,
}: {
  settings: TaxSettings;
  rules: TaxCategoryRule[];
}) {
  const { toast } = useToast();
  const [pendingRates, startRates] = useTransition();
  const [pendingRules, startRules] = useTransition();

  function onSaveRates(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startRates(async () => {
      const res = await saveTaxSettingsAction(fd);
      toast(
        res.ok
          ? { tone: "success", message: "Tax rates saved." }
          : { tone: "error", message: res.error ?? "Couldn't save tax rates." },
      );
    });
  }

  function onSaveRules(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startRules(async () => {
      const res = await saveTaxCategoryRulesAction(fd);
      toast(
        res.ok
          ? { tone: "success", message: "Category rules saved." }
          : { tone: "error", message: res.error ?? "Couldn't save category rules." },
      );
    });
  }

  const combinedSales = (settings.stateSalesRateBps + settings.localSalesRateBps) / 100;

  return (
    <div className="space-y-5">
      <form onSubmit={onSaveRates}>
        <Card>
          <CardHeader
            title="Tax rates"
            subtitle="Washington cannabis excise + state and local sales tax. Used by the POS tax engine and all tax reports."
          />
          <div className="grid gap-4 p-5 pt-0 sm:grid-cols-2">
            <Field
              label="Cannabis excise (%)"
              help="Applies to cannabis products only. WA statewide rate is 37%."
            >
              <Input
                name="excisePct"
                type="number"
                step="0.01"
                min="0"
                defaultValue={bpsToPct(settings.exciseRateBps)}
              />
            </Field>
            <Field label="State sales tax (%)" help="WA state portion. Currently 6.5%.">
              <Input
                name="stateSalesPct"
                type="number"
                step="0.01"
                min="0"
                defaultValue={bpsToPct(settings.stateSalesRateBps)}
              />
            </Field>
            <Field label="Local sales tax (%)" help="Port Orchard local portion. Currently 2.8%.">
              <Input
                name="localSalesPct"
                type="number"
                step="0.01"
                min="0"
                defaultValue={bpsToPct(settings.localSalesRateBps)}
              />
            </Field>
            <Field
              label="How stored prices relate to tax"
              help="Pre-tax: prices are before tax (WA standard). Tax-inclusive: tax is baked into the price."
            >
              <Select name="taxBaseMode" defaultValue={settings.taxBaseMode}>
                <option value="pre_tax">Pre-tax (recommended)</option>
                <option value="tax_inclusive">Tax-inclusive</option>
                <option value="auto">Auto-detect</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-[var(--admin-text)] sm:col-span-2">
              <input
                type="checkbox"
                name="medicalEndorsement"
                defaultChecked={settings.medicalEndorsement}
                className="accent-[var(--admin-accent)]"
              />
              <span>
                Store holds a DOH <strong>medical endorsement</strong> (enables the medical
                sales/excise exemption path)
              </span>
            </label>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--admin-border)] px-5 py-3">
            <p className="text-xs text-[var(--admin-text-faint)]">
              Combined sales tax preview: <strong>{combinedSales}%</strong>
            </p>
            <Button type="submit" disabled={pendingRates}>
              {pendingRates ? "Saving…" : "Save tax rates"}
            </Button>
          </div>
        </Card>
      </form>

      <form onSubmit={onSaveRules}>
        <Card>
          <CardHeader
            title="Which categories are cannabis?"
            subtitle="Checked categories are subject to the 37% excise tax. Uncheck accessories, paraphernalia, and merchandise (sales tax only)."
          />
          {rules.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-[var(--admin-text-faint)]">
              No category rules found. They are seeded by the tax migration.
            </p>
          ) : (
            <>
              <div className="grid gap-2 p-5 pt-0 sm:grid-cols-2 lg:grid-cols-3">
                {rules.map((r) => (
                  <label
                    key={r.category}
                    className="flex items-center gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]"
                  >
                    <input
                      type="checkbox"
                      name="cannabis"
                      value={r.category}
                      defaultChecked={r.isCannabis}
                      className="accent-[var(--admin-accent)]"
                    />
                    <span className="capitalize">{r.category.replace(/-/g, " ")}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end border-t border-[var(--admin-border)] px-5 py-3">
                <Button type="submit" disabled={pendingRules}>
                  {pendingRules ? "Saving…" : "Save category rules"}
                </Button>
              </div>
            </>
          )}
        </Card>
      </form>
    </div>
  );
}
