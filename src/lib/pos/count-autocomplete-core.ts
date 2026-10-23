/**
 * src/lib/pos/count-autocomplete-core.ts — R74 S26 (round 12).
 *
 * Owner (round 12, verbatim excerpt): "A few of the laptops that we will use
 * for the count are Mac's, and they do not have the setting for disabling
 * autocomplete for cells. Can you add this feature in programmatically?"
 *
 * WHAT IS VERIFIED (sources in the roadmap S26 section; nothing assumed):
 *   - AutoComplete is an Excel APPLICATION setting (VBA
 *     Application.EnableAutoComplete). There is no .xlsx workbook setting we
 *     could write that turns it off, so this module does not pretend to.
 *   - Excel for Mac does have it: Excel menu > Preferences > AutoComplete
 *     (under Formulas and Lists) > "Enable AutoComplete for cell values"
 *     (Microsoft Support, "Enter a series of numbers, dates, or other items",
 *     Applies to Excel 2024 for Mac / 2021 for Mac).
 *   - It completes only when the typed characters match ONE entry (BetterSolutions:
 *     "only displayed after enough characters have been entered in order to
 *     determine which value matches") in the SAME column, in the cells directly
 *     above, and "stops trying to match entries when a blank cell is reached"
 *     (tips.net, Allen Wyatt; BetterSolutions "current region").
 *
 * THE DEFENCE (works whether or not the setting is off, on any computer):
 *   A scan of barcode P can only be silently changed into a longer barcode V
 *   when P is the start of V (case-insensitive) and V is the only entry above
 *   (back to the nearest blank row) that starts with P. So:
 *     1. prefixBarcodes() lists the barcodes that are the start of another
 *        barcode (on the measured Cultivera list: "1" and "RoyalBlunt"); the
 *        workbook tells counters to leave a blank row before scanning one, and
 *        a blank row stops AutoComplete.
 *     2. autocompleteRisks() re-plays those rules over the uploaded column and
 *        flags every cell whose value could have been a completed P. Both P and
 *        V are then left exactly as Cultivera said (never guessed) and listed.
 *
 * PURE: no I/O.
 */

export type AutocompleteHit = {
  /** 1-based spreadsheet row. */
  row: number;
  /** the value in the cell (as stored). */
  value: string;
  /** the shorter barcode(s) that, typed here, Excel would have completed to `value`. */
  couldBe: string[];
};

/**
 * Barcodes (as given) that are the start of a different, longer barcode in the
 * same list, case-insensitively. Sorted, distinct (case-insensitively).
 */
export function prefixBarcodes(codes: Iterable<string>): { prefix: string; longer: string[] }[] {
  const byLower = new Map<string, string>();
  for (const raw of codes) {
    const c = String(raw ?? "").trim();
    if (!c) continue;
    const k = c.toLowerCase();
    if (!byLower.has(k)) byLower.set(k, c);
  }
  const sorted = [...byLower.keys()].sort();
  const out: { prefix: string; longer: string[] }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const longer: string[] = [];
    // sorted lexicographically: every string that starts with p follows it contiguously.
    for (let j = i + 1; j < sorted.length && sorted[j].startsWith(p); j++) longer.push(byLower.get(sorted[j])!);
    if (longer.length) out.push({ prefix: byLower.get(p)!, longer });
  }
  return out;
}

/**
 * Re-play Excel's AutoComplete rules over one column, top to bottom.
 *
 * @param column     cell values in row order (already trimmed/normalized); "" = blank.
 * @param candidates the shorter barcodes that could have been typed (the caller
 *                   decides which, see scanSheetCandidates / handSheetCandidates).
 * @param firstRow   the 1-based spreadsheet row of column[0].
 *
 * A cell is flagged when its value V appeared earlier in the same block (no
 * blank row in between) and, for some candidate P that is a strict prefix of
 * V, V is the ONLY entry in that block longer than P that starts with P.
 * Entries equal to P are ignored when judging "only" (the stricter reading: it
 * can only flag more, never fewer).
 */
