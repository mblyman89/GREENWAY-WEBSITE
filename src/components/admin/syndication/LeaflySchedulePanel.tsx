"use client";

/**
 * src/components/admin/syndication/LeaflySchedulePanel.tsx  (SLICE L-7)
 *
 * "Can we have both automation and a manual push button?"  -- the owner
 *
 * This is the automation half. The manual half is `LeaflyPushClient`, one card
 * up the page, and it is deliberately UNTOUCHED: the answer to "can we have
 * both" should not be "yes, but your button moved".
 *
 * WHAT THIS CARD IS FOR
 * ---------------------
 * Three questions, in the order an owner actually asks them:
 *
 *   1. "Is my Leafly menu being kept up to date right now?"  -> the verdict
 *      strip at the top, from `summarizeAutomation()`.
 *   2. "What is it set to do?"                               -> the form.
 *   3. "Prove it."                                           -> the run history,
 *      plus a button that runs the scheduler's own check on demand so the
 *      owner never has to wait an hour to find out whether his settings work.
 *
 * WHY THERE IS ALMOST NO LOGIC IN THIS FILE
 * -----------------------------------------
 * Every sentence, label, tone and verdict below comes from
 * `src/lib/leafly/schedule-core.ts`, which is pure and has 240+ self-test
 * assertions behind it. A `.tsx` file is the worst place to keep a rule: it is
 * expensive to unit test, the mutation sweep cannot sabotage it, and inline
 * ternaries breed. So this component owns layout, focus order and disabled
 * states -- and nothing else. If you are about to add a ternary here that
 * decides what something MEANS, it belongs in the core instead (house rule 11).
 *
 * WHY `nowIso` IS A PROP AND NOT `Date.now()`
 * -------------------------------------------
 * Relative times ("4 minutes ago") rendered from the browser clock disagree
 * with the same string rendered on the server microseconds earlier, and React
 * calls that a hydration mismatch. The server passes its own clock down, so the
 * first paint agrees with itself. Refreshing is what updates it, which is
 * honest: this is a record of what happened, not a live ticker.
 *
 * A NOTE ON THE ONE ORANGE BUTTON RULE
 * ------------------------------------
 * The house style allows at most one solid-orange primary per page region. The
 * page's orange already belongs to the live push. So the two controls here are
 * `save` (gold, "Save schedule") and `special` (purple, "Run the check now") --
 * purple being the established variant for automation actions. That is not a
 * cosmetic choice: it keeps "push my menu to Leafly right now" visually
 * unmistakable from "ask the scheduler what it would do", which are very
 * different acts with very different consequences.
 */
import { useState, useTransition } from "react";
import { Badge, Button, Card, Field, Select } from "@/components/admin/ui";
import {
  ALL_SCHEDULED_RUN_CODES,
  BACKOFF_AFTER_FAILURES,
  DAILY_CATCHUP_HOURS,
  DAILY_HOUR_MAX,
  DAILY_HOUR_MIN,
  INTRADAY_CHOICES,
  MIN_RUN_GAP_MINUTES,
  assessCadenceAgainstLeafly,
  describeElapsed,
  describeIntradayInterval,
  describeSchedule,
  dispositionLabel,
  dispositionTone,
  formatPacificHour,
  scheduleCodeLabel,
  scheduleToneForCode,
  summarizeAutomation,
  type LeaflyScheduleSettings,
  type ScheduleTone,
} from "@/lib/leafly/schedule-core";
import type { SyncHealth, SyncRunRow } from "@/lib/leafly/schedule-server";

/** The one place tone -> badge colour is decided, so the mapping cannot drift. */
const TONE_BADGE: Record<ScheduleTone, "green" | "gold" | "neutral" | "danger"> = {
  good: "green",
  waiting: "gold",
  off: "neutral",
  bad: "danger",
};

const TONE_TEXT: Record<ScheduleTone, string> = {
  good: "text-[var(--admin-accent)]",
  waiting: "text-[var(--admin-gold)]",
  off: "text-[var(--admin-text-muted)]",
  bad: "text-[var(--admin-danger)]",
};

type SaveResult =
  | { ok: true; schedule: LeaflyScheduleSettings; description: string }
  | { ok: false; error: string };

type CheckNowResult =
  | { ok: true; code: string; message: string; pushed: boolean; disposition: string }
  | { ok: false; error: string };

