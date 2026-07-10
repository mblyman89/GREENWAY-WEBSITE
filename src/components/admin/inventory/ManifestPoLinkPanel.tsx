/**
 * src/components/admin/inventory/ManifestPoLinkPanel.tsx
 *
 * W5 — the suggest-and-confirm "Which order is this delivery for?" panel on
 * the manifest review page. Pure presentation server component: state comes
 * from po-link-store (no-op-safe pre-migration 0102 — when the column doesn't
 * exist yet the parent simply doesn't render this panel), ranking comes from
 * po-match-core (tested). The human always presses the button; nothing links
 * automatically.
 */

import Link from "next/link";
import { Button } from "@/components/admin/ui";
import type { ManifestPoLinkState } from "@/lib/inventory/po-link-store";
import { formatMoneyMinor } from "@/lib/purchasing/po-store";

export function ManifestPoLinkPanel({
  state,
  linkAction,
}: {
  state: Extract<ManifestPoLinkState, { available: true }>;
  linkAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--admin-text)]">
        Which order is this delivery for?
      </h2>

      {state.linkedPoId ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="rounded bg-[var(--admin-accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--admin-accent)]">
            ✓ Linked to{" "}
            {state.linkedPo ? (
              <Link href={`/admin/purchasing/${state.linkedPo.id}`} className="underline">
                {state.linkedPo.po_number ?? "purchase order"}
              </Link>
            ) : (
              "a purchase order that no longer exists"
            )}
            {state.linkedPo?.vendor_name ? ` · ${state.linkedPo.vendor_name}` : ""}
          </span>
          <form action={linkAction}>
            {/* empty po_id = unlink */}
            <Button type="submit" variant="neutral" size="sm">
              Unlink
            </Button>
          </form>
        </div>
      ) : state.suggestions.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[var(--admin-text-muted)]">
            Vendors rarely put our PO number on the manifest, so nothing links automatically —
            confirm the right order below and the paper trail connects itself.
          </p>
          {state.suggestions.map((s) => (
            <div
              key={s.po.id}
              className="flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/purchasing/${s.po.id}`}
                  className="text-sm font-semibold text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                >
                  {s.po.po_number ?? "PO"} · {s.po.vendor_name ?? "vendor not set"}
                </Link>
                <div className="text-xs text-[var(--admin-text-muted)]">
                  {s.po.line_count} line{s.po.line_count === 1 ? "" : "s"} ·{" "}
                  {formatMoneyMinor(s.po.subtotal_minor_units)} ·{" "}
                  {s.po.expected_date ? `expected ${s.po.expected_date}` : "no expected date"}
                </div>
                <div
                  className={`mt-0.5 text-xs ${
                    s.vendorMatch === "none"
                      ? "text-[var(--admin-orange)]"
                      : "text-[var(--admin-accent)]"
                  }`}
                >
                  {s.reason}
                </div>
              </div>
              <form action={linkAction}>
                <input type="hidden" name="po_id" value={s.po.id} />
                <Button type="submit" variant="confirm" size="sm">
                  Link this PO
                </Button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--admin-text-muted)]">
          No open purchase orders to match against (only POs that were sent to a vendor can be
          fulfilled by a delivery). If this delivery has no PO — a sample drop or walk-in deal —
          that&apos;s fine: the link is optional.
        </p>
      )}
    </div>
  );
}
