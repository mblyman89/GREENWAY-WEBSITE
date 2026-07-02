import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card, Field, Input } from "@/components/admin/ui";
import { listVendors } from "@/lib/vendors/store";
import {
  buildReorderSuggestions,
  getReorderSettings,
  type PoFilter,
} from "@/lib/purchasing/po-store";
import {
  createPurchaseOrderAction,
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

  const planSummary = (Array.isArray(sp.plan) ? sp.plan[0] : sp.plan) || undefined;
  const origin = (Array.isArray(sp.origin) ? sp.origin[0] : sp.origin) === "ai_suggested" ? "ai_suggested" : "manual";
  const aiError = Array.isArray(sp.aierror) ? sp.aierror[0] : sp.aierror;
  const settingsSaved = (Array.isArray(sp.settings) ? sp.settings[0] : sp.settings) === "1";

  const vendorOptions = vendors
    .filter((v) => v.display_name)
    .map((v) => ({ id: v.id, name: v.display_name as string }));

  return (
    <div>
      <AdminPageHeader
        title="New purchase order"
        subtitle="Reorder suggestions from on-hand stock and recent sales velocity"
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
        <HelpPanel
          id="po-new-help"
          title="Building this order"
          steps={[
            "Rows below the reorder point are pre-selected with a suggested quantity. Reorder point = average daily sales × lead time + safety stock.",
            "Tick or untick rows, adjust quantities and unit costs, pick the vendor, then Save purchase order.",
            "Use the AI plan box to filter by plain English (e.g. ‘reorder flower from Acme, cover 3 weeks’). AI only proposes a draft filter — you confirm the lines.",
            "Adjust planning defaults (window, lead time, target days, safety days) under Reorder settings.",
          ]}
        />

        {settingsSaved ? (
          <div className="rounded-[var(--admin-radius)] border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            Reorder settings saved.
          </div>
        ) : null}
        {aiError ? (
          <div className="rounded-[var(--admin-radius)] border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {aiError}
          </div>
        ) : null}

        {/* AI plan assist */}
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold text-stone-800">Describe what to order (AI draft)</h2>
          <p className="mb-3 text-xs text-stone-500">
            Plain English. AI maps it to filters using your real vendors and categories — it never invents
            products, and you review every line before saving.
          </p>
          <form action={interpretPlanAction} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              name="request"
              placeholder="e.g. Reorder all flower from Acme except pre-rolls, cover 3 weeks"
              className="flex-1 rounded-[var(--admin-radius)] border border-stone-300 px-3 py-2 text-sm"
            />
            <Button type="submit" variant="neutral" size="sm">Draft plan with AI</Button>
          </form>
        </Card>

        {/* Manual include/exclude filters */}
        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold text-stone-800">Filters</h2>
          <form method="get" className="grid gap-3 sm:grid-cols-2">
            <Field label="Include vendors" help="Comma-separated names; blank = all">
              <Input name="incVendor" defaultValue={csv(sp, "incVendor").join(", ")} />
            </Field>
            <Field label="Exclude vendors" help="Comma-separated names">
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
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit" variant="neutral" size="sm">Apply filters</Button>
              <Link href="/admin/purchasing/new">
                <Button type="button" variant="neutral" size="sm">Reset</Button>
              </Link>
            </div>
          </form>
        </Card>

        {/* Suggestion table + create */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">Reorder suggestions</h2>
          <BuilderTable
            rows={rows}
            vendors={vendorOptions}
            origin={origin}
            planSummary={planSummary}
            createAction={createPurchaseOrderAction}
          />
        </Card>

        {/* Reorder settings */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-stone-800">Reorder settings</h2>
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
        </Card>
      </div>
    </div>
  );
}
