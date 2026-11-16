import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { listVendors } from "@/lib/vendors/store";
import type { MergeCandidate } from "@/lib/vendors/merge-core";
import { MergeGroupCard } from "@/components/admin/vendors/MergeGroupCard";
import { loadVendorLedger } from "@/lib/vendors/vendor-ledger-server";
import { brandFills, businessGroups, moveGroups, unknownLicenseGroups, type LedgerVendor } from "@/lib/vendors/vendor-ledger-core";
import { ledgerAddLicenseAction, ledgerFillBrandAction, ledgerMergeAction, ledgerMoveLotsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * /admin/vendors/ledger (D246): "What the paperwork says".
 *
 * Every manifest / invoice we were ever sent names the license that shipped
 * each package. This page compares that to the vendor cards and proposes
 * fixes, in the order that matters: (1) lots on the wrong business,
 * (2) licenses no card knows, (3) cards that are one business (same UBI or
 * license), (4) lots missing a brand where the business has only one.
 * Nothing changes until a person clicks; every click is re-checked against
 * the paperwork and audited.
 */

const card = "rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";
const btn = "rounded-[var(--admin-radius)] bg-[var(--admin-orange)] px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110";
const SHOW = 40;

function toCandidate(v: MergeCandidate): MergeCandidate {
  return {
    id: v.id,
    display_name: v.display_name,
    legal_name: v.legal_name ?? null,
    license_number: v.license_number ?? null,
    website: v.website ?? null,
    status: v.status,
    product_count: v.product_count ?? 0,
    brand_count: v.brand_count ?? 0,
    mission_statement: v.mission_statement ?? null,
    about: v.about ?? null,
    product_philosophy: v.product_philosophy ?? null,
    email: v.email ?? null,
    phone: v.phone ?? null,
    vendor_day_notes: v.vendor_day_notes ?? null,
    vendor_number: v.vendor_number ?? null,
    dba: v.dba ?? null,
    shipping_address1: v.shipping_address1 ?? null,
    billing_address1: v.billing_address1 ?? null,
    sage_vendor_id: v.sage_vendor_id ?? null,
    logo_media_id: v.logo_media_id ?? null,
    hero_media_id: v.hero_media_id ?? null,
  };
}

function VendorLink({ v }: { v: LedgerVendor | undefined }) {
  if (!v) return <span className="text-[var(--admin-text-faint)]">(no vendor)</span>;
  return (
    <Link href={`/admin/vendors/${v.id}`} className="font-semibold text-white underline-offset-2 hover:underline">
      {v.display_name}
      {v.license_number ? <span className="ml-1 font-normal text-[var(--admin-text-faint)]">#{v.license_number}</span> : null}
    </Link>
  );
}

export default async function VendorLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string; note?: string; back?: string; all?: string }>;
}) {
  await requirePermission("vendors.manage");
  const sp = await searchParams;
  const showAll = sp.all === "1";

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="What the paperwork says" subtitle="Vendor facts from your manifests and invoices." />
        <div className="px-5 py-6 sm:px-8 text-sm text-[var(--admin-gold)]">The database isn&apos;t set up yet.</div>
      </div>
    );
  }

  const [ledger, allVendors] = await Promise.all([loadVendorLedger(), listVendors()]);
  const byId = new Map(ledger.vendors.map((v) => [v.id, v]));
  const fullById = new Map(allVendors.map((v) => [v.id, v]));
  const c = ledger.result.counts;
  const moves = moveGroups(ledger.result.verdicts);
  const unknown = unknownLicenseGroups(ledger.result);
  const groups = businessGroups(ledger.vendors, ledger.result);
  const fills = brandFills({ lots: ledger.lots, brands: ledger.brands, vendors: ledger.vendors, result: ledger.result });
  const liveVendors = ledger.vendors.filter((v) => !v.merged_into_id).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const cut = <T,>(xs: T[]) => (showAll ? xs : xs.slice(0, SHOW));
  const pct = c.lotsOnPaperwork ? Math.round((c.ok / c.lotsOnPaperwork) * 100) : 0;

  return (
    <div>
      <AdminPageHeader
        title="What the paperwork says"
        subtitle="Every manifest and invoice names the license that shipped each package. This page checks your vendor cards against that, and lets you fix what doesn't match."
        breadcrumbs={<Breadcrumbs items={[{ label: "Vendors & Brands", href: "/admin/vendors" }, { label: "What the paperwork says" }]} />}
        action={
          <BackLink fallback="/admin/vendors" back={sp.back} className="rounded-full border border-white/15 px-4 py-2 text-xs text-white/80 hover:border-[var(--admin-accent)] hover:text-white">
            ← All vendors
          </BackLink>
        }
        help={
          <HelpPanel
            id="vendor-ledger"
            title="How this works"
            steps={[
              "Work top to bottom: move lots first, then add missing licenses, then combine duplicate cards, then fill brands.",
              "Each button re-checks the paperwork before it changes anything, and is recorded in the audit log.",
              "Nothing is deleted. Combined cards are archived and still found by receiving.",
              "After fixing, tap Refresh on the register so it picks up the change.",
            ]}
          >
            <p>
              The license number on a state transfer manifest is the most reliable fact you have about who sent a
              product: it comes from the state&apos;s traceability record, not from a menu or a website. One business
              (one UBI) can hold two or three licenses, which is why many vendors had two or three cards.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{sp.error}</div>}
        {sp.saved && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {sp.note ?? "Saved."}
          </div>
        )}
        {ledger.problems.length > 0 && (
          <div className="rounded-lg border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm text-[var(--admin-gold)]">
            Some records could not be read, so these numbers are partial and the fix buttons are blocked: {ledger.problems.join("; ")}
          </div>
        )}

        <section className={card}>
          <h2 className="text-sm font-bold text-white">Summary</h2>
          <p className="mt-1 text-xs text-[var(--admin-text-faint)]">
            Read {ledger.sources.mailDocs.toLocaleString()} parsed manifests/invoices from the email archive
            {ledger.sources.wciaManifests ? ` plus ${ledger.sources.wciaManifests} imported transfer manifests` : ""}, covering{" "}
            {ledger.result.licenses.size.toLocaleString()} sender licenses.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><div className="text-2xl font-bold text-white">{c.lotsOnPaperwork.toLocaleString()}</div><div className="text-xs text-[var(--admin-text-faint)]">lots found on paperwork ({c.liveOnPaperwork.toLocaleString()} on hand)</div></div>
            <div><div className="text-2xl font-bold text-[var(--admin-accent)]">{pct}%</div><div className="text-xs text-[var(--admin-text-faint)]">on the right business ({c.ok.toLocaleString()})</div></div>
            <div><div className="text-2xl font-bold text-[var(--admin-orange)]">{(c.wrong_business + c.no_vendor).toLocaleString()}</div><div className="text-xs text-[var(--admin-text-faint)]">on the wrong / no business</div></div>
            <div><div className="text-2xl font-bold text-[var(--admin-gold)]">{(c.split_business + c.unknown_license).toLocaleString()}</div><div className="text-xs text-[var(--admin-text-faint)]">on a duplicate card or an unknown license</div></div>
          </div>
          {c.conflict > 0 && <p className="mt-2 text-xs text-[var(--admin-text-faint)]">{c.conflict} lot(s) appear on paperwork from two licenses; those are left alone.</p>}
          {!showAll && (
            <p className="mt-2 text-xs"><Link className="underline" href="/admin/vendors/ledger?all=1">Show every row</Link> (lists are cut to {SHOW} each).</p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-bold text-white">1. Lots on the wrong business ({moves.length} groups)</h2>
          <p className="text-xs text-[var(--admin-text-faint)]">The manifest&apos;s license belongs to a different business than the card the lots are filed on.</p>
          {moves.length === 0 && <p className="text-sm text-[var(--admin-accent)]">None. ✅</p>}
          {cut(moves).map((g) => (
            <div key={g.key} className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-white/90">
                  <strong>{g.lotIds.length}</strong> lot{g.lotIds.length === 1 ? "" : "s"} ({g.liveLots} on hand) shipped under license <strong>{g.license}</strong>
                  {g.docLabel ? <> (“{g.docLabel}”)</> : null}: filed on <VendorLink v={g.fromVendorId ? byId.get(g.fromVendorId) : undefined} />, paperwork says <VendorLink v={byId.get(g.toVendorId)} />
                  {g.sampleNames.length > 0 && <div className="mt-1 text-xs text-[var(--admin-text-faint)]">e.g. {g.sampleNames.join(" · ")}</div>}
                </div>
                <form action={ledgerMoveLotsAction}>
                  <input type="hidden" name="group_key" value={g.key} />
                  <button type="submit" className={btn} disabled={ledger.problems.length > 0}>Move to {byId.get(g.toVendorId)?.display_name ?? "this business"}</button>
                </form>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-bold text-white">2. Licenses no vendor card has ({unknown.length})</h2>
          <p className="text-xs text-[var(--admin-text-faint)]">
            These licenses shipped to you but are on no card. Pick the business it belongs to (pre-selected when the
            printed name matches the card the lots are on). If the card has no license yet it is filled in; otherwise it
            is saved as a second license of that business.
          </p>
          {unknown.length === 0 && <p className="text-sm text-[var(--admin-accent)]">None. ✅</p>}
          {cut(unknown).map((g) => (
            <div key={g.license} className={card}>
              <form action={ledgerAddLicenseAction} className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-white/90">
                  License <strong>{g.license}</strong> {g.docLabel ? <>printed as “{g.docLabel}”</> : null} on {g.docs} document{g.docs === 1 ? "" : "s"}, {g.lotIds.length} lot{g.lotIds.length === 1 ? "" : "s"} ({g.liveLots} on hand)
                  {g.currentVendorId ? <> currently on <VendorLink v={byId.get(g.currentVendorId)} />{g.labelMatchesCurrent ? " (name matches)" : " (name does NOT match, check)"}</> : null}
                </div>
                <div className="flex items-center gap-2">
                  <input type="hidden" name="license" value={g.license} />
                  <select name="vendor_id" defaultValue={g.labelMatchesCurrent && g.currentVendorId ? g.currentVendorId : ""} required className="max-w-[16rem] rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-2 py-1 text-xs text-white">
                    <option value="">Pick the business…</option>
                    {liveVendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.display_name}{v.license_number ? ` #${v.license_number}` : ""}</option>
                    ))}
                  </select>
                  <button type="submit" className={btn} disabled={ledger.problems.length > 0}>Save license</button>
                </div>
              </form>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-bold text-white">3. Cards that are one business ({groups.length})</h2>
          <p className="text-xs text-[var(--admin-text-faint)]">
            These live cards share a UBI (the state business number; first 9 digits) or a license. Combining keeps every
            license, product, logo and record on the kept card and archives the others. Combining also fixes vendor logos
            that never reached the website because they were set on a duplicate card.
          </p>
          {groups.length === 0 && <p className="text-sm text-[var(--admin-accent)]">None. ✅</p>}
          {cut(groups).map((g) => {
            const vs = g.vendorIds.map((id) => fullById.get(id)).filter((v): v is NonNullable<typeof v> => !!v).map(toCandidate);
            if (vs.length < 2) return null;
            vs.sort((a, b) => (a.id === g.suggestedSurvivorId ? -1 : b.id === g.suggestedSurvivorId ? 1 : 0));
            return (
              <MergeGroupCard
                key={g.key}
                vendors={vs}
                suggestedSurvivorId={g.suggestedSurvivorId}
                reasonLabel={g.reason === "same_ubi" ? `Same UBI ${g.key.slice(4)}${g.lotsOnPaperwork ? ` · ${g.lotsOnPaperwork} lots on paperwork` : ""}` : `Same license ${g.key.slice(8)}`}
                mergeAction={ledgerMergeAction}
              />
            );
          })}
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-bold text-white">4. Lots missing a brand ({fills.length} vendors)</h2>
          <p className="text-xs text-[var(--admin-text-faint)]">
            The paperwork confirms the vendor and the vendor has exactly one brand on file. A distributor can carry other
            brands, so check the sample before confirming.
          </p>
          {fills.length === 0 && <p className="text-sm text-[var(--admin-accent)]">None. ✅</p>}
          {cut(fills).map((f) => {
            const names = ledger.lots.filter((l) => f.lotIds.includes(l.id)).slice(0, 3).map((l) => l.product_name).filter(Boolean);
            return (
              <div key={f.vendorId} className={card}>
                <form action={ledgerFillBrandAction} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-white/90">
                    <VendorLink v={byId.get(f.vendorId)} />: {f.lotIds.length} lot{f.lotIds.length === 1 ? "" : "s"} ({f.liveLots} on hand) → brand <strong>{f.brandName}</strong>
                    {names.length > 0 && <div className="mt-1 text-xs text-[var(--admin-text-faint)]">e.g. {names.join(" · ")}</div>}
                  </div>
                  <input type="hidden" name="vendor_id" value={f.vendorId} />
                  <button type="submit" className={btn} disabled={ledger.problems.length > 0}>Set brand</button>
                </form>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
