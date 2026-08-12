"use client";

/**
 * ClassifyTable (R1-E) \u2014 the "Classify" screen's transaction list.
 *
 * Michael reviews each transaction and picks what it really was (a purchase, an
 * FTSO reward, a gift, a sale, etc.). Getting this right is what makes the whole
 * tax report accurate \u2014 so the screen is built to be fast and safe:
 *
 *   - Every row starts on a CONSERVATIVE default (never invents income): a
 *     received coin defaults to "Bought", a sent coin to "Sold", a swap to
 *     "Trade", a self-transfer to "Wallet transfer". Rows still on their default
 *     are flagged "needs review" so nothing is silently assumed.
 *   - The dropdown only ever offers categories that make sense for that kind of
 *     transaction (the valid options are computed server-side in the pure
 *     view-model \u2014 this file contains ZERO tax logic).
 *   - Picking a category shows its plain-English tax meaning right below, and
 *     submitting saves it via the audited server action (owner/admin only). The
 *     server re-validates the pick before writing, so a bad choice can't slip in.
 *
 * This component only owns the tiny bit of UI state (which category is currently
 * selected in each row's dropdown, so the "what this means" note and the Save
 * button update live). Everything else is plain data passed in from the page.
 */
import { useState } from "react";
import { classifyTransactionAction } from "./actions";
import type { ClassifyRow } from "@/lib/crypto/crypto-classify-view-core";
import { Tooltip } from "@/components/admin/ux";

function ClassifyRowItem({ row }: { row: ClassifyRow }) {
  const [selected, setSelected] = useState<string>(row.effectiveTagKey);
  const selectedOption = row.options.find((o) => o.key === selected);
  const note = selectedOption ? selectedOption.note : row.taxNote;
  const changed = selected !== row.effectiveTagKey;

  return (
    <div className="border-t border-white/5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* What / when */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-white/70">
              {row.primitiveLabel}
            </span>
            <span className="font-semibold text-white/90">
              {row.amountTruncated ? (
                <Tooltip label={<span className="font-mono">{row.amountFull}</span>} position="top">
                  <span className="cursor-help border-b border-dotted border-white/30">
                    {row.amountShort}
                  </span>
                </Tooltip>
              ) : (
                row.amountShort || "\u2014"
              )}{" "}
              {row.assetLabel}
            </span>
            {row.isClassified ? (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/[0.06] px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                classified
              </span>
            ) : (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/[0.08] px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                needs review
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-white/40">
            {row.whenDisplay ? `${row.whenDisplay} \u00b7 ` : ""}
            {row.txRef}
          </p>
        </div>

        {/* Category picker + Save */}
        <form action={classifyTransactionAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="txId" value={row.txId} />
          <input type="hidden" name="primitive" value={row.primitive} />
          <select
            name="tagKey"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-emerald-400/50 focus:outline-none"
          >
            {row.options.map((o) => (
              <option key={o.key} value={o.key} className="bg-neutral-900">
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className={
              changed
                ? "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
                : "rounded-[var(--admin-radius)] border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/70 hover:bg-white/[0.08]"
            }
          >
            {changed ? "Save" : row.isClassified ? "Saved" : "Confirm"}
          </button>
        </form>
      </div>

      {/* Plain-English tax meaning of the current pick */}
      {note ? <p className="mt-2 text-xs text-white/55">{note}</p> : null}
    </div>
  );
}

export function ClassifyTable({ rows }: { rows: ClassifyRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-white/50">
        No transactions to classify yet. Once a wallet syncs its history, every transaction shows up
        here for you to review.
      </p>
    );
  }
  return (
    <div>
      {rows.map((r) => (
        <ClassifyRowItem key={r.txId} row={r} />
      ))}
    </div>
  );
}
