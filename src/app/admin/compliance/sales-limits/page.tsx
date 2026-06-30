import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Card, Field, Input, Textarea } from "@/components/admin/ui";
import { getSalesLimitSettings } from "@/lib/compliance/sales-limits";
import {
  gramsToOunces,
  LIMIT_BUCKET_LABELS,
} from "@/lib/compliance/sales-limits-core";
import { updateSalesLimitSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

function ozLabel(g: number): string {
  return `${gramsToOunces(g)} oz (${g} g)`;
}

export default async function SalesLimitsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requirePermission("settings.manage");
  const isAdmin = can(session.profile.role, "settings.manage");
  const { ok, error } = await searchParams;
  const s = await getSalesLimitSettings();

  const unitGramsText = Object.entries(s.unitGrams)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  return (
    <div>
      <AdminPageHeader
        title="Sales limits"
        subtitle="WA single-transaction purchase limits (WAC 314-55-095) enforced at checkout"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Compliance", href: "/admin/compliance/sales-limits" },
              { label: "Sales limits" },
            ]}
          />
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {ok && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            Sales-limit settings saved.
          </div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]">
            {error}
          </div>
        )}

        <HelpPanel
          id="sales-limits"
          title="How sales limits work"
          steps={[
            "WA caps a single transaction: 1 oz flower, 7 g concentrate, 16 oz solid edible, 72 oz liquid (WAC 314-55-095).",
            "Each cart line is mapped to one of four buckets and converted to grams using a per-unit weight.",
            "At checkout the cart is summed per bucket and compared to these maximums.",
            "Turn enforcement on/off, choose warn-only vs hard block, and tune per-category grams per unit below.",
          ]}
        >
          Medical patients entered in the DOH database get the higher limits (3 oz / 21 g /
          48 oz / 216 oz). These defaults match the statute; only change them if the law does.
        </HelpPanel>

        {/* Current effective limits */}
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard
            label="Flower / useable"
            value={ozLabel(s.rec.usable)}
            hint={`medical ${gramsToOunces(s.med.usable)} oz`}
            accent="green"
          />
          <StatCard
            label="Concentrate"
            value={`${s.rec.concentrate} g`}
            hint={`medical ${s.med.concentrate} g`}
            accent="gold"
          />
          <StatCard
            label="Solid edible"
            value={ozLabel(s.rec.solid_edible)}
            hint={`medical ${gramsToOunces(s.med.solid_edible)} oz`}
            accent="orange"
          />
          <StatCard
            label="Liquid edible"
            value={ozLabel(s.rec.liquid_edible)}
            hint={`medical ${gramsToOunces(s.med.liquid_edible)} oz`}
            accent="muted"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Enforcement"
            value={s.enforce ? "On" : "Off"}
            accent={s.enforce ? "green" : "orange"}
          />
          <StatCard
            label="Mode"
            value={s.hardBlock ? "Hard block" : "Warn only"}
            accent={s.hardBlock ? "green" : "gold"}
          />
        </div>

        {!isAdmin && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-orange)]">
            You can view the limits but only an admin can change them.
          </div>
        )}

        {/* Editor */}
        <Card>
          <form action={updateSalesLimitSettingsAction} className="space-y-6 p-1">
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  name="enforce"
                  defaultChecked={s.enforce}
                  disabled={!isAdmin}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Enforce sales limits at checkout
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  name="hard_block"
                  defaultChecked={s.hardBlock}
                  disabled={!isAdmin}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Hard block (otherwise warn only)
              </label>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-bold text-[var(--admin-text)]">
                Recreational limits (grams)
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={LIMIT_BUCKET_LABELS.usable}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_usable"
                    defaultValue={s.rec.usable}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.concentrate}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_concentrate"
                    defaultValue={s.rec.concentrate}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.solid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_solid"
                    defaultValue={s.rec.solid_edible}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.liquid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_liquid"
                    defaultValue={s.rec.liquid_edible}
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-bold text-[var(--admin-text)]">
                Medical (DOH database) limits (grams)
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={LIMIT_BUCKET_LABELS.usable}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_usable"
                    defaultValue={s.med.usable}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.concentrate}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_concentrate"
                    defaultValue={s.med.concentrate}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.solid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_solid"
                    defaultValue={s.med.solid_edible}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.liquid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_liquid"
                    defaultValue={s.med.liquid_edible}
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
            </div>

            <Field
              label="Per-category grams per unit"
              help="One per line as slug=grams (e.g. flower=3.5). Overrides the engine defaults; leave blank to use defaults."
            >
              <Textarea
                name="unit_grams"
                rows={5}
                defaultValue={unitGramsText}
                placeholder={"flower=3.5\nconcentrate=1\nedible-solid=28"}
                disabled={!isAdmin}
              />
            </Field>

            <Field label="Notes">
              <Textarea name="notes" rows={2} defaultValue={s.notes ?? ""} disabled={!isAdmin} />
            </Field>

            {isAdmin && (
              <div className="flex justify-end">
                <Button type="submit" variant="save" size="sm">
                  💾 Save sales-limit settings
                </Button>
              </div>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
