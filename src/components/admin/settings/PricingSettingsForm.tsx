"use client";

/**
 * PricingSettingsForm — edits pricing_settings. T-322: this now has ONE control,
 * the minimum markup multiple (the hard price floor over cost). The old
 * "round to cents" and "default tax rate" inputs were removed because they were
 * dead: auto prices round UP to the next whole dollar (T-319) and the real tax
 * is the statutory rate computed at the sale, not a configurable field.
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
        </div>
        <p className="px-5 pb-4 text-sm text-[var(--admin-muted)]">
          Auto prices use this markup, add the correct tax to make the shelf
          price tax-inclusive, then round up to the next whole dollar. The tax
          rate itself is set by law and computed automatically at the sale, so
          there is nothing to configure here.
        </p>
        <div className="flex justify-end border-t border-[var(--admin-border)] px-5 py-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save pricing settings"}
          </Button>
        </div>
      </Card>
    </form>
  );
}
