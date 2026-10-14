/**
 * R41 S2: "What Timberland sees" on Banking > My banking.
 *
 * Shows the exact 1 and 5 records the next file will carry (built by the same
 * functions as buildNachaFile), the three names side by side (plan 3.1), the
 * funding account's last four, and the "Timberland confirmed on ___" stamp
 * with the confirm form (owner stamps; an admin's goes to the owner).
 */
import type { OriginatorReadiness, StampView } from "@/lib/payments/timberland-originator-core";
import { MIN_CONFIRM_NOTE_CHARS } from "@/lib/payments/timberland-originator-core";
import { THREE_NAMES, timberlandPreview } from "@/lib/payments/timberland-preview-core";
import { confirmTimberlandSetupAction } from "./actions";

const RULER = "1234567890".repeat(10).slice(0, 94);

function Rec({ title, rec, fields }: { title: string; rec: string; fields: { from: number; to: number; label: string; value: string }[] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/50">{title}</p>
      <pre className="overflow-x-auto rounded border border-white/10 bg-black/40 p-2 font-mono text-[11px] leading-5 text-emerald-200">
        <span className="text-white/25">{RULER}</span>
        {"\n"}
        {rec.replace(/ /g, "\u00b7")}
      </pre>
      <table className="w-full text-xs">
        <tbody>
          {fields.map((f) => (
            <tr key={`${f.from}`} className="border-t border-white/5">
              <td className="py-1 pr-2 font-mono text-white/40">
                {f.from === f.to ? f.from : `${f.from}-${f.to}`}
              </td>
              <td className="py-1 pr-2 font-mono text-emerald-200">{f.value.replace(/ /g, "\u00b7")}</td>
              <td className="py-1 text-white/60">{f.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WhatTimberlandSeesCard({
  readiness,
  stampView,
  viewerIsOwner,
  canAct,
}: {
  readiness: OriginatorReadiness;
  stampView: StampView;
  viewerIsOwner: boolean;
  canAct: boolean;
}) {
  const preview = timberlandPreview(readiness.originator, new Date());
  const toneCls =
    stampView.tone === "green"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]";
  return (
    <section className="space-y-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5" aria-labelledby="wts-h">
      <div>
        <h2 id="wts-h" className="text-sm font-bold text-[var(--admin-text)]">What Timberland sees</h2>
        <p className="mt-1 text-xs text-white/60">
          Brenda at Timberland matches three things: the Company Name, the Company ID, and an unbalanced (credits-only) batch. Every file is checked
          against her setup before it can be downloaded; a file that does not match is refused.
        </p>
      </div>

      <div className={`rounded border px-3 py-2 text-sm ${toneCls}`} data-stamp={stampView.state}>
        {stampView.text}
      </div>

      {readiness.problems.length ? (
        <ul className="list-disc space-y-1 rounded border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 py-2 pl-8 pr-3 text-sm text-[var(--admin-danger)]">
          {readiness.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/50">Three names, on purpose</p>
        <table className="w-full text-sm">
          <tbody>
            {THREE_NAMES.map((n) => (
              <tr key={n.label} className="border-t border-white/5 align-top">
                <td className="py-1 pr-3 text-white/60">{n.label}</td>
                <td className="py-1 pr-3 font-mono text-white">{n.value}</td>
                <td className="py-1 text-xs text-white/50">{n.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-white/50">These differ and that is correct. Do not change one to match another.</p>
      </div>

      {preview.ok ? (
        <div className="grid gap-4">
          <Rec title="File header (1 record), as the next file will carry it" rec={preview.fileHeader} fields={preview.fileFields} />
          <Rec title="Batch header (5 record), payroll" rec={preview.batchHeader} fields={preview.batchFields} />
          <p className="text-xs text-white/60">{preview.accountLine} Dots mark spaces. The date and time in the header are today&apos;s.</p>
        </div>
      ) : (
        <p className="text-sm text-white/60">{preview.reason}</p>
      )}

      {canAct && readiness.ready ? (
        <form action={confirmTimberlandSetupAction} className="space-y-2 border-t border-white/10 pt-3">
          <label className="block text-sm text-white/80" htmlFor="confirm_note">
            Timberland confirmed these values. Who confirmed it, and how? (at least {MIN_CONFIRM_NOTE_CHARS} characters)
          </label>
          <input
            id="confirm_note"
            name="confirm_note"
            required
            minLength={MIN_CONFIRM_NOTE_CHARS}
            maxLength={500}
            placeholder="Brenda, email of 10/16"
            className="w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2 text-sm text-[var(--admin-text)]"
          />
          <button type="submit" className="rounded-[var(--admin-radius)] bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950">
            {viewerIsOwner ? "Record Timberland's confirmation" : "Send to Michael to record"}
          </button>
          <p className="text-xs text-white/50">
            Changing the routing number, Immediate Origin, company name, Company ID or Originating DFI clears this automatically.
          </p>
        </form>
      ) : null}
    </section>
  );
}
