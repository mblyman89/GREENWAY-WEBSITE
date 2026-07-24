"use client";

/**
 * PromotionAiMechanics — SLICE 39 connectivity audit. A client island inside
 * the (server-rendered) PromotionForm that drafts the STRUCTURED mechanics
 * (qty/weight/spend tiers, BOGO, basket, either/or) from plain English via
 * draftEngineConfigAction and — on "Use it" — pre-fills the form's cfg_*
 * inputs. This finally connects src/lib/promotions/engine-ai.ts, which was
 * built but never callable from any page.
 *
 * Drafts-only: the AI fills form fields for the manager to review/edit;
 * nothing is saved until the form is submitted, and the CCRS below-cost hard
 * block still runs server-side on publish.
 */
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  draftEngineConfigAction,
  type EngineConfigDraftResult,
} from "@/app/admin/promotions/actions";
import type { EngineConfig } from "@/lib/promotions/discount-engine-core";
import type { DiscountType } from "@/lib/promotions/types";

type Props = { aiEnabled: boolean };

/** Set the i-th input that shares `name` inside the form (tier rows repeat
 * the same name three times) and fire a native input event. */
function setIndexedField(form: HTMLFormElement, name: string, index: number, value: string) {
  const els = form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
  const el = els[index];
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function setField(form: HTMLFormElement, name: string, value: string) {
  setIndexedField(form, name, 0, value);
}

function setRadio(form: HTMLFormElement, name: string, value: string) {
  const el = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (!el) return;
  el.checked = true;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Write the drafted EngineConfig into the form's cfg_* inputs. Clears each
 * touched section first so a re-draft never leaves stale numbers behind. */
function applyConfigToForm(form: HTMLFormElement, config: EngineConfig) {
  // Tier rows (three each). Spend tiers: the engine speaks CENTS, the form
  // takes DOLLARS (buildConfig multiplies by 100 on save).
  const tierSets: [string, { at: number; percent: number }[] | undefined, (at: number) => number][] = [
    ["cfg_qty_tier", config.qtyTiers, (at) => at],
    ["cfg_weight_tier", config.weightTiers, (at) => at],
    ["cfg_spend_tier", config.spendTiers, (at) => at / 100],
  ];
  for (const [prefix, tiers, atToForm] of tierSets) {
    for (let i = 0; i < 3; i++) {
      const t = tiers?.[i];
      setIndexedField(form, `${prefix}_at`, i, t ? String(atToForm(t.at)) : "");
      setIndexedField(form, `${prefix}_percent`, i, t ? String(t.percent) : "");
    }
  }

  setField(form, "cfg_bogo_buy", config.bogo ? String(config.bogo.buyQty) : "");
  setField(form, "cfg_bogo_get", config.bogo ? String(config.bogo.getQty) : "");
  setField(form, "cfg_bogo_percent", config.bogo ? String(config.bogo.getPercent) : "");

  if (config.basketTopItem) {
    setRadio(form, "cfg_basket_mode", "top_item");
    setField(form, "cfg_top_percent", String(config.basketTopItem.topPercent));
    setField(form, "cfg_rest_percent", String(config.basketTopItem.restPercent));
    setField(form, "cfg_basket_n", "");
    setField(form, "cfg_basket_m", "");
  } else if (config.basketNforM) {
    setRadio(form, "cfg_basket_mode", "n_for_m");
    setField(form, "cfg_basket_n", String(config.basketNforM.n));
    setField(form, "cfg_basket_m", String(config.basketNforM.m));
    setField(form, "cfg_top_percent", "");
    setField(form, "cfg_rest_percent", "");
  }

  setField(form, "cfg_eo_flat", config.eitherOr ? String(config.eitherOr.flatPercent) : "");
  setField(form, "cfg_eo_n", config.eitherOr?.bundle ? String(config.eitherOr.bundle.n) : "");
  setField(form, "cfg_eo_m", config.eitherOr?.bundle ? String(config.eitherOr.bundle.m) : "");
}

/** Human recap of what the draft will fill, so "Use it" is informed consent. */
function describeConfig(config: EngineConfig): string[] {
  const bits: string[] = [];
  if (config.qtyTiers?.length) {
    bits.push(`Qty tiers: ${config.qtyTiers.map((t) => `${t.at}+ → ${t.percent}%`).join(", ")}`);
  }
  if (config.weightTiers?.length) {
    bits.push(`Weight tiers: ${config.weightTiers.map((t) => `${t.at}g+ → ${t.percent}%`).join(", ")}`);
  }
  if (config.spendTiers?.length) {
    bits.push(
      `Spend tiers: ${config.spendTiers.map((t) => `$${(t.at / 100).toFixed(2)}+ → ${t.percent}%`).join(", ")}`,
    );
  }
  if (config.bogo) {
    bits.push(`BOGO: buy ${config.bogo.buyQty}, get ${config.bogo.getQty} at ${config.bogo.getPercent}% off`);
  }
  if (config.basketNforM) bits.push(`Basket: buy ${config.basketNforM.n} for the price of ${config.basketNforM.m}`);
  if (config.basketTopItem) {
    bits.push(`Basket: ${config.basketTopItem.topPercent}% off one item, ${config.basketTopItem.restPercent}% off the rest`);
  }
  if (config.eitherOr) {
    bits.push(
      `Either/or: ${config.eitherOr.flatPercent}% flat OR ${config.eitherOr.bundle.n} for ${config.eitherOr.bundle.m} (store-favorable)`,
    );
  }
  return bits;
}

export function PromotionAiMechanics({ aiEnabled }: Props) {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState<{ config: EngineConfig; summary: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function getForm(): HTMLFormElement | null {
    return rootRef.current?.closest("form") ?? null;
  }

  function runAi() {
    const form = getForm();
    const discountType = ((form?.elements.namedItem("discount_type") as HTMLSelectElement | null)?.value ||
      "percent") as DiscountType;
    setDraft(null);
    startTransition(async () => {
      const res: EngineConfigDraftResult = await draftEngineConfigAction({ discountType, request });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      const bits = describeConfig(res.config);
      if (bits.length === 0) {
        toast({
          tone: "warning",
          message:
            "The AI couldn't map that to structured mechanics. Try being more specific (e.g. “buy 2 get 15% off, 4 or more get 25%”).",
        });
        return;
      }
      setDraft({ config: res.config, summary: res.summary });
      toast({ tone: "success", message: "Mechanics drafted. Review, then Use it." });
    });
  }

  function useDraft() {
    if (!draft) return;
    const form = getForm();
    if (!form) return;
    applyConfigToForm(form, draft.config);
    setDraft(null);
    setOpen(false);
    toast({
      tone: "info",
      message: "Filled in the mechanics fields. Review every number, then submit.",
    });
  }

  return (
    <div
      ref={rootRef}
      className="rounded-xl border border-[var(--admin-accent)]/25 bg-[var(--admin-accent)]/[0.04] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[var(--admin-accent)]">
            ✨ Draft the mechanics with AI
          </div>
          <p className="text-xs text-white/45">
            Pick the discount type above, describe the deal in plain English, and AI pre-fills the
            tier/BOGO/basket numbers below for you to review.
          </p>
        </div>
        <Button type="button" onClick={() => setOpen((o) => !o)} variant="special" size="sm">
          {open ? "Hide" : "Open"}
        </Button>
      </div>

      {open && (
        <div className="mt-3">
          {!aiEnabled ? (
            <p className="text-xs text-[var(--admin-gold)]">
              AI isn&apos;t set up yet. Add an <code className="font-mono">AI_API_KEY</code> to
              enable this. You can still fill the mechanics by hand.
            </p>
          ) : (
            <>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-white/45">
                Describe the deal
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder="e.g. buy 2 get 15% off, 4 or more get 25%"
                  className="min-w-[12rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[var(--admin-accent)]"
                />
                <Button
                  type="button"
                  onClick={runAi}
                  disabled={pending || !request.trim()}
                  variant="special"
                  size="sm"
                >
                  {pending ? "Drafting…" : "Draft it"}
                </Button>
              </div>

              {draft && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                    AI draft — review before using
                  </span>
                  {draft.summary && <p className="mt-1 text-sm text-white/90">{draft.summary}</p>}
                  <ul className="mt-1 space-y-0.5 text-xs text-white/70">
                    {describeConfig(draft.config).map((line, i) => (
                      <li key={i}>• {line}</li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" onClick={useDraft} variant="confirm" size="sm">
                      Use it
                    </Button>
                    <Button type="button" onClick={runAi} disabled={pending} variant="neutral" size="sm">
                      Try again
                    </Button>
                    <Button type="button" onClick={() => setDraft(null)} variant="neutral" size="sm">
                      Discard
                    </Button>
                  </div>
                  <p className="mt-2 text-[0.65rem] text-white/35">
                    AI fills the form fields only — nothing is saved until you review every number
                    and submit. Percent caps at 99 (cannabis is never free) and the register still
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
