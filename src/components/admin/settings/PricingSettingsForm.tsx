"use client";

/**
 * PricingSettingsForm (Slice 63) — edits pricing_settings: the minimum markup
 * multiple (hard price floor over cost), rounding step (in cents), and an
 * optional default tax rate used for price estimates. The pricing engine +
 * catalog drafts read these values.
 */
import { useTransition } from "react";
import { Button, Card, CardHeader, Field, Input } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { savePricingSettingsAction } from "@/app/admin/settings/actions";
import type { PricingSettings } from "@/lib/inventory/pricing";

export function PricingSettingsForm({ settings }: { settings: PricingSettings }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await savePricingSettingsAction(fd);
      toast(
        res.ok
          ? { tone: "success", message: "Pricing settings saved." }
          : { tone: "error", message: res.error ?? "Couldn't save." },
      );
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader
          title="Pricing guard rails"
          subtitle="Store-wide rules the pricing tools follow. Prices can never be set below the floor these produce."
        />
        <div className="grid gap-4 p-5 pt-0 sm:grid-cols-2">
          <Field
            label="Minimum markup (× cost)"
            help="A hard floor. 2 = a product can never be priced below 2× its cost."
          >
            <Input
              name="minMarkup"
              type="number"
              step="0.1"
              min="1"
              defaultValue={settings.min_markup_multiple}
            />
          </Field>
          <Field
            label="Round prices to (cents)"
            help="Suggested prices round to the nearest this many cents. 5 → prices end in .x0 or .x5."
          >
            <Input
              name="roundTo"
              type="number"
              step="1"
              min="1"
              defaultValue={settings.round_to_minor_units}
            />
          </Field>
          <Field
            label="Default tax rate (for estimates)"
            help="Optional. Used only for on-screen price estimates — the authoritative tax is computed at the sale."
          >
            <Input
              name="defaultTaxRate"
              type="number"
              step="0.001"
              min="0"
              defaultValue={settings.default_tax_rate}
            />
          </Field>
        </div>
        <div className="flex justify-end border-t border-[var(--admin-border)] px-5 py-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save pricing settings"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
