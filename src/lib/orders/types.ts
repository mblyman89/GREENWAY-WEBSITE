/**
 * src/lib/orders/types.ts
 *
 * Shared types + display metadata for the Slice 7 order management system.
 * Mirrors the 0007_slice7_orders.sql schema. Used by the orders store, the
 * staff dashboard, the storefront checkout API, and the confirmation page.
 */

export type OrderStatus =
  | "new"
  | "acknowledged"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled"
  | "no_show";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  preparing: "Preparing",
  ready: "Ready for pickup",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** Statuses considered "active" (need staff attention) for the dashboard. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "new",
  "acknowledged",
  "preparing",
  "ready",
];

/** Statuses considered "closed" (done / will not be fulfilled). */
export const CLOSED_ORDER_STATUSES: OrderStatus[] = [
  "completed",
  "cancelled",
  "no_show",
];

/**
 * Allowed forward transitions for the primary workflow buttons. Cancel and
 * no_show are available from any active status (handled separately in the UI).
 */
export const ORDER_FORWARD_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus>> = {
  new: "acknowledged",
  acknowledged: "preparing",
  preparing: "ready",
  ready: "completed",
};

export type OrderRow = {
  id: string;
  order_number: string;
  public_token: string;
  status: OrderStatus;
  customer_first_name: string;
  customer_last_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_birthday: string | null;
  subtotal_minor_units: number;
  estimated_tax_minor_units: number;
  savings_minor_units: number;
  total_minor_units: number;
  item_count: number;
  customer_note: string | null;
  staff_note: string | null;
  reservation_expires_at: string | null;
  placed_at: string;
  acknowledged_at: string | null;
  ready_at: string | null;
  completed_at: string | null;
  handled_by: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderLineRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  brand: string | null;
  variant_label: string | null;
  quantity: number;
  price_minor_units: number;
  regular_price_minor_units: number | null;
  created_at: string;
};

export type OrderEventRow = {
  id: string;
  order_id: string;
  event_type: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus | null;
  note: string | null;
  actor_id: string | null;
  actor_label: string | null;
  created_at: string;
};

export type OrderWithLines = OrderRow & {
  lines: OrderLineRow[];
  events?: OrderEventRow[];
};

/** Shape the storefront sends to POST /api/orders. */
export type NewOrderLineInput = {
  productId?: string | null;
  variantId?: string | null;
  productName: string;
  brand?: string | null;
  variantLabel?: string | null;
  quantity: number;
  priceMinorUnits: number;
  regularPriceMinorUnits?: number | null;
};

export type NewOrderInput = {
  customerFirstName: string;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerBirthday?: string | null;
  customerNote?: string | null;
  subtotalMinorUnits: number;
  estimatedTaxMinorUnits: number;
  savingsMinorUnits: number;
  totalMinorUnits: number;
  lines: NewOrderLineInput[];
};

/** What POST /api/orders returns to the client on success. */
export type PlacedOrderResult = {
  orderNumber: string;
  publicToken: string;
};
