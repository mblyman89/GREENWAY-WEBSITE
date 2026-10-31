/**
 * EndorsementSwitchPanel — slice A-06 (owner OD-40), server component.
 *
 * Two owner switches on /admin/medical:
 *   1. Store medical endorsement (the ONE switch every register, the
 *      completion gate, the sync refusal, Leafly and the tax reports read).
 *      Turning it ON needs the endorsement number, the effective date, the
 *      checklist acknowledgement and the typed word ENDORSED. Turning it OFF
 *      needs one click: it only ever puts tax back on.
 *   2. Register medical test mode. OFF (default) hides the "medical test mode"
 *      menu item on every register and switches it off on any register that
 *      had it on, the next time that register refreshes its menu.
 *
 * Plain <form> posts to a server action: works without client JavaScript.
 * Non-owners see the state, read-only.
 */
import { Badge } from "@/components/admin/ui";
import { saveEndorsementSwitchAction } from "@/app/admin/medical/actions";
import { ENDORSE_CONFIRM_WORD, type EndorsementState } from "@/lib/medical/endorsement-switch-core";

const BTN =
  "inline-flex items-center justify-center rounded-[var(--admin-radius-md,0.5rem)] px-3 py-2 text-xs font-semibold transition-colors";
const BTN_ON = `${BTN} bg-[var(--admin-green,#16a34a)] text-white hover:opacity-90`;
const BTN_OFF = `${BTN} border border-red-400/40 bg-red-400/10 text-red-200 hover:bg-red-400/20`;
const BTN_NEUTRAL = `${BTN} border border-[var(--admin-border)] bg-[var(--admin-surface-raised,transparent)] text-white/80 hover:bg-white/5`;
const INPUT =
  "w-full rounded-[var(--admin-radius-md,0.5rem)] border border-[var(--admin-border)] bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/30";

