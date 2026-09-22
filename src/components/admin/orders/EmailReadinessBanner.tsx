/**
 * src/components/admin/orders/EmailReadinessBanner.tsx
 *
 * SLICE L-19 — say it on the screen the owner is already looking at.
 *
 * The owner placed a real order and no confirmation email arrived. Everything
 * downstream of that was working exactly as written: the provider was not
 * configured, so `notify.ts` skipped both emails and returned quietly. The
 * failure was not that an email broke — it was that NOTHING ANYWHERE SAID SO.
 *
 * A timeline note on the order (added in this same slice) tells you once you
 * have opened that order and gone looking. This banner is for the case where
 * you do not yet know to go looking, which is the case the owner was actually
 * in. It sits at the top of the orders dashboard and only appears when
 * something is genuinely wrong.
 *
 * WHY IT CAN BE TRUSTED
 * ─────────────────────
 * It renders nothing at all when email is configured, and nothing at all for a
 * Leafly order (where not emailing the shopper is contractually required). The
 * judgement is not made here — it is made once, in `email-readiness-core.ts`,
 * and this component only renders the answer. A banner that cried wolf on
 * every marketplace order would be worse than no banner, because staff would
 * stop reading it and then miss this one.
 *
 * This is a server component: it reads nothing, holds no state, and takes the
 * already-computed readiness as a prop, so it cannot disagree with the
 * checklist on the setup page.
 */
import type { EmailReadiness } from "@/lib/orders/email-readiness-core";

export function EmailReadinessBanner({ readiness }: { readiness: EmailReadiness }) {
  // Nothing wrong — render nothing. No "all good" chip, no reassurance box.
  // A banner that is always present is furniture, and furniture is invisible.
  if (!readiness.problem) return null;

  // `canSend === false` means no email of any kind is going out: customers get
  // no confirmation AND staff get no alert. That is a red state. A missing
  // staff list while customer email works is a real gap but a lesser one, so
  // it gets the warning colour rather than the danger colour — the difference
  // is deliberate, so that the red one keeps meaning something.
  const severe = !readiness.canSend;

  // NOTE ON COLOUR: there is no `--admin-warning` token in this codebase —
  // gold is the house "attention" colour, as stated verbatim at
  // books/wa-quarterly/page.tsx:133. Using a token that does not exist would
  // resolve to nothing and render an invisible border, which is precisely the
  // bug that made those legacy aliases necessary (globals.css:92-97).
  const tone = severe
    ? "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)]"
    : "border-[var(--admin-gold)]/50 bg-[var(--admin-gold-soft)]";
  const headingTone = severe ? "text-[var(--admin-danger)]" : "text-[var(--admin-gold)]";

  return (
    <div
      className={`mb-4 rounded-[var(--admin-radius-lg)] border p-3 sm:p-4 ${tone}`}
      // Announced to screen readers when it appears, because the whole point
      // of this component is that somebody finds out without being told.
      role="status"
    >
      <p className={`text-sm font-black ${headingTone}`}>
        {severe ? "Order emails are not being sent" : "Staff are not being emailed about new orders"}
      </p>
      <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--admin-text)]">
        {readiness.problem}
      </p>
      {readiness.remedy ? (
        <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--admin-muted)]">
          {readiness.remedy}
        </p>
      ) : null}
      {severe ? (
        <p className="mt-2 text-[0.78rem] font-bold leading-relaxed text-[var(--admin-text)]">
          Orders themselves are unaffected — they are still being taken and still appear on this
          page. Treat this dashboard as the only notification until email is configured.
        </p>
      ) : null}
    </div>
  );
}
