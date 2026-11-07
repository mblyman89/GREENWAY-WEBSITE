"use client";

/**
 * src/components/admin/registers/AtmCashCard.tsx  (D198e)
 *
 * Owner: "There should be a small current cash in atm card on the deposit bag page that acts like a
 * button, when pressed, it updates the card to show the current amount, so they know how much, if
 * any is needed from that days deposit bag."
 *
 * The whole card is one button. Pressing it asks PAI for the ATM's cash right now (the server action
 * throttles to once a minute and audits the read). While it works the card says so and cannot be
 * pressed twice. The figure is always shown WITH its time, so an old reading never looks live, and a
 * failed read keeps the last figure, dated, with the reason - never a blank or a made-up number.
 */
import { useActionState } from "react";

import { refreshAtmCashAction, type AtmCashCardState } from "@/app/admin/registers/deposit-bags/actions";

function money(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function when(iso: string | null): string {
  if (!iso) return "never read";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AtmCashCard({ initial, staleMinutes }: { initial: AtmCashCardState; staleMinutes: number }) {
  const [state, formAction, pending] = useActionState<AtmCashCardState, FormData>(
    (prev, fd) => refreshAtmCashAction(prev, fd),
    initial,
  );
  const ageMin = state.capturedAt ? Math.round((Date.parse(state.serverNowIso) - Date.parse(state.capturedAt)) / 60000) : null;
  const stale = ageMin === null || !Number.isFinite(ageMin) || ageMin > staleMinutes;
  return (
    <form action={formAction} className="h-full">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        data-testid="atm-cash-card"
        title="Press to ask PAI for the cash in the ATM right now"
        className="flex h-full w-full flex-col items-start rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-4 text-left transition hover:border-[var(--admin-accent)]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)] disabled:cursor-wait disabled:opacity-80"
      >
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-muted)]">
          Cash in the ATM ({state.terminalId}) · press to refresh
        </span>
        <span className="mt-1 text-2xl font-semibold tabular-nums text-[var(--admin-text)]">
          {pending ? "Asking PAI…" : money(state.balanceCents)}
        </span>
        <span suppressHydrationWarning className={`mt-1 text-xs ${stale ? "text-[var(--admin-gold)]" : "text-[var(--admin-text-faint)]"}`}>
          {state.capturedAt ? `As of ${when(state.capturedAt)}${stale ? " — old reading, press to refresh" : ""}` : "No reading yet — press to read the ATM"}
        </span>
        <span className="mt-1 text-xs text-[var(--admin-text)]">{state.needSentence}</span>
        {state.message ? (
          <span role="status" className={`mt-1 text-xs ${state.ok ? "text-[var(--admin-text-faint)]" : "text-[var(--admin-danger)]"}`}>
            {state.message}
          </span>
        ) : null}
      </button>
    </form>
  );
}
