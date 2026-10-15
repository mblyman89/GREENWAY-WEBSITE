/**
 * R41 S7: "First file to Timberland" on the ACH guide (#first-payroll).
 *
 * Two parts, both read-only:
 *   1. Is live ACH unlocked? The same first-file gate every release checks
 *      (readFirstFileGate -> firstFileGate). A read error is shown as an
 *      error, never as unlocked.
 *   2. The backwards plan (slice plan section 3.7) for whatever first payday
 *      the owner types: the prenote upload day, its settlement, the section 6
 *      wait, and the live upload day. A GET form, so it never writes.
 *
 * Timberland agreement section 6: "it agrees not to initiate live dollar
 * Entries until at least 6 banking days following the settlement date of the
 * prenotification Entry."
 */
import Link from "next/link";
import { readFirstFileGate } from "@/lib/payments/ach-file-ledger-store";
import { checkFirstPayday, PRENOTE_WAIT_WORDS } from "@/lib/payments/timberland-prenote-core";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-4";
const btnPrimary = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";
const inputCls =
  "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";

export async function FirstFileToTimberland({ today, firstPayday, now }: { today: string; firstPayday: string | undefined; now: Date }) {
  const gate = await readFirstFileGate(today);
  const typed = (firstPayday ?? "").slice(0, 10);
  const check = checkFirstPayday(typed || null, now);
  return (
    <section id="first-payroll" className={card} aria-labelledby="first-payroll-title">
      <h2 id="first-payroll-title" className="mb-3 text-base font-semibold text-white">First file to Timberland</h2>
      <p className="mb-3 text-sm text-white/70">
        Your first file to Timberland is a prenote file: a $0 test for each account that moves no money. Live payroll, vendor and test-credit files stay locked until
        that file is approved at Timberland, {PRENOTE_WAIT_WORDS} pass, and a prenote from it is marked passed.
      </p>

      {!gate.ok ? (
        <p role="alert" className="mb-4 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-200">{gate.error}</p>
      ) : gate.gate.open ? (
        <p className="mb-4 rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-2 text-sm font-semibold text-emerald-300">✓ {gate.gate.line}</p>
      ) : (
        <div role="status" className="mb-4 rounded-[var(--admin-radius)] border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-100">
          <p>{gate.gate.line}</p>
          <p className="mt-2 flex flex-wrap gap-3 text-xs">
            <Link href="/admin/settings/banking/operations#checks" className="font-semibold text-emerald-300 underline">Account checks →</Link>
            <Link href="/admin/settings/banking/files" className="font-semibold text-emerald-300 underline">ACH files →</Link>
          </p>
        </div>
      )}

      <form method="get" action="/admin/settings/banking/guide#first-payroll" className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-white/80" htmlFor="first-payday">
          First payday by direct deposit
          <input id="first-payday" name="firstPayday" type="date" defaultValue={typed} className={`ml-2 ${inputCls}`} />
        </label>
        <button className={btnPrimary}>Plan it</button>
      </form>

      {typed === "" ? (
        <p className="mt-3 text-sm text-white/60">The earliest first payday that still works today is <span className="font-semibold text-white">{check.ok ? check.plan.payday : check.earliestPayday}</span>.</p>
      ) : check.ok ? (
        <div className="mt-3 text-sm text-white/85">
          {check.warning ? <p role="alert" className="mb-2 font-semibold text-amber-300">{check.warning}</p> : null}
          <ol className="list-none space-y-1">
            {check.plan.lines.map((l) => <li key={l}>{l}</li>)}
          </ol>
        </div>
      ) : (
        <div role="alert" className="mt-3 rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-200">
          <p>{check.error}</p>
          {check.plan ? (
            <ol className="mt-2 list-none space-y-1 text-red-100/80">
              {check.plan.lines.map((l) => <li key={l}>{l}</li>)}
            </ol>
          ) : null}
        </div>
      )}
      <p className="mt-3 text-xs text-white/40">
        Days count only banking days Timberland can use. A Friday before a Saturday bank holiday is not counted until Timberland confirms it (question 9). Payday never waits: anyone not ready is paid by check.
      </p>
    </section>
  );
}
