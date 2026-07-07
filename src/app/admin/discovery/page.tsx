import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card, CardHeader, Section, Field, Input, Select, Textarea } from "@/components/admin/ui";
import { StatCard } from "@/components/admin/StatCard";
import {
  getDiscoverySnapshot,
  listVendorLeads,
  listProductLeads,
  listSources,
} from "@/lib/discovery/store";
import {
  addVendorLeadAction,
  updateVendorLeadStatusAction,
  reconcileVendorLeadsAction,
  addProductLeadAction,
  updateProductLeadStatusAction,
  promoteProductLeadAction,
  setDiscoveryEnabledAction,
} from "./actions";
import { VendorLeadsTable } from "./vendor-leads-table";
import { ProductLeadsTable } from "./product-leads-table";
import { LeadsAssistantPanel } from "./LeadsAssistantPanel";
import { isAiConfigured } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

const CATEGORY_OPTIONS = ["flower", "preroll", "vape", "concentrate", "edible", "topical", "accessory"];

export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  const snap = await getDiscoverySnapshot();

  // Not configured — DB not set up yet.
  if (!snap.configured) {
    return (
      <div>
        <AdminPageHeader
          title="Product Discovery"
          subtitle="Find the products & vendors worth pursuing."
          breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Discovery" }]} />}
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <BackLink />
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once the discovery tables migration
            is applied, your leads will appear here.
          </div>
        </div>
      </div>
    );
  }

  // Kill-switch off.
  if (!snap.enabled) {
    return (
      <div>
        <AdminPageHeader
          title="Product Discovery"
          subtitle="Find the products & vendors worth pursuing."
          breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Discovery" }]} />}
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <BackLink />
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
            Product Discovery is currently <strong className="text-[var(--admin-text)]">turned off</strong>.
            An owner/admin can turn it back on below.
            <form action={setDiscoveryEnabledAction} className="mt-3">
              <input type="hidden" name="enabled" value="1" />
              <Button type="submit" variant="confirm" size="sm">Turn Discovery on</Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const [vendorLeads, productLeads, sources] = await Promise.all([
    listVendorLeads(),
    listProductLeads(),
    listSources(),
  ]);

  // Vendor leads to link products to.
  const vendorLeadOptions = vendorLeads
    .filter((l) => l.status !== "dismissed")
    .map((l) => ({ id: l.id, name: l.display_name }));

  // Source with a commercial-use caveat, to surface a compliance note.
  const cautionSources = sources.filter((s) => s.active && !s.commercial_use_ok);

  const added = one(sp, "added");
  const errorMsg = one(sp, "error");
  const reconciled = one(sp, "reconciled");
  const infoMsg = one(sp, "msg");

  return (
    <div>
      <AdminPageHeader
        title="Product Discovery"
        subtitle="Find the products & vendors worth pursuing — then push a lead straight into a purchase order."
        breadcrumbs={<Breadcrumbs items={[{ label: "Product Intake", href: "/admin/catalog" }, { label: "Product Discovery" }]} />}
        help={
          <HelpPanel
            id="discovery"
            title="How Discovery works"
            steps={[
              "Capture leads: add candidate vendors and products (manually, or import a list on the Import screen).",
              "Qualify: set a status and priority as you research each lead. Vendor leads are auto-reconciled against vendors you already buy from.",
              "Promote: when a product lead is worth ordering, click ‘Start PO from lead’ — it prefills a new purchase order in Purchasing.",
            ]}
          >
            <p className="text-xs text-[var(--admin-text-muted)]">
              This is the front door of the product funnel: Discovery → Purchasing → Receiving →
              Onboarding → Enrichment. Everything here is a draft you confirm — nothing is ordered
              or added to your catalog automatically.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackLink />
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/discovery/import">
              <Button variant="neutral" size="sm">Import leads (CSV)</Button>
            </Link>
          </div>
        </div>

        {/* Banners */}
        {added ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            {added === "vendor" ? "Vendor lead added." : "Product lead added."}
          </div>
        ) : null}
        {reconciled != null ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            Reconciliation complete — {reconciled} lead{reconciled === "1" ? "" : "s"} updated against your vendor list.
          </div>
        ) : null}
        {infoMsg ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            {infoMsg}
          </div>
        ) : null}
        {errorMsg ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-text)]">
            {errorMsg}
          </div>
        ) : null}

        {/* Compliance caveat surfaced from sources */}
        {cautionSources.length > 0 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-xs text-[var(--admin-text)]">
            <span className="font-semibold text-[var(--admin-orange)]">Source note:</span>{" "}
            {cautionSources.map((s) => s.notes || s.name).join(" ")}
          </div>
        ) : null}

        {/* KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="New vendor prospects" value={snap.vendorLeads.unmatched} hint="not already on your vendor list" accent="green" />
          <StatCard label="Vendor leads open" value={snap.vendorLeads.open} hint={`${snap.vendorLeads.qualified} qualified`} accent="muted" />
          <StatCard label="Products shortlisted" value={snap.productLeads.shortlisted} hint={`${snap.productLeads.open} open`} accent="gold" />
          <StatCard label="Promoted to PO" value={snap.productLeads.ordered} hint="pushed into purchasing" accent="muted" />
        </div>

        {/* Data intake only — the "juicy" market analytics now live under Reports → Benchmarks. */}
        <Section
          title="CCRS data intake"
          description="This page is for product & vendor leads. Upload raw WA Public Records CCRS files here — the market benchmarks, competitor pricing and sourcing analytics they power now live under Reports → Benchmarks."
        >
          <Card padding="md">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="text-sm font-semibold text-[var(--admin-text)]">
                  Upload the state dataset here; read the insights in Reports
                </div>
                <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                  Request the CCRS extract via WA Public Records and upload it below. Once processed, the
                  statewide benchmarks and the local competitor &amp; area intelligence (what stores sell for,
                  what they pay vendors, who they source from) appear on the Benchmarks report.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/discovery/ccrs">
                  <Button variant="confirm" size="sm">Request &amp; upload data</Button>
                </Link>
                <Link href="/admin/reports/benchmarks">
                  <Button variant="neutral" size="sm">View Benchmarks report →</Button>
                </Link>
              </div>
            </div>
          </Card>
        </Section>

        {/* AI leads advisor — a grounded second opinion over the pipeline. */}
        <LeadsAssistantPanel aiEnabled={isAiConfigured} />

        {/* Vendor leads */}
        <Section
          title="Vendor leads"
          description="Candidate vendors to pursue. Leads matching a vendor you already buy from are dimmed so you can focus on new prospects."
          action={
            <form action={reconcileVendorLeadsAction}>
              <Button type="submit" variant="neutral" size="sm">Re-check against my vendors</Button>
            </form>
          }
        >
          <div className="space-y-4">
            <VendorLeadsTable leads={vendorLeads} updateAction={updateVendorLeadStatusAction} />
            <Card padding="md">
              <CardHeader title="Add a vendor lead" subtitle="Reconciliation runs automatically on save" />
              <form action={addVendorLeadAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Vendor name (required)">
                  <Input name="display_name" required />
                </Field>
                <Field label="Legal name">
                  <Input name="legal_name" />
                </Field>
                <Field label="WA license number">
                  <Input name="license_number" />
                </Field>
                <Field label="City">
                  <Input name="city" />
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" />
                </Field>
                <Field label="Website">
                  <Input name="website" />
                </Field>
                <Field label="Priority">
                  <Select name="priority" defaultValue="med">
                    <option value="high">high</option>
                    <option value="med">med</option>
                    <option value="low">low</option>
                  </Select>
                </Field>
                <Field label="Note" className="sm:col-span-2 lg:col-span-2">
                  <Input name="note" placeholder="Why pursue this vendor?" />
                </Field>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button type="submit" variant="confirm" size="sm">Add vendor lead</Button>
                </div>
              </form>
            </Card>
          </div>
        </Section>

        {/* Product leads */}
        <Section
          title="Product leads"
          description="Candidate products to pursue. Promote a lead to prefill a new purchase order."
        >
          <div className="space-y-4">
            <ProductLeadsTable
              leads={productLeads}
              updateAction={updateProductLeadStatusAction}
              promoteAction={promoteProductLeadAction}
            />
            <Card padding="md">
              <CardHeader title="Add a product lead" subtitle="Estimated costs are optional (in dollars)" />
              <form action={addProductLeadAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Product name (required)">
                  <Input name="product_name" required />
                </Field>
                <Field label="Brand">
                  <Input name="brand" />
                </Field>
                <Field label="Category">
                  <Select name="category" defaultValue="">
                    <option value="">—</option>
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Pack size">
                  <Input name="pack_size" placeholder="e.g. 3.5g, 100mg 10-pack" />
                </Field>
                <Field label="Est. unit cost ($)">
                  <Input name="est_unit_cost" type="number" step="0.01" min="0" />
                </Field>
                <Field label="Est. retail ($)">
                  <Input name="est_retail" type="number" step="0.01" min="0" />
                </Field>
                <Field label="Link to vendor lead">
                  <Select name="vendor_lead_id" defaultValue="">
                    <option value="">—</option>
                    {vendorLeadOptions.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select name="priority" defaultValue="med">
                    <option value="high">high</option>
                    <option value="med">med</option>
                    <option value="low">low</option>
                  </Select>
                </Field>
                <Field label="Demand signal (why pursue it)" className="sm:col-span-2">
                  <Input name="demand_signal" placeholder="e.g. rising category, frequent customer requests" />
                </Field>
                <Field label="Note" className="sm:col-span-2 lg:col-span-3">
                  <Textarea name="note" rows={2} />
                </Field>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button type="submit" variant="confirm" size="sm">Add product lead</Button>
                </div>
              </form>
            </Card>
          </div>
        </Section>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/catalog"
      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
    >
      ← Back to Product Intake Hub
    </Link>
  );
}
