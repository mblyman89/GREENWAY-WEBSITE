/**
 * ───────────────────────────────────────────────────────────────────────────
 * SLICE 14 — the typeahead brain behind every facet filter.
 *
 * THE PROBLEM THIS SOLVES
 * ---------------------------------------------------------------------------
 * Slice 13 shipped twelve facets, ten tri-state flags, five numeric ranges and
 * two date ranges, ALL RENDERED AT ONCE. Every facet was an always-open box
 * with its own scrollbar. The power was real and the owner's verdict was also
 * real: "great, but very overwhelming." An employee who is overwhelmed does
 * not use the tool, and an unused tool is worth nothing.
 *
 * The fix is not to remove power. It is to CONTAIN it: each facet collapses to
 * a single closed control, and opening one reveals a search box over the same
 * list. Type to narrow, click to add, and what you picked becomes a removable
 * pill. That is the "multi-select combobox with token pills" the owner
 * described, and it is the pattern the W3C names `combobox` with
 * `aria-autocomplete="list"` (W3C ARIA Authoring Practices Guide, Combobox
 * Pattern) and that enterprise UX research names for exactly this job:
 * "Provide a search mechanism for dropdown menus with a large number of
 * values" and "additive lozenges … are a great way to convey that meaning"
 * (Pencil & Paper, "Filter UX Design Patterns", 2026-03-16).
 *
 * WHY THIS FILE IS PURE
 * ---------------------------------------------------------------------------
 * Rule 5: the logic lives in a `*-core.ts` with `__run…Tests()` and no React,
 * no DOM, no imports from the component tree. Everything below is a function
 * from data to data, so the matching rules can be proven at the command line
 * and cannot rot behind a UI that "looks fine".
 *
 * WHAT IS DELIBERATELY *NOT* HERE
 * ---------------------------------------------------------------------------
 * No fuzzy/typo matching. `inventory-search-core` already does typo-tolerant
 * scoring for the big free-text box, and that is right for "find me this
 * product". It is WRONG here: inside a 400-vendor list, a fuzzy match returns
 * plausible-looking vendors the employee did not mean, and a filter that
 * silently includes the wrong vendor is worse than no filter. Narrowing a
 * known list is a substring problem, not a guessing problem.
 * ───────────────────────────────────────────────────────────────────────────
 */

/** One selectable value in a facet, with how many rows carry it. */
export type TypeaheadOption = {
  readonly value: string;
  readonly label: string;
  readonly count: number;
};

/**
 * An option decorated with WHERE the query matched, so the UI can highlight
 * the matched run instead of making the eye re-find it. `start`/`end` are
 * indices into `label`; `start` is -1 when there is no query.
 */
export type MatchedOption = TypeaheadOption & {
  readonly start: number;
  readonly end: number;
};

/**
 * Fold a string for comparison: lowercase, collapse internal whitespace, trim.
 *
 * Case-insensitive because nobody types "GreenWay Farms" with the shift key in
 * the right places. Whitespace-collapsing because vendor names arriving from
 * CCRS and from manual entry differ by stray double-spaces, and a filter that
 * misses a vendor over an invisible character is a filter that lies.
 */
export function foldForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Where `query` first appears inside `label`, as [start, end) indices into the
 * ORIGINAL label, or [-1, -1] for no match.
 *
 * THE INDEX-MAPPING HAZARD, HANDLED
 * ---------------------------------------------------------------------------
 * Folding can CHANGE LENGTH ("A  B" is 4 characters, folded "a b" is 3), so an
 * index found in folded space does not necessarily point at the same character
 * in the original. Highlighting the wrong characters is the visible symptom of
 * a real bug, so instead of folding the whole label and hoping, this walks the
 * original label and builds an index map as it folds. The returned indices
 * always address the original string.
 */
export function matchRange(label: string, query: string): { start: number; end: number } {
  const q = foldForMatch(query);
  if (!q) return { start: -1, end: -1 };

  // Fold the label while recording, for each folded character, which original
  // index it came from. This is what keeps highlight offsets honest.
  let folded = "";
  const origIndex: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < label.length; i += 1) {
    const ch = label[i]!;
    if (/\s/.test(ch)) {
      // Collapse any run of whitespace to a single space, and only once we
      // know a non-space follows (that is what makes it a *trim* as well).
      if (folded.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      folded += " ";
      origIndex.push(i); // the space stands in for the run that preceded it
      pendingSpace = false;
    }
    folded += ch.toLowerCase();
    origIndex.push(i);
  }

  const at = folded.indexOf(q);
  if (at < 0) return { start: -1, end: -1 };

  const start = origIndex[at]!;
  const lastFolded = at + q.length - 1;
  const end = origIndex[lastFolded]! + 1;
  return { start, end };
}

