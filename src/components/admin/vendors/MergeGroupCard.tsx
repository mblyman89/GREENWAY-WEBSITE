"use client";

/**
 * src/components/admin/vendors/MergeGroupCard.tsx — Task F (combine duplicate
 * vendors).
 *
 * One duplicate group as an interactive review card: the owner picks which
 * card to KEEP (radio), which cards to merge in (checkboxes), sees a live
 * plain-language preview of exactly what the merge will do (which empty
 * fields get filled, every license preserved, which cards get archived), and
 * must tick a confirmation before the Merge button enables.
 *
 * The preview is computed with the same pure rules the database function uses
 * (buildMergePlan in merge-core.ts), so what the owner reads is what happens.
 * Nothing merges automatically — a human confirms every group.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/admin/ui/Button";
import {
  buildMergePlan,
  validateMergeSelection,
  type MergeCandidate,
} from "@/lib/vendors/merge-core";

/** Serializable subset of a vendor the card needs (computed server-side). */
export type MergeCardVendor = MergeCandidate;

export function MergeGroupCard({
  vendors,
  suggestedSurvivorId,
  reasonLabel,
  mergeAction,
}: {
  /** The group's cards, suggested survivor first. */
  vendors: MergeCardVendor[];
  suggestedSurvivorId: string;
  /** Plain-language reason, e.g. "Same business name". */
  reasonLabel: string;
  mergeAction: (formData: FormData) => void | Promise<void>;
}) {
  const [survivorId, setSurvivorId] = useState(suggestedSurvivorId);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(vendors.filter((v) => v.id !== suggestedSurvivorId).map((v) => v.id)),
  );
  const [confirmed, setConfirmed] = useState(false);

  const survivor = vendors.find((v) => v.id === survivorId) ?? vendors[0];
  const duplicates = vendors.filter((v) => v.id !== survivorId && selected.has(v.id));

  const plan = useMemo(() => buildMergePlan(survivor, duplicates), [survivor, duplicates]);
  const problem = validateMergeSelection(survivorId, duplicates.map((d) => d.id));

  function pickSurvivor(id: string) {
    setSurvivorId(id);
    // The new survivor can't also be merged in; everything else stays as-is.
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setConfirmed(false);
  }

  function toggleDuplicate(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirmed(false);
  }

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
        {reasonLabel} · {vendors.length} cards
      </p>

      {/* The cards: pick one to KEEP, tick the ones to merge in. */}
      <div className="space-y-2">
        {vendors.map((v) => {
          const isSurvivor = v.id === survivorId;
          const isSelected = selected.has(v.id);
          return (
            <div
              key={v.id}
              className={`flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border p-3 ${
                isSurvivor
                  ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/5"
                  : isSelected
                    ? "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)]"
                    : "border-white/10"
              }`}
            >
              <label className="flex items-center gap-1.5 text-xs text-white/70">
                <input
                  type="radio"
                  checked={isSurvivor}
                  onChange={() => pickSurvivor(v.id)}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Keep
              </label>
              <label className={`flex items-center gap-1.5 text-xs ${isSurvivor ? "text-white/25" : "text-white/70"}`}>
                <input
                  type="checkbox"
                  checked={!isSurvivor && isSelected}
                  disabled={isSurvivor}
                  onChange={() => toggleDuplicate(v.id)}
                  className="h-4 w-4 accent-[var(--admin-gold)]"
                />
                Merge in
              </label>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/vendors/${v.id}`}
                  target="_blank"
                  className="truncate text-sm font-semibold text-white underline-offset-2 hover:text-[var(--admin-accent)] hover:underline"
                >
                  {v.display_name}
                </Link>
                <p className="truncate text-xs text-white/40">
                  {v.license_number ? `Lic ${v.license_number}` : "No license #"}
                  {" · "}
                  {v.brand_count ?? 0} brand{(v.brand_count ?? 0) === 1 ? "" : "s"} · {v.product_count ?? 0} products
                  {" · "}
                  {v.status}
                </p>
              </div>
              {isSurvivor && (
                <span className="rounded bg-[var(--admin-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-accent)]">
                  Survives
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Live preview — exactly what the merge will do, in plain language. */}
      {!problem && (
        <div className="mt-3 rounded-[var(--admin-radius)] border border-white/10 bg-black/30 p-3 text-xs text-white/70">
          <p className="mb-1 font-semibold text-white">What this merge will do</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>
              Everything from {plan.archived.map((n) => `“${n}”`).join(" and ")} — brands, products,
              purchase orders, manifests, payment history, and pending drafts — moves onto{" "}
              <span className="font-semibold text-white">“{survivor.display_name}”</span>.
            </li>
            {plan.licenses.length > 0 && (
              <li>
                Every license number is kept: {plan.licenses.join(", ")}.
              </li>
            )}
            {plan.fills.length > 0 ? (
              <li>
                Empty fields on the kept card get filled in:{" "}
                {plan.fills.map((f) => `${f.field} (from “${f.fromDisplayName}”)`).join(", ")}. Nothing
                already on the kept card is overwritten.
              </li>
            ) : (
              <li>No fields on the kept card change — it already has everything filled in.</li>
            )}
            <li>The merged card{plan.archived.length === 1 ? " is" : "s are"} archived, not deleted, so history stays intact.</li>
          </ul>
        </div>
      )}

      {/* Confirm + submit */}
      <form action={mergeAction} className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="survivor_id" value={survivorId} />
        {duplicates.map((d) => (
          <input key={d.id} type="hidden" name="duplicate_ids" value={d.id} />
        ))}
        <label className="flex items-center gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="h-4 w-4 accent-[var(--admin-orange)]"
          />
          I checked — these cards are the same business.
        </label>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={Boolean(problem) || !confirmed}
          title={problem ?? (!confirmed ? "Tick the confirmation first" : "Combine these cards into one")}
        >
          🔀 Merge {duplicates.length + 1} cards into one
        </Button>
      </form>
      {problem && <p className="mt-2 text-xs text-[var(--admin-gold)]">{problem}</p>}
    </div>
  );
}
