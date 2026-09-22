"use client";

/**
 * src/app/admin/integrations/leafly/full-menu-panel.tsx
 *
 * ###########################################################################
 * # THE OWNER'S WORDS                                                       #
 * #                                                                        #
 * #   "Is it possible to send the full menu withholding the bad ones?"     #
 * #                                                                 (ask 3)#
 * #                                                                        #
 * #   "I'm not sure what you mean by stage 2 changes my menu looks to      #
 * #    shoppers."                                                   (ask 4)#
 * ###########################################################################
 *
 * WHY THIS PANEL EXISTS SEPARATELY FROM `SendabilityPanel`
 *
 * `SendabilityPanel` answers the same two questions for a HAND-PICKED
 * selection, and it is capped at 250 products by
 * `TARGETED_PUSH_MAX_ITEMS`. The owner's menu is several hundred products, so
 * that panel is structurally incapable of answering "send my WHOLE menu,
 * withholding the bad ones". This panel is the whole-menu answer. It shares
 * none of the selection machinery precisely because there is no selection:
 * the input is "everything you have published".
 *
 * WHY THERE IS NO "JUST SEND IT" BUTTON AT THE TOP
 *
 * Three facts, established by measurement rather than by opinion, dictate the
 * shape of this UI:
 *
 *   1. On the owner's real menu the reject rate is ABOVE the 25% ceiling, so
 *      "withhold the bad ones" alone REFUSES. A button that only did that
 *      would, for him specifically, do nothing but produce an error.
 *
 *   2. Turning the repair on first drives the rejects to zero, so the whole
 *      menu becomes sendable and nothing is withheld at all.
 *
 *   3. The repair's second stage is SHOPPER-VISIBLE. It lists one product as
 *      several. That is a change to his storefront, and it is not ours to
 *      make on his behalf without showing him first.
 *
 * So the order of operations on screen is: LOOK, then decide, then send. The
 * repair toggle is off by default, and the send button does not appear until a
 * preview has been run -- not as friction for its own sake, but because (3)
 * means an un-previewed send could change what his customers see without him
 * having seen it.
 *
 * WHAT MAKES THE PREVIEW TRUSTWORTHY
 *
 * It is not a mock-up. `previewFullMenuPassingOnly` and
 * `pushFullMenuPassingOnly` call the SAME `buildFullMenuDecision`: same feed
 * loader, same preflight, same builder, same settings, same repair, same
 * validator. The only difference is that one of them transmits. A preview
 * built by a second code path would be a rehearsal for a performance nobody
 * is going to give.
 */

import { useState, useTransition } from "react";
import { Badge, Button, Card } from "@/components/admin/ui";
import {
  previewFullMenuPassingOnlyAction,
  pushFullMenuPassingOnlyAction,
} from "./actions";
import type { FullMenuPreviewResult, FullMenuPushResult } from "@/lib/leafly/full-menu-server";

/** How many withheld products to list before collapsing behind a button. */
const WITHHELD_PREVIEW_LIMIT = 8;
/** How many shopper-visible changes to show before collapsing. */
const CHANGE_PREVIEW_LIMIT = 6;

function money(cents: number | null): string {
  if (cents === null) return "no price";
  return `$${(cents / 100).toFixed(2)}`;
}

