/**
 * src/components/admin/orders/LeaflyOrderSetupPanel.tsx
 *
 * SLICE M-2 (the screen) — WHY YOUR LEAFLY ORDER VANISHED, ON THE PAGE WHERE
 * YOU LOOKED FOR IT.
 *
 * ===========================================================================
 * THE REPORT THIS PANEL ANSWERS
 * ===========================================================================
 * The owner placed a real order on Leafly and got four silences: no row, no
 * receipt, no sound, and no Leafly section on the online orders page. He then
 * asked the exactly right question — "is it all built but the UI is not there
 * yet?"
 *
 * The honest answer was: the UI was built, and it was hiding. `LeaflyOrdersPanel`
 * renders null when no order integration key is saved and no order has ever
 * arrived. That rule was written for a good reason (the orders page should not
 * grow a permanent empty section for a feature nobody uses) but it has a
 * failure mode nobody anticipated: it is at its most silent precisely when
 * somebody is mid-setup and needs to be told what is missing. A screen that
 * hides during setup cannot be debugged, and a bug nobody can see is a bug
 * nobody can report.
 *
 * So this panel takes over that empty state. Where the old code rendered
 * nothing, it now renders the reason, the remaining steps, and — the part that
 * actually unblocks the shop — the six web addresses that have to be emailed
 * to Leafly before a single order can ever arrive.
 *
 * ===========================================================================
 * WHY THE SIX ADDRESSES ARE THE CENTREPIECE
 * ===========================================================================
 * Leafly does not discover our webhook endpoints. There is no registration
 * endpoint in the Order API specification; the arrangement is made by email,
 * and Leafly's own onboarding message asks for it in as many words: "in order
 * to complete the sandbox setup for the order integration, we'll need one or
 * more URLs to serve as the destination for event webhooks from Leafly…
 * Please let us know which URLs to use for each event."
 *
 * Until that email is sent, every downstream piece of this integration is
 * perfect and useless. All six endpoints are deployed and correctly refuse
 * unsigned requests — which is exactly why the failure is silent. Nothing is
 * broken; nothing has been asked to happen.
 *
 * A step that lives only in somebody's inbox is a step that gets skipped. This
 * panel puts it on the screen, with the exact bytes on a clipboard button, so
 * it cannot be mistyped and cannot be forgotten.
 *
 * ===========================================================================
 * WHAT THIS COMPONENT DECIDES: NOTHING
 * ===========================================================================
 * Whether the shop is ready, which step is next, what the headline says, which
 * addresses to show, and how to explain the silence are all computed by
 * `order-readiness-core.ts` and asserted in CI with no database and no
 * network. This file maps those values onto the shop's existing tokens. If a
 * readiness rule appears here as an `if`, it is in the wrong file.
 *
 * A server component. The only interactive part is the clipboard button, which
 * is already a client component of its own.
 */
import Link from "next/link";
import { Card, CardHeader, Badge } from "@/components/admin/ui";
import type { LeaflyOrderSetupState } from "@/lib/leafly/order-readiness-server";
import type { ReadinessStep, WebhookDestination } from "@/lib/leafly/order-readiness-core";
import { CopyCommandButton } from "./CopyCommandButton";
import { DisclosurePanel } from "@/components/admin/ui/DisclosurePanel";
import { shouldStartOpen } from "@/lib/admin/disclosure-core";

/**
 * Anchor so other screens can link straight here.
 *
 * Exported as a constant rather than written as a string at each link, so a
 * rename cannot leave a dead "#leafly-setup" behind in the handbook. Same
 * convention as ANNOUNCER_PANEL_ANCHOR.
 */
export const LEAFLY_SETUP_ANCHOR = "leafly-order-setup";

/** The address the six URLs have to be emailed to. */
const LEAFLY_SUPPORT_EMAIL = "api-support@leafly.com";

