import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState, SkeletonCard, SkeletonRows } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Section, Input, Select, Button } from "@/components/admin/ui";
import { isCultiveraClientConfigured } from "@/lib/purchasing/cultivera-client";
import { listEmailedMenus } from "@/lib/purchasing/emailed-menu-store";
import { sortEmailedRows } from "@/lib/purchasing/email-menu-core";
import { loadVendorMenuCoverage } from "@/lib/purchasing/vendor-menu-coverage-store";
import {
  ageLabel,
  coverageHref,
  filterSortNeeded,
  filterSortSearched,
  freshnessTone,
  matchHowLabel,
  money,
  needGroupLabel,
  parseCoverageParams,
  rememberedLabel,
  rememberedTone,
  sourceLabel,
  sourceTone,
  FRESH_DAYS,
  STALE_DAYS,
  RECENT_RECEIVED_DAYS,
  type CoverageParams,
  type NeedGroup,
  type NeededRow,
  type SearchedRow,
} from "@/lib/purchasing/vendor-menu-coverage-core";
import { VendorSearch } from "./vendor-search";
import { FetchLogoButton, FetchAllLogosButton } from "./fetch-logo-button";
import { LinkVendorButton, VendorPickList } from "./link-vendor-button";
import type { VendorPickOption } from "@/lib/purchasing/vendor-menu-coverage-core";
// D241 — Budalerts (internal use only): toolbar, per-row link/fetch, and the "done" table.
import { loadBudalertsBoard } from "@/lib/purchasing/budalerts-board-store";
import type { BudalertsRowInfo } from "@/lib/purchasing/budalerts-core";
import { BudalertsToolbar, BudalertsDoneTable } from "./budalerts-sections";
import { BudalertsRowControls } from "./budalerts-controls";

export const dynamic = "force-dynamic";
// D212: the logo-fetch actions search up to three marketplaces per vendor.
export const maxDuration = 300;

/**
 * Vendor Menus command center (GF-5 → D209).
 *
 * D209 (owner, verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 * "add as much details to that table as possible ... a table of all vendors
 * we have products from that have not yet been searched".
 *
 * Rule 18: the header, help and search box draw at once. The KPIs, the
 * per-vendor menus table and the "still need a menu" table each stream in
 * their own <Suspense>; they share ONE cache()d load per request.
 */

const BASE = "/admin/purchasing/menus";

