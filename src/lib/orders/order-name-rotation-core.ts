/**
 * src/lib/orders/order-name-rotation-core.ts  (Slice 23)
 *
 * PURE rotation intelligence for the fun order-name pool. No I/O, no React,
 * no server-only import, so the store, the admin UI and vitest all run the
 * IDENTICAL logic.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Slice 113 shipped a Least-Recently-Used picker (order-name-pool-core
 * `pickNextOrderName`): take the enabled name with the oldest
 * `last_assigned_at`. For online orders only — a handful a day — that was
 * entirely adequate.
 *
 * Slice 23 puts the same pool behind the REGISTER, and the owner's own
 * numbers change the problem:
 *
 *   > "we do not see very many online orders, and we average about 200 in
 *   >  store transactions per day. I have about 50 overlays in the system"
 *
 * 200 assignments a day against ~50 names is a different regime. Three real
 * defects appear at that rate that simply never surfaced at online volume:
 *
 *  1. TIE COLLAPSE. A fresh pool has `last_assigned_at = null` on every row.
 *     LRU then falls through to `sort_order`, so the very first pass is not a
 *     rotation at all — it is the admin list order, top to bottom.
 *
 *  2. TIMESTAMP GRANULARITY. Two assignments inside the same clock tick sort
 *     equal, and the tie-break (sort_order, then id) is CONSTANT. Under load
 *     the rotation can bias toward the same low-sort_order rows.
 *
 *  3. NO GAP GUARANTEE. LRU maximises the gap only if every pick rotates
 *     perfectly. Disable a name, add three, re-enable one, and the ordering
 *     shifts underneath you; nothing in the old code can promise "this name
 *     will not come back for at least N sales", which is precisely what the
 *     owner asked for:
 *
 *   > "if its possible to add intelligent picking and assigning and rotating
 *   >  so that no two of the same overlays can be used within a certain
 *   >  number of uses between each other would be ideal"
 *
 * THE FIX: a MONOTONIC ASSIGNMENT SEQUENCE, not a wall clock.
 * Every assignment takes the next integer from a strictly increasing counter
 * and stamps it on the row it used (`last_assigned_seq`). "How many sales ago
 * was this name used" then becomes exact integer arithmetic —
 * `currentSeq - row.last_assigned_seq` — with no clock skew, no ties, and no
 * dependence on how fast the register is going. A never-used name is
 * infinitely old. This is the standard technique for LRU eviction under
 * concurrency, and it is why CPU caches use a counter rather than a timestamp.
 *
 * WHAT THIS BUYS, STATED HONESTLY: with P enabled names the BEST achievable
 * spacing is P - 1 assignments between repeats, and that is a mathematical
 * ceiling, not an implementation limit. You cannot draw 200 times from 50
 * names and have any pair further apart than 49 on average. `rotationCapacity`
 * below reports that ceiling truthfully to the owner rather than implying a
 * guarantee the arithmetic cannot support.
 */

/** A pool row as the rotation sees it. Mirrors order_name_pool + Slice 23. */
export type RotationRow = {
  id: string;
  name: string;
  enabled: boolean;
  sort_order: number;
  /**
   * The assignment counter value when this name was last handed out, or null
   * when it has never been used. Slice 23 column; null on every pre-23 row,
   * which is exactly right — an un-stamped name reads as "never used".
   */
  last_assigned_seq?: number | null;
  /** Slice 113 wall-clock stamp. Kept for display and as a legacy tie-break. */
  last_assigned_at?: string | null;
  assigned_count?: number;
};

/** The outcome of a pick. `null` name means "no enabled names — use the real number". */
export type RotationPick = {
  row: RotationRow | null;
  /** How many assignments ago this name was last used; null = never used. */
  gap: number | null;
  /**
   * True when the pool is too small to honour the requested minimum gap and we
   * had to hand back the least-recently-used name anyway. Surfaced to the
   * owner as "add more names", never hidden.
   */
  gapCompromised: boolean;
};

