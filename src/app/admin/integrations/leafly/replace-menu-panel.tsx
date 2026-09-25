"use client";

/**
 * src/app/admin/integrations/leafly/replace-menu-panel.tsx
 *
 * SLICE L-42 -- the one place on the page that sends a Menu API POST.
 *
 * ###########################################################################
 * # THE OWNER'S WORDS                                                       #
 * #   "per leaflys docs, we have to prove we can successfully complete     #
 * #    every action. So we will need to have a successful push post ...    #
 * #    It doesn't need to be complex."                                     #
 * ###########################################################################
 *
 * WHY THIS BUTTON EXISTS
 *
 * Automatic syncing POSTs only when NOTHING is held back (auto-sync-core,
 * invariant A1); otherwise it uses PUT so it never deletes a product on its
 * own. On a menu with any product Leafly refuses, automation therefore never
 * POSTs, and certification needs a successful POST. This is that POST.
 *
 * WHY IT DOES NOT FAIL LIKE THE OLD "PUSH POST" BUTTON
 *
 * The old button sent the all-or-nothing menu and was refused whenever ANY
 * product failed Leafly's checks. This one is built by the exact same code as
 * "Send my whole menu, hold back only the bad ones" and sends only the
 * passing products. The only difference is the verb.
 *
 * WHY THERE IS A TICK BOX
 *
 * POST means "this is my whole menu", so Leafly deletes anything we leave out
 * -- including products held back for a data problem. The panel names those
 * products and the owner ticks a box that states their exact count. The
 * server refuses unless the ticked count equals the count it computes at send
 * time (replace-menu-core R5), so a menu that changed between look and send
 * cannot be posted on a stale approval.
 */

import { useState, useTransition } from "react";
import { Badge, Button, Card } from "@/components/admin/ui";
import { previewReplaceLeaflyMenuAction, replaceLeaflyMenuAction } from "./actions";
import type { ReplaceMenuPreview, ReplaceMenuResult } from "@/lib/leafly/replace-menu-server";

const NAME_LIMIT = 10;

