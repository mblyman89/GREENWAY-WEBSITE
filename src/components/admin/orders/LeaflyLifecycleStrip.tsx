/**
 * src/components/admin/orders/LeaflyLifecycleStrip.tsx
 *
 * SLICE L-31 — WHERE ARE WE, AND WHO HAS BEEN TOLD?
 *
 * ===========================================================================
 * WHY THIS COMPONENT EXISTS
 * ===========================================================================
 * The owner, having finally got past the acknowledge bug that cost eight
 * slices, reported this:
 *
 *   > "I now see the order with the confirm button, mark ready for pick up,
 *   >  mark picked up, cancel on leafly. I think the process worked end to
 *   >  end. I clicked confirm first, then ready for pick up, then picked up.
 *   >  but the order does not change from open to completed and stays visible
 *   >  in the table. I think we need to make it much more obvious which step
 *   >  we are on, and then we will know we are finished because the order
 *   >  will be marked complete and moved to the hidden table."
 *
 * Read that carefully, because it contains a diagnosis as well as a request.
 * "I THINK the process worked end to end" — he could not tell. Four buttons
 * sat in a row, all enabled, all equally weighted, with nothing anywhere on
 * the card saying which of them was the next one or which had already been
 * pressed. The only state indicator was a status badge that (because of
 * defect 1 in this slice) never changed.
 *
 * So the screen was simultaneously wrong and silent about being wrong. That
 * combination is what produced three status pushes with no way to observe
 * that none of them had stuck.
 *
 * This strip is the observability half of the fix. `order-ack-server.ts` and
 * `bridge-server.ts` make the state CORRECT; this makes it VISIBLE. Shipping
 * either half alone would leave the owner in the same position of having to
 * guess, which is the thing he actually asked us to end.
 *
 * ===========================================================================
 * THE SECOND QUESTION THIS ANSWERS, WHICH IS THE MORE IMPORTANT ONE
 * ===========================================================================
 *   > "the communication from leafly from going through the process only
 *   >  generated one email... surely there is more communication from this
 *   >  process right? will you go back to the authoritative docs and figure
 *   >  out what the communication should be and at which stages."
 *
 * We did. The vendored spec (md5 daab7bcf6f77177de85425adf7f805f1,
 * re-downloaded live this slice and byte-identical) states it under
 * Expectations, verbatim:
 *
 *   "Leafly will be the sole originator of automated consumer facing
 *    communications related to orders placed on the Leafly platform. That is,
 *    Leafly shoppers should receive no automated emails or text messages from
 *    a partner system with regard to order confirmation, status updates, etc."
 *
 * That single sentence explains the one-email symptom completely, and it is
 * not a separate bug. There is no notification endpoint we failed to call.
 * There is no message template we forgot to write. **The status push IS the
 * notification.** Every status transition we successfully send is a message
 * Leafly sends the shopper; every transition that does not land is a message
 * the shopper never receives.
 *
 * The owner pressed three buttons and got one email because the pushes
 * reached Leafly but our board never advanced — so from Leafly's side the
 * order moved, while from ours it looked untouched, and neither of us could
 * see the other's version.
 *
 * Hence `customerEffect` on every step. When an operator can read "Leafly
 * tells the shopper their order is ready at the counter" underneath the step
 * they just completed, the invisible half of this integration becomes visible
 * — and when a customer rings up saying they heard nothing, the operator can
 * see at a glance which step never landed instead of blaming an email system
 * we are contractually forbidden from operating.
 *
 * ===========================================================================
 * THIS COMPONENT DECIDES NOTHING
 * ===========================================================================
 * Every label, every state, the headline, the progress fraction and the
 * "what the customer hears" line all arrive precomputed from
 * `lifecycleView()` in `src/lib/leafly/lifecycle-core.ts`, which is pure and
 * proven by 23 self-tests that run in CI with no Leafly account and no
 * database. A component that worked out its own step order would be a second,
 * untested copy of Leafly's transition rules — exactly the mistake that made
 * the acknowledge bug take eight slices to find.
 *
 * It is a SERVER component. There is no state, no effect and no event
 * handler here; it is a pure function of its props. That keeps it out of the
 * client bundle on a page used one-handed at a counter, and it means this
 * cannot be the thing that fails to hydrate.
 */

import { lifecycleView } from "@/lib/leafly/lifecycle-core";

/**
 * Colour and glyph per step state.
 *
 * The glyph carries the meaning as well as the colour, because a strip whose
 * only signal is colour is unreadable to a colour-blind operator and useless
 * on the washed-out phone screen this panel is actually used on.
 */
