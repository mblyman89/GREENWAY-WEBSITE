/**
 * src/lib/pos/pickup-offline-core.ts — D170 O14 (owner 2026-11-04: "Is it
 * possible to include online orders and pickup orders to the offline mode?
 * ... I want to make sure we are fully hardened and prepared for any
 * situation.")
 *
 * PURE. The pickup queue with no internet.
 *
 * A NEW website or Leafly order cannot reach an iPad that has no internet:
 * it lands on our server, and the iPad cannot hear it until a path comes
 * back (the enterprise answer is a cellular failover router, see the SOP).
 * What the register CAN do is keep the orders it already knew about. While
 * online it saves a PICKUP BOOK in the encrypted store: the queue as last
 * read, plus for each order a read-only "pack" (the counter detail and the
 * load lines with the linked member) from /api/pos/pickup { pack: true }.
 *
 * Offline the queue opens from the book (with its age), an order's detail
 * shows from its pack, and "Load into sale" builds the sale from the pack
 * exactly like an online load: the sale carries the order id, is charged
 * with the normal ID gate and cash, and is queued like any offline sale.
 * At sync the server re-judges the sale as always and closes the website
 * order ONLY if it is still active; if it was cancelled or picked up
 * elsewhere meanwhile, the sale stands (the customer paid for real goods)
 * and an audit row tells the manager (sync-store, D170 O14).
 *
 * Cancel, confirm / mark ready and change items stay online-only: they
 * change the order at Leafly and on the website, which only a live server
 * can do safely.
 */
import type { LoadedOrderLine } from "./order-to-cart-core";

export const PICKUP_BOOK_VERSION = 1;
/** Re-read the queue while online at most this often. */
export const PICKUP_BOOK_REFRESH_MS = 2 * 60_000;
/** A pack older than this is re-fetched (the cart may have changed). */
export const PICKUP_PACK_REFRESH_MS = 15 * 60_000;
/** Packs fetched per refresh round (keeps each round light). */
export const PICKUP_PACKS_PER_ROUND = 8;
/** Hard ceilings so a bad response can never fill the iPad. */
export const PICKUP_BOOK_MAX_ORDERS = 60;
export const PICKUP_PACK_MAX_LINES = 80;

export type PickupBookEntry = Record<string, unknown> & { orderId: string; orderNumber: string };

export type PickupLoaded = {
  orderId: string;
  orderNumber: string;
  customerLabel: string;
  customerNote: string | null;
  lines: LoadedOrderLine[];
  member: { customerId: string; label: string; points: number; tierName: string | null } | null;
  origin?: string;
  originLabel?: string;
  isMarketplace?: boolean;
};

export type PickupPack = {
  /** The counter detail as the server sent it (rendered by the modal). */
  detail: Record<string, unknown> & { orderId: string };
  loaded: PickupLoaded;
  at: number;
};

export type PickupBook = {
  v: number;
  at: number;
  queue: PickupBookEntry[];
  packs: Record<string, PickupPack>;
  /** Orders handed over offline on THIS iPad, hidden until the server agrees. */
  handedOver: string[];
};

export function emptyPickupBook(): PickupBook {
  return { v: PICKUP_BOOK_VERSION, at: 0, queue: [], packs: {}, handedOver: [] };
}

function s(v: unknown, max = 300): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export function parseQueueEntry(raw: unknown): PickupBookEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const orderId = s(r.orderId, 64);
  const orderNumber = s(r.orderNumber, 64);
  if (!orderId || !orderNumber) return null;
  return { ...r, orderId, orderNumber };
}

function parseLine(raw: unknown): LoadedOrderLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const quantity = typeof r.quantity === "number" && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : null;
  const productName = s(r.productName, 300);
  if (quantity === null || !productName) return null;
  return {
    productId: s(r.productId, 64),
    variantId: s(r.variantId, 64),
    productName,
    quantity,
  } as LoadedOrderLine;
}

export function parseLoaded(raw: unknown): PickupLoaded | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const orderId = s(r.orderId, 64);
  const orderNumber = s(r.orderNumber, 64);
  if (!orderId || !orderNumber || !Array.isArray(r.lines)) return null;
  const lines: LoadedOrderLine[] = [];
  for (const l of r.lines) {
    const p = parseLine(l);
    if (p) lines.push(p);
    if (lines.length >= PICKUP_PACK_MAX_LINES) break;
  }
  let member: PickupLoaded["member"] = null;
  if (r.member && typeof r.member === "object") {
    const m = r.member as Record<string, unknown>;
    const customerId = s(m.customerId, 64);
    if (customerId) {
      member = {
        customerId,
        label: s(m.label, 120) ?? "Customer",
        points: typeof m.points === "number" && Number.isFinite(m.points) ? m.points : 0,
        tierName: s(m.tierName, 80),
      };
    }
  }
  return {
    orderId,
    orderNumber,
    customerLabel: s(r.customerLabel, 120) ?? "Customer",
    customerNote: s(r.customerNote, 2000),
    lines,
    member,
    origin: s(r.origin, 40) ?? undefined,
    originLabel: s(r.originLabel, 80) ?? undefined,
    isMarketplace: r.isMarketplace === true,
  };
}

