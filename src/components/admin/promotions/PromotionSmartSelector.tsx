"use client";

/**
 * PromotionSmartSelector — PR-P3 AI Smart Selector client island.
 *
 * A plain-English front door for product targeting, sitting inside the
 * (server-rendered) PromotionForm alongside the hand-built rule builder. The
 * manager types "all indica eighths under $30 that aren't already on sale" and:
 *
 *   1. draftSelectionPredicateAction asks the AI for a typed SelectionPredicate
 *      (the AI NEVER names product keys — it only fills attributes/ranges/flags).
 *   2. The server sanitizes that predicate against the LIVE menu vocabulary
 *      (dropping any brand/category/vendor not on the shelf) and resolves it with
 *      the SAME deterministic core the rule builder uses.
 *   3. This island shows the plain-English restatement, any warnings, and the
 *      EXACT matched products with the reasons each one qualified.
 *   4. "Use it" writes those matched product keys as hidden `target_product`
 *      inputs — identical to the rule builder's apply mechanism — so they ride
 *      the normal form submit. Nothing is saved until the manager submits.
 *
 * DRAFTS-ONLY. The CCRS below-cost hard block and the coupon/giveaway bans still
 * run server-side on publish. Gated on `aiEnabled` (AI_API_KEY present).
 */

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  draftSelectionPredicateAction,
  type SelectionPredicateDraftResult,
} from "@/app/admin/promotions/actions";
import type { SelectionMatch } from "@/lib/promotions/promotion-selector-core";
import { formatMinorCurrency } from "@/lib/leafly/format";

type Props = { aiEnabled: boolean };

type Draft = {
  matched: SelectionMatch[];
  restatement: string;
  summary: string;
  warnings: string[];
  totalMenu: number;
  empty: boolean;
};

const EXAMPLES = [
  "indica eighths under $30 that aren't already on sale",
  "high-THC flower over 25%",
  "anything with CBG or CBN",
  "1:1 ratio edibles",
  "low-stock prerolls we should move",
  "new arrivals in concentrates",
];