export function FullMenuPanel({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [repair, setRepair] = useState(false);
  const [preview, setPreview] = useState<FullMenuPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusalLines, setRefusalLines] = useState<string[]>([]);
  const [armed, setArmed] = useState(false);
  const [sent, setSent] = useState<FullMenuPushResult | null>(null);
  const [showAllWithheld, setShowAllWithheld] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);

  /**
   * The repair toggle invalidates any preview on screen.
   *
   * Without this, the owner could preview WITHOUT the repair, flip the
   * toggle, and press a send button that now does something materially
   * different from what he just looked at. The whole value of the preview is
   * that it describes the send that is about to happen.
   */
  function toggleRepair(next: boolean) {
    setRepair(next);
    setPreview(null);
    setArmed(false);
    setSent(null);
    setError(null);
    setRefusalLines([]);
  }

  function doPreview() {
    setError(null);
    setRefusalLines([]);
    setSent(null);
    setArmed(false);
    setShowAllWithheld(false);
    setShowAllChanges(false);
    startTransition(async () => {
      const res = await previewFullMenuPassingOnlyAction({ repair });
      if (res.ok) setPreview(res.preview);
      else {
        setPreview(null);
        setError(res.error);
      }
    });
  }

  function doSend() {
    setError(null);
    setRefusalLines([]);
    startTransition(async () => {
      const res = await pushFullMenuPassingOnlyAction({ confirm: true, repair });
      if (res.ok) {
        setSent(res.result);
        // The preview is now history: the menu on Leafly has moved on from it.
        setPreview(null);
      } else {
        setError(res.error);
        setRefusalLines(res.withheldLines ?? []);
      }
      setArmed(false);
    });
  }

  const plan = preview?.plan ?? null;
  const sp = preview?.splitPreview ?? null;
  const withheld = preview?.withheld ?? [];
  const shownWithheld = showAllWithheld ? withheld : withheld.slice(0, WITHHELD_PREVIEW_LIMIT);
  const changes = sp?.changes ?? [];
  const shownChanges = showAllChanges ? changes : changes.slice(0, CHANGE_PREVIEW_LIMIT);

  return (
    <Card>
      <h3 className="text-sm font-black uppercase tracking-[0.1em]">
        Send my whole menu, hold back only the bad ones
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-[var(--admin-text-muted)]">
        This looks at every product you have published, works out which ones Leafly would
        refuse, and lets you send the rest &mdash; naming every product it holds back and
        giving you a button to go and fix it. Nothing is sent until you press send, and
        nothing is ever deleted from Leafly by this button.
      </p>

      {/*
        The repair toggle. Labelled by what it DOES to his shop, not by what
        it is called in the code. "Stage 2" means nothing to him; "some
        products would be shown as several listings" is the same fact in his
        language.
      */}
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={repair}
          onChange={(e) => toggleRepair(e.target.checked)}
          disabled={pending}
        />
        <span className="text-xs leading-relaxed">
          <span className="font-semibold">
            Fix the size problem automatically before sending
          </span>
          <br />
          <span className="text-[var(--admin-text-muted)]">
            Most refusals are one repeated problem: several sizes of the same product all
            reach Leafly looking identical, so Leafly keeps one and bins the rest. Ticking
            this repairs the sizes first. Where a size cannot be expressed on a single
            product, that product is shown to shoppers as several listings instead &mdash;
            one per size. Preview below shows you exactly which products those are, by
            name, before anything is sent.
          </span>
        </span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="neutral"
          size="sm"
          onClick={doPreview}
          disabled={pending || !configured}
        >
          {pending && preview === null ? "Working\u2026" : "Show me what would happen"}
        </Button>
        {!configured && (
          <span className="text-[0.7rem] text-[var(--admin-text-muted)]">
            Add your Leafly credentials first.
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-2.5">
          <p className="text-xs leading-relaxed text-[var(--admin-danger)]">{error}</p>
          {refusalLines.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5 text-[0.7rem] text-[var(--admin-danger)]/90">
              {refusalLines.slice(0, 10).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* THE PREVIEW                                                      */}
      {/* ---------------------------------------------------------------- */}
      {preview && plan && (
        <div className="mt-3 rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge tone="neutral">{preview.feedCount} in your menu</Badge>
            <Badge tone="green">{plan.sendIds.length} would send</Badge>
            {plan.withheld.length > 0 && (
              <Badge tone="danger">{plan.withheld.length} held back</Badge>
            )}
            {plan.warningCount > 0 && <Badge tone="gold">{plan.warningCount} warnings</Badge>}
          </div>

          <p className="text-xs leading-relaxed">{preview.narrative}</p>

          {/* Nothing was transmitted. Say so unmistakably. */}
          <p className="mt-1.5 text-[0.7rem] italic text-[var(--admin-text-muted)]">
            Nothing has been sent to Leafly yet. This is a preview only.
          </p>

          {/*
            ASK 4 -- what a SHOPPER would see. This block is the entire reason
            the preview exists. It is placed ABOVE the withheld list because it
            describes a change to his storefront, which is the more consequential
            of the two things on this screen.
          */}
          {sp && (
            <div className="mt-3 rounded border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] p-2.5">
              <p className="mb-1 text-xs font-semibold text-[var(--admin-gold)]">
                What your shoppers would see
              </p>
              <p className="text-[0.72rem] leading-relaxed">{preview.splitNarrative}</p>

              {changes.length > 0 && (
                <>
                  <ul className="mt-2 space-y-2">
                    {shownChanges.map((c) => (
                      <li
                        key={c.currentId}
                        className="rounded bg-[var(--admin-surface)] p-2 text-[0.7rem]"
                      >
                        {/* P1: what it is TODAY leads. */}
                        <div className="font-semibold">
                          Today: {c.currentName}
                          <span className="ml-1 font-normal text-[var(--admin-text-muted)]">
                            (one listing, {c.listings.length} sizes)
                          </span>
                        </div>
                        <div className="mt-1 text-[var(--admin-text-muted)]">
                          Would become {c.listings.length} listings:
                        </div>
                        <ul className="mt-0.5 list-disc pl-5">
                          {c.listings.map((l) => (
                            <li key={l.id}>
                              <span className="font-medium">{l.name}</span>
                              {" \u2014 "}
                              {money(l.price)}
                              {l.inventoryLevel !== null
                                ? `, ${l.inventoryLevel} in stock`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {changes.length > shownChanges.length && (
                    <Button
                      type="button"
                      variant="neutral"
                      size="sm"
                      className="mt-2"
                      onClick={() => setShowAllChanges(true)}
                    >
                      Show all {changes.length}
                    </Button>
                  )}
                </>
              )}

              {/* P4: a refusal is part of the preview, not an error page. */}
              {sp.refusals.length > 0 && (
                <div className="mt-2 rounded bg-[var(--admin-surface)] p-2">
                  <p className="text-[0.7rem] font-semibold">
                    {sp.refusals.length} could not be fixed automatically
                  </p>
                  <ul className="mt-1 space-y-1 text-[0.68rem] text-[var(--admin-text-muted)]">
                    {sp.refusals.slice(0, 6).map((r) => (
                      <li key={r.itemId}>
                        <span className="font-medium">{r.itemName}</span> &mdash; {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/*
            Untraceable errors. If these exist the send REFUSES, because
            skipping named products would not make the payload valid. Shown
            here as the explanation; `full-menu-core` rule F3 is the
            enforcement.
          */}
          {plan.unattributed.length > 0 && (
            <div className="mt-3 rounded border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-2.5">
              <p className="text-xs font-semibold text-[var(--admin-danger)]">
                {plan.unattributed.length} problem
                {plan.unattributed.length === 1 ? "" : "s"} could not be traced to a
                particular product, so holding products back would not fix it. Nothing can
                be sent until this is looked at.
              </p>
              <ul className="mt-1 list-disc pl-5 text-[0.68rem] text-[var(--admin-danger)]/90">
                {plan.unattributed.slice(0, 5).map((u, i) => (
                  <li key={i}>{u.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ASK 3 -- named, each with its own route to a fix. */}
          {withheld.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold">
                Would be held back (your menu stays live without them):
              </p>
              <ul className="space-y-1.5">
                {shownWithheld.map((w) => (
                  <li
                    key={w.itemId}
                    className="flex flex-wrap items-start gap-2 rounded bg-[var(--admin-surface)] p-2"
                  >
                    <div className="min-w-0 flex-1">
                      {/* The NAME leads, never the id. */}
                      <div className="text-[0.72rem] font-semibold">
                        {w.itemName ?? w.itemId}
                      </div>
                      <div className="text-[0.68rem] text-[var(--admin-text-muted)]">
                        {w.reasons[0]}
                        {w.reasons.length > 1 ? ` (+${w.reasons.length - 1} more)` : ""}
                      </div>
                      {/*
                        When the fix link points somewhere other than the exact
                        thing named -- because a split id has no product page of
                        its own -- SAY so. A button that silently lands on a
                        different page than its label implies is worse than no
                        button.
                      */}
                      {w.fixNote && (
                        <div className="mt-0.5 text-[0.65rem] italic text-[var(--admin-text-muted)]">
                          {w.fixNote}
                        </div>
                      )}
                    </div>
                    {w.fixHref ? (
                      <Button type="button" variant="primary" size="sm" href={w.fixHref}>
                        Fix this product
                      </Button>
                    ) : (
                      <span className="text-[0.65rem] text-[var(--admin-text-muted)]">
                        No direct page &mdash; see the reason
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {withheld.length > shownWithheld.length && (
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  className="mt-2"
                  onClick={() => setShowAllWithheld(true)}
                >
                  Show all {withheld.length}
                </Button>
              )}
            </div>
          )}

          {/* ---------------------------------------------------------- */}
          {/* THE SEND                                                   */}
          {/* ---------------------------------------------------------- */}
          {plan.proceed ? (
            <div className="mt-3 rounded border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-2.5">
              <p className="mb-2 text-xs leading-relaxed">
                Send {plan.sendIds.length} product
                {plan.sendIds.length === 1 ? "" : "s"} to Leafly
                {plan.withheld.length > 0
                  ? `, leaving the ${plan.withheld.length} above off your menu until you fix them`
                  : " \u2014 nothing is being held back"}
                .
              </p>
              {!armed ? (
                <Button
                  type="button"
                  variant="confirm"
                  size="sm"
                  onClick={() => setArmed(true)}
                  disabled={pending}
                >
                  Send these {plan.sendIds.length}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.7rem] font-semibold">
                    This publishes to your live Leafly menu. Sure?
                  </span>
                  <Button
                    type="button"
                    variant="confirm"
                    size="sm"
                    onClick={doSend}
                    disabled={pending}
                  >
                    {pending ? "Sending\u2026" : "Yes, send them now"}
                  </Button>
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => setArmed(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /*
              The refusal, explained where it happened.
              This is the owner's REAL case when the repair is off: his reject
              rate is above the ceiling. The remedy is named rather than
              implied, because "too widespread" with no next step is how a
              person concludes the software is broken.
            */
            <div className="mt-3 rounded border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-2.5">
              <p className="text-xs font-semibold text-[var(--admin-danger)]">
                Nothing would be sent.
              </p>
              <p className="mt-1 text-[0.72rem] leading-relaxed">
                {plan.refusal === "too_widespread" && !repair
                  ? "Too much of your menu would be held back for this to be a sensible " +
                    "partial send. Tick \u201cFix the size problem automatically\u201d above and " +
                    "preview again \u2014 on a menu like yours that usually clears the problem " +
                    "entirely and lets everything send."
                  : plan.refusal === "too_widespread"
                    ? "Too much of your menu would still be held back even with the automatic " +
                      "fix applied. The products listed above need looking at individually."
                    : plan.refusal === "nothing_left"
                      ? "Every product would be held back, so there is nothing left to send."
                      : "Some problems could not be traced to a particular product, so holding " +
                        "products back would not produce a valid menu."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* THE RESULT                                                       */}
      {/* ---------------------------------------------------------------- */}
      {sent && (
        <div
          className={`mt-3 rounded border p-3 ${
            sent.ok
              ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]"
              : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]"
          }`}
        >
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge tone={sent.ok ? "green" : "danger"}>
              {sent.ok ? "Sent" : `Failed (${sent.httpStatus})`}
            </Badge>
            <Badge tone="neutral">{sent.itemCount} sent</Badge>
            {sent.withheldCount > 0 && (
              <Badge tone="gold">{sent.withheldCount} held back</Badge>
            )}
          </div>
          <p className="text-xs leading-relaxed">{sent.message}</p>
          {sent.splitNarrative && sent.splitPreview?.noChange === false && (
            <p className="mt-1.5 text-[0.72rem] leading-relaxed text-[var(--admin-text-muted)]">
              {sent.splitNarrative}
            </p>
          )}
          {sent.withheldLines.length > 0 && (
            <>
              <p className="mt-2 text-[0.7rem] font-semibold">
                Held back &mdash; these are NOT on your Leafly menu:
              </p>
              <ul className="mt-1 list-disc pl-5 text-[0.68rem] text-[var(--admin-text-muted)]">
                {sent.withheldLines.slice(0, 20).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