/** Minute-rounded clock so every section hits the same cache() entry (repo pattern: Date.now() in a helper). */
function nowMinute(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function statusTone(s: string): "green" | "gold" | "danger" | "neutral" {
  if (s === "fetched" || s === "parsed") return "green";
  if (s === "empty" || s === "partial") return "gold";
  if (s === "error") return "danger";
  return "neutral";
}

const TH = "px-3 py-2.5 font-semibold";
const TD = "px-3 py-3 align-top";
const TABLE_SHELL = "overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]";
const THEAD = "bg-[var(--admin-surface-2)] text-left text-[0.65rem] uppercase tracking-wide text-[var(--admin-text-faint)]";
const ROW = "bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]";
const FAINT = "text-xs text-[var(--admin-text-faint)]";
const LINK = "text-[var(--admin-accent)] hover:underline";

type SP = Record<string, string | string[] | undefined>;

export default async function VendorMenusPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("inventory.manage");
  const p = parseCoverageParams(await searchParams);
  const configured = isCultiveraClientConfigured();
  const now = nowMinute();

  return (
    <div>
      <AdminPageHeader
        title="Vendor Menus"
        subtitle="Every vendor's wholesale menu in one place — what we have, how fresh it is, what it costs, and who we still need a menu from"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Product Intake", href: "/admin/catalog" },
              { label: "Purchasing", href: "/admin/purchasing" },
              { label: "Vendor Menus" },
            ]}
          />
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        <HelpPanel
          id="vendor-menus-help"
          title="How vendor menus work"
          steps={[
            "Type a vendor's name in the search box. We search the marketplace their menu last came from first, then the others.",
            "Click 'Fetch menu' to save a dated copy of that vendor's live menu. It joins the Menus on file table, one row per vendor.",
            "Menus on file shows each vendor's newest menu from every source, how old it is, the price spread, potency, photo and COA coverage, and our own stock from them. Open 'History' to see every pull.",
            "Still need a menu lists every vendor we have received product from with no usable menu on file. Vendors with stock on the shelf come first. Use 'Search' to look them up or 'Email' to ask for one.",
            "If a menu says 'not linked to a vendor', or is on the wrong vendor, click 'Link to vendor' and pick the right card. It is remembered for every future pull of that menu. Rows that show duplicate cards link to Merge vendors.",
            "'Fetch logo' pulls a vendor's logo from GrowFlow, Cultivera or LeafLink and attaches it, published, to the vendor and its brands so it shows on the website at once. 'Fetch all missing logos' does every vendor we carry that has none.",
            "No wholesale menu anywhere? In the Budalerts column, link the vendor to its Budalerts brand (exact-name suggestions are offered) and fetch. Its photos and prices are saved for internal use only, and the vendor moves to the 'Done — data gathered from Budalerts' table.",
          ]}
        >
          <p>
            A menu counts as on file once a pull came back with at least one item. Menus are matched to our vendors by the
            link on the menu, then a link you saved with &lsquo;Link to vendor&rsquo;, then the license number, then the name (also
            ignoring LLC / Inc / Co, marketing words and the menu&rsquo;s web address). When a business has duplicate cards, the card we
            receive from is used and the row suggests merging the duplicates. Each row says how and why it was matched. A tie that
            can&rsquo;t be broken is never guessed: use &lsquo;Link to vendor&rsquo; once and every future pull follows it. Freshness: up to {FRESH_DAYS} days is fresh, up to {STALE_DAYS} is aging, after that is stale. Purchase
            orders live in{" "}
            <Link href="/admin/purchasing" className={LINK}>Purchasing</Link>.
          </p>
        </HelpPanel>

        <Suspense fallback={<KpiSkeleton />}>
          <CoverageKpis now={now} p={p} />
        </Suspense>

        <section id="find">
          <Section
            title="Find a vendor"
            description="One box, every marketplace. A first fetch can take up to a minute while the worker signs in."
          >
            {configured ? (
              <VendorSearch key={p.find} initialQuery={p.find} />
            ) : (
              <EmptyState
                icon="🔌"
                title="The crawler isn't connected yet"
                description="Set CRAWLER_BASE_URL and CRAWLER_SHARED_SECRET on the site, plus the marketplace logins on the crawler worker. Saved menus below stay browsable either way."
              />
            )}
          </Section>
        </section>

        <section id="needed" className="space-y-3">
          <Suspense fallback={null}>
            <BudalertsToolbar now={now} />
          </Suspense>
          <Suspense fallback={<TableSkeleton title="Still need a menu" />}>
            <NeededTable now={now} p={p} />
          </Suspense>
        </section>

        <section id="budalerts-done">
          <Suspense fallback={<TableSkeleton title="Done — data gathered from Budalerts" />}>
            <BudalertsDoneTable now={now} />
          </Suspense>
        </section>

        <section id="searched">
          <Suspense fallback={<TableSkeleton title="Menus on file" />}>
            <SearchedTable now={now} p={p} />
          </Suspense>
        </section>

        <Suspense fallback={<TableSkeleton title="Emailed vendor menus" />}>
          <EmailedMenus now={now} />
        </Suspense>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Skeletons
 * ------------------------------------------------------------------ */

function KpiSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-7">
      {Array.from({ length: 7 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

function TableSkeleton({ title }: { title: string }) {
  return (
    <Section title={title}>
      <div className={TABLE_SHELL}>
        <SkeletonRows rows={6} />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------
 * KPIs + warnings
 * ------------------------------------------------------------------ */

async function CoverageKpis({ now, p }: { now: number; p: CoverageParams }) {
  const cov = await loadVendorMenuCoverage(now);
  const k = cov.kpis;
  return (
    <div className="space-y-3">
      {cov.warnings.length > 0 && (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] p-4 text-sm text-[var(--admin-danger)]">
          <p className="font-semibold">Some of this page could not be read, so the tables below may be incomplete:</p>
          <ul className="mt-1 list-disc pl-5">
            {cov.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <StatCard
          label="Vendors we carry"
          value={String(k.carried)}
          hint="have at least one lot received"
          accent={k.carried ? "green" : "muted"}
        />
        <StatCard
          label="Menu coverage"
          value={k.coveredPct === null ? "—" : `${k.coveredPct}%`}
          hint={`${k.covered} of ${k.carried} have a menu on file`}
          accent={k.coveredPct !== null && k.coveredPct >= 80 ? "green" : "gold"}
        />
        <StatCard
          label="Still need — on shelf"
          value={String(k.neededOnShelf)}
          hint={`${k.needed} vendors need a menu in all`}
          accent={k.neededOnShelf ? "gold" : "muted"}
          href={coverageHref(BASE, p, { ngrp: "on_shelf" }, "#needed")}
        />
        <StatCard
          label="Menus on file"
          value={String(k.menusOnFile)}
          hint={`${k.itemsOnFile.toLocaleString("en-US")} items in the newest copies`}
          accent={k.menusOnFile ? "green" : "muted"}
          href={coverageHref(BASE, p, {}, "#searched")}
        />
        <StatCard
          label="Stale menus"
          value={String(k.stale)}
          hint={`older than ${STALE_DAYS} days`}
          accent={k.stale ? "gold" : "muted"}
          href={coverageHref(BASE, p, { sfresh: "stale" }, "#searched")}
        />
        <StatCard
          label="Not linked"
          value={String(k.unlinked)}
          hint="menus we could not tie to a vendor"
          accent={k.unlinked ? "gold" : "muted"}
          href={coverageHref(BASE, p, { slink: "unlinked" }, "#searched")}
        />
        <StatCard
          label="Missing a logo"
          value={String(cov.missingLogos)}
          hint="vendors we carry with no logo on the website"
          accent={cov.missingLogos ? "gold" : "green"}
          href="#logos"
        />
      </div>
      {cov.configured && (
        <div id="logos" className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
          <div className="max-w-2xl text-sm text-[var(--admin-text-muted)]">
            <p className="font-semibold text-[var(--admin-text)]">Vendor logos</p>
            <p className="mt-0.5 text-xs">
              &ldquo;Fetch logo&rdquo; finds the vendor&rsquo;s profile on GrowFlow, Cultivera or LeafLink, saves the logo to the
              Media Library, and attaches it to the vendor and all of its brands, published, so it shows on the website right
              away. A vendor that already has a logo is only changed when you click &ldquo;Replace logo&rdquo;. A profile that
              fits more than one of our vendors is skipped, never guessed.
            </p>
          </div>
          <FetchAllLogosButton missing={cov.missingLogos} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
 * Filter bar (GET form — keeps the OTHER table's params as hidden inputs)
 * ------------------------------------------------------------------ */

function Hidden({ p, keep }: { p: CoverageParams; keep: (keyof CoverageParams)[] }) {
  return (
    <>
      {keep.map((k) => (p[k] ? <input key={k} type="hidden" name={k} value={p[k]} /> : null))}
    </>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
          : "border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:border-[var(--admin-accent)]"
      }`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------
 * STILL NEED A MENU
 * ------------------------------------------------------------------ */

async function NeededTable({ now, p }: { now: number; p: CoverageParams }) {
  const cov = await loadVendorMenuCoverage(now);
  // D241 — vendors whose data came from Budalerts move to the "done" table below.
  const board = await loadBudalertsBoard(now);
  const all = board.stillNeeded;
  const rows = filterSortNeeded(all, p);
  const count = (g: NeedGroup | "tried") => (g === "tried" ? all.filter((r) => r.attempts.length > 0).length : all.filter((r) => r.group === g).length);
  const csvHref = `${BASE}/csv${coverageHref("", p, { find: "" })}${coverageHref("", p, { find: "" }).includes("?") ? "&" : "?"}table=needed`;

  return (
    <Section
      title={`Still need a menu (${all.length})`}
      description={`Vendors we have received product from with no usable menu on file. Vendors with product on the shelf come first, then vendors received in the last ${RECENT_RECEIVED_DAYS} days (Pacific), then older ones.`}
      action={
        <a href={csvHref} className={`${LINK} text-xs font-medium`}>
          Download CSV
        </a>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip href={coverageHref(BASE, p, { ngrp: "" }, "#needed")} active={!p.ngrp}>All {all.length}</Chip>
        {(["on_shelf", "recent", "older"] as const).map((g) => (
          <Chip key={g} href={coverageHref(BASE, p, { ngrp: g }, "#needed")} active={p.ngrp === g}>
            {needGroupLabel(g)} {count(g)}
          </Chip>
        ))}
        <Chip href={coverageHref(BASE, p, { ngrp: "tried" }, "#needed")} active={p.ngrp === "tried"}>
          Tried, came back empty {count("tried")}
        </Chip>
      </div>
      <form method="get" action={`${BASE}#needed`} className="mb-3 flex flex-wrap items-end gap-2">
        <Hidden p={p} keep={["sq", "ssrc", "sfresh", "slink", "ssort", "ngrp"]} />
        <Input name="nq" defaultValue={p.nq} placeholder="Filter by name, DBA, license, category…" className="max-w-xs" />
        <Select name="nsort" defaultValue={p.nsort} className="max-w-[14rem]">
          <option value="stock">Sort: most urgent first</option>
          <option value="recent">Sort: last received</option>
          <option value="lots">Sort: most lots</option>
          <option value="ytd">Sort: YTD accepted $</option>
          <option value="name">Sort: name A–Z</option>
        </Select>
        <Button type="submit" variant="neutral" size="sm">Apply</Button>
        {(p.nq || p.ngrp || p.nsort !== "stock") && (
          <Link href={coverageHref(BASE, p, { nq: "", ngrp: "", nsort: "stock" }, "#needed")} className={`${FAINT} hover:underline`}>
            Clear
          </Link>
        )}
      </form>

      {!cov.configured ? (
        <EmptyState icon="🗄️" title="The database isn't connected" description="Once Supabase is configured, vendors you carry without a menu appear here." />
      ) : all.length === 0 ? (
        <EmptyState icon="🎉" title="Every vendor we carry has a menu on file" description="When product arrives from a new vendor, they appear here until their menu is pulled." />
      ) : rows.length === 0 ? (
        <EmptyState icon="🔎" title="No vendors match these filters" description="Clear the filters to see the full list." />
      ) : (
        <div className={TABLE_SHELL}>
          <table className="w-full min-w-[64rem] text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Vendor</th>
                <th className={TH}>Priority</th>
                <th className={`${TH} text-right`}>Our stock</th>
                <th className={TH}>Received</th>
                <th className={TH}>What we buy</th>
                <th className={`${TH} text-right`}>YTD accepted</th>
                <th className={TH}>Where to look</th>
                <th className={TH}>Contact</th>
                {board.available && <th className={TH}>Budalerts</th>}
                <th className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {rows.map((r) => (
                <NeededTr
                  key={r.vendor.id}
                  r={r}
                  p={p}
                  now={now}
                  logoUrl={cov.logos[r.vendor.id] ?? null}
                  budalerts={board.available ? board.rows[r.vendor.id] ?? { linked: [], suggestions: [] } : null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && rows.length !== all.length && (
        <p className={`mt-2 ${FAINT}`}>Showing {rows.length} of {all.length}.</p>
      )}
    </Section>
  );
}

function needTone(g: NeedGroup): "danger" | "gold" | "neutral" {
  if (g === "on_shelf") return "danger";
  if (g === "recent") return "gold";
  return "neutral";
}

function NeededTr({
  r,
  p,
  now,
  logoUrl,
  budalerts,
}: {
  r: NeededRow;
  p: CoverageParams;
  now: number;
  logoUrl: string | null;
  budalerts: BudalertsRowInfo | null;
}) {
  const v = r.vendor;
  const searchName = (v.dba || v.display_name).trim();
  return (
    <tr className={ROW}>
      <td className={TD}>
        <Link href={`/admin/vendors/${v.id}`} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
          {v.display_name}
        </Link>
        <div className={FAINT}>
          {[v.dba && v.dba !== v.display_name ? `DBA ${v.dba}` : "", v.license_number ? `Lic ${v.license_number}` : "", v.is_active === false ? "inactive" : ""]
            .filter(Boolean)
            .join(" · ") || "—"}
        </div>
      </td>
      <td className={TD}>
        <Badge tone={needTone(r.group)}>{needGroupLabel(r.group)}</Badge>
        {r.attempts.length > 0 && (
          <details className="mt-1">
            <summary className={`cursor-pointer ${FAINT}`}>
              {r.attempts.length} pull{r.attempts.length === 1 ? "" : "s"} came back empty
            </summary>
            <ul className="mt-1 space-y-0.5">
              {r.attempts.slice(0, 6).map((a) => (
                <li key={`${a.source}:${a.id}`} className={FAINT}>
                  <Link href={a.href} className={LINK}>{sourceLabel(a.source)}</Link> · {a.status} · {ageLabel(a.fetchedAt, now)}
                  {a.errorMessage ? ` · ${a.errorMessage.slice(0, 80)}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td className={`${TD} text-right tabular-nums`}>
        <div className="font-medium text-[var(--admin-text)]">{r.lots.lotsInStock} in stock</div>
        <div className={FAINT}>
          {r.lots.lotsTotal} lot{r.lots.lotsTotal === 1 ? "" : "s"} total
          {r.lots.unitsOnHand > 0 ? ` · ${Math.round(r.lots.unitsOnHand).toLocaleString("en-US")} units` : ""}
        </div>
      </td>
      <td className={TD}>
        <div className="text-[var(--admin-text-muted)]">
          {r.lots.lastReceived ?? "—"}
          {r.daysSinceReceived !== null && <span className={FAINT}> · {r.daysSinceReceived}d ago</span>}
        </div>
        {r.lots.firstReceived && r.lots.firstReceived !== r.lots.lastReceived && (
          <div className={FAINT}>first {r.lots.firstReceived}</div>
        )}
      </td>
      <td className={TD}>
        <div className="flex flex-wrap gap-1">
          {r.lots.categories.length ? r.lots.categories.map((c) => <Badge key={c}>{c}</Badge>) : <span className={FAINT}>—</span>}
        </div>
      </td>
      <td className={`${TD} text-right tabular-nums text-[var(--admin-text-muted)]`}>
        {v.total_accepted_ytd_cents ? money(v.total_accepted_ytd_cents) : "—"}
      </td>
      <td className={TD}>
        {r.rememberedPlatform ? (
          <Badge tone={rememberedTone(r.rememberedPlatform)}>{rememberedLabel(r.rememberedPlatform)}</Badge>
        ) : (
          <span className={FAINT}>not seen yet</span>
        )}
      </td>
      <td className={`${TD} max-w-[14rem]`}>
        {v.email ? <div className="truncate text-xs text-[var(--admin-text-muted)]" title={v.email}>{v.email}</div> : null}
        {v.phone ? <div className={FAINT}>{v.phone}</div> : null}
        {v.website ? (
          <a href={v.website.startsWith("http") ? v.website : `https://${v.website}`} target="_blank" rel="noopener noreferrer" className={`${LINK} text-xs`}>
            website ↗
          </a>
        ) : null}
        {!v.email && !v.phone && !v.website && <span className={FAINT}>no contact on file</span>}
      </td>
      {budalerts && (
        <td className={`${TD} min-w-[12rem]`}>
          <BudalertsRowControls vendorId={v.id} vendorName={v.display_name} linked={budalerts.linked} suggestions={budalerts.suggestions} />
        </td>
      )}
      <td className={TD}>
        <div className="flex flex-col gap-1 text-xs font-medium">
          <Link href={coverageHref(BASE, p, { find: searchName }, "#find")} scroll={false} className={LINK}>
            Search menus →
          </Link>
          {r.mailto ? (
            <a href={r.mailto} className={LINK}>Email for menu</a>
          ) : (
            <Link href={`/admin/vendors/${v.id}`} className={`${FAINT} hover:underline`}>add an email</Link>
          )}
          <FetchLogoButton vendorId={v.id} vendorName={v.display_name} logoUrl={logoUrl} />
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------
 * MENUS ON FILE — one row per vendor
 * ------------------------------------------------------------------ */

async function SearchedTable({ now, p }: { now: number; p: CoverageParams }) {
  const cov = await loadVendorMenuCoverage(now);
  const all = cov.searched;
  const rows = filterSortSearched(all, p);
  const qs = coverageHref("", p, { find: "" });
  const csvHref = `${BASE}/csv${qs}${qs.includes("?") ? "&" : "?"}table=searched`;
  const failedCount = all.filter((r) => !r.hasUsable).length;

  return (
    <Section
      title={`Menus on file (${all.length} vendors)`}
      description="One row per vendor. It shows the newest menu from each source, how it was matched to our vendor, its freshness, item change since the last pull, the wholesale price spread, potency, photo and COA coverage, and our own stock. Open History to see every pull."
      action={
        <a href={csvHref} className={`${LINK} text-xs font-medium`}>
          Download CSV
        </a>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip href={coverageHref(BASE, p, { sfresh: "" }, "#searched")} active={!p.sfresh}>Any age</Chip>
        <Chip href={coverageHref(BASE, p, { sfresh: "fresh" }, "#searched")} active={p.sfresh === "fresh"}>Fresh ≤{FRESH_DAYS}d</Chip>
        <Chip href={coverageHref(BASE, p, { sfresh: "aging" }, "#searched")} active={p.sfresh === "aging"}>Aging ≤{STALE_DAYS}d</Chip>
        <Chip href={coverageHref(BASE, p, { sfresh: "stale" }, "#searched")} active={p.sfresh === "stale"}>Stale</Chip>
        <Chip href={coverageHref(BASE, p, { sfresh: "failed" }, "#searched")} active={p.sfresh === "failed"}>Empty / failed {failedCount}</Chip>
      </div>
      <form method="get" action={`${BASE}#searched`} className="mb-3 flex flex-wrap items-end gap-2">
        <Hidden p={p} keep={["nq", "ngrp", "nsort", "sfresh"]} />
        <Input name="sq" defaultValue={p.sq} placeholder="Filter by vendor, license, category…" className="max-w-xs" />
        <Select name="ssrc" defaultValue={p.ssrc} className="max-w-[11rem]">
          <option value="">All sources</option>
          <option value="cultivera">Cultivera</option>
          <option value="growflow">GrowFlow</option>
          <option value="leaflink">LeafLink</option>
          <option value="email">Emailed</option>
        </Select>
        <Select name="slink" defaultValue={p.slink} className="max-w-[13rem]">
          <option value="">Linked or not</option>
          <option value="carried">Vendors we carry</option>
          <option value="linked">Linked to a vendor</option>
          <option value="unlinked">Not linked</option>
        </Select>
        <Select name="ssort" defaultValue={p.ssort} className="max-w-[14rem]">
          <option value="newest">Sort: newest menu</option>
          <option value="oldest">Sort: oldest menu</option>
          <option value="items">Sort: most items</option>
          <option value="stock">Sort: our stock</option>
          <option value="price">Sort: lowest median price</option>
          <option value="name">Sort: name A–Z</option>
        </Select>
        <Button type="submit" variant="neutral" size="sm">Apply</Button>
        {(p.sq || p.ssrc || p.slink || p.sfresh || p.ssort !== "newest") && (
          <Link href={coverageHref(BASE, p, { sq: "", ssrc: "", slink: "", sfresh: "", ssort: "newest" }, "#searched")} className={`${FAINT} hover:underline`}>
            Clear
          </Link>
        )}
      </form>

      {all.length === 0 ? (
        <EmptyState icon="🌿" title="No menus pulled yet" description="Search a vendor above and click 'Fetch menu'. The menu is saved here with every detail." />
      ) : rows.length === 0 ? (
        <EmptyState icon="🔎" title="No menus match these filters" description="Clear the filters to see every vendor." />
      ) : (
        <div className={TABLE_SHELL}>
          <table className="w-full min-w-[86rem] text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Vendor</th>
                <th className={TH}>Sources</th>
                <th className={TH}>Freshness</th>
                <th className={`${TH} text-right`}>Items</th>
                <th className={`${TH} text-right`}>Wholesale (low · median · high)</th>
                <th className={`${TH} text-right`}>THC avg · max</th>
                <th className={TH}>Categories</th>
                <th className={TH}>Menu quality</th>
                <th className={`${TH} text-right`}>Our stock</th>
                <th className={TH}>History</th>
                <th className={TH}>Logo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {rows.map((r) => (
                <SearchedTr
                  key={r.key}
                  r={r}
                  now={now}
                  logoUrl={r.vendorId ? cov.logos[r.vendorId] ?? null : null}
                  linkOptions={cov.linkOptions}
                  duplicateNames={cov.duplicateNames}
                />
              ))}
            </tbody>
          </table>
          <VendorPickList options={cov.linkOptions} />
        </div>
      )}
      {rows.length > 0 && rows.length !== all.length && (
        <p className={`mt-2 ${FAINT}`}>Showing {rows.length} of {all.length} vendors.</p>
      )}
    </Section>
  );
}

function SearchedTr({
  r,
  now,
  logoUrl,
  linkOptions,
  duplicateNames,
}: {
  r: SearchedRow;
  now: number;
  logoUrl: string | null;
  linkOptions: VendorPickOption[];
  duplicateNames: Record<string, string>;
}) {
  const lu = r.latestUsable;
  const f = r.facts;
  const headDelta = lu ? r.sources.find((s) => s.latestId === lu.id)?.deltaItems ?? null : null;
  return (
    <tr className={ROW}>
      <td className={TD}>
        {r.vendorId ? (
          <Link href={`/admin/vendors/${r.vendorId}`} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
            {r.name}
          </Link>
        ) : (
          <span className="font-medium text-[var(--admin-text)]">{r.name}</span>
        )}
        <div className={FAINT}>
          {r.vendor?.license_number ? `Lic ${r.vendor.license_number} · ` : ""}
          <span className={r.match === "ambiguous" || r.match === "none" ? "text-[var(--admin-gold)]" : ""}>
            {matchHowLabel(r.match)}
            {r.match === "ambiguous" ? ` (${r.ambiguousCandidates})` : ""}
          </span>
        </div>
        {r.matchDetail && <div className={`${FAINT} max-w-[18rem]`}>why: {r.matchDetail}</div>}
        {r.menuNames.length > 0 && <div className={FAINT}>menu says: {r.menuNames.join(", ")}</div>}
        {r.duplicateIds.length > 0 && (
          <div className="max-w-[18rem] text-xs text-[var(--admin-gold)]">
            {r.duplicateIds.length} duplicate card{r.duplicateIds.length === 1 ? "" : "s"}:{" "}
            {r.duplicateIds.map((d) => duplicateNames[d] ?? "another card").join("; ")} —{" "}
            <Link href="/admin/vendors/merge" className={LINK}>merge them</Link>
          </div>
        )}
        <div className="mt-1">
          <LinkVendorButton targets={r.linkTargets} options={linkOptions} relink={Boolean(r.vendorId)} />
        </div>
      </td>
      <td className={TD}>
        <div className="flex flex-col gap-1">
          {r.sources.map((s) => (
            <Link key={s.source} href={s.latestHref} className="flex items-center gap-1.5 text-xs" title={`Open the newest ${sourceLabel(s.source)} menu`}>
              <Badge tone={sourceTone(s.source)}>{sourceLabel(s.source)}</Badge>
              <span className="text-[var(--admin-text-muted)]">{ageLabel(s.latestAt, now)}</span>
              {s.latestStatus !== "fetched" && s.latestStatus !== "parsed" && <Badge tone={statusTone(s.latestStatus)}>{s.latestStatus}</Badge>}
            </Link>
          ))}
          {r.rememberedPlatform && (
            <span className={FAINT}>search memory: {rememberedLabel(r.rememberedPlatform)}</span>
          )}
        </div>
      </td>
      <td className={TD}>
        {lu ? (
          <>
            <Badge tone={freshnessTone(r.freshness)}>{r.freshness}</Badge>
            <div className={`mt-1 ${FAINT}`}>{ageLabel(lu.fetchedAt, now)}</div>
          </>
        ) : (
          <>
            <Badge tone="danger">no usable menu</Badge>
            <div className={`mt-1 ${FAINT}`}>last try {ageLabel(r.latest.fetchedAt, now)} · {r.latest.status}</div>
          </>
        )}
      </td>
      <td className={`${TD} text-right tabular-nums`}>
        <Link href={(lu ?? r.latest).href} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
          {lu?.itemCount ?? 0}
        </Link>
        {headDelta !== null && headDelta !== 0 && (
          <div className={`text-xs ${headDelta > 0 ? "text-[var(--admin-accent)]" : "text-[var(--admin-gold)]"}`}>
            {headDelta > 0 ? "+" : ""}
            {headDelta} vs last
          </div>
        )}
        {f && f.qtyReported > 0 && <div className={FAINT}>{f.inStockItems} in stock</div>}
      </td>
      <td className={`${TD} text-right tabular-nums text-[var(--admin-text-muted)]`}>
        {f && f.priced > 0 ? (
          <>
            <div>
              {money(f.priceMin)} · <span className="font-medium text-[var(--admin-text)]">{money(f.priceMedian)}</span> · {money(f.priceMax)}
            </div>
            <div className={FAINT}>{f.priced} priced</div>
          </>
        ) : (
          <span className={FAINT}>—</span>
        )}
      </td>
      <td className={`${TD} text-right tabular-nums text-[var(--admin-text-muted)]`}>
        {f?.thcAvg !== null && f?.thcAvg !== undefined ? `${f.thcAvg}% · ${f.thcMax}%` : <span className={FAINT}>—</span>}
      </td>
      <td className={TD}>
        <div className="flex max-w-[12rem] flex-wrap gap-1">
          {f?.topCategories.length ? f.topCategories.map((c) => <Badge key={c}>{c}</Badge>) : <span className={FAINT}>—</span>}
        </div>
      </td>
      <td className={TD}>
        {f ? (
          <div className="space-y-0.5 text-xs text-[var(--admin-text-muted)]">
            <div>📷 {f.photoPct ?? 0}% photos</div>
            <div>🧪 {f.coaPct ?? 0}% COAs</div>
          </div>
        ) : (
          <span className={FAINT}>—</span>
        )}
      </td>
      <td className={`${TD} text-right tabular-nums`}>
        {r.lots ? (
          <>
            <div className="font-medium text-[var(--admin-text)]">{r.lots.lotsInStock} in stock</div>
            <div className={FAINT}>
              {r.lots.lotsTotal} lots · last {r.lots.lastReceived ?? "—"}
            </div>
          </>
        ) : (
          <span className={FAINT}>{r.vendorId ? "never received" : "—"}</span>
        )}
      </td>
      <td className={TD}>
        <details>
          <summary className="cursor-pointer text-xs font-medium text-[var(--admin-accent)]">
            {r.pulls} pull{r.pulls === 1 ? "" : "s"}
            {r.failedPulls ? ` · ${r.failedPulls} empty` : ""}
          </summary>
          <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto pr-1">
            {r.history.map((h) => (
              <li key={`${h.source}:${h.id}`} className="whitespace-nowrap text-xs">
                <Link href={h.href} className={LINK}>{sourceLabel(h.source)}</Link>{" "}
                <span className="text-[var(--admin-text-muted)]">{h.itemCount} items</span>{" "}
                <span className={h.usable ? FAINT : "text-[var(--admin-gold)]"}>{h.status}</span>{" "}
                <span className={FAINT}>{ageLabel(h.fetchedAt, now)}</span>
              </li>
            ))}
          </ul>
        </details>
      </td>
      <td className={TD}>
        {r.vendorId && r.vendor ? (
          <FetchLogoButton vendorId={r.vendorId} vendorName={r.vendor.display_name} logoUrl={logoUrl} />
        ) : (
          <span className={FAINT} title="Link this menu to a vendor first, so the logo has a profile to attach to">
            link a vendor first
          </span>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------
 * Emailed menus (SLICE 83) — kept: sender, subject and parse source
 * ------------------------------------------------------------------ */

async function EmailedMenus({ now }: { now: number }) {
  const emailedRows = sortEmailedRows(await listEmailedMenus({ limit: 50 }));
  return (
    <Section
      title="Emailed vendor menus — inbox"
      description="The raw inbox of menus sent to vendor_menu@. Each email is read (body, attachments and PDFs) and also rolled up by vendor in Menus on file above. Spam never appears here."
    >
      {emailedRows.length === 0 ? (
        <EmptyState
          icon="📬"
          title="No emailed menus yet"
          description="Point vendors at your vendor_menu@ address. When a menu lands there it is read and appears here automatically."
        />
      ) : (
        <div className={TABLE_SHELL}>
          <table className="w-full text-sm">
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Sender</th>
                <th className={TH}>Subject</th>
                <th className={TH}>Parsed from</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-center`}>Items</th>
                <th className={TH}>Received</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {emailedRows.map((r) => (
                <tr key={r.id} className={ROW}>
                  <td className={TD}>
                    <Link href={r.href} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
                      {r.senderLabel}
                    </Link>
                    {r.senderSub && <span className={`ml-2 align-middle ${FAINT}`}>{r.senderSub}</span>}
                  </td>
                  <td className={`${TD} max-w-[16rem] truncate text-[var(--admin-text-muted)]`} title={r.subject}>
                    {r.subject}
                  </td>
                  <td className={TD}>
                    <Badge tone="neutral">{r.sourceLabel}</Badge>
                  </td>
                  <td className={TD}>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className={`${TD} text-center text-[var(--admin-text-muted)]`}>{r.itemCount}</td>
                  <td className={`${TD} ${FAINT}`}>{ageLabel(r.receivedAt, now) || new Date(r.receivedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
