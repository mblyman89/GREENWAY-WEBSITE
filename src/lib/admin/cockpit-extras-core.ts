/**
 * src/lib/admin/cockpit-extras-core.ts  (CVB-11, pure)
 *
 * Owner, 2026-11-03 (docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, CVB-D18..D20):
 *   "I want to see excise tax, sales tax, and after tax sales figures. Also, the sales by hour section is
 *    broke. Please also repurpose the menu upload tile to be a Leafly dedicated tile for a quick look at
 *    connection status, last sync, etc."
 *
 * Three small, pure pieces the dashboard renders:
 *   - cockpitTaxFigures: today's excise, sales tax and after-tax sales from the SAME engine as Reports -> Tax
 *     (getWaTaxReport). After-tax sales = the pre-tax base (what the store keeps). Nothing is estimated: a
 *     report that could not be read gives `null`, and the page says "unavailable" instead of $0.00.
 *   - hourWindow: which hours to draw. 8 AM to midnight by default (Washington's legal selling day, the same
 *     limit store-hours-core.ts enforces), widened to include any hour that had a
 *     sale, so a late sale is never cut off. Bars are scaled 0..100 against the busiest hour.
 *   - leaflyTile: the one-line Leafly status for the tile, built from the verdict the Leafly page shows
 *     (describeLeaflyConnection), so the tile and the page can never disagree.
 *
 * No I/O. Money in cents.
 */

export type TaxReportLike = {
  hasData: boolean;
  totalBaseMinor: number;
  salesTaxMinor: number;
  exciseTaxMinor: number;
  totalTaxMinor: number;
  orders: number;
  medicalExemptLines: number;
};

export type CockpitTaxFigures = {
  exciseMinor: number;
  salesTaxMinor: number;
  /** Pre-tax base: what the store keeps after excise and sales tax are set aside. */
  afterTaxMinor: number;
  /** Tax-inclusive total of the same lines (after-tax + both taxes). */
  withTaxMinor: number;
  orders: number;
  medicalExemptLines: number;
};

/** null in -> null out (the read failed: show "unavailable", never zero). */
export function cockpitTaxFigures(r: TaxReportLike | null): CockpitTaxFigures | null {
  if (!r) return null;
  const n = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0);
  const excise = n(r.exciseTaxMinor);
  const sales = n(r.salesTaxMinor);
  const base = n(r.totalBaseMinor);
  return {
    exciseMinor: excise,
    salesTaxMinor: sales,
    afterTaxMinor: base,
    withTaxMinor: base + excise + sales,
    orders: Math.max(0, Math.round(r.orders || 0)),
    medicalExemptLines: Math.max(0, Math.round(r.medicalExemptLines || 0)),
  };
}

export type HourIn = { hour: number; label: string; revenueMinorUnits: number; orders: number };
export type HourBar = HourIn & { heightPct: number; shortLabel: string };

/** "9 AM" -> "9a", "12 PM" -> "12p". */
export function shortHourLabel(label: string): string {
  const m = /^(\d{1,2})\s*(AM|PM)$/i.exec(label.trim());
  if (!m) return label;
  return `${m[1]}${m[2][0].toLowerCase()}`;
}

/**
 * The hours to draw: [openHour, closeHour) widened to every hour that had a sale. Always contiguous and in
 * order. Heights are percentages of the busiest hour (a non-zero hour is at least 2% so it is visible).
 */
export function hourWindow(hours: readonly HourIn[], openHour = 8, closeHour = 24): HourBar[] {
  const byHour = new Map<number, HourIn>();
  for (const h of hours) if (Number.isInteger(h.hour) && h.hour >= 0 && h.hour < 24) byHour.set(h.hour, h);
  let lo = Math.max(0, Math.min(23, openHour));
  let hi = Math.max(lo, Math.min(23, closeHour - 1));
  for (const h of byHour.values()) {
    if (h.revenueMinorUnits > 0 || h.orders > 0) {
      lo = Math.min(lo, h.hour);
      hi = Math.max(hi, h.hour);
    }
  }
  const max = [...byHour.values()].reduce((m, h) => Math.max(m, h.revenueMinorUnits), 0);
  const out: HourBar[] = [];
  for (let hr = lo; hr <= hi; hr++) {
    const h = byHour.get(hr) ?? { hour: hr, label: fallbackLabel(hr), revenueMinorUnits: 0, orders: 0 };
    const v = Math.max(0, h.revenueMinorUnits);
    const pct = max > 0 ? Math.round((v / max) * 100) : 0;
    out.push({ ...h, heightPct: v > 0 ? Math.max(2, pct) : 0, shortLabel: shortHourLabel(h.label) });
  }
  return out;
}

function fallbackLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

export type LeaflyVerdictLike = {
  tone: "good" | "waiting" | "bad" | "off";
  headline: string;
  lastSentIso: string | null;
};

export type LeaflyTile = {
  value: string;
  hint: string;
  accent: "green" | "gold" | "orange" | "muted";
};

/**
 * The dashboard's Leafly tile. `verdict` null = the status could not be worked out at all.
 * `elapsed(iso)` turns a time into "3 hours ago" (injected so this stays pure and testable).
 */