const HOURS = Array.from(
  { length: DAILY_HOUR_MAX - DAILY_HOUR_MIN + 1 },
  (_, i) => DAILY_HOUR_MIN + i,
);

export function LeaflySchedulePanel({
  health,
  nowIso,
  saveAction,
  checkNowAction,
}: {
  health: SyncHealth;
  /** The SERVER's clock at render time. See the header note on hydration. */
  nowIso: string;
  saveAction: (formData: FormData) => Promise<SaveResult>;
  checkNowAction: () => Promise<CheckNowResult>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState<boolean | null>(null);
  const [checkResult, setCheckResult] = useState<CheckNowResult | null>(null);

  // Controlled only so the form can DISCLOSE what it is about to do before the
  // owner commits (the live preview sentence below the fields). The server
  // re-resolves and clamps everything regardless; nothing here is trusted.
  const s = health.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [dailyHour, setDailyHour] = useState(String(s.dailyFullHour));
  const [intradayEnabled, setIntradayEnabled] = useState(s.intradayEnabled);
  const [intradayMinutes, setIntradayMinutes] = useState(String(s.intradayMinutes));
  const [windowed, setWindowed] = useState(s.activeFromHour !== null && s.activeToHour !== null);
  const [fromHour, setFromHour] = useState(String(s.activeFromHour ?? 8));
  const [toHour, setToHour] = useState(String(s.activeToHour ?? 21));
  const [repairSizes, setRepairSizes] = useState(s.repairSizes);

  // What the form currently describes -- resolved by the same pure functions
  // the server will use, so the preview cannot promise something else.
  const pendingSettings: LeaflyScheduleSettings = {
    enabled,
    dailyFullHour: Number.parseInt(dailyHour, 10),
    intradayEnabled,
    intradayMinutes: Number.parseInt(intradayMinutes, 10),
    activeFromHour: windowed ? Number.parseInt(fromHour, 10) : null,
    activeToHour: windowed ? Number.parseInt(toHour, 10) : null,
    repairSizes,
  };

  const summary = summarizeAutomation({
    nowIso,
    settings: s,
    configured: health.configured,
    nextDecision: health.nextDecision,
    lastFullSyncIso: health.facts.lastFullSyncIso,
    lastRunIso: health.facts.lastRunIso,
    consecutiveFailures: health.facts.consecutiveFailures,
    problem: health.problem,
  });

  const cadence = assessCadenceAgainstLeafly(s);
  const savedDescription = describeSchedule(s);
  const pendingDescription = describeSchedule(pendingSettings);
  const dirty = pendingDescription !== savedDescription;

  function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    // Explicit booleans. An unchecked checkbox submits NOTHING, and a schedule
    // form where "off" is indistinguishable from "did not say" is a form that
    // cannot be used to turn automation off -- the one direction where failing
    // silently is unacceptable.
    fd.set("enabled", enabled ? "true" : "false");
    fd.set("intradayEnabled", intradayEnabled ? "true" : "false");
    fd.set("repairSizes", repairSizes ? "true" : "false");
    // Both window ends or neither. `resolveScheduleSettings` discards a
    // half-specified window, and sending only one end would read as "no window"
    // -- the difference between syncing all day and syncing almost never.
    if (windowed) {
      fd.set("activeFromHour", fromHour);
      fd.set("activeToHour", toHour);
    } else {
      fd.delete("activeFromHour");
      fd.delete("activeToHour");
    }
    setMsg(null);
    setMsgOk(null);
    setCheckResult(null);
    startTransition(async () => {
      const res = await saveAction(fd);
      if (res.ok) {
        setMsgOk(true);
        setMsg(`Saved. ${res.description}`);
      } else {
        setMsgOk(false);
        setMsg(res.error);
      }
    });
  }

  function doCheckNow() {
    setMsg(null);
    setMsgOk(null);
    setCheckResult(null);
    startTransition(async () => {
      setCheckResult(await checkNowAction());
    });
  }

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Automatic syncing</h2>
        <Badge tone={TONE_BADGE[summary.tone]}>{summary.headline}</Badge>
        {cadence.meetsRecommendation ? (
          <Badge tone="green">Matches Leafly&rsquo;s recommended cadence</Badge>
        ) : null}
      </div>

      {/*
        The verdict, first and largest. This answers the only question the owner
        has when he opens this page, and it is deliberately NOT the same thing as
        "what would the next tick do" -- see summarizeAutomation's header for the
        frozen-menu case that distinction exists to catch.
      */}
      <p className={`mb-4 text-xs ${TONE_TEXT[summary.tone]}`}>{summary.detail}</p>

      {/*
        Both halves, said plainly and in one place, because the owner asked for
        both and should never have to infer that asking for automation cost him
        his button.
      */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            On a schedule
          </p>
          <p className="mt-1 text-xs text-[var(--admin-text)]">
            {s.enabled
              ? "On. Leafly gets your menu without anyone pressing anything."
              : "Off. Nothing is sent unless a person sends it."}
          </p>
        </div>
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            By hand
          </p>
          <p className="mt-1 text-xs text-[var(--admin-text)]">
            Always available, in the send tools above (<strong>Send my whole menu, hold back
            only the bad ones</strong>, <strong>Send only certain products</strong>, and
            <strong>Replace my whole Leafly menu (POST)</strong>). The schedule stands aside
            while you are sending and never competes with you.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
        className="space-y-4 border-t border-[var(--admin-border)] pt-4"
      >
        {/*
          The master switch is a real checkbox rather than a styled div so it
          works with the keyboard, with a screen reader, and with the browser's
          own focus ring, which is what "easy to use" means for the person doing
          this at 6am on a phone.
        */}
        <label className="flex items-start gap-2 text-xs text-[var(--admin-text)]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--admin-accent)]"
          />
          <span>
            <span className="font-medium">Keep my Leafly menu in sync automatically</span>
            <span className="block text-[11px] text-[var(--admin-text-muted)]">
              Leafly&rsquo;s menu-certification checklist grades sync cadence and marks down
              integrations whose requests look hand-driven. This is the setting that
              satisfies it.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Full sync every day at"
            htmlFor="lf-daily-hour"
            help={
              `Pacific time. A full sync is the authoritative one: it makes Leafly's menu ` +
              `match yours exactly. Set it for a time the shop is closed so nobody is ` +
              `mid-edit. If a full sync has not happened for ${DAILY_CATCHUP_HOURS} hours, ` +
              `the next run does one whatever the hour \u2014 your menu cannot silently freeze.`
            }
          >
            <Select
              id="lf-daily-hour"
              name="dailyFullHour"
              value={dailyHour}
              onChange={(e) => setDailyHour(e.target.value)}
              disabled={!enabled}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {formatPacificHour(h)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Send changes in between"
            htmlFor="lf-intraday-minutes"
            help={
              `Sends only what changed \u2014 a price edit, a sell-out \u2014 so shoppers are not ` +
              `looking at yesterday's menu. Unchanged items are never resent. No two runs ` +
              `ever happen within ${MIN_RUN_GAP_MINUTES} minutes of each other.`
            }
          >
            <Select
              id="lf-intraday-minutes"
              name="intradayMinutes"
              value={intradayEnabled ? intradayMinutes : "off"}
              onChange={(e) => {
                if (e.target.value === "off") {
                  setIntradayEnabled(false);
                } else {
                  setIntradayEnabled(true);
                  setIntradayMinutes(e.target.value);
                }
              }}
              disabled={!enabled}
            >
              {/*
                "Never" is an option inside this dropdown rather than a separate
                checkbox. Two controls for one decision is how you end up with a
                schedule that is enabled with an interval of never and an owner
                who cannot tell why nothing is being sent.
              */}
              <option value="off">Never &mdash; daily full sync only</option>
              {INTRADAY_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {describeIntradayInterval(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label className="flex items-start gap-2 text-xs text-[var(--admin-text)]">
          <input
            type="checkbox"
            checked={windowed}
            onChange={(e) => setWindowed(e.target.checked)}
            disabled={!enabled || !intradayEnabled}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--admin-accent)]"
          />
          <span>
            <span className="font-medium">Only send the in-between updates during set hours</span>
            <span className="block text-[11px] text-[var(--admin-text-muted)]">
              Optional. The daily full sync always runs, window or not &mdash; it is usually
              set for the small hours on purpose.
            </span>
          </span>
        </label>

        {/*
          SLICE L-41. Automatic runs build the menu exactly the way "Send my
          whole menu, hold back only the bad ones" does, so they need the
          owner's answer to that panel's size-repair tick box stored where the
          cron can read it with nobody present.
        */}
        <label className="flex items-start gap-2 text-xs text-[var(--admin-text)]">
          <input
            type="checkbox"
            checked={repairSizes}
            onChange={(e) => setRepairSizes(e.target.checked)}
            disabled={!enabled}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--admin-accent)]"
          />
          <span>
            <span className="font-medium">Fix the size problem automatically before each automatic send</span>
            <span className="block text-[11px] text-[var(--admin-text-muted)]">
              The same fix as the tick box on &ldquo;Send my whole menu&rdquo;. Off by default,
              because it can list one product as several sizes on Leafly. Either way, products
              that still fail Leafly&rsquo;s checks are held back and named in the log &mdash;
              they are never sent broken, and never deleted from Leafly because of it.
            </span>
          </span>
        </label>

        {windowed ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Updates from" htmlFor="lf-from-hour">
              <Select
                id="lf-from-hour"
                value={fromHour}
                onChange={(e) => setFromHour(e.target.value)}
                disabled={!enabled || !intradayEnabled}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {formatPacificHour(h)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Until" htmlFor="lf-to-hour">
              <Select
                id="lf-to-hour"
                value={toHour}
                onChange={(e) => setToHour(e.target.value)}
                disabled={!enabled || !intradayEnabled}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {formatPacificHour(h)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}

        {/*
          Say what the settings MEAN before they are saved, in the same words the
          system will use afterwards (both come from describeSchedule). A settings
          screen that only echoes field values makes the owner simulate the system
          in his head; this does it for him.
        */}
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-3 py-2">
          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            {dirty ? "What this will do once you save" : "What this does"}
          </p>
          <p className="mt-1 text-xs text-[var(--admin-text)]">{pendingDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="save" size="sm" disabled={pending}>
            {pending ? "Saving\u2026" : dirty ? "Save schedule" : "Save schedule"}
          </Button>
          {/*
            The only way to find out whether a schedule works, without this
            button, is to wait for it. That is a bad way to learn that your
            credentials are wrong. This runs the scheduler's OWN decision path --
            not a special test path -- so what it reports is exactly what the
            cron would do, and if the decision is "run", it really runs.
          */}
          <Button
            type="button"
            variant="special"
            size="sm"
            onClick={doCheckNow}
            disabled={pending}
          >
            {pending ? "Checking\u2026" : "Run the check now"}
          </Button>
          {dirty ? (
            <span className="text-[11px] text-[var(--admin-gold)]">
              Unsaved changes &mdash; the schedule below is still the old one.
            </span>
          ) : null}
        </div>
      </form>

      {msg ? (
        <p
          className={`mt-3 text-xs ${
            msgOk ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"
          }`}
        >
          {msg}
        </p>
      ) : null}

      {checkResult ? (
        <div className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2">
          {checkResult.ok ? (
            <>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge tone={TONE_BADGE[scheduleToneForCode(checkResult.code)]}>
                  {/*
                    scheduleCodeLabel returns null for a code it does not know,
                    rather than a prettified snake_case string. Showing the raw
                    code in that case is the honest fallback: it tells whoever is
                    debugging exactly what came back instead of hiding it.
                  */}
                  {scheduleCodeLabel(checkResult.code) ?? checkResult.code}
                </Badge>
                <span className="text-xs text-[var(--admin-text-muted)]">
                  {checkResult.pushed ? "Sent to Leafly" : "Nothing was sent"}
                </span>
              </div>
              <p className="text-xs text-[var(--admin-text)]">{checkResult.message}</p>
              <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
                Refresh the page to see this in the history below.
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--admin-danger)]">{checkResult.error}</p>
          )}
        </div>
      ) : null}

      {/*
        Leafly's own recommendation, quoted, next to what we are configured to
        do about it. The certification card elsewhere on this page grades whether
        a schedule EXISTS; this grades whether the schedule the owner chose is
        the one Leafly asked for. An owner with the daily sync on and intraday
        updates off passes the first and half-fails the second, and until now
        nothing said so.
      */}
      <div className="mt-4 border-t border-[var(--admin-border)] pt-3">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Against Leafly&rsquo;s recommendation
          </span>
          <Badge tone={cadence.meetsRecommendation ? "green" : "gold"}>
            {cadence.meetsRecommendation ? "Matches" : "Could be better"}
          </Badge>
        </div>
        <p className="text-xs italic text-[var(--admin-text-muted)]">
          Leafly recommends: &ldquo;{cadence.recommendation}&rdquo;
        </p>
        <p className="mt-1 text-xs text-[var(--admin-text)]">{cadence.finding}</p>
      </div>

      {/*
        The receipts. Certification is graded on our REQUEST HISTORY, so the
        owner should be able to see the same history a Leafly reviewer would --
        including the runs where we deliberately sent nothing, which are the ones
        that prove we are not hammering their API.
      */}
      <div className="mt-4 border-t border-[var(--admin-border)] pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Recent automatic and manual runs
          </span>
          {health.facts.consecutiveFailures > 0 ? (
            <Badge
              tone={
                health.facts.consecutiveFailures >= BACKOFF_AFTER_FAILURES ? "danger" : "orange"
              }
            >
              {health.facts.consecutiveFailures} in a row failed
            </Badge>
          ) : null}
        </div>

        {health.problem ? (
          <p className="text-xs text-[var(--admin-danger)]">
            The run history could not be read, so nothing below can be trusted:{" "}
            {health.problem}
          </p>
        ) : health.runs.length === 0 ? (
          <p className="text-xs text-[var(--admin-text-muted)]">
            No runs recorded yet. Once automatic syncing is on, or the next time you push
            by hand, every attempt is logged here &mdash; including the ones that
            deliberately sent nothing.
          </p>
        ) : (
          <div className="space-y-1.5">
            {health.runs.map((run) => (
              <RunRow key={run.id} run={run} nowIso={nowIso} />
            ))}
          </div>
        )}

        <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
          A run that says <strong>{dispositionLabel("skipped")}</strong> is the system
          working: nothing on your menu had changed, so nothing was sent. A run stuck for
          more than {health.staleRunMinutes} minutes is treated as abandoned and will not
          block the next one.
        </p>
      </div>
    </Card>
  );
}

/**
 * One line of run history.
 *
 * Shows the TRIGGER as well as the outcome, because "the schedule did this" and
 * "somebody pressed the button" are different facts and the owner is entitled
 * to know which of the two kept his menu current.
 */
function RunRow({ run, nowIso }: { run: SyncRunRow; nowIso: string }) {
  const tone = dispositionTone(run.disposition);
  const label = dispositionLabel(run.disposition);
  const codeLabel = scheduleCodeLabel(run.decisionCode);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE_BADGE[tone]}>{label ?? run.disposition ?? "unknown"}</Badge>
        <span className="font-medium text-[var(--admin-text)]">
          {run.triggerSource === "manual" ? "You pushed" : "Scheduled"}
        </span>
        {run.method ? (
          <span className="text-[var(--admin-text-muted)]">
            {run.method === "POST" ? "full sync" : run.method === "PUT" ? "update" : run.method}
          </span>
        ) : null}
        {run.itemCount !== null ? (
          <span className="text-[var(--admin-text-muted)]">{run.itemCount} items</span>
        ) : null}
        {/*
          The decision code is shown for a run that sent nothing, because that is
          precisely when "why?" is the question. For a successful send the outcome
          badge already says everything and the code would be noise.
        */}
        {!run.pushed && codeLabel ? (
          <span className="text-[var(--admin-text-muted)]">&mdash; {codeLabel}</span>
        ) : null}
        {run.errorDetail ? (
          <span className="text-[var(--admin-danger)]">&mdash; {run.errorDetail}</span>
        ) : run.reason ? (
          <span className="text-[var(--admin-text-faint)]">&mdash; {run.reason}</span>
        ) : null}
      </div>
      <span className="text-[var(--admin-text-faint)]">
        {describeElapsed(run.startedAt, nowIso)}
      </span>
    </div>
  );
}

/**
 * Exported for the compliance test, which asserts that this component renders
 * every decision code through `scheduleCodeLabel` and therefore cannot leak a
 * raw snake_case code to the owner. Keeping the list here rather than in the
 * test means the test breaks if this file stops importing the codes.
 */
export const __PANEL_RENDERS_CODES = ALL_SCHEDULED_RUN_CODES;
