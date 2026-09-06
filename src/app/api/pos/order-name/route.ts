/**
 * POST /api/pos/order-name   (SLICE 23)
 *
 * Hand the register ONE fun name from the shared pool, for the receipt it is
 * about to print.
 *
 * Owner: "as for the fun receipt overlay for printed receipts, I think we
 * should draw from the same pool. we rarely go without internet, and if we do,
 * the fall back can be to just use the real receipt number instead of the
 * overlay."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A POST AND NOT A GET
 *
 * It looks like a read — "give me a name" — but it is not one. Every call
 * CONSUMES a name: the pool row is stamped with the next assignment sequence so
 * the rotation can guarantee that name will not come back around for a long
 * time. That is a write, and a write must never sit behind a verb that proxies,
 * browsers and prefetchers feel free to replay. A GET here would let a retry,
 * a double-tap, or an over-eager cache burn names out of the rotation and pull
 * repeats forward, which is the exact defect the rotation exists to prevent.
 *
 * WHY IT NEVER FAILS THE SALE
 *
 * The name is a flourish. The money, the tax, the inventory and the compliance
 * record are all already committed by the time this is called, and none of them
 * depend on the answer. So every failure mode — no network, no database, empty
 * pool, missing migration, a device that is offline all day — resolves to the
 * SAME safe outcome: `{ name: null }`, and the receipt prints the real receipt
 * number exactly as it always did. That is the owner's stated fallback, and it
 * is enforced here by returning 200 with a null name rather than an error
 * status, so a caller cannot accidentally treat "no name today" as a fault
 * worth surfacing to a customer standing at the counter.
 *
 * The one genuine error status is authentication. An unauthenticated caller
 * must not be able to drain the pool by hammering this endpoint, so a bad
 * device credential is a real 401/403 and consumes nothing.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { assignNextPoolNameDetailed, getOrderDisplayName } from "@/lib/orders/order-name-pool-store";
import {
  normalizeSourceOrderIdForName,
  resolveNameInheritance,
} from "@/lib/pos/order-name-prefetch-core";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // ── SLICE 26: a loaded website order INHERITS its own name ───────────────
  //
  // Owner: "the fun overlay on the printed receipt is now different from the
  // one originally attached to the online order. I am all about consistency."
  //
  // A website order was given its name server-side at insert, and the customer
  // has already seen it twice — on the confirmation screen and in their email.
  // When that order is loaded into the register, the sale carries its id, so
  // the honest answer to "what is this sale's name?" is "the one it already
  // has", not a fresh draw that contradicts the customer's inbox.
  //
  // This is ALSO why inheritance lives on THIS endpoint rather than riding
  // along with the pickup load response. The register can reach this moment
  // three ways — loading an order, resuming a snapshot after an idle lock, or
  // rebuilding the sale — and only the sale's own sourceOrderId is present on
  // all three. Answering here means every path inherits, and the load response
  // stays the shape the pickup screen already trusts.
  //
  // Reading the id is deliberately forgiving: a body that will not parse, or a
  // value that is not UUID-shaped, simply means "no order" and falls through to
  // an ordinary draw. This request must never fail a sale over a decoration.
  let sourceOrderId: string | null = null;
  try {
    const body = (await req.json()) as { sourceOrderId?: unknown } | null;
    sourceOrderId = normalizeSourceOrderIdForName(body?.sourceOrderId);
  } catch {
    sourceOrderId = null;
  }

  if (sourceOrderId !== null) {
    // getOrderDisplayName never throws and answers null for every failure —
    // unknown id, unapplied migration 0147, transient error — and null here
    // means only "nothing to inherit", which falls through to a normal draw.
    const stored = await getOrderDisplayName(sourceOrderId);
    const inheritance = resolveNameInheritance({ sourceOrderId, storedDisplayName: stored });
    if (inheritance.action === "inherit") {
      // gap is null and source is "inherited" because NOTHING was assigned:
      // the rotation is untouched, which is the second half of this fix. The
      // register used to burn a second pool name to print a receipt for an
      // order that already had one, pulling every repeat closer for nothing.
      return NextResponse.json({ name: inheritance.name, gap: null, source: "inherited" });
    }
  }

  // assignNextPoolNameDetailed() already swallows its own failures and answers
  // { name: null, source: "none" } for any of them. The try/catch is the belt
  // to that suspenders: nothing thrown from the data layer may ever reach the
  // register as a 500, because a 500 here would be a red error toast over a
  // sale that completed perfectly.
  try {
    const detail = await assignNextPoolNameDetailed();
    return NextResponse.json({
      name: detail.name,
      // The gap is how many assignments happened since this name was last
      // used (null when it has never been used). The register does not print
      // it; it is returned so the value is observable in the field, which is
      // how a too-small pool gets noticed before a customer notices it.
      gap: detail.gap,
      source: detail.source,
    });
  } catch {
    return NextResponse.json({ name: null, gap: null, source: "none" });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handlePost(req));
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}
