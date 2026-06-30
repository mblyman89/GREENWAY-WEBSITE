/**
 * src/lib/printing/receipt-core.ts
 *
 * PURE receipt-formatting logic for the Star CloudPRNT integration (Slice 37).
 * No `server-only`, no DB — safe to import from tsx test harnesses.
 *
 * Renders an online pickup order into a plain-text receipt body that the
 * TSP143IV prints directly (we serve `text/plain`). Star printers honour
 * newline + form feed and auto-cut after the job, so plain text is all we need.
 *
 * Money is in MINOR UNITS (cents) everywhere, matching the rest of the app.
 */

export type ReceiptLineInput = {
  productName: string;
  brand?: string | null;
  variantLabel?: string | null;
  quantity: number;
  priceMinorUnits: number;
};

export type ReceiptInput = {
  orderNumber: string;
  placedAt: string; // ISO timestamp
  customerName: string;
  customerPhone?: string | null;
  lines: ReceiptLineInput[];
  subtotalMinorUnits: number;
  savingsMinorUnits: number;
  estimatedTaxMinorUnits: number;
  totalMinorUnits: number;
  customerNote?: string | null;
  headerText?: string | null;
  footerText?: string | null;
};

export type ReceiptFormatOptions = {
  /** Character columns the paper supports. TSP143IV 80mm = 48, 58mm = 32. */
  columns?: number;
};

const DEFAULT_COLUMNS = 48;

/** Format minor units as a plain "$12.34" string. */
export function formatMoneyMinor(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}$${dollars}.${cents.toString().padStart(2, "0")}`;
}

/** Center a string within `columns`, never truncating. */
export function centerLine(text: string, columns = DEFAULT_COLUMNS): string {
  const trimmed = text.length > columns ? text.slice(0, columns) : text;
  const pad = Math.max(0, Math.floor((columns - trimmed.length) / 2));
  return " ".repeat(pad) + trimmed;
}

/** A full-width divider made of dashes. */
export function divider(columns = DEFAULT_COLUMNS): string {
  return "-".repeat(columns);
}

/**
 * Lay a label on the left and an amount on the right within `columns`. If the
 * combined length exceeds the width, the label is truncated (amount preserved).
 */
export function twoColumn(label: string, amount: string, columns = DEFAULT_COLUMNS): string {
  const space = columns - amount.length;
  if (space <= 1) {
    // Amount alone is wider than the paper — just return it.
    return amount.slice(0, columns);
  }
  const trimmedLabel = label.length > space - 1 ? label.slice(0, space - 1) : label;
  const gap = columns - trimmedLabel.length - amount.length;
  return trimmedLabel + " ".repeat(Math.max(1, gap)) + amount;
}

/** Format an ISO timestamp into a local-ish "Mon DD, YYYY h:mm AM/PM" string. */
export function formatReceiptTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  let h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${month} ${day}, ${year} ${h}:${m} ${ampm} UTC`;
}

/**
 * Render the full plain-text receipt body. Ends with two blank lines so the
 * cutter clears the print area before the auto-cut.
 */
export function formatReceipt(input: ReceiptInput, opts: ReceiptFormatOptions = {}): string {
  const cols = opts.columns && opts.columns > 0 ? opts.columns : DEFAULT_COLUMNS;
  const out: string[] = [];

  const header = (input.headerText ?? "GREENWAY MARIJUANA").trim();
  for (const line of header.split("\n")) {
    out.push(centerLine(line, cols));
  }
  out.push(centerLine("ONLINE PICKUP ORDER", cols));
  out.push(divider(cols));

  out.push(`Order:  ${input.orderNumber}`);
  out.push(`Placed: ${formatReceiptTimestamp(input.placedAt)}`);
  out.push(`Name:   ${input.customerName}`);
  if (input.customerPhone) {
    out.push(`Phone:  ${input.customerPhone}`);
  }
  out.push(divider(cols));

  for (const line of input.lines) {
    const qtyName = `${line.quantity}x ${line.productName}`;
    out.push(twoColumn(qtyName, formatMoneyMinor(line.priceMinorUnits * line.quantity), cols));
    const meta = [line.brand, line.variantLabel].filter(Boolean).join(" · ");
    if (meta) {
      out.push(`   ${meta}`.slice(0, cols));
    }
  }
  out.push(divider(cols));

  out.push(twoColumn("Subtotal", formatMoneyMinor(input.subtotalMinorUnits), cols));
  if (input.savingsMinorUnits > 0) {
    out.push(twoColumn("Savings", `-${formatMoneyMinor(input.savingsMinorUnits)}`, cols));
  }
  out.push(twoColumn("Est. tax", formatMoneyMinor(input.estimatedTaxMinorUnits), cols));
  out.push(twoColumn("TOTAL", formatMoneyMinor(input.totalMinorUnits), cols));

  if (input.customerNote && input.customerNote.trim()) {
    out.push(divider(cols));
    out.push("Customer note:");
    out.push(input.customerNote.trim());
  }

  out.push(divider(cols));
  const footer = (input.footerText ?? "Pickup reservation only — pay in store.\nBring a valid ID. Thank you!").trim();
  for (const line of footer.split("\n")) {
    out.push(centerLine(line, cols));
  }

  // Trailing whitespace so the cut clears the last line.
  out.push("");
  out.push("");

  return out.join("\n");
}

