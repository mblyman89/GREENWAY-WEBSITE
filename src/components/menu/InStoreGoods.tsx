/**
 * Phase 4 (G-29 item 7). Owner D45, Michael verbatim: "Q-05b-1- yes, and any
 * other upgrade, enhancement and such needed to fully utilize non cannabis
 * goods in the system and on the register and on the menu."
 *
 * A DISPLAY-ONLY "In store" list of Other Inventory (glass, papers, devices,
 * apparel) on the shop page: name, brand and shelf price of ACTIVE, IN-STOCK
 * items. No add-to-cart: online pickup orders stay cannabis-only, so these
 * are bought at the counter. Never shows cost, quantity, SKU or barcode.
 * Renders nothing when there is nothing to show or the read fails, and sits
 * in its own Suspense boundary so it can never slow the cannabis menu.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readNcCatalogForRegister } from "@/lib/noncannabis/register-stock";
import { toInStoreCards } from "@/lib/noncannabis/pos-catalog-core";

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export async function InStoreGoods() {
  if (!isSupabaseServiceConfigured) return null;
  let cards: ReturnType<typeof toInStoreCards> = [];
  try {
    cards = toInStoreCards(await readNcCatalogForRegister(createSupabaseAdminClient()));
  } catch {
    return null;
  }
  if (cards.length === 0) return null;
  return (
    <section id="in-store" className="px-3 pb-10 sm:px-4 md:px-8" aria-labelledby="in-store-heading">
      <div className="mx-auto max-w-[var(--shop-max)]">
        <h2 id="in-store-heading" className="text-xl font-black uppercase tracking-tight text-white md:text-2xl">
          Also in store
        </h2>
        <p className="mt-1 text-sm text-white/60">
          Glass, papers, accessories and apparel at the counter. Shelf prices shown are the register price. Buy these in
          store; they can&apos;t be added to an online order.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <li key={c.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-sm font-bold text-white">{c.name}</p>
              {c.brand ? <p className="text-xs text-white/50">{c.brand}</p> : null}
              <p className="mt-2 text-sm font-semibold text-white/90">{money(c.priceMinor)}</p>
              <p className="mt-1 text-[11px] uppercase tracking-wide text-white/40">In store</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
