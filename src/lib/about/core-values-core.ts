/**
 * src/lib/about/core-values-core.ts
 *
 * PURE, dependency-free logic for the About page "Our Values" cards (T-310).
 * No server-only imports so it is unit-testable with tsx.
 *
 * Each core value is a small card: a two-digit ordinal ("01".."0N"), a title,
 * and a one-line summary. The owner can add, edit, delete, and reorder them in
 * the About page editor; the public page renders them with the exact same look.
 *
 * The published `number` on each card is DISPLAY text the owner can override,
 * but the editor also offers auto-numbering (renumberValues) so a freshly added
 * or reordered list gets clean "01, 02, 03…" labels without hand-typing them.
 *
 * This module owns the shape, the byte-identical fallback (the four values the
 * page shipped with), normalization of untrusted DB/form input, and self-tests.
 * The store (core-values-store.ts) does the Supabase I/O and falls back to
 * FALLBACK_CORE_VALUES here so the About page renders identically before the
 * table exists / is seeded.
 */

/** One editable core-value card. */
export type CoreValue = {
  /** Stable key (unique per row) so the editor can address a card. */
  key: string;
  /** Display ordinal, e.g. "01". Owner-overridable; renumberValues can reset. */
  number: string;
  /** Card title, e.g. "Customer Commitment". */
  title: string;
  /** One-line summary under the title. */
  summary: string;
};

/**
 * The four values the About page shipped with, byte-identical to the original
 * hardcoded array. This is the fallback the store returns when the table is
 * missing / empty, so the public page never blanks and stays identical until an
 * owner edits + publishes.
 */
export const FALLBACK_CORE_VALUES: readonly CoreValue[] = [
  { key: "customer-commitment", number: "01", title: "Customer Commitment", summary: "Exceptional Customer Service" },
  { key: "employee-development", number: "02", title: "Employee Development", summary: "Positive Employee Environment" },
  { key: "community", number: "03", title: "Community", summary: "Giving Back to Communities" },
  { key: "trust", number: "04", title: "Trust", summary: "Operating with Honesty and Integrity" },
] as const;

/** How many core-value cards the editor allows (keeps the grid tidy). */
export const MAX_CORE_VALUES = 12;

/** Trim + collapse whitespace; never returns undefined. */
function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Two-digit ordinal label for a 1-based index: 1 -> "01", 10 -> "10". */
export function ordinalLabel(index1: number): string {
  const n = Math.max(1, Math.floor(index1));
  return n < 10 ? `0${n}` : String(n);
}

/**
 * A slug from a title (for a stable key when adding a new card). Falls back to a
 * timestamped key so two blank cards never collide.
 */
export function slugForValue(title: string, seed?: number): string {
  const base = clean(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base) return base.slice(0, 48);
  return `value-${seed ?? Date.now()}`;
}

/** Whether a card has any visible content (used to drop empty rows on save). */
export function valueHasContent(v: CoreValue): boolean {
  return Boolean(clean(v.title) || clean(v.summary));
}

/** Normalize one untrusted row into a clean CoreValue (blank-safe). */
export function normalizeCoreValue(input: unknown, index0 = 0): CoreValue {
  const o = (input ?? {}) as Partial<Record<keyof CoreValue, unknown>>;
  const title = clean(o.title);
  const key = clean(o.key) || slugForValue(title, index0 + 1);
  const number = clean(o.number) || ordinalLabel(index0 + 1);
  return { key, number, title, summary: clean(o.summary) };
}

/**
 * Normalize + de-dupe an untrusted list. Drops empty rows, caps the count,
 * and guarantees unique keys (later duplicates get a "-2", "-3"… suffix).
 */