export function leaflyTile(
  verdict: LeaflyVerdictLike | null,
  lastCheckIso: string | null,
  elapsed: (iso: string | null) => string,
): LeaflyTile {
  if (!verdict) return { value: "Cannot check", hint: "Leafly status could not be read. Open Leafly for details.", accent: "orange" };
  const accent = verdict.tone === "good" ? "green" : verdict.tone === "waiting" ? "gold" : verdict.tone === "bad" ? "orange" : "muted";
  const sent = verdict.lastSentIso ? `Menu sent ${elapsed(verdict.lastSentIso)}` : "Menu not sent yet";
  const check = lastCheckIso ? ` · checked ${elapsed(lastCheckIso)}` : "";
  return { value: verdict.headline, hint: `${sent}${check}`, accent };
}

// ---------------------------------------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------------------------------------

export function __runCockpitExtrasTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      messages.push(m);
    }
  };

  // taxes
  ok(cockpitTaxFigures(null) === null, "unreadable tax report -> null, never zero");
  const t = cockpitTaxFigures({ hasData: true, totalBaseMinor: 10000, salesTaxMinor: 930, exciseTaxMinor: 3700, totalTaxMinor: 4630, orders: 3, medicalExemptLines: 1 })!;
  ok(t.afterTaxMinor === 10000, "after-tax = pre-tax base");
  ok(t.exciseMinor === 3700 && t.salesTaxMinor === 930, "excise and sales tax passed through");
  ok(t.withTaxMinor === 14630, "with-tax = base + both taxes");
  ok(t.orders === 3 && t.medicalExemptLines === 1, "orders and exempt lines kept");
  const z = cockpitTaxFigures({ hasData: false, totalBaseMinor: 0, salesTaxMinor: 0, exciseTaxMinor: 0, totalTaxMinor: 0, orders: 0, medicalExemptLines: 0 })!;
  ok(z.afterTaxMinor === 0 && z.withTaxMinor === 0, "no sales today is a real zero");
  const nan = cockpitTaxFigures({ hasData: true, totalBaseMinor: Number.NaN, salesTaxMinor: 1.4, exciseTaxMinor: 2.6, totalTaxMinor: 4, orders: 1, medicalExemptLines: 0 })!;
  ok(nan.afterTaxMinor === 0 && nan.salesTaxMinor === 1 && nan.exciseMinor === 3, "non-finite -> 0, fractions rounded to whole cents");

  // hours
  ok(shortHourLabel("9 AM") === "9a" && shortHourLabel("12 PM") === "12p" && shortHourLabel("x") === "x", "short labels");
  const empty = hourWindow([], 8, 23);
  ok(empty.length === 15 && empty[0].hour === 8 && empty[14].hour === 22, "no sales: opening 8 AM to the 10 PM hour");
  const legal = hourWindow([]);
  ok(legal.length === 16 && legal[0].hour === 8 && legal[15].hour === 23, "default = WA legal selling day, 8 AM to midnight");
  ok(empty.every((b) => b.heightPct === 0), "no sales: all zero heights");
  const hrs: HourIn[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: fallbackLabel(h), revenueMinorUnits: 0, orders: 0 }));
  hrs[10].revenueMinorUnits = 5000; hrs[10].orders = 2;
  hrs[14].revenueMinorUnits = 10000; hrs[14].orders = 4;
  hrs[15].revenueMinorUnits = 100; hrs[15].orders = 1;
  const w = hourWindow(hrs, 8, 23);
  const at = (h: number) => w.find((b) => b.hour === h)!;
  ok(at(14).heightPct === 100 && at(10).heightPct === 50, "scaled against the busiest hour");
  ok(at(15).heightPct === 2, "a tiny hour is still visible (2% floor)");
  ok(at(9).heightPct === 0, "an empty hour is zero");
  hrs[23].revenueMinorUnits = 700; hrs[23].orders = 1;
  hrs[6].revenueMinorUnits = 300; hrs[6].orders = 1;
  const wide = hourWindow(hrs, 8, 23);
  ok(wide[0].hour === 6 && wide[wide.length - 1].hour === 23, "a sale outside opening hours widens the window");
  ok(wide.every((b, i) => i === 0 || b.hour === wide[i - 1].hour + 1), "contiguous");
  const refundOnly = hourWindow([{ hour: 3, label: "3 AM", revenueMinorUnits: 0, orders: 1 }], 8, 23);
  ok(refundOnly[0].hour === 3, "an hour with an order but no revenue still widens the window");
  ok(hourWindow([{ hour: 25, label: "?", revenueMinorUnits: 9, orders: 1 }]).length === 16, "out-of-range hour ignored");

  // leafly
  const el = (iso: string | null) => (iso ? `at ${iso}` : "never");
  const none = leaflyTile(null, null, el);
  ok(none.value === "Cannot check" && none.accent === "orange", "no verdict -> Cannot check");
  const good = leaflyTile({ tone: "good", headline: "Connected and syncing", lastSentIso: "S" }, "C", el);
  ok(good.accent === "green" && good.value === "Connected and syncing", "good is green with the page's headline");
  ok(good.hint === "Menu sent at S · checked at C", "hint has last send and last check");
  ok(leaflyTile({ tone: "waiting", headline: "h", lastSentIso: null }, null, el).hint === "Menu not sent yet", "never sent");
  ok(leaflyTile({ tone: "waiting", headline: "h", lastSentIso: null }, null, el).accent === "gold", "waiting is gold");
  ok(leaflyTile({ tone: "bad", headline: "h", lastSentIso: null }, null, el).accent === "orange", "bad is orange");
  ok(leaflyTile({ tone: "off", headline: "h", lastSentIso: null }, null, el).accent === "muted", "off is muted");

  return { passed, failed, messages };
}
