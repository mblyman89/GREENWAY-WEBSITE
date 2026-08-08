"use client";

/**
 * PR-D3 — Manual description choice, the buyer-facing chooser.
 *
 * This client island lets the buyer decide, per strain, which description gets
 * saved to the Knowledge Base: the product's OWN text or the CATEGORY text. It
 * is designed to be effortless:
 *
 *   • The PR-D2 smart pick is PRE-SELECTED for every strain (green "Recommended"
 *     pill), so a novice can just press Save and get the best result — zero
 *     required clicks.
 *   • Each strain shows both candidates side by side as clickable cards, so
 *     what you SEE is exactly what will be SAVED (live, WYSIWYG).
 *   • The weak candidate is honestly tagged ("just its name", "too short",
 *     "no description"); a missing source is shown disabled with a plain note.
 *   • One button — "Save descriptions & images to the Knowledge Base" — saves
 *     every strain's chosen description plus its image, and reports back in
 *     plain English. Idempotent; re-running only fills gaps.
 *
 * The choices ride to the server as a compact { strainKey: "product"|"category" }
 * map. Strains left on the default are omitted from the map, so the server
 * reproduces PR-D2 behavior for them exactly.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { saveAllAssetsLabel } from "@/lib/purchasing/save-assets-core";
import type {
  StrainDescriptionChoice,
  StrainDescriptionSource,
} from "@/lib/purchasing/strain-description-choice-core";
import { saveCultiveraDetailStrainsToKbAction } from "../../../actions";

type Props = {
  snapshotId: string;
  itemId: string;
  /** Per-strain choices (both candidates + the recommended default). */
  choices: StrainDescriptionChoice[];
  /** Distinct strains with a saveable image — drives the button label/disable. */
  strainCount: number;
  disabled?: boolean;
};

