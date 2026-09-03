import { requirePermission } from "@/lib/auth/session";
import { isOwnerRole, ROLE_LABELS } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Button, Card, Field, Input, Textarea, Badge } from "@/components/admin/ui";
import { getSalesLimitSettings, listRecentSalesLimitOverrides } from "@/lib/compliance/sales-limits";
import {
  gramsToOunces,
  isThcBucket,
  formatLimitAmount,
  LIMIT_BUCKET_LABELS,
  LIMIT_BUCKETS,
  LOW_THC_UNIT_MAX_MG,
  bucketCategories,
  type LimitBucket,
} from "@/lib/compliance/sales-limits-core";
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";
import { updateSalesLimitSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

function ozLabel(g: number): string {
  return `${gramsToOunces(g)} oz (${g} g)`;
}

/**
 * SLICE 16 -- PRESENTATION A: the statutory figure, in the bucket's OWN unit.
 *
 * Four buckets are grams (shown as ounces, or grams for concentrate); the
 * low-THC beverage bucket is MILLIGRAMS OF ACTIVE DELTA-9 THC and must never be
 * pushed through gramsToOunces(), which would render the 200 mg cap as the
 * meaningless and dangerous "7.143 oz".
 */
function statutoryLabel(bucket: LimitBucket, amount: number): string {
  if (isThcBucket(bucket)) return formatLimitAmount(bucket, amount);
  if (bucket === "concentrate") return `${amount} g`;
  return `${gramsToOunces(amount)} oz (${amount} g)`;
}

/**
 * SLICE 16 -- PRESENTATION B: the same figure in the units a human counts.
 *
 * Michael asked for both presentations because he was not sure which he would
 * prefer. The statutory number is the authority; this is the plain-English
 * translation that sits beside it.
 *
 * For the mg bucket the honest translation is "how many cans is that?", and the
 * answer depends on the strength of the can, so we state the assumption
 * explicitly rather than implying a single fixed number. At the 4 mg per-unit
 * statutory ceiling, 200 mg is 50 units; a 2 mg can gets you 100.
 *
 * DERIVED FOR DISPLAY ONLY -- never stored, never used for enforcement.
 * Returns null when there is no more useful way to say it than the statute.
 */
function practicalLabel(bucket: LimitBucket, amount: number): string | null {
  if (isThcBucket(bucket)) {
    const atCeiling = Math.floor(amount / LOW_THC_UNIT_MAX_MG);
    const atHalf = Math.floor(amount / (LOW_THC_UNIT_MAX_MG / 2));
    return `${atCeiling} cans at ${LOW_THC_UNIT_MAX_MG} mg, or ${atHalf} at ${LOW_THC_UNIT_MAX_MG / 2} mg`;
  }
  if (bucket === "concentrate") return `${amount} g of extract`;
  return `${amount} g`;
}

/** Friendly label for a website category slug (falls back to the slug). */
function catLabel(slug: string): string {
  return websiteCategoryDefinitions.find((c) => c.value === slug)?.label ?? slug;
}

export default async function SalesLimitsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requirePermission("settings.manage");
  const isOwner = isOwnerRole(session.profile.role);
  const { ok, error } = await searchParams;
  const s = await getSalesLimitSettings();
  const bucketCats = bucketCategories();
  const overrides = await listRecentSalesLimitOverrides(20);

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
            "Infused flower/prerolls/blunts contain concentrate, so they count toward the 7 g concentrate limit \u2014 not the flower limit.",
            "Low-THC beverages are the exception: if a drink is packaged in individual units of 4 mg THC or less, it leaves the 72 oz liquid limit and gets its own 200 mg of THC limit instead (WAC 314-55-095(1)(d)(i)(E) and (F)).",
            "Each cart line is mapped to one of five buckets. Four are measured in grams; the low-THC beverage bucket is measured in milligrams of active delta-9 THC.",
            "At checkout the cart is summed per bucket and compared to these maximums.",
            "Turn enforcement on/off, choose warn-only vs hard block, and tune per-category grams per unit below.",
          ]}
        >
          Medical patients entered in the DOH database get the higher limits (3 oz / 21 g /
          48 oz / 216 oz) \u2014 but NOT for low-THC beverages, which stay at 200 mg for
          everyone (WAC 314-55-095(2)(d) says &ldquo;up to 200 mg&rdquo;). These defaults
          match the statute; only change them if the law does.
        </HelpPanel>

        {/* Current effective limits */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
          {/* SLICE 16. Value is the STATUTORY unit (mg THC); hint is the
              PRACTICAL unit (cans). Medical is the same 200 mg, deliberately. */}
          <StatCard
            label="Low-THC beverages"
            value={formatLimitAmount("low_thc_liquid", s.rec.low_thc_liquid)}
            hint={`${Math.floor(s.rec.low_thc_liquid / LOW_THC_UNIT_MAX_MG)} cans at ${LOW_THC_UNIT_MAX_MG} mg \u00b7 medical the same`}
            accent="gold"
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

        {/* Staff-facing read-only reference: the clear, informative limit sheet
            a budtender reads to a customer. Always shown (owner benefits too). */}
        <Card>
          <div className="p-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[var(--admin-text)]">
                Single-transaction purchase limits
              </h3>
              <Badge tone="outline">WAC 314-55-095 · RCW 69.50.360</Badge>
            </div>
            <p className="mb-4 text-xs text-[var(--admin-muted)]">
              These are the most a single customer may buy in one transaction.
              Medical patients entered in the DOH database get the higher medical
              limits. Read these to customers when discussing how much they can buy.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--admin-border)] text-left text-[var(--admin-muted)]">
                    <th className="py-2 pr-4 font-semibold">Product type</th>
                    <th className="py-2 pr-4 font-semibold">Recreational (21+)</th>
                    <th className="py-2 pr-4 font-semibold">Medical (DOH database)</th>
                    <th className="py-2 font-semibold">Counts these categories</th>
                  </tr>
                </thead>
                <tbody>
                  {LIMIT_BUCKETS.map((bucket: LimitBucket) => {
                    const rec = s.rec[bucket];
                    const med = s.med[bucket];
                    // SLICE 16: unit-aware. Was `gramsToOunces(g)` for every
                    // non-concentrate bucket, which would print the 200 mg
                    // low-THC cap as "7.143 oz".
                    const cats = bucketCats[bucket];
                    const recPractical = practicalLabel(bucket, rec);
                    const medPractical = practicalLabel(bucket, med);
                    return (
                      <tr key={bucket} className="border-b border-[var(--admin-border)]/60 align-top">
                        <td className="py-2.5 pr-4 font-medium text-[var(--admin-text)]">
                          {LIMIT_BUCKET_LABELS[bucket]}
                          {isThcBucket(bucket) && (
                            <span className="mt-0.5 block text-xs font-normal text-[var(--admin-muted)]">
                              measured in THC, not volume
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 font-semibold text-[var(--admin-accent)]">
                          {statutoryLabel(bucket, rec)}
                          {recPractical && (
                            <span className="mt-0.5 block text-xs font-normal text-[var(--admin-muted)]">
                              {recPractical}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-[var(--admin-text)]">
                          {statutoryLabel(bucket, med)}
                          {medPractical && (
                            <span className="mt-0.5 block text-xs font-normal text-[var(--admin-muted)]">
                              {medPractical}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-xs text-[var(--admin-muted)]">
                          {cats.length ? cats.map(catLabel).join(", ") : "\u2014"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-[var(--admin-muted)]">
              <strong className="text-[var(--admin-text)]">Infused products follow the concentrate limit:</strong>{" "}
              infused flower, infused prerolls, infused blunts, and infused preroll
              packs contain concentrate, so the state counts them against the 7 g
              concentrate limit (21 g medical) — not the 1 oz flower limit
              (WAC 314-55-095, WAC 314-55-010(8)).
            </p>
            <p className="mt-4 text-xs text-[var(--admin-muted)]">
              <strong className="text-[var(--admin-text)]">Low-THC beverages have their own limit:</strong>{" "}
              a drink packaged in individual units of {LOW_THC_UNIT_MAX_MG} mg active
              delta-9 THC or less does not count against the 72 oz liquid limit at all.
              It counts against a separate {formatLimitAmount("low_thc_liquid", s.rec.low_thc_liquid)}{" "}
              limit instead (WAC 314-55-095(1)(d)(i)(E) and (F)). The two are alternatives,
              never both. <strong className="text-[var(--admin-text)]">One can is one unit</strong>{" "}
              &mdash; a 4-pack is four units, and a single bottle holding 16 mg is one
              16 mg unit that does <em>not</em> qualify, no matter how many servings the
              label divides it into. A drink is only treated this way when it has been
              classified as such at intake; anything unclassified is counted as a normal
              liquid.
            </p>
            <p className="mt-2 text-xs text-[var(--admin-muted)]">
              Accessories, Greenway merch, and paraphernalia are not cannabis and
              do not count toward any limit. At checkout, enforcement is currently{" "}
              <strong className="text-[var(--admin-text)]">{s.enforce ? "on" : "off"}</strong>{" "}
              ({s.hardBlock ? "hard block" : "warn only"}).
            </p>
          </div>
        </Card>

        {!isOwner ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] px-4 py-3 text-sm text-[var(--admin-orange)]">
            <strong>These limits are set by the store owner.</strong> You are signed
            in as {ROLE_LABELS[session.profile.role]}, so this page is read-only for
            you. Use the reference above with customers. If a limit looks wrong,
            ask the owner to update it here.
          </div>
        ) : (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/30 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
            <strong>Owner controls.</strong> Only you (the owner) can change, add,
            or remove these limits. Staff and admins see the reference above as
            read-only. The statutory defaults already match WA law — only change
            them if the law changes or you intend to sell tighter than the cap.
          </div>
        )}

        {/* Editor (owner-only) */}
        <Card>
          <form action={updateSalesLimitSettingsAction} className="space-y-6 p-1">
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  name="enforce"
                  defaultChecked={s.enforce}
                  disabled={!isOwner}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Enforce sales limits at checkout
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  name="hard_block"
                  defaultChecked={s.hardBlock}
                  disabled={!isOwner}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Hard block (otherwise warn only)
              </label>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-bold text-[var(--admin-text)]">
                Recreational limits{" "}
                <span className="font-normal text-[var(--admin-muted)]">
                  (grams, except low-THC beverages which are mg of THC)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Field label={LIMIT_BUCKET_LABELS.usable}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_usable"
                    defaultValue={s.rec.usable}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.concentrate}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_concentrate"
                    defaultValue={s.rec.concentrate}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.solid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_solid"
                    defaultValue={s.rec.solid_edible}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.liquid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_liquid"
                    defaultValue={s.rec.liquid_edible}
                    disabled={!isOwner}
                  />
                </Field>
                {/* SLICE 16 \u2014 MILLIGRAMS OF THC, not grams. */}
                <Field
                  label={LIMIT_BUCKET_LABELS.low_thc_liquid}
                  help={`mg of active delta-9 THC (NOT grams). Statutory max 200 = ${Math.floor(
                    s.rec.low_thc_liquid / LOW_THC_UNIT_MAX_MG,
                  )} cans at ${LOW_THC_UNIT_MAX_MG} mg.`}
                >
                  <Input
                    type="number"
                    step="0.001"
                    name="rec_low_thc_liquid"
                    defaultValue={s.rec.low_thc_liquid}
                    disabled={!isOwner}
                  />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-bold text-[var(--admin-text)]">
                Medical (DOH database) limits{" "}
                <span className="font-normal text-[var(--admin-muted)]">
                  (grams, except low-THC beverages which are mg of THC)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Field label={LIMIT_BUCKET_LABELS.usable}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_usable"
                    defaultValue={s.med.usable}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.concentrate}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_concentrate"
                    defaultValue={s.med.concentrate}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.solid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_solid"
                    defaultValue={s.med.solid_edible}
                    disabled={!isOwner}
                  />
                </Field>
                <Field label={LIMIT_BUCKET_LABELS.liquid_edible}>
                  <Input
                    type="number"
                    step="0.001"
                    name="med_liquid"
                    defaultValue={s.med.liquid_edible}
                    disabled={!isOwner}
                  />
                </Field>
                {/* SLICE 16 \u2014 mg of THC. NOT tripled: WAC 314-55-095(2)(d)
                    says "up to 200 mg" for medical too. */}
                <Field
                  label={LIMIT_BUCKET_LABELS.low_thc_liquid}
                  help="mg of active delta-9 THC. Statutory max is ALSO 200 for medical \u2014 unlike every other bucket this one does not triple (WAC 314-55-095(2)(d))."
                >
                  <Input
                    type="number"
                    step="0.001"
                    name="med_low_thc_liquid"
                    defaultValue={s.med.low_thc_liquid}
                    disabled={!isOwner}
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
                disabled={!isOwner}
              />
            </Field>

            <Field label="Notes">
              <Textarea name="notes" rows={2} defaultValue={s.notes ?? ""} disabled={!isOwner} />
            </Field>

            {isOwner && (
              <div className="flex justify-end">
                <Button type="submit" variant="save" size="sm">
                  💾 Save sales-limit settings
                </Button>
              </div>
            )}
          </form>
        </Card>

        {/* Slice 109: logged over-limit override audit trail. */}
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white/70">
              Over-limit override log
            </h2>
            <Badge>{overrides.length}</Badge>
          </div>
          <p className="mb-3 text-xs text-white/50">
            Every over-limit sale that a manager authorized is recorded here for your protection. An over-limit cart is
            hard-blocked at checkout unless a user with the{" "}
            <span className="font-semibold text-white/70">Authorize an over-limit sale</span> permission approves it with
            a written reason.
          </p>
          {overrides.length === 0 ? (
            <p className="text-xs text-white/40">No overrides recorded — no over-limit sale has been authorized.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {overrides.map((o) => (
                <li key={o.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center gap-2 text-white/60">
                    <span className="font-semibold text-white/80">{new Date(o.createdAt).toLocaleString()}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 uppercase tracking-wide">
                      {o.customerType}
                    </span>
                  </div>
                  {o.reasons.length > 0 && (
                    <div className="mb-1 text-orange-200/80">{o.reasons.join(" ")}</div>
                  )}
                  <div className="text-white/60">
                    Reason given: <span className="text-white/80">{o.overrideReason || "(none recorded)"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