export function ReplaceMenuPanel({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [repair, setRepair] = useState(false);
  const [preview, setPreview] = useState<ReplaceMenuPreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<ReplaceMenuResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  function reset() {
    setPreview(null);
    setAcknowledged(false);
    setArmed(false);
    setResult(null);
    setError(null);
    setShowAll(false);
  }

  function doPreview() {
    reset();
    startTransition(async () => {
      const res = await previewReplaceLeaflyMenuAction({ repair });
      if (res.ok) setPreview(res.preview);
      else setError(res.error);
    });
  }

  function doReplace() {
    if (!preview) return;
    const heldCount = preview.withheld.length;
    setError(null);
    startTransition(async () => {
      const res = await replaceLeaflyMenuAction({
        confirm: true,
        repair,
        acknowledgedWithheldCount: heldCount === 0 ? 0 : acknowledged ? heldCount : null,
      });
      if (res.ok) {
        setResult(res.result);
        setPreview(null);
      } else {
        setError(res.error);
      }
      setArmed(false);
      setAcknowledged(false);
    });
  }

  const plan = preview?.plan ?? null;
  const held = preview?.withheld ?? [];
  const shownHeld = showAll ? held : held.slice(0, NAME_LIMIT);
  const needsAck = held.length > 0;
  const canArm = Boolean(plan?.proceed) && (!needsAck || acknowledged) && !pending && configured;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-black uppercase tracking-[0.1em]">
          Replace my whole Leafly menu (POST)
        </h3>
        <Badge tone="orange">Deletes what it does not send</Badge>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[var(--admin-text-muted)]">
        This sends every product that passes Leafly&rsquo;s checks and tells Leafly
        &ldquo;this is my entire menu&rdquo;. Leafly then removes anything that was not in
        the send. Use it when you need a clean full sync, or to prove a successful POST for
        Leafly&rsquo;s certification. For everyday updates use{" "}
        <strong>Send my whole menu, hold back only the bad ones</strong> instead &mdash; it
        never deletes anything.
      </p>

      <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={repair}
          onChange={(e) => {
            setRepair(e.target.checked);
            reset();
          }}
          disabled={pending}
        />
        <span>
          <span className="font-semibold">Fix the size problem automatically before sending</span>{" "}
          <span className="text-[var(--admin-text-muted)]">
            (same repair as the whole-menu button; usually means fewer products held back)
          </span>
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="neutral" size="sm" onClick={doPreview} disabled={pending || !configured}>
          {pending && !preview && !result ? "Working\u2026" : "Check what a POST would do"}
        </Button>
        {!configured ? (
          <span className="text-[0.7rem] text-[var(--admin-text-muted)]">
            Add your Leafly credentials first.
          </span>
        ) : null}
      </div>

      {plan ? (
        <div className="mt-3 space-y-2 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3 text-xs">
          <p className="font-semibold text-[var(--admin-text)]">
            {plan.proceed
              ? `${plan.postIds.length} products would be sent to Leafly ${preview?.environment === "production" ? "production" : "sandbox"}.`
              : "A POST would not be sent right now."}
          </p>
          <p className="text-[var(--admin-text-muted)]">{plan.reason}</p>

          {needsAck ? (
            <div>
              <p className="font-semibold text-[var(--admin-danger)]">
                {held.length} product{held.length === 1 ? " is" : "s are"} held back and will
                NOT be on Leafly after this POST:
              </p>
              <ul className="mt-1 space-y-0.5">
                {shownHeld.map((w) => (
                  <li key={w.id}>
                    &bull; {w.name}
                    {w.reasons[0] ? (
                      <span className="text-[var(--admin-text-muted)]"> &mdash; {w.reasons[0]}</span>
                    ) : null}
                    {w.fixHref ? (
                      <>
                        {" "}
                        <a className="underline" href={w.fixHref}>
                          fix
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              {held.length > NAME_LIMIT ? (
                <button type="button" className="mt-1 underline" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${held.length}`}
                </button>
              ) : null}
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  onChange={(e) => {
                    setAcknowledged(e.target.checked);
                    setArmed(false);
                  }}
                  disabled={pending || !plan.proceed}
                />
                <span>
                  I understand these {held.length} held-back products will be removed from Leafly
                  until they are fixed and sent again.
                </span>
              </label>
            </div>
          ) : (
            <p className="text-[var(--admin-accent)]">Nothing is held back &mdash; every product goes.</p>
          )}

          {preview && preview.removedRetired.length > 0 ? (
            <p className="text-[var(--admin-text-muted)]">
              {preview.removedRetired.length} product ID(s) we sent before are no longer on your
              menu at all, and Leafly will remove them too.
            </p>
          ) : null}
        </div>
      ) : null}

      {plan?.proceed ? (
        <div className="mt-3">
          {!armed ? (
            <Button variant="primary" size="sm" onClick={() => setArmed(true)} disabled={!canArm}>
              Send POST&hellip;
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[var(--admin-danger)]">
                Replace the Leafly menu with these {plan.postIds.length} products?
              </span>
              <Button variant="danger" size="sm" onClick={doReplace} disabled={pending}>
                {pending ? "Sending\u2026" : "Yes, replace the menu"}
              </Button>
              <Button variant="neutral" size="sm" onClick={() => setArmed(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {result ? (
        <p
          className={`mt-3 text-xs ${
            result.sent && result.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"
          }`}
        >
          {result.sent
            ? result.ok
              ? `POST succeeded (HTTP ${result.httpStatus}) \u2014 ${result.itemCount} products sent. ${result.message}`
              : `Leafly answered HTTP ${result.httpStatus}. ${result.message}`
            : `Nothing was sent. ${result.message}`}
        </p>
      ) : null}
      {error ? <p className="mt-3 text-xs text-[var(--admin-danger)]">{error}</p> : null}
    </Card>
  );
}
