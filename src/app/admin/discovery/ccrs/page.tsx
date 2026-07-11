import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, Card, CardHeader, Section, Field, Input } from "@/components/admin/ui";
import { getDiscoverySnapshot } from "@/lib/discovery/store";
import { listDatasets } from "@/lib/discovery/ingest";
import { listCompetitors, getSelfCompetitor } from "@/lib/discovery/competitors";
import type { DiscoveryDataset } from "@/lib/discovery/types";
import { CcrsZipUploader } from "./CcrsZipUploader";
import {
  uploadCcrsDatasetAction,
  computeBenchmarksAction,
  generateCcrsVendorLeadsAction,
  enrichKbFromCcrsAction,
  deleteCcrsDatasetAction,
  setDiscoveryEnabledAction,
} from "../actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
function one(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}

// Verified WSLCB Public Records Request contact points (see docs/CCRS_VERIFIED_SCHEMA.md).
const PRA_PORTAL = "https://lcbwa.govqa.us/WEBAPP/_rs/";
const PRA_EMAIL = "lcbpublicrecords@lcb.wa.gov";

const REQUEST_WORDING = `Pursuant to the Public Records Act (RCW 42.56), I request an electronic copy of the \
Cannabis Central Reporting System (CCRS) transactional data for all licensees for the period \
[START DATE] through [END DATE]. Specifically, I request the CCRS Sales, Products, Inventory, \
Lab Results, and Strain data extracts in delimited (CSV) format. Please deliver electronically \
via the records portal. Thank you.`;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function StatusBadge({ status }: { status: DiscoveryDataset["status"] }) {
  const map: Record<DiscoveryDataset["status"], { label: string; cls: string }> = {
    uploading: { label: "Uploading", cls: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]" },
    ready: { label: "Ready", cls: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" },
    error: { label: "Error", cls: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-danger)]" },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

export default async function CcrsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const snap = await getDiscoverySnapshot();

  // Not-configured / kill-switch guards.
  if (!snap.configured || !snap.enabled) {
    return (
      <div>
        <AdminPageHeader
          title="CCRS Benchmarks"
          subtitle="Statewide cannabis market benchmarks from Public Records data."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: "Product Intake", href: "/admin/catalog" },
                { label: "Product Discovery", href: "/admin/discovery" },
                { label: "CCRS Benchmarks" },
              ]}
            />
          }
        />
        <div className="space-y-6 px-5 py-6 sm:px-8">
          <BackLink />
          {!snap.configured ? (
            <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
              The database isn&apos;t fully set up yet. Apply migration <code>0079_discovery_ccrs.sql</code>{" "}
              to enable CCRS benchmarking.
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

  const datasets = await listDatasets();
  // Roster for the monthly-zip transformer: tracked competitor licenses + self
  // (self is passed separately so the aggregator can exclude it structurally).
  const [roster, selfComp] = await Promise.all([listCompetitors(), getSelfCompetitor()]);
  const trackedLicenseNumbers = roster.map((c) => c.license_number);
  const selfLicenseNumber = selfComp?.license_number ?? "413541";

  const uploaded = one(sp, "uploaded");
  const rows = one(sp, "rows");
  const unknown = one(sp, "unknown");
  const computed = one(sp, "computed");
  const leadsInserted = one(sp, "leads_inserted");
  const leadsProcessed = one(sp, "leads_processed");
  const deleted = one(sp, "deleted");
  const errorMsg = one(sp, "error");
  const kbBrands = one(sp, "kb_brands");
  const kbProducts = one(sp, "kb_products");
  const kbRan = one(sp, "kb_ran");
  const kbWarn = one(sp, "kb_warn");

  return (
    <div>
      <AdminPageHeader
        title="CCRS Benchmarks"
        subtitle="Request WA Public Records → upload the raw CCRS files → own the statewide benchmarks."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Product Discovery", href: "/admin/discovery" },
              { label: "CCRS Benchmarks" },
            ]}
          />
        }
        action={
          <Link href="/admin/discovery/benchmarks">
            <Button variant="neutral" size="sm">View benchmarks →</Button>
          </Link>
        }
        help={
          <HelpPanel
            id="discovery-ccrs"
            title="How CCRS benchmarking works"
            steps={[
              "File a Public Records Request with the WSLCB for the CCRS data extracts (step-by-step below).",
              "They email you the raw data as CSV files (Sales, Products, Inventory, Lab Results, Strains).",
              "Upload those files here. The system classifies each file by its columns and stores the rows.",
              "Compute benchmarks: statewide wholesale/retail prices, $/gram, potency, velocity, and top vendors.",
              "Compare against your own live POS/PO data on the Benchmarks page.",
            ]}
          >
            <p className="text-xs text-[var(--admin-text-muted)]">
              This is the same source-of-truth dataset the market-analytics firms use. We own it
              here — no subscription, no third-party dependency.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <BackLink />

        {/* Flash messages */}
        {uploaded ? (
          <Flash tone="ok">
            Uploaded and ingested <strong>{rows ?? "0"}</strong> rows.
            {unknown ? ` Some files were not recognized as CCRS files and were skipped: ${unknown}.` : ""}{" "}
            Now click <strong>Compute benchmarks</strong> on the dataset below.
          </Flash>
        ) : null}
        {computed ? (
          <Flash tone="ok">
            Computed <strong>{computed}</strong> benchmark rows.{" "}
            <Link href="/admin/discovery/benchmarks" className="font-semibold text-[var(--admin-accent)] hover:underline">
              View insights →
            </Link>
          </Flash>
        ) : null}
        {leadsInserted ? (
          <Flash tone="ok">
            Created <strong>{leadsInserted}</strong> new vendor lead(s) from {leadsProcessed ?? "0"} top wholesale sellers
            (duplicates skipped).{" "}
            <Link href="/admin/discovery" className="font-semibold text-[var(--admin-accent)] hover:underline">
              Review leads →
            </Link>
          </Flash>
        ) : null}
        {kbRan || (uploaded && (kbBrands || kbProducts)) ? (
          <Flash tone="ok">
            KB enrichment staged <strong>{kbBrands ?? "0"}</strong> brand and{" "}
            <strong>{kbProducts ?? "0"}</strong> product record(s) as drafts (nothing auto-publishes).{" "}
            <Link
              href="/admin/knowledge-base/review"
              className="font-semibold text-[var(--admin-accent)] hover:underline"
            >
              Review the drafts →
            </Link>
          </Flash>
        ) : null}
        {kbWarn ? <Flash tone="err">{kbWarn}</Flash> : null}
        {deleted ? <Flash tone="ok">Dataset deleted.</Flash> : null}
        {errorMsg ? <Flash tone="err">{errorMsg}</Flash> : null}

        {/* PUBLIC RECORDS REQUEST HELPER */}
        <Section
          title="Step 1 — Request the data from the WSLCB"
          description="A Public Records Act request is free, done online, and delivered electronically as raw CSV files."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <Card padding="md" className="lg:col-span-2">
              <CardHeader title="How to file the request" subtitle="Follow these steps exactly" />
              <ol className="mt-3 space-y-3 text-sm text-[var(--admin-text)]">
                <li className="flex gap-3">
                  <Step n={1} />
                  <span>
                    Go to the WSLCB Public Records Center:{" "}
                    <a href={PRA_PORTAL} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--admin-accent)] hover:underline">
                      {PRA_PORTAL}
                    </a>
                    . Create a free account (name + email) so they can deliver the files to you.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Step n={2} />
                  <span>
                    Start a <strong>new request</strong>. In the description box, paste the request wording from
                    the panel on the right and fill in your date range. Ask for the{" "}
                    <strong>CCRS</strong> (Cannabis Central Reporting System) transactional extracts.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Step n={3} />
                  <span>
                    Choose <strong>electronic delivery</strong> (the default). CCRS extracts are large flat files —
                    you&apos;ll receive them as CSVs, often zipped, via a download link.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Step n={4} />
                  <span>
                    Submit. You&apos;ll get a confirmation with a tracking number. The WSLCB acknowledges within
                    5 business days and provides the records or a reasonable time estimate.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Step n={5} />
                  <span>
                    When the files arrive, unzip them and upload them in <strong>Step 2</strong> below. File names
                    usually look like <code>Sale_*.csv</code>, <code>Product_*.csv</code>,{" "}
                    <code>Inventory_*.csv</code>, <code>LabResult_*.csv</code>, <code>Strain_*.csv</code>.
                  </span>
                </li>
              </ol>

              <div className="mt-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs text-[var(--admin-text-muted)]">
                <div className="font-semibold text-[var(--admin-text)]">Other ways to reach the WSLCB Public Records office</div>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  <div>Email: <a href={`mailto:${PRA_EMAIL}`} className="text-[var(--admin-accent)] hover:underline">{PRA_EMAIL}</a></div>
                  <div>Phone: (360) 664-1769</div>
                  <div>Fax: (360) 704-4940</div>
                  <div>Mail: PO Box 43080, Olympia, WA 98504-3080</div>
                </div>
              </div>
            </Card>

            <Card padding="md">
              <CardHeader title="Copy-paste request wording" subtitle="Fill in your dates" />
              <pre className="mt-3 whitespace-pre-wrap rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--admin-text)]">
{REQUEST_WORDING}
              </pre>
              <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 p-3 text-[11px] text-[var(--admin-text)]">
                <span className="font-semibold text-[var(--admin-orange)]">Legal note:</span> Per RCW 42.56.070(8),
                records received through the Public Records Act may not be used for commercial purposes. Use these
                benchmarks for your own internal buying and pricing decisions only. This feature is fully removable.
              </div>
            </Card>
          </div>
        </Section>

        {/* MONTHLY ZIP TRANSFORMER (Task H) — the zero-touch path */}
        <Section
          title="Step 2 — Drop the monthly zip"
          description="Drag the ONE big zip from the WSLCB delivery straight in. Everything else — unzipping, parsing, statewide benchmarks, competitor stats, market signals — happens automatically."
        >
          <Card padding="md">
            <CcrsZipUploader
              selfLicenseNumber={selfLicenseNumber}
              trackedLicenseNumbers={trackedLicenseNumbers}
            />
            <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
              The raw file is crunched locally in your browser and never uploads — only the compact
              market rollups are saved. Feeds the{" "}
              <Link href="/admin/discovery/benchmarks" className="font-semibold text-[var(--admin-accent)] hover:underline">
                CCRS Benchmarks
              </Link>
              , the Leads page, and Reports → Local Benchmarks. Requires migration{" "}
              <code>0106_discovery_market_rollups.sql</code>.
            </p>
          </Card>
        </Section>

        {/* LEGACY UPLOAD CENTER (per-file CSV path, kept for targeted uploads) */}
        <Section
          title="Advanced — upload individual CSV files"
          description="The older per-file path. Attach one or more CSV files; each is auto-detected by its columns. Use the zip drop above for the monthly extract."
        >
          <Card padding="md">
            <form action={uploadCcrsDatasetAction} className="space-y-4" encType="multipart/form-data">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Dataset label" help="A name so you can tell datasets apart, e.g. 'Statewide Q1 2025'.">
                  <Input name="label" defaultValue="" placeholder="Statewide — Q1 2025" required />
                </Field>
                <Field label="Source note (optional)" help="e.g. PRA tracking number or received date.">
                  <Input name="source_note" defaultValue="" placeholder="PRA #P012345 · received 2025-04-10" />
                </Field>
                <Field label="Period start (optional)" help="First day the data covers.">
                  <Input name="period_start" type="date" defaultValue="" />
                </Field>
                <Field label="Period end (optional)" help="Last day the data covers.">
                  <Input name="period_end" type="date" defaultValue="" />
                </Field>
              </div>
              <Field label="CCRS CSV files" help="Sale, Product, Inventory, LabResult and Strain files. Select several at once.">
                <input
                  type="file"
                  name="files"
                  multiple
                  accept=".csv,text/csv"
                  className="block w-full text-sm text-[var(--admin-text)] file:mr-3 file:rounded-[var(--admin-radius)] file:border-0 file:bg-[var(--admin-orange)] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-black hover:file:brightness-110"
                  required
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" variant="confirm" size="sm">Upload &amp; ingest</Button>
                <span className="text-xs text-[var(--admin-text-muted)]">
                  Sales money is stored in cents. Prices per gram are derived automatically.
                </span>
              </div>
            </form>
          </Card>
        </Section>

        {/* DATASET LIST */}
        <Section
          title="Step 3 — Compute benchmarks &amp; generate leads"
          description="For each dataset, compute the statewide benchmarks, then optionally turn top wholesale sellers into vendor leads."
        >
          {datasets.length === 0 ? (
            <Card padding="md">
              <p className="text-sm text-[var(--admin-text-muted)]">
                No datasets yet. Upload your first CCRS files above to get started.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {datasets.map((d) => (
                <Card key={d.id} padding="md">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--admin-text)]">{d.label}</span>
                        <StatusBadge status={d.status} />
                      </div>
                      <div className="mt-1 text-xs text-[var(--admin-text-muted)]">
                        {d.period_start || d.period_end
                          ? `${fmtDate(d.period_start)} → ${fmtDate(d.period_end)} · `
                          : ""}
                        Uploaded {fmtDate(d.created_at)}
                        {d.source_note ? ` · ${d.source_note}` : ""}
                        {d.benchmarks_computed_at
                          ? ` · benchmarks computed ${fmtDate(d.benchmarks_computed_at)}`
                          : " · benchmarks not computed yet"}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                        <RowChip label="Sales" n={d.sales_rows} />
                        <RowChip label="Products" n={d.product_rows} />
                        <RowChip label="Inventory" n={d.inventory_rows} />
                        <RowChip label="Lab" n={d.lab_rows} />
                        <RowChip label="Strains" n={d.strain_rows} />
                      </div>
                      {d.error ? (
                        <div className="mt-2 text-xs text-[var(--admin-danger)]">Error: {d.error}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={computeBenchmarksAction}>
                        <input type="hidden" name="dataset_id" value={d.id} />
                        <Button type="submit" variant="primary" size="sm" disabled={d.sales_rows === 0}>
                          Compute benchmarks
                        </Button>
                      </form>
                      <form action={generateCcrsVendorLeadsAction}>
                        <input type="hidden" name="dataset_id" value={d.id} />
                        <Button type="submit" variant="save" size="sm" disabled={d.sales_rows === 0}>
                          Generate vendor leads
                        </Button>
                      </form>
                      <form action={enrichKbFromCcrsAction}>
                        <input type="hidden" name="dataset_id" value={d.id} />
                        <Button type="submit" variant="neutral" size="sm" disabled={d.product_rows === 0}>
                          Enrich KB
                        </Button>
                      </form>
                      <form action={deleteCcrsDatasetAction}>
                        <input type="hidden" name="dataset_id" value={d.id} />
                        <Button type="submit" variant="danger" size="sm">Delete</Button>
                      </form>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--admin-orange)] text-[11px] font-bold text-black">
      {n}
    </span>
  );
}

function RowChip({ label, n }: { label: string; n: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-0.5 text-[var(--admin-text-muted)]">
      <span className="font-semibold text-[var(--admin-text)]">{n.toLocaleString()}</span> {label}
    </span>
  );
}

function Flash({ tone, children }: { tone: "ok" | "err"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]"
      : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10";
  return (
    <div className={`rounded-[var(--admin-radius)] border ${cls} px-4 py-2 text-sm text-[var(--admin-text)]`}>
      {children}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/discovery"
      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"
    >
      ← Back to Product Discovery
    </Link>
  );
}
