// ---------------------------------------------------------------------------
// Lightweight order helpers shared by the checkout + confirmation screens.
//
// Orders are real to the customer (a confirmed pickup order) but are not yet
// transmitted to an external POS/alerting/printing service — that integration
// is planned. The completed order is stashed in sessionStorage so the
// confirmation page can render the order number and summary after navigation.
// ---------------------------------------------------------------------------

export const LAST_ORDER_STORAGE_KEY = "greenway-last-order-v1";

export type CompletedOrderLine = {
  productName: string;
  brand: string;
  variantLabel: string;
  quantity: number;
  priceMinorUnits: number;
};

export type CompletedOrder = {
  orderNumber: string;
  placedAt: string;
  customerFirstName: string;
  lines: CompletedOrderLine[];
  subtotalMinorUnits: number;
  estimatedTaxMinorUnits: number;
  savingsMinorUnits: number;
  totalMinorUnits: number;
};

/** Generate a customer-facing order number, e.g. GWY-4F9C2A. */
export function generateOrderNumber(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GWY-${code}`;
}

export function persistCompletedOrder(order: CompletedOrder) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LAST_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* sessionStorage may be unavailable; the confirmation page falls back to the URL order number */
  }
}

export function readCompletedOrder(): CompletedOrder | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LAST_ORDER_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CompletedOrder;
  } catch {
    return null;
  }
}
