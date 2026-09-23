"use client";

/**
 * src/components/admin/orders/LeaflyOrderDetail.tsx
 *
 * SLICE L-24 — THE THING THE WARNING TOLD PEOPLE TO DO.
 *
 * ===========================================================================
 * WHY THIS COMPONENT EXISTS
 * ===========================================================================
 * The acknowledge button carries this hint, and has since L-6
 * (`order-ack-core.ts:1068`):
 *
 *   "...it permanently ends your access to the customer's ID images — so
 *    open the order and read what you need FIRST."
 *
 * The owner tried to follow it:
 *
 *   > "But there is no way to click the order and see the order details, or
 *   >  customer id image, I'm not sure what that is or means."
 *
 * He could not follow it because the feature did not exist. An instruction
 * with no way to comply is worse than silence: it implies the operator missed
 * something, and then the door closes anyway.
 *
 * ===========================================================================
 * THREE DESIGN DECISIONS WORTH THE WORDS
 * ===========================================================================
 *
 * 1. THE PANEL IS COLLAPSED BY DEFAULT AND LOADS ON DEMAND.
 *    `raw_order` is a whole order payload. The board shows every open order.
 *    Loading all of them to support a panel that is usually shut would move
 *    megabytes on the shop's busiest screen — which is exactly why
 *    `order-board-server.ts` excludes the column from its list query.
 *
 * 2. THE ID IMAGES ARE NOT LOADED WITH THE DETAIL.
 *    They are behind a second, explicit press. Two reasons, and the second
 *    is the real one. The small reason is bandwidth. The large reason is
 *    that fetching a government ID is an access event that should happen
 *    because somebody decided to look, not because they expanded a panel to
 *    check a phone number. The button states the consequence before the
 *    press, in the same style as the acknowledge confirmation.
 *
 * 3. WHEN THE WINDOW HAS CLOSED, THE SCREEN SAYS SO PLAINLY AND SAYS WHY.
 *    An operator who sees a dead image area concludes the software is
 *    broken. An operator who reads "this order was acknowledged, and
 *    acknowledging permanently ends access — check the physical ID at the
 *    counter" knows what happened, knows it was not their mistake, and knows
 *    what to do instead. The sentences come from `decideMediaAccess` in the
 *    pure core, so they are asserted in CI rather than written here.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY NOT SHOWN
 * ===========================================================================
 * The medical card NUMBER is masked to its last four characters. Everything
 * else on this panel is something the staff member is about to see in person
 * anyway — the customer is standing at the counter with the cart in front of
 * them. A state-issued medical identifier is not: it is valuable to somebody
 * who copies it and near-useless to somebody verifying an order. The last
 * four are enough to confirm the card the customer is holding, which is the
 * only job that field has here.
 */

import { useCallback, useRef, useState } from "react";

import { Badge, Button } from "@/components/admin/ui";
import {
  MEDIA_KIND_LABEL,
  formatDetailMoney,
  maskMedicalCardNumber,
  type LeaflyMediaKind,
  type LeaflyOrderDetail as DetailModel,
  type MediaAccessVerdict,
} from "@/lib/leafly/order-detail-core";

type LoadResult = {
  ok: boolean;
  detail: DetailModel | null;
  mediaAccess: MediaAccessVerdict | null;
  error: string | null;
};

/** One labelled fact. Absent values are shown as an em dash, never hidden. */
function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] font-bold uppercase tracking-wide text-[var(--admin-text-faint)]">
        {label}
      </dt>
      {/*
        An absent field renders as a dash rather than vanishing. A row that
        disappears when empty makes two orders look structurally different
        and leaves the operator unsure whether they are looking at a missing
        value or a missing feature — on UberEats orders, where Leafly
        documents that most customer fields are absent, nearly every field
        would vanish and the panel would look broken.
      */}
      <dd className="truncate text-xs font-bold text-[var(--admin-text)]" title={value ?? undefined}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

