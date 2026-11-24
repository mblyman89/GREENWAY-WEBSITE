/**
 * src/lib/site/render-clock-core.ts — USAGE-7f (owner: Michael, 2026-11-24)
 *
 * PUBLIC RENDERS READ A BUCKETED CLOCK, NOT THE MILLISECOND.
 *
 * WHY (AGENTS.md rule 18)
 * ───────────────────────
 * Vercel does not bill an ISR regeneration whose output is byte-identical to
 * the stored copy. Two public outputs put the render instant into their bytes:
 *
 *   * `src/app/sitemap.ts` stamped EVERY entry `lastModified: new Date()`. The
 *     sitemap is on the 60 s menu clock, so every regeneration changed every
 *     line (≈ 2,800 URLs) and was a full billed write — and it told Google that
 *     every page changed "just now", which Google's docs say makes it ignore
 *     the field.
 *   * The automatic "New" product tag (`withProductTags`) compared
 *     first-published stamps to `Date.now()`, so a tag could expire at any
 *     millisecond inside a render; two renders of the same data a minute apart
 *     could differ.
 *
 * THE FIX
 * ───────
 * Both read `pacificDayStartMs(now)`: the start of the store's calendar day
 * (America/Los_Angeles, DST-correct). Within a store day the value is
 * constant, so the same data renders the same bytes; "New" windows close at
 * the start of a store day (at most one day later than before — display only).
 *
 * NEVER MONEY: prices, deals and stock never read this clock. Deal weekday
 * resolution stays on the live clock (client `useStoreWeekday`, server engine).
 *
 * PURE: wraps the shared Pacific helpers so it is provable in tests.
 */
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

/** Start of the Pacific calendar day containing `nowMs`, as epoch ms. */
export function pacificDayStartMs(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return nowMs;
  return Date.parse(pacificWallTimeToUtcISO(pacificDayKey(new Date(nowMs)), "start"));
}

/** Same, as a Date (for `MetadataRoute.Sitemap.lastModified`). */
export function pacificDayStart(now: Date = new Date()): Date {
  return new Date(pacificDayStartMs(now.getTime()));
}

export function __runRenderClockTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[render-clock] FAIL: ${label}`);
    }
  };

  // PST (UTC-8): 2026-01-15 10:30 local = 18:30Z; day starts 08:00Z.
  check("PST day start", pacificDayStartMs(Date.parse("2026-01-15T18:30:00Z")) === Date.parse("2026-01-15T08:00:00Z"));
  // PDT (UTC-7): 2026-07-04 23:59 local = 2026-07-05T06:59Z; day starts 07:00Z on the 4th.
  check("PDT late evening stays on the local day", pacificDayStartMs(Date.parse("2026-07-05T06:59:00Z")) === Date.parse("2026-07-04T07:00:00Z"));
  check("PDT midnight rolls over", pacificDayStartMs(Date.parse("2026-07-05T07:00:00Z")) === Date.parse("2026-07-05T07:00:00Z"));
  // DST start (2026-03-08): the day began in PST (08:00Z).
  check("DST spring-forward day starts at PST midnight", pacificDayStartMs(Date.parse("2026-03-08T20:00:00Z")) === Date.parse("2026-03-08T08:00:00Z"));
  // DST end (2026-11-01): the day began in PDT (07:00Z).
  check("DST fall-back day starts at PDT midnight", pacificDayStartMs(Date.parse("2026-11-01T20:00:00Z")) === Date.parse("2026-11-01T07:00:00Z"));

  const a = Date.parse("2026-11-24T16:00:00Z");
  check("constant within a store day (renders a minute apart agree)", pacificDayStartMs(a) === pacificDayStartMs(a + 60_000));
  check("constant across many hours of the day", pacificDayStartMs(a) === pacificDayStartMs(a + 6 * 3_600_000));
  check("never in the future", pacificDayStartMs(a) <= a);
  check("at most one day in the past", a - pacificDayStartMs(a) < 25 * 3_600_000);
  check("idempotent", pacificDayStartMs(pacificDayStartMs(a)) === pacificDayStartMs(a));
  check("non-finite passes through", Number.isNaN(pacificDayStartMs(Number.NaN)));
  check("Date wrapper agrees", pacificDayStart(new Date(a)).getTime() === pacificDayStartMs(a));

  return { passed, failed };
}