export function normalizeCoreValues(input: unknown): CoreValue[] {
  const arr = Array.isArray(input) ? input : [];
  const out: CoreValue[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < arr.length && out.length < MAX_CORE_VALUES; i++) {
    const v = normalizeCoreValue(arr[i], out.length);
    if (!valueHasContent(v)) continue;
    let key = v.key || slugForValue(v.title, out.length + 1);
    let n = 2;
    while (seen.has(key)) key = `${v.key}-${n++}`;
    seen.add(key);
    out.push({ ...v, key });
  }
  return out;
}

/** Re-apply clean "01, 02, 03…" ordinals in current order. */
export function renumberValues(values: readonly CoreValue[]): CoreValue[] {
  return values.map((v, i) => ({ ...v, number: ordinalLabel(i + 1) }));
}

/** Move the card at `index` one slot up (or down); returns a new array. */
export function moveValue(
  values: readonly CoreValue[],
  index: number,
  direction: "up" | "down",
): CoreValue[] {
  const next = values.slice();
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next;
  }
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Serialize to the JSON stored in the table's jsonb column (stable order). */
export function serializeCoreValues(values: readonly CoreValue[]): string {
  return JSON.stringify(
    normalizeCoreValues(values).map((v) => ({
      key: v.key,
      number: v.number,
      title: v.title,
      summary: v.summary,
    })),
  );
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run via tsx)
// ---------------------------------------------------------------------------
export function __runCoreValuesTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  core-values FAIL: ${msg}`);
    }
  };

  // Fallback is exactly the four shipped values, in order.
  ok(FALLBACK_CORE_VALUES.length === 4, "fallback has 4 values");
  ok(FALLBACK_CORE_VALUES[0].title === "Customer Commitment", "value 1 title");
  ok(FALLBACK_CORE_VALUES[3].summary === "Operating with Honesty and Integrity", "value 4 summary");
  ok(FALLBACK_CORE_VALUES.map((v) => v.number).join(",") === "01,02,03,04", "fallback numbers 01..04");

  // ordinalLabel pads to two digits then stops.
  ok(ordinalLabel(1) === "01" && ordinalLabel(9) === "09" && ordinalLabel(10) === "10", "ordinalLabel");

  // slug + key generation.
  ok(slugForValue("Customer Commitment") === "customer-commitment", "slug from title");
  ok(slugForValue("").startsWith("value-"), "slug fallback for blank title");

  // normalize drops empties, caps, and de-dupes keys.
  const normd = normalizeCoreValues([
    { title: "A", summary: "a" },
    { title: "", summary: "" },
    { key: "A".toLowerCase(), title: "A", summary: "again" },
  ]);
  ok(normd.length === 2, "normalize drops the empty row");
  ok(normd[0].key !== normd[1].key, "normalize de-dupes keys");
  ok(normd[0].number === "01" && normd[1].number === "02", "normalize auto-numbers");

  const capped = normalizeCoreValues(
    Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, summary: "s" })),
  );
  ok(capped.length === MAX_CORE_VALUES, "normalize caps at MAX_CORE_VALUES");

  // renumber + move.
  const three: CoreValue[] = [
    { key: "a", number: "07", title: "A", summary: "" },
    { key: "b", number: "08", title: "B", summary: "" },
    { key: "c", number: "09", title: "C", summary: "" },
  ];
  ok(renumberValues(three).map((v) => v.number).join(",") === "01,02,03", "renumber resets ordinals");
  ok(moveValue(three, 2, "up").map((v) => v.key).join(",") === "a,c,b", "move up swaps");
  ok(moveValue(three, 0, "up").map((v) => v.key).join(",") === "a,b,c", "move up at top is a no-op");
  ok(moveValue(three, 2, "down").map((v) => v.key).join(",") === "a,b,c", "move down at bottom is a no-op");

  // serialize round-trips through normalize.
  const ser = serializeCoreValues(FALLBACK_CORE_VALUES);
  const back = normalizeCoreValues(JSON.parse(ser));
  ok(back.length === 4 && back[2].title === "Community", "serialize/parse round-trips");

  return { passed, failed };
}
