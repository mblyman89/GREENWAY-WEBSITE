"use client";
/**
 * Browser cart: only {handle, variantId, qty}. Prices are NEVER trusted from
 * here - /api/checkout re-prices every line from the server catalog.
 * Stored in localStorage (this site has no accounts and no database) and
 * synced across tabs with the `storage` event.
 */
import { useSyncExternalStore } from "react";
import { cleanCart, CART_MAX_QTY, type CartLine } from "@/lib/catalog-core";

const KEY = "gm-cart-v1";
const EMPTY: CartLine[] = [];
let snapshot: CartLine[] | null = null;
const listeners = new Set<() => void>();

function read(): CartLine[] {
  if (snapshot) return snapshot;
  try { snapshot = cleanCart(JSON.parse(window.localStorage.getItem(KEY) || "[]")); } catch { snapshot = []; }
  return snapshot;
}
function write(next: CartLine[]) {
  snapshot = cleanCart(next);
  try { window.localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* private mode: cart lives for this tab only */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { snapshot = null; l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

export function useCart(): CartLine[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
export const cartCount = (lines: readonly CartLine[]) => lines.reduce((s, l) => s + l.qty, 0);

export const cart = {
  add(handle: string, variantId: number, qty: number) { write([...read(), { handle, variantId, qty }]); },
  setQty(handle: string, variantId: number, qty: number) {
    write(read().map((l) => (l.handle === handle && l.variantId === variantId ? { ...l, qty: Math.max(0, Math.min(CART_MAX_QTY, qty)) } : l)));
  },
  remove(handle: string, variantId: number) { write(read().filter((l) => !(l.handle === handle && l.variantId === variantId))); },
  replace(lines: CartLine[]) { write(lines); },
  clear() { write([]); },
};
