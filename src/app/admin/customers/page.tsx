import Link from "next/link";
import type { ReactNode } from "react";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Select, Button, Badge } from "@/components/admin/ui";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { listCustomersPaged } from "@/lib/customers/store";
import { listWindow } from "@/lib/admin/list-window-core";
import { CUSTOMER_SORTS } from "@/lib/admin/list-filter-core";
import { ListPager } from "@/components/admin/ux/ListPager";
import { loadSegmentMap } from "@/lib/customers/customer-insights-server";
import { countCustomerTableStats, loadCustomerTableExtras } from "@/lib/customers/customer-table-store";
import { pacificToday } from "@/lib/reports/timezone";
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_COLUMN_GROUP_LABELS,
  CUSTOMER_PAGE_SIZES,
  CUSTOMER_SOURCE_OPTIONS,
  activeFilterCount,
  ageOnDay,
  authorizationLabel,
  birthdaySoon,
  canExportCustomers,
  customerFilterOps,
  customerSourceLabel,
  customerTableHref,
  customerTableQuery,
  formatCalendarDay,
  formatPhone,
  headerSortState,
  parseCustomerTableParams,
  shortNote,
  tableFigures,
  telHref,
  type CustomerColumn,
  type CustomerColumnGroup,
  type CustomerTableState,
} from "@/lib/customers/customer-table-core";
import type { Customer } from "@/lib/customers/types";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
}

const FAINT = "text-[var(--admin-text-faint)]";
const LABEL = "mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]";
const DASH = <span className={FAINT}>{"\u2014"}</span>;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Hidden inputs that carry the parts of the state a form does not edit. */
function HiddenState({ state, omit }: { state: CustomerTableState; omit: readonly string[] }) {
  const params = new URLSearchParams(customerTableQuery(state, { page: 1 }));
  const inputs: ReactNode[] = [];
  for (const [k, v] of params) if (!omit.includes(k)) inputs.push(<input key={k} type="hidden" name={k} value={v} />);
  return <>{inputs}</>;
}

