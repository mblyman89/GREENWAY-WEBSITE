import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, BackLink as SharedBackLink } from "@/components/admin/ux";
import { Button, Card, CardHeader, Section, Field, Textarea } from "@/components/admin/ui";
import { getDiscoverySnapshot, listSources } from "@/lib/discovery/store";
import { setDiscoveryEnabledAction, importLeadsAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

const VENDOR_TEMPLATE = `name,legal_name,license_number,city,website,email,priority,note
Evergreen Farms,Evergreen Farms LLC,412345,Olympia,evergreenfarms.com,sales@evergreenfarms.com,high,Strong outdoor flower
Cascade Extracts,Cascade Extracts Inc,987654,Seattle,,hello@cascadeextracts.com,med,Solventless line`;

const PRODUCT_TEMPLATE = `product,brand,category,pack_size,cost,retail,vendor,priority,demand
Blue Dream 3.5g,Evergreen,flower,3.5g,12.00,25.00,Evergreen Farms,high,Top-requested strain
Live Rosin 1g,Cascade,concentrate,1g,22.50,45.00,Cascade Extracts,med,Rising solventless demand`;

export default async function DiscoveryImportPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;

  const snap = await getDiscoverySnapshot();

  // Kill-switch / not-configured guards (Slice 6): enforce on the import route too.
  if (!snap.configured || !snap.enabled) {
    return (
      <div>
        <AdminPageHeader
          title="Import discovery leads"
          subtitle="Paste a CSV/TSV list of candidate vendors or products."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Product Intake", href: "/admin/catalog" },
                { label: "Product Discovery", href: "/admin/discovery" },
                { label: "Import" },
              ]}
            />
          }
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <BackLink back={one(sp, "back")} />
          {!snap.configured ? (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
              The database isn&apos;t fully set up yet. Once the discovery tables migration is
              applied, you can import leads here.
            </div>
          ) : (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-6 text-sm text-[var(--admin-text-muted)]">
              Product Discovery is currently <strong className="text-[var(--admin-text)]">turned off</strong>.
              An owner/admin can turn it back on below.
              <form action={setDiscoveryEnabledAction} className="mt-3">
                <input type="hidden" name="enabled" value="1" />
                <Button type="submit" variant="confirm" size="sm">Turn Discovery on</Button>
              </form>
            </div>
          )}
        </div>
      </div>
    );
  }

  const sources = await listSources();
  const cautionSources = sources.filter((s) => s.active && !s.commercial_use_ok);

  const imported = one(sp, "imported");
  const inserted = one(sp, "inserted");
  const processed = one(sp, "processed");
  const skipped = one(sp, "skipped");
  const errorMsg = one(sp, "error");

  return (
    <div>
      <AdminPageHeader
        title="Import discovery leads"
        subtitle="Paste a CSV/TSV list of candidate vendors or products — they land as drafts you review."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Product Discovery", href: "/admin/discovery" },
              { label: "Import" },
            ]}
          />
        }
        help={
          <HelpPanel
            id="discovery-import"
            title="How importing works"
            steps={[
              "Pick what you're importing: vendor leads or product leads.",
              "Paste rows with a header line. Column names are matched flexibly (e.g. ‘name’, ‘vendor’, ‘license’). Unknown columns are ignored.",
              "Import: rows become draft leads. Duplicates (same license or name/brand) are skipped automatically. Nothing is ordered or added to your catalog.",
            ]}
          >
            <p className="text-xs text-[var(--admin-text-muted)]">
              Costs and retail prices are read in dollars and stored in cents. Product rows that
              name a vendor are linked to a matching vendor lead when one exists.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BackLink back={one(sp, "back")} />

        {imported ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-text)]">
            Imported {imported === "vendor" ? "vendor" : "product"} leads: {inserted ?? "0"} added
            {processed ? ` of ${processed} rows` : ""}
            {skipped && skipped !== "0" ? ` · ${skipped} skipped (missing required fields)` : ""}
            {inserted != null && processed != null && Number(inserted) < Number(processed) - Number(skipped ?? 0)
              ? " · some were duplicates and were skipped"
              : ""}
            .{" "}
            <Link href="/admin/discovery" className="font-semibold text-[var(--admin-accent)] hover:underline">
              View leads →
            </Link>
          </div>
        ) : null}
        {errorMsg ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-text)]">
            {errorMsg}
          </div>
        ) : null}

        {cautionSources.length > 0 ? (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-4 py-3 text-xs text-[var(--admin-text)]">
            <span className="font-semibold text-[var(--admin-orange)]">Before importing from a public list:</span>{" "}
            {cautionSources.map((s) => s.notes || s.name).join(" ")} Only import data you&apos;re
            permitted to use commercially.
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Vendor import */}
          <Section title="Import vendor leads" description="Candidate vendors to pursue.">
            <Card padding="md">
              <CardHeader title="Paste vendor rows" subtitle="Header line + one vendor per row" />
              <form action={importLeadsAction} className="mt-3 space-y-3">
                <input type="hidden" name="kind" value="vendor" />
                <Field label="CSV / TSV" help="Recognized columns: name, legal_name, license_number, city, website, email, priority, note">
                  <Textarea name="data" rows={10} defaultValue="" placeholder={VENDOR_TEMPLATE} className="font-mono text-xs" />
                </Field>
                <div className="flex items-center gap-2">
                  <Button type="submit" variant="confirm" size="sm">Import vendor leads</Button>
                  <span className="text-xs text-[var(--admin-text-muted)]">Duplicates are skipped automatically.</span>
                </div>
              </form>
            </Card>
          </Section>

          {/* Product import */}
          <Section title="Import product leads" description="Candidate products to pursue.">
            <Card padding="md">
              <CardHeader title="Paste product rows" subtitle="Header line + one product per row" />
              <form action={importLeadsAction} className="mt-3 space-y-3">
                <input type="hidden" name="kind" value="product" />
                <Field label="CSV / TSV" help="Recognized columns: product, brand, category, pack_size, cost, retail, vendor, priority, demand, note">
                  <Textarea name="data" rows={10} defaultValue="" placeholder={PRODUCT_TEMPLATE} className="font-mono text-xs" />
                </Field>
                <div className="flex items-center gap-2">
                  <Button type="submit" variant="confirm" size="sm">Import product leads</Button>
                  <span className="text-xs text-[var(--admin-text-muted)]">Costs/retail are in dollars.</span>
                </div>
              </form>
            </Card>
          </Section>
        </div>

        {/* Format reference */}
        <Section title="Format tips" description="How the importer reads your file.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Card padding="sm">
              <div className="text-sm font-semibold text-[var(--admin-text)]">Flexible headers</div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                The first row must be a header. Column names are matched loosely — e.g. “Vendor
                Name”, “company”, or “dba” all map to the vendor name; “license”, “UBI”, or
                “WSLCB license” map to the license number.
              </p>
            </Card>
            <Card padding="sm">
              <div className="text-sm font-semibold text-[var(--admin-text)]">Delimiters &amp; dedupe</div>
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                Comma, tab, semicolon, and pipe are auto-detected. Rows missing a required name
                are reported as skipped; duplicates (same license, or same brand+name) are skipped
                so re-importing is safe.
              </p>
            </Card>
          </div>
        </Section>
      </div>
    </div>
  );
}

function BackLink({ back }: { back?: string }) {
  return (
    <SharedBackLink
      fallback="/admin/discovery"
      back={back}
      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
    >
      ← Back to Product Discovery
    </SharedBackLink>
  );
}
