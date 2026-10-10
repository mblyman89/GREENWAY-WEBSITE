import Link from "next/link";
import { Badge } from "@/components/admin/ui";
import { changeVendorAchFlagAction } from "../ach-flag-actions";
import { MIN_OPT_OUT_REASON_CHARS, type VendorAchCard as Card, type VendorAchFlags } from "@/lib/payments/vendor-ach-enrollment-core";
import type { VaultBadge } from "@/lib/payments/banking-vault-ui-core";

/**
 * R39 S4 — vendor ACH card on the vendor detail page (owner/admin only).
 * Shows the ACH status, the "needs bank info" flag and the "opted out"
 * checkbox the owner asked for, plus the vault badge (masked tail only).
 * Bank numbers are never edited here; that happens in the vault.
 */
export function VendorAchCard({
  vendorId,
  card,
  flags,
  vaultBadge,
  hasVaultRecord,
  optedOutByName,
  returnTo = "vendor",
}: {
  vendorId: string;
  card: Card;
  flags: VendorAchFlags;
  vaultBadge: VaultBadge;
  hasVaultRecord: boolean;
  optedOutByName: string | null;
  returnTo?: "vendor" | "vault";
}) {
  const btn = "rounded-md border px-2.5 py-1 text-xs font-semibold";
  const hidden = (
    <>
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="return_to" value={returnTo} />
    </>
  );
  return (
    <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" aria-labelledby={`ach-${vendorId}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={`ach-${vendorId}`} className="text-sm font-semibold text-white">ACH payments</h2>
        <Badge tone={card.tone}>{card.label}</Badge>
      </div>
      <p className="text-xs text-white/70">{card.nextStep}</p>
      {card.warnings.map((w) => (
        <p key={w} role="alert" className="mt-2 rounded-md border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 px-2 py-1 text-xs text-[var(--admin-orange)]">
          {w}
        </p>
      ))}
      {flags.optedOut && (
        <p className="mt-2 text-xs text-white/50">
          Opted out{flags.optedOutAt ? ` ${new Date(flags.optedOutAt).toLocaleDateString("en-US")}` : ""}
          {optedOutByName ? ` by ${optedOutByName}` : ""}.
        </p>
      )}

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white/60">Bank record (vault)</span>
          <Badge tone={vaultBadge.tone}>{vaultBadge.label}</Badge>
        </div>
        <p className="text-xs text-white/50">{vaultBadge.detail}</p>
        <Link
          href={`/admin/settings/banking?tab=vendors${hasVaultRecord ? `&edit=${vendorId}` : ""}`}
          className="mt-1 inline-block text-xs font-semibold text-[var(--admin-accent)] hover:underline"
        >
          {hasVaultRecord ? "Open in the vault →" : "Add banking in the vault →"}
        </Link>
      </div>

      {card.actions.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          {card.actions.includes("flag_needs_info") && (
            <form action={changeVendorAchFlagAction}>
              {hidden}
              <input type="hidden" name="ach_action" value="flag_needs_info" />
              <button type="submit" className={`${btn} border-[var(--admin-orange)]/50 text-[var(--admin-orange)]`}>
                Flag: we need their bank info
              </button>
            </form>
          )}
          {card.actions.includes("clear_needs_info") && (
            <form action={changeVendorAchFlagAction}>
              {hidden}
              <input type="hidden" name="ach_action" value="clear_needs_info" />
              <button type="submit" className={`${btn} border-white/20 text-white/80`}>Clear the &quot;needs bank info&quot; flag</button>
            </form>
          )}
          {card.actions.includes("opt_out") && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-white/70">Vendor opted out of ACH…</summary>
              <form action={changeVendorAchFlagAction} className="mt-2 space-y-2">
                {hidden}
                <input type="hidden" name="ach_action" value="opt_out" />
                <label className="block text-xs text-white/60">
                  Why? (kept on the record)
                  <input
                    name="opt_out_reason"
                    required
                    minLength={MIN_OPT_OUT_REASON_CHARS}
                    maxLength={500}
                    placeholder="e.g. prefers paper checks"
                    className="mt-1 w-full rounded-md border border-white/15 bg-black px-2 py-1 text-xs text-white"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input type="checkbox" required name="confirm" value="yes" />
                  They opted out. Don&apos;t pay them by ACH.
                </label>
                <button type="submit" className={`${btn} border-white/20 text-white/80`}>Save opted out</button>
              </form>
            </details>
          )}
          {card.actions.includes("opt_in") && (
            <form action={changeVendorAchFlagAction}>
              {hidden}
              <input type="hidden" name="ach_action" value="opt_in" />
              <button type="submit" className={`${btn} border-white/20 text-white/80`}>Un-check opted out</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
