"use client";

/**
 * PromotionAiCopy — a client island that sits inside the (server-rendered)
 * PromotionForm and offers one-click AI drafting of the promo NAME +
 * announcement + badge note (PR C).
 *
 * It reads the mechanics the staffer already chose (discount type / percent /
 * fixed / weekday / what-it-applies-to) directly from the surrounding form's
 * DOM, asks the server action for compliant copy, and — on "Use it" — writes
 * the result back into the form's title / description / bonus_note inputs and
 * fires native input events so any other listeners stay in sync.
 *
 * Drafts-only: nothing is saved until the staffer reviews and submits the form.
 */
import { useRef, useState, useTransition } from "react";
import { useToast } from "@/components/admin/ux";
import {
  suggestPromotionCopyAction,
  type PromotionCopyResult,
} from "@/app/admin/promotions/actions";
import type { DiscountType, Weekday } from "@/lib/promotions/types";

type Props = { aiEnabled: boolean };

function setFieldValue(form: HTMLFormElement | null, name: string, value: string) {
  if (!form) return;
  const el = form.elements.namedItem(name) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function readField(form: HTMLFormElement | null, name: string): string {
  if (!form) return "";
  const el = form.elements.namedItem(name) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
  return el?.value ?? "";
}

/** Build a short "applies to" summary from the checked targets. */
function readAppliesTo(form: HTMLFormElement | null): string {
  if (!form) return "";
  const storewide = form.querySelector<HTMLInputElement>(
    'input[name="target_scope"][value="all"]:checked',
  );
  if (storewide) return "everything in the store";
  const cats = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="target_category"]:checked'),
  ).map((c) => c.value);
  const brands = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[name="target_brand"]:checked'),
  ).map((b) => b.value);
  const bits: string[] = [];
  if (cats.length) bits.push(`${cats.slice(0, 4).join(", ")}${cats.length > 4 ? "…" : ""}`);
  if (brands.length)
    bits.push(`brands: ${brands.slice(0, 4).join(", ")}${brands.length > 4 ? "…" : ""}`);
  return bits.join("; ");
}

export function PromotionAiCopy({ aiEnabled }: Props) {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [suggestion, setSuggestion] = useState<
    { title: string; description: string; badgeNote: string; flags: string[]; model: string } | null
  >(null);
  const [pending, startTransition] = useTransition();

  function getForm(): HTMLFormElement | null {
    return rootRef.current?.closest("form") ?? null;
  }

  function runAi() {
    const form = getForm();
    const discountType = (readField(form, "discount_type") || "percent") as DiscountType;
    const discountPercent = Number(readField(form, "discount_percent")) || null;
    const discountFixedMinor = Number(readField(form, "discount_fixed")) || null;
    const weekdayRaw = readField(form, "weekday");
    const weekday = weekdayRaw === "" ? null : (Number(weekdayRaw) as Weekday);

    setSuggestion(null);
    startTransition(async () => {
      const res: PromotionCopyResult = await suggestPromotionCopyAction({
        discountType,
        discountPercent,
        discountFixedMinor,
        weekday,
        appliesTo: readAppliesTo(form) || null,
        currentTitle: readField(form, "title") || null,
        currentDescription: readField(form, "description") || null,
        instruction,
      });
      if (!res.ok) {
        toast({ tone: "error", message: res.error });
        return;
      }
      setSuggestion({
        title: res.title,
        description: res.description,
        badgeNote: res.badgeNote,
        flags: res.complianceFlags,
        model: res.model,
      });
      if (res.complianceFlags.length > 0) {
        toast({
          tone: "warning",
          message: `AI copy ready — but flagged: ${res.complianceFlags.join(", ")}. Review before using.`,
        });
      } else {
        toast({ tone: "success", message: "AI promo copy ready. Review, then Use it." });
      }
    });
  }

  function useSuggestion() {
    if (!suggestion) return;
    const form = getForm();
    if (suggestion.title) setFieldValue(form, "title", suggestion.title);
    if (suggestion.description) setFieldValue(form, "description", suggestion.description);
    if (suggestion.badgeNote) setFieldValue(form, "bonus_note", suggestion.badgeNote);
    setSuggestion(null);
    setOpen(false);
    toast({ tone: "info", message: "Filled in the name, description, and badge. Review, then submit." });
  }

  return (
    <div ref={rootRef} className="rounded-xl border border-[#7ed957]/25 bg-[#7ed957]/[0.04] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-[#7ed957]">✨ Write the copy with AI</div>
          <p className="text-xs text-white/45">
            Set the discount + schedule + what it applies to first, then let AI draft the name,
            announcement, and badge.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-3 py-1.5 text-xs font-bold text-[#7ed957] transition hover:bg-[#7ed957]/20"
        >
          {open ? "Hide" : "Open"}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          {!aiEnabled ? (
            <p className="text-xs text-[#ffd700]">
              AI isn&apos;t set up yet. Add an <code className="font-mono">AI_API_KEY</code> to
              enable this. You can still write the copy by hand.
            </p>
          ) : (
            <>
              <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-white/45">
                Tell the AI the vibe (optional)
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. playful, alliterative, mention curbside pickup"
                  className="min-w-[12rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-1.5 text-xs text-white outline-none focus:border-[#7ed957]"
                />
                <button
                  type="button"
                  onClick={runAi}
                  disabled={pending}
                  className="rounded-lg bg-[#7ed957] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#6bc746] disabled:opacity-50"
                >
                  {pending ? "Writing…" : "Generate"}
                </button>
              </div>

              {suggestion && (
                <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
                      AI suggestion · {suggestion.model}
                    </span>
                    {suggestion.flags.length > 0 ? (
                      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[0.6rem] font-semibold text-red-300">
                        ⚠ {suggestion.flags.join(", ")}
                      </span>
                    ) : (
                      <span className="rounded-full border border-[#7ed957]/40 bg-[#7ed957]/10 px-2 py-0.5 text-[0.6rem] font-semibold text-[#7ed957]">
                        ✓ no compliance flags
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 text-sm text-white/90">
                    <div>
                      <span className="text-white/45">Name:</span> {suggestion.title}
                    </div>
                    <div>
                      <span className="text-white/45">Announcement:</span> {suggestion.description}
                    </div>
                    <div>
                      <span className="text-white/45">Badge:</span> {suggestion.badgeNote}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={useSuggestion}
                      className="rounded-lg bg-[#7ed957] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#6bc746]"
                    >
                      Use it
                    </button>
                    <button
                      type="button"
                      onClick={runAi}
                      disabled={pending}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/10 disabled:opacity-50"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={() => setSuggestion(null)}
                      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/60 hover:bg-white/10"
                    >
                      Discard
                    </button>
                  </div>
                  <p className="mt-2 text-[0.65rem] text-white/35">
                    AI fills the form fields only — nothing changes on your site until you submit and
                    publish.
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
