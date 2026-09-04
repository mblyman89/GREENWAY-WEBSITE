/**
 * src/lib/regulatory/compliance-surface.ts  (SLICE 37)
 *
 * The CODEBASE COMPLIANCE SURFACE MAP: which laws Greenway's software actually
 * runs on, and where. This is what makes the Regulatory Watch AI analyst
 * useful — when a bulletin cites WAC 314-55-155, the analyst is TOLD that
 * Greenway enforces that rule in the copy guardrails and the promotions
 * engine, so its roadmap points at the real modules that would need changes
 * instead of generic advice.
 *
 * Sources: docs/COMPLIANCE_BIBLE.md (2026 audit, primary sources only),
 * docs/COMPLIANCE_CLAIMS_REFERENCE.md, docs/INVENTORY_COMPLIANCE_WA.md,
 * docs/EMPLOYEE_COMPLIANCE.md, docs/PROMOTIONS_COMPLIANCE.md. Reviewed by a
 * human — the AI never edits this file; it only reads it.
 *
 * PURE data (no I/O, no server-only) so both the analyst prompt and the page
 * can import it, and the pure self-test runner can sanity-check it.
 */

export type ComplianceArea = {
  /** Stable key stored on analyses/roadmap rows. */
  key: string;
  /** Human label shown on the page. */
  label: string;
  /** The citations this area rides on (normalized, e.g. "WAC 314-55-095"). */
  citations: string[];
  /** What Greenway's code does about it — plain English for the owner + AI. */
  whatWeRun: string;
  /** The real modules/surfaces that would change if the rule changes. */
  modules: string[];
};

export const COMPLIANCE_SURFACE: ComplianceArea[] = [
  {
    key: "sales-limits",
    label: "Sales limits (per-customer possession amounts)",
    citations: ["WAC 314-55-095", "RCW 69.50.360"],
    whatWeRun:
      "The register hard-blocks any sale over the per-category limits (1 oz flower, 16 oz solid edible, 72 oz liquid, 7 g concentrate, 200 mg active delta-9 THC for low-THC infused beverages packaged in units of 4 mg or less, and 10 units of a product otherwise taken into the body) with an owner-only override ledger. TWO of the six buckets are not denominated in grams: the low-THC beverage bucket is counted in MILLIGRAMS OF THC, and the otherwise-taken-into-the-body bucket is a COUNT of individual items (a sealed box of six suppositories is six of the ten, per RCW 69.50.101) — rendering either one as a weight produces a meaningless figure. Those same two buckets are also the only ones that do NOT triple for a DOH-database medical patient, and they resist tripling for DIFFERENT reasons: WAC 314-55-095(2)(d) NAMES the identical 200 mg figure for patients, whereas it OMITS the otherwise-taken category from its enumeration altogether, so no enhanced medical amount exists to grant. That distinction matters when reading any future amendment — the beverage figure could be raised by amending a number that is already there, but the otherwise-taken bucket would require the category to be ADDED to (2)(d) first. WAC 314-55-010(40) defines the category by route of administration (not inhaled, not orally ingested, not applied to the skin), so it CANNOT be inferred from the product category slug: one topical shelf holds both balms (72 oz) and suppositories (10 units).",
    modules: [
      "src/lib/compliance/sales-limit-gate-core.ts",
      "src/lib/compliance/sales-limits-core.ts",
      "src/lib/menu/cart-limit-meter-core.ts",
      "src/lib/pos/sale-flow-core.ts",
      "/admin/compliance/sales-limits",
      "/admin/menu-imports/[id]/facts",
    ],
  },
  {
    key: "ccrs-reporting",
    label: "CCRS traceability reporting (weekly CSV uploads)",
    citations: ["WAC 314-55-083", "WAC 314-55-087"],
    whatWeRun:
      "The CCRS Command Center generates the weekly Sale/Inventory/Product CSV files, tracks the Sunday deadline, archives every generated file, and triages LCB error emails.",
    modules: [
      "src/lib/compliance/ccrs-sales.ts",
      "src/lib/compliance/ccrs-batch.ts",
      "src/lib/compliance/ccrs-week-core.ts",
      "/admin/compliance/ccrs",
    ],
  },
  {
    key: "excise-tax",
    label: "Cannabis excise tax (37%) + LIQ-1295 monthly report",
    citations: ["RCW 69.50.535"],
    whatWeRun:
      "Every sale computes the 37% excise separately from sales tax (money in cents); the monthly LIQ-1295 draft and payment reminders come from the excise module.",
    modules: [
      "src/lib/compliance/excise-return-core.ts",
      "src/lib/compliance/excise-draft.ts",
      "/admin/reports/excise",
    ],
  },
  {
    key: "advertising",
    label: "Advertising, labels, and product copy guardrails",
    citations: ["WAC 314-55-155", "RCW 69.50.369"],
    whatWeRun:
      "Product copy and marketing content pass guardrails: hard-block on curative/therapeutic (medical) claims, warnings on risky phrasing, no appeal-to-minors imagery. ESB 5206 retail-advertising rules (CR-103, effective July 3, 2026) land here.",
    modules: [
      "src/lib/ai/compliance.ts",
      "src/lib/ai/compliance-patterns.json",
      "/admin/marketing",
      "/admin/promotions",
    ],
  },
  {
    key: "pricing-discounts",
    label: "No free / below-cost cannabis; discount rules",
    citations: ["RCW 69.50.357", "WAC 314-55-017", "WAC 314-55-018", "WAC 314-55-523"],
    whatWeRun:
      "The promotions engine refuses free-cannabis and below-cost outcomes; store-favorable discount targeting keeps every promo defensible. Bulletin 26-01 (volume discounts / minimum orders) touches this area.",
    modules: [
      "src/lib/discounts",
      "src/lib/promotions",
      "/admin/promotions",
    ],
  },
  {
    key: "age-id",
    label: "Age verification / acceptable ID (21+)",
    citations: ["RCW 69.50.357"],
    whatWeRun:
      "The register requires an ID check on every sale; acceptable-ID rules follow the LCB list (incl. tribal IDs).",
    modules: ["src/lib/pos", "register unlock + checkout flow"],
  },
  {
    key: "hours",
    label: "Legal sales hours (8am–12am)",
    citations: ["WAC 314-55-147"],
    whatWeRun: "The register blocks sales outside the WAC sales-hours window.",
    modules: ["src/lib/compliance/sales-hours-core.ts"],
  },
  {
    key: "recordkeeping",
    label: "Records retention (5 years, Category IV violation)",
    citations: ["WAC 314-55-087"],
    whatWeRun:
      "Sales, employee, and CCRS records are retained; evidence-grade tables (audit log, acknowledgments) are insert-only.",
    modules: ["audit log", "CCRS archive", "employee records"],
  },
  {
    key: "samples",
    label: "Employee/vendor trade samples",
    citations: ["WAC 314-55-096"],
    whatWeRun:
      "The samples ledger enforces per-employee caps with receipts and history.",
    modules: ["src/lib/compliance/employee-sample-core.ts", "/admin/compliance/samples"],
  },
  {
    key: "medical",
    label: "Medical endorsement (DOH cards, exempt sales)",
    citations: ["WAC 314-55-080", "RCW 69.50.375", "RCW 69.51A.230", "WAC 246-70-040"],
    whatWeRun:
      "The medical page runs guided patient intake, recognition-card checks, DOH-compliant product registry, and the tax-exempt sale ledger.",
    modules: ["src/lib/medical", "/admin/medical"],
  },
  {
    key: "licensing-fees",
    label: "License fees and renewal",
    citations: ["WAC 314-55-075", "WAC 314-55-077", "WAC 314-55-079"],
    whatWeRun:
      "Renewal deadlines live on the compliance calendar. EHB 2681 raised retailer fees effective July 1, 2026 (CR-103 WSR 26-14-119).",
    modules: ["/admin/compliance/calendar"],
  },
  {
    key: "ownership-finance",
    label: "Ownership, true parties of interest, financial interests",
    citations: ["WAC 314-55-035", "WAC 314-55-040"],
    whatWeRun:
      "No code enforces this yet — it is an owner-level licensing duty. ESSB 5403 (Financial Interest Agreements for Cannabis Retailers, CR-101 open) may create new disclosure obligations worth tracking here.",
    modules: ["(owner-level; watch for new obligations)"],
  },
  {
    key: "employment",
    label: "Employment / staffing compliance",
    citations: ["RCW 49.94.010", "WAC 314-55-087"],
    whatWeRun:
      "Handbook v2.0 with read-and-acknowledge gates, Fair Chance Act hiring language, time clock + payroll records retained 5 years.",
    modules: ["src/lib/staffing", "/admin/staffing/employees"],
  },
];

