/**
 * src/lib/pos/leaderboard-core.ts  (POS Slice B34)
 *
 * PURE budtender-leaderboard math (no I/O, no React) — the SparkPlug /
 * Flowhub motivation loop, computed straight from the register's own
 * append-only ledger (`pos_sale_events`) instead of a SaaS bill.
 *
 * Two boards:
 *   TODAY — ranked by SALES COUNT (ties: items, then name). Deliberately
 *     shows NO dollar figures: same-day per-employee gross could reconstruct
 *     a register's expected drawer cash (gross + float − drops) when one
 *     budtender rings a whole drawer, defeating the B21/B22 blind-count
 *     discipline that keeps closes honest.
 *   TRAILING WEEK (7 Pacific days incl. today) — ranked by GROSS dollars.
 *     A multi-day aggregate spans closed/reconciled sessions, so it can't
 *     be used to precompute today's drawer — the classic retail
 *     "top seller this week" board.
 *
 * Only PROCESSED sales count (the server compliance gate accepted them);
 * pending/exception rows never inflate anyone's numbers. Gross sums the
 * PRE-ROUNDED payload totalMinor (B33 keeps tax/totals pre-rounded).
 *
 * Money is MINOR UNITS (cents); ranking uses competition ranking
 * (tied entries share a rank; the next rank skips).
 */

function intOrZero(v: unknown): number {
  return Number.isInteger(v) ? (v as number) : 0;
}

/** Minimal ledger row shape the aggregator needs (from pos_sale_events). */
export type LeaderboardEventRow = {
  employeeId: string;
  eventType: string;
  status: string; // pending | processed | exception
  payload: unknown;
  /** Pacific business day (YYYY-MM-DD) the event occurred on. */
  dayKey: string;
};

export type LeaderboardTotals = {
  employeeId: string;
  saleCount: number;
  itemCount: number;
  grossMinor: number;
};

export type LeaderboardBoards = {
  /** Aggregated over rows whose dayKey === todayKey. */
  today: LeaderboardTotals[];
  /** Aggregated over ALL rows handed in (the route passes the 7-day window). */
  week: LeaderboardTotals[];
};

/**
 * Aggregate processed sales per employee for the today + week boards.
 * Defensive on payload shape: a malformed payload still counts the sale but
 * contributes zero money/items rather than NaN-poisoning the board.
 */
export function aggregateLeaderboard(rows: LeaderboardEventRow[], todayKey: string): LeaderboardBoards {
  const today = new Map<string, LeaderboardTotals>();
  const week = new Map<string, LeaderboardTotals>();
  const bump = (map: Map<string, LeaderboardTotals>, row: LeaderboardEventRow, items: number, gross: number) => {
    const cur = map.get(row.employeeId) ?? {
      employeeId: row.employeeId,
      saleCount: 0,
      itemCount: 0,
      grossMinor: 0,
    };
    cur.saleCount += 1;
    cur.itemCount += items;
    cur.grossMinor += gross;
    map.set(row.employeeId, cur);
  };
  for (const row of rows) {
    if (row.eventType !== "sale" || row.status !== "processed") continue;
    if (typeof row.employeeId !== "string" || !row.employeeId) continue;
    const p = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
    const lines = Array.isArray(p.lines) ? (p.lines as unknown[]) : [];
    let items = 0;
    for (const l of lines) {
      if (l && typeof l === "object") items += intOrZero((l as Record<string, unknown>).quantity);
    }
    const gross = intOrZero(p.totalMinor);
    bump(week, row, items, gross);
    if (row.dayKey === todayKey) bump(today, row, items, gross);
  }
  return { today: [...today.values()], week: [...week.values()] };
}

export type RankedEntry = LeaderboardTotals & {
  /** Competition rank (1-based; ties share, next skips). */
  rank: number;
  /** Display name resolved by the caller ("Unknown" when unresolvable). */
  name: string;
};

/**
 * Rank a board. TODAY ranks by sales count (ties: items, then name — money
 * stays off the same-day board by design); WEEK ranks by gross (ties: sales
 * count, then name). Names come from the employees table via `names`.
 */
export function rankLeaderboard(
  entries: LeaderboardTotals[],
  mode: "today" | "week",
  names: Record<string, string>,
): RankedEntry[] {
  const nameOf = (id: string) => names[id]?.trim() || "Unknown";
  const keyed = entries.map((e) => ({ ...e, name: nameOf(e.employeeId) }));
  const primary = (e: LeaderboardTotals) => (mode === "week" ? e.grossMinor : e.saleCount);
  const secondary = (e: LeaderboardTotals) => (mode === "week" ? e.saleCount : e.itemCount);
  keyed.sort((a, b) => {
    if (primary(b) !== primary(a)) return primary(b) - primary(a);
    if (secondary(b) !== secondary(a)) return secondary(b) - secondary(a);
    return a.name.localeCompare(b.name);
  });
  const ranked: RankedEntry[] = [];
  for (let i = 0; i < keyed.length; i += 1) {
    const prev = ranked[i - 1];
    const tiedWithPrev =
      prev !== undefined &&
      primary(keyed[i]) === primary(keyed[i - 1]) &&
      secondary(keyed[i]) === secondary(keyed[i - 1]);
    ranked.push({ ...keyed[i], rank: tiedWithPrev ? prev.rank : i + 1 });
  }
  return ranked;
}