export function autocompleteRisks(column: readonly string[], candidates: Iterable<string>, firstRow: number): AutocompleteHit[] {
  const original = new Map<string, string>();
  for (const c of candidates) {
    const v = String(c ?? "").trim();
    if (v && !original.has(v.toLowerCase())) original.set(v.toLowerCase(), v);
  }
  const hits: AutocompleteHit[] = [];
  if (original.size === 0) return hits;
  let seen = new Set<string>();
  let byPrefix = new Map<string, Set<string>>();
  column.forEach((raw, i) => {
    const v = String(raw ?? "").trim();
    if (!v) {
      // a blank row ends the block AutoComplete looks at.
      seen = new Set();
      byPrefix = new Map();
      return;
    }
    const vl = v.toLowerCase();
    if (seen.has(vl)) {
      const couldBe: string[] = [];
      for (let n = 1; n < vl.length; n++) {
        const p = vl.slice(0, n);
        if (!original.has(p)) continue;
        const above = byPrefix.get(p);
        if (above && above.size === 1 && above.has(vl)) couldBe.push(original.get(p)!);
      }
      if (couldBe.length) hits.push({ row: firstRow + i, value: v, couldBe });
    }
    seen.add(vl);
    for (let n = 1; n < vl.length; n++) {
      const p = vl.slice(0, n);
      if (!original.has(p)) continue;
      let set = byPrefix.get(p);
      if (!set) byPrefix.set(p, (set = new Set()));
      set.add(vl);
    }
  });
  return hits;
}

/**
 * Scan sheet candidates. The workbook tells counters to count a prefix barcode
 * from the product list on the Hand Count sheet, not to scan it, so it is a
 * candidate here only when this workbook shows it WAS scanned (it appears on
 * the Scan sheet as itself). A prefix nobody counted at all is caught by
 * uncountedPrefixRisks instead. Any scanned value that is the start of another
 * scanned value is a candidate too (a barcode that is not on the list).
 * Returns the candidates and the listed prefixes found scanned.
 */
export function scanSheetCandidates(column: readonly string[], listedPrefixes: Iterable<string>): { candidates: string[]; scannedPrefixes: string[] } {
  const values = new Map<string, string>();
  for (const raw of column) {
    const v = String(raw ?? "").trim();
    if (v && !values.has(v.toLowerCase())) values.set(v.toLowerCase(), v);
  }
  const scannedPrefixes: string[] = [];
  const cand = new Map<string, string>();
  for (const p of listedPrefixes) {
    const k = String(p ?? "").trim().toLowerCase();
    if (k && values.has(k) && !cand.has(k)) {
      cand.set(k, values.get(k)!);
      scannedPrefixes.push(values.get(k)!);
    }
  }
  for (const { prefix } of prefixBarcodes(values.values())) if (!cand.has(prefix.toLowerCase())) cand.set(prefix.toLowerCase(), prefix);
  return { candidates: [...cand.values()], scannedPrefixes };
}

/**
 * The case the column cannot show: a counter scans prefix barcode P, Excel
 * completes it to a longer V, and P never appears anywhere. So a prefix
 * barcode from the product list that NOBODY counted (no scan, no Hand Count
 * row, not even 0) while some longer barcode starting with it WAS counted
 * leaves P and those longer barcodes unknowable: they are all left alone.
 * The fix is one Hand Count row for P (its quantity, 0 if none) and a re-upload.
 *
 * @param lotCodes    every product-list barcode (the imported lots).
 * @param countedKeys lower-cased barcodes counted at least once (any workbook, 0 counts).
 */
export function uncountedPrefixRisks(lotCodes: Iterable<string>, countedKeys: ReadonlySet<string>): { prefix: string; longer: string[] }[] {
  const out: { prefix: string; longer: string[] }[] = [];
  for (const { prefix, longer } of prefixBarcodes(lotCodes)) {
    if (countedKeys.has(prefix.toLowerCase())) continue;
    const counted = longer.filter((v) => countedKeys.has(v.toLowerCase()));
    if (counted.length) out.push({ prefix, longer: counted });
  }
  return out;
}

/** Every barcode a hit touches (lower-cased): the stored value and each shorter one it could be. */
export function riskyBarcodeKeys(hits: readonly AutocompleteHit[]): Set<string> {
  const out = new Set<string>();
  for (const h of hits) {
    out.add(h.value.toLowerCase());
    for (const p of h.couldBe) out.add(p.toLowerCase());
  }
  return out;
}

