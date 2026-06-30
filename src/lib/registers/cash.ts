/**
 * src/lib/registers/cash.ts
 *
 * PURE cash-drawer math (no server-only imports → unit-testable with tsx).
 * Money is always in MINOR UNITS (cents) as integers.
 */

export type DenomCounts = {
  pennies: number;
  nickels: number;
  dimes: number;
  quarters: number;
  ones: number;
  fives: number;
  tens: number;
  twenties: number;
  fifties: number;
  hundreds: number;
};

export const EMPTY_DENOMS: DenomCounts = {
  pennies: 0, nickels: 0, dimes: 0, quarters: 0,
  ones: 0, fives: 0, tens: 0, twenties: 0, fifties: 0, hundreds: 0,
};

/** Cents value of each denomination unit. */
const DENOM_CENTS: Record<keyof DenomCounts, number> = {
  pennies: 1, nickels: 5, dimes: 10, quarters: 25,
  ones: 100, fives: 500, tens: 1000, twenties: 2000, fifties: 5000, hundreds: 10000,
};

/** Friendly ordered list for rendering count forms. */
export const DENOM_FIELDS: { key: keyof DenomCounts; label: string }[] = [
  { key: "hundreds", label: "$100" },
  { key: "fifties", label: "$50" },
  { key: "twenties", label: "$20" },
  { key: "tens", label: "$10" },
  { key: "fives", label: "$5" },
  { key: "ones", label: "$1" },
  { key: "quarters", label: "25¢" },
  { key: "dimes", label: "10¢" },
  { key: "nickels", label: "5¢" },
  { key: "pennies", label: "1¢" },
];

/** Total cents represented by a denomination breakdown. */
export function denomTotalMinor(d: Partial<DenomCounts>): number {
  let total = 0;
  for (const k of Object.keys(DENOM_CENTS) as (keyof DenomCounts)[]) {
    const qty = Math.max(0, Math.floor(Number(d[k] ?? 0)));
    total += qty * DENOM_CENTS[k];
  }
  return total;
}

/** Parse denomination fields out of a flat string map (e.g. FormData). */
export function parseDenoms(get: (key: string) => string | null | undefined): DenomCounts {
  const out = { ...EMPTY_DENOMS };
  for (const k of Object.keys(out) as (keyof DenomCounts)[]) {
    const raw = get(k);
    out[k] = Math.max(0, Math.floor(Number(raw ?? 0) || 0));
  }
  return out;
}

/**
 * Expected closing cash for a sales drawer:
 *   opening float + cash sales taken in - cash dropped to the safe.
 * All cents.
 */
export function expectedClose(opts: {
  openingMinor: number;
  cashSalesMinor: number;
  dropsMinor: number;
}): number {
  return Math.round(opts.openingMinor + opts.cashSalesMinor - opts.dropsMinor);
}

/** Over/short = counted - expected (positive = over, negative = short). */
export function overShort(countedMinor: number, expectedMinor: number): number {
  return Math.round(countedMinor - expectedMinor);
}

/** Format cents as $#,###.## (handles negatives for shorts). */
export function formatCents(minor: number | null | undefined): string {
  const n = Number(minor ?? 0);
  const neg = n < 0;
  const dollars = (Math.abs(n) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? "-" : ""}$${dollars}`;
}

/** Plain-language over/short label. */
export function overShortLabel(minor: number): string {
  if (minor === 0) return "Balanced";
  return minor > 0 ? `Over by ${formatCents(minor)}` : `Short by ${formatCents(Math.abs(minor))}`;
}
