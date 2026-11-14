"use client";

/**
 * CopilotChat.tsx  (D244 R-5, strategy slice E-6)
 *
 * The Enrichment Copilot's chat. The model only PROPOSES: each proposal shows
 * in an edit box with "Use this", which files it as a draft and accepts it
 * through the same gates as the product page (compliance re-scan, effects
 * gate, potency must match a lab / lot / POS number). "Look closely" asks the
 * vision model to read one photo's label. The conversation lives in this
 * page only (nothing is stored but the audit row).
 */
import { useActionState } from "react";
import { copilotAskAction, copilotUseProposalAction, copilotAttachPhotoAction, type CopilotChatState } from "@/app/admin/products/copilot/actions";
import { copilotFieldLabel, COPILOT_MESSAGE_MAX_CHARS, type CopilotPhotoChoice } from "@/lib/enrichment/copilot-core";
import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";

const STARTERS = [
  "What is missing on this card, and what would you write?",
  "Draft the strain type and potency from the lab certificate.",
  "Which photo is this product?",
  "Make the description shorter and punchier.",
];

export function CopilotChat({
  hidden,
  photoChoices,
  attachedPhotos,
  aiReady,
}: {
  hidden: { key: string; vendor: string; skip: string; nextKey: string; identityKey: string };
  photoChoices: CopilotPhotoChoice[];
  attachedPhotos: { id: string; label: string }[];
  aiReady: boolean;
}) {
  const [state, formAction, pending] = useActionState<CopilotChatState, FormData>(copilotAskAction, { turns: [] });
  const ctx = (
    <>
      <input type="hidden" name="key" value={hidden.key} />
      <input type="hidden" name="vendor" value={hidden.vendor} />
      <input type="hidden" name="skip" value={hidden.skip} />
      <input type="hidden" name="nextKey" value={hidden.nextKey} />
    </>
  );
  const inspectable = [
    ...attachedPhotos.map((p, i) => ({ id: p.id, label: `attached photo ${i + 1}` })),
    ...photoChoices.map((c) => ({ id: c.id, label: `photo ${c.n}` })),
  ].slice(0, 12);

  if (!aiReady) {
    return (
      <p className="rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-3 text-sm text-[var(--admin-gold)]">
        The copilot needs an AI key (AI_API_KEY, or AI_GEMINI_API_KEY for a Gemini model). Everything else on this page still works.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="copilot-chat">
      <ol className="max-h-[32rem] space-y-2 overflow-y-auto pr-1" aria-live="polite">
        {state.turns.length === 0 && (
          <li className="text-xs text-white/50">
            Ask anything about this card. The copilot reads the POS record, the lots and lab certificates, the attached photos, the
            knowledge base and this vendor&rsquo;s published cards. It suggests; you press <strong>Use this</strong>.
          </li>
        )}
        {state.turns.map((t, i) => (
          <li
            key={i}
            className={`rounded-lg border p-2 text-sm ${t.role === "user" ? "ml-6 border-white/10 bg-white/5 text-white/80" : t.error ? "mr-6 border-[var(--admin-orange)]/40 text-[var(--admin-orange)]" : "mr-6 border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/5 text-white/90"}`}
            data-testid={t.role === "user" ? "copilot-turn-user" : "copilot-turn-assistant"}
          >
            <p className="whitespace-pre-wrap">{t.content}</p>
            {t.answer?.why && <p className="mt-1 text-[0.7rem] text-white/45">Based on: {t.answer.why}</p>}
            {t.answer?.photoPick ? (
              (() => {
                const c = photoChoices.find((p) => p.n === t.answer!.photoPick);
                return c ? (
                  <form action={copilotAttachPhotoAction} className="mt-2 flex items-center gap-2" data-testid="copilot-photo-pick">
                    {ctx}
                    <input type="hidden" name="mediaId" value={c.id} />
                    <input type="hidden" name="identityKey" value={hidden.identityKey} />
                    <span className="text-xs text-white/70">It thinks photo {c.n} is this product.</span>
                    <button type="submit" className={CHIP_ACTION}>
                      Attach photo {c.n}
                    </button>
                  </form>
                ) : null;
              })()
            ) : null}
            {t.answer?.proposals.map((p, j) => (
              <form key={`${i}-${p.field}-${j}`} action={copilotUseProposalAction} className="mt-2 rounded border border-white/10 bg-black/40 p-2" data-testid="copilot-proposal">
                {ctx}
                <input type="hidden" name="field" value={p.field} />
                <label className="mb-1 block text-xs font-semibold text-white" htmlFor={`cp-${i}-${j}`}>
                  {copilotFieldLabel(p.field)}
                </label>
                <textarea
                  id={`cp-${i}-${j}`}
                  name="value"
                  defaultValue={p.value}
                  rows={p.value.length > 120 || p.field === "seo" ? 3 : 1}
                  className="w-full resize-y rounded border border-white/15 bg-white/5 px-2 py-1 text-sm text-white/85 focus:border-[var(--admin-accent)] focus:outline-none"
                />
                <div className="mt-1 flex items-center gap-2">
                  <button type="submit" className={CHIP_ACTION} data-testid="copilot-use-this">
                    Use this
                  </button>
                  <span className="text-[0.65rem] text-white/40">Edit first if you like. It still passes the compliance check.</span>
                </div>
              </form>
            ))}
          </li>
        ))}
        {pending && <li className="mr-6 animate-pulse rounded-lg border border-white/10 p-2 text-sm text-white/50">Thinking&hellip;</li>}
      </ol>

      <form action={formAction} className="space-y-2" data-testid="copilot-ask-form">
        {ctx}
        <textarea
          id="copilot-message"
          name="message"
          rows={2}
          maxLength={COPILOT_MESSAGE_MAX_CHARS}
          data-copilot-key="/"
          placeholder="Ask the copilot (press / to jump here). E.g. “Write a description in the vendor’s style.”"
          className="w-full resize-y rounded border border-white/15 bg-white/5 px-2 py-1 text-sm text-white focus:border-[var(--admin-accent)] focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={CHIP_ACTION} disabled={pending} data-testid="copilot-send">
            {pending ? "Thinking…" : "Send"}
          </button>
          {STARTERS.map((s) => (
            <button key={s} type="submit" name="starter" value={s} className={CHIP_NEUTRAL} disabled={pending}>
              {s}
            </button>
          ))}
        </div>
        {inspectable.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-white/50">
            <span>Look closely (AI reads the label):</span>
            {inspectable.map((p) => (
              <button key={p.id} type="submit" name="inspect" value={`${p.id}|${p.label}`} className={CHIP_NEUTRAL} disabled={pending} data-testid="copilot-inspect">
                {p.label}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
