import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card, CardHeader, Section, Field, Input } from "@/components/admin/ui";
import { listVendors } from "@/lib/vendors/store";
import {
  buildReorderSuggestions,
  getReorderSettings,
  type PoFilter,
} from "@/lib/purchasing/po-store";
import {
  createPurchaseOrderAction,
  createAndSendPurchaseOrderAction,
  interpretPlanAction,
  saveReorderSettingsAction,
} from "../actions";
import { BuilderTable, type SuggestionRow } from "./builder-table";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function csv(sp: SP, key: string): string[] {
  const v = sp[key];
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

/**
 * Cannabis category benchmarks (Northstar Financial) shown as GUIDANCE ONLY —
 * these are industry ranges to sanity-check an order's mix, never this store's
 * actual numbers. Documented in docs/RESEARCH_CANNABIS_PURCHASING.md.
 */
const CATEGORY_GUIDE: { label: string; note: string }[] = [
  { label: "Flower", note: "Fastest turns (12–18/yr) · order often, never stock out" },
  { label: "Pre-rolls", note: "8–14 turns · strong impulse category" },
  { label: "Vape", note: "8–12 turns · high margin (55–65%)" },
  { label: "Concentrates", note: "6–10 turns · watch batch dates" },
  { label: "Edibles", note: "Slower (4–8) · FIFO, expiration matters" },
  { label: "Topicals", note: "Slowest (3–6) · order conservatively" },
];

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  const [vendors, settings] = await Promise.all([listVendors(), getReorderSettings()]);

  // Resolve AI/manual vendor-name filters → vendor ids.
  const nameToId = new Map<string, string>();
  vendors.forEach((v) => {
    if (v.display_name) nameToId.set(v.display_name.toLowerCase(), v.id);
  });
  const resolveVendorNames = (names: string[]) =>
    names.map((n) => nameToId.get(n.toLowerCase())).filter((x): x is string => Boolean(x));

  const filter: PoFilter = {
    includeVendorIds: resolveVendorNames(csv(sp, "incVendor")),
    excludeVendorIds: resolveVendorNames(csv(sp, "excVendor")),
    includeBrands: csv(sp, "incBrand"),
    excludeBrands: csv(sp, "excBrand"),
    includeCategories: csv(sp, "incCat"),
    excludeCategories: csv(sp, "excCat"),
  };

  const suggestions = await buildReorderSuggestions({ filter });
  const rows: SuggestionRow[] = suggestions.map((s) => ({
    posProductKey: s.posProductKey,
    productName: s.productName,
    brand: s.brand,
    category: s.category,
    vendorId: s.vendorId,
    vendorName: s.vendorName,
    onHand: s.onHand,
    unit: s.unit,
    unitCostMinor: s.unitCostMinor,
    avgDaily: s.result.avgDaily,
    reorderPoint: s.result.reorderPoint,
    suggestedQty: s.result.suggestedQty,
    belowReorderPoint: s.result.belowReorderPoint,
    daysOfSupplyLeft: s.result.daysOfSupplyLeft,
  }));

  const needCount = rows.filter((r) => r.belowReorderPoint).length;

  // Discovery hand-off: when arriving from a promoted product lead, build a
  // prefilled DRAFT line the builder prepends and pre-selects. Nothing is
  // ordered automatically — the manager confirms quantity, cost, and vendor.
  const fromLead = one(sp, "fromLead");
  const leadCostMinorRaw = one(sp, "leadCostMinor");
  const leadCostMinor = leadCostMinorRaw ? Math.max(0, Math.round(Number(leadCostMinorRaw) || 0)) : 0;
  const prefill: SuggestionRow | undefined = fromLead
    ? {
        posProductKey: null,
        productName: one(sp, "leadName") ?? "New product (from lead)",
        brand: one(sp, "leadBrand") ?? null,
        category: one(sp, "leadCategory") ?? null,
        vendorId: null,
        vendorName: one(sp, "leadVendorName") ?? null,
        onHand: 0,
        unit: "each",
        unitCostMinor: leadCostMinor,
        avgDaily: 0,
        reorderPoint: 0,
        suggestedQty: 1,
        belowReorderPoint: true,
        daysOfSupplyLeft: 0,
      }
    : undefined;

  const planSummary = one(sp, "plan");
  const origin = one(sp, "origin") === "ai_suggested" ? "ai_suggested" : "manual";
  const aiError = one(sp, "aierror");
  const errorMsg = one(sp, "error");
  const settingsSaved = one(sp, "settings") === "1";

  // Full vendor options WITH email so the builder can email the PO directly.
  const vendorOptions = vendors
    .filter((v) => v.display_name)
    .map((v) => ({ id: v.id, name: v.display_name as string, email: v.email ?? null }));

  const hasActiveFilters =
    csv(sp, "incVendor").length +
      csv(sp, "excVendor").length +
      csv(sp, "incCat").length +
      csv(sp, "excCat").length +
      csv(sp, "incBrand").length +
      csv(sp, "excBrand").length >
    0;

  return (
    <div>
      <AdminPageHeader
        title="New purchase order"
        subtitle="Build a cannabis reorder from on-hand stock and recent sales velocity — then email it to the vendor"
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Purchasing", href: "/admin/purchasing" }, { label: "New" }]}
          />
        }
        action={
          <Link href="/admin/purchasing">
            <Button variant="neutral" size="sm">Cancel</Button>
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {/* Status banners */}
        {settingsSaved ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            Reorder settings saved.
          </div>
        ) : null}
        {errorMsg ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-text)]">
            {errorMsg}
          </div>
        ) : null}
        {aiError ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-2 text-sm text-[var(--admin-text)]">
            {aiError}
          </div>
        ) : null}
        {prefill ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            Started from a discovery lead:{" "}
            <span className="font-semibold text-[var(--admin-text)]">{prefill.productName}</span>. It&apos;s
            pre-added below as a draft line — confirm the quantity, cost, and vendor, then save.
          </div>
        ) : null}

        <HelpPanel
          id="po-new-help"
          title="How to build this order"
          steps={[
            "Step 1 — Narrow the list (optional): use the AI box or manual filters to focus on a vendor, category, or brand.",
            "Step 2 — Review & build: rows below the reorder point are pre-ticked with a suggested quantity. Reorder point = avg daily sales × lead time + safety stock. Adjust quantities and unit costs — every number is a draft you confirm.",
            "Step 3 — Send: pick the vendor and either Save as draft or Save & send to email the PO straight from here.",
          ]}
        >
          <p className="text-xs text-[var(--admin-text-muted)]">
            Cannabis guidance (industry benchmarks, not your data): flower turns fastest so order it
            often; edibles and topicals turn slowly, so order conservatively and watch batch dates.
          </p>
        </HelpPanel>

        {/* Step 1 — Narrow the list */}
        <Section
          title="1 · Narrow the list"
          description="Optional. Focus the suggestions before you build — by plain-English request or manual filters."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card padding="md">
              <CardHeader title="Describe what to order" subtitle="AI drafts a filter — you confirm every line" />
              <form action={interpretPlanAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  type="text"
                  name="request"
                  placeholder="e.g. Reorder all flower from Acme except pre-rolls, cover 3 weeks"
                  className="flex-1"
                />
                <Button type="submit" variant="neutral" size="sm">Draft with AI</Button>
              </form>
              <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
                AI maps your words to your real vendors and categories — it never invents products.
              </p>
            </Card>

            <Card padding="md">
              <CardHeader
                title="Manual filters"
                subtitle="Comma-separated · blank = everything"
                action={
                  hasActiveFilters ? (
                    <Link href="/admin/purchasing/new">
                      <Button type="button" variant="neutral" size="sm">Reset</Button>
                    </Link>
                  ) : undefined
                }
              />
              <form method="get" className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Include vendors">
                  <Input name="incVendor" defaultValue={csv(sp, "incVendor").join(", ")} />
                </Field>
                <Field label="Exclude vendors">
                  <Input name="excVendor" defaultValue={csv(sp, "excVendor").join(", ")} />
                </Field>
                <Field label="Include categories" help="flower, edible, vape, preroll, …">
                  <Input name="incCat" defaultValue={csv(sp, "incCat").join(", ")} />
                </Field>
                <Field label="Exclude categories">
                  <Input name="excCat" defaultValue={csv(sp, "excCat").join(", ")} />
                </Field>
                <Field label="Include brands">
                  <Input name="incBrand" defaultValue={csv(sp, "incBrand").join(", ")} />
                </Field>
                <Field label="Exclude brands">
                  <Input name="excBrand" defaultValue={csv(sp, "excBrand").join(", ")} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" variant="neutral" size="sm">Apply filters</Button>
                </div>
              </form>
            </Card>
          </div>
        </Section>

        {/* Step 2 & 3 — Review, build, send */}
        <Section
          title="2 · Review, build & send"
          description={
            rows.length === 0
              ? "No products to evaluate yet."
              : `${rows.length} product${rows.length === 1 ? "" : "s"} in view · ${needCount} below reorder point${
                  hasActiveFilters ? " (filtered)" : ""
                }`
          }
        >
          <Card padding="md">
            <BuilderTable
              rows={rows}
              vendors={vendorOptions}
              origin={origin}
              planSummary={planSummary}
              prefill={prefill}
              fromLeadId={fromLead}
              createAction={createPurchaseOrderAction}
              sendAction={createAndSendPurchaseOrderAction}
            />
          </Card>
        </Section>

        {/* Reference: category guidance + planning settings (secondary) */}
        <details className="group rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-[var(--admin-text)] marker:content-none">
            <span className="inline-flex items-center gap-2">
              <span className="text-[var(--admin-text-muted)] group-open:rotate-90 transition">▸</span>
              Reference — cannabis category guidance &amp; planning settings
            </span>
          </summary>
          <div className="space-y-5 border-t border-[var(--admin-border)] px-5 py-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Category benchmarks (industry guidance, not your data)
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CATEGORY_GUIDE.map((c) => (
                  <div
                    key={c.label}
                    className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2"
                  >
                    <div className="text-sm font-semibold text-[var(--admin-text)]">{c.label}</div>
                    <div className="text-xs text-[var(--admin-text-muted)]">{c.note}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Reorder planning defaults
              </h3>
              <form action={saveReorderSettingsAction} className="grid gap-3 sm:grid-cols-4">
                <Field label="Velocity window (days)">
                  <Input type="number" name="velocity_window_days" defaultValue={String(settings.velocity_window_days)} />
                </Field>
                <Field label="Lead time (days)">
                  <Input type="number" name="default_lead_time_days" defaultValue={String(settings.default_lead_time_days)} />
                </Field>
                <Field label="Target days of supply">
                  <Input type="number" name="target_days_of_supply" defaultValue={String(settings.target_days_of_supply)} />
                </Field>
                <Field label="Safety stock (days)">
                  <Input type="number" name="default_safety_days" defaultValue={String(settings.default_safety_days)} />
                </Field>
                <div className="sm:col-span-4">
                  <Button type="submit" variant="save" size="sm">Save settings</Button>
                </div>
              </form>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
