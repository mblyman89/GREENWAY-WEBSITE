import "server-only";

/**
 * src/lib/leafly/order-detail-server.ts
 *
 * SLICE L-24 — opening an order, and looking at the customer's ID.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * The owner read the acknowledge button's own warning and found it dishonest:
 *
 *   > "Before acknowledging the order, there is a warning text below the
 *   >  order that says once acknowledged 'it permanently ends your access to
 *   >  the customers id images - so open the order and read what you need
 *   >  FIRST.' But there is no way to click the order and see the order
 *   >  details, or customer id image."
 *
 * He is right, and the warning is ours — `order-ack-core.ts:1068`:
 *
 *   "...it permanently ends your access to the customer's ID images — so
 *    open the order and read what you need FIRST."
 *
 * The sentence is accurate about the CONSEQUENCE and instructs an action the
 * product never built. That is worse than saying nothing: it tells a staff
 * member to do something, gives them no way to do it, and then closes a door
 * that cannot be reopened. This file builds the missing half.
 *
 * ===========================================================================
 * THE TWO ENDPOINTS, WHICH WERE ALWAYS IN THE SPEC
 * ===========================================================================
 * `docs/leafly-specs/order-api-v1.openapi.json` (vendored, authoritative) has
 * six paths. Four were implemented. These two never were:
 *
 *   GET /{order_integration_key}/government_id/{id}   → 200 image/*
 *   GET /{order_integration_key}/medical_id/{id}      → 200 image/*
 *
 * Leafly's certification table marks both "Recommended", with the stated
 * value add:
 *
 *   "Safety enhancement for retailers without needing to view LeaflyBiz"
 *   "Compliance enhancement for retailers without needing to view LeaflyBiz"
 *
 * ── THE PATH SHAPE IS A TRAP ───────────────────────────────────────────────
 * Media lives at the ROOT of the namespace — `/{key}/government_id/{id}` —
 * NOT under `/{key}/orders/{id}/`. The wrong path returns 404, and a 404 on
 * this integration reads as "Leafly does not have that order", which is a
 * conclusion a person will act on. `leaflyMediaUrl` in the pure core owns
 * that shape so it is decided once and tested.
 *
 * ── THE ACCESS WINDOW IS AN "AND", NOT AN "OR" ─────────────────────────────
 * The spec, verbatim:
 *
 *   "This endpoint is only usable prior to order acknowledgement and only
 *    when the order is in pending status."
 *
 * Two conditions, both required. It is tempting to treat them as one —
 * "unacknowledged orders are pending" — and that is false in a way that
 * matters: Leafly auto-cancels an unacknowledged order after fifteen
 * minutes, which produces an order that is unacknowledged AND canceled. That
 * combination is not rare, it is what every missed order looks like.
 * `decideMediaAccess` checks both and is tested against all four corners.
 *
 * ===========================================================================
 * WHAT THIS FILE REFUSES TO DO
 * ===========================================================================
 * It does not cache, persist, or log the image bytes. A government ID is the
 * highest-sensitivity data this system will ever touch, we have it for at
 * most fifteen minutes by Leafly's design, and the correct amount of it to
 * keep is none. The bytes go from Leafly to the operator's screen through
 * memory and are never written down.
 *
 * `evidence-core.ts` already maintains a forbidden-key list that includes
 * `raw_order` for the same reason; this file adds nothing to any evidence or
 * attempt-log surface beyond a byte COUNT and a content type, neither of
 * which can reconstitute an image.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import { getLeaflyConfig } from "./config";
import { leaflyFetchWithDeadline } from "./deadline-fetch";
import { leaflyOrderApiBaseUrl } from "./order-ack-core";
import {
  decideMediaAccess,
  leaflyMediaUrl,
  readOrderDetail,
  type LeaflyMediaKind,
  type LeaflyOrderDetail,
  type MediaAccessVerdict,
} from "./order-detail-core";
import { refreshLeaflyConfig } from "./runtime";
import { getLeaflyAccessToken, resetLeaflyTokenCache } from "./token";
import { loadLeaflyOrderIntegrationKey } from "./webhook-server";

/* ------------------------------------------------------------------------- *
 * 1. Loading one order for the detail view
 * ------------------------------------------------------------------------- */

