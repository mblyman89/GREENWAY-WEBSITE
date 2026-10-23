/**
 * CultiveraAutoStartPanel  (R74 S13)
 *
 * "Automatic onboarding start" on the Rebuild manifests and Coverage pages:
 * the status of the automatic Start for this import's rebuilt manifests, the
 * failures by name, and (for inventory managers) Start onboarding now / Pause.
 * Read-only for everyone else. An unreadable state is shown as an error,
 * never as "nothing to do".
 */
import Link from "next/link";
import { CHIP_ACTION, CHIP_NEUTRAL } from "@/components/admin/ui";
import { loadAutoStartStatus } from "@/lib/inventory/cultivera-auto-start";
import type { AutoStartPage } from "@/lib/inventory/cultivera-auto-start-core";
import { pauseAutoStartAction, startAutoNowAction } from "@/app/admin/menu-imports/auto-start-actions";

const TONE: Record<string, string> = {
  good: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  warn: "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 text-[var(--admin-gold)]",
  bad: "border-red-500/50 bg-red-500/10 text-red-200",
  muted: "border-white/10 bg-white/5 text-white/70",
};

export async function CultiveraAutoStartPanel({ importId, page, canApply }: { importId: string; page: AutoStartPage; canApply: boolean }) {
  const st = await loadAutoStartStatus(importId);
  return (
    <section id="auto-start" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="auto-start">
      <h2 className="text-sm font-semibold text-white">Automatic onboarding start</h2>
      <p className="mt-1 max-w-3xl text-xs text-white/50">
        After Apply rebuild or Apply the email step, every rebuilt manifest of this import that has no onboarding rows yet is
        started automatically - the same Start as the button on each manifest (vendor lab results, onboarding rows, lab
        certificates, knowledge base, Cultivera potency). The every-minute worker keeps going after you close the page. Nothing
        changes stock, prices or the live menu.
      </p>
      {!st.ok ? (
        <p className={`mt-3 rounded-lg border px-4 py-3 text-sm ${TONE.bad}`} data-testid="auto-start-error">
          {st.error}
        </p>
      ) : (
        <>
          <p className={`mt-3 rounded-lg border px-4 py-3 text-sm ${TONE[st.tone]}`} data-testid="auto-start-status">
            {st.text}
          </p>
          {st.lastNote && (
            <p className="mt-2 text-xs text-white/60" data-testid="auto-start-last">
              Last run{st.lastRunAt ? ` (${st.lastRunAt.replace("T", " ").slice(0, 16)} UTC)` : ""}: {st.lastNote}
            </p>
          )}
          {st.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-300" data-testid="auto-start-failures">
              {st.errors.map((e, i) => (
                <li key={`${i}-${e}`}>{e}</li>
              ))}
            </ul>
          )}
          {canApply ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <form action={startAutoNowAction}>
                <input type="hidden" name="importId" value={importId} />
                <input type="hidden" name="from" value={page} />
                <button type="submit" className={CHIP_ACTION} data-testid="auto-start-run">
                  Start onboarding now
                </button>
              </form>
              {st.armed && !st.paused && (
                <form action={pauseAutoStartAction}>
                  <input type="hidden" name="importId" value={importId} />
                  <input type="hidden" name="from" value={page} />
                  <button type="submit" className={CHIP_NEUTRAL} data-testid="auto-start-pause">
                    Pause
                  </button>
                </form>
              )}
              <Link href="/admin/inventory/drafts?cv_vendors=1#cultivera-vendor" className="text-xs text-[var(--admin-accent)] underline">
                Open Product Onboarding by vendor →
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-xs text-white/40">Starting or pausing needs the inventory manager permission.</p>
          )}
        </>
      )}
    </section>
  );
}