/** Does this option match the query at all? */
export function optionMatches(option: TypeaheadOption, query: string): boolean {
  if (!foldForMatch(query)) return true;
  return matchRange(option.label, query).start >= 0;
}

/**
 * Narrow and rank a facet's options for the given query.
 *
 * RANKING, AND WHY IT IS NOT JUST "COUNT DESCENDING"
 * ---------------------------------------------------------------------------
 * With no query, busiest-first is right: it puts the inventory where it
 * actually is at the top. But once someone types, relevance beats volume. If
 * an employee types "green", a vendor literally NAMED "Green Acres" must
 * outrank "Evergreen Supply" even when Evergreen has ten times the lots,
 * because the typed word is a statement of intent. So matches are ordered:
 *
 *   1. prefix matches before mid-string matches   (start === 0 wins)
 *   2. then by count descending                   (busiest of the equals)
 *   3. then alphabetically                        (stable, predictable)
 *
 * SELECTED OPTIONS ARE NEVER HIDDEN
 * ---------------------------------------------------------------------------
 * An option that is already selected is always returned, even when it does not
 * match the query. Hiding a selected value would let someone type, see it
 * vanish, and conclude they had removed it — while it silently kept filtering
 * the table. Selected values sort first so they are visible and removable at
 * all times.
 */
export function narrowOptions(
  options: readonly TypeaheadOption[],
  query: string,
  selected: readonly string[] = [],
): MatchedOption[] {
  const sel = new Set(selected);
  const q = foldForMatch(query);

  const out: MatchedOption[] = [];
  for (const opt of options) {
    const isSelected = sel.has(opt.value);
    const r = q ? matchRange(opt.label, query) : { start: -1, end: -1 };
    if (q && r.start < 0 && !isSelected) continue; // filtered out
    out.push({ ...opt, start: r.start, end: r.end });
  }

  return out.sort((a, b) => {
    const aSel = sel.has(a.value) ? 0 : 1;
    const bSel = sel.has(b.value) ? 0 : 1;
    if (aSel !== bSel) return aSel - bSel;

    if (q) {
      // A non-match (selected, kept for visibility) sorts after real matches.
      const aHit = a.start >= 0 ? 0 : 1;
      const bHit = b.start >= 0 ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;

      const aPrefix = a.start === 0 ? 0 : 1;
      const bPrefix = b.start === 0 ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    }

    return b.count - a.count || a.label.localeCompare(b.label);
  });
}

/**
 * Split a label into three pieces for highlighting: before, match, after.
 * Returns `match: ""` when there is nothing to highlight, so the caller can
 * render one uniform code path instead of branching on whether a query exists.
 */
export function highlightParts(
  label: string,
  start: number,
  end: number,
): { before: string; match: string; after: string } {
  if (start < 0 || end <= start || start > label.length) {
    return { before: label, match: "", after: "" };
  }
  const safeEnd = Math.min(end, label.length);
  return {
    before: label.slice(0, start),
    match: label.slice(start, safeEnd),
    after: label.slice(safeEnd),
  };
}

/**
 * The one-line summary shown on a CLOSED facet control.
 *
 * This is the whole anti-overwhelm mechanism in one function: when a facet is
 * shut, this single line has to say everything the employee needs, or they
 * will open all twelve to find out — which is precisely the state we are
 * escaping. Enterprise UX research calls this out directly: indicate which
 * filters have a selection nested inside, because "it's easy for a user to
 * forget they even selected filters at all."
 *
 * One selection shows the actual value ("Green Acres"), because "1 selected"
 * is a strictly worse thing to say when the real answer fits. Two or more
 * collapse to a count, since concatenating names overflows the control and
 * truncation ("Green Acr…") reads as broken.
 */
export function facetSummary(
  selected: readonly string[],
  labelFor: (value: string) => string,
  emptyText = "Any",
): string {
  if (selected.length === 0) return emptyText;
  if (selected.length === 1) return labelFor(selected[0]!);
  return `${selected.length} selected`;
}

/**
 * Add or remove a value, returning a NEW array (never mutating the input).
 * Toggling is what makes one control serve both "add another" and "undo",
 * which is the interaction the owner asked for: keep typing and picking, and
 * remove by clicking the pill.
 */
export function toggleValue(selected: readonly string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}

