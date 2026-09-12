/**
 * REGRESSION — "the back office test speaker button does nothing, it hangs"
 *
 * Reported by the owner after a clean install, with every speaker paired and
 * every indicator green. The button was not hanging. It was mute:
 *
 *   - `<form action={announcerTestAllAction}>` inside a SERVER component,
 *   - against an action that returned `void`,
 *   - with a Button that is explicitly documented as having no client hooks.
 *
 * So there was no pending state, no disabled state, and nothing rendered when
 * the action came back. Pressing it changed not one pixel. And because the Pi
 * collects work on a long-poll of up to POLL_HOLD_SECONDS, the chime itself can
 * be ~25 seconds behind the click.
 *
 * No feedback + up to 25 seconds of silence is not "subtle UX". From the far
 * side of the screen it is IDENTICAL to a crashed button, and the owner had no
 * way to tell which it was.
 *
 * The wording lives in describeTestOutcome(), which is pure and covered by the
 * self-test sweep and by a mutation round. What THIS file pins is the wiring:
 * that the feedback is actually connected to the button, in the real files, and
 * cannot quietly come unplugged. A perfectly-worded message that nothing
 * renders is exactly the bug we started with.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { describeTestOutcome } from "@/lib/announcer/announcer-fanout-core";
import { POLL_HOLD_SECONDS } from "@/lib/announcer/announcer-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const BUTTON_PATH = "src/components/admin/orders/AnnouncerTestButton.tsx";
const PANEL_PATH = "src/components/admin/orders/AnnouncerPanel.tsx";
const ACTIONS_PATH = "src/app/admin/orders/announcer-actions.ts";

const button = read(BUTTON_PATH);
const panel = read(PANEL_PATH);
const actions = read(ACTIONS_PATH);

describe("the Test button acknowledges the press immediately", () => {
  it("is a client component — a server component CANNOT show a pending state", () => {
    // This is the root cause, in one line. If the "use client" directive is
    // ever removed, useActionState cannot run and the button goes mute again.
    expect(button.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("tracks pending state rather than looking identical during the request", () => {
    expect(button).toMatch(/useActionState/);
    expect(button, "the pending flag must be read, not just destructured away").toMatch(/pending/);
  });

  it("visibly changes the button while the request is in flight", () => {
    // Three separate signals, because the failure mode was "nothing changed":
    // the label changes, the control is disabled, and assistive tech is told.
    expect(button, "the label must change while sending").toMatch(/Sending/);
    expect(button, "the button must disable itself while sending").toMatch(/disabled=\{pending\}/);
    expect(button, "screen readers must be told it is busy").toMatch(/aria-busy=\{pending\}/);
  });

  it("cannot be double-fired into a queue of duplicate chimes", () => {
    // Disabling while pending is what makes an impatient second press a no-op
    // instead of a second announcement on every speaker in the shop.
    expect(button).toMatch(/disabled=\{pending\}/);
  });

  it("still says '▶ Test all speakers' when idle", () => {
    // The label the quickstart, the wall card and the owner all look for.
    expect(button).toContain("▶ Test all speakers");
  });

  it("announces the outcome to assistive technology as well as to the eye", () => {
    expect(button).toMatch(/role="status"/);
    expect(button).toMatch(/aria-live="polite"/);
  });
});

describe("the Test action reports what actually happened", () => {
  it("returns a result instead of void", () => {
    // The original signature was `(): Promise<void>` — there was literally
    // nothing for the screen to render, however well-written the UI was.
    expect(actions).toMatch(/export type AnnouncerTestResult/);
    expect(actions).toMatch(/announcerTestAllAction\([\s\S]*?\): Promise<AnnouncerTestResult>/);
    expect(
      actions,
      "announcerTestAllAction must not go back to returning void",
    ).not.toMatch(/announcerTestAllAction\(\): Promise<void>/);
  });

  it("builds its message from the shared, self-tested wording", () => {
    expect(actions).toMatch(/describeTestOutcome/);
  });

  it("reports the REAL long-poll hold, not a number typed from memory", () => {
    // If POLL_HOLD_SECONDS ever changes, the sentence the owner reads has to
    // change with it, or the panel starts quoting a stale wait.
    expect(actions).toMatch(/POLL_HOLD_SECONDS/);
    expect(describeTestOutcome({ queued: 1, skipped: 0, ok: true, holdSeconds: POLL_HOLD_SECONDS }))
      .toContain(`${POLL_HOLD_SECONDS} seconds`);
  });

  it("keeps the permission check and the audit trail it always had", () => {
    // Adding feedback must not quietly widen who can make the shop make noise.
    expect(actions).toMatch(/requirePermission\("settings\.manage"\)/);
    expect(actions).toMatch(/action: "announcer\.test"/);
  });
});

describe("the panel really renders the wired-up button", () => {
  it("uses AnnouncerTestButton", () => {
    expect(panel).toMatch(/import \{ AnnouncerTestButton \}/);
    expect(panel).toMatch(/<AnnouncerTestButton \/>/);
  });

  it("REGRESSION: the panel no longer wires a bare form straight to the action", () => {
    // The exact markup that produced the complaint. If it comes back, so does
    // the bug, and this test is the thing standing in front of it.
    expect(
      panel,
      "the Test button must not go back to a feedback-free server form",
    ).not.toMatch(/<form action=\{announcerTestAllAction\}/);
  });
});

describe("the sentence the owner reads is never empty and never misleading", () => {
  const outcome = (queued: number, skipped: number, ok = true) =>
    describeTestOutcome({ queued, skipped, ok, holdSeconds: POLL_HOLD_SECONDS });

  it("always says something", () => {
    for (const m of [outcome(2, 0), outcome(1, 1), outcome(0, 3), outcome(0, 0), outcome(0, 0, false)]) {
      expect(m.trim().length).toBeGreaterThan(0);
    }
  });

  it("sets the expectation about the wait whenever a sound is actually coming", () => {
    // The whole complaint was the unexplained silence after the click.
    expect(outcome(2, 0)).toContain(`${POLL_HOLD_SECONDS} seconds`);
    expect(outcome(1, 0)).toContain(`${POLL_HOLD_SECONDS} seconds`);
  });

  it("never promises a sound that is not coming", () => {
    for (const m of [outcome(0, 3), outcome(0, 0), outcome(0, 0, false)]) {
      expect(m).not.toContain("Test sent");
    }
  });

  it("does not report a failed fan-out as a success", () => {
    expect(outcome(0, 0, false)).toMatch(/^Could not send/);
  });
});
