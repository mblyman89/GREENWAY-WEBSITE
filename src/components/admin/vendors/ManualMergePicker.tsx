"use client";

/**
 * D247 (owner: "I need a way to manually select two or more vendors to merge into one, with each
 * brand absorbed getting added to the vendors profile"): the hand-picked merge. The owner searches
 * any vendor (page `?q=`), adds 2-5 cards (page `?pick=`), picks the one to KEEP, and can turn the
 * merged-in cards into brands on the kept card. Same live preview + confirm tick as the suggested
 * groups (buildMergePlan), same server action (mergeVendorsAction).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/admin/ui/Button";
import { buildMergePlan, validateMergeSelection, type MergeCandidate } from "@/lib/vendors/merge-core";

function SubmitButton({ disabled, title, count }: { disabled: boolean; title: string; count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" disabled={disabled || pending} title={title}>
      {pending ? "Merging…" : `🔀 Merge ${count} cards into one`}
    </Button>
  );
}

export function ManualMergePicker({
  picked,
  removeHref,
  mergeAction,
}: {
  /** The hand-picked cards (2-5), in pick order. */
  picked: MergeCandidate[];
  /** id -> the page URL without that card. */
  removeHref: Record<string, string>;
  mergeAction: (formData: FormData) => void | Promise<void>;
}) {
  const suggested = useMemo(() => {
    // Most brands / products first: usually the real business card.
    const s = [...picked].sort((a, b) => (b.brand_count ?? 0) - (a.brand_count ?? 0) || (b.product_count ?? 0) - (a.product_count ?? 0));
    return s[0]?.id ?? "";
  }, [picked]);
  const [survivorId, setSurvivorId] = useState(suggested);
  const [absorb, setAbsorb] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  const survivor = picked.find((v) => v.id === survivorId) ?? picked[0];
  const duplicates = picked.filter((v) => v.id !== survivor?.id);
  const plan = useMemo(() => (survivor ? buildMergePlan(survivor, duplicates) : null), [survivor, duplicates]);
  const problem = picked.length < 2 ? "Add at least two cards." : validateMergeSelection(survivor?.id ?? "", duplicates.map((d) => d.id));
  const brandless = duplicates.filter((d) => (d.brand_count ?? 0) === 0);

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4" data-testid="manual-merge-picker">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">Your picks · {picked.length} cards</p>
      <div className="space-y-2">
        {picked.map((v) => {
          const keep = v.id === survivor?.id;
          return (
            <div
              key={v.id}
              className={`flex flex-wrap items-center gap-3 rounded-[var(--admin-radius)] border p-3 ${keep ? "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/5" : "border-white/10"}`}
            >
              <label className="flex items-center gap-1.5 text-xs text-white/70">
                <input
                  type="radio"
                  name="keep-pick"
                  checked={keep}
                  onChange={() => {
                    setSurvivorId(v.id);
                    setConfirmed(false);
                  }}
                  className="h-4 w-4 accent-[var(--admin-accent)]"
                />
                Keep
              </label>
              <div className="min-w-0 flex-1">
                <Link href={`/admin/vendors/${v.id}`} target="_blank" className="truncate text-sm font-semibold text-white underline-offset-2 hover:text-[var(--admin-accent)] hover:underline">
                  {v.display_name}
                </Link>
                <p className="truncate text-xs text-white/40">
                  {v.license_number ? `Lic ${v.license_number}` : "No license #"} · {v.brand_count ?? 0} brand{(v.brand_count ?? 0) === 1 ? "" : "s"} · {v.product_count ?? 0} products · {v.status}
                </p>
              </div>
              {keep ? (
                <span className="rounded bg-[var(--admin-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--admin-accent)]">Survives</span>
              ) : (
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white/50">Merged in</span>
              )}
              <Link href={removeHref[v.id] ?? "#"} className="text-xs text-white/50 underline-offset-2 hover:text-white hover:underline">
                Remove
              </Link>
            </div>
          );
        })}
      </div>

      {!problem && plan && survivor && (
        <div className="mt-3 rounded-[var(--admin-radius)] border border-white/10 bg-black/30 p-3 text-xs text-white/70">
          <p className="mb-1 font-semibold text-white">What this merge will do</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>
              Everything from {plan.archived.map((n) => `“${n}”`).join(" and ")} (brands, products, purchase orders, manifests, payment history, pending drafts) moves onto{" "}
              <span className="font-semibold text-white">“{survivor.display_name}”</span>.
            </li>
            {absorb && brandless.length > 0 && (
              <li>
                Added as brand{brandless.length === 1 ? "" : "s"} on “{survivor.display_name}”: {brandless.map((d) => `“${d.display_name}”`).join(", ")} (their products get that brand where none is set). A brand
                name already owned by another vendor is never taken.
              </li>
            )}
            {plan.licenses.length > 0 && <li>Every license number is kept: {plan.licenses.join(", ")}.</li>}
            {plan.fills.length > 0 ? (
              <li>Empty fields on the kept card get filled in: {plan.fills.map((f) => `${f.field} (from “${f.fromDisplayName}”)`).join(", ")}. Nothing already filled is overwritten.</li>
            ) : (
              <li>No fields on the kept card change.</li>
            )}
            <li>The merged card{plan.archived.length === 1 ? " is" : "s are"} archived, not deleted.</li>
          </ul>
        </div>
      )}

      <form action={mergeAction} className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="survivor_id" value={survivor?.id ?? ""} />
        {duplicates.map((d) => (
          <input key={d.id} type="hidden" name="duplicate_ids" value={d.id} />
        ))}
        {absorb && <input type="hidden" name="absorb_brands" value="1" />}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={absorb} onChange={(e) => setAbsorb(e.target.checked)} className="h-4 w-4 accent-[var(--admin-accent)]" />
            Add each merged-in card as a brand on the kept card
          </label>
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4 accent-[var(--admin-orange)]" />
            I checked: these cards are the same business.
          </label>
        </div>
        <SubmitButton disabled={Boolean(problem) || !confirmed} title={problem ?? (!confirmed ? "Tick the confirmation first" : "Combine these cards into one")} count={picked.length} />
      </form>
      {problem && <p className="mt-2 text-xs text-[var(--admin-text-muted)]">{problem}</p>}
    </div>
  );
}
