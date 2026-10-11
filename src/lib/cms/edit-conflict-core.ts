/**
 * R45-S2: edit-conflict protection (optimistic locking) for the site editor.
 *
 * Problem: two people (or one person in two tabs) open the same block. A saves.
 * B, still looking at the OLD text, presses Save and silently wipes out A's
 * work ("last write wins").
 *
 * Fix: the standard optimistic-concurrency pattern. The editor remembers the
 * row's `updated_at` from when it was opened and sends it back with the save.
 * The server only writes `WHERE block_key = $key AND updated_at = $seen`, one
 * atomic compare-and-swap in Postgres. If someone saved in between, the
 * trigger (public.set_updated_at, migration 0005) has already moved
 * `updated_at`, zero rows match, nothing is overwritten, and the editor is told
 * so. No migration is needed: content_blocks has had updated_at plus that
 * trigger since migration 0005.
 *
 * Reference: HTTP's own version of this is the If-Match / 412 Precondition
 * Failed pair (RFC 9110 §13.1.1). We use the same idea with a timestamp as the
 * validator.
 *
 * Pure: no I/O. The server action and the store use these helpers.
 */

/** Name of the hidden form field the editor sends. */
export const EXPECTED_FIELD = "expected_updated_at";
/** Query param the server adds when a save was refused because of a conflict. */
export const CONFLICT_PARAM = "conflict";

const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Parse the hidden field. Returns the exact string (Postgres compares the full
 * microsecond value, so it must NOT be reformatted through Date), or null when
 * the form didn't send one. Null means legacy save behaviour: no check.
 */
export function parseExpectedVersion(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 40) return null;
  return ISO_RE.test(s) ? s : null;
}

export type SaveOutcome = "saved" | "conflict" | "missing";

/**
 * Decide what happened from the compare-and-swap result.
 *  - rowsUpdated > 0: saved.
 *  - 0 rows and the block still exists: someone else changed it (conflict).
 *  - 0 rows and the block is gone: missing.
 */
export function classifySave(rowsUpdated: number, blockStillExists: boolean): SaveOutcome {
  if (Number.isFinite(rowsUpdated) && rowsUpdated > 0) return "saved";
  return blockStillExists ? "conflict" : "missing";
}

/** Flash string for the redirect, e.g. "conflict=home.hero.title". */
export function conflictFlash(blockKey: string): string {
  return `${CONFLICT_PARAM}=${encodeURIComponent(String(blockKey).slice(0, 200))}`;
}

/** Read the conflict key from the URL (null if absent or junk). */
export function parseConflictParam(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > 200) return null;
  return /^[A-Za-z0-9._:-]+$/.test(s) ? s : null;
}

/** The message the owner sees. Plain English, says what to do next. */
export function conflictMessage(label: string | null | undefined): string {
  const what = label && label.trim() ? `"${label.trim()}"` : "this block";
  return `Someone else saved ${what} after you opened it, so your change was NOT saved, to protect their work. Copy your text if you need it, reload the page to see the latest version, then make your edit again.`;
}

/**
 * True when the block has been changed by someone else since `seen`, so the
 * editor can warn BEFORE saving (e.g. after a background refresh).
 */
export function isStale(seen: string | null, current: string | null): boolean {
  if (!seen || !current) return false;
  return seen !== current;
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runEditConflictCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("edit-conflict-core FAIL:", m);
    }
  };

  // parseExpectedVersion keeps the exact string (microseconds matter).
  const pg = "2026-10-11T05:27:30.050123+00:00";
  ok(parseExpectedVersion(pg) === pg, "postgres timestamptz kept verbatim");
  ok(parseExpectedVersion("2026-10-11T05:27:30Z") === "2026-10-11T05:27:30Z", "Z form");
  ok(parseExpectedVersion("2026-10-11 05:27:30.5+00") === "2026-10-11 05:27:30.5+00", "space + short offset");
  ok(parseExpectedVersion(`  ${pg}  `) === pg, "trimmed");
  ok(parseExpectedVersion("") === null, "empty -> null (legacy)");
  ok(parseExpectedVersion(null) === null && parseExpectedVersion(123) === null, "non-string -> null");
  ok(parseExpectedVersion("yesterday") === null, "junk -> null");
  ok(parseExpectedVersion("2026-10-11") === null, "date only -> null");
  ok(parseExpectedVersion("2026-10-11T05:27:30") === null, "no zone -> null (ambiguous)");
  ok(parseExpectedVersion("2026-10-11T05:27:30Z' or 1=1") === null, "injection-looking -> null");
  ok(parseExpectedVersion("x".repeat(60)) === null, "too long");

  // classifySave
  ok(classifySave(1, true) === "saved", "1 row saved");
  ok(classifySave(1, false) === "saved", "rows win");
  ok(classifySave(0, true) === "conflict", "0 rows + exists = conflict");
  ok(classifySave(0, false) === "missing", "0 rows + gone = missing");
  ok(classifySave(NaN, true) === "conflict", "NaN treated as 0");

  // flash + parse round trip
  ok(conflictFlash("home.hero.title") === "conflict=home.hero.title", "flash");
  ok(conflictFlash("a b") === "conflict=a%20b", "flash encodes");
  ok(parseConflictParam("home.hero.title") === "home.hero.title", "parse ok");
  ok(parseConflictParam("shop-slide:1234") === "shop-slide:1234", "colon ok");
  ok(parseConflictParam("<script>") === null, "junk refused");
  ok(parseConflictParam("") === null && parseConflictParam(null) === null && parseConflictParam(undefined) === null, "empty");
  ok(parseConflictParam("x".repeat(201)) === null, "too long");

  // message
  ok(conflictMessage("Home headline").includes('"Home headline"') && /NOT saved/.test(conflictMessage("x")), "message names block");
  ok(conflictMessage(null).includes("this block") && conflictMessage("  ").includes("this block"), "fallback name");
  ok(/reload/i.test(conflictMessage("x")), "tells what to do");

  // stale
  ok(isStale(pg, "2026-10-11T05:28:00.000001+00:00"), "changed = stale");
  ok(!isStale(pg, pg), "same = fresh");
  ok(!isStale(null, pg) && !isStale(pg, null), "unknown = not stale");

  ok(EXPECTED_FIELD === "expected_updated_at" && CONFLICT_PARAM === "conflict", "constants");
  return { passed, failed };
}
