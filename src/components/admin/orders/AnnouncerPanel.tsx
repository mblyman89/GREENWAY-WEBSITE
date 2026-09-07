/**
 * src/components/admin/orders/AnnouncerPanel.tsx
 *
 * SLICE 30 — the Announcer panel on the Orders page.
 *
 * A SERVER component. Every judgement it renders was already made by the pure
 * code in announcer-admin-core.ts, so this file is layout only: no health
 * arithmetic, no timezone maths, no "is it online" logic inline in JSX.
 *
 * WHAT THIS SCREEN IS FOR
 * -----------------------
 * It answers, in this order, the three questions someone actually has:
 *
 *   1. "Will I hear the next order?"  -> the verdict banner, one sentence.
 *   2. "Which room is broken?"        -> one card per speaker, with the fix.
 *   3. "Did the last one play?"       -> the activity log.
 *
 * The verdict comes first and is the biggest thing on screen because it is the
 * only question that matters when you are busy. Every unhappy state carries the
 * fix next to it, in plain English, so nobody has to remember anything.
 */
import { Button } from "@/components/admin/ui/Button";
import { getAnnouncerPanelData } from "@/lib/announcer/announcer-admin-store";
import { listSounds } from "@/lib/announcer/announcer-sounds-store";
import { optionsForSounds } from "@/lib/announcer/announcer-library-core";
import { AnnouncerSoundLibrary } from "@/components/admin/orders/AnnouncerSoundLibrary";
import type { AdminDeviceView, ShopVerdict } from "@/lib/announcer/announcer-admin-core";
import {
  announcerCreatePairingAction,
  announcerRemoveDeviceAction,
  announcerTestAllAction,
  announcerToggleDeviceAction,
  announcerUpdateDeviceAction,
  announcerUpdateSettingsAction,
} from "@/app/admin/orders/announcer-actions";

const DOT: Record<AdminDeviceView["tone"], string> = {
  good: "bg-[var(--admin-accent)]",
  warn: "bg-[var(--admin-warning,#d99a2b)]",
  bad: "bg-[var(--admin-danger)]",
  idle: "bg-[var(--admin-text-faint)]",
};

const VERDICT_FRAME: Record<ShopVerdict["tone"], string> = {
  good: "border-[var(--admin-accent)]/50 bg-[var(--admin-accent)]/10",
  warn: "border-[var(--admin-warning,#d99a2b)]/50 bg-[var(--admin-warning,#d99a2b)]/10",
  bad: "border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)]",
};

const VERDICT_ICON: Record<ShopVerdict["tone"], string> = {
  good: "🔊",
  warn: "⚠️",
  bad: "🔇",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-text-muted)]">
        {label}
      </span>
      {children}
      {hint ? <span className="text-[0.68rem] text-[var(--admin-text-faint)]">{hint}</span> : null}
    </label>
  );
}

const INPUT_CLS =
  "admin-focus rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-2.5 py-1.5 text-sm text-[var(--admin-text)]";

