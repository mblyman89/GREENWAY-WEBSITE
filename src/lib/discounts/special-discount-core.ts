/**
 * src/lib/discounts/special-discount-core.ts
 *
 * SLICE 27 — the pure rules engine for the three SPECIAL discount programs:
 *
 *   employee — staff purchases (owner-set, default 35%). At the register it
 *              additionally requires a DIFFERENT employee's PIN approval and
 *              must be rung on a register the buying employee is NOT logged
 *              into (both enforced by the POS flow; this core validates the
 *              recorded facts).
 *   industry — licensed-industry visitors (vendors, budtenders from other
 *              stores). Requires the company name so usage is trackable
 *              per-company. Seeded DISABLED at 0% — the owner sets the rate.
 *   veteran  — military veterans (owner-set, default 15%). Requires the
 *              "military ID checked" confirmation at the register.
 *
 * These are deliberately NOT promotions: they are person-based courtesy
 * discounts, admin-only to configure, and every use is recorded with who
 * gave it, who received it, and how much it saved.
 *
 * All money in MINOR UNITS (cents). Percent stored in BASIS POINTS
 * (3500 = 35%) to avoid float drift — same convention as tax_settings.
 *
 * PURE: no imports, no server-only — safe for client, server, and tests.
 * Self-tests embedded (__runSpecialDiscountTests) — wired into the
 * compliance pure runner and mirrored in vitest.
 */

export const SPECIAL_DISCOUNT_KINDS = ["employee", "industry", "veteran"] as const;
export type SpecialDiscountKind = (typeof SPECIAL_DISCOUNT_KINDS)[number];

export type SpecialDiscountSetting = {
  kind: SpecialDiscountKind;
  /** Discount rate in basis points (3500 = 35%). */
  percentBps: number;
  enabled: boolean;
};

/** Owner-specified defaults: employee 35%, veteran 15%; industry OFF until
 *  the owner picks a rate (0% disabled — never guess a rate on his behalf). */
export const DEFAULT_SPECIAL_DISCOUNTS: SpecialDiscountSetting[] = [
  { kind: "employee", percentBps: 3500, enabled: true },
  { kind: "industry", percentBps: 0, enabled: false },
  { kind: "veteran", percentBps: 1500, enabled: true },
];

export function isSpecialDiscountKind(raw: string | undefined | null): raw is SpecialDiscountKind {
  return raw === "employee" || raw === "industry" || raw === "veteran";
}

/**
 * Validate an admin-entered percent (whole or decimal, e.g. "35" or "12.5")
 * into basis points. Range 0–100% inclusive; finer than 0.01% rejected.
 * Garbage → null (caller shows the error; nothing is saved).
 */
export function parsePercentToBps(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  if (bps < 0 || bps > 10_000) return null;
  return bps;
}

