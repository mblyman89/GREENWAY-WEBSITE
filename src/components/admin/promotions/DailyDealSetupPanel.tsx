/**
 * D134 — "Set up our daily deals" panel on /admin/promotions.
 *
 * Shows, day by day, exactly what pressing the button will change (computed by
 * daily-deal-setup-core from the live rows), then one button applies it.
 * Thursday is listed as manual and never touched (owner: "except for
 * thursday, that one is a manual processes").
 */
import Link from "next/link";
import type { DailyDealPlan } from "@/lib/promotions/daily-deal-setup-core";
import { applyDailyDealSetupAction } from "@/app/admin/promotions/actions";
import { InfoHint } from "@/components/admin/ux";

export function DailyDealSetupPanel({
  plan,
  readError,
  message,
  tone,
}: {
  plan: DailyDealPlan | null;
  readError?: string | null;
  message?: string | null;
  tone?: "ok" | "error" | null;
}) {
  return (
    <section
      id="daily-setup"
      className="rounded-xl border border-[var(--admin-accent)]/30 bg-[var(--admin-accent)]/5 p-5"
      data-testid="daily-deal-setup"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold text-white">
            Routine daily deals: one-press setup
            <InfoHint
              position="bottom"
              text="Creates or fixes Monday, Tuesday, Wednesday, Friday, Saturday and Sunday so they match the standard Greenway deals, then publishes them. Your titles, descriptions and badge notes are kept. Product and brand exclusions are kept. Each day is checked against the cost floor first, and any day that would go below cost is left alone and reported. Thursday is never touched."
            />
          </h2>
          <p className="mt-1 text-sm text-white/60">
            Press this whenever a routine day looks wrong. The list below shows exactly what will change. Thursday
            is set up by hand each week.
          </p>
        </div>
        {plan && (
          <form action={applyDailyDealSetupAction}>
            <button
              type="submit"
              data-testid="daily-deal-setup-apply"
              className={
                plan.toChange > 0
                  ? "rounded-lg bg-[var(--admin-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#6bc945]"
                  : "rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/60"
              }
            >
              {plan.toChange > 0
                ? `Set up our daily deals (${plan.toChange} day${plan.toChange === 1 ? "" : "s"} to fix)`
                : "Daily deals are already set up ✓"}
            </button>
          </form>
        )}
      </div>

      {message ? (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            tone === "error" ? "border border-amber-400/40 bg-amber-400/10 text-amber-200" : "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          }`}
        >
          {message}
        </p>
      ) : null}

      {readError ? (
        <p className="mt-3 text-sm text-amber-200">
          The daily deals could not be read ({readError}). Nothing will change until the page loads cleanly.
        </p>
      ) : null}

      {plan && (
        <ul className="mt-4 grid gap-2 lg:grid-cols-2">
          {plan.items.map((i) => (
            <li key={i.promoKey} className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white/90">
                  {i.dayLabel} · {i.title}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    i.action === "unchanged"
                      ? "bg-emerald-400/15 text-emerald-200"
                      : i.action === "create"
                        ? "bg-sky-400/15 text-sky-200"
                        : "bg-amber-400/15 text-amber-200"
                  }`}
                >
                  {i.action === "unchanged" ? "Already right" : i.action === "create" ? "Will create" : "Will fix"}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/50">{i.summary}</p>
              {i.changes.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-white/70">
                  {i.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              {i.existingId && (
                <Link href={`/admin/promotions/${i.existingId}`} className="mt-1 inline-block text-xs text-[var(--admin-accent)] hover:underline">
                  Open this deal →
                </Link>
              )}
            </li>
          ))}
          {plan.manual.map((m) => (
            <li key={m.promoKey} className="rounded-lg border border-dashed border-white/15 bg-black/20 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-white/80">{m.dayLabel} · manual</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/60">Not touched</span>
              </div>
              <p className="mt-1 text-xs text-white/50">
                {m.note}{" "}
                <Link href="/admin/promotions/thursday-planner" className="text-[var(--admin-accent)] hover:underline">
                  Thursday planner →
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