/** One pack from the route's `{ pack: { detail, loaded } }` body. */
export function packFromResponse(body: unknown, nowMs: number): PickupPack | null {
  if (!body || typeof body !== "object") return null;
  const p = (body as { pack?: unknown }).pack;
  if (!p || typeof p !== "object") return null;
  const d = (p as { detail?: unknown }).detail;
  const loaded = parseLoaded((p as { loaded?: unknown }).loaded);
  if (!d || typeof d !== "object" || !loaded) return null;
  const detail = d as Record<string, unknown>;
  if (s(detail.orderId, 64) !== loaded.orderId) return null;
  return { detail: { ...detail, orderId: loaded.orderId }, loaded, at: nowMs };
}

export function parsePickupBook(raw: string | null | undefined): PickupBook | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o?.v !== PICKUP_BOOK_VERSION || typeof o.at !== "number" || !Array.isArray(o.queue)) return null;
    const queue: PickupBookEntry[] = [];
    for (const q of o.queue) {
      const e = parseQueueEntry(q);
      if (e) queue.push(e);
      if (queue.length >= PICKUP_BOOK_MAX_ORDERS) break;
    }
    const packs: Record<string, PickupPack> = {};
    const rawPacks = o.packs && typeof o.packs === "object" ? (o.packs as Record<string, unknown>) : {};
    for (const e of queue) {
      const rp = rawPacks[e.orderId] as { detail?: unknown; loaded?: unknown; at?: unknown } | undefined;
      if (!rp) continue;
      const pack = packFromResponse({ pack: rp }, typeof rp.at === "number" ? rp.at : 0);
      if (pack && pack.loaded.orderId === e.orderId) packs[e.orderId] = pack;
    }
    const handedOver = Array.isArray(o.handedOver)
      ? o.handedOver.filter((x): x is string => typeof x === "string").slice(0, PICKUP_BOOK_MAX_ORDERS)
      : [];
    return { v: PICKUP_BOOK_VERSION, at: o.at, queue, packs, handedOver };
  } catch {
    return null;
  }
}

/**
 * A fresh queue read replaces the queue; packs for orders that left the
 * queue are dropped, and the "handed over offline" marks are forgotten once
 * the server no longer lists the order (the sync closed it).
 */
export function applyQueueRead(book: PickupBook | null, queueRaw: unknown, nowMs: number): PickupBook | null {
  if (!Array.isArray(queueRaw)) return null;
  const queue: PickupBookEntry[] = [];
  for (const q of queueRaw) {
    const e = parseQueueEntry(q);
    if (e) queue.push(e);
    if (queue.length >= PICKUP_BOOK_MAX_ORDERS) break;
  }
  const ids = new Set(queue.map((q) => q.orderId));
  const prev = book ?? emptyPickupBook();
  const packs: Record<string, PickupPack> = {};
  for (const [id, p] of Object.entries(prev.packs)) if (ids.has(id)) packs[id] = p;
  return { v: PICKUP_BOOK_VERSION, at: nowMs, queue, packs, handedOver: prev.handedOver.filter((id) => ids.has(id)) };
}

/** Orders whose pack is missing or old, oldest need first, at most one round. */
export function packsToFetch(book: PickupBook | null, nowMs: number): string[] {
  if (!book) return [];
  const need = book.queue
    .map((q) => q.orderId)
    .filter((id) => {
      const p = book.packs[id];
      return !p || nowMs - p.at >= PICKUP_PACK_REFRESH_MS || p.at > nowMs + 5 * 60_000;
    });
  return need.slice(0, PICKUP_PACKS_PER_ROUND);
}

export function withPack(book: PickupBook, pack: PickupPack): PickupBook {
  if (!book.queue.some((q) => q.orderId === pack.loaded.orderId)) return book;
  return { ...book, packs: { ...book.packs, [pack.loaded.orderId]: pack } };
}

/** Mark an order handed over offline on this iPad (hidden from the offline queue). */
export function markHandedOver(book: PickupBook, orderId: string): PickupBook {
  if (book.handedOver.includes(orderId)) return book;
  return { ...book, handedOver: [...book.handedOver, orderId] };
}

/** The queue the offline modal shows: minus orders already handed over here. */
export function offlineQueue(book: PickupBook | null): PickupBookEntry[] {
  if (!book) return [];
  const gone = new Set(book.handedOver);
  return book.queue.filter((q) => !gone.has(q.orderId));
}

export function pickupBookDue(book: PickupBook | null, nowMs: number): boolean {
  return !book || nowMs - book.at >= PICKUP_BOOK_REFRESH_MS || book.at > nowMs + 5 * 60_000;
}

