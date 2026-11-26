"use client";
/**
 * OI-ACC S6 - Add-to-cart for one Other Inventory item. Rendered ONLY when the
 * owner's online toggle is ON; checkout re-checks the toggle, price and stock
 * server-side regardless. The `nc-<uuid>` key keeps the line off CCRS.
 */
import { useCart } from "@/components/cart/CartProvider";

export function AddAccessoryButton(props: {
  ncKey: string;
  name: string;
  brand: string | null;
  priceMinor: number;
  maxQty: number;
}) {
  const { addItem } = useCart();
  return (
    <button
      type="button"
      onClick={() =>
        addItem({
          productId: props.ncKey,
          variantId: props.ncKey,
          productName: props.name,
          brand: props.brand ?? "",
          category: "accessories",
          strainType: "",
          variantLabel: "",
          priceMinorUnits: props.priceMinor,
          regularPriceMinorUnits: props.priceMinor,
          quantity: 1,
          inventoryLevel: Math.max(1, Math.min(50, props.maxQty)),
        })
      }
      className="mt-3 inline-flex items-center justify-center rounded-full bg-[var(--greenway)] px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-black transition hover:brightness-110"
    >
      Add to cart
    </button>
  );
}