/** Medal for the podium ranks; empty string below the podium. */
export function medalFor(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runLeaderboardCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL leaderboard-core: ${label}`);
    }
  };

  const TODAY = "2026-07-16";
  const sale = (employeeId: string, dayKey: string, totalMinor: number, qty: number, status = "processed") => ({
    employeeId,
    eventType: "sale",
    status,
    payload: { totalMinor, lines: [{ quantity: qty }] },
    dayKey,
  });

  // Aggregation: today vs week windows, processed-only.
  const boards = aggregateLeaderboard(
    [
      sale("emp-a", TODAY, 5000, 2),
      sale("emp-a", TODAY, 3000, 1),
      sale("emp-b", TODAY, 9000, 3),
      sale("emp-a", "2026-07-14", 20000, 5), // earlier this week
      sale("emp-c", "2026-07-13", 100, 1),
      sale("emp-b", TODAY, 9999, 9, "pending"), // never counts
      sale("emp-b", TODAY, 9999, 9, "exception"), // never counts
      { employeeId: "emp-d", eventType: "no_sale", status: "processed", payload: {}, dayKey: TODAY },
      { employeeId: "", eventType: "sale", status: "processed", payload: { totalMinor: 777 }, dayKey: TODAY },
      { employeeId: "emp-e", eventType: "sale", status: "processed", payload: "garbage", dayKey: TODAY },
    ],
    TODAY,
  );
  const todayA = boards.today.find((e) => e.employeeId === "emp-a");
  const weekA = boards.week.find((e) => e.employeeId === "emp-a");
  ok(todayA?.saleCount === 2 && todayA.itemCount === 3 && todayA.grossMinor === 8000, "today: A = 2 sales, 3 items, $80");
  ok(weekA?.saleCount === 3 && weekA.grossMinor === 28000, "week: A includes the earlier day");
  ok(boards.today.find((e) => e.employeeId === "emp-c") === undefined, "today excludes other days");
  ok(boards.week.find((e) => e.employeeId === "emp-c")?.grossMinor === 100, "week includes all handed-in days");
  const todayB = boards.today.find((e) => e.employeeId === "emp-b");
  ok(todayB?.saleCount === 1 && todayB.grossMinor === 9000, "pending/exception rows never count");
  ok(boards.today.find((e) => e.employeeId === "emp-d") === undefined, "no_sale events never count");
  ok(boards.today.find((e) => e.employeeId === "") === undefined, "blank employee id dropped");
  const todayE = boards.today.find((e) => e.employeeId === "emp-e");
  ok(todayE?.saleCount === 1 && todayE.grossMinor === 0 && todayE.itemCount === 0, "malformed payload counts sale, zero money");
  ok(aggregateLeaderboard([], TODAY).today.length === 0, "empty ledger → empty boards");

  // Ranking: today by sales count (money ignored), week by gross.
  const names = { "emp-a": "Alex", "emp-b": "Bailey", "emp-c": "Casey" };
  const todayRanked = rankLeaderboard(
    [
      { employeeId: "emp-a", saleCount: 5, itemCount: 9, grossMinor: 100 },
      { employeeId: "emp-b", saleCount: 7, itemCount: 10, grossMinor: 50 },
      { employeeId: "emp-c", saleCount: 5, itemCount: 12, grossMinor: 999999 },
    ],
    "today",
    names,
  );
  ok(todayRanked[0].employeeId === "emp-b" && todayRanked[0].rank === 1, "today: most SALES wins regardless of gross");
  ok(todayRanked[1].employeeId === "emp-c", "today tie on sales broken by items");
  ok(todayRanked[2].employeeId === "emp-a" && todayRanked[2].rank === 3, "today: fewest items of the tie ranks last");

  const weekRanked = rankLeaderboard(
    [
      { employeeId: "emp-a", saleCount: 10, itemCount: 20, grossMinor: 50000 },
      { employeeId: "emp-b", saleCount: 2, itemCount: 3, grossMinor: 90000 },
      { employeeId: "emp-c", saleCount: 10, itemCount: 30, grossMinor: 50000 },
    ],
    "week",
    names,
  );
  ok(weekRanked[0].employeeId === "emp-b", "week: gross wins");
  // A and C tie on gross AND sales → competition ranking shares rank 2.
  ok(weekRanked[1].rank === 2 && weekRanked[2].rank === 2, "week: full tie shares the rank");
  ok(weekRanked[1].name === "Alex" && weekRanked[2].name === "Casey", "week: tie ordered by name");

  // Competition ranking skips after a shared rank.
  const skip = rankLeaderboard(
    [
      { employeeId: "emp-a", saleCount: 5, itemCount: 5, grossMinor: 0 },
      { employeeId: "emp-b", saleCount: 5, itemCount: 5, grossMinor: 0 },
      { employeeId: "emp-c", saleCount: 4, itemCount: 5, grossMinor: 0 },
    ],
    "today",
    names,
  );
  ok(skip[0].rank === 1 && skip[1].rank === 1 && skip[2].rank === 3, "1-1-3 competition ranking");

  // Unknown employee ids get a safe name.
  const anon = rankLeaderboard([{ employeeId: "emp-x", saleCount: 1, itemCount: 1, grossMinor: 1 }], "today", names);
  ok(anon[0].name === "Unknown", "unresolvable employee → Unknown");

  // Medals.
  ok(medalFor(1) === "🥇" && medalFor(2) === "🥈" && medalFor(3) === "🥉" && medalFor(4) === "", "podium medals");

  console.log(`leaderboard-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`leaderboard-core: ${fail} failure(s)`);
}