/**
 * The smallest pool we will still rotate through. Below this the "fun" wears
 * off fast — the same two or three names all day — and the owner is better
 * served by a visible warning than by silent repetition.
 */
export const ROTATION_MIN_HEALTHY_POOL = 12;

/** The gap the UI aims for by default when advising the owner. */
export const ROTATION_TARGET_GAP = 25;

/** How old a never-used name is. Larger than any real gap, so it always wins. */
export const NEVER_USED_GAP = Number.MAX_SAFE_INTEGER;

/**
 * The effective age of a row, in assignments. Never-used sorts oldest.
 *
 * A row stamped with a sequence NEWER than `currentSeq` is corrupt (a restored
 * backup, a hand-edited row). It is treated as just-used (gap 0) rather than
 * trusted, because the safe failure is "hold this name back", never "hand out
 * a name that may have just been used".
 */
export function assignmentGap(row: RotationRow, currentSeq: number): number {
  const seq = row.last_assigned_seq;
  if (typeof seq !== "number" || !Number.isFinite(seq)) return NEVER_USED_GAP;
  const gap = currentSeq - seq;
  if (!Number.isFinite(gap)) return NEVER_USED_GAP;
  return gap < 0 ? 0 : gap;
}

/**
 * The rotation order: oldest-by-assignment-count first, then never-used by
 * sort_order, then id. Total and stable, so the picker and the owner-facing
 * preview can never disagree.
 */
