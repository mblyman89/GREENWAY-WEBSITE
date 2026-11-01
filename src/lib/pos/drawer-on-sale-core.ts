/**
 * src/lib/pos/drawer-on-sale-core.ts  (R-DRAWER-1)
 *
 * Owner request (verbatim, docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 *   "i want to build a setting in the register activity page of the back
 *    office that gives me the option of popping the cash drawer with a
 *    receipt or with out the receipt printed. most of my customers do not
 *    want a receipt and this new method should make for a more efficient
 *    process."
 *
 * PURE rules for how the Sale complete screen opens the cash drawer:
 *   - "print_receipt" (default, today's behaviour): Print receipt prints and
 *     kicks the drawer.
 *   - "drawer_only": a cash sale opens the drawer by itself with a drawer-only
 *     Star job (nothing printed); Print receipt stays for customers who ask.
 * In BOTH modes the drawer opens at most once per sale (finding F-01-6: every
 * extra Print receipt tap used to open it again, around the No-sale control).
 * A sale with no cash (all on the employee pay-later tab) never opens it.
 */

export type DrawerOnSaleMode = "print_receipt" | "drawer_only";

export type PosDrawerOnSaleConfig = { mode: DrawerOnSaleMode };

export const DRAWER_ON_SALE_MODES: readonly DrawerOnSaleMode[] = ["print_receipt", "drawer_only"];

export const DEFAULT_POS_DRAWER_ON_SALE_CONFIG: PosDrawerOnSaleConfig = { mode: "print_receipt" };

export const DRAWER_ON_SALE_LABELS: Record<DrawerOnSaleMode, { title: string; detail: string }> = {
  print_receipt: {
    title: "Open the drawer with a printed receipt",
    detail:
      "The budtender taps Print receipt after a cash sale. The receipt prints and the drawer opens. This is how the register has always worked.",
  },
  drawer_only: {
    title: "Open the drawer without a receipt",
    detail:
      "After a cash sale the drawer opens by itself and nothing prints. If the customer asks for a receipt, the budtender taps Print receipt.",
  },
};

export function isDrawerOnSaleMode(value: unknown): value is DrawerOnSaleMode {
  return value === "print_receipt" || value === "drawer_only";
}

/** Anything other than an explicit { mode: "drawer_only" } is the default. */
export function normalizePosDrawerOnSaleConfig(raw: unknown): PosDrawerOnSaleConfig {
  if (raw && typeof raw === "object" && (raw as { mode?: unknown }).mode === "drawer_only") {
    return { mode: "drawer_only" };
  }
  return { ...DEFAULT_POS_DRAWER_ON_SALE_CONFIG };
}

/** True when the sale took cash (a pay-later tab or a $0 tender never opens the drawer). */
export function isCashSale(receipt: { tenderedMinor: number; employeeTabMinor?: number }): boolean {
  if ((receipt.employeeTabMinor ?? 0) > 0) return false;
  return receipt.tenderedMinor > 0;
}

type DrawerState = {
  config: PosDrawerOnSaleConfig | null | undefined;
  cashSale: boolean;
  drawerAlreadyOpened: boolean;
};

/** Open the drawer by itself when the Sale complete screen appears? */
export function shouldAutoOpenDrawer(
  s: DrawerState & { autoOpenAlreadyAttempted: boolean },
): boolean {
  const cfg = normalizePosDrawerOnSaleConfig(s.config);
  return (
    cfg.mode === "drawer_only" && s.cashSale && !s.drawerAlreadyOpened && !s.autoOpenAlreadyAttempted
  );
}

/** Should this Print receipt tap also kick the drawer? At most once per sale. */
export function printShouldOpenDrawer(s: { cashSale: boolean; drawerAlreadyOpened: boolean }): boolean {
  return s.cashSale && !s.drawerAlreadyOpened;
}

/** Show the "Open drawer" retry button (automatic kick tried and failed)? */
export function showOpenDrawerRetry(
  s: DrawerState & { autoOpenAlreadyAttempted: boolean },
): boolean {
  const cfg = normalizePosDrawerOnSaleConfig(s.config);
  return cfg.mode === "drawer_only" && s.cashSale && !s.drawerAlreadyOpened && s.autoOpenAlreadyAttempted;
}

/** The small hint under the receipt buttons. */
export function receiptButtonsHint(s: DrawerState): string {
  const cfg = normalizePosDrawerOnSaleConfig(s.config);
  const tail =
    " Use \u201cBrowser print\u201d on a laptop, or if the counter printer is unavailable \u2014 the sale is already saved either way.";
  if (!s.cashSale) {
    return "No cash was taken, so the drawer stays shut. \u201cPrint receipt\u201d prints a receipt if the customer wants one." + tail;
  }
  if (s.drawerAlreadyOpened) {
    return "The drawer has opened for this sale. \u201cPrint receipt\u201d only prints \u2014 it will not open the drawer again." + tail;
  }
  if (cfg.mode === "drawer_only") {
    return "The drawer opens on its own \u2014 no receipt needed. Tap \u201cPrint receipt\u201d only if the customer asks for one." + tail;
  }
  return "\u201cPrint receipt\u201d prints on the counter printer and opens the drawer once. Tapping again only reprints." + tail;
}

