/**
 * D250 S4: the late weeks, and for the selected one a single verdict with the
 * exact steps (ccrs-late-weeks-core). Server component, no client state.
 */
import Link from "next/link";
import type { LateWeekReadiness } from "@/lib/compliance/ccrs-late-weeks-core";

const TONE: Record<LateWeekReadiness["verdict"], string> = {
  ready: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  recorded: "border-white/10 bg-white/5 text-white/70",
  "load-delivery": "border-amber-400/30 bg-amber-400/10 text-amber-100",
  "answer-waiting": "border-amber-400/30 bg-amber-400/10 text-amber-100",
  "fix-errors": "border-red-400/30 bg-red-400/10 text-red-100",
  "not-built": "border-red-400/30 bg-red-400/10 text-red-100",
};

export function CcrsLateWeeksPanel({
  late,
  selectedKey,
  readiness,
  linkFor,
}: {
  late: readonly { key: string; start: string; end: string; due: string }[];
  selectedKey: string;
  readiness: LateWeekReadiness | null;
  linkFor: (key: string) => string;
}) {
  return (
    <div className="space-y-3 text-xs" data-testid="ccrs-late-weeks">
      {late.length === 0 ? (
        <p className="text-white/50">No completed week is waiting to be uploaded.</p>
      ) : (
        <ol className="flex flex-wrap gap-2">
          {late.map((w, i) => (
            <li key={w.key}>
              <Link
                href={linkFor(w.key)}
                className={`inline-block rounded-xl border px-3 py-2 ${w.key === selectedKey ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10" : "border-white/10 bg-black/20 hover:bg-white/5"}`}
              >
                <span className="font-bold text-white/80">
                  {i + 1}. {w.start} to {w.end}
                </span>
                <span className="ml-2 text-white/45">due {w.due}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {late.length > 1 ? <p className="text-white/45">Upload them oldest first, one week at a time: each week&apos;s files are complete only after the week before is answered.</p> : null}
      {readiness ? (
        <div className={`rounded-xl border px-4 py-3 ${TONE[readiness.verdict]}`} data-testid="ccrs-late-week-verdict" data-verdict={readiness.verdict}>
          <p className="font-semibold">{readiness.headline}</p>
          {readiness.steps.length > 0 ? (
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {readiness.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : null}
          {readiness.notes.map((n, i) => (
            <p key={i} className="mt-2 text-[11px] opacity-80">
              {n}
            </p>
          ))}
        </div>
      ) : null}
      {readiness && readiness.groups.length > 0 ? (
        <div className="space-y-1">
          <p className="font-semibold text-white/70">
            Held with a reason ({readiness.heldTotal}){readiness.unnamed > 0 ? `, ${readiness.unnamed} WITHOUT a reason` : ""}:
          </p>
          {readiness.groups.map((g) => (
            <details key={g.key} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <summary className="cursor-pointer text-white/75">
                {g.count} - {g.label}
                {g.releasedByLoad ? <span className="ml-2 rounded-full bg-sky-400/20 px-2 py-0.5 text-[10px] text-sky-100">released by the delivery load</span> : null}
              </summary>
              <p className="mt-1 text-white/55">{g.nextStep}</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-white/40">
                {g.examples.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
