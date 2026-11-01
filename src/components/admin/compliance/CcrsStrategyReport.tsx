/**
 * S-18b: the strategy report for one CCRS error email. Server component (no hooks).
 *
 * Every word comes from buildCcrsStrategy (ccrs-strategy-core, pure, tested).
 * The examiner email is a DRAFT: a mailto link the owner opens, reads and sends
 * (AGENTS rule 3). Nothing here writes anything.
 */
import type { CcrsStrategy } from "@/lib/compliance/ccrs-strategy-core";

const SCOPE_LABEL: Record<CcrsStrategy["files"][number]["scope"], string> = {
  none: "nothing to fix",
  "listed-rows": "re-send only the listed rows",
  "whole-file": "whole file refused: re-send it",
  unknown: "a CCRS message the hub has not met yet: read CCRS's words below; an examiner draft is ready if you want one",
};

export function CcrsStrategyReport({ strategy }: { strategy: CcrsStrategy }) {
  const d = strategy.examinerDraft;
  const mailto = d ? `mailto:${d.to}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}` : null;
  return (
    <details className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.05] p-2" data-testid="ccrs-strategy" open>
      <summary className="cursor-pointer font-bold text-emerald-100">Strategy report: {strategy.headline}</summary>
      {strategy.resendOrder.length ? (
        <p className="mt-1" data-testid="ccrs-strategy-order">
          Re-send order: {strategy.resendOrder.join(" \u2192 ")}
        </p>
      ) : null}
      {strategy.files.map((f) => (
        <div key={f.filename} className="mt-2" data-testid="ccrs-strategy-file" data-scope={f.scope}>
          <p className="font-semibold text-white/85">
            {f.filename} ({f.fileType ?? "type unknown"}): {SCOPE_LABEL[f.scope]}
          </p>
          {f.findings.map((x) => (
            <div key={x.message} className="ml-3 mt-1">
              <p>
                <span className="text-white/90">{x.message}</span> ({x.rows} row{x.rows === 1 ? "" : "s"}
                {x.ids.length ? `: ${x.ids.slice(0, 10).join(", ")}${x.ids.length > 10 ? ", \u2026" : ""}` : ""}
                {x.unreadableIds ? `; ${x.unreadableIds} id(s) unreadable, the row is shifted` : ""})
              </p>
              {x.entry ? (
                <>
                  <p className="text-white/60">
                    {x.entry.meaning} <span className="text-white/35">{x.entry.cite.join(" ")}</span>
                  </p>
                  <ol className="ml-5 list-decimal text-white/70">
                    {x.entry.fix.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="text-amber-100">CCRS has never sent this message before. There is no verified fix; use the examiner draft below.</p>
              )}
            </div>
          ))}
        </div>
      ))}
      {strategy.notes.map((n) => (
        <p key={n} className="mt-2 text-white/45">
          {n}
        </p>
      ))}
      {d && mailto ? (
        <div className="mt-2" data-testid="ccrs-strategy-examiner">
          <p className="text-amber-100">Why ask the examiner: {strategy.examinerReasons.join("; ")}.</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px] text-white/60">{`To: ${d.to}\nSubject: ${d.subject}\n\n${d.body}`}</pre>
          <a href={mailto} className="mt-1 inline-block rounded bg-white/10 px-2 py-1 text-white/85 underline">
            Open the draft in my email (attach the CSV and forward the CCRS email before sending)
          </a>
        </div>
      ) : null}
    </details>
  );
}
