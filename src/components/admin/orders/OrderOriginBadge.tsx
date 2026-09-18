/**
 * src/components/admin/orders/OrderOriginBadge.tsx
 *
 * SLICE L-12 — WHERE DID THIS ORDER COME FROM?
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTION
 * ===========================================================================
 *   "The two types need to be distinguishable from each other."
 *
 * Slices L-2 and L-10 made a Leafly order distinguishable by EAR (its own
 * sound) and on PAPER (its own receipt line, printed by
 * `orderOriginReceiptLine`). This closes the third gap: on SCREEN.
 *
 * Before this component, `orderOriginLabel()` existed and was called by
 * nothing — measured, not assumed: a repo-wide search for it found only its
 * own self-tests. So the main orders list, which is the screen the shop
 * watches all day, rendered a Leafly order and a website order identically.
 * The only way to tell them apart was to open each one.
 *
 * That matters more than it sounds. A Leafly order has a customer who was
 * told about their order by Leafly, not by us; it has a status that must be
 * pushed back to Leafly when it changes; and it can be cancelled upstream by
 * someone who is not in the building. Treating it as an ordinary website
 * order is how a staff member calls a customer who was never expecting a call
 * from us, or bags an order that Leafly cancelled ten minutes ago.
 *
 * ===========================================================================
 * WHY A COMPONENT AND NOT AN INLINE SPAN
 * ===========================================================================
 * House rule 11: never re-implement a rule that has a shared core. The rule
 * here — "which word, and which colour, for which origin" — must be identical
 * on the orders list, the order detail page and the register. Three inline
 * spans would be three chances for Leafly to be green on one screen and grey
 * on another, and a colour that means different things on different screens
 * is worse than no colour.
 *
 * It decides nothing itself. The WORD comes from `orderOriginLabel` and the
 * normalisation from `toOrderOrigin`, both in the pure core and both asserted
 * in CI. This file chooses only the styling.
 */

import { orderOriginLabel, toOrderOrigin } from "@/lib/orders/order-origin-core";

/**
 * Origin → the back office's own token families.
 *
 * Leafly is the one that draws the eye, deliberately. A website order is the
 * normal case and is styled as the normal case; a Leafly order is the
 * exception that carries extra obligations, so it gets the accent. Register
 * sales are muted because they are already finished by the time anybody reads
 * a badge about them.
 *
 * No new colours are introduced. These are the same three token families the
 * rest of the back office uses, so an origin badge reads as part of the
 * building rather than as a bolted-on integration.
 */
const ORIGIN_STYLES: Record<string, string> = {
  greenway:
    "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]",
  leafly:
    "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  register:
    "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-faint)]",
};

export function OrderOriginBadge({
  /**
   * The raw `orders.origin` value. Accepts unknown/null on purpose: rows read
   * before migration 0226 have no such column, and `toOrderOrigin` already
   * resolves anything it does not recognise to the website default. Taking a
   * narrow type here would push that handling out to every call site, which
   * is exactly how one screen ends up rendering a blank badge.
   */
  origin,
  /** Hidden for the ordinary case, so the list stays quiet. See below. */
  hideWebsite = false,
  className = "",
}: {
  origin?: string | null;
  hideWebsite?: boolean;
  className?: string;
}) {
  const resolved = toOrderOrigin(origin);

  // On a screen where nearly every row is a website order, a "Website" badge
  // on all forty rows is pure noise and trains the eye to skip the column —
  // taking the Leafly badge with it. Callers that show a MIXED list pass
  // hideWebsite so only the exceptions are marked. Callers showing ONE order
  // do not, because there the question "where did this come from?" is real
  // and an absent badge would be an unanswered question.
  if (hideWebsite && resolved === "greenway") return null;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.08em] ${ORIGIN_STYLES[resolved]} ${className}`}
      // Spelled out for screen readers and for anyone who does not know what
      // "Leafly" means in this context. The visible text stays one word
      // because it sits in a narrow column on an iPad.
      title={`This order came from: ${orderOriginLabel(resolved)}`}
    >
      {orderOriginLabel(resolved)}
    </span>
  );
}