/** One-line summary for the back-office page. */
export function drawerOnSaleSummary(config: PosDrawerOnSaleConfig | null | undefined): string {
  const cfg = normalizePosDrawerOnSaleConfig(config);
  return cfg.mode === "drawer_only"
    ? "After a cash sale the drawer opens by itself. No receipt prints unless the customer asks."
    : "After a cash sale the budtender taps Print receipt; the receipt prints and the drawer opens.";
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDrawerOnSaleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`drawer-on-sale-core FAIL: ${label}`);
    }
  };
  const ONLY: PosDrawerOnSaleConfig = { mode: "drawer_only" };
  const PRINT: PosDrawerOnSaleConfig = { mode: "print_receipt" };

  // normalize
  ok(normalizePosDrawerOnSaleConfig(undefined).mode === "print_receipt", "undefined -> default");
  ok(normalizePosDrawerOnSaleConfig(null).mode === "print_receipt", "null -> default");
  ok(normalizePosDrawerOnSaleConfig({}).mode === "print_receipt", "{} -> default");
  ok(normalizePosDrawerOnSaleConfig({ mode: "DRAWER_ONLY" }).mode === "print_receipt", "case-sensitive");
  ok(normalizePosDrawerOnSaleConfig({ mode: true }).mode === "print_receipt", "bool -> default");
  ok(normalizePosDrawerOnSaleConfig("drawer_only").mode === "print_receipt", "bare string -> default");
  ok(normalizePosDrawerOnSaleConfig({ mode: "drawer_only" }).mode === "drawer_only", "drawer_only kept");
  ok(normalizePosDrawerOnSaleConfig({ mode: "print_receipt" }).mode === "print_receipt", "print kept");
  ok(normalizePosDrawerOnSaleConfig(undefined) !== DEFAULT_POS_DRAWER_ON_SALE_CONFIG, "default copied");
  ok(isDrawerOnSaleMode("drawer_only") && isDrawerOnSaleMode("print_receipt"), "modes valid");
  ok(!isDrawerOnSaleMode("open") && !isDrawerOnSaleMode(undefined), "junk not a mode");
  ok(DRAWER_ON_SALE_MODES.length === 2, "two modes");

  // cash sale
  ok(isCashSale({ tenderedMinor: 2000 }), "cash tendered");
  ok(!isCashSale({ tenderedMinor: 0 }), "no tender");
  ok(!isCashSale({ tenderedMinor: 2000, employeeTabMinor: 1870 }), "pay-later never cash");
  ok(isCashSale({ tenderedMinor: 2000, employeeTabMinor: 0 }), "tab 0 is cash");

  // auto open
  const base = { cashSale: true, drawerAlreadyOpened: false, autoOpenAlreadyAttempted: false };
  ok(shouldAutoOpenDrawer({ ...base, config: ONLY }), "drawer_only cash -> auto");
  ok(!shouldAutoOpenDrawer({ ...base, config: PRINT }), "print mode never auto");
  ok(!shouldAutoOpenDrawer({ ...base, config: undefined }), "missing config never auto");
  ok(!shouldAutoOpenDrawer({ ...base, config: ONLY, cashSale: false }), "no cash never auto");
  ok(!shouldAutoOpenDrawer({ ...base, config: ONLY, drawerAlreadyOpened: true }), "already open");
  ok(!shouldAutoOpenDrawer({ ...base, config: ONLY, autoOpenAlreadyAttempted: true }), "auto once");

  // print kicks at most once
  ok(printShouldOpenDrawer({ cashSale: true, drawerAlreadyOpened: false }), "first print kicks");
  ok(!printShouldOpenDrawer({ cashSale: true, drawerAlreadyOpened: true }), "reprint never kicks");
  ok(!printShouldOpenDrawer({ cashSale: false, drawerAlreadyOpened: false }), "no cash never kicks");

  // retry
  const tried = { ...base, autoOpenAlreadyAttempted: true };
  ok(showOpenDrawerRetry({ ...tried, config: ONLY }), "failed auto -> retry");
  ok(!showOpenDrawerRetry({ ...base, config: ONLY }), "not tried -> no retry");
  ok(!showOpenDrawerRetry({ ...tried, config: ONLY, drawerAlreadyOpened: true }), "open -> no retry");
  ok(!showOpenDrawerRetry({ ...tried, config: PRINT }), "print mode -> no retry");

  // hints and summary
  ok(receiptButtonsHint({ config: ONLY, cashSale: true, drawerAlreadyOpened: false }).includes("opens on its own"), "hint drawer_only");
  ok(receiptButtonsHint({ config: PRINT, cashSale: true, drawerAlreadyOpened: true }).includes("not open the drawer again"), "hint opened");
  ok(receiptButtonsHint({ config: ONLY, cashSale: false, drawerAlreadyOpened: false }).includes("stays shut"), "hint no cash");
  ok(drawerOnSaleSummary(ONLY) !== drawerOnSaleSummary(PRINT), "summaries differ");

  console.log(`drawer-on-sale-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`drawer-on-sale-core: ${failed} self-test(s) failed`);
  return { passed, failed };
}
