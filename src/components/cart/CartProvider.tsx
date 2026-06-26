"use client";

import Image from "next/image";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { greenwayBusiness } from "@/content/business";
import { formatMinorCurrency } from "@/lib/leafly/format";

// ---------------------------------------------------------------------------
// Cart + runtime inventory store
//
// The cart is the real customer-facing ordering experience. State is persisted
// to localStorage so a refresh keeps the cart, and a separate inventory ledger
// tracks units "sold" at checkout so on-page stock counts go down as if the
// product left the shelf. The next fresh spreadsheet upload through the
// transformer resets all counts to source-of-truth POS values.
//
// Tax: WA cannabis retail prices already include the 37% excise tax. What is
// added at the register is local sales tax. Port Orchard's combined sales tax
// rate is ~9.0%, so we surface an honest "Taxes (Est.)" line at that rate and
// note final tax is confirmed in store.
// ---------------------------------------------------------------------------

const CART_STORAGE_KEY = "greenway-cart-v1";
const INVENTORY_STORAGE_KEY = "greenway-inventory-ledger-v1";
export const ESTIMATED_SALES_TAX_RATE = 0.09;

type CartItemInput = {
  productId: string;
  productName: string;
  brand: string;
  category: string;
  strainType: string;
  variantId: string;
  variantLabel: string;
  priceMinorUnits: number;
  regularPriceMinorUnits?: number;
  quantity: number;
  inventoryLevel?: number;
};

type CartItem = CartItemInput & {
  lineId: string;
  regularPriceMinorUnits: number;
  inventoryLevel: number;
};

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  subtotalMinorUnits: number;
  regularSubtotalMinorUnits: number;
  savingsMinorUnits: number;
  estimatedTaxMinorUnits: number;
  totalMinorUnits: number;
  addItem: (item: CartItemInput) => void;
  removeItem: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  /** Remaining sellable units for a variant after any runtime sales. */
  remainingInventory: (variantId: string, baseLevel: number) => number;
  /** Record a completed sale so on-page stock counts decrement. */
  recordSale: (lines: { variantId: string; quantity: number }[]) => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function useMockCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useMockCart must be used within CartProvider");
  return context;
}

