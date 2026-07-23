import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Input, Select, Button } from "@/components/admin/ui";
import { listCustomersPaged, countCustomers } from "@/lib/customers/store";
import { listWindow, parsePageParam, DEFAULT_PAGE_SIZE } from "@/lib/admin/list-window-core";
import { CUSTOMER_SORTS, parseYesNo, resolveSort } from "@/lib/admin/list-filter-core";
import { ListPager } from "@/components/admin/ux/ListPager";

export const dynamic = "force-dynamic";

function fmtMoney(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    sort?: string;
    medical?: string;
    consent?: string;
    dnc?: string;
  }>;
}) {
  await requirePermission("customers.manage");
  const sp = await searchParams;
  const { q, page } = sp;
  const rawPage = parsePageParam(page);
  // SLICE 26: every filter knob validated by the pure grammar — garbage
  // params silently mean "filter off", never an exception.
  const sort = resolveSort(sp.sort, CUSTOMER_SORTS);
  const isMedical = parseYesNo(sp.medical);
  const marketingConsent = parseYesNo(sp.consent);
  const doNotContact = parseYesNo(sp.dnc);

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

  // GW-033: fetch the requested page window plus the exact total. If the
  // requested page is past the end (stale link), clamp and refetch the real
  // last page so the screen is never empty while rows exist.
  const queryFilter = { q, sort: sort.columns, isMedical, marketingConsent, doNotContact };
  const firstWin = listWindow(Number.MAX_SAFE_INTEGER, rawPage, DEFAULT_PAGE_SIZE);
  const [firstPage, counts] = await Promise.all([
    listCustomersPaged({ ...queryFilter, from: firstWin.from, to: firstWin.to }),
    countCustomers(),
  ]);
  let { rows: customers, total } = firstPage;
  const win = listWindow(total, rawPage, DEFAULT_PAGE_SIZE);
  if (win.page !== rawPage && total > 0) {
    ({ rows: customers, total } = await listCustomersPaged({
      ...queryFilter,
      from: win.from,
      to: win.to,
    }));
  }
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sort.key !== CUSTOMER_SORTS[0].key) params.set("sort", sort.key);
    if (sp.medical === "yes" || sp.medical === "no") params.set("medical", sp.medical);
    if (sp.consent === "yes" || sp.consent === "no") params.set("consent", sp.consent);
    if (sp.dnc === "yes" || sp.dnc === "no") params.set("dnc", sp.dnc);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/admin/customers${qs ? `?${qs}` : ""}`;
  };
  const hasExtraFilters = Boolean(
    isMedical !== undefined ||
      marketingConsent !== undefined ||
      doNotContact !== undefined ||
      sort.key !== CUSTOMER_SORTS[0].key,
  );

  return (
    <div>
      <AdminPageHeader
        title="Customers"
        subtitle="Build customer & patient profiles — the foundation for loyalty, history, and (later) purchase-limit enforcement at the register."
        breadcrumbs={<Breadcrumbs items={[{ label: "Customers" }]} />}
        action={
          <div className="flex gap-2">
            <Button href="/admin/customers/import" variant="neutral" size="sm">
              ⬆ Import
            </Button>
            <Button href="/admin/customers/new" variant="save" size="sm">
              + New customer
            </Button>
          </div>
        }
        help={
          <HelpPanel
            id="customers"
            title="How customer records work"
            steps={[
              "Loyalty signups you mark as entered become customer records here automatically.",
              "Add walk-ins with “New customer,” or import your old POS list under Customers → Import.",
              "Mark medical patients and capture their authorization on the profile.",
              "Respect marketing consent / do-not-contact flags.",
            ]}
          >
            <p>
              Customer data is private and staff-only. Birthdate powers the 21+ age check on the
              profile, and linked customers accrue loyalty points when their orders complete.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total customers" value={counts.total} accent="muted" />
          <StatCard label="Medical patients" value={counts.medical} accent="green" />
          <StatCard label="Marketing consent" value={counts.consented} accent="gold" />
        </div>

        {/* SLICE 26: full control — search, medical / consent / do-not-contact
            tri-states, and sort, all URL-driven and combinable. */}
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div className="min-w-52 flex-1">
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Search
            </label>
            <Input name="q" defaultValue={q ?? ""} placeholder="Name, email, or phone…" />
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Medical
            </label>
            <Select name="medical" defaultValue={sp.medical === "yes" || sp.medical === "no" ? sp.medical : ""} aria-label="Medical filter">
              <option value="">Any</option>
              <option value="yes">Medical patients</option>
              <option value="no">Non-medical</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Marketing consent
            </label>
            <Select name="consent" defaultValue={sp.consent === "yes" || sp.consent === "no" ? sp.consent : ""} aria-label="Marketing consent filter">
              <option value="">Any</option>
              <option value="yes">Consented</option>
              <option value="no">No consent</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Do not contact
            </label>
            <Select name="dnc" defaultValue={sp.dnc === "yes" || sp.dnc === "no" ? sp.dnc : ""} aria-label="Do-not-contact filter">
              <option value="">Any</option>
              <option value="yes">Flagged only</option>
              <option value="no">Not flagged</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Sort by
            </label>
            <Select name="sort" defaultValue={sort.key} aria-label="Sort customers">
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
          {(q || hasExtraFilters) && (
            <Link
              href="/admin/customers"
              className="pb-2 text-xs text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
            >
              Clear
            </Link>
          )}
        </form>

        {/* GW-033: exact result count + pager (server-side pagination). */}
        <ListPager window={win} total={total} noun="customer" makeHref={pageHref} />

        {counts.total === 0 && (
          <EmptyState
            icon="👤"
            title="No customers yet"
            description="Add your first customer with the “New customer” button, import your old POS list under Customers → Import, or mark a loyalty signup as entered — it becomes a customer here automatically."
          />
        )}

        {customers.length > 0 && (
          <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3 text-center">Medical</th>
                  <th className="px-4 py-3 text-right">Visits</th>
                  <th className="px-4 py-3 text-right">Lifetime spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {customers.map((c) => (
                  <tr key={c.id} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${c.id}`}
                        className="font-medium text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                      >
                        {c.first_name} {c.last_name ?? ""}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                      {c.email || c.phone || "—"}
                      {c.do_not_contact && (
                        <span className="ml-2 rounded bg-[var(--admin-orange-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-orange)]">
                          Do not contact
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">{c.is_medical_patient ? "🩺" : "—"}</td>
                    <td className="px-4 py-3 text-right text-[var(--admin-text-muted)]">{c.visit_count}</td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--admin-text)]">
                      {fmtMoney(c.lifetime_spend_minor_units)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {win.totalPages > 1 && (
          <ListPager window={win} total={total} noun="customer" makeHref={pageHref} />
        )}
        {customers.length === 0 && counts.total > 0 && (
          <p className="text-sm text-white/50">No customers match your search.</p>
        )}
      </div>
    </div>
  );
}