/** One line for the cashier about the saved queue's age. */
export function pickupBookAgeNote(book: PickupBook | null, nowMs: number): string {
  if (!book || book.at <= 0) return "Offline — this iPad has not saved the online orders yet.";
  const mins = Math.max(0, Math.round((nowMs - book.at) / 60_000));
  const words = mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
  return `Offline — showing the online orders saved ${words} ago. New orders placed since then cannot reach this iPad until the internet is back. Cancel, confirm and change items need the internet.`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPickupOfflineCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("pickup-offline-core FAIL:", m);
    }
  };
  const now = 10_000_000;
  const q = [
    { orderId: "o1", orderNumber: "GWY-1", displayName: "Happy Otter", customerLabel: "Sam K.", totalMinor: 2500 },
    { orderId: "o2", orderNumber: "GWY-2", displayName: "Calm Fox", customerLabel: "Ann B.", totalMinor: 4000 },
    { orderNumber: "junk" },
  ];
  const book = applyQueueRead(null, q, now);
  ok(!!book && book.queue.length === 2, "queue read keeps valid entries only");
  ok(book!.queue[0].displayName === "Happy Otter", "entry fields are kept for the modal");
  ok(applyQueueRead(null, { nope: 1 }, now) === null, "a non-array queue is refused");
  ok(packsToFetch(book, now).join() === "o1,o2", "every order without a pack is fetched");

  const body = {
    pack: {
      detail: { orderId: "o1", orderNumber: "GWY-1", totalMinor: 2500, lines: [] },
      loaded: {
        orderId: "o1",
        orderNumber: "GWY-1",
        customerLabel: "Sam K.",
        customerNote: null,
        lines: [{ productId: "p1", variantId: "v1", productName: "Blue Dream", quantity: 2 }, { productName: "", quantity: 1 }],
        member: { customerId: "c1", label: "Sam K.", points: 120, tierName: "Gold" },
        isMarketplace: false,
      },
    },
  };
  const pack = packFromResponse(body, now);
  ok(!!pack && pack.loaded.lines.length === 1 && pack.loaded.member?.points === 120, "pack parses, bad line dropped");
  ok(packFromResponse({ pack: { ...body.pack, detail: { orderId: "other" } } }, now) === null, "detail and load for different orders refused");
  ok(packFromResponse({ pack: { detail: { orderId: "o1" }, loaded: { orderId: "o1", orderNumber: "x" } } }, now) === null, "load without lines refused");
  ok(packFromResponse(null, now) === null, "no body refused");

  let b = withPack(book!, pack!);
  ok(!!b.packs.o1 && packsToFetch(b, now).join() === "o2", "a fresh pack is not re-fetched");
  ok(packsToFetch(b, now + PICKUP_PACK_REFRESH_MS).includes("o1"), "an old pack is re-fetched");
  const stray = packFromResponse({ pack: { detail: { orderId: "zz" }, loaded: { ...body.pack.loaded, orderId: "zz" } } }, now)!;
  ok(withPack(b, stray) === b, "a pack for an order not in the queue is ignored");

  const round = parsePickupBook(JSON.stringify(b));
  ok(!!round && round.queue.length === 2 && round.packs.o1?.loaded.lines.length === 1, "round trip keeps queue and packs");
  ok(parsePickupBook("{bad") === null && parsePickupBook(JSON.stringify({ v: 9, at: 1, queue: [] })) === null, "corrupt or old-version book is none");

  b = markHandedOver(b, "o1");
  ok(offlineQueue(b).map((x) => x.orderId).join() === "o2", "an order handed over here leaves the offline queue");
  ok(markHandedOver(b, "o1") === b, "marking twice is a no-op");
  const after = applyQueueRead(b, [q[1]], now + 1000)!;
  ok(after.handedOver.length === 0 && !after.packs.o1 && !after.packs.o2, "once the server stops listing it, the mark and pack go");
  const still = applyQueueRead(b, q, now + 1000)!;
  ok(still.handedOver.join() === "o1" && !!still.packs.o1, "while the server still lists it (sync pending), it stays hidden");

  ok(pickupBookDue(null, now) && !pickupBookDue(b, now + 1000) && pickupBookDue(b, now + PICKUP_BOOK_REFRESH_MS), "refresh cadence");
  ok(/not saved/.test(pickupBookAgeNote(null, now)), "age note with no book");
  ok(/saved 5 min ago/.test(pickupBookAgeNote(b, now + 5 * 60_000)), "age note says how old");
  ok(/New orders placed since then cannot reach/.test(pickupBookAgeNote(b, now)), "age note warns new orders cannot arrive");
  const big = applyQueueRead(null, Array.from({ length: 200 }, (_, i) => ({ orderId: `x${i}`, orderNumber: `N${i}` })), now)!;
  ok(big.queue.length === PICKUP_BOOK_MAX_ORDERS && packsToFetch(big, now).length === PICKUP_PACKS_PER_ROUND, "bounded queue and rounds");
  return { passed, failed };
}
