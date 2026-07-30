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
  /**
   * SLICE 113 — optional friendly pool name shown to the customer in place of
   * order_number (migration 0147). Nullable + NON-unique so a short pool of
   * names can recycle. Absent on rows read before the column exists; the app
   * shows order_number whenever this is null/blank (resolveOrderDisplay).
   */
  display_name?: string | null;
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
  /** Placement-time WAC 314-55-095 soft-check flag (migration 0096). */
  limit_flag?: boolean;
  /** Placement-time per-bucket overage reasons (migration 0096). */
  limit_reasons?: string[] | null;
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
  /** Placement-time category slug snapshot (migration 0096). Null on legacy rows. */
  category?: string | null;
  quantity: number;
  price_minor_units: number;
  regular_price_minor_units: number | null;
  /**
   * AN-1 — sale-time grams-per-unit snapshot (migration 0122). Null/absent on
   * legacy rows and unknown-weight items (mg edibles, packs, "each"). Postgres
   * numeric may deserialize as string; consumers normalize via
   * variant-grams-core.normalizeUnitGrams.
   */
  unit_grams?: number | string | null;
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
  /** CLIENT-claimed unit price — a cross-check only; the server reprices. */
  priceMinorUnits: number;
  regularPriceMinorUnits?: number | null;
};

/** A line as persisted by the server after authoritative repricing (S-2a). */
export type PricedNewOrderLine = {
  productId: string | null;
  variantId: string | null;
  productName: string;
  brand: string | null;
  variantLabel: string | null;
  /** Server-resolved category slug snapshot (limit bucket + tax divisor). */
  category: string;
  quantity: number;
  /** SERVER-computed final unit price (minor units, tax-inclusive). */
  priceMinorUnits: number;
  regularPriceMinorUnits: number;
  /** AN-1 — grams one unit weighs (from the variant label; null = unknown). */
  unitGrams?: number | null;
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

/**
 * What the server persists after authoritative repricing + the placement-time
 * sales-limit soft check (S-1a / S-2a). Money fields here are SERVER-computed.
 */
export type PersistOrderInput = {
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
  /** WAC 314-55-095 placement soft-check result. */
  limitFlag: boolean;
  limitReasons: string[];
  lines: PricedNewOrderLine[];
};

/** What POST /api/orders returns to the client on success. */
export type PlacedOrderResult = {
  orderNumber: string;
  /**
   * SLICE 113 — the friendly pool name assigned at placement, or null when the
   * pool is empty/unset. The route + notifications show `displayName ??
   * orderNumber` (resolveOrderDisplay) so the customer sees the fun name when
   * there is one and the GWY number otherwise.
   */
  displayName?: string | null;
  publicToken: string;
  /**
   * Internal orders.id (GW-024): lets the placement route link the receipt
   * print job and write notification-failure notes onto the order's
   * timeline. NEVER include this in the customer-facing response — the
   * route strips it (publicToken is the only guest credential).
   */
  orderId: string;
};