/** Render basis points for humans: 3500 → "35%", 1250 → "12.5%". */
export function formatBps(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, "")}%`;
}

/**
 * Apply a special discount to a PRE-tax subtotal (cents). Floors, never
 * rounds the customer up: discount amount rounds DOWN to the cent so the
 * store never gives a fraction more than the configured rate, and the
 * discounted subtotal never goes below 1 cent on a non-zero sale
 * (RCW 69.50.357 — cannabis may never be free).
 */
export function applySpecialDiscount(
  subtotalMinor: number,
  percentBps: number,
): { discountMinor: number; discountedMinor: number } {
  if (!Number.isFinite(subtotalMinor) || subtotalMinor <= 0 || percentBps <= 0) {
    return { discountMinor: 0, discountedMinor: Math.max(0, Math.round(subtotalMinor)) };
  }
  const sub = Math.round(subtotalMinor);
  const bps = Math.min(10_000, Math.round(percentBps));
  let discount = Math.floor((sub * bps) / 10_000);
  // Statutory floor: never free. Cap the discount so at least 1¢ remains.
  if (sub - discount < 1) discount = sub - 1;
  if (discount < 0) discount = 0;
  return { discountMinor: discount, discountedMinor: sub - discount };
}

/** The facts a register records when a special discount is used. */
export type SpecialDiscountUseInput = {
  kind: SpecialDiscountKind;
  /** Employee who RANG the sale (the cashier). */
  cashierEmployeeId: string;
  /** Register the sale happened on. */
  registerId: string;
  /** employee program: which staff member is BUYING. */
  beneficiaryEmployeeId?: string | null;
  /** employee program: the OTHER employee who approved by PIN. */
  approvedByEmployeeId?: string | null;
  /** employee program: register the beneficiary is currently logged into (if any). */
  beneficiaryActiveRegisterId?: string | null;
  /** industry program: the visitor's company (required, trackable). */
  companyName?: string | null;
  /** veteran program: cashier confirmed a physical military ID. */
  militaryIdChecked?: boolean;
};

/**
 * Validate a recorded use against each program's rules. Returns null when
 * valid, otherwise a plain-English reason (shown at the register and never
 * stored as a use).
 *
 * Employee rules (owner decision): the discount must be APPROVED by a
 * different employee's PIN, and the buying employee cannot complete it on
 * the register they are logged into.
 */
export function validateSpecialDiscountUse(input: SpecialDiscountUseInput): string | null {
  if (!isSpecialDiscountKind(input.kind)) return "Unknown discount program.";
  if (!input.cashierEmployeeId) return "Missing the cashier on the sale.";
  if (!input.registerId) return "Missing the register on the sale.";
  switch (input.kind) {
    case "employee": {
      if (!input.beneficiaryEmployeeId) return "Pick which employee is buying.";
      if (!input.approvedByEmployeeId) return "A second employee must approve with their PIN.";
      if (input.approvedByEmployeeId === input.beneficiaryEmployeeId)
        return "The approving employee must be someone OTHER than the buyer.";
      if (
        input.beneficiaryActiveRegisterId &&
        input.beneficiaryActiveRegisterId === input.registerId
      )
        return "An employee can't buy on the register they're logged into — ring it on another register.";
      return null;
    }
    case "industry": {
      const company = input.companyName?.trim() ?? "";
      if (company.length < 2) return "Enter the visitor's company name.";
      return null;
    }
    case "veteran": {
      if (input.militaryIdChecked !== true)
        return "Confirm you checked a military ID before applying the veteran discount.";
      return null;
    }
  }
}

/* ── Embedded self-tests ───────────────────────────────────────────────── */

export function __runSpecialDiscountTests(): void {
  const eq = (got: unknown, want: unknown, what: string) => {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g !== w) throw new Error(`special-discount-core: ${what}: got ${g}, want ${w}`);
  };

  // Defaults honor the owner's numbers and never guess industry's rate.
  eq(DEFAULT_SPECIAL_DISCOUNTS.find((d) => d.kind === "employee")?.percentBps, 3500, "employee default 35%");
  eq(DEFAULT_SPECIAL_DISCOUNTS.find((d) => d.kind === "veteran")?.percentBps, 1500, "veteran default 15%");
  eq(DEFAULT_SPECIAL_DISCOUNTS.find((d) => d.kind === "industry")?.enabled, false, "industry starts disabled");
  eq(DEFAULT_SPECIAL_DISCOUNTS.length, 3, "exactly three programs");

  // parsePercentToBps
  eq(parsePercentToBps("35"), 3500, "35 → 3500 bps");
  eq(parsePercentToBps("12.5"), 1250, "12.5 → 1250 bps");
  eq(parsePercentToBps("15%"), 1500, "trailing % accepted");
  eq(parsePercentToBps("100"), 10000, "100% allowed");
  eq(parsePercentToBps("100.01"), null, "over 100% rejected");
  eq(parsePercentToBps("0"), 0, "0% allowed (used to park a program)");
  eq(parsePercentToBps("-5"), null, "negative rejected");
  eq(parsePercentToBps("abc"), null, "garbage rejected");
  eq(parsePercentToBps("12.345"), null, "finer than 0.01% rejected");
  eq(parsePercentToBps(""), null, "empty rejected");
  eq(parsePercentToBps(undefined), null, "undefined rejected");

  // formatBps
  eq(formatBps(3500), "35%", "format whole");
  eq(formatBps(1250), "12.5%", "format decimal");

  // applySpecialDiscount — cents math, floors, statutory floor
  eq(applySpecialDiscount(10000, 3500), { discountMinor: 3500, discountedMinor: 6500 }, "$100 @35%");
  eq(applySpecialDiscount(999, 1500), { discountMinor: 149, discountedMinor: 850 }, "$9.99 @15% floors the discount");
  eq(applySpecialDiscount(1, 9900), { discountMinor: 0, discountedMinor: 1 }, "1¢ sale never free");
  eq(applySpecialDiscount(100, 10000), { discountMinor: 99, discountedMinor: 1 }, "100% clamps to 1¢ (never free)");
  eq(applySpecialDiscount(0, 3500), { discountMinor: 0, discountedMinor: 0 }, "zero subtotal untouched");
  eq(applySpecialDiscount(10000, 0), { discountMinor: 0, discountedMinor: 10000 }, "0% is a no-op");

  // validateSpecialDiscountUse — employee rules
  const base = { cashierEmployeeId: "emp-cashier", registerId: "reg-1" };
  eq(
    validateSpecialDiscountUse({ ...base, kind: "employee", beneficiaryEmployeeId: "emp-buyer", approvedByEmployeeId: "emp-approver" }),
    null,
    "employee: valid with second-employee approval",
  );
  eq(
    validateSpecialDiscountUse({ ...base, kind: "employee", beneficiaryEmployeeId: "emp-buyer", approvedByEmployeeId: "emp-buyer" }),
    "The approving employee must be someone OTHER than the buyer.",
    "employee: self-approval rejected",
  );
  eq(
    validateSpecialDiscountUse({ ...base, kind: "employee", beneficiaryEmployeeId: "emp-buyer" }),
    "A second employee must approve with their PIN.",
    "employee: missing approver rejected",
  );
  eq(
    validateSpecialDiscountUse({
      ...base,
      kind: "employee",
      beneficiaryEmployeeId: "emp-buyer",
      approvedByEmployeeId: "emp-approver",
      beneficiaryActiveRegisterId: "reg-1",
    }),
    "An employee can't buy on the register they're logged into — ring it on another register.",
    "employee: same-register rejected",
  );
  eq(
    validateSpecialDiscountUse({
      ...base,
      kind: "employee",
      beneficiaryEmployeeId: "emp-buyer",
      approvedByEmployeeId: "emp-approver",
      beneficiaryActiveRegisterId: "reg-2",
    }),
    null,
    "employee: different register OK",
  );

  // industry rules
  eq(
    validateSpecialDiscountUse({ ...base, kind: "industry", companyName: "Fairwinds" }),
    null,
    "industry: valid with company",
  );
  eq(
    validateSpecialDiscountUse({ ...base, kind: "industry", companyName: "  " }),
    "Enter the visitor's company name.",
    "industry: blank company rejected",
  );

  // veteran rules
  eq(
    validateSpecialDiscountUse({ ...base, kind: "veteran", militaryIdChecked: true }),
    null,
    "veteran: valid with ID checked",
  );
  eq(
    validateSpecialDiscountUse({ ...base, kind: "veteran", militaryIdChecked: false }),
    "Confirm you checked a military ID before applying the veteran discount.",
    "veteran: unchecked rejected",
  );
  eq(
    validateSpecialDiscountUse({ ...base, kind: "veteran" }),
    "Confirm you checked a military ID before applying the veteran discount.",
    "veteran: missing flag rejected",
  );

  // shared guards
  eq(
    validateSpecialDiscountUse({ kind: "veteran", cashierEmployeeId: "", registerId: "reg-1", militaryIdChecked: true }),
    "Missing the cashier on the sale.",
    "missing cashier rejected",
  );
  eq(isSpecialDiscountKind("employee"), true, "kind guard yes");
  eq(isSpecialDiscountKind("bogus"), false, "kind guard no");

  console.log("special-discount: 36 self-tests passed");
}
