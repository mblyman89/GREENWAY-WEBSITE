/**
 * /admin/atm/settings - ATM settings: the daily fill amount (D198i). OWNER ONLY (finances.view).
 *
 * Owner (2026-11-07, verbatim): "it should be a simple settings page in atm page in the lyman drop
 * down menu. from there I should be able to set a daily fill amount so it always starts the day off
 * with the same amount. it should be loud on the deposit bag page that the atm needs x amount to be
 * topped off properly."
 *
 * Simple on purpose: one amount, one Save. Around it, what an expert would want next to a cash
 * number: what the deposit bag page says with it RIGHT NOW (same pure function as the banner), who
 * changed it and when (Security Log), and where the other ATM rules live.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { getAtmDropSettings } from "@/lib/registers/atm-drop-settings-store";
import { getLatestAtmTerminalStatus } from "@/lib/atm/store";
import { atmTopOff, fillChangeSentence, MAX_DAILY_FILL_CENTS } from "@/lib/registers/atm-daily-fill-core";
import { atmLoadsSince, dailyFillHistory } from "@/lib/registers/atm-daily-fill-store";
import { saveAtmDailyFillAction } from "./actions";

export const dynamic = "force-dynamic";

const card = "rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.02] p-5";
const input =
  "w-full rounded-[var(--admin-radius)] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/50 focus:outline-none";
const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-white/50";
const btn = "rounded-[var(--admin-radius)] bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400";

const TONE_CLS = {
  danger: "border-red-500/40 bg-red-500/[0.08] text-red-200",
  warn: "border-amber-500/40 bg-amber-500/[0.08] text-amber-200",
  ok: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200",
  muted: "border-white/15 bg-white/[0.03] text-white/70",
} as const;

function money(cents: number | null): string {
  if (cents === null) return "not set";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function when(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function AtmSettingsPage({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  await requirePermission("finances.view");
  const sp = await searchParams;
  const settings = await getAtmDropSettings();
  const [status, history] = await Promise.all([getLatestAtmTerminalStatus(settings.terminalId), dailyFillHistory(25)]);
  const nowIso = new Date().toISOString();
  const pending = status?.capturedAt ? await atmLoadsSince(status.capturedAt, settings.terminalId) : null;
  const preview = atmTopOff({
    fillToCents: settings.fillToCents,
    reading: status ? { balanceCents: status.balanceCents, capturedAt: status.capturedAt } : null,
    pending: pending && pending.ok ? pending.items : [],
    nowIso,
    maxTwentiesPerLoad: settings.maxTwentiesPerDrop,
    terminalId: settings.terminalId,
  });

  return (
    <div>
      <AdminPageHeader
        title="ATM settings"
        subtitle="The daily fill amount: the cash the ATM should start every day with. Owner only."
        breadcrumbs={<Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "ATM", href: "/admin/atm" }, { label: "Settings" }]} />}
        help={
          <HelpPanel
            id="atm-settings"
            title="How the daily fill amount is used"
            steps={[
              "Set the cash you want in the ATM at the start of every day, in whole $20s (the ATM holds $20 bills only).",
              "Every morning the Deposit bags page reads the ATM's cash from PAI and shows a loud banner: the ATM needs $X (N x $20) to start the day at your amount, or that it is full.",
              "$20s already taken for the ATM since that reading (from the deposit bag or a till drop) are counted as loaded, so two people cannot top it off twice from one old reading.",
              "The morning employee takes the $20s out with \u201cTake $20s out of this deposit for the ATM\u201d, with a witness. Taking more than the banner says needs a written reason and is flagged for you on ATM Drops.",
            ]}
          >
            <p>Changing the amount never moves money or touches the books. Every change is written to the Security Log with who made it.</p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.msg ? (
          <div role="status" className="rounded-[var(--admin-radius)] border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300">{sp.msg}</div>
        ) : null}
        {sp.error ? (
          <div role="alert" className="rounded-[var(--admin-radius)] border border-red-500/30 bg-red-500/[0.06] px-4 py-3 text-sm font-semibold text-red-300">{sp.error}</div>
        ) : null}

        <section className={card} data-testid="atm-daily-fill">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Daily fill amount</h2>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-white">{money(settings.fillToCents)}</p>
          <p className="mt-1 text-xs text-white/45">
            ATM {settings.terminalId}. {settings.fillToCents === null ? "Not set: the Deposit bags page cannot say how much the ATM needs." : `${settings.fillToCents / 2000} x $20.`}
          </p>
          <form action={saveAtmDailyFillAction} className="mt-4 grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
            <input type="hidden" name="seen_cents" value={settings.fillToCents === null ? "" : String(settings.fillToCents)} />
            <div>
              <label className={label} htmlFor="daily_fill">New amount ($, whole $20s)</label>
              <input
                id="daily_fill"
                name="daily_fill"
                type="number"
                inputMode="numeric"
                min={20}
                max={MAX_DAILY_FILL_CENTS / 100}
                step={20}
                placeholder="e.g. 4000"
                defaultValue={settings.fillToCents === null ? "" : settings.fillToCents / 100}
                className={input}
              />
            </div>
            <div>
              <label className={label} htmlFor="note">Note (optional, goes in the Security Log)</label>
              <input id="note" name="note" maxLength={300} placeholder="e.g. holiday weekend, raising for Friday" className={input} />
            </div>
            <button className={btn}>Save</button>
          </form>
          <p className="mt-2 text-xs text-white/45">Leave the amount blank and save to clear it. The ATM takes $20 bills only, so any other amount is refused, never rounded.</p>
        </section>

        <section className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">What the Deposit bags page says right now</h2>
          <div className={`mt-3 rounded-[var(--admin-radius)] border px-4 py-3 ${TONE_CLS[preview.tone]}`}>
            <p className="text-base font-semibold">{preview.headline}</p>
            <p className="mt-1 text-xs opacity-80">{preview.detail}</p>
          </div>
          {pending && !pending.ok ? <p className="mt-2 text-xs text-amber-300">$20s taken since the reading could not be checked: {pending.error}</p> : null}
          {pending && pending.ok && pending.notes.length ? <p className="mt-2 text-xs text-amber-300">{pending.notes.join(" ")}</p> : null}
          <p className="mt-2 text-xs text-white/45">
            From the last stored PAI reading. The morning employee presses &ldquo;Cash in the ATM&rdquo; on{" "}
            <Link className="underline" href="/admin/registers/deposit-bags">Deposit bags</Link> for a live one.
          </p>
        </section>

        <section className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Change history</h2>
          {!history.ok ? (
            <p className="mt-2 text-xs text-amber-300">The history could not be read: {history.error}. This is not the same as no changes.</p>
          ) : history.changes.length === 0 ? (
            <p className="mt-2 text-xs text-white/45">No changes recorded on this page yet.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs text-white/70">
              {history.changes.map((c) => (
                <li key={c.atIso + (c.byEmail ?? "")}>
                  {when(c.atIso)} &middot; {c.byEmail ?? "owner"} &middot; {fillChangeSentence(c.beforeCents, c.afterCents)}
                  {c.note ? ` \u201c${c.note}\u201d` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-white/45">Also in the <Link className="underline" href="/admin/audit">Security Log</Link>. It cannot be edited.</p>
        </section>

        <section className={card}>
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/70">Other ATM rules</h2>
          <p className="mt-1 text-xs text-white/60">
            Register ATM drops {settings.enabled ? "ON" : "OFF"} &middot; terminal {settings.terminalId} &middot; witness {settings.witness} &middot; max{" "}
            {settings.maxTwentiesPerDrop} x $20 per load &middot; match window {settings.matchWindowMinutes} min.{" "}
            <Link className="underline" href="/admin/atm/drops#settings">Change on ATM Drops</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