/** Areas whose citations match any of the given cites (normalized compare). */
export function areasForCitations(cites: string[]): ComplianceArea[] {
  const norm = new Set(cites.map((c) => c.trim().toUpperCase()));
  return COMPLIANCE_SURFACE.filter((a) =>
    a.citations.some((c) => norm.has(c.toUpperCase())),
  );
}

/** Look up one area by key (used to validate AI output). */
export function areaByKey(key: string): ComplianceArea | null {
  return COMPLIANCE_SURFACE.find((a) => a.key === key) ?? null;
}

/** All valid area keys (fed to the AI schema as an enum whitelist). */
export function allAreaKeys(): string[] {
  return COMPLIANCE_SURFACE.map((a) => a.key);
}

/** Compact text block describing the surface map for the analyst prompt. */
export function surfaceMapForPrompt(): string {
  return COMPLIANCE_SURFACE.map(
    (a) =>
      `- ${a.key} (${a.label}) — rides on ${a.citations.join(", ")}. ${a.whatWeRun}`,
  ).join("\n");
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runComplianceSurfaceTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`  FAIL compliance-surface: ${label}`);
    }
  };

  ok(COMPLIANCE_SURFACE.length >= 12, "at least 12 mapped areas");
  ok(new Set(allAreaKeys()).size === COMPLIANCE_SURFACE.length, "area keys unique");
  ok(
    COMPLIANCE_SURFACE.every((a) => a.citations.length > 0 && a.modules.length > 0),
    "every area has citations + modules",
  );
  ok(areasForCitations(["WAC 314-55-155"]).some((a) => a.key === "advertising"), "advertising found by cite");
  ok(areasForCitations(["wac 314-55-095"]).some((a) => a.key === "sales-limits"), "case-insensitive cite match");
  ok(areasForCitations(["WAC 999-99-999"]).length === 0, "unknown cite matches nothing");
  ok(areaByKey("ccrs-reporting") !== null, "areaByKey finds ccrs-reporting");
  ok(areaByKey("nope") === null, "areaByKey null for unknown");
  ok(surfaceMapForPrompt().includes("WAC 314-55-155"), "prompt block includes cites");

  if (fail > 0) throw new Error(`compliance-surface self-tests: ${fail} failure(s)`);
  console.log(`compliance-surface: ${pass} passed, ${fail} failed`);
}