export function EndorsementSwitchPanel({
  state,
  isOwner,
  today,
  okMessage,
  errorMessage,
}: {
  state: EndorsementState;
  isOwner: boolean;
  today: string;
  okMessage: string | null;
  errorMessage: string | null;
}) {
  const pendingFuture = state.switchOn && !state.isMedicallyEndorsed && !!state.effectiveOn && state.effectiveOn > today;

  return (
    <section
      id="endorsement"
      className="scroll-mt-24 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Store medical endorsement</h2>
        {state.isMedicallyEndorsed ? (
          <Badge tone="green">Endorsed</Badge>
        ) : pendingFuture ? (
          <Badge tone="gold">Scheduled — starts {state.effectiveOn}</Badge>
        ) : (
          <Badge tone="danger">Not endorsed — exemptions disabled</Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-white/50">
        {state.endorsementNumber ? `Endorsement ${state.endorsementNumber}. ` : ""}
        {state.effectiveOn ? `Effective ${state.effectiveOn}. ` : ""}
        37% excise exemption effective through {state.exciseExemptionUntil} (WAC 314-55-090(6)).
        {!state.isMedicallyEndorsed && state.notEndorsedReason ? ` ${state.notEndorsedReason}` : ""}
      </p>

      {okMessage ? (
        <p role="status" className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
          ✓ {okMessage}
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          {errorMessage}
        </p>
      ) : null}
      {state.migrationPending ? (
        <p role="alert" className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          Database migration <strong>0329_medical_endorsement_switch.sql</strong> has not been applied yet. Until it
          is, the store is treated as NOT endorsed, register test mode is hidden, and these switches cannot be saved.
        </p>
      ) : null}

      {!isOwner ? (
        <p className="mt-3 text-xs text-white/40">Only the owner can change these switches.</p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* 1. Endorsement switch */}
        <div className="rounded-xl border border-[var(--admin-border)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Medical endorsement switch</h3>
            <span className={`text-xs font-bold ${state.switchOn ? "text-emerald-300" : "text-white/50"}`}>
              {state.switchOn ? "ON" : "OFF"}
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            Controls whether medical tax exemptions can apply on the registers, the website estimate and Leafly.
          </p>

          {isOwner && state.switchOn ? (
            <form action={saveEndorsementSwitchAction} className="mt-3">
              <input type="hidden" name="switch_kind" value="endorsement" />
              <input type="hidden" name="on" value="0" />
              <button type="submit" className={BTN_OFF}>
                Turn endorsement OFF
              </button>
              <p className="mt-2 text-[11px] text-white/40">
                Turning it off puts full tax back on every sale immediately. The number and date stay on file.
              </p>
            </form>
          ) : null}

          {isOwner && !state.switchOn ? (
            <form action={saveEndorsementSwitchAction} className="mt-3 space-y-3">
              <input type="hidden" name="switch_kind" value="endorsement" />
              <input type="hidden" name="on" value="1" />
              <label className="block text-xs text-white/70">
                Endorsement number (from your LCB endorsement)
                <input
                  name="endorsement_number"
                  required
                  maxLength={40}
                  defaultValue={state.endorsementNumber ?? ""}
                  className={`${INPUT} mt-1`}
                  autoComplete="off"
                />
              </label>
              <label className="block text-xs text-white/70">
                Effective date
                <input
                  type="date"
                  name="effective_on"
                  required
                  defaultValue={state.effectiveOn ?? ""}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-[11px] leading-relaxed text-amber-100/80">
                <p className="font-semibold text-amber-200">Before you turn it on, confirm:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>The LCB has actually issued your medical endorsement (RCW 69.50.375).</li>
                  <li>A certified medical cannabis consultant is on staff to issue recognition cards.</li>
                  <li>
                    DOH-compliant products are registered below; only those qualify for exemptions (WAC 246-70-040).
                  </li>
                  <li>
                    The books are not ready yet: master-plan slice B-02 (medical-exempt lines in the general ledger)
                    must ship before real exempt sales, or the ledger will over-accrue tax.
                  </li>
                  <li>
                    CCRS still reports every product as IsMedical = FALSE (CCRS bible decision D-03). Exempt sales
                    need the CCRS medical slice (S-10) before they are reported.
                  </li>
                </ul>
              </div>
              <label className="flex items-start gap-2 text-xs text-white/70">
                <input type="checkbox" name="acknowledged" className="mt-0.5 accent-[var(--admin-accent)]" />
                <span>I have read the checklist above.</span>
              </label>
              <label className="block text-xs text-white/70">
                Type <strong className="font-mono text-white">{ENDORSE_CONFIRM_WORD}</strong> to confirm
                <input name="confirm_word" required autoComplete="off" className={`${INPUT} mt-1 font-mono`} />
              </label>
              <button type="submit" className={BTN_ON}>
                Turn endorsement ON
              </button>
            </form>
          ) : null}
        </div>

        {/* 2. Register test-mode switch */}
        <div className="rounded-xl border border-[var(--admin-border)] p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Register medical test mode</h3>
            <span className={`text-xs font-bold ${state.testModeAllowed ? "text-amber-300" : "text-white/50"}`}>
              {state.testModeAllowed ? "AVAILABLE" : "HIDDEN"}
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            When HIDDEN, no register shows the “medical test mode” option, and any register that had it on switches it
            off the next time it refreshes its menu. When AVAILABLE, each register can turn it on from its MORE menu to
            rehearse a medical sale. Even then a test sale can never be paid if tax came off.
          </p>
          {state.isMedicallyEndorsed ? (
            <p className="mt-2 text-[11px] text-white/40">
              The store is endorsed, so there is nothing to simulate and test mode stays hidden.
            </p>
          ) : null}
          {isOwner && !state.isMedicallyEndorsed ? (
            <form action={saveEndorsementSwitchAction} className="mt-3">
              <input type="hidden" name="switch_kind" value="test_mode" />
              <input type="hidden" name="on" value={state.testModeSwitchOn ? "0" : "1"} />
              <button type="submit" className={state.testModeSwitchOn ? BTN_NEUTRAL : BTN_ON}>
                {state.testModeSwitchOn ? "Hide test mode on every register" : "Make test mode available on registers"}
              </button>
            </form>
          ) : null}
          <p className="mt-2 text-[11px] text-white/40">
            Registers pick up a change when they refresh their menu (open the register, or MORE ▸ refresh menu).
          </p>
        </div>
      </div>
    </section>
  );
}
