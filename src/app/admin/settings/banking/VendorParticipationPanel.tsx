import { participationSummary, type ParticipationRow } from "@/lib/payments/vendor-esign-core";
import { BULK_SKIP_LABELS, VENDOR_BULK_MAX, planBulkInvites, type BulkSkip } from "@/lib/payments/vendor-esign-app-core";
import { bulkInviteVendorsAction } from "@/app/admin/vendors/vendor-esign-actions";

/**
 * R39 S7 — "How close are we to no checks?" on the Banking > Vendors tab.
 *
 * The owner's goal: every vendor on ACH so no blank signed checks are left
 * at the shop. ACH cannot be required (WAC 314-55-115(3)(a)), so the lever
 * is making it effortless: one button emails every eligible vendor a
 * sign-up link (at most VENDOR_BULK_MAX per press; press again for the
 * next batch). Counts are computed from the same rows the bulk plan uses.
 */
export function VendorParticipationPanel({ ready, rows }: { ready: boolean; rows: (ParticipationRow & { email: string | null; active: boolean })[] }) {
  if (!ready) {
    return (
      <section className="rounded-[var(--admin-radius)] border border-white/10 p-4 text-sm text-white/60">
        Vendor online sign-up needs migration <code className="rounded bg-black/30 px-1">0262_vendor_ach_esign.sql</code>. Apply it in the Supabase SQL editor, then refresh.
      </section>
    );
  }
  const activeRows = rows.filter((r) => r.active);
  const sum = participationSummary(activeRows);
  const plan = planBulkInvites(rows.map((r) => ({ vendorId: r.vendorId, name: r.name, email: r.email, active: r.active, optedOut: r.optedOut, achReady: r.achActive, openInvite: r.invite, openInviteExpired: r.inviteExpired })));
  const eligible = plan.send.length + plan.overflow;
  const pct = Math.max(0, Math.min(100, sum.percentActive));
  const skips = (Object.keys(plan.skipped) as BulkSkip[]).filter((k) => plan.skipped[k] > 0 && k !== "inactive");
  return (
    <section className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.04] p-4" aria-labelledby="vendor-participation">
      <h2 id="vendor-participation" className="mb-1 text-sm font-semibold uppercase tracking-wide text-white/60">Vendors on direct deposit</h2>
      <p className="text-2xl font-bold text-white">
        {sum.active} of {sum.total} <span className="text-base font-semibold text-white/60">({pct}%)</span>
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-[var(--admin-accent)]" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/70 sm:grid-cols-4">
        <li><strong className="text-white">{sum.waitingOnGreenway}</strong> signed, waiting on Greenway (callback, release, countersign)</li>
        <li><strong className="text-white">{sum.linkOut}</strong> link out, waiting on the vendor</li>
        <li><strong className="text-white">{sum.notInvited}</strong> not invited yet</li>
        <li><strong className="text-white">{sum.optedOut}</strong> chose checks</li>
      </ul>
      <form action={bulkInviteVendorsAction} className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-white/80">
          <input type="checkbox" name="confirm" /> Email a sign-up link to {Math.min(eligible, VENDOR_BULK_MAX)} eligible vendor{eligible === 1 ? "" : "s"}
          {plan.overflow ? ` (of ${eligible}; press again for the rest)` : ""}
        </label>
        <button type="submit" disabled={eligible === 0} className="rounded-md border border-[var(--admin-accent)]/50 px-3 py-1.5 text-xs font-semibold text-[var(--admin-accent)] disabled:opacity-40">
          Send links
        </button>
      </form>
      {skips.length ? <p className="mt-2 text-xs text-white/50">Not included: {skips.map((k) => `${plan.skipped[k]} ${BULK_SKIP_LABELS[k]}`).join("; ")}. Add an email on the vendor page to include a vendor.</p> : null}
      <p className="mt-2 text-xs text-white/50">ACH stays optional by law; vendors who keep checks are mailed one, never handed a blank signed check.</p>
    </section>
  );
}
