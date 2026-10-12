/**
 * priority-nav-core.ts — R49 S4 (owner: Michael)
 *
 * OWNER'S ASK: "The top right cart button that is on every page, sits
 * partially off the screen on some screens … it needs to be moved over so it
 * doesn't do this. Not just for my computer, but any computer … make sure this
 * doesn't and can't happen going forward for any element on the page."
 *
 * ROOT CAUSE (measured on the live site with a headless browser, 21 widths
 * 320–2560): the desktop nav row is ten links = 869 px that could not shrink.
 * Logo + nav + the right cluster (Search / Cart / Menu) only fit from ~1700 px
 * up; from 768 px to 1600 px the right cluster was pushed past the screen edge
 * and clipped (at 1440 the Cart button sat at x=1484–1577 on a 1440 screen,
 * i.e. completely off-screen).
 *
 * THE FIX — the "Priority+" navigation pattern (Brad Frost / Filament Group;
 * used by GOV.UK, the Guardian and most enterprise design systems): show as
 * many nav links as genuinely fit and hide the rest; everything stays
 * reachable through the ☰ Menu button, which is visible at every width and
 * already lists every page. The right cluster is never shrunk, so the Cart
 * button can no longer be pushed off-screen by the nav at any width.
 *
 * This module is the pure arithmetic: given the natural widths of the items,
 * the CSS gap and the available width, how many leading items fit?
 *
 * Pure; self-tests via __runPriorityNavCoreTests().
 */

/**
 * Count of leading items that fit in `available` px, given each item's
 * natural width and the gap between items. Items are never reordered, and a
 * partially-fitting item is hidden (never shown clipped). Non-finite or
 * negative inputs are treated as "does not fit" (fail closed: hide).
 */
export function priorityVisibleCount(widths: ReadonlyArray<number>, gap: number, available: number): number {
  if (!Number.isFinite(available) || available <= 0) return 0;
  const g = Number.isFinite(gap) && gap > 0 ? gap : 0;
  let used = 0;
  let count = 0;
  for (const w of widths) {
    if (!Number.isFinite(w) || w < 0) break;
    const next = used + (count > 0 ? g : 0) + w;
    // 0.5 px tolerance absorbs sub-pixel layout rounding.
    if (next > available + 0.5) break;
    used = next;
    count++;
  }
  return count;
}

export function __runPriorityNavCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`priority-nav-core FAIL: ${msg}`);
    }
  };
  // The live nav item widths measured on 2026-10-12 (gap-7 = 28 px).
  const live = [45, 59, 93, 53, 79, 69, 70, 43, 31, 74];
  const total = live.reduce((a, b) => a + b, 0) + 28 * (live.length - 1);
  ok(total === 868, "live nav natural width is 868 px (+/- rounding of the measured 869)");
  ok(priorityVisibleCount(live, 28, 2000) === 10, "everything fits on a wide screen");
  ok(priorityVisibleCount(live, 28, total) === 10, "exact fit shows all");
  ok(priorityVisibleCount(live, 28, total - 1) === 9, "1 px short hides the last item");
  ok(priorityVisibleCount(live, 28, 45) === 1, "first item alone");
  ok(priorityVisibleCount(live, 28, 44) === 0, "nothing fits");
  ok(priorityVisibleCount(live, 28, 45 + 28 + 59) === 2, "gap counted between items only");
  ok(priorityVisibleCount(live, 28, 45 + 28 + 58) === 1, "partial second item hidden, not clipped");
  ok(priorityVisibleCount([], 28, 500) === 0, "no items");
  ok(priorityVisibleCount(live, 28, 0) === 0, "zero width");
  ok(priorityVisibleCount(live, 28, Number.NaN) === 0, "NaN width fails closed");
  ok(priorityVisibleCount([10, Number.NaN, 10], 0, 100) === 1, "bad measurement stops (fail closed)");
  ok(priorityVisibleCount([10, 10], -5, 20) === 2, "negative gap treated as 0");
  ok(priorityVisibleCount([10, 10], 0, 19.6) === 2, "sub-pixel tolerance");
  return { passed, failed };
}