function StepRow({ step, index }: { step: ReadinessStep; index: number }) {
  // Three states, not two. "Done", "still needed" and "optional and not done"
  // are genuinely different, and collapsing the last two into a red cross
  // would nag the shop about a speaker it may not own — which trains people to
  // ignore the whole panel, including the two rows that actually block orders.
  const tone = step.done ? "done" : step.blocking ? "blocking" : "optional";

  const mark = tone === "done" ? "✓" : tone === "blocking" ? "!" : "·";
  const markClass =
    tone === "done"
      ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
      : tone === "blocking"
        ? "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
        : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]";

  return (
    <li className="flex gap-3 py-2.5">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-black ${markClass}`}
      >
        {mark}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold text-[var(--admin-text)]">
          {/* The number is decorative; the status is what a screen reader needs,
              so the status is the text and the number is hidden. */}
          <span aria-hidden="true" className="text-[var(--admin-text-muted)]">
            {index + 1}.{" "}
          </span>
          {step.title}{" "}
          <span className="sr-only">
            {step.done
              ? "— done"
              : step.blocking
                ? "— still needed, orders cannot arrive without this"
                : "— optional, not set up"}
          </span>
          {!step.done ? (
            <Badge tone={step.blocking ? "danger" : "neutral"}>
              {step.blocking ? "still needed" : "optional"}
            </Badge>
          ) : null}
        </p>
        {/* The detail is shown for unfinished steps only. On a finished step it
            is history, and six paragraphs of history is how a checklist stops
            being read. */}
        {!step.done ? (
          <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--admin-text-muted)]">
            {step.detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function DestinationRow({ destination }: { destination: WebhookDestination }) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-border)] py-2 first:border-t-0">
      <Badge tone={destination.requirement === "required" ? "danger" : "neutral"}>
        {destination.requirement}
      </Badge>
      <code className="min-w-0 flex-1 break-all font-mono text-[0.72rem] text-[var(--admin-text)]">
        {destination.url}
      </code>
      <span className="font-mono text-[0.68rem] text-[var(--admin-text-muted)]">
        {destination.event}
      </span>
      {/* The URL is always visible as selectable text as well as being
          copyable. If the clipboard is blocked the button says so and the
          address can still be selected by hand — a copy button that fails
          silently would leave somebody emailing Leafly an empty line. */}
      <CopyCommandButton command={destination.url} describeAs="webhook address" />
    </li>
  );
}

export function LeaflyOrderSetupPanel({
  setup,
  /**
   * True when the orders board is rendering orders of its own.
   *
   * When orders are arriving, this panel becomes a footnote rather than the
   * headline: the shop has working evidence on screen and does not need a
   * setup lecture above it. It is still rendered, because the optional steps
   * (speaker, printer) are exactly the ones that make an order arrive SILENTLY,
   * and a silent arrival is worse than no arrival — the order is real, the
   * clock is running, and nobody has been told.
   */
  compact = false,
}: {
  setup: LeaflyOrderSetupState;
  compact?: boolean;
}) {
  const { readiness, destinations, destinationProblem, originSource, evidence, explanation } =
    setup;

  // SLICE L-16. Computed in `order-readiness-server.ts` from the recorded
  // `rejection_reason`, never re-derived here. The whole defect being repaired
  // was a UI file deciding what a number meant.
  const diagnosis = evidence.refusalDiagnosis;
  const emptyCart = setup.emptyCart;

  const remaining = readiness.steps.filter((s) => !s.done && s.blocking).length;

  // The addresses are shown whenever the webhook step is unconfirmed — not
  // only when everything else is broken. Leafly can have been given five of
  // six addresses, or a stale one from a previous deployment, and in both
  // cases the list is the thing somebody needs to look at.
  const showDestinations = !readiness.steps.find((s) => s.id === "webhook_urls")?.done;

  // One block of text containing all six lines, for the person who is about to
  // paste them into an email. Copying six addresses one at a time is six
  // chances to miss one, and a missing order_cancel is a webhook that fails
  // months later when a customer finally cancels something.
  const allSixForEmail = destinations
    .map((d) => `${d.event} (${d.requirement}): ${d.url}`)
    .join("\n");

  /*
   * SLICE L-20 — THE PANEL NOW COLLAPSES.
   *
   * The owner asked for this panel to fold away behind a green bar identical
   * to the speaker guide's. It is long, and once Leafly is working it is
   * reference material rather than something to read — but it has to stay
   * on the page, because the two OPTIONAL steps it tracks (speaker, printer)
   * are exactly the ones that let an order arrive silently.
   *
   * Both bars are the same component now, so "identical" is structural
   * rather than copied. See src/lib/admin/disclosure-core.ts.
   *
   * WHEN IT STARTS OPEN. Collapsed is the default and the request. But this
   * panel is the only thing on the page that can explain an empty Leafly
   * board, and hiding it while setup is incomplete would silently re-create
   * the M-2 bug — a blank space with no explanation, which is the report
   * that caused this panel to be built. So `shouldStartOpen` keeps it
   * expanded while blocking steps remain AND nothing has ever arrived. Once
   * real orders exist, evidence outranks the checklist and it folds away.
   *
   * The step count rides on the bar itself, so the owner can see whether he
   * needs to open it WITHOUT opening it.
   */
  const startOpen = shouldStartOpen(remaining, readiness.anyOrderEverReceived);

  return (
    <div className="mt-4" id={LEAFLY_SETUP_ANCHOR}>
      <DisclosurePanel
        icon={readiness.ready ? "✅" : "🧩"}
        title="Leafly orders"
        subtitle="setup"
        defaultOpen={startOpen}
        badge={
          remaining > 0 ? (
            <Badge tone="danger">
              {remaining} {remaining === 1 ? "step" : "steps"} left
            </Badge>
          ) : (
            <Badge tone="green">ready</Badge>
          )
        }
      >
      <Card padding="sm" accent={readiness.ready ? "green" : "gold"} className="sm:p-5">
        <CardHeader
          title="Leafly orders — setup"
          subtitle={readiness.headline}
          icon={readiness.ready ? "✅" : "🧩"}
        />

        {/* ── Why the order vanished ─────────────────────────────────────────
            First, because it is the question that was actually asked. A
            checklist answers "what is missing"; it does not answer "where did
            my order go", and the second question is the one somebody has after
            watching a real customer's order disappear. */}
        {!compact ? (
          <p className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-[0.82rem] leading-relaxed text-[var(--admin-text)]">
            {explanation}
          </p>
        ) : null}

        {/* ── Delivery evidence ──────────────────────────────────────────────
            This is the single most diagnostic fact on the screen, and it is
            the one that distinguishes two faults that look identical from the
            shop floor:

              "Leafly has never called us"  → email them the addresses
              "Leafly calls and we refuse"  → our HMAC key is wrong

            Both produce no row, no receipt and no sound. Migration 0225 logs
            refused deliveries specifically so this distinction can be made,
            and this is the first screen that ever surfaced it. */}
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] px-3 py-2">
            <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Signed deliveries from Leafly
            </p>
            <p className="mt-0.5 text-sm font-black text-[var(--admin-text)]">
              {evidence.problem
                ? "could not check"
                : evidence.verifiedDeliveryEverReceived
                  ? "received ✓"
                  : "none yet"}
            </p>
          </div>
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] px-3 py-2">
            <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Deliveries we refused
            </p>
            <p className="mt-0.5 text-sm font-black text-[var(--admin-text)]">
              {evidence.problem ? "—" : evidence.rejectedDeliveries}
            </p>
            {/* ── SLICE L-16: the count no longer speaks for itself ─────────
                This used to read, on ANY non-zero count: "Leafly is reaching
                us but the signature didn't match ... the webhook HMAC key here
                doesn't match the one Leafly issued."

                That sentence was wrong in the only case it ever actually
                fired. The owner's six refusals were all `missing_header` —
                requests that arrived carrying no signature at all, several of
                them hand-run probes against the public URL during diagnosis. A
                request with no signature involved no key, and so can say
                nothing whatever about whether our key is right. A completely
                healthy integration was reporting a credential fault, and the
                remedy it recommended was to rotate a working key.

                `diagnoseRefusals` now decides this from the recorded
                `rejection_reason`, and exactly ONE of the seven reasons
                (`mismatch`) is permitted to point at Leafly. */}
            {!evidence.problem && evidence.rejectedDeliveries > 0 ? (
              <>
                <p
                  className={`mt-1 text-[0.7rem] font-bold leading-snug ${
                    diagnosis.contactLeafly || diagnosis.actionIsOurs
                      ? "text-[var(--admin-danger)]"
                      : "text-[var(--admin-text-muted)]"
                  }`}
                >
                  {diagnosis.headline}
                </p>
                <p className="mt-1 text-[0.68rem] leading-snug text-[var(--admin-text-muted)]">
                  {diagnosis.detail}
                </p>
                {/* The per-reason split. This is the evidence behind the
                    sentence above, shown so the owner never has to take the
                    verdict on trust. */}
                {diagnosis.breakdown.buckets.length > 0 ? (
                  <ul className="mt-1.5 space-y-1">
                    {diagnosis.breakdown.buckets.map((bucket) => (
                      <li key={bucket.reason} className="leading-snug">
                        <span className="font-mono text-[0.66rem] font-bold text-[var(--admin-text)]">
                          {bucket.count}× {bucket.reason}
                        </span>
                        <span
                          className={`ml-1.5 rounded px-1 py-[1px] text-[0.6rem] font-bold uppercase tracking-wide ${
                            bucket.owner === "leafly"
                              ? "bg-[var(--admin-danger)] text-white"
                              : bucket.owner === "us"
                                ? "bg-[var(--admin-warning)] text-black"
                                : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)]"
                          }`}
                        >
                          {bucket.owner === "leafly"
                            ? "Leafly’s key"
                            : bucket.owner === "us"
                              ? "ours to fix"
                              : bucket.owner === "not_leafly"
                                ? "not Leafly"
                                : "unrecognised"}
                        </span>
                        <span className="mt-0.5 block text-[0.66rem] text-[var(--admin-text-muted)]">
                          {bucket.meaning}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] px-3 py-2">
            <p className="text-[0.68rem] font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Last contact from Leafly
            </p>
            <p className="mt-0.5 text-sm font-black text-[var(--admin-text)]">
              {evidence.lastDeliveryAt
                ? new Date(evidence.lastDeliveryAt).toLocaleString("en-US", {
                    timeZone: "America/Los_Angeles",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "never"}
            </p>
            {evidence.eventTypesSeen.length > 0 ? (
              <p className="mt-1 font-mono text-[0.66rem] leading-snug text-[var(--admin-text-muted)]">
                {evidence.eventTypesSeen.join(", ")}
              </p>
            ) : null}
          </div>
        </div>

        {/* ── The checklist ──────────────────────────────────────────────── */}
        {/* SLICE L-16: why the shopper's cart empties.
            THE SYMPTOM THIS BLOCK EXISTS FOR, IN THE OWNER'S OWN WORDS:
            "I can add the product to the cart, then when I go to complete the
            order, it vanishes and I get a blank cart screen."

            Nothing on any screen mentioned this, because nothing on any screen
            knew it was possible. Per the vendored Order API spec the preview
            webhook's response IS the cart -- our integration may "adjust items
            quantities (downward only), remove items entirely, correct
            top-of-line pricing". So any answer we give that contains no items
            empties the shopper's basket, and THREE separate conditions produce
            that answer, all of which look identical from the shop floor:

              refused signature   -> 401, no body at all
              pickup switched off -> every line removed_not_orderable
              no published menu   -> nothing to price against

            The middle one is the trap: `sendPickupAvailability` defaults OFF,
            and with it off a shop that has done everything else correctly
            still cannot take an order while every indicator reads green.

            Shown ABOVE the checklist because it is a live, blocking fault, and
            below the evidence because it is often caused by what the evidence
            has just finished explaining. */}
        {emptyCart.blocking ? (
          <div className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/50 bg-[var(--admin-danger-soft)] p-3 sm:p-4">
            <p className="text-sm font-black text-[var(--admin-danger)]">{emptyCart.headline}</p>
            <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--admin-text)]">
              {emptyCart.detail}
            </p>
            {/* The causes whose fix lives on another page get a link. Telling
                somebody to change a setting without saying where it is is half
                an instruction. */}
            {emptyCart.cause === "pickup_disabled" || emptyCart.cause === "menu_unavailable" ? (
              <Link
                href="/admin/integrations/leafly"
                className="admin-focus mt-2 inline-block text-[0.78rem] font-bold underline text-[var(--admin-danger)]"
              >
                {emptyCart.cause === "pickup_disabled"
                  ? "Open Leafly sync settings"
                  : "Open Leafly menu sync"}
              </Link>
            ) : null}
          </div>
        ) : null}

        <ul className="mt-3 divide-y divide-[var(--admin-border)]">
          {readiness.steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} />
          ))}
        </ul>

        {/* ── The six addresses ─────────────────────────────────────────────
            The actual unblocking action. Everything above explains; this is
            the part somebody can do something with. */}
        {showDestinations ? (
          <div className="mt-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)] bg-[var(--admin-surface-2)] p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black text-[var(--admin-text)]">
                  Send these six addresses to Leafly
                </p>
                <p className="mt-1 text-[0.78rem] leading-relaxed text-[var(--admin-text-muted)]">
                  Leafly can’t guess where to send your orders — there’s no setting for it on their
                  website. Email these to{" "}
                  <a
                    className="admin-focus font-bold underline"
                    href={`mailto:${LEAFLY_SUPPORT_EMAIL}?subject=Greenway%20Marijuana%20%E2%80%94%20order%20webhook%20destination%20URLs`}
                  >
                    {LEAFLY_SUPPORT_EMAIL}
                  </a>{" "}
                  and ask them to point each event at the matching address. Until they do, nothing
                  arrives here.
                </p>
              </div>
              {destinations.length > 0 ? (
                <CopyCommandButton
                  command={allSixForEmail}
                  describeAs="all six webhook addresses"
                  idleLabel="Copy all six"
                />
              ) : null}
            </div>

            {/* A refusal from the core shows the reason and NO addresses. That
                is deliberate: this text gets pasted into an email to a third
                party who will configure it and then send real orders at it. A
                list of subtly wrong addresses looks exactly as legitimate as a
                correct one once it is sitting in an inbox, and it fails
                silently months later. No answer beats a wrong answer here. */}
            {destinationProblem ? (
              <p className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-3 py-2 text-[0.78rem] font-bold leading-relaxed text-[var(--admin-danger)]">
                {destinationProblem}
              </p>
            ) : (
              <>
                <ul className="mt-3">
                  {destinations.map((d) => (
                    <DestinationRow key={d.event} destination={d} />
                  ))}
                </ul>
                {/* An honest caveat rather than a confident wrong answer. On a
                    Vercel preview deployment the host name changes on every
                    push, so these addresses would work once and then quietly
                    stop — the exact failure mode this whole panel exists to
                    prevent, reintroduced by our own helpfulness. */}
                {originSource === "vercel" ? (
                  <p className="mt-2 text-[0.74rem] font-bold leading-relaxed text-[var(--admin-orange)]">
                    Heads up: these were built from this deployment’s temporary address because the
                    site’s permanent address isn’t configured. That address changes every time the
                    site is updated, so orders would stop arriving. Set the site’s public address
                    first, then copy these again.
                  </p>
                ) : null}
              </>
            )}

            <p className="mt-3 text-[0.74rem] leading-relaxed text-[var(--admin-text-muted)]">
              The two marked <strong>required</strong> are the ones Leafly insists on before going
              live. The rest are worth sending at the same time — asking for them later is another
              email and another wait.
            </p>
          </div>
        ) : null}

        {/* ── Things we could not check ─────────────────────────────────────
            Separated from the setup steps on purpose. "We could not check" and
            "we checked and it is missing" call for different responses from a
            human, and flattening them is how a status screen starts lying. */}
        {setup.problems.length > 0 ? (
          <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] px-3 py-2">
            <p className="text-[0.72rem] font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
              Couldn’t check
            </p>
            <ul className="mt-1 space-y-0.5">
              {setup.problems.map((p) => (
                <li key={p} className="text-[0.78rem] leading-snug text-[var(--admin-text-muted)]">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ── Where to go next ────────────────────────────────────────────── */}
        <div className="mt-3 flex flex-wrap gap-3 text-[0.78rem] font-bold">
          <Link className="admin-focus underline" href="/admin/integrations">
            Leafly keys &amp; connection →
          </Link>
          <Link className="admin-focus underline" href="/admin/integrations/leafly/help">
            The Leafly orders handbook →
          </Link>
        </div>
      </Card>
      </DisclosurePanel>
    </div>
  );
}
