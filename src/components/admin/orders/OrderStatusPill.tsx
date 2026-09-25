/**
 * src/components/admin/orders/OrderStatusPill.tsx
 *
 * SLICE L-40 — ONE STATUS PILL FOR BOTH ORDER PANELS.
 *
 * The coloured "NEW / PREPARING / READY …" pill used to be a style table
 * inside `app/admin/orders/page.tsx`, so only our own rows could use it and
 * the Leafly rows wore a different badge in different words. The owner asked
 * for the two panels to "look identical", and the only way two lists stay
 * identical for longer than a release is for them to share the component —
 * so the table lives here and both panels render through it.
 */
import type { OrderStatus } from "@/lib/orders/types";
import { ORDER_STATUS_LABELS } from "@/lib/orders/types";

export const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  new: "border-[var(--admin-orange)]/50 bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]",
  acknowledged:
    "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  preparing:
    "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  ready:
    "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]",
  completed: "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]",
  cancelled:
    "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  no_show:
    "border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
};

/**
 * The pill. `label`/`title` override the words for the one special case we
 * have (an order collected at the register reads "Picked up (register)" in
 * the Completed colour) without a second copy of the markup.
 */
export function OrderStatusPill({
  status,
  styleAs,
  label,
  title,
}: {
  status: OrderStatus;
  /** Colour as a different status (e.g. picked up at the register → completed). */
  styleAs?: OrderStatus;
  label?: string;
  title?: string;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] ${
        ORDER_STATUS_STYLES[styleAs ?? status]
      }`}
      title={title}
    >
      {label ?? ORDER_STATUS_LABELS[status]}
    </span>
  );
}