export type OrderDetailResult = {
  ok: boolean;
  detail: LeaflyOrderDetail | null;
  /** Whether the ID images may be fetched right now, and why not if not. */
  mediaAccess: MediaAccessVerdict;
  /** A sentence for the operator when `ok` is false. Never a stack trace. */
  error: string | null;
};

/**
 * The columns the detail view needs. `raw_order` IS included here — it is the
 * whole point.
 *
 * `order-board-server.ts` deliberately omits `raw_order` from its LIST query
 * and its own header comment says why: "The detail view can fetch it for one
 * order." That detail view is this one. The distinction is load-bearing
 * rather than fussy — `raw_order` is a full order payload per row, so
 * selecting it for a board of forty orders moves megabytes to render a list
 * that shows none of it.
 */
const DETAIL_COLUMNS =
  "id, leafly_order_id, leafly_status, acknowledged_at, acknowledge_by, raw_order";

type DetailRow = {
  id: string;
  leafly_order_id: string | null;
  leafly_status: string | null;
  acknowledged_at: string | null;
  acknowledge_by: string | null;
  raw_order: unknown;
};

/**
 * A verdict to return when we could not even establish the facts.
 *
 * It is NOT `permanentlyClosed`, and that is deliberate. A database that is
 * unreachable is a transient fault; marking it permanent would tell the
 * operator the images are gone forever when in truth we simply failed to
 * look. On this screen, "gone forever" is the sentence that makes someone
 * stop trying and acknowledge blind.
 */
function unknownAccess(message: string): MediaAccessVerdict {
  return { allowed: false, code: "no_order_id", message, permanentlyClosed: false };
}

/**
 * Load one Leafly order in full, by its Leafly order id.
 *
 * Reads only from OUR database. It does not call Leafly, because `raw_order`
 * already holds the fetched Order payload and re-fetching would spend part of
 * the fifteen-minute window to learn something we already wrote down.
 */
export async function loadLeaflyOrderDetail(
  leaflyOrderId: string,
): Promise<OrderDetailResult> {
  const id = typeof leaflyOrderId === "string" ? leaflyOrderId.trim() : "";
  if (id === "") {
    return {
      ok: false,
      detail: null,
      mediaAccess: unknownAccess("No Leafly order number was supplied."),
      error: "No Leafly order number was supplied.",
    };
  }

  // NOTE: a CONST, not a function. `isSupabaseServiceConfigured()` type-checks
  // as a call on `Boolean` in some positions and is always truthy in others,
  // so calling it would silently invert this guard.
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      detail: null,
      mediaAccess: unknownAccess(
        "The order database is not configured on this deployment, so the order " +
          "could not be opened.",
      ),
      error: "The order database is not configured on this deployment.",
    };
  }

  let row: DetailRow | null = null;
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("leafly_orders")
      .select(DETAIL_COLUMNS)
      .eq("leafly_order_id", id)
      .maybeSingle();
    if (error) {
      return {
        ok: false,
        detail: null,
        mediaAccess: unknownAccess(
          "The order could not be read from the database, so we cannot tell " +
            "whether the ID images are still available.",
        ),
        error: `The order could not be read (${error.message}).`,
      };
    }
    row = ((data ?? null) as unknown as DetailRow | null) ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown database fault";
    return {
      ok: false,
      detail: null,
      mediaAccess: unknownAccess(
        "The order could not be read from the database, so we cannot tell " +
          "whether the ID images are still available.",
      ),
      error: `The order could not be read (${message}).`,
    };
  }

  if (row === null) {
    return {
      ok: false,
      detail: null,
      mediaAccess: unknownAccess(
        "We have no record of that Leafly order, so there is nothing to show.",
      ),
      error: "We have no record of that Leafly order.",
    };
  }

  // The access decision uses OUR columns, not the raw payload's. `raw_order`
  // is a snapshot from whenever we last fetched it; `acknowledged_at` and
  // `leafly_status` are maintained by the acknowledge and status paths and
  // are therefore the fresher truth. Reading the status out of the blob would
  // show a stale "pending" on an order that was acknowledged a minute ago and
  // invite a request that can only fail.
  const mediaAccess = decideMediaAccess({
    leaflyOrderId: row.leafly_order_id,
    acknowledgedAt: row.acknowledged_at,
    leaflyStatus: row.leafly_status,
  });

  return {
    ok: true,
    detail: readOrderDetail(row.raw_order),
    mediaAccess,
    error: null,
  };
}