/**
 * One ID image, fetched on demand through the relay route.
 *
 * ── WHY AN <img> AND A BLOB URL RATHER THAN A DATA URL ─────────────────────
 * A data URL puts the whole image in the React tree as a base64 string: a
 * third larger, retained for as long as the component lives, and trivially
 * copied out of the DOM. A blob URL is a handle to bytes the browser holds
 * out of band, and `URL.revokeObjectURL` releases them the moment the
 * operator closes the image. For a government ID that difference is the
 * point.
 */
function IdImage({
  orderId,
  kind,
}: {
  orderId: string;
  kind: LeaflyMediaKind;
}) {
  const [state, setState] = useState<"idle" | "loading" | "shown" | "failed">("idle");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  const release = useCallback(() => {
    if (objectUrl.current !== null) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/leafly-id-image?order=${encodeURIComponent(orderId)}&kind=${encodeURIComponent(kind)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        // The reason travels in a header because the body must stay empty —
        // an error body would be painted as a broken image. See the route.
        const raw = res.headers.get("x-leafly-media-reason");
        setError(
          raw === null
            ? `The ID image could not be loaded (HTTP ${res.status}).`
            : decodeURIComponent(raw),
        );
        setState("failed");
        return;
      }
      const blob = await res.blob();
      release();
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      setSrc(url);
      setState("shown");
    } catch {
      setError(
        "The ID image could not be loaded — the connection to the back office failed. You can try again.",
      );
      setState("failed");
    }
  }, [orderId, kind, release]);

  const hide = useCallback(() => {
    release();
    setSrc(null);
    setState("idle");
  }, [release]);

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border-strong)] bg-white/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-[var(--admin-text)]">
          {MEDIA_KIND_LABEL[kind]}
        </span>
        {state === "shown" ? (
          <Button type="button" variant="neutral" size="sm" onClick={hide}>
            Hide
          </Button>
        ) : (
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => void load()}
            disabled={state === "loading"}
          >
            {state === "loading" ? "Loading…" : state === "failed" ? "Try again" : "View"}
          </Button>
        )}
      </div>

      {state === "failed" && error !== null ? (
        <p className="mt-2 text-[0.7rem] font-bold text-[var(--admin-danger)]">{error}</p>
      ) : null}

      {state === "shown" && src !== null ? (
        <div className="mt-2">
          {/*
            A plain <img>, not next/image. next/image would route these
            through the image optimiser, which CACHES on disk — the one thing
            a government ID must never do. eslint's no-img-element rule is
            disabled here for that reason and not out of convenience.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`${MEDIA_KIND_LABEL[kind]} supplied by the customer through Leafly`}
            className="max-h-80 w-auto rounded-[var(--admin-radius-md)] border border-[var(--admin-border-strong)]"
          />
          <p className="mt-1 text-[0.65rem] text-[var(--admin-text-faint)]">
            Not saved anywhere. This disappears when you hide it or leave the page.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function LeaflyOrderDetailPanel({
  leaflyOrderId,
  load,
}: {
  leaflyOrderId: string;
  /** The server action. Injected so this component never imports server code. */
  load: (id: string) => Promise<LoadResult>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LoadResult | null>(null);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Fetched once and kept. Re-fetching on every expand would spend calls
    // inside the fifteen-minute window to re-read a row that does not change
    // while the operator is reading it.
    if (result !== null) return;
    setBusy(true);
    try {
      setResult(await load(leaflyOrderId));
    } catch {
      setResult({
        ok: false,
        detail: null,
        mediaAccess: null,
        error: "The order details could not be loaded. You can try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [open, result, load, leaflyOrderId]);

  const detail = result?.detail ?? null;
  const access = result?.mediaAccess ?? null;

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="neutral"
        size="sm"
        onClick={() => void toggle()}
        aria-expanded={open}
      >
        {open ? "Hide order details" : "Open order details & customer ID"}
      </Button>

      {open ? (
        <div className="mt-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border-strong)] bg-black/20 p-3">
          {busy ? (
            <p className="text-xs text-[var(--admin-text-muted)]">Loading the order…</p>
          ) : result === null ? null : !result.ok ? (
            <p className="text-xs font-bold text-[var(--admin-danger)]">
              {result.error ?? "The order could not be opened."}
            </p>
          ) : (
            <>
              {/* ── The customer ─────────────────────────────────────────── */}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                <Fact label="Customer" value={detail?.customerName ?? null} />
                <Fact label="Date of birth" value={detail?.dateOfBirth ?? null} />
                <Fact label="Phone" value={detail?.phoneNumber ?? null} />
                <Fact label="Email" value={detail?.emailAddress ?? null} />
                <Fact label="Placed" value={detail?.createdAt ?? null} />
                <Fact label="Paying by" value={detail?.paymentPreference ?? null} />
              </dl>

              {/* Medical fields appear only for a medical order. Showing four
                  empty medical rows on every recreational order would bury
                  the fields that matter under ones that never apply. */}
              {detail?.medicalStatus ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--admin-border-strong)] pt-3 sm:grid-cols-3">
                  <Fact label="Medical status" value={detail.medicalStatus} />
                  <Fact
                    label="Card number"
                    value={maskMedicalCardNumber(detail.medicalCardNumber)}
                  />
                  <Fact label="Card state" value={detail.medicalCardState} />
                  <Fact label="Card expires" value={detail.medicalCardExpiration} />
                </dl>
              ) : null}

              {/* ── The cart ─────────────────────────────────────────────── */}
              <div className="mt-3 border-t border-[var(--admin-border-strong)] pt-3">
                {(detail?.lines.length ?? 0) === 0 ? (
                  <p className="text-xs text-[var(--admin-text-faint)]">
                    Leafly did not send any cart lines with this order.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {detail?.lines.map((line, i) => (
                      <li
                        key={`${line.name}:${i}`}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="min-w-0 truncate text-[var(--admin-text)]">
                          <span className="font-bold">{line.quantity}×</span> {line.name}
                        </span>
                        <span className="shrink-0 font-mono font-bold text-[var(--admin-text-muted)]">
                          {formatDetailMoney(line.lineTotalMinorUnits)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-2 space-y-0.5 border-t border-[var(--admin-border-strong)] pt-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--admin-text-faint)]">Subtotal</span>
                    <span className="font-mono">{formatDetailMoney(detail?.subtotalMinorUnits)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--admin-text-faint)]">Taxes</span>
                    <span className="font-mono">{formatDetailMoney(detail?.taxesMinorUnits)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[var(--admin-text)]">
                    <span>Total</span>
                    <span className="font-mono">{formatDetailMoney(detail?.totalMinorUnits)}</span>
                  </div>
                </div>
              </div>

              {/* ── The ID images ────────────────────────────────────────── */}
              <div className="mt-3 border-t border-[var(--admin-border-strong)] pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wide text-[var(--admin-text)]">
                    Customer ID
                  </span>
                  {access?.allowed ? (
                    <Badge tone="green">Available now</Badge>
                  ) : access?.permanentlyClosed ? (
                    <Badge tone="neutral">No longer available</Badge>
                  ) : (
                    <Badge tone="orange">Unavailable</Badge>
                  )}
                </div>

                {/* The sentence always renders, whether access is open or
                    closed. When it is open it is a warning; when it is closed
                    it is an explanation. Both come from the pure core. */}
                <p className="mt-1 text-[0.7rem] leading-relaxed text-[var(--admin-text-muted)]">
                  {access?.message ??
                    "We could not work out whether the ID images are available for this order."}
                </p>

                {access?.allowed ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <IdImage orderId={leaflyOrderId} kind="government_id" />
                    {/* The medical ID is offered only for a medical order.
                        Leafly has no medical image for a recreational one, so
                        the button would always fail — and a button that always
                        fails teaches the operator to distrust the ones that
                        work. */}
                    {detail?.medicalStatus ? (
                      <IdImage orderId={leaflyOrderId} kind="medical_id" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
