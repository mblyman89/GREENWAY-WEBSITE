"use client";

import Image from "next/image";
import Link from "next/link";
import { createContext, useContext, useMemo, useState } from "react";
import { greenwayBusiness } from "@/content/business";
import { formatMinorCurrency } from "@/lib/leafly/format";

type MockCartItemInput = {
  productId: string;
  productName: string;
  brand: string;
  category: string;
  strainType: string;
  variantId: string;
  variantLabel: string;
  priceMinorUnits: number;
  quantity: number;
};

type MockCartItem = MockCartItemInput & {
  lineId: string;
};

type CartContextValue = {
  items: MockCartItem[];
  itemCount: number;
  subtotalMinorUnits: number;
  addItem: (item: MockCartItemInput) => void;
  removeItem: (lineId: string) => void;
  clearCart: () => void;
  openCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function useMockCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useMockCart must be used within CartProvider");
  return context;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MockCartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  const subtotalMinorUnits = items.reduce((total, item) => total + item.priceMinorUnits * item.quantity, 0);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount,
      subtotalMinorUnits,
      addItem: (nextItem) => {
        setItems((currentItems) => {
          const existingItem = currentItems.find((item) => item.variantId === nextItem.variantId);
          if (existingItem) {
            return currentItems.map((item) =>
              item.variantId === nextItem.variantId
                ? { ...item, quantity: item.quantity + nextItem.quantity }
                : item,
            );
          }

          return [...currentItems, { ...nextItem, lineId: `${nextItem.productId}-${nextItem.variantId}` }];
        });
        setIsOpen(true);
      },
      removeItem: (lineId) => setItems((currentItems) => currentItems.filter((item) => item.lineId !== lineId)),
      clearCart: () => setItems([]),
      openCart: () => setIsOpen(true),
    }),
    [itemCount, items, subtotalMinorUnits],
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

function CartDrawer({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { items, itemCount, subtotalMinorUnits, removeItem, clearCart } = useMockCart();

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
                  <article key={item.lineId} className="rounded-[1.15rem] border border-white/10 bg-[#111] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">{item.brand}</p>
                        <h3 className="mt-1 text-lg font-black leading-tight text-white">{item.productName}</h3>
                        <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--greenway)]">{item.category} · {item.strainType}</p>
                      </div>
                      <button type="button" onClick={() => removeItem(item.lineId)} className="rounded-full border border-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-zinc-300 transition hover:border-red-300 hover:text-red-200">
                        Remove
                      </button>
                    </div>
                    <div className="mt-4 flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm">
                      <span className="font-bold text-zinc-300">{item.quantity} × {item.variantLabel}</span>
                      <span className="font-black text-[var(--orange)]">{formatMinorCurrency(item.priceMinorUnits * item.quantity)}</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="mt-auto rounded-[1.15rem] border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-black uppercase tracking-[0.16em] text-zinc-400">Subtotal</span>
                  <span className="text-xl font-black text-[var(--orange)]">{formatMinorCurrency(subtotalMinorUnits)}</span>
                </div>
              </div>

              <div className="grid gap-3">
                <Link href="/checkout" onClick={onClose} className="w-full rounded-full bg-[var(--orange)] px-6 py-3.5 text-center text-sm font-black uppercase tracking-[0.14em] text-black transition hover:bg-white">
                  Review Order
                </Link>
                <Link href="/menu" onClick={onClose} className="w-full rounded-full border border-white/15 px-6 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-white transition hover:border-[var(--greenway)] hover:text-[var(--greenway)]">
                  Keep Shopping
                </Link>
                <button type="button" onClick={clearCart} className="w-full rounded-full border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-red-300 hover:text-red-200">
                  Clear Cart
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
