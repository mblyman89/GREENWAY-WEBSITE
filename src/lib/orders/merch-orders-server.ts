/**
 * R73 S1 - read Greenway Merch orders from Printful for the back office.
 *
 * Printful is the merch order record (greenwaymerch.com writes every paid
 * order there with external_id = our gm- ref). Read with the LLC's token
 * (PRINTFUL_API_TOKEN, the same one Merch Studio already uses). Never throws:
 * every failure becomes a plain-English `problem` the panel shows.
 */
import "server-only";
import { printful, printfulConfigured } from "@/lib/merch-studio/printful-client";
import {
  MERCH_BOARD_PAGES,
  MERCH_PAGE_LIMIT,
  parsePrintfulOrder,
  printfulIdFromHandle,
  type MerchOrder,
} from "./merch-orders-core";

export type MerchBoard = {
  configured: boolean;
  orders: MerchOrder[];
  /** Printful's own total (paging.total), when it sent one. */
  totalAtPrintful: number | null;
  problem: string;
};

export function emptyMerchBoard(problem = ""): MerchBoard {
  return { configured: printfulConfigured(), orders: [], totalAtPrintful: null, problem };
}

/** Newest first, up to MERCH_BOARD_PAGES x 100 orders (Printful's page max is 100). */
export async function loadMerchOrderBoard(): Promise<MerchBoard> {
  if (!printfulConfigured()) return emptyMerchBoard();
  const orders: MerchOrder[] = [];
  let totalAtPrintful: number | null = null;
  for (let page = 0; page < MERCH_BOARD_PAGES; page += 1) {
    const res = await printful<unknown[]>("GET", `/orders?limit=${MERCH_PAGE_LIMIT}&offset=${page * MERCH_PAGE_LIMIT}`);
    if (!res.ok) {
      return { configured: true, orders, totalAtPrintful, problem: `Couldn't read merch orders from Printful. ${res.error}` };
    }
    const list = Array.isArray(res.result) ? res.result : [];
    for (const raw of list) {
      const o = parsePrintfulOrder(raw);
      if (o) orders.push(o);
    }
    if (typeof res.paging?.total === "number") totalAtPrintful = res.paging.total;
    if (list.length < MERCH_PAGE_LIMIT) break;
    if (totalAtPrintful !== null && (page + 1) * MERCH_PAGE_LIMIT >= totalAtPrintful) break;
  }
  return { configured: true, orders, totalAtPrintful, problem: "" };
}

export type MerchOrderRead =
  | { ok: true; order: MerchOrder }
  | { ok: false; notFound: boolean; error: string };

export async function getMerchOrder(handle: string): Promise<MerchOrderRead> {
  const id = printfulIdFromHandle(handle);
  if (!id) return { ok: false, notFound: true, error: "Not a merch order id." };
  if (!printfulConfigured()) return { ok: false, notFound: false, error: "Printful isn't connected: add PRINTFUL_API_TOKEN in Vercel." };
  const res = await printful<unknown>("GET", `/orders/${id}`);
  if (!res.ok) return { ok: false, notFound: res.status === 404, error: res.error };
  const order = parsePrintfulOrder(res.result);
  return order ? { ok: true, order } : { ok: false, notFound: true, error: "Printful returned an unreadable order." };
}
