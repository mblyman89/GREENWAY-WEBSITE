"use client";

/**
 * ErrorTriagePanel (Task W) — paste the CCRS error email, get a plain-language
 * triage (benign vs fixable vs escalate) with concrete fix steps, and a
 * DRAFTS-ONLY escalation email to examiner@lcb.wa.gov (mailto: draft the owner
 * reviews and sends — never auto-sent, per the standing drafts-only rule).
 *
 * The triage logic is the pure ccrs-error-triage-core (self-tested), so this
 * panel is instant and needs no server round-trip and no AI key.
 */
import { useMemo, useState } from "react";
import {
  triageCcrsErrorEmail,
  buildExaminerDraft,
  LCB_CONTACTS,
} from "@/lib/compliance/ccrs-error-triage-core";

type Props = {
  licenseNumber: string;
  licenseeName: string;
  weekStart: string;
  weekEnd: string;
  fileTypes: string[];
};

const SEVERITY_STYLE: Record<string, string> = {
  benign: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  fixable: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  escalate: "border-red-400/30 bg-red-400/10 text-red-200",
};

const SEVERITY_LABEL: Record<string, string> = {
  benign: "Benign — no action",
  fixable: "Fixable — follow the steps",
  escalate: "Escalate to the LCB",
};

export function ErrorTriagePanel({ licenseNumber, licenseeName, weekStart, weekEnd, fileTypes }: Props) {
  const [pasted, setPasted] = useState("");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => (pasted.trim() ? triageCcrsErrorEmail(pasted) : null), [pasted]);

  const draft = useMemo(() => {
    if (!result || !result.suggestEscalation) return null;
    return buildExaminerDraft({
      licenseNumber,
      licenseeName,
      weekStart,
      weekEnd,
      fileTypes,
      errorExcerpt: pasted,
    });
  }, [result, pasted, licenseNumber, licenseeName, weekStart, weekEnd, fileTypes]);

  const mailto = draft
    ? `mailto:${draft.to}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
    : null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="mb-3">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/80">
          Error-email triage
        </h2>
        <p className="mt-1 text-xs text-white/40">
          CCRS reports problems by email after an upload. Paste the error email below — recognized
          errors get plain-language fix steps instantly; anything unresolvable gets a ready-made
          DRAFT to {LCB_CONTACTS.examiner} (you review and send it — nothing is sent automatically).
        </p>
      </div>

      <textarea
        value={pasted}
        onChange={(e) => {
          setPasted(e.target.value);
          setCopied(false);
        }}
        rows={5}
        placeholder="Paste the CCRS error email text here…"
        className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/80 placeholder:text-white/25 focus:border-[var(--admin-accent)] focus:outline-none"
      />

      {result ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-relaxed text-white/70">{result.summary}</p>

          {result.findings.map((f) => (
            <div key={f.ruleId} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[f.severity]}`}
                >
                  {SEVERITY_LABEL[f.severity]}
                </span>
                <span className="text-[11px] text-white/40">matched: “{f.matched}”</span>
              </div>
              <p className="mt-2 text-xs text-white/70">{f.meaning}</p>
              {f.fixSteps.length > 0 ? (
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-white/60">
                  {f.fixSteps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ))}

          {result.unrecognized.length > 0 ? (
            <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3">
              <p className="text-xs font-semibold text-red-200">
                Unrecognized error line(s) — candidate for escalation:
              </p>
              <ul className="mt-1 space-y-1 text-xs text-white/60">
                {result.unrecognized.map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {draft && mailto ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-xs font-semibold text-white/80">
                Escalation draft (to {draft.to}) — review, attach the CSV file(s), forward the
                original CCRS error email, then send:
              </p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-[11px] leading-relaxed text-white/60">
                {`Subject: ${draft.subject}\n\n${draft.body}`}
              </pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={mailto}
                  className="rounded-lg bg-[var(--admin-accent)] px-3 py-1.5 text-xs font-bold text-black transition hover:opacity-90"
                >
                  Open as email draft
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
                      setCopied(true);
                    } catch {
                      /* clipboard unavailable */
                    }
                  }}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/5"
                >
                  {copied ? "✓ Copied" : "Copy draft"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-white/35">
          Common outcomes: “Duplicate Strain” is benign (no action). Fixable errors are corrected in
          the original file and re-uploaded with a matching NumberRecords. Tech/SAW problems go to{" "}
          {LCB_CONTACTS.serviceDesk} (360-664-1776).
        </p>
      )}
    </section>
  );
}