/** Backwards-compatible alias for the live cart hook. */
export const useCart = useMockCart;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [soldLedger, setSoldLedger] = useState<Record<string, number>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount (after first paint to avoid SSR mismatch).
  useEffect(() => {
    setItems(readJson<CartItem[]>(CART_STORAGE_KEY, []));
    setSoldLedger(readJson<Record<string, number>>(INVENTORY_STORAGE_KEY, {}));
    setHydrated(true);
  }, []);

  // Persist cart + ledger whenever they change (post-hydration only).
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage may be unavailable; ignore */
    }
  }, [items, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(soldLedger));
    } catch {
      /* ignore */
    }
  }, [soldLedger, hydrated]);

  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  const subtotalMinorUnits = items.reduce((total, item) => total + item.priceMinorUnits * item.quantity, 0);
  const regularSubtotalMinorUnits = items.reduce(
    (total, item) => total + item.regularPriceMinorUnits * item.quantity,
    0,
  );
  const savingsMinorUnits = Math.max(0, regularSubtotalMinorUnits - subtotalMinorUnits);
  const estimatedTaxMinorUnits = Math.round(subtotalMinorUnits * ESTIMATED_SALES_TAX_RATE);
  const totalMinorUnits = subtotalMinorUnits + estimatedTaxMinorUnits;

  const remainingInventory = useCallback(
    (variantId: string, baseLevel: number) => Math.max(0, baseLevel - (soldLedger[variantId] ?? 0)),
    [soldLedger],
  );

  const recordSale = useCallback((lines: { variantId: string; quantity: number }[]) => {
    setSoldLedger((current) => {
      const next = { ...current };
      for (const line of lines) {
        next[line.variantId] = (next[line.variantId] ?? 0) + line.quantity;
      }
      return next;
    });
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount,
      subtotalMinorUnits,
      regularSubtotalMinorUnits,
      savingsMinorUnits,
      estimatedTaxMinorUnits,
      totalMinorUnits,
      addItem: (nextItem) => {
        const regular = nextItem.regularPriceMinorUnits ?? nextItem.priceMinorUnits;
        const baseLevel = nextItem.inventoryLevel ?? 99;
        setItems((currentItems) => {
          const existingItem = currentItems.find((item) => item.variantId === nextItem.variantId);
          if (existingItem) {
            const capped = Math.min(existingItem.quantity + nextItem.quantity, Math.max(1, existingItem.inventoryLevel));
            return currentItems.map((item) =>
              item.variantId === nextItem.variantId ? { ...item, quantity: capped } : item,
            );
          }
          return [
            ...currentItems,
            {
              ...nextItem,
              regularPriceMinorUnits: regular,
              inventoryLevel: baseLevel,
              lineId: `${nextItem.productId}-${nextItem.variantId}`,
            },
          ];
        });
        setIsOpen(true);
      },
      removeItem: (lineId) => setItems((currentItems) => currentItems.filter((item) => item.lineId !== lineId)),
      setQuantity: (lineId, quantity) =>
        setItems((currentItems) =>
          currentItems
            .map((item) =>
              item.lineId === lineId
                ? { ...item, quantity: Math.min(Math.max(1, quantity), Math.max(1, item.inventoryLevel)) }
                : item,
            )
            .filter((item) => item.quantity > 0),
        ),
      clearCart: () => setItems([]),
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      remainingInventory,
      recordSale,
    }),
    [
      items,
      itemCount,
      subtotalMinorUnits,
      regularSubtotalMinorUnits,
      savingsMinorUnits,
      estimatedTaxMinorUnits,
      totalMinorUnits,
      remainingInventory,
      recordSale,
    ],
  );

  return (
    <CartContext.Provider value={value}>
      {children}
      <FloatingCartButton itemCount={itemCount} subtotalMinorUnits={subtotalMinorUnits} onOpen={() => setIsOpen(true)} />
      <CartDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </CartContext.Provider>
  );
}

function CartIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.2 6.5h15.1l-1.7 8.1a2 2 0 0 1-2 1.6H8.8a2 2 0 0 1-2-1.7L5.4 3.8H2.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.4 20.2h.01M17.2 20.2h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8L18 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FloatingCartButton({ itemCount, subtotalMinorUnits, onOpen }: { itemCount: number; subtotalMinorUnits: number; onOpen: () => void }) {
  if (itemCount === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-full border border-[var(--orange)] bg-[var(--orange)] px-5 py-4 text-sm font-black uppercase tracking-[0.12em] text-black shadow-2xl shadow-orange-950/50 transition hover:-translate-y-1 hover:bg-white"
      aria-label="Open cart"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-xs text-white">{itemCount}</span>
      <span>Cart</span>
      <span className="hidden sm:inline">{formatMinorCurrency(subtotalMinorUnits)}</span>
    </button>
  );
}

