/**
 * src/lib/pos/no-receipt-return-core.ts  (D205)
 *
 * The no-receipt courtesy return for LOYALTY MEMBERS. PURE: no I/O, safe on
 * the iPad register, the back office and the server.
 *
 * Owner (verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D205):
 *   "ive decided I want to add to the policy the ability to select if I want
 *    to allow returns without a receipt, but they must be a loyalty member.
 *    so we can look up the customer and see their recent purchases and then
 *    select the one they are there to return. they must also have the
 *    packaging with them and the product being returned needs to be scanned
 *    so it can be matched to the one sold."
 *   "the return needs to still be within the return window."
 *
 * The rules, all re-checked by the server at process time:
 *   1. The owner's policy has "Allow returns without a receipt (loyalty
 *      members only)" switched on (noReceiptMembers).
 *   2. The sale is on THAT member's loyalty account (orders.customer_id).
 *   3. The sale is inside the return window (same Pacific-day window as a
 *      receipt return).
 *   4. The product in the customer's hand is scanned, and the code matches
 *      the line being returned: its lot barcode, its CCRS inventory id, or
 *      the lot key the register sold it under.
 *   5. Original packaging with the lot ID legible (WAC 314-55-079(12)) and a
 *      manager/lead PIN, exactly like a receipt return.
 */
import { returnWindowVerdict } from "./returns-core";
import { lookupWindowDays, type PosReturnPolicyConfig } from "./return-policy-core";
import { lotKeyFromVariantId } from "./variant-lot-core";

/** Shortest code accepted as a package barcode (matches the register's scan index). */
export const MIN_SCAN_CODE_CHARS = 4;

/** Why a no-receipt return is not available under this policy, or null. */
export function noReceiptBlockedReason(policy: PosReturnPolicyConfig): string | null {
  if (policy.noReceiptMembers) return null;
  return "Returns without a receipt are switched off in the store return policy (Register Activity \u2192 Return policy). The customer needs the original receipt.";
}

/** The member on the sale must be the member standing at the counter. */
export function memberOwnsSale(orderCustomerId: string | null | undefined, customerId: string | null | undefined): boolean {
  const a = (orderCustomerId ?? "").trim();
  const b = (customerId ?? "").trim();
  return a.length > 0 && a === b;
}

export const NOT_MEMBERS_SALE_ERROR =
  "This sale is not on this loyalty member's account. Without a receipt, only sales rung on the member's own loyalty account can be returned.";

/** Clean a scanned or typed code for comparison: control chars out, trimmed, lowercased. */
export function normalizeScanCode(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type LineScanSource = {
  /** order_lines.product_id (the lot/card key the register sold). */
  productId: string | null;
  /** order_lines.variant_id (an intake variant encodes its own lot key). */
  variantId?: string | null;
  /** order_lines.ccrs_inventory_external_id. */
  ccrsExternalId?: string | null;
  /** The lots behind the line (inventory_lots by pos_product_key). */
  lots?: { lotCode: string | null; ccrsExternalId: string | null }[];
};

/** Every code that proves the package in hand is the item sold on this line. */
export function lineScanCodes(src: LineScanSource): Set<string> {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const c = normalizeScanCode(v);
    if (c.length >= MIN_SCAN_CODE_CHARS) out.add(c);
  };
  add(src.productId);
  add(lotKeyFromVariantId(src.variantId ?? null));
  add(src.ccrsExternalId);
  for (const l of src.lots ?? []) {
    add(l.lotCode);
    add(l.ccrsExternalId);
  }
  return out;
}

export type ScanMatchVerdict = { ok: true; code: string } | { ok: false; error: string };

/** Does the scanned package match the line being returned? */
export function scanMatchesLine(rawScan: unknown, codes: Set<string>, productName: string): ScanMatchVerdict {
  const code = normalizeScanCode(rawScan);
  if (!code) return { ok: false, error: "Scan the barcode on the product being returned." };
  if (code.length < MIN_SCAN_CODE_CHARS) return { ok: false, error: "That scan is too short to be a package barcode. Scan the product's label again." };
  if (codes.size === 0) {
    return {
      ok: false,
      error: `There is no barcode on record for ${productName}, so the scan cannot be matched. Without a receipt this return cannot be taken; the back-office Returns desk can look at it.`,
    };
  }
  if (codes.has(code)) return { ok: true, code };
  return {
    ok: false,
    error: `That barcode does not match ${productName} from this sale. Make sure it is the same product the customer bought, or pick the right item from the list.`,
  };
}

export type MemberSaleInput = {
  orderId: string;
  orderNumber: string;
  saleClientUuid: string;
  purchasedAtIso: string;
  totalMinor: number;
  items: string[];
  itemCount: number;
};