export function __runCountAutocompleteCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL count-autocomplete-core: " + m);
    }
  };

  // prefixBarcodes — the measured Cultivera shape.
  const pb = prefixBarcodes(["RoyalBluntWrap", "RoyalBlunt", "1", "100270836", "11007548756737634", "WA1.X", "", "royalblunt"]);
  ok(pb.length === 2, "two prefix barcodes");
  ok(pb[0].prefix === "1" && pb[0].longer.length === 2, "'1' is the start of two");
  ok(pb[1].prefix === "RoyalBlunt" && pb[1].longer[0] === "RoyalBluntWrap", "RoyalBlunt -> RoyalBluntWrap, original case kept");
  ok(prefixBarcodes(["A1", "B2", "C3"]).length === 0, "no prefixes, no list");
  ok(prefixBarcodes(["ab", "AB"]).length === 0, "case duplicates are not a prefix of each other");

  const P = ["RoyalBlunt", "WA1"];
  // V repeated directly under itself, P a candidate -> flagged on the 2nd.
  let h = autocompleteRisks(["RoyalBluntWrap", "RoyalBluntWrap"], P, 2);
  ok(h.length === 1 && h[0].row === 3 && h[0].couldBe[0] === "RoyalBlunt", "second V could be a completed P");
  ok(h[0].value === "RoyalBluntWrap", "value as stored");
  ok(autocompleteRisks(["RoyalBluntWrap"], P, 2).length === 0, "first occurrence not flagged");
  ok(autocompleteRisks(["RoyalBluntWrap", "", "RoyalBluntWrap"], P, 2).length === 0, "blank row stops AutoComplete");
  ok(autocompleteRisks(["RoyalBluntWrap", "RoyalBlunt", "RoyalBlunt"], P, 2).length === 0, "a stored P is never flagged");
  ok(autocompleteRisks(["WA1.AAA", "WA1.BBB", "WA1.AAA"], P, 2).length === 0, "two candidates above: not unique, no completion");
  h = autocompleteRisks(["WA1.AAA", "WA1.BBB", "", "WA1.AAA", "WA1.AAA"], P, 2);
  ok(h.length === 1 && h[0].row === 6 && h[0].couldBe.join() === "WA1", "fresh block: unique again, row is 1-based offset");
  h = autocompleteRisks(["ROYALBLUNTWRAP", "royalbluntwrap"], P, 2);
  ok(h.length === 1 && h[0].couldBe[0] === "RoyalBlunt", "case-insensitive");
  ok(autocompleteRisks(["1111111111111111", "1111111111111111"], [], 2).length === 0, "no candidates, nothing flagged");
  h = autocompleteRisks(["1234", "1234"], ["1", "12"], 2);
  ok(h.length === 1 && h[0].couldBe.join() === "1,12", "every shorter barcode listed");
  const keys = riskyBarcodeKeys(h);
  ok(keys.has("1234") && keys.has("1") && keys.has("12") && keys.size === 3, "risky keys = value + every couldBe, lower-cased");
  h = autocompleteRisks(["RoyalBlunt", "RoyalBluntWrap", "RoyalBluntWrap"], P, 2);
  ok(h.length === 1 && h[0].row === 4, "an exact P above does not make it ambiguous (stricter)");

  // scanSheetCandidates: a listed prefix counts only when it was scanned.
  let sc = scanSheetCandidates(["100270836", "100270836"], ["1", "RoyalBlunt"]);
  ok(sc.candidates.length === 0 && sc.scannedPrefixes.length === 0, "the '1' item not scanned: repeats of 1xxxx are not flagged");
  ok(autocompleteRisks(["100270836", "100270836"], sc.candidates, 2).length === 0, "so a normal repeat count is clean");
  sc = scanSheetCandidates(["100270836", "1", "100270836", "100270836"], ["1", "RoyalBlunt"]);
  ok(sc.scannedPrefixes.join() === "1" && sc.candidates.join() === "1", "'1' scanned: it becomes a candidate and is reported");
  ok(autocompleteRisks(["100270836", "1", "100270836", "100270836"], sc.candidates, 2).length === 2, "then the repeats after it are flagged");
  sc = scanSheetCandidates(["ZZ", "", "ZZ9", "ZZ9"], []);
  ok(sc.candidates.join() === "ZZ" && sc.scannedPrefixes.length === 0, "an unlisted scanned short code is a candidate");

  // uncountedPrefixRisks
  const lotCodes = ["1", "100270836", "11007548756737634", "RoyalBlunt", "RoyalBluntWrap", "WA9"];
  let u = uncountedPrefixRisks(lotCodes, new Set(["100270836", "royalbluntwrap"]));
  ok(u.length === 2 && u[0].prefix === "1" && u[0].longer.join() === "100270836", "'1' not counted, a 1-barcode counted: risk, only the counted longer listed");
  ok(u[1].prefix === "RoyalBlunt" && u[1].longer.join() === "RoyalBluntWrap", "RoyalBlunt not counted");
  u = uncountedPrefixRisks(lotCodes, new Set(["1", "100270836", "royalblunt", "royalbluntwrap"]));
  ok(u.length === 0, "prefix counted (even 0 on Hand Count): no risk");
  ok(uncountedPrefixRisks(lotCodes, new Set(["wa9"])).length === 0, "no longer barcode counted: nothing at risk");
  return { passed, failed };
}