export async function AnnouncerPanel() {
  const data = await getAnnouncerPanelData();
  const { devices, settings, verdict, recent, notInstalled, assignments } = data;

  // SLICE 34 — uploaded sounds must appear in the same pickers as the built-in
  // ones, otherwise a file can be uploaded but never actually used. The values
  // are storage paths, which is exactly what the Pi agent expects.
  const library = await listSounds();
  const soundOptions = optionsForSounds(library.sounds);

  // The migration has not been run. This is a setup state, not a fault, so it
  // says exactly what to do rather than showing an error.
  if (notInstalled) {
    return (
      <section className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-4">
        <h2 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--admin-text)]">
          🔊 Order Announcer
        </h2>
        <p className="mt-2 text-sm text-[var(--admin-text-muted)]">
          The announcer tables are not in the database yet. Run migration{" "}
          <code className="rounded bg-black/30 px-1">0222_order_announcer.sql</code> in the Supabase
          SQL editor, then refresh this page. Nothing else on this screen is affected.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)]">
      {/* ── 1. THE ONLY QUESTION THAT MATTERS ───────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--admin-border)] px-4 py-3">
        <h2 className="text-sm font-black uppercase tracking-[0.08em] text-[var(--admin-text)]">
          🔊 Order Announcer
        </h2>
        <span className="text-xs text-[var(--admin-text-muted)]">
          {verdict.onlineCount} of {verdict.totalCount} speaker
          {verdict.totalCount === 1 ? "" : "s"} online
        </span>
        <div className="ml-auto flex items-center gap-2">
          <form action={announcerTestAllAction}>
            <Button type="submit" variant="primary" size="sm">
              ▶ Test all speakers
            </Button>
          </form>
        </div>
      </div>

      <div className="px-4 py-4">
        <div className={`rounded-[var(--admin-radius-lg)] border px-4 py-3 ${VERDICT_FRAME[verdict.tone]}`}>
          <p className="flex items-start gap-2 text-sm font-bold text-[var(--admin-text)]">
            <span aria-hidden>{VERDICT_ICON[verdict.tone]}</span>
            <span>{verdict.headline}</span>
          </p>
          {verdict.fix ? (
            <p className="mt-1.5 pl-6 text-xs text-[var(--admin-text-muted)]">
              <strong className="text-[var(--admin-text)]">What to do: </strong>
              {verdict.fix}
            </p>
          ) : null}
        </div>

        {/* ── 2. ONE CARD PER ROOM ──────────────────────────────────────── */}
        {devices.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {devices.map((d) => (
              <article
                key={d.id}
                className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3.5 py-3"
              >
                <header className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[d.tone]}`} aria-hidden />
                  <h3 className="truncate text-sm font-bold text-[var(--admin-text)]">{d.name}</h3>
                  <span className="ml-auto shrink-0 text-[0.68rem] font-bold uppercase tracking-[0.06em] text-[var(--admin-text-muted)]">
                    {d.mutedByChoice ? "Switched off" : d.healthLabel}
                  </span>
                </header>

                <p className="mt-1 text-[0.68rem] text-[var(--admin-text-faint)]">
                  Last heard from {d.lastSeenLabel} · {d.soundLabel} · volume {d.volume}%
                </p>

                {/* The fix travels with the problem. */}
                {d.tone !== "good" && !d.mutedByChoice ? (
                  <p className="mt-2 rounded border border-[var(--admin-border)] bg-black/20 px-2 py-1.5 text-[0.68rem] text-[var(--admin-text-muted)]">
                    {d.nextAction}
                  </p>
                ) : null}

                <form action={announcerUpdateDeviceAction} className="mt-3 grid grid-cols-2 gap-2">
                  <input type="hidden" name="deviceId" value={d.id} />
                  <Field label="Name">
                    <input name="name" defaultValue={d.name} className={INPUT_CLS} maxLength={60} />
                  </Field>
                  <Field label="Volume">
                    <input
                      name="volume"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={d.volume}
                      className={INPUT_CLS}
                    />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Sound" hint="Shop default follows the setting below.">
                      <select name="soundId" defaultValue="__default" className={INPUT_CLS}>
                        <option value="__default">Shop default</option>
                        {soundOptions.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.group === "My uploads" ? `${s.label} (mine)` : s.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    <Button type="submit" variant="save" size="sm">
                      Save
                    </Button>
                  </div>
                </form>

                <div className="mt-2 flex items-center gap-2 border-t border-[var(--admin-border)] pt-2">
                  <form action={announcerToggleDeviceAction}>
                    <input type="hidden" name="deviceId" value={d.id} />
                    <input type="hidden" name="enabled" value={d.enabled ? "false" : "true"} />
                    <Button type="submit" variant="neutral" size="sm">
                      {d.enabled ? "Switch off" : "Switch on"}
                    </Button>
                  </form>
                  <form action={announcerRemoveDeviceAction} className="ml-auto">
                    <input type="hidden" name="deviceId" value={d.id} />
                    <Button type="submit" variant="danger" size="sm">
                      Remove
                    </Button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {/* ── 3. ADD A SPEAKER ──────────────────────────────────────────── */}
        <details className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3.5 py-3">
          <summary className="cursor-pointer text-sm font-bold text-[var(--admin-text)]">
            ➕ Add a speaker
          </summary>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            Name the room first, then press the button. You will get an eight-character code to
            type into the Raspberry Pi during setup. The code lasts one hour.
          </p>
          <form action={announcerCreatePairingAction} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Room name" hint="For example: Sales Floor">
              <input name="name" className={INPUT_CLS} placeholder="Sales Floor" maxLength={60} />
            </Field>
            <Button type="submit" variant="confirm" size="sm">
              Get pairing code
            </Button>
          </form>
        </details>

        {/* ── 4. SHOP-WIDE SETTINGS ─────────────────────────────────────── */}
        <details className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3.5 py-3">
          <summary className="cursor-pointer text-sm font-bold text-[var(--admin-text)]">
            ⚙️ Announcer settings
          </summary>
          <form action={announcerUpdateSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Announce new orders" hint="The master switch for every speaker.">
              <select name="enabled" defaultValue={settings.enabled ? "true" : "false"} className={INPUT_CLS}>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </Field>
            <Field label="Quiet hours" hint="Test still works during quiet hours.">
              <select
                name="quietHoursEnabled"
                defaultValue={settings.quiet_hours_enabled ? "true" : "false"}
                className={INPUT_CLS}
              >
                <option value="false">Off</option>
                <option value="true">On</option>
              </select>
            </Field>
            <Field label="Default sound">
              <select name="defaultSoundId" defaultValue={settings.default_sound_id} className={INPUT_CLS}>
                {soundOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.group === "My uploads" ? `${s.label} (mine)` : s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quiet from" hint="Shop time (Pacific).">
              <input name="quietStart" type="time" defaultValue={settings.quiet_start} className={INPUT_CLS} />
            </Field>
            <Field label="Quiet until" hint="Shop time (Pacific).">
              <input name="quietEnd" type="time" defaultValue={settings.quiet_end} className={INPUT_CLS} />
            </Field>
            <Field label="Default volume" hint="Used by speakers with no volume of their own.">
              <input
                name="defaultVolume"
                type="number"
                min={0}
                max={100}
                defaultValue={settings.default_volume}
                className={INPUT_CLS}
              />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" variant="save" size="sm">
                Save settings
              </Button>
            </div>
          </form>
        </details>

        <AnnouncerSoundLibrary
          sounds={library.sounds}
          notInstalled={library.notInstalled}
          error={library.error}
          devices={assignments}
          defaultSoundId={settings.default_sound_id}
        />

        {/* ── 5. DID IT ACTUALLY PLAY? ──────────────────────────────────── */}
        {recent.length > 0 ? (
          <details className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3.5 py-3">
            <summary className="cursor-pointer text-sm font-bold text-[var(--admin-text)]">
              🧾 Recent announcements
            </summary>
            <ul className="mt-2 divide-y divide-[var(--admin-border)] text-xs">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-1.5">
                  <span className="w-16 shrink-0 font-bold uppercase tracking-[0.06em] text-[var(--admin-text-faint)]">
                    {r.status === "played" ? "Played" : "Waiting"}
                  </span>
                  <span className="truncate text-[var(--admin-text-muted)]">
                    {r.deviceName} — {r.message}
                  </span>
                  {r.kind === "test" ? (
                    <span className="ml-auto shrink-0 rounded-full border border-[var(--admin-border-strong)] px-1.5 text-[0.62rem] uppercase text-[var(--admin-text-faint)]">
                      test
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
