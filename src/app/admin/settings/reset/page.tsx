import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Button } from "@/components/admin/ui";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { resetOperationalDataAction } from "../actions";

export const dynamic = "force-dynamic";

// What the reset removes vs. keeps — surfaced verbatim so the admin knows
// exactly what happens before typing the confirmation phrase. Mirrors the
// reset_operational_data() DB function (migration 0069, guarded in 0097,
// coverage sweep in 0140).
const CLEARED: { group: string; items: string }[] = [
  { group: "Sales & COGS", items: "Orders, order lines & events, register sale events, receipt print jobs, customer returns, special-discount uses, medical exempt sales, sales-limit events, excise & CCRS export/adjustment batches, CCRS week submissions & reminder log, syndication logs" },
  { group: "Inventory", items: "Inventory lots & adjustments, lab results (COAs), cycle counts, destruction events, vendor returns, trade samples & sample JSON imports, inbound manifests, manifest events & payments, non-cannabis invoices & adjustments" },
  { group: "Purchasing", items: "Purchase orders & lines" },
  { group: "Imported products", items: "Menu imports, staged/published menu versions, menu items & variants, fact-review decisions, catalog drafts, AI & master suggestions" },
  { group: "Customers & loyalty", items: "Customers, loyalty accounts / ledger / redemptions, loyalty signups, patient authorizations, newsletter & inbound-email activity" },
  { group: "Registers & staffing", items: "Drawer sessions / counts / drops, safe counts & swaps, till verifications, time punches, shifts, payroll runs & lines & source documents, equipment service history" },
  { group: "Rehearsal & usage", items: "Sage import uploads & chat, AI usage ledger" },
];

const KEPT: { group: string; items: string }[] = [
  { group: "Your settings", items: "Store profile, tax, pricing, license, accounting/ACH, loyalty config & tiers, reorder, samples, sales limits, medical endorsement, receipt printer, integrations & credentials, inventory & website category types" },
  { group: "Knowledge base", items: "All strains, terpenes, brands, category terms, banned phrases, image substitutes, and notes" },
  { group: "Your content", items: "Site content & revisions, page sections, blog posts, home carousel, FAQ, media library, SEO entries, marketing ideas" },
  { group: "Catalog you curate", items: "Product masters & members, product enrichments, brands & vendors (and their aliases), non-cannabis products" },
  { group: "Promotions", items: "Promotions, targets, exclusions, audit snapshots" },
  { group: "People & hardware", items: "Employees, staff profiles, registers, equipment, passkeys" },
  { group: "History", items: "The activity / audit log" },
];

export default async function ResetDataSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const params = await searchParams;

  return (
    <div>
      <AdminPageHeader
        title="Reset operational data"
        subtitle="Start fresh with a clean slate — clears day-to-day data while keeping your settings and knowledge base."
        breadcrumbs={
          <Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Reset data" }]} />
        }
        help={
          <HelpPanel
            id="reset-operational-data"
            title="About resetting data"
            steps={[
              "Use this when you want to clear out test/rehearsal activity before going live.",
              "It removes transactional data only — sales, inventory, imported products, customers, and the like.",
              "It NEVER touches your settings, knowledge base, curated catalog, promotions, or the audit log.",
              "You must type the exact confirmation phrase. The action is recorded in the activity log.",
            ]}
          >
            <p>Only owners and admins can run this. This cannot be undone.</p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {params.done ? (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Reset complete — {decodeURIComponent(params.done)}
          </div>
        ) : null}
        {params.error ? (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {decodeURIComponent(params.error)}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* What gets cleared */}
          <section className="rounded-xl border border-red-500/30 bg-red-500/5 p-5">
            <h2 className="text-sm font-semibold text-red-200">This will DELETE</h2>
            <dl className="mt-3 space-y-3">
              {CLEARED.map((c) => (
                <div key={c.group}>
                  <dt className="text-xs font-bold uppercase tracking-wide text-red-300/90">{c.group}</dt>
                  <dd className="mt-0.5 text-sm text-white/70">{c.items}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* What is preserved */}
          <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <h2 className="text-sm font-semibold text-emerald-200">This will KEEP</h2>
            <dl className="mt-3 space-y-3">
              {KEPT.map((c) => (
                <div key={c.group}>
                  <dt className="text-xs font-bold uppercase tracking-wide text-emerald-300/90">{c.group}</dt>
                  <dd className="mt-0.5 text-sm text-white/70">{c.items}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {/* Confirm + run */}
        <section className="rounded-xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-semibold text-white">Confirm reset</h2>
          <p className="mt-1 text-sm text-white/60">
            This cannot be undone. Washington requires licensees to keep sales, inventory, transport,
            and destruction records for <strong className="text-white/80">five years</strong> (WAC
            314-55-087). If completed sales or CCRS submissions exist, the reset refuses unless you
            attest that everything has been exported first.
          </p>
          <form action={resetOperationalDataAction} className="mt-4 space-y-4">
            <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
              <input
                type="checkbox"
                name="retention_attestation"
                value="1"
                className="mt-0.5 h-4 w-4 accent-amber-500"
              />
              <span className="text-sm text-amber-100/90">
                I attest that all records required by <strong>WAC 314-55-087</strong> (sales, inventory,
                manifests, destruction — 5-year retention) have been <strong>exported and stored
                outside this system</strong> before this reset.
              </span>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[16rem]">
                <span className="mb-1 block text-xs font-medium text-white/60">
                  Type exactly:{" "}
                  <code className="rounded bg-black/40 px-1.5 py-0.5 text-red-300">
                    RESET OPERATIONAL DATA (WAC 314-55-087)
                  </code>
                </span>
                <input
                  name="confirm"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="RESET OPERATIONAL DATA (WAC 314-55-087)"
                  className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-red-400"
                />
              </label>
              <Button type="submit" variant="danger">
                Reset operational data
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