/* ------------------------------------------------------------------------- *
 * 2. Fetching an ID image
 * ------------------------------------------------------------------------- */

export type MediaFetchResult =
  | {
      ok: true;
      bytes: ArrayBuffer;
      /** Echoed from Leafly. Never guessed — see the note below. */
      contentType: string;
      byteLength: number;
    }
  | {
      ok: false;
      /** A sentence for the operator. Never a stack trace, never a URL. */
      message: string;
      /** True when retrying could plausibly work. */
      retryable: boolean;
      /** For the server log only. Never rendered. */
      summary: string;
    };

/**
 * Leafly documents the response as `image/*` — jpeg, png and heic are all
 * possible and they do not say which. We echo whatever they sent.
 *
 * Defaulting to `application/octet-stream` rather than guessing `image/jpeg`
 * is the safe direction: a browser given the wrong image type may render
 * nothing with no explanation, whereas octet-stream at least fails visibly.
 * Guessing would trade a diagnosable failure for a mysterious one.
 */
const FALLBACK_CONTENT_TYPE = "application/octet-stream";

/**
 * A crude sanity bound on an ID photo.
 *
 * Not a security control — the bytes are already in memory by the time we
 * can measure them — but a guard against streaming something absurd into a
 * serverless function's heap if the endpoint ever returns the wrong thing.
 * Twenty megabytes is far beyond any ID scan and far below a memory limit.
 */
const MAX_REASONABLE_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Fetch one ID image from Leafly.
 *
 * ── WHY THE ACCESS CHECK HAPPENS BEFORE THE REQUEST ────────────────────────
 * Because the failure is otherwise unreadable. Leafly answers a request made
 * outside the window with a bare 403 or 404, and on this integration a 404
 * is indistinguishable from "that order does not exist". Deciding locally
 * first means the operator is told "this was acknowledged, the images are
 * gone permanently" instead of "404" — and it saves a call inside a
 * fifteen-minute window.
 *
 * ── WHY IT STILL HANDLES A REFUSAL FROM LEAFLY ─────────────────────────────
 * Because our columns can be stale. Leafly may have auto-cancelled the order
 * a second ago and our row will not know until the next webhook. The local
 * check is an optimisation and a better error message; Leafly remains the
 * authority, and a 403 from them is believed over our own optimism.
 */