/** Short queue-view title for the staff dashboard. */
export function receiptTitle(orderNumber: string, itemCount: number): string {
  const word = itemCount === 1 ? "item" : "items";
  return `Order ${orderNumber} — ${itemCount} ${word}`;
}

// ---------------------------------------------------------------------------
// Test harness (run via repo/_tt.ts importing this core, then `npx tsx _tt.ts`)
// ---------------------------------------------------------------------------
export function __runReceiptCoreTests(): void {
  let passed = 0;
  let failed = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      passed++;
    } else {
      failed++;
      console.log(`FAIL: ${name}`);
    }
  }

  // formatMoneyMinor
  expect("money 1234 -> $12.34", formatMoneyMinor(1234) === "$12.34");
  expect("money 0 -> $0.00", formatMoneyMinor(0) === "$0.00");
  expect("money 5 -> $0.05", formatMoneyMinor(5) === "$0.05");
  expect("money 100 -> $1.00", formatMoneyMinor(100) === "$1.00");
  expect("money negative", formatMoneyMinor(-250) === "-$2.50");
  expect("money rounds", formatMoneyMinor(1299.6) === "$13.00");

  // centerLine
  expect("center width", centerLine("hi", 10).length <= 10);
  expect("center pads left", centerLine("hi", 10).startsWith("    "));
  expect("center long truncates", centerLine("abcdefghijk", 5) === "abcde");

  // divider
  expect("divider length", divider(20).length === 20);

  // twoColumn
  const tc = twoColumn("Subtotal", "$12.34", 20);
  expect("twoColumn width", tc.length === 20);
  expect("twoColumn ends with amount", tc.endsWith("$12.34"));
  expect("twoColumn starts with label", tc.startsWith("Subtotal"));
  const tcLong = twoColumn("A very long product label here", "$5.00", 20);
  expect("twoColumn long truncates to width", tcLong.length === 20);
  expect("twoColumn long keeps amount", tcLong.endsWith("$5.00"));

  // timestamp
  const ts = formatReceiptTimestamp("2024-01-15T13:05:00.000Z");
  expect("timestamp month", ts.includes("Jan 15, 2024"));
  expect("timestamp pm", ts.includes("1:05 PM"));
  const tsMid = formatReceiptTimestamp("2024-01-15T00:00:00.000Z");
  expect("timestamp midnight 12 AM", tsMid.includes("12:00 AM"));
  expect("timestamp invalid passthrough", formatReceiptTimestamp("not-a-date") === "not-a-date");

  // receiptTitle
  expect("title singular", receiptTitle("GW-1", 1) === "Order GW-1 — 1 item");
  expect("title plural", receiptTitle("GW-1", 3) === "Order GW-1 — 3 items");

  // formatReceipt end-to-end
  const body = formatReceipt({
    orderNumber: "GW-1042",
    placedAt: "2024-01-15T13:05:00.000Z",
    customerName: "Jamie R.",
    customerPhone: "360-555-0100",
    lines: [
      { productName: "Blue Dream 3.5g", brand: "Acme", variantLabel: "3.5g", quantity: 2, priceMinorUnits: 1500 },
      { productName: "Gummies 10pk", brand: "Sweet Co", variantLabel: "100mg", quantity: 1, priceMinorUnits: 1800 },
    ],
    subtotalMinorUnits: 4800,
    savingsMinorUnits: 200,
    estimatedTaxMinorUnits: 1776,
    totalMinorUnits: 6376,
    customerNote: "Please double-bag.",
  }, { columns: 48 });

  expect("receipt has order number", body.includes("GW-1042"));
  expect("receipt has customer", body.includes("Jamie R."));
  expect("receipt has phone", body.includes("360-555-0100"));
  expect("receipt has product", body.includes("Blue Dream 3.5g"));
  expect("receipt has line total $30.00", body.includes("$30.00"));
  expect("receipt has TOTAL", body.includes("TOTAL"));
  expect("receipt total amount", body.includes("$63.76"));
  expect("receipt savings shown", body.includes("-$2.00"));
  expect("receipt note", body.includes("Please double-bag."));
  expect("receipt default header", body.includes("GREENWAY MARIJUANA"));
  expect("receipt pickup label", body.includes("ONLINE PICKUP ORDER"));
  expect("receipt trailing blank lines", body.endsWith("\n\n"));

  // No savings -> no savings line
  const noSave = formatReceipt({
    orderNumber: "GW-2",
    placedAt: "2024-01-15T13:05:00.000Z",
    customerName: "Sam",
    lines: [{ productName: "X", quantity: 1, priceMinorUnits: 100 }],
    subtotalMinorUnits: 100,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 37,
    totalMinorUnits: 137,
  });
  expect("receipt no savings line when zero", !noSave.includes("Savings"));
  expect("receipt custom narrow width", formatReceipt({
    orderNumber: "GW-3",
    placedAt: "2024-01-15T13:05:00.000Z",
    customerName: "Sam",
    lines: [{ productName: "X", quantity: 1, priceMinorUnits: 100 }],
    subtotalMinorUnits: 100,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 0,
    totalMinorUnits: 100,
  }, { columns: 32 }).split("\n").every((l) => l.length <= 32));

  console.log(`receipt-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`receipt-core tests failed: ${failed}`);
}