function DrawerHeader({ itemCount, onClose }: { itemCount: number; onClose: () => void }) {
  return (
    <div className="bg-black px-5 pb-4 pt-5 sm:border-b sm:border-white/10 sm:px-6 sm:pt-7">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#202020] text-[var(--orange)] shadow-lg shadow-black/30 ring-1 ring-white/10">
            <CartIcon />
            {itemCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--greenway)] px-1 text-[0.62rem] font-black text-black ring-2 ring-black">{itemCount}</span>
            ) : null}
          </span>
          <h2 className="text-[2rem] font-black leading-none tracking-tight text-white">Your Cart</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--orange)] text-2xl font-light leading-none text-black shadow-lg shadow-orange-950/35 transition hover:rotate-90 hover:bg-white sm:h-11 sm:w-11"
          aria-label="Close cart"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function StoreCard() {
  return (
    <section className="-mx-4 overflow-hidden bg-[#4a2c18] shadow-[0_10px_28px_rgba(0,0,0,0.38)] sm:mx-0" aria-label="Greenway Marijuana store details">
      <div className="flex h-[5rem] w-[calc(100%+2rem)] items-stretch bg-[#4a2c18] sm:w-full">
        <div className="relative w-[6rem] shrink-0 overflow-hidden bg-transparent sm:w-[5.1rem]">
          <Image
            src={greenwayBusiness.assets.blackGoldLogoTransparent}
            alt={`${greenwayBusiness.name} logo`}
            fill
            sizes="82px"
            className="translate-x-3 object-contain p-1 sm:translate-x-0 sm:p-2"
            priority
          />
        </div>

        <div className="flex min-w-0 flex-1 items-center px-3 py-2 text-white">
          <div className="grid gap-1.5 text-[0.66rem] font-extrabold uppercase leading-none tracking-[0.018em] text-white/92 min-[390px]:text-[0.7rem] sm:text-[0.55rem]">
            <p className="whitespace-nowrap">{greenwayBusiness.address.full}</p>
            <p className="flex items-center gap-1.5 whitespace-nowrap text-white">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#18a957] shadow-[0_0_0_2px_rgba(24,169,87,0.18)]" aria-hidden="true" />
              Open until 11:00 PM
            </p>
            <p className="flex items-center gap-1.5 whitespace-nowrap text-white">
              <svg className="h-2.5 w-2.5 shrink-0 text-white/80" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6.6 3.7 9 3.1a1.5 1.5 0 0 1 1.7.86l1 2.35a1.5 1.5 0 0 1-.38 1.7L10.15 9.1a10.2 10.2 0 0 0 4.78 4.78l1.1-1.17a1.5 1.5 0 0 1 1.7-.38l2.35 1a1.5 1.5 0 0 1 .86 1.7l-.6 2.4a2.35 2.35 0 0 1-2.28 1.78A14.95 14.95 0 0 1 4.82 5.98 2.35 2.35 0 0 1 6.6 3.7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {greenwayBusiness.phone.display}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyCartState({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-3 py-10 text-center sm:py-12">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[#202020] text-zinc-500 shadow-inner shadow-black ring-1 ring-white/10 sm:h-28 sm:w-28">
        <CartIcon className="h-11 w-11 sm:h-12 sm:w-12" />
      </span>
      <p className="mt-7 text-2xl font-black tracking-tight text-white">Your cart is empty</p>
      <p className="mt-3 max-w-xs text-sm leading-6 text-zinc-400">Browse our menu and add some products to get started.</p>
      <Link href="/menu" onClick={onClose} className="mt-7 inline-flex rounded-full bg-[var(--orange)] px-8 py-3.5 text-sm font-black uppercase tracking-[0.12em] text-black shadow-lg shadow-orange-950/25 transition hover:-translate-y-0.5 hover:bg-white">
        Browse Menu
      </Link>
    </div>
  );
}

function QuantityStepper({ item }: { item: CartItem }) {
  const { setQuantity } = useMockCart();
  const atMax = item.quantity >= Math.max(1, item.inventoryLevel);
  return (
    <div className="inline-flex items-center overflow-hidden rounded-full border border-white/15 bg-black/40">
      <button
        type="button"
        onClick={() => setQuantity(item.lineId, item.quantity - 1)}
        className="flex h-9 w-9 items-center justify-center text-xl font-black text-white transition hover:bg-white hover:text-black"
        aria-label="Decrease quantity"
      >
        −
      </button>
      <span className="flex h-9 min-w-9 items-center justify-center px-1 text-sm font-black text-white">{item.quantity}</span>
      <button
        type="button"
        disabled={atMax}
        onClick={() => setQuantity(item.lineId, item.quantity + 1)}
        className="flex h-9 w-9 items-center justify-center text-xl font-black text-white transition hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:text-zinc-600 disabled:hover:bg-transparent"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

function CartLine({ item, onRemove }: { item: CartItem; onRemove: (lineId: string) => void }) {
  const hasSale = item.regularPriceMinorUnits > item.priceMinorUnits;
  const savedPercent = hasSale
    ? Math.round(((item.regularPriceMinorUnits - item.priceMinorUnits) / item.regularPriceMinorUnits) * 100)
    : 0;
  return (
    <article className="rounded-[1.15rem] border border-white/10 bg-[#111] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{item.brand}</p>
          <h3 className="mt-1 text-lg font-black leading-tight text-white">{item.productName}</h3>
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--greenway)]">{item.category} · {item.strainType}</p>
          {hasSale ? (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[var(--orange)]/15 px-2.5 py-1 text-[0.64rem] font-black uppercase tracking-[0.1em] text-[var(--orange)]">
              {savedPercent}% off
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onRemove(item.lineId)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition hover:border-red-300 hover:text-red-200"
          aria-label="Remove item"
        >
          <TrashIcon />
        </button>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-white/5 p-3">
        <QuantityStepper item={item} />
        <div className="text-right leading-tight">
          {hasSale ? (
            <p className="text-xs font-black text-zinc-500 line-through">{formatMinorCurrency(item.regularPriceMinorUnits * item.quantity)}</p>
          ) : null}
          <p className="text-lg font-black text-[var(--orange)]">{formatMinorCurrency(item.priceMinorUnits * item.quantity)}</p>
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.08em] text-zinc-500">{item.variantLabel || "each"}</p>
        </div>
      </div>
    </article>
  );
}

function SummaryLine({ label, value, accent = false, muted = false }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className={`font-bold ${muted ? "text-zinc-500" : "text-zinc-300"}`}>{label}</span>
      <span className={`font-black ${accent ? "text-[var(--greenway)]" : "text-white"}`}>{value}</span>
    </div>
  );
}

function CartDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const {
    items,
    itemCount,
    subtotalMinorUnits,
    savingsMinorUnits,
    estimatedTaxMinorUnits,
    totalMinorUnits,
    removeItem,
    clearCart,
  } = useMockCart();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70]" aria-hidden={false}>
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/78 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close cart overlay"
      />
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-[28rem] flex-col overflow-hidden border-l border-white/10 bg-[#080808] text-white shadow-2xl shadow-black"
        role="dialog"
        aria-modal="true"
        aria-label="Your cart"
      >
        <DrawerHeader itemCount={itemCount} onClose={onClose} />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-5">
          <StoreCard />

          {items.length === 0 ? (
            <EmptyCartState onClose={onClose} />
          ) : (
            <div className="flex flex-1 flex-col gap-4 px-5 pt-4 sm:px-6">
              <div className="grid gap-3">
                {items.map((item) => (
                  <CartLine key={item.lineId} item={item} onRemove={removeItem} />
                ))}
              </div>

              <div className="mt-auto grid gap-2.5 rounded-[1.15rem] border border-white/10 bg-white/5 p-4">
                <SummaryLine label="Subtotal" value={formatMinorCurrency(subtotalMinorUnits)} />
                <SummaryLine label="Taxes (Est.)" value={formatMinorCurrency(estimatedTaxMinorUnits)} />
                {savingsMinorUnits > 0 ? (
                  <SummaryLine label="Savings" value={`−${formatMinorCurrency(savingsMinorUnits)}`} accent />
                ) : null}
                <div className="mt-1 flex items-center justify-between gap-4 border-t border-white/10 pt-3">
                  <span className="text-base font-black uppercase tracking-[0.14em] text-white">Total</span>
                  <span className="text-2xl font-black text-[var(--orange)]">{formatMinorCurrency(totalMinorUnits)}</span>
                </div>
              </div>

              <div className="grid gap-3">
                <Link href="/checkout" onClick={onClose} className="w-full rounded-full bg-[var(--orange)] px-6 py-3.5 text-center text-sm font-black uppercase tracking-[0.14em] text-black transition hover:bg-white">
                  Proceed to Checkout
                </Link>
                <Link href="/menu" onClick={onClose} className="w-full rounded-full border border-white/15 px-6 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
                  Keep Shopping
                </Link>
                <button type="button" onClick={clearCart} className="w-full rounded-full border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-red-300 hover:text-red-200">
                  Clear Cart
                </button>
              </div>

              <p className="px-1 pt-1 text-center text-[0.62rem] leading-4 text-zinc-600">
                Taxes are estimated. Final pricing, taxes, and purchase limits are confirmed in store. Valid 21+ ID required at pickup.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
