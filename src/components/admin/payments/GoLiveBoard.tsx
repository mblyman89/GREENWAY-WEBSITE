/**
 * R41 S9: the Go-Live Readiness board on the ACH guide (#go-live).
 *
 * One card per gate: green, red, information or "could not be read", each
 * with a deep link to the exact place to fix it. Read-only. It never blocks
 * paying by check; the real locks are achGate, the database guards, the
 * first-file gate and the limits.
 */
import Link from "next/link";
import { loadGoLiveInput } from "@/lib/payments/timberland-golive-store";
import { buildGoLiveBoard, goLiveSummary, type GateTone } from "@/lib/payments/timberland-golive-core";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";

const TONE: Record<GateTone, { mark: string; cls: string; word: string }> = {
  green: { mark: "\u2713", cls: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200", word: "Done" },
  red: { mark: "!", cls: "border-red-500/30 bg-red-500/[0.06] text-red-200", word: "To do" },
  info: { mark: "i", cls: "border-sky-500/30 bg-sky-500/[0.06] text-sky-200", word: "Information" },
  unread: { mark: "?", cls: "border-amber-500/30 bg-amber-500/[0.06] text-amber-200", word: "Could not be read" },
};

export async function GoLiveBoard({ today, now }: { today: string; now: Date }) {
  const input = await loadGoLiveInput(today, now);
  const gates = buildGoLiveBoard(input);
  const sum = goLiveSummary(gates);
  return (
    <section id="go-live" className={card} aria-labelledby="go-live-title">
      <h2 id="go-live-title" className="mb-2 text-base font-semibold text-white">Go-live readiness</h2>
      <p className="mb-3 text-sm text-white/70" data-golive-summary>
        {sum.line} ({sum.green} done, {sum.red} to do, {sum.unread} could not be read, {sum.info} information)
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {gates.map((g) => {
          const t = TONE[g.tone];
          return (
            <li key={g.id} data-gate={g.id} data-tone={g.tone} className={`rounded-[var(--admin-radius)] border px-3 py-2 text-sm ${t.cls}`}>
              <p className="font-semibold">
                <span aria-hidden="true">{t.mark}</span> {g.title} <span className="sr-only">({t.word})</span>
              </p>
              <p className="mt-1 text-white/70">{g.detail}</p>
              <Link href={g.href} className="mt-1 inline-block text-xs font-semibold underline underline-offset-2">
                {g.hrefLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
