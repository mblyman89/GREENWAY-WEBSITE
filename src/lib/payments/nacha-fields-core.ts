/**
 * src/lib/payments/nacha-fields-core.ts  (R41 S2)
 *
 * The Nacha field helpers and the ABA routing check, moved out of nacha-core
 * so the Timberland files can use them without an import cycle:
 *
 *   nacha-core  ->  timberland-originator-core  ->  timberland-profile-core
 *        \                     \                          /
 *         `---------------------`---> nacha-fields-core <'
 *
 * This file imports NOTHING (tests/compliance/r41-s2-originator.test.ts pins
 * that). nacha-core re-exports every name here, so existing imports from
 * "@/lib/payments/nacha-core" keep working unchanged.
 *
 * Behaviour is byte-for-byte the code that was in nacha-core (Slice B); only
 * its home changed.
 */

/** Left-justify + blank-pad (alphanumeric), truncating to width. */
export function alpha(value: string | null | undefined, width: number): string {
  const s = sanitizeAlpha(value ?? "");
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

/** Right-justify + zero-pad (numeric), truncating leftmost if too long. */
export function numeric(value: number | string, width: number): string {
  const digits = String(value).replace(/[^0-9]/g, "");
  if (digits.length >= width) return digits.slice(digits.length - width);
  return "0".repeat(width - digits.length) + digits;
}

/** Strip to the ASCII subset NACHA permits (upper-case, digits, space, basic). */
export function sanitizeAlpha(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 .,&/\-]/g, "")
    .replace(/\s+/g, " ")
    .trimEnd();
}

/** ABA routing number check-digit validation (mod-10, weights 3-7-1). */
export function isValidRouting(routing: string | null | undefined): boolean {
  const r = (routing ?? "").replace(/\D/g, "");
  if (r.length !== 9) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(r[i]) * w[i];
  return sum % 10 === 0;
}

/** First 8 digits of a 9-digit routing number (Receiving/Originating DFI ID). */
export function dfiId8(routing: string): string {
  return routing.replace(/\D/g, "").slice(0, 8);
}

/** Check digit = 9th digit of the routing number. */
export function routingCheckDigit(routing: string): string {
  return routing.replace(/\D/g, "").slice(8, 9);
}