export async function fetchLeaflyOrderMedia(input: {
  leaflyOrderId: string;
  kind: LeaflyMediaKind;
}): Promise<MediaFetchResult> {
  const detail = await loadLeaflyOrderDetail(input.leaflyOrderId);
  if (!detail.mediaAccess.allowed) {
    return {
      ok: false,
      message: detail.mediaAccess.message,
      // A permanently closed window is never retryable. Offering a retry
      // button on a door that cannot reopen wastes the operator's attention
      // during the only fifteen minutes they have.
      retryable: !detail.mediaAccess.permanentlyClosed,
      summary: `media: refused locally (${detail.mediaAccess.code})`,
    };
  }

  await refreshLeaflyConfig();
  const config = getLeaflyConfig();
  const environment = config.environment === "production" ? "production" : "sandbox";
  const orderIntegrationKey = await loadLeaflyOrderIntegrationKey();
  const key = (orderIntegrationKey ?? "").trim();
  if (key === "") {
    return {
      ok: false,
      message:
        "The Leafly order integration key is not saved yet, so we cannot ask " +
        "Leafly for the ID images. Add it in the Leafly settings screen.",
      retryable: false,
      summary: "media: no order integration key configured",
    };
  }

  const url = leaflyMediaUrl(
    leaflyOrderApiBaseUrl(environment),
    key,
    input.leaflyOrderId.trim(),
    input.kind,
  );

  // One retry, and only for a 401 — the same rule the acknowledge and fetch
  // paths follow, for the same reason: a 401 usually means the cached bearer
  // expired mid-flight, and re-minting is the documented recovery. Retrying
  // anything else here would double the latency on a screen someone is
  // watching, inside a window that is already short.
  let didRetryAuth = false;
  for (;;) {
    const token = await getLeaflyAccessToken().catch((err: unknown) => err as Error);
    if (token instanceof Error) {
      return {
        ok: false,
        message:
          "We could not sign in to Leafly, so the ID images could not be " +
          "loaded. Check the Leafly credentials in settings.",
        retryable: true,
        summary: `media: sign-in failure (${token.message})`,
      };
    }

    const attempt = await leaflyFetchWithDeadline(
      "media_fetch",
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "image/*" },
      },
      // THE flag. Without it the helper decodes the JPEG as UTF-8 and the
      // image is destroyed — measured, see deadline-fetch.ts's header.
      { binary: true },
    );

    if (!attempt.ok) {
      return {
        ok: false,
        message: attempt.verdict.message,
        retryable: attempt.verdict.safeToRetry,
        summary: `media: network failure (${attempt.detail})`,
      };
    }

    const res = attempt.response;

    if (res.status === 401 && !didRetryAuth) {
      didRetryAuth = true;
      resetLeaflyTokenCache();
      continue;
    }

    if (res.status === 403 || res.status === 404) {
      // Leafly's refusal outranks our local optimism. Both codes mean the
      // same thing in practice here, and neither is retryable: the window
      // has closed between our check and our request.
      return {
        ok: false,
        message:
          "Leafly will no longer release this customer's ID images. That " +
          "happens once an order has been acknowledged or has stopped being " +
          "pending — including when Leafly auto-cancels an order that was " +
          "not acknowledged in time. Check the customer's physical ID at the " +
          "counter as normal.",
        retryable: false,
        summary: `media: Leafly refused with HTTP ${res.status}`,
      };
    }

    if (res.status < 200 || res.status >= 300) {
      return {
        ok: false,
        message:
          `Leafly returned an unexpected response (HTTP ${res.status}) when we ` +
          `asked for the ID images. Nothing was changed on the order — you can ` +
          `try again.`,
        retryable: true,
        summary: `media: unexpected HTTP ${res.status}`,
      };
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch (err) {
      const message = err instanceof Error ? err.message : "unreadable body";
      return {
        ok: false,
        message:
          "Leafly said the ID image was available but we could not read it. " +
          "You can try again.",
        retryable: true,
        summary: `media: unreadable body (${message})`,
      };
    }

    if (bytes.byteLength === 0) {
      // A 200 with no bytes is not an image. Passing it through would render
      // a broken-image icon with no explanation, which the operator would
      // reasonably read as "we have no ID on file".
      return {
        ok: false,
        message:
          "Leafly returned an empty file for this ID image. There may be no " +
          "image on the order. Check the customer's physical ID at the counter.",
        retryable: false,
        summary: "media: HTTP 200 with a zero-length body",
      };
    }

    if (bytes.byteLength > MAX_REASONABLE_IMAGE_BYTES) {
      return {
        ok: false,
        message:
          "The ID image Leafly sent is too large to display safely. Check the " +
          "customer's physical ID at the counter.",
        retryable: false,
        summary: `media: oversized body (${bytes.byteLength} bytes)`,
      };
    }

    return {
      ok: true,
      bytes,
      contentType: res.headers.get("content-type") ?? FALLBACK_CONTENT_TYPE,
      byteLength: bytes.byteLength,
      // Note what is NOT returned and never logged: the bytes themselves, the
      // URL (which contains the integration key), and any field of the
      // customer's identity. The summary above carries a length and a status
      // and nothing that could reconstitute a person.
    };
  }
}