const STEP_STYLES: Readonly<
  Record<"done" | "current" | "todo", { dot: string; text: string; glyph: string }>
> = {
  done: {
    dot: "bg-[var(--admin-success)] text-black",
    text: "text-[var(--admin-text-faint)]",
    glyph: "✓",
  },
  current: {
    dot: "bg-[var(--admin-gold)] text-black ring-2 ring-[var(--admin-gold)]/40",
    text: "font-black text-[var(--admin-text)]",
    glyph: "●",
  },
  todo: {
    dot: "bg-[var(--admin-surface-2)] text-[var(--admin-text-faint)]",
    text: "text-[var(--admin-text-faint)]",
    glyph: "○",
  },
};

export function LeaflyLifecycleStrip({
  acknowledgedAt,
  leaflyStatus,
  fulfillmentMechanism,
  canceledAt,
}: {
  acknowledgedAt: string | null | undefined;
  leaflyStatus: string | null | undefined;
  fulfillmentMechanism: string | null | undefined;
  canceledAt?: string | null | undefined;
}) {
  const view = lifecycleView({
    acknowledgedAt,
    leaflyStatus,
    fulfillmentMechanism,
    canceledAt,
  });

  const current = view.steps.find((s) => s.state === "current") ?? null;

  return (
    <div
      data-testid="leafly-lifecycle-strip"
      data-phase={view.phase}
      data-progress={view.progress.toFixed(2)}
      className="mt-3 rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface-2)]/40 p-3"
    >
      {/* ── The headline ────────────────────────────────────────────────────
          One sentence, in words, naming the position. This is the line the
          owner said was missing: "make it much more obvious which step we are
          on". A progress bar alone does not say it; a sentence does. */}
      <p
        data-testid="leafly-lifecycle-headline"
        className="text-xs font-black uppercase tracking-wide text-[var(--admin-text)]"
      >
        {view.headline}
      </p>

      {/* ── The steps ───────────────────────────────────────────────────────
          An ordered list, because it IS an ordered list, and because that is
          what a screen reader needs in order to announce "step 3 of 4". */}
      <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {view.steps.map((step, index) => {
          const style = STEP_STYLES[step.state];
          return (
            <li
              key={step.key}
              data-testid={`leafly-step-${step.key}`}
              data-state={step.state}
              className="flex items-center gap-1.5"
              // aria-current is the standard way to say "you are here", and
              // it is what makes the strip usable without sight of the
              // colours at all.
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${style.dot}`}
              >
                {style.glyph}
              </span>
              <span className={`text-xs ${style.text}`}>{step.label}</span>
              {index < view.steps.length - 1 ? (
                <span aria-hidden className="mx-0.5 text-[var(--admin-text-faint)]">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* ── What happens next, and what the customer will be told ───────────
          `nextLabel` is deliberately the SAME wording as the button that
          performs it, so the instruction and the control cannot drift apart
          and leave an operator hunting for a button that does not exist. */}
      {view.nextLabel ? (
        <p
          data-testid="leafly-lifecycle-next"
          className="mt-2 text-xs text-[var(--admin-text-faint)]"
        >
          <span className="font-bold text-[var(--admin-text)]">Next:</span>{" "}
          {view.nextLabel}
          {current?.customerEffect ? ` — ${current.customerEffect}` : null}
        </p>
      ) : null}

      {/* ── The closing statement ───────────────────────────────────────────
          The owner's own completion criterion, stated back to him on the
          card: "we will know we are finished because the order will be
          marked complete and moved to the hidden table." When this line is
          on screen, that has happened. */}
      {view.isClosed ? (
        <p
          data-testid="leafly-lifecycle-closed"
          className="mt-2 text-xs font-bold text-[var(--admin-success)]"
        >
          Finished — this order is closed on Leafly and at the register, and
          has moved out of the open list.
        </p>
      ) : null}

      {/* ── Who sends the emails ────────────────────────────────────────────
          Stated once per card, permanently, because the owner spent a whole
          slice wondering why only one email arrived. An operator who believes
          Greenway sends these will debug the wrong system forever. */}
      <p
        data-testid="leafly-lifecycle-comms-note"
        className="mt-2 border-t border-[var(--admin-border)] pt-2 text-[11px] leading-relaxed text-[var(--admin-text-faint)]"
      >
        Leafly sends every customer message for this order — Greenway must not.
        Each step above is what triggers one, so a step that never lands is a
        message the shopper never gets.
      </p>
    </div>
  );
}
