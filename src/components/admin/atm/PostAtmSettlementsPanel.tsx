"use client";

/**
 * src/components/admin/atm/PostAtmSettlementsPanel.tsx   (slice books-89)
 *
 * THE BUTTON THAT CLOSES D-40.
 *
 * The ATM has been settling money into the vault account since long before this
 * software existed, and none of it had ever reached the books. books-69 built
 * the entry; nothing filed it. This is the thing a person presses.
 *
 * TWO DESIGN DECISIONS THAT ARE NOT COSMETIC.
 *
 * 1. REFUSED DAYS ARE LISTED FIRST AND IN FULL. A run that files 112 days and
 *    quietly drops 3 is worse than one that files nothing, because the missing
 *    three are invisible in every report afterwards — the totals still look
 *    plausible. Each refusal shows its date and the core's own sentence.
 *
 * 2. THE PANEL SAYS "DRAFTS", NOT "POSTED". Nothing here touches the P&L. Every
 *    entry lands on /admin/books/drafts for approval, because the ATM is
 *    reconciled against a physical count by a person. Wording that implied
 *    otherwise would be the screen lying about what the engine did.
 */

import Link from "next/link";
import { useState, useTransition } from "react";

import { postAtmSettlementsAction } from "@/app/admin/atm/actions";
import type { AtmPostRunResult } from "@/lib/atm/atm-settlement-service";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function PostAtmSettlementsPanel() {
  const [result, setResult] = useState<AtmPostRunResult | null>(null);
  const [pending, startTransition] = useTransition();

  const refusals = (result?.outcomes ?? []).filter((o) => o.kind === "refused");
  const recorded = (result?.outcomes ?? []).filter((o) => o.kind === "recorded");

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await postAtmSettlementsAction());
          })
        }
        className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Filing…" : "File settled days as drafts"}
      </button>

      <p className="max-w-3xl text-sm leading-relaxed text-white/55">
        Nothing posts here. Each settled day becomes a draft entry waiting for your
        approval, because the ATM is reconciled against a physical count. Filing the
        same day twice is safe — it is recognised and skipped rather than doubled.
      </p>

      {result && (
        <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
          {result.error !== null ? (
            <p className="text-sm text-amber-300">{result.error}</p>
          ) : (
            <p className="text-sm text-white/75">
              {result.scanned} settled {result.scanned === 1 ? "day" : "days"} read.{" "}
              <strong className="text-emerald-300">{result.recorded} filed as drafts</strong>,{" "}
              {result.duplicates} already filed,{" "}
              <strong className={result.refused > 0 ? "text-amber-300" : "text-white/60"}>
                {result.refused} not filed
              </strong>
              .
            </p>
          )}

          {/* Refusals FIRST. They are the days that need a human. */}
          {refusals.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-300">
                Not filed — these need you
              </h4>
              <ul className="space-y-1.5">
                {refusals.map((o) => (
                  <li
                    key={o.sourceRef || `${o.terminalId}-${o.settlementDate}`}
                    className="rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-2.5 text-sm"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium text-white/85">
                        {o.settlementDate} {o.terminalId ? `· ${o.terminalId}` : ""}
                      </span>
                      <span className="text-white/60">{money(o.surchargeCents)}</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-200/80">
                      {"message" in o ? o.message : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recorded.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
                Filed as drafts
              </h4>
              <ul className="space-y-1">
                {recorded.map((o) => (
                  <li
                    key={o.sourceRef}
                    className="flex flex-wrap justify-between gap-2 text-sm text-white/70"
                  >
                    <span>
                      {o.settlementDate} {o.terminalId ? `· ${o.terminalId}` : ""}
                    </span>
                    <span className="text-white/50">
                      {money(o.surchargeCents)} surcharge
                      {"outcome" in o && o.outcome === "duplicate" ? " — already filed" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.recorded > 0 && (
            <Link
              href="/admin/books/drafts"
              className="inline-block text-sm font-semibold text-emerald-300 hover:underline"
            >
              Review and approve them →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