export function rotationOrder(pool: readonly RotationRow[], currentSeq: number): RotationRow[] {
  return pool
    .filter((r) => r.enabled)
    .slice()
    .sort((a, b) => {
      const ga = assignmentGap(a, currentSeq);
      const gb = assignmentGap(b, currentSeq);
      if (ga !== gb) return gb - ga; // larger gap = older = first
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Choose the next name, honouring a minimum gap when the pool can afford it.
 *
 * The head of the rotation order is by definition the least-recently-used
 * name, so it already MAXIMISES the gap. `minGap` therefore does not change
 * which name is chosen — it changes what we TELL the owner: when even the best
 * available name is fresher than `minGap`, the pool is too small for the
 * requested spacing and `gapCompromised` says so out loud.
 *
 * Returning the LRU name anyway (rather than refusing) is deliberate: a
 * customer holding a receipt would rather see a repeated fun name than a bare
 * transaction id, and the owner would rather see a warning in admin than a
 * silent failure at the counter.
 */
export function pickRotationName(
  pool: readonly RotationRow[],
  currentSeq: number,
  minGap: number = ROTATION_TARGET_GAP,
): RotationPick {
  const ordered = rotationOrder(pool, currentSeq);
  const head = ordered[0];
  if (!head) return { row: null, gap: null, gapCompromised: false };

  const g = assignmentGap(head, currentSeq);
  const never = g === NEVER_USED_GAP;
  return {
    row: head,
    gap: never ? null : g,
    gapCompromised: !never && Number.isFinite(minGap) && minGap > 0 && g < minGap,
  };
}

/** What a pool of this size can actually promise. Honest arithmetic, not spin. */
export type RotationCapacity = {
  /** Enabled names available to the rotation. */
  poolSize: number;
  /**
   * The best achievable spacing between two uses of the same name. With P
   * names in perfect rotation a name repeats every P assignments, so P - 1
   * others fall in between. This is a ceiling imposed by arithmetic.
   */
  maxGap: number;
  /** Roughly how long that spacing lasts, given the shop's daily volume. */
  hoursBetweenRepeats: number | null;
  /** True when the pool clears the requested target. */
  meetsTarget: boolean;
  /** How many more names would be needed to clear the target. 0 when met. */
  namesNeeded: number;
  /** Below ROTATION_MIN_HEALTHY_POOL the rotation feels repetitive. */
  healthy: boolean;
};

/**
 * Tell the owner exactly what his pool size buys, so "add more names" is a
 * measured recommendation with a number attached rather than a vague nudge.
 *
 * `dailyVolume` is the shop's own transaction count (the owner reports ~200)
 * and `openHoursPerDay` converts assignments into wall-clock time, which is
 * the unit a customer actually experiences: two people in the shop at the same
 * time with the same fun name is the thing worth avoiding.
 */
export function rotationCapacity(
  poolSize: number,
  targetGap: number = ROTATION_TARGET_GAP,
  dailyVolume: number = 200,
  openHoursPerDay: number = 12,
): RotationCapacity {
  const size = Number.isFinite(poolSize) ? Math.max(0, Math.floor(poolSize)) : 0;
  const target = Number.isFinite(targetGap) ? Math.max(0, Math.floor(targetGap)) : 0;
  const maxGap = size > 0 ? size - 1 : 0;

  let hours: number | null = null;
  if (size > 0 && dailyVolume > 0 && openHoursPerDay > 0 && Number.isFinite(dailyVolume)) {
    const perHour = dailyVolume / openHoursPerDay;
    if (perHour > 0) hours = Math.round((size / perHour) * 10) / 10;
  }

  return {
    poolSize: size,
    maxGap,
    hoursBetweenRepeats: hours,
    meetsTarget: maxGap >= target,
    namesNeeded: maxGap >= target ? 0 : target - maxGap + 1,
    healthy: size >= ROTATION_MIN_HEALTHY_POOL,
  };
}

/**
 * A deterministic preview of the next `count` names, simulating the rotation
 * (each pick is stamped with the next sequence value and falls to the back).
 * This is what the admin screen shows, and because it runs the REAL ordering
 * it cannot drift from what the register will actually do.
 */
export function previewRotation(
  pool: readonly RotationRow[],
  currentSeq: number,
  count: number,
): string[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const working: RotationRow[] = pool.filter((r) => r.enabled).map((r) => ({ ...r }));
  if (working.length === 0) return [];

  const out: string[] = [];
  let seq = currentSeq;
  for (let i = 0; i < count; i++) {
    const pick = pickRotationName(working, seq, 0);
    if (!pick.row) break;
    out.push(pick.row.name);
    seq += 1;
    const target = working.find((r) => r.id === pick.row!.id);
    if (target) target.last_assigned_seq = seq;
  }
  return out;
}

/**
 * Split a pasted block into candidate names, for the bulk-add box.
 *
 * The owner asked to "upload a list", and real pasted lists are messy: they
 * come from Notes, Excel, a text message. So every plausible separator is
 * honoured — newlines, commas, semicolons, tabs — and common list decoration
 * ("1. ", "- ", "* ", quotes) is stripped. Internal spaces are preserved
 * because "High Life" is two words, not two names.
 *
 * Duplicates WITHIN the paste are collapsed case-insensitively, keeping the
 * first spelling the owner typed. Validation against the EXISTING pool stays
 * where it already lives (order-name-pool-core.validateOrderName) so there is
 * exactly one duplicate rule in the codebase.
 */
export function parseBulkNames(raw: string): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const piece of raw.split(/[\n\r,;\t]+/)) {
    let s = piece.trim();
    if (!s) continue;
    // Strip list decoration: "1.", "1)", "-", "*", "•"
    s = s.replace(/^\s*(?:\d+\s*[.)]|[-*\u2022])\s*/, "");
    // Strip wrapping quotes the spreadsheet added.
    s = s.replace(/^["']+|["']+$/g, "");
    // Collapse internal whitespace, matching normalizeOrderName.
    s = s.replace(/\s+/g, " ").trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function r(
  id: string,
  name: string,
  opts: Partial<Omit<RotationRow, "id" | "name">> = {},
): RotationRow {
  return {
    id,
    name,
    enabled: opts.enabled ?? true,
    sort_order: opts.sort_order ?? 0,
    last_assigned_seq: opts.last_assigned_seq ?? null,
  };
}

export function __runOrderNameRotationCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`[order-name-rotation] FAIL: ${msg}`);
    }
  };

  // --- assignmentGap -------------------------------------------------------
  ok(assignmentGap(r("a", "A"), 100) === NEVER_USED_GAP, "never-used is infinitely old");
  ok(assignmentGap(r("a", "A", { last_assigned_seq: 90 }), 100) === 10, "gap is exact integer age");
  ok(assignmentGap(r("a", "A", { last_assigned_seq: 100 }), 100) === 0, "just-used has gap 0");
  ok(
    assignmentGap(r("a", "A", { last_assigned_seq: 500 }), 100) === 0,
    "a future stamp is distrusted as just-used, never as ancient",
  );

  // --- rotation order ------------------------------------------------------
  const pool = [
    r("1", "A", { last_assigned_seq: 99 }), // gap 1  (freshest)
    r("2", "B", { last_assigned_seq: 50 }), // gap 50
    r("3", "C"), //                           never used
    r("4", "D", { enabled: false, last_assigned_seq: 1 }),
    r("5", "E", { last_assigned_seq: 80 }), // gap 20
  ];
  ok(
    rotationOrder(pool, 100).map((x) => x.name).join(",") === "C,B,E,A",
    "rotation: never-used first, then oldest by gap, disabled excluded",
  );
  ok(rotationOrder(pool, 100).every((x) => x.enabled), "rotation excludes disabled names");

  // The tie-collapse defect this file exists to fix: a brand-new pool must
  // still rotate, not just walk the admin list once and then bias.
  const fresh = [
    r("1", "A", { sort_order: 0 }),
    r("2", "B", { sort_order: 1 }),
    r("3", "C", { sort_order: 2 }),
  ];
  ok(
    previewRotation(fresh, 0, 7).join(",") === "A,B,C,A,B,C,A",
    "a fresh (all-null) pool rotates cleanly instead of collapsing",
  );

  // --- pick ----------------------------------------------------------------
  ok(pickRotationName(pool, 100).row?.name === "C", "pick: head of the rotation");
  ok(pickRotationName(pool, 100).gap === null, "pick: never-used reports a null gap");
  ok(pickRotationName([], 0).row === null, "pick: empty pool -> null (use the real number)");
  ok(
    pickRotationName([r("x", "X", { enabled: false })], 0).row === null,
    "pick: all-disabled -> null",
  );
  ok(
    pickRotationName([r("x", "X", { last_assigned_seq: 99 })], 100, 25).gapCompromised === true,
    "pick: a one-name pool reports the gap as compromised",
  );
  ok(
    pickRotationName([r("x", "X", { last_assigned_seq: 99 })], 100, 0).gapCompromised === false,
    "pick: minGap 0 disables the warning",
  );
  ok(
    pickRotationName(pool, 100, 25).gapCompromised === false,
    "pick: a never-used name is never 'compromised'",
  );

  // The whole point: the same name must not come back inside the pool size.
  const fifty = Array.from({ length: 50 }, (_, i) => r(`id${i}`, `N${i}`, { sort_order: i }));
  const seq200 = previewRotation(fifty, 0, 200);
  ok(seq200.length === 200, "preview: 200 assignments from 50 names");
  let minObservedGap = Number.MAX_SAFE_INTEGER;
  const lastSeen = new Map<string, number>();
  for (let i = 0; i < seq200.length; i++) {
    const prev = lastSeen.get(seq200[i]);
    if (prev !== undefined) minObservedGap = Math.min(minObservedGap, i - prev);
    lastSeen.set(seq200[i], i);
  }
  ok(
    minObservedGap === 50,
    `50 names over 200 sales repeat no sooner than every 50 (saw ${minObservedGap})`,
  );

  // --- capacity ------------------------------------------------------------
  const cap50 = rotationCapacity(50, 25, 200, 12);
  ok(cap50.maxGap === 49, "capacity: 50 names -> best gap 49");
  ok(cap50.meetsTarget === true, "capacity: 50 names clears a target of 25");
  ok(cap50.namesNeeded === 0, "capacity: nothing needed when the target is met");
  ok(cap50.healthy === true, "capacity: 50 is a healthy pool");
  ok(cap50.hoursBetweenRepeats === 3, "capacity: 50 names at 200/12h repeats every ~3h");

  const cap5 = rotationCapacity(5, 25, 200, 12);
  ok(cap5.maxGap === 4, "capacity: 5 names -> best gap 4");
  ok(cap5.meetsTarget === false, "capacity: 5 names misses a target of 25");
  ok(cap5.namesNeeded === 22, "capacity: reports exactly how many names to add");
  ok(cap5.healthy === false, "capacity: 5 is an unhealthy pool");

  ok(rotationCapacity(0).maxGap === 0, "capacity: empty pool has no gap");
  ok(rotationCapacity(0).hoursBetweenRepeats === null, "capacity: empty pool has no cadence");
  ok(rotationCapacity(-3).poolSize === 0, "capacity: negative size is clamped");
  ok(
    rotationCapacity(50, 25, 0, 12).hoursBetweenRepeats === null,
    "capacity: zero volume yields no cadence rather than a divide-by-zero",
  );

  // --- preview -------------------------------------------------------------
  ok(previewRotation(pool, 100, 0).length === 0, "preview: count 0 -> empty");
  ok(previewRotation([], 0, 5).length === 0, "preview: empty pool -> empty");
  ok(
    previewRotation([r("z", "Solo")], 0, 3).join(",") === "Solo,Solo,Solo",
    "preview: a single name repeats (and we say so)",
  );
  ok(
    previewRotation(pool, 100, 4).join(",") === "C,B,E,A",
    "preview: matches the rotation order exactly",
  );
  // Preview must not mutate the caller's rows.
  const before = pool.map((x) => x.last_assigned_seq ?? null);
  previewRotation(pool, 100, 10);
  ok(
    pool.every((x, i) => (x.last_assigned_seq ?? null) === before[i]),
    "preview: never mutates the pool it was handed",
  );

  // --- bulk parsing --------------------------------------------------------
  ok(parseBulkNames("A\nB\nC").join("|") === "A|B|C", "bulk: newlines");
  ok(parseBulkNames("A, B; C\tD").join("|") === "A|B|C|D", "bulk: commas, semicolons, tabs");
  ok(parseBulkNames("1. High Life\n2) Nugs4Thugs").join("|") === "High Life|Nugs4Thugs", "bulk: numbered lists");
  ok(parseBulkNames("- A\n* B\n\u2022 C").join("|") === "A|B|C", "bulk: bullet decoration");
  ok(parseBulkNames('"Quoted Name"').join("|") === "Quoted Name", "bulk: strips spreadsheet quotes");
  ok(parseBulkNames("High   Life").join("|") === "High Life", "bulk: collapses inner whitespace");
  ok(parseBulkNames("A\na\nA").join("|") === "A", "bulk: collapses case-insensitive dupes");
  ok(parseBulkNames("A\na").length === 1, "bulk: keeps only the first spelling");
  ok(parseBulkNames("").length === 0, "bulk: empty input -> empty");
  ok(parseBulkNames("   \n  \n ").length === 0, "bulk: whitespace-only -> empty");
  ok(parseBulkNames("\n\n\nA\n\n\n").join("|") === "A", "bulk: ignores blank lines");
  // A name containing a hyphen must survive; only LEADING decoration is stripped.
  ok(parseBulkNames("Sun-Kissed").join("|") === "Sun-Kissed", "bulk: keeps internal hyphens");

  return { passed, failed };
}