/**
 * Clamp a highlighted-row index into range with wrap-around, for Up/Down
 * arrow navigation. Wrapping is what the W3C pattern permits and what people
 * expect: pressing Up on the first row lands on the last.
 *
 * Returns -1 for an empty list — there is no row to be on, and returning 0
 * would point at a row that does not exist.
 */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return length - 1;
  if (index >= length) return 0;
  return index;
}

/**
 * How many of `keys` are actually engaged in the raw query params.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The anti-overwhelm design hides the advanced controls (flags, ranges, dates)
 * behind collapsed sections. That is only safe if a section OPENS ITSELF when
 * it contains something active. Otherwise a filter would be both applied and
 * invisible, the row count would look wrong, and the employee would have no
 * way to see why — the exact failure that makes people distrust a list.
 *
 * Empty strings do not count. A cleared `<select>` submits `""`, and treating
 * that as active would flag every section the moment the form is submitted.
 */
export function countActiveIn(
  raw: Record<string, string | string[] | undefined>,
  keys: readonly string[],
): number {
  let n = 0;
  for (const k of keys) {
    const v = raw[k];
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.some((x) => String(x).trim() !== "")) n += 1;
    } else if (String(v).trim() !== "") {
      n += 1;
    }
  }
  return n;
}

/* ── Self-tests ────────────────────────────────────────────────────────── */