export function PromotionSmartSelector({ aiEnabled }: Props) {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  function runAi() {
    const req = request.trim();
    if (!req) return;
    setDraft(null);
    startTransition(async () => {
      const res: SelectionPredicateDraftResult = await draftSelectionPredicateAction({ request: req });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      if (res.empty || res.matched.length === 0) {
        setDraft({
          matched: res.matched,
          restatement: res.restatement,
          summary: res.summary,
          warnings: res.warnings,
          totalMenu: res.totalMenu,
          empty: res.empty,
        });
        toast({
          tone: "warning",
          message: res.empty
            ? "The AI couldn't turn that into a selection. Try being more specific (e.g. “indica eighths under $30”)."
            : "That selection matched no products on the current menu.",
        });
        return;
      }
      setDraft({
        matched: res.matched,
        restatement: res.restatement,
        summary: res.summary,
        warnings: res.warnings,
        totalMenu: res.totalMenu,
        empty: res.empty,
      });
      toast({
        tone: "success",
        message: `Found ${res.matched.length} product${res.matched.length === 1 ? "" : "s"}. Review, then Use it.`,
      });
    });
  }

  function useDraft() {
    if (!draft || draft.matched.length === 0) return;
    // De-dup against anything already applied by the rule builder or picker.
    const keys = Array.from(new Set(draft.matched.map((m) => m.key)));
    setAppliedKeys(keys);
    setDraft(null);
    setOpen(false);
    toast({
      tone: "info",
      message: `Added ${keys.length} product${keys.length === 1 ? "" : "s"} to this deal. Review the targeting, then submit.`,
    });
  }

  function clearApplied() {
    setAppliedKeys([]);
    toast({ tone: "info", message: "Cleared the products the Smart Selector added." });
  }

  const chipCls =
    "rounded-full bg-white/10 px-2.5 py-1 text-[0.7rem] text-white/70 hover:bg-white/20";

  return (
    <div
      ref={rootRef}
      className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.04] p-4"
    >
      {/* Applied keys ride the form submit as target_product (same mechanism as
          the rule builder / product picker). */}
      {appliedKeys.map((k) => (
        <input key={`ai-ap-${k}`} type="hidden" name="target_product" value={k} />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--admin-accent)]">
            ✨ Smart Selector — describe it in plain English
          </div>
          <p className="text-xs text-white/45">
            Type who this deal is for (“indica eighths under $30 not already on sale”). AI turns it
            into a live-menu selection you review — it never invents products.
          </p>
        </div>
        <Button type="button" onClick={() => setOpen((o) => !o)} variant="special" size="sm">
          {open ? "Hide" : "Open"}
        </Button>
      </div>

      {appliedKeys.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--admin-accent)]/30 bg-black/30 px-3 py-2">
          <span className="text-xs text-white/70">
            Smart Selector added <span className="font-semibold text-white">{appliedKeys.length}</span>{" "}
            product{appliedKeys.length === 1 ? "" : "s"} to this deal.
          </span>
          <Button type="button" onClick={clearApplied} variant="neutral" size="sm">
            Clear these
          </Button>
        </div>
      )}

      {open && (
        <div className="mt-3">
          {!aiEnabled ? (
            <p className="text-xs text-[var(--admin-gold)]">
              AI isn&apos;t set up yet. Add an <code className="font-mono">AI_API_KEY</code> to enable
              the Smart Selector. You can still target products with the smart rule builder below.
            </p>
          ) : (
            <>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-white/45">
                Describe the products
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!pending && request.trim()) runAi();
                    }
                  }}
                  placeholder="e.g. indica eighths under $30 that aren't already on sale"
                  className="min-w-[14rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--admin-accent)]"
                />
                <Button
                  type="button"
                  onClick={runAi}
                  disabled={pending || !request.trim()}
                  variant="special"
                  size="sm"
                >
                  {pending ? "Thinking…" : "Draft it"}
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-[0.65rem] text-white/35">Try:</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className={chipCls} onClick={() => setRequest(ex)}>
                    {ex}
                  </button>
                ))}
              </div>

              {draft && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                    Smart Selector result — review before using
                  </span>

                  {draft.summary && <p className="mt-1 text-sm text-white/90">{draft.summary}</p>}
                  <p className="mt-1 text-xs text-white/60">{draft.restatement}</p>

                  {draft.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5 rounded-md border border-[var(--admin-gold)]/30 bg-[var(--admin-gold)]/[0.06] p-2 text-[0.7rem] text-[var(--admin-gold)]">
                      {draft.warnings.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  )}

                  <p className="mt-2 text-xs text-white/70">
                    Matched <span className="font-semibold text-white">{draft.matched.length}</span> of{" "}
                    {draft.totalMenu} products on the current menu.
                  </p>

                  {draft.matched.length > 0 && (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-white/10">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-[#0a0a0a] text-white/40">
                          <tr>
                            <th className="px-2 py-1.5 font-medium">Product</th>
                            <th className="px-2 py-1.5 font-medium">Brand</th>
                            <th className="px-2 py-1.5 font-medium">Price</th>
                            <th className="px-2 py-1.5 font-medium">Why it matched</th>
                          </tr>
                        </thead>
                        <tbody>
                          {draft.matched.map((m) => (
                            <tr key={m.key} className="border-t border-white/5 align-top">
                              <td className="px-2 py-1.5 text-white/85">{m.name}</td>
                              <td className="px-2 py-1.5 text-white/55">{m.brand || "—"}</td>
                              <td className="px-2 py-1.5 text-white/70">
                                {formatMinorCurrency(m.priceMinorUnits)}
                              </td>
                              <td className="px-2 py-1.5 text-white/45">{m.reasons.join("; ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.matched.length > 0 && (
                      <Button type="button" onClick={useDraft} variant="confirm" size="sm">
                        Use these {draft.matched.length} product{draft.matched.length === 1 ? "" : "s"}
                      </Button>
                    )}
                    <Button type="button" onClick={runAi} disabled={pending} variant="neutral" size="sm">
                      Try again
                    </Button>
                    <Button type="button" onClick={() => setDraft(null)} variant="neutral" size="sm">
                      Discard
                    </Button>
                  </div>

                  <p className="mt-2 text-[0.65rem] text-white/35">
                    AI only proposes a selection from live-menu attributes — it never invents products.
                    Nothing is saved until you review the list above and submit. The register still
                    clamps at cost on publish.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
