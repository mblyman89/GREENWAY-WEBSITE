/**
 * src/lib/pos/exception-resolve-core.ts  (D204c)
 *
 * D204 finding: a refused $93.50 sale was marked "reviewed" but never re-rung,
 * so the cash the customer paid sat in the drawer unexplained (+$94.35 over).
 *
 * A refused SALE may now be closed only by:
 *   - "rerung": the sale was rung again; the new receipt number is given and
 *     the server checks a processed sale with that number exists, made at or
 *     after the refused one; or
 *   - "no_sale": no sale happened (test, customer left, money handed back),
 *     with a written reason of at least NO_SALE_REASON_MIN characters.
 * Other event types keep the plain note (at least 5 characters).
 *
 * PURE: no I/O.
 */
import { receiptLookupSuffix } from "./returns-core";

export const NO_SALE_REASON_MIN = 15;
export const NOTE_MIN = 5;

export type ResolveKind = "rerung" | "no_sale" | "note";

export type ResolveVerdict =
  | { ok: true; kind: "rerung"; receipt: string; note: string }
  | { ok: true; kind: "no_sale" | "note"; note: string }
  | { ok: false; error: string };

export const SALE_RESOLVE_HELP =
  "A refused sale is closed only when it was rung again (give the new receipt number) " +
  "or when no sale happened (say why, for example the customer left and was handed the money back).";

export function resolveExceptionVerdict(input: {
  eventType: string;
  kind: unknown;
  receipt: unknown;
  note: unknown;
}): ResolveVerdict {
  const note = String(input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (input.eventType !== "sale") {
    if (note.length < NOTE_MIN) return { ok: false, error: `A resolution note (at least ${NOTE_MIN} characters) is required.` };
    return { ok: true, kind: "note", note };
  }
  const kind = String(input.kind ?? "");
  if (kind === "rerung") {
    const suffix = receiptLookupSuffix(input.receipt);
    if (!suffix) {
      return { ok: false, error: "Enter the receipt number of the sale that was rung again (the 8-character code under the store name)." };
    }
    const receipt = suffix.toUpperCase();
    return { ok: true, kind: "rerung", receipt, note: note ? `Re-rung as receipt ${receipt}. ${note}` : `Re-rung as receipt ${receipt}.` };
  }
  if (kind === "no_sale") {
    if (note.length < NO_SALE_REASON_MIN) {
      return { ok: false, error: `Say why no sale happened (at least ${NO_SALE_REASON_MIN} characters), and what happened to any money taken.` };
    }
    return { ok: true, kind: "no_sale", note: `No sale: ${note}` };
  }
  return { ok: false, error: SALE_RESOLVE_HELP };
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runExceptionResolveTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL - ${name}`);
    }
  };

  const other = resolveExceptionVerdict({ eventType: "medical_card_capture", kind: "", receipt: "", note: "fixed the card" });
  ok("non-sale: note works", other.ok && other.kind === "note");
  ok("non-sale: short note refused", !resolveExceptionVerdict({ eventType: "cart_adjustment", kind: "", receipt: "", note: "ok" }).ok);
  ok("sale: plain note refused", !resolveExceptionVerdict({ eventType: "sale", kind: "", receipt: "", note: "reviewed it all fine" }).ok);
  ok("sale: unknown kind refused", !resolveExceptionVerdict({ eventType: "sale", kind: "whatever", receipt: "", note: "reviewed it all fine" }).ok);
  ok("sale: rerung without receipt refused", !resolveExceptionVerdict({ eventType: "sale", kind: "rerung", receipt: "", note: "" }).ok);
  ok("sale: rerung bad receipt refused", !resolveExceptionVerdict({ eventType: "sale", kind: "rerung", receipt: "zz", note: "" }).ok);
  const r = resolveExceptionVerdict({ eventType: "sale", kind: "rerung", receipt: "a1b2c3d4", note: "" });
  ok("sale: rerung ok", r.ok && r.kind === "rerung" && r.receipt === "A1B2C3D4" && r.note.includes("A1B2C3D4"));
  ok("sale: no_sale short refused", !resolveExceptionVerdict({ eventType: "sale", kind: "no_sale", receipt: "", note: "left" }).ok);
  const n = resolveExceptionVerdict({ eventType: "sale", kind: "no_sale", receipt: "", note: "customer left, money handed back" });
  ok("sale: no_sale ok", n.ok && n.kind === "no_sale" && n.note.startsWith("No sale:"));
  ok("help mentions receipt", SALE_RESOLVE_HELP.includes("receipt"));

  return { passed, failed };
}