export function __runFacetTypeaheadCoreTests(): void {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL facet-typeahead-core: " + msg);
    passed += 1;
  };

  const opt = (label: string, count: number): TypeaheadOption => ({
    value: label,
    label,
    count,
  });

  // ---- folding
  ok(foldForMatch("  Green   Acres ") === "green acres", "folds case and whitespace");
  ok(foldForMatch("") === "", "empty folds to empty");
  ok(foldForMatch("   ") === "", "whitespace-only folds to empty");

  // ---- matching
  ok(matchRange("Green Acres", "green").start === 0, "prefix match at 0");
  ok(matchRange("Green Acres", "green").end === 5, "prefix match ends at 5");
  ok(matchRange("Evergreen Supply", "green").start === 4, "mid-string match index");
  ok(matchRange("Green Acres", "zzz").start === -1, "no match is -1");
  ok(matchRange("Green Acres", "").start === -1, "empty query does not highlight");
  ok(matchRange("Green Acres", "ACRES").start === 6, "match is case-insensitive");

  // THE INDEX-MAPPING HAZARD: a label with a double space. Folded it is
  // "green acres" (11 chars) but the original is 12. An implementation that
  // searched the folded string and used that index directly would return 6
  // and highlight " Acres" shifted by one. The map must return 7.
  ok(matchRange("Green  Acres", "acres").start === 7, "double space: index maps to ORIGINAL");
  ok(matchRange("Green  Acres", "acres").end === 12, "double space: end maps to ORIGINAL");
  ok(
    "Green  Acres".slice(
      matchRange("Green  Acres", "acres").start,
      matchRange("Green  Acres", "acres").end,
    ) === "Acres",
    "the mapped slice is exactly the matched text, not shifted",
  );
  // Leading whitespace shifts every index; prove it too.
  ok(matchRange("   Green", "green").start === 3, "leading space: index maps to ORIGINAL");
  // A query spanning the collapsed run still lands correctly.
  ok(matchRange("Green  Acres", "green acres").start === 0, "query spans collapsed whitespace");
  ok(matchRange("Green  Acres", "green acres").end === 12, "spanning match ends at true end");

  ok(optionMatches(opt("Green Acres", 5), ""), "empty query matches everything");
  ok(optionMatches(opt("Green Acres", 5), "acre"), "substring matches");
  ok(!optionMatches(opt("Green Acres", 5), "zzz"), "non-substring does not match");

  // ---- narrowing
  const vendors = [
    opt("Evergreen Supply", 100),
    opt("Green Acres", 10),
    opt("Blue Sky", 50),
    opt("Greenest Farm", 10),
  ];

  const all = narrowOptions(vendors, "");
  ok(all.length === 4, "no query keeps every option");
  ok(all[0]!.label === "Evergreen Supply", "no query: busiest first");

  const green = narrowOptions(vendors, "green");
  ok(green.length === 3, "query narrows the list");
  ok(!green.some((o) => o.label === "Blue Sky"), "non-matching option is gone");
  // THE RANKING RULE THAT MATTERS: intent beats volume.
  ok(
    green[0]!.label === "Green Acres",
    "prefix match outranks a bigger mid-string match (typing is intent)",
  );
  ok(green[1]!.label === "Greenest Farm", "second prefix match, ordered by label");
  ok(green[2]!.label === "Evergreen Supply", "mid-string match sinks below prefixes");

  const none = narrowOptions(vendors, "zzzz");
  ok(none.length === 0, "a query matching nothing yields nothing");

  // ---- selected options survive the query (the silent-filter trap)
  const withSel = narrowOptions(vendors, "blue", ["Green Acres"]);
  ok(
    withSel.some((o) => o.label === "Green Acres"),
    "a SELECTED option is never hidden by a query",
  );
  ok(withSel[0]!.label === "Green Acres", "selected sorts first so it stays removable");
  ok(withSel[0]!.start === -1, "the kept selection reports no highlight");
  ok(
    withSel.some((o) => o.label === "Blue Sky"),
    "the actual query match is still present",
  );
  // And a selected option that DOES match must rank as a match, not be duplicated.
  const selMatch = narrowOptions(vendors, "green", ["Green Acres"]);
  ok(selMatch.filter((o) => o.label === "Green Acres").length === 1, "no duplicate rows");
  ok(selMatch[0]!.label === "Green Acres", "selected + matching still leads");

  // ---- highlighting
  const h = highlightParts("Evergreen Supply", 4, 9);
  ok(h.before === "Ever", "highlight: before");
  ok(h.match === "green", "highlight: match");
  ok(h.after === " Supply", "highlight: after");
  const h2 = highlightParts("Green Acres", -1, -1);
  ok(h2.before === "Green Acres" && h2.match === "", "no match renders the whole label");
  // Out-of-range indices must not throw or produce nonsense.
  const h3 = highlightParts("abc", 1, 99);
  ok(h3.before === "a" && h3.match === "bc" && h3.after === "", "end clamps to length");
  const h4 = highlightParts("abc", 9, 12);
  ok(h4.before === "abc" && h4.match === "", "start past end is treated as no match");

  // ---- summary line on a closed control
  const lbl = (v: string) => (v === "__unset__" ? "(not set)" : v);
  ok(facetSummary([], lbl) === "Any", "nothing selected reads as Any");
  ok(facetSummary(["Green Acres"], lbl) === "Green Acres", "one selection shows the value");
  ok(facetSummary(["a", "b"], lbl) === "2 selected", "two or more collapse to a count");
  ok(facetSummary(["a", "b", "c"], lbl) === "3 selected", "three collapse to a count");
  ok(facetSummary([], lbl, "Any vendor") === "Any vendor", "empty text is overridable");
  ok(facetSummary(["__unset__"], lbl) === "(not set)", "labelFor is applied to the value");

  // ---- toggling
  ok(toggleValue([], "a").join() === "a", "toggle adds to empty");
  ok(toggleValue(["a"], "b").join() === "a,b", "toggle appends, preserving order");
  ok(toggleValue(["a", "b"], "a").join() === "b", "toggle removes when present");
  ok(toggleValue(["a"], "a").length === 0, "toggling the only value clears it");
  const frozen = ["a", "b"];
  toggleValue(frozen, "c");
  ok(frozen.length === 2, "toggle NEVER mutates its input");

  // ---- keyboard index clamping
  ok(clampIndex(0, 5) === 0, "index in range is unchanged");
  ok(clampIndex(5, 5) === 0, "past the end wraps to the top");
  ok(clampIndex(-1, 5) === 4, "before the start wraps to the bottom");
  ok(clampIndex(0, 0) === -1, "an empty list has no valid row");
  ok(clampIndex(3, 0) === -1, "empty list stays -1 regardless of input");

  // ---- section activity (drives auto-open of collapsed sections)
  ok(countActiveIn({}, ["a", "b"]) === 0, "nothing set is nothing active");
  ok(countActiveIn({ a: "1" }, ["a", "b"]) === 1, "one set value counts");
  ok(countActiveIn({ a: "1", b: "2" }, ["a", "b"]) === 2, "two set values count");
  // THE CLEARED-SELECT TRAP: a cleared <select> submits "".
  ok(countActiveIn({ a: "" }, ["a"]) === 0, "empty string is NOT active");
  ok(countActiveIn({ a: "   " }, ["a"]) === 0, "whitespace-only is NOT active");
  ok(countActiveIn({ a: undefined }, ["a"]) === 0, "undefined is not active");
  ok(countActiveIn({ a: ["x"] }, ["a"]) === 1, "a non-empty array counts once");
  ok(countActiveIn({ a: ["", ""] }, ["a"]) === 0, "an all-empty array is not active");
  ok(countActiveIn({ a: ["", "x"] }, ["a"]) === 1, "a partly-filled array counts");
  ok(countActiveIn({ z: "1" }, ["a"]) === 0, "unrelated params are ignored");

  console.log(`facet-typeahead-core: ${passed} assertions passed`);
}
