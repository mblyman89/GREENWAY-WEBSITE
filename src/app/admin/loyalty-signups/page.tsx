import Link from "next/link";
import { requirePermission, getStaffSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ExportButtons } from "@/components/admin/reports/ExportButtons";
import { StatCard } from "@/components/admin/StatCard";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { readLoyaltySignups } from "@/lib/loyalty/store";
import {
  listLoyaltySignups,
  getLoyaltyStatusCounts,
  getLoyaltySignup,
  LOYALTY_STATUS_LABELS,
  type LoyaltyStatus,
} from "@/lib/loyalty/signups-store";
import { getLinkedCustomersForSignups } from "@/lib/loyalty/signup-customer-store";
import {
  setLoyaltyStatusAction,
  updateLoyaltyNoteAction,
  importLegacyLoyaltyAction,
  connectSignupCustomerAction,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<LoyaltyStatus, string> = {
  new: "border-[#ffd700]/40 bg-[#ffd700]/10 text-[#ffd700]",
  entered: "border-[#7ed957]/50 bg-[#7ed957]/15 text-[#7ed957]",
  duplicate: "border-[#ff7f00]/40 bg-[#ff7f00]/10 text-[#ff7f00]",
  archived: "border-white/15 bg-white/5 text-white/40",
};

const FILTERS: { key: string; label: string }[] = [
  { key: "new", label: "New" },
  { key: "entered", label: "Entered" },
  { key: "duplicate", label: "Duplicates" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(value),
    );
  } catch {
    return value;
  }
}