export function StrainDescriptionChooser({
  snapshotId,
  itemId,
  choices,
  strainCount,
  disabled,
}: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  // Start every strain on its recommended source (PR-D2 default).
  const [selected, setSelected] = useState<Record<string, StrainDescriptionSource>>(() => {
    const init: Record<string, StrainDescriptionSource> = {};
    for (const c of choices) init[c.strainKey] = c.recommended;
    return init;
  });

  // How many strains the buyer has moved OFF the recommendation.
  const overrideCount = useMemo(
    () => choices.reduce((n, c) => n + (selected[c.strainKey] !== c.recommended ? 1 : 0), 0),
    [choices, selected],
  );

  function pick(strainKey: string, source: StrainDescriptionSource, available: boolean) {
    if (!available || pending) return;
    setSelected((prev) => ({ ...prev, [strainKey]: source }));
  }

  function resetToRecommended() {
    const init: Record<string, StrainDescriptionSource> = {};
    for (const c of choices) init[c.strainKey] = c.recommended;
    setSelected(init);
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      // Only send strains the buyer moved off the default — keeps the payload
      // tiny and lets the server reproduce PR-D2 for untouched strains.
      const overrides: Record<string, StrainDescriptionSource> = {};
      for (const c of choices) {
        if (selected[c.strainKey] && selected[c.strainKey] !== c.recommended) {
          overrides[c.strainKey] = selected[c.strainKey];
        }
      }
      const fd = new FormData();
      fd.set("snapshot_id", snapshotId);
      fd.set("item_id", itemId);
      if (Object.keys(overrides).length > 0) fd.set("choices", JSON.stringify(overrides));
      const res = await saveCultiveraDetailStrainsToKbAction(fd);
      setFailed(!res.ok);
      setMessage(res.message);
      if (res.ok) router.refresh();
    });
  }

  const label = saveAllAssetsLabel(strainCount);
  const hasChoices = choices.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">Descriptions to save</h3>
          <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
            We&apos;ve pre-picked the best description for each strain. Change any you like — what you
            see here is exactly what gets saved.
          </p>
        </div>
        {overrideCount > 0 && (
          <button
            type="button"
            onClick={resetToRecommended}
            disabled={pending}
            className="shrink-0 rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-2 py-1 text-[0.7rem] font-semibold text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)] disabled:opacity-50"
          >
            Reset to recommended
          </button>
        )}
      </div>

      {!hasChoices ? (
        <p className="text-xs text-[var(--admin-text-faint)]">
          No descriptions to choose yet — fetch this product&apos;s sizes first.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {choices.map((c) => {
            const active = selected[c.strainKey] ?? c.recommended;
            return (
              <li
                key={c.strainKey}
                className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-[var(--admin-text)]" title={c.strainName}>
                    {c.strainName}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <OptionCard
                    heading="Product description"
                    text={c.productOption.text}
                    available={c.productOption.available}
                    note={c.productOption.note}
                    active={active === "product"}
                    recommended={c.recommended === "product"}
                    onSelect={() => pick(c.strainKey, "product", c.productOption.available)}
                    disabled={pending}
                  />
                  <OptionCard
                    heading="Category description"
                    text={c.categoryOption.text}
                    available={c.categoryOption.available}
                    note={c.categoryOption.note}
                    active={active === "category"}
                    recommended={c.recommended === "category"}
                    onSelect={() => pick(c.strainKey, "category", c.categoryOption.available)}
                    disabled={pending}
                  />
                </div>

                {c.reason && (
                  <p className="mt-1.5 text-[0.7rem] leading-snug text-[var(--admin-text-faint)]">
                    💡 {c.reason}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col items-stretch gap-1.5 border-t border-[var(--admin-border)] pt-3">
        <Button
          type="button"
          variant="save"
          size="sm"
          fullWidth
          disabled={pending || disabled}
          onClick={save}
        >
          {pending ? "Saving…" : label}
        </Button>
        {overrideCount > 0 && !pending && (
          <span className="text-center text-[0.7rem] text-[var(--admin-text-muted)]">
            {overrideCount} strain{overrideCount === 1 ? "" : "s"} changed from the recommendation.
          </span>
        )}
        {message && (
          <span
            className={`text-center text-[0.7rem] leading-snug ${
              failed ? "text-[var(--admin-danger)]" : "text-[var(--admin-text-faint)]"
            }`}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

/** One selectable description card. Clicking it (or its radio) picks the source. */
function OptionCard({
  heading,
  text,
  available,
  note,
  active,
  recommended,
  onSelect,
  disabled,
}: {
  heading: string;
  text: string | null;
  available: boolean;
  note: string;
  active: boolean;
  recommended: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const clickable = available && !disabled;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      disabled={!clickable}
      className={[
        "flex h-full flex-col gap-1 rounded-[var(--admin-radius)] border p-2.5 text-left transition-colors",
        active
          ? "border-[var(--admin-accent)] bg-[color-mix(in_srgb,var(--admin-accent)_12%,transparent)]"
          : "border-[var(--admin-border)] bg-[var(--admin-surface)]",
        clickable ? "cursor-pointer hover:border-[var(--admin-accent)]" : "cursor-not-allowed opacity-60",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={[
              "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
              active ? "border-[var(--admin-accent)]" : "border-[var(--admin-text-faint)]",
            ].join(" ")}
          >
            {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--admin-accent)]" />}
          </span>
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            {heading}
          </span>
        </div>
        {recommended && (
          <span className="shrink-0 rounded-full bg-[var(--admin-success,#1f9d55)] px-1.5 py-0.5 text-[0.6rem] font-bold leading-none text-black">
            Recommended
          </span>
        )}
      </div>

      {available ? (
        <p className="text-xs leading-snug text-[var(--admin-text)]">{text}</p>
      ) : (
        <p className="text-xs italic leading-snug text-[var(--admin-text-faint)]">
          {note || "Not available"}
        </p>
      )}

      {available && note && (
        <span className="mt-0.5 inline-flex w-fit items-center rounded bg-[var(--admin-gold,#b8860b)] px-1.5 py-0.5 text-[0.6rem] font-bold leading-none text-black">
          {note}
        </span>
      )}
    </button>
  );
}