export type MemberSaleRow = MemberSaleInput & { daysRemaining: number };

/** The member's sales still inside the return window, newest first. */
export function memberSalesInWindow(rows: MemberSaleInput[], policy: PosReturnPolicyConfig, nowIso: string): MemberSaleRow[] {
  const out: MemberSaleRow[] = [];
  for (const r of rows) {
    const w = returnWindowVerdict(r.purchasedAtIso, nowIso, policy.windowDays);
    if (!w.ok) continue;
    out.push({ ...r, daysRemaining: w.daysRemaining });
  }
  return out.sort((a, b) => Date.parse(b.purchasedAtIso) - Date.parse(a.purchasedAtIso) || a.saleClientUuid.localeCompare(b.saleClientUuid));
}

/** The earliest purchase instant worth reading for a member list (window + slack). */
export function memberSalesCutoffIso(policy: PosReturnPolicyConfig, nowIso: string): string {
  return new Date(Date.parse(nowIso) - lookupWindowDays(policy) * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runNoReceiptReturnCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  \u2717 no-receipt-return-core: ${label}`);
    }
  };
  const off: PosReturnPolicyConfig = { loyaltyRequired: false, windowDays: 7, excludedCategories: [], noReceiptMembers: false };
  const on: PosReturnPolicyConfig = { ...off, noReceiptMembers: true };

  ok((noReceiptBlockedReason(off) ?? "").includes("switched off"), "blocked when the toggle is off");
  ok(noReceiptBlockedReason(on) === null, "allowed when the toggle is on");

  ok(memberOwnsSale("c1", "c1"), "same member owns the sale");
  ok(!memberOwnsSale(null, "c1"), "walk-in sale is not the member's");
  ok(!memberOwnsSale("c2", "c1"), "another member's sale refused");
  ok(!memberOwnsSale("", ""), "two blanks never match");

  ok(normalizeScanCode("  ABC123\r\n") === "abc123", "scan cleaned and lowercased");

  const codes = lineScanCodes({
    productId: "pos-0390d0940b67",
    variantId: "GF41918905566982-onboarded",
    ccrsExternalId: "16184927322173236",
    lots: [{ lotCode: "1A2B3C4D5E", ccrsExternalId: null }, { lotCode: "ab", ccrsExternalId: "" }],
  });
  ok(codes.has("pos-0390d0940b67"), "product key accepted");
  ok(codes.has("gf41918905566982"), "variant lot key accepted");
  ok(codes.has("16184927322173236"), "CCRS id on the line accepted");
  ok(codes.has("1a2b3c4d5e"), "lot barcode accepted");
  ok(!codes.has("ab"), "too-short codes ignored");

  ok(scanMatchesLine("1A2B3C4D5E", codes, "Candy Fumez").ok, "matching scan accepted");
  ok(scanMatchesLine(" 16184927322173236\n", codes, "Candy Fumez").ok, "CCRS scan with whitespace accepted");
  const miss = scanMatchesLine("999999999", codes, "Candy Fumez");
  ok(!miss.ok && miss.error.includes("does not match Candy Fumez"), "mismatch refused, names the item");
  ok(!scanMatchesLine("", codes, "X").ok, "blank scan refused");
  ok(!scanMatchesLine("abc", codes, "X").ok, "short scan refused");
  const none = scanMatchesLine("12345678", new Set(), "Gummy");
  ok(!none.ok && none.error.includes("no barcode on record"), "no codes on record refused");

  const now = "2026-11-07T20:00:00.000Z";
  const rows: MemberSaleInput[] = [
    { orderId: "o1", orderNumber: "GWY-1", saleClientUuid: "a", purchasedAtIso: "2026-11-06T20:00:00.000Z", totalMinor: 100, items: ["A"], itemCount: 1 },
    { orderId: "o2", orderNumber: "GWY-2", saleClientUuid: "b", purchasedAtIso: "2026-10-20T20:00:00.000Z", totalMinor: 100, items: ["B"], itemCount: 1 },
    { orderId: "o3", orderNumber: "GWY-3", saleClientUuid: "c", purchasedAtIso: "2026-11-07T18:00:00.000Z", totalMinor: 100, items: ["C"], itemCount: 1 },
  ];
  const listed = memberSalesInWindow(rows, on, now);
  ok(listed.length === 2, "sale outside the window dropped");
  ok(listed[0].orderId === "o3" && listed[1].orderId === "o1", "newest first");
  ok(listed[1].daysRemaining === 6, "days remaining computed");
  ok(memberSalesCutoffIso(on, now) === "2026-10-29T20:00:00.000Z", "cutoff = window + 2 days");

  return { passed, failed };
}