export default async function LoyaltySignupReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    imported?: string;
    found?: string;
    connected?: string;
    cid?: string;
    cname?: string;
    basis?: string;
    enrolled?: string;
    connect_error?: string;
  }>;
}) {
  await requirePermission("loyalty.view");
  const session = await getStaffSession();
  const canManage = can(session?.profile.role, "loyalty.manage");
  const sp = await searchParams;
  const status = (sp.status as LoyaltyStatus | "all" | undefined) ?? "new";
  const search = sp.q ?? "";
  const importedCount = sp.imported != null ? Number(sp.imported) : null;
  const foundCount = sp.found != null ? Number(sp.found) : null;
  const connected = sp.connected ?? null;
  const connectedCustomerId = sp.cid ?? null;
  const connectedCustomerName = sp.cname ?? null;
  const connectedBasis = sp.basis ?? null;
  const connectedEnrolled = sp.enrolled === "1";
  const connectError = sp.connect_error ?? null;

  // ----- Fallback path: Supabase not configured -> read the legacy JSONL -----
  if (!isSupabaseServiceConfigured) {
    const legacy = await readLoyaltySignups();
    return (
      <div>
        <AdminPageHeader
          title="Loyalty Signups"
          subtitle="Review new loyalty signups before they become customer records."
          action={
            <span className="rounded-full bg-[#ffd700]/15 px-4 py-2 text-sm font-semibold text-[#ffd700]">
              {legacy.length} total
            </span>
          }
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="mb-4 rounded-[var(--admin-radius-sm)] border border-[var(--admin-orange)]/30 bg-[var(--admin-orange-soft)] p-3 text-xs text-[var(--admin-text-muted)]">
            The database isn’t fully set up yet, so this is showing locally-stored signups. Once your
            administrator finishes the one-time setup, the full signup queue (dedupe, mark-as-entered,
            notes, and CSV export) turns on automatically.
          </div>
          {legacy.length === 0 ? (
            <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-8 text-sm text-[var(--admin-text-faint)]">
              No loyalty signups stored in this environment yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] divide-y divide-white/10">
              {legacy.map((s) => (
                <article key={s.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[1.1fr_1.2fr_0.8fr]">
                  <div>
                    <p className="font-semibold text-white">{s.firstName} {s.lastName}</p>
                    <p className="mt-0.5 text-xs text-white/40">{formatDate(s.submittedAt)}</p>
                  </div>
                  <div className="text-sm text-white/70">
                    <p><span className="text-white/40">Email:</span> {s.email}</p>
                    <p><span className="text-white/40">Phone:</span> {s.mobilePhone}</p>
                    <p><span className="text-white/40">Birthday:</span> {s.birthday}</p>
                  </div>
                  <div className="text-sm text-white/70">
                    <span className="text-white/40">Notify:</span> {s.notificationStatus}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----- Database-backed queue -----------------------------------------------
  const [rows, counts] = await Promise.all([
    listLoyaltySignups({ status, search }),
    getLoyaltyStatusCounts(),
  ]);

  // Which of the visible signups already have a linked customer record?
  const linkedCustomers = await getLinkedCustomersForSignups(rows.map((r) => r.id));

  // Resolve the "original" signup each duplicate points at, so staff can see
  // exactly who it collides with (name + when) rather than a bare flag.
  const dedupeOriginals = new Map<string, { name: string; submitted_at: string } | null>();
  await Promise.all(
    rows
      .filter((r) => r.dedupe_of)
      .map(async (r) => {
        const orig = await getLoyaltySignup(r.dedupe_of as string);
        dedupeOriginals.set(
          r.id,
          orig ? { name: `${orig.first_name} ${orig.last_name}`.trim(), submitted_at: orig.submitted_at } : null,
        );
      }),
  );

  const totalSignups = counts.new + counts.entered + counts.duplicate + counts.archived;
  const exportQs = new URLSearchParams({ status, ...(search ? { q: search } : {}) }).toString();

  return (
    <div>
      <AdminPageHeader
        title="Loyalty Signups"
        subtitle="Review each signup — marking it entered creates the customer record automatically."
        breadcrumbs={<Breadcrumbs items={[{ label: "Loyalty" }]} />}
        help={
          <HelpPanel
            id="loyalty"
            title="How loyalty signups work"
            steps={[
              "Customers who sign up on your site appear in this queue.",
              "Review the details, then click Mark entered to validate the signup.",
              "The customer record is created (or linked to an existing match) automatically in CRM → Customers, and they're enrolled in the loyalty program.",
              "Export the list as a CSV or Excel file any time.",
            ]}
          >
            <p>
              We flag likely duplicates so you don&apos;t create the same person twice — a
              duplicate signup links to the existing customer instead of adding a new one. Add a
              note on any signup that needs follow-up.
            </p>
          </HelpPanel>
        }
        action={
          <div className="flex items-center gap-2">
            <ExportButtons baseHref={`/admin/loyalty-signups/export?${exportQs}`} />
            {canManage ? (
              <form action={importLegacyLoyaltyAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-[#ffd700]/40 bg-[#ffd700]/10 px-3.5 py-2 text-xs font-bold text-[#ffd700] hover:bg-[#ffd700]/20"
                  title="Import any remaining rows from storage/loyalty-signups.jsonl"
                >
                  Import legacy file
                </button>
              </form>
            ) : null}
          </div>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        {importedCount != null && (
          <div
            className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
              foundCount === 0
                ? "border-white/15 bg-white/5 text-white/70"
                : "border-[#7ed957]/40 bg-[#7ed957]/10 text-[#7ed957]"
            }`}
          >
            {foundCount === 0
              ? "Legacy import: the legacy file (storage/loyalty-signups.jsonl) was empty — nothing to import. New signups go straight to this queue."
              : `Legacy import complete: imported ${importedCount} of ${foundCount} legacy signup${
                  foundCount === 1 ? "" : "s"
                } (duplicates skipped automatically).`}
          </div>
        )}
        {connected && connectedCustomerId && (
          <div className="mb-4 rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-3 text-sm text-[#7ed957]">
            {connected === "created"
              ? `Customer record created for ${connectedCustomerName ?? "this signup"}`
              : connected === "linked"
                ? `Linked to existing customer ${connectedCustomerName ?? ""}${connectedBasis ? ` (${connectedBasis})` : ""}`
                : `Already connected to customer ${connectedCustomerName ?? ""}`}
            {connectedEnrolled ? " · enrolled in loyalty" : ""}
            {" — "}
            <Link href={`/admin/customers/${connectedCustomerId}`} className="font-bold underline underline-offset-2">
              open customer profile
            </Link>
          </div>
        )}
        {connectError && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            The signup was marked entered, but the customer record could not be created:{" "}
            {connectError}. Use <strong>Add to customers</strong> on the signup to retry.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="New" value={counts.new} accent="gold" hint="Awaiting review" />
          <StatCard label="Entered" value={counts.entered} accent="green" hint="Connected to Customers" />
          <StatCard label="Duplicates" value={counts.duplicate} accent="orange" />
          <StatCard label="Archived" value={counts.archived} />
        </div>

        <form method="get" className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/admin/loyalty-signups?status=${f.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                  status === f.key
                    ? "border-[#7ed957]/60 bg-[#7ed957]/15 text-[#7ed957]"
                    : "border-white/15 bg-white/5 text-white/60 hover:text-white"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <input
              name="q"
              defaultValue={search}
              placeholder="Search name, email, phone"
              className="w-56 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#7ed957]/50 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              Search
            </button>
          </div>
        </form>

        {rows.length === 0 ? (
          totalSignups === 0 ? (
            <div className="mt-8">
              <EmptyState
                icon="🎉"
                title="No loyalty signups yet — that's normal!"
                description="When a customer fills out the loyalty form on your website, their signup lands right here. You'll review each one, add them to your POS, and mark them as entered. We'll automatically flag likely duplicates so you never add the same person twice."
                action={
                  <Link
                    href="/loyalty"
                    className="rounded-lg bg-[#7ed957] px-4 py-2 text-sm font-bold text-black transition hover:brightness-110"
                  >
                    See the signup form
                  </Link>
                }
              />
              <p className="mt-4 text-center text-xs text-white/40">
                Have an older list of signups from before this system? Use{" "}
                <strong className="text-white/60">Import legacy file</strong> above to bring them in.
              </p>
            </div>
          ) : (
            <p className="mt-8 text-sm text-white/40">
              No signups match this view. Try the <strong className="text-white/60">All</strong> filter or clear your search.
            </p>
          )
        ) : (
          <div className="mt-5 grid gap-3">
            {rows.map((s) => (
              <div key={s.id} className="rounded-[var(--admin-radius-xl)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-black text-white">
                        {s.first_name} {s.last_name}
                      </p>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.1em] ${STATUS_STYLES[s.status]}`}
                      >
                        {LOYALTY_STATUS_LABELS[s.status]}
                      </span>
                      {linkedCustomers.has(s.id) ? (
                        <Link
                          href={`/admin/customers/${linkedCustomers.get(s.id)!.customerId}`}
                          className="rounded-full border border-[#7ed957]/40 bg-[#7ed957]/10 px-2.5 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.1em] text-[#7ed957] transition hover:bg-[#7ed957]/20"
                          title={`Open ${linkedCustomers.get(s.id)!.name}'s customer profile`}
                        >
                          ↗ Customer: {linkedCustomers.get(s.id)!.name}
                        </Link>
                      ) : null}
                      {s.dedupe_of ? (
                        <span
                          className="rounded-full border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-2.5 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.1em] text-[#ff7f00]"
                          title={
                            dedupeOriginals.get(s.id)
                              ? `Matches ${dedupeOriginals.get(s.id)!.name}, submitted ${formatDate(dedupeOriginals.get(s.id)!.submitted_at)}`
                              : "Matches an earlier signup"
                          }
                        >
                          ⚠ Possible duplicate
                        </span>
                      ) : null}
                    </div>
                    {s.dedupe_of && dedupeOriginals.get(s.id) ? (
                      <p className="mt-1 text-[0.7rem] text-[#ff7f00]/80">
                        Same phone/email as <strong>{dedupeOriginals.get(s.id)!.name}</strong>{" "}
                        (submitted {formatDate(dedupeOriginals.get(s.id)!.submitted_at)}). Verify before entering to
                        avoid a double POS entry.
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-white/70">
                      {s.email ?? "—"}
                      {s.mobile_phone ? ` · ${s.mobile_phone}` : ""}
                      {s.birthday ? ` · b. ${s.birthday}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-white/40">
                      Submitted {formatDate(s.submitted_at)}
                      {s.entered_at ? ` · entered ${formatDate(s.entered_at)}` : ""}
                      {` · notify: ${s.notification_status}`}
                    </p>
                    {s.staff_note ? (
                      <p className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-white/60">
                        {s.staff_note}
                      </p>
                    ) : null}
                  </div>

                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {s.status !== "entered" ? (
                        <StatusButton id={s.id} status="entered" label="Mark entered" primary />
                      ) : null}
                      {s.status === "entered" && !linkedCustomers.has(s.id) ? (
                        <form action={connectSignupCustomerAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <button
                            type="submit"
                            className="rounded-lg border border-[#7ed957]/50 bg-[#7ed957]/10 px-3.5 py-2 text-xs font-black uppercase tracking-[0.08em] text-[#7ed957] transition hover:bg-[#7ed957]/20"
                            title="Create (or link to) the customer record for this signup"
                          >
                            Add to customers
                          </button>
                        </form>
                      ) : null}
                      {s.status !== "duplicate" ? (
                        <StatusButton id={s.id} status="duplicate" label="Duplicate" />
                      ) : null}
                      {s.status !== "archived" ? (
                        <StatusButton id={s.id} status="archived" label="Archive" />
                      ) : null}
                      {s.status !== "new" ? (
                        <StatusButton id={s.id} status="new" label="Reopen" />
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {canManage ? (
                  <form action={updateLoyaltyNoteAction} className="mt-3 flex items-center gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      name="note"
                      defaultValue={s.staff_note ?? ""}
                      placeholder="Internal note…"
                      className="flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-[#7ed957]/50 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/10"
                    >
                      Save note
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusButton({
  id,
  status,
  label,
  primary = false,
  view,
  viewQ,
}: {
  id: string;
  status: LoyaltyStatus;
  label: string;
  primary?: boolean;
  /** Current queue filter/search, preserved across the redirect after connect. */
  view?: string;
  viewQ?: string;
}) {
  return (
    <form action={setLoyaltyStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      {view ? <input type="hidden" name="view" value={view} /> : null}
      {viewQ ? <input type="hidden" name="view_q" value={viewQ} /> : null}
      <button
        type="submit"
        className={
          primary
            ? "rounded-lg bg-[#7ed957] px-3.5 py-2 text-xs font-black uppercase tracking-[0.08em] text-black transition hover:brightness-110"
            : "rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
        }
      >
        {label}
      </button>
    </form>
  );
}