function YesNoFilter({ name, label, value, yes, no }: { name: string; label: string; value: boolean | undefined; yes: string; no: string }) {
  return (
    <div>
      <label className={LABEL} htmlFor={`f-${name}`}>
        {label}
      </label>
      <Select id={`f-${name}`} name={name} defaultValue={value === undefined ? "" : value ? "yes" : "no"}>
        <option value="">Any</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </Select>
    </div>
  );
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission("customers.manage");
  // customers-table-enterprise: the whole page state (search, filters, sort,
  // page size, density, columns) is validated by the pure grammar; garbage
  // params silently mean "off", never an exception.
  const state = parseCustomerTableParams(await searchParams);
  const { q, filters } = state;
  const canExport = canExportCustomers(session.profile.role);

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Customers" subtitle="Customer & patient records." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator finishes the one-time
            setup (and migration 0022 is applied), customers will appear here.
          </div>
        </div>
      </div>
    );
  }

  const today = pacificToday();
  const ops = customerFilterOps(filters);
  const queryFilter = { q, sort: state.sort.columns, bestMatch: state.sort.key === CUSTOMER_SORTS[0].key, ops };
  // GW-033: fetch the requested window plus the exact total; a stale page
  // past the end is clamped and refetched so the screen is never empty.
  const firstWin = listWindow(Number.MAX_SAFE_INTEGER, state.page, state.pageSize);
  const [firstPage, stats, segMap] = await Promise.all([
    listCustomersPaged({ ...queryFilter, from: firstWin.from, to: firstWin.to }),
    countCustomerTableStats(),
    loadSegmentMap(),
  ]);
  let { rows: customers, total } = firstPage;
  let listError = firstPage.error;
  const fuzzy = firstPage.fuzzy === true;
  const win = listWindow(total, state.page, state.pageSize);
  if (win.page !== state.page && total > 0) {
    const again = await listCustomersPaged({ ...queryFilter, from: win.from, to: win.to });
    ({ rows: customers, total } = again);
    listError = again.error;
  }
  const extras = await loadCustomerTableExtras(customers.map((c) => c.id), today);
  // Slice 3 / G-75: visits, spend and last purchase (incl. the old POS) from
  // one shared rule (customer-table-core.tableFigures).
  const computedMode = segMap?.source === "computed";
  const figuresFor = (c: Customer) => {
    const r = segMap?.rollups.get(c.id);
    return tableFigures(c, r ? { visits: r.visits, netSpendMinor: r.netSpendMinor, lastVisitAt: r.lastVisitAt, firstVisitAt: r.firstVisitAt } : undefined, computedMode);
  };

  const filterCount = activeFilterCount(filters);
  const isCustomized = Boolean(q) || filterCount > 0 || state.sort.key !== CUSTOMER_SORTS[0].key;
  const pageHref = (p: number) => customerTableHref(state, { page: p });
  const exportQs = customerTableQuery(state, { page: 1 });
  const compact = state.density === "compact";
  const cellPad = compact ? "px-3 py-1.5" : "px-4 py-3";
  const visible = state.columns;
  const problems = [...stats.problems, ...extras.problems];

  const groups = Object.keys(CUSTOMER_COLUMN_GROUP_LABELS) as CustomerColumnGroup[];

  const header = (col: CustomerColumn) => {
    const align = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";
    const sticky = col.locked ? "sticky left-0 z-20" : "";
    const hs = headerSortState(col, state.sort.key);
    const activeAsc = hs.active ? (CUSTOMER_SORTS.find((o) => o.key === state.sort.key)?.columns[0]?.ascending ?? true) : null;
    const arrow = activeAsc === null ? "" : activeAsc ? " \u2191" : " \u2193";
    return (
      <th
        key={col.key}
        scope="col"
        title={col.hint}
        aria-sort={activeAsc === null ? undefined : activeAsc ? "ascending" : "descending"}
        className={`${cellPad} ${align} ${sticky} whitespace-nowrap bg-[var(--admin-surface-2)]`}
      >
        {hs.nextKey ? (
          <Link
            href={customerTableHref(state, { sort: hs.nextKey, page: 1 })}
            className={`hover:text-[var(--admin-text)] ${hs.active ? "text-[var(--admin-accent)]" : ""}`}
            title={`Sort by ${col.label.toLowerCase()}`}
          >
            {col.label}
            {arrow}
          </Link>
        ) : (
          col.label
        )}
      </th>
    );
  };

  const cell = (col: CustomerColumn, c: Customer, f: ReturnType<typeof figuresFor>): ReactNode => {
    const loyalty = extras.loyalty.get(c.id);
    const auth = extras.authorizations.get(c.id);
    switch (col.key) {
      case "name":
        return (
          <>
            <Link href={`/admin/customers/${c.id}`} className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
              {c.first_name} {c.last_name ?? ""}
            </Link>
            {c.do_not_contact && (
              <span className="ml-2 rounded bg-[var(--admin-orange-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-orange)]">Do not contact</span>
            )}
          </>
        );
      case "customer_id":
        return c.external_id ? <span className="font-mono text-xs">#{c.external_id}</span> : DASH;
      case "birthdate": {
        const label = formatCalendarDay(c.birthdate);
        if (!label) return DASH;
        const age = ageOnDay(c.birthdate, today);
        return (
          <>
            {label}
            <span className={`block text-[10px] ${age !== null && age < 21 ? "font-semibold text-[var(--admin-danger)]" : FAINT}`}>
              {age !== null ? `age ${age}` : ""}
              {age !== null && age < 21 ? " \u00b7 under 21" : ""}
              {birthdaySoon(c.birthdate, today) ? " \u00b7 \ud83c\udf82 birthday this week" : ""}
            </span>
          </>
        );
      }
      case "phone": {
        const shown = formatPhone(c.phone);
        if (!shown) return DASH;
        const dial = telHref(c.phone);
        return dial ? (
          <a href={dial} className="whitespace-nowrap hover:text-[var(--admin-accent)]">
            {shown}
          </a>
        ) : (
          <span className="whitespace-nowrap">{shown}</span>
        );
      }
      case "email":
        return c.email ? (
          <a href={`mailto:${c.email}`} className="break-all hover:text-[var(--admin-accent)]">
            {c.email}
          </a>
        ) : (
          DASH
        );
      case "contact_prefs":
        return (
          <span className="flex flex-wrap gap-1">
            {c.marketing_consent ? <Badge tone="green">Consented</Badge> : <Badge tone="neutral">No consent</Badge>}
            {c.do_not_contact && <Badge tone="orange">Do not contact</Badge>}
          </span>
        );
      case "medical":
        if (!c.is_medical_patient && (!auth || auth.state === "none")) return DASH;
        return (
          <span className="inline-flex flex-col items-center">
            <span title="Medical patient">{c.is_medical_patient ? "\ud83e\ude7a" : ""}</span>
            {auth && auth.state !== "none" && (
              <Badge tone={auth.state === "active" ? "green" : auth.state === "expiring" ? "gold" : "danger"} className="mt-0.5 normal-case">
                {authorizationLabel(auth)}
              </Badge>
            )}
          </span>
        );
      case "tax":
        return c.tax_designations ? <Badge tone="gold">{c.tax_designations}</Badge> : DASH;
      case "loyalty":
        if (!loyalty) return <span className={FAINT}>Not enrolled</span>;
        return (
          <>
            <span className="font-medium text-[var(--admin-text)]">{loyalty.balancePoints.toLocaleString("en-US")} pts</span>
            <span className={`block text-[10px] ${FAINT}`}>
              {loyalty.tierName ?? "No tier"}
              {loyalty.active ? "" : " \u00b7 inactive"}
            </span>
          </>
        );
      case "segment": {
        const seg = segMap?.segments.get(c.id);
        return seg ? <Badge tone={seg.tone}>{seg.label}</Badge> : DASH;
      }
      case "visits":
        return f.visits.toLocaleString("en-US");
      case "total_spent":
        return (
          <span className="font-medium text-[var(--admin-text)]">
            {fmtMoney(f.totalSpendMinor)}
            {f.oldPosSpendMinor > 0 && (
              <span className={`block text-[10px] font-normal ${FAINT}`}>
                {f.liveSpendMinor > 0 ? `${fmtMoney(f.liveSpendMinor)} here + ` : ""}
                {fmtMoney(f.oldPosSpendMinor)} old POS
              </span>
            )}
          </span>
        );
      case "greenway_spent":
        return fmtMoney(f.liveSpendMinor);
      case "old_pos_spent":
        return f.oldPosSpendMinor > 0 ? fmtMoney(f.oldPosSpendMinor) : DASH;
      case "first_visit":
        return fmtDay(f.firstVisitAt);
      case "last_purchase":
        return (
          <>
            {fmtDay(f.lastPurchaseAt)}
            {f.lastPurchaseSource === "old_pos" && <span className={`block text-[10px] ${FAINT}`}>old POS</span>}
          </>
        );
      case "customer_since":
        return (
          <>
            {fmtDay(c.imported_created_at ?? c.created_at)}
            {c.imported_created_at && <span className={`block text-[10px] ${FAINT}`}>old POS</span>}
          </>
        );
      case "source":
        return <span className="whitespace-nowrap">{customerSourceLabel(c.import_source)}</span>;
      case "note": {
        const n = shortNote(c.staff_note);
        return n ? <span title={c.staff_note ?? ""}>{n}</span> : DASH;
      }
      case "created_at":
        return fmtDay(c.created_at);
      case "updated_at":
        return fmtDay(c.updated_at);
      default:
        return DASH;
    }
  };

  return (
    <div>
      <AdminPageHeader
        title="Customers"
        subtitle="Every customer and patient record: contact, age, medical card, loyalty, spend and history in one table you can search, filter, sort and download."
        breadcrumbs={<Breadcrumbs items={[{ label: "Customers" }]} />}
        action={
          <div className="flex flex-wrap gap-2">
            <Button href="/admin/customers/insights" variant="confirm" size="sm">
              {"\ud83d\udcca"} Customer insights
            </Button>
            <Button href="/admin/customers/import" variant="neutral" size="sm">
              {"\u2b06"} Import
            </Button>
            <Button href="/admin/customers/loyalty-import" variant="neutral" size="sm">
              {"\u2b50"} Cultivera loyalty
            </Button>
            <Button href="/admin/customers/new" variant="save" size="sm">
              + New customer
            </Button>
          </div>
        }
        help={
          <HelpPanel
            id="customers"
            title="How the customers table works"
            steps={[
              "Search finds anyone: any part of the first or last name in any order (\u201cbill mcc\u201d), any part of the phone (\u201c3778\u201d), email, or the old Customer ID. A misspelling shows the closest names.",
              "Click a column heading to sort by it; click it again to reverse. The Sort menu has every order, including \u201cLongest since last visit\u201d.",
              "Use the filters for medical patients, consent, do not contact, missing phone or email, tax designation (e.g. Veteran), where the record came from, and birthday month.",
              "\u201cColumns\u201d chooses what the table shows (spent here vs old POS, first visit, staff note, record dates\u2026). Compact fits more rows on screen.",
              "Total spent and Last purchase include the old POS (Cultivera) figures from the import; the small grey line shows the split.",
              "Managers and up can download exactly what is on screen (every column, all pages) as CSV or Excel. Each download is recorded in the audit log.",
            ]}
          >
            <p>
              Customer data is private and staff-only. Birthdate powers the 21+ check (anyone under 21 is marked in red), the medical column shows the
              best recognition card on file and warns 30 days before it expires, and linked customers earn loyalty points when their orders complete.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-5 px-5 py-6 sm:px-8">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total customers" value={stats.total.toLocaleString("en-US")} accent="muted" href="/admin/customers" />
          <StatCard label="Loyalty members" value={stats.loyaltyMembers.toLocaleString("en-US")} accent="gold" />
          <StatCard label="Medical patients" value={stats.medical.toLocaleString("en-US")} accent="green" href="/admin/customers?medical=yes" />
          <StatCard label="Marketing consent" value={stats.consented.toLocaleString("en-US")} accent="gold" href="/admin/customers?consent=yes" />
          <StatCard
            label="With phone / email"
            value={`${stats.withPhone.toLocaleString("en-US")} / ${stats.withEmail.toLocaleString("en-US")}`}
            hint={stats.total > 0 ? `${Math.round((stats.withPhone / stats.total) * 100)}% / ${Math.round((stats.withEmail / stats.total) * 100)}% of customers` : undefined}
            accent="muted"
          />
          <StatCard label="Do not contact" value={stats.doNotContact.toLocaleString("en-US")} accent="muted" href="/admin/customers?dnc=yes" />
        </div>

        {computedMode && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Visits and spend below are calculated straight from orders because database migration 0232 has not been run yet. Sorting by
            visits, spend or recent visit starts working once it runs (see docs/MIGRATIONS_TO_RUN.md).
          </div>
        )}
        {segMap && segMap.partial.length > 0 && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Some records could not be read completely ({segMap.partial.join(", ")}); visits, spend and groups may be slightly low. Refresh to
            try again.
          </div>
        )}
        {problems.length > 0 && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Some details could not be loaded, so a few cells may show blank: {problems.join(" ")}
          </div>
        )}
        {listError && (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-2 text-sm text-[var(--admin-danger)]">
            {listError}
          </div>
        )}

        {/* Search + filters + sort: URL-driven and combinable (GET form). */}
        <form className="space-y-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4" method="get" action="/admin/customers">
          <HiddenState state={state} omit={["q", "sort", "medical", "consent", "dnc", "phone", "email", "tax", "source", "bmonth", "page"]} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label className={LABEL} htmlFor="f-q">
                Search
              </label>
              <Input id="f-q" name="q" defaultValue={q} placeholder={"First or last name (any part), phone, email or Customer ID\u2026"} />
            </div>
            <div>
              <label className={LABEL} htmlFor="f-sort">
                Sort by
              </label>
              <Select id="f-sort" name="sort" defaultValue={state.sort.key}>
                {CUSTOMER_SORTS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="neutral">
              Apply
            </Button>
            {isCustomized && (
              <Link
                href={customerTableHref({ ...state, q: "", filters: {}, sort: CUSTOMER_SORTS[0], page: 1 })}
                className="pb-2 text-xs text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
              >
                Clear search &amp; filters
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <YesNoFilter name="medical" label="Medical" value={filters.isMedical} yes="Medical patients" no="Non-medical" />
            <YesNoFilter name="consent" label="Marketing consent" value={filters.marketingConsent} yes="Consented" no="No consent" />
            <YesNoFilter name="dnc" label="Do not contact" value={filters.doNotContact} yes="Flagged only" no="Not flagged" />
            <YesNoFilter name="phone" label="Phone" value={filters.hasPhone} yes="Has a phone" no="No phone" />
            <YesNoFilter name="email" label="Email" value={filters.hasEmail} yes="Has an email" no="No email" />
            <YesNoFilter name="tax" label="Tax designation" value={filters.hasTaxDesignation} yes="Has one" no="None" />
            <div>
              <label className={LABEL} htmlFor="f-source">
                Source
              </label>
              <Select id="f-source" name="source" defaultValue={filters.source ?? ""}>
                <option value="">Any</option>
                {CUSTOMER_SOURCE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={LABEL} htmlFor="f-bmonth">
                Birthday month
              </label>
              <Select id="f-bmonth" name="bmonth" defaultValue={filters.birthdayMonth ? String(filters.birthdayMonth) : ""}>
                <option value="">Any</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </form>

        {/* Table toolbar: count, columns, density, page size, download. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--admin-text-muted)]">
            {filterCount > 0 && <Badge tone="green">{filterCount} filter{filterCount === 1 ? "" : "s"} on</Badge>}
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-lg border border-[var(--admin-border-strong)] px-2.5 py-1.5 font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]">
                {"\u2630"} Columns ({visible.length}/{CUSTOMER_COLUMNS.length})
              </summary>
              <form method="get" action="/admin/customers" className="absolute left-0 z-30 mt-2 w-[34rem] max-w-[90vw] rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-xl">
                <HiddenState state={state} omit={["col", "page"]} />
                <div className="grid gap-4 sm:grid-cols-2">
                  {groups.map((g) => (
                    <fieldset key={g}>
                      <legend className={LABEL}>{CUSTOMER_COLUMN_GROUP_LABELS[g]}</legend>
                      {CUSTOMER_COLUMNS.filter((c) => c.group === g).map((c) => (
                        <label key={c.key} className="flex items-start gap-2 py-0.5 text-sm text-[var(--admin-text)]" title={c.hint}>
                          <input
                            type="checkbox"
                            name="col"
                            value={c.key}
                            defaultChecked={visible.some((v) => v.key === c.key)}
                            disabled={c.locked}
                            className="mt-1"
                          />
                          <span>
                            {c.label}
                            <span className={`block text-[10px] ${FAINT}`}>{c.hint}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Button type="submit" variant="save" size="sm">
                    Show these columns
                  </Button>
                  <Link href={customerTableHref({ ...state, columns: CUSTOMER_COLUMNS.filter((c) => c.defaultVisible || c.locked) })} className="text-xs underline">
                    Default columns
                  </Link>
                  <Link href={customerTableHref({ ...state, columns: [...CUSTOMER_COLUMNS] })} className="text-xs underline">
                    Show all
                  </Link>
                </div>
              </form>
            </details>
            <span className="ml-1">Rows:</span>
            {CUSTOMER_PAGE_SIZES.map((n) => (
              <Link
                key={n}
                href={customerTableHref(state, { pageSize: n, page: 1 })}
                className={`rounded px-1.5 py-0.5 ${n === state.pageSize ? "bg-[var(--admin-accent-soft)] font-bold text-[var(--admin-accent)]" : "hover:text-[var(--admin-text)]"}`}
              >
                {n}
              </Link>
            ))}
            <span className="ml-1">View:</span>
            <Link
              href={customerTableHref(state, { density: compact ? "comfortable" : "compact" })}
              className="rounded border border-[var(--admin-border-strong)] px-2 py-0.5 hover:text-[var(--admin-text)]"
            >
              {compact ? "Comfortable" : "Compact"}
            </Link>
          </div>
          {canExport && total > 0 ? (
            <ExportButtons baseHref={`/admin/customers/export${exportQs ? `?${exportQs}` : ""}`} />
          ) : null}
        </div>

        {fuzzy && customers.length > 0 && (
          <p className="text-sm text-[var(--admin-text-muted)]">No exact match for {"\u201c"}{q}{"\u201d"}, so these are the closest spellings.</p>
        )}

        <ListPager window={win} total={total} noun="customer" makeHref={pageHref} />

        {stats.total === 0 && !listError && (
          <EmptyState
            icon={"\ud83d\udc64"}
            title="No customers yet"
            description={"Add your first customer with the \u201cNew customer\u201d button, import your old POS list under Customers \u2192 Import, or mark a loyalty signup as entered \u2014 it becomes a customer here automatically."}
          />
        )}

        {customers.length > 0 && (
          <div className="max-h-[75vh] overflow-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
              <thead className="sticky top-0 z-10 text-xs uppercase tracking-wide text-[var(--admin-text-faint)] shadow-[0_1px_0_var(--admin-border)]">
                <tr>{visible.map(header)}</tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {customers.map((c) => {
                  const f = figuresFor(c);
                  return (
                    <tr key={c.id} className="group bg-[var(--admin-surface)] align-top transition hover:bg-[var(--admin-surface-hover)]">
                      {visible.map((col) => (
                        <td
                          key={col.key}
                          className={`${cellPad} ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""} ${
                            col.locked
                              ? "sticky left-0 z-[5] min-w-44 bg-[var(--admin-surface)] group-hover:bg-[var(--admin-surface-hover)]"
                              : "text-[var(--admin-text-muted)]"
                          } ${col.key === "email" ? "min-w-48" : ""} ${col.key === "note" ? "min-w-48 max-w-72" : ""}`}
                        >
                          {cell(col, c, f)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {win.totalPages > 1 && <ListPager window={win} total={total} noun="customer" makeHref={pageHref} />}
        {customers.length === 0 && stats.total > 0 && !listError && (
          <p className="text-sm text-[var(--admin-text-muted)]">
            No customers match your search or filters.{" "}
            <Link href="/admin/customers" className="underline">
              Show everyone
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
