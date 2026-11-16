/**
 * src/lib/enrichment/copilot-search-core.ts  (D244 R-24)
 *
 * The Copilot's photo search, the pure half. Owner, round 11: "sometimes, the
 * recommendations miss the vendors other brands. so, in addition to the main
 * section of recommendations and the every other image from this vendor, I
 * need a search bar that is very smart, lets me enter any text and the system
 * does its best to show me something based on that text. these images need to
 * be included in the text removal feature."
 *
 * "Does its best" means several searches at once, fused:
 *   - the whole text (words + meaning, the library's hybrid search),
 *   - each word on its own (the library search needs EVERY word to match),
 *   - joined / split forms ("pre-roll" -> "pre roll", "preroll"),
 *   - every photo of a vendor or brand whose name is typed, even with a typo
 *     (that is how another brand of the same vendor is found).
 * Then each photo is scored here: how many of the typed words it carries (a
 * prefix or one-letter typo counts), plus the fused rank, plus a lift for a
 * typed vendor / brand and this card's vendor. Nothing here reads the
 * database; copilot-search-server.ts does.
 */
import type { LibraryPickerAsset } from "@/lib/media/library-picker-core";

/** Longest search text kept. */
export const COPILOT_SEARCH_MAX_CHARS = 120;
/** Most photos shown for one search. */
export const COPILOT_SEARCH_LIMIT = 60;
/** Most extra one-word / variant searches run for one search. */
export const COPILOT_SEARCH_MAX_PLANS = 8;
/** Most typed vendors / brands whose whole shelf is pulled in. */
export const COPILOT_SEARCH_MAX_NAMED = 4;

const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "with", "by", "in", "on", "to", "from", "at", "is", "it", "my", "me", "show", "find", "photo", "photos", "picture", "pictures", "image", "images", "pic", "pics"]);

/** The typed text, cleaned (control characters out, spaces collapsed, capped). */
export function cleanCopilotQuery(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return s
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, COPILOT_SEARCH_MAX_CHARS)
    .trim();
}

/** Lower-case letters / digits only, one space between. */
export function normText(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The words that carry meaning (2+ characters, filler words out, no repeats). */
export function queryWords(q: string): string[] {
  const out: string[] = [];
  for (const w of normText(q).split(" ")) {
    if (w.length < 2 || STOP.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * The extra searches to run besides the whole text: each word, the words
 * joined ("blue dream" -> "bluedream"), hyphen / slash pieces apart and
 * together. The whole text is not repeated here. Capped.
 */
export function copilotSearchPlans(q: string): string[] {
  const clean = cleanCopilotQuery(q);
  const whole = normText(clean);
  const words = queryWords(clean);
  const plans: string[] = [];
  const add = (p: string) => {
    const v = p.trim();
    if (v.length >= 2 && v !== whole && !plans.includes(v)) plans.push(v);
  };
  if (words.length > 1) for (const w of words) add(w);
  if (words.length >= 2 && words.length <= 3) add(words.join(""));
  for (const piece of clean.toLowerCase().split(/\s+/)) {
    if (!/[-/_.]/.test(piece)) continue;
    const parts = piece.split(/[-/_.]+/).map((x) => normText(x)).filter(Boolean);
    if (parts.length > 1) {
      add(parts.join(" "));
      add(parts.join(""));
    }
  }
  if (words.length === 1 && whole !== words[0]) add(words[0]!);
  return plans.slice(0, COPILOT_SEARCH_MAX_PLANS);
}

/** Edit distance, stopping early past `max` (returns max + 1). */
export function editDistanceWithin(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Does a typed word match a word on the photo (same, prefix, or one-letter typo on 5+ letters)? */
export function wordHits(typed: string, hay: readonly string[]): boolean {
  for (const h of hay) {
    if (h === typed) return true;
    if (typed.length >= 3 && h.startsWith(typed)) return true;
    if (typed.length >= 5 && h.length >= 4 && editDistanceWithin(typed, h, 1) <= 1) return true;
  }
  return false;
}

export type NamedEntry = { id: string; name: string };
export type NamedMatch = { id: string; name: string; strength: number };

/**
 * The vendors / brands whose name is in the typed text. Strength 3 = the whole
 * name appears, 2 = joined spelling ("greenrevolution") or the text is the
 * start of the name, 1 = a long word one letter off. Best first, capped.
 */
export function matchNamed(q: string, entries: readonly NamedEntry[], limit = COPILOT_SEARCH_MAX_NAMED): NamedMatch[] {
  const text = normText(q);
  if (text.length < 2) return [];
  const padded = ` ${text} `;
  const compact = text.replace(/ /g, "");
  const words = queryWords(q);
  const out = new Map<string, NamedMatch>();
  for (const e of entries) {
    const id = (e.id ?? "").trim();
    const name = normText(e.name);
    if (!id || name.length < 2) continue;
    const nameCompact = name.replace(/ /g, "");
    let strength = 0;
    if (padded.includes(` ${name} `)) strength = 3;
    else if (nameCompact.length >= 4 && compact.includes(nameCompact)) strength = 2;
    else if (text.length >= 3 && name.startsWith(text)) strength = 2;
    else {
      const nameWords = name.split(" ").filter((w) => w.length >= 5);
      if (nameWords.length && words.some((w) => w.length >= 5 && nameWords.some((n) => editDistanceWithin(w, n, 1) <= 1))) strength = 1;
    }
    if (strength === 0) continue;
    const prev = out.get(id);
    if (!prev || prev.strength < strength) out.set(id, { id, name: e.name, strength });
  }
  return [...out.values()].sort((a, b) => b.strength - a.strength || a.name.localeCompare(b.name)).slice(0, limit);
}

/** The words a photo carries (names, label text, caption, tags, file name, vendor / brand names). */
export function assetWords(a: LibraryPickerAsset, labels: { vendor?: string | null; brand?: string | null } = {}): string[] {
  const parts = [a.product_name, a.title, a.visible_text, a.ai_caption, a.alt_text, a.filename, a.pack_size, ...(a.tags ?? []), labels.vendor, labels.brand];
  return [...new Set(parts.map((p) => normText(p)).join(" ").split(" ").filter(Boolean))];
}

export type CopilotSearchPhoto = {
  id: string;
  url: string | null;
  label: string;
  chips: string[];
  textRemoved: boolean;
  /** 0-100, for ordering and the corner badge. */
  score: number;
};

export type CopilotSearchInput = {
  query: string;
  /** Every photo found by any of the searches, by id. */
  assets: ReadonlyMap<string, LibraryPickerAsset>;
  /** The ranked id lists: [whole-text hybrid, each plan..., each named shelf...]. */
  lists: readonly (readonly string[])[];
  /** Ids that came only from the meaning (embedding) search. */
  meaningIds?: ReadonlySet<string>;
  /** Typed vendor / brand matches, and which ids came from each shelf. */
  named?: readonly { kind: "vendor" | "brand"; match: NamedMatch; ids: ReadonlySet<string> }[];
  /** This card's vendor (a small lift). */
  cardVendorId?: string | null;
  /** Already on this card: left out. */
  excludeIds?: ReadonlySet<string>;
  vendorLabels?: ReadonlyMap<string, string>;
  brandLabels?: ReadonlyMap<string, string>;
  isTextRemoved?: (a: LibraryPickerAsset) => boolean;
  limit?: number;
};

const RRF_K = 60;

/** Fuse, score, explain and order the photos for one search. Pure. */
export function rankCopilotSearch(input: CopilotSearchInput): CopilotSearchPhoto[] {
  const words = queryWords(input.query);
  const fused = new Map<string, number>();
  for (const list of input.lists) {
    const seen = new Set<string>();
    let rank = 0;
    for (const raw of list) {
      const id = String(raw ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rank += 1;
      fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));
    }
  }
  const maxFused = Math.max(0, ...fused.values());
  const card = (input.cardVendorId ?? "").trim().toLowerCase();
  const scored: (CopilotSearchPhoto & { raw: number; order: number })[] = [];
  let order = 0;
  for (const [id, f] of fused) {
    order += 1;
    if (input.excludeIds?.has(id)) continue;
    const a = input.assets.get(id);
    if (!a || a.status === "archived") continue;
    const vendorLabel = a.vendor_id ? input.vendorLabels?.get(a.vendor_id.toLowerCase()) ?? input.vendorLabels?.get(a.vendor_id) ?? null : null;
    const brandLabel = a.brand_id ? input.brandLabels?.get(a.brand_id.toLowerCase()) ?? input.brandLabels?.get(a.brand_id) ?? null : null;
    const hay = assetWords(a, { vendor: vendorLabel, brand: brandLabel });
    const hit = words.filter((w) => wordHits(w, hay)).length;
    const coverage = words.length ? hit / words.length : 0;
    const chips: string[] = [];
    let raw = (maxFused > 0 ? f / maxFused : 0) * 0.6 + coverage;
    for (const n of input.named ?? []) {
      if (!n.ids.has(id)) continue;
      raw += 0.15 * n.match.strength;
      const c = `${n.kind === "brand" ? "Brand" : "Vendor"}: ${n.match.name}`;
      if (!chips.includes(c)) chips.push(c);
    }
    if (words.length && hit === words.length) chips.unshift(words.length > 1 ? "All words" : "Word match");
    else if (hit > 0) chips.unshift(`${hit} of ${words.length} words`);
    else if (input.meaningIds?.has(id)) chips.unshift("Matches by meaning");
    if (card && (a.vendor_id ?? "").toLowerCase() === card) {
      raw += 0.1;
      chips.push("This vendor");
    } else if (brandLabel && !chips.some((c) => c.startsWith("Brand:"))) {
      chips.push(`Brand: ${brandLabel}`);
    }
    const textRemoved = Boolean(input.isTextRemoved?.(a));
    if (textRemoved) chips.push("Text removed");
    const label = (a.product_name || a.title || a.filename || "(untitled image)").slice(0, 120);
    scored.push({ id, url: a.url, label, chips: chips.slice(0, 4), textRemoved, score: 0, raw, order });
  }
  scored.sort((x, y) => y.raw - x.raw || x.order - y.order);
  const top = Math.max(0.0001, scored[0]?.raw ?? 1);
  return scored.slice(0, Math.max(1, input.limit ?? COPILOT_SEARCH_LIMIT)).map((p) => ({ id: p.id, url: p.url, label: p.label, chips: p.chips, textRemoved: p.textRemoved, score: Math.max(1, Math.min(100, Math.round((p.raw / top) * 100))) }));
}

/** The plain line under the search box. */
export function copilotSearchSummary(q: string, shown: number, named: readonly { kind: "vendor" | "brand"; match: NamedMatch }[]): string {
  if (!q) return "";
  if (cleanCopilotQuery(q).length < 2) return "Type at least two letters.";
  const also = named.length ? ` Includes every photo of ${named.map((n) => `${n.kind} ${n.match.name}`).join(", ")}.` : "";
  if (shown === 0) return `Nothing in the library matches “${q}”. Try fewer words, a brand or vendor name, the strain, or words printed on the package.`;
  return `${shown} photo${shown === 1 ? "" : "s"} for “${q}”, best first.${also}`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCopilotSearchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`copilot-search-core FAIL: ${label}`);
    }
  };
  ok(cleanCopilotQuery("  blue\u0000  dream\n ") === "blue dream", "clean: control chars and spaces");
  ok(cleanCopilotQuery("x".repeat(500)).length === COPILOT_SEARCH_MAX_CHARS, "clean: capped");
  ok(cleanCopilotQuery(42) === "", "clean: non-string");
  ok(JSON.stringify(queryWords("Show me the Blue Dream photos 1g")) === JSON.stringify(["blue", "dream", "1g"]), "words: filler out");
  const plans = copilotSearchPlans("Blue Dream");
  ok(plans.includes("blue") && plans.includes("dream") && plans.includes("bluedream") && !plans.includes("blue dream"), "plans: each word + joined, not the whole");
  const hy = copilotSearchPlans("og pre-roll");
  ok(hy.includes("pre roll") && hy.includes("preroll"), "plans: hyphen apart and together");
  ok(copilotSearchPlans("a b c d e f g h i j k l").length <= COPILOT_SEARCH_MAX_PLANS, "plans: capped");
  ok(copilotSearchPlans("gelato").length === 0, "plans: one plain word adds nothing");
  ok(editDistanceWithin("gelato", "gelatto", 1) === 1 && editDistanceWithin("gelato", "zkittl", 1) === 2, "edit distance");
  ok(wordHits("gela", ["gelato"]) && wordHits("gelatto", ["gelato"]) && !wordHits("ge", ["gelato"]), "word hits: prefix, typo, too short");
  const named = matchNamed("phat panda pre roll", [
    { id: "v1", name: "Phat Panda" },
    { id: "v2", name: "Grow Op Farms" },
  ]);
  ok(named.length === 1 && named[0]!.id === "v1" && named[0]!.strength === 3, "named: whole name in text");
  ok(matchNamed("phatpanda", [{ id: "v1", name: "Phat Panda" }])[0]?.strength === 2, "named: joined spelling");
  ok(matchNamed("Sitka", [{ id: "b1", name: "Sitka Sungrown" }])[0]?.strength === 2, "named: start of a name");
  ok(matchNamed("revolutin", [{ id: "b2", name: "Green Revolution" }])[0]?.strength === 1, "named: one-letter typo on a long word");
  ok(matchNamed("x", [{ id: "v1", name: "X" }]).length === 0, "named: one letter is nothing");
  const A = (id: string, extra: Partial<LibraryPickerAsset> = {}): LibraryPickerAsset => ({
    id, filename: null, title: null, alt_text: null, tags: [], usage_type: "product", status: "published", mime_type: "image/jpeg", license_status: null, created_at: null, url: `u/${id}`, ...extra,
  });
  const assets = new Map<string, LibraryPickerAsset>([
    ["p1", A("p1", { product_name: "Blue Dream 1g Pre-Roll", vendor_id: "v1", brand_id: "b9" })],
    ["p2", A("p2", { product_name: "Dream Queen" })],
    ["p3", A("p3", { product_name: "Mystery", ai_caption: "a jar" })],
    ["p4", A("p4", { product_name: "Blue Dream", status: "archived" })],
    ["p5", A("p5", { product_name: "Blue Dream cart", tags: ["text-removed"] })],
    ["p6", A("p6", { product_name: "Other brand shot", brand_id: "b9" })],
  ]);
  const ranked = rankCopilotSearch({
    query: "blue dream",
    assets,
    lists: [["p2", "p1", "p3", "p4"], ["p1", "p5"], ["p6"]],
    meaningIds: new Set(["p3"]),
    named: [{ kind: "brand", match: { id: "b9", name: "Panda Brand", strength: 3 }, ids: new Set(["p6", "p1"]) }],
    cardVendorId: "V1",
    excludeIds: new Set(["p5"]),
    brandLabels: new Map([["b9", "Panda Brand"]]),
    isTextRemoved: (a) => (a.tags ?? []).includes("text-removed"),
  });
  ok(ranked[0]?.id === "p1" && ranked[0].score === 100, "rank: all words + brand + this vendor first");
  ok(ranked[0]!.chips[0] === "All words" && ranked[0]!.chips.includes("This vendor") && ranked[0]!.chips.includes("Brand: Panda Brand"), "rank: why chips");
  ok(!ranked.some((r) => r.id === "p4"), "rank: archived left out");
  ok(!ranked.some((r) => r.id === "p5"), "rank: already on the card left out");
  ok(ranked.find((r) => r.id === "p3")?.chips[0] === "Matches by meaning", "rank: meaning-only hit says so");
  ok(ranked.find((r) => r.id === "p2")?.chips[0] === "1 of 2 words", "rank: partial words counted");
  ok(ranked.some((r) => r.id === "p6"), "rank: another brand's photo from the typed brand shows");
  const tr = rankCopilotSearch({ query: "blue dream", assets, lists: [["p5"]], isTextRemoved: (a) => (a.tags ?? []).includes("text-removed") });
  ok(tr[0]?.textRemoved === true && tr[0].chips.includes("Text removed"), "rank: text-removed flagged");
  ok(rankCopilotSearch({ query: "x", assets, lists: [["p1", "p2", "p3"]], limit: 2 }).length === 2, "rank: limit");
  ok(copilotSearchSummary("", 0, []) === "", "summary: empty");
  ok(copilotSearchSummary("b", 0, []).startsWith("Type at least"), "summary: too short");
  ok(copilotSearchSummary("zz top", 0, []).startsWith("Nothing in the library"), "summary: nothing found");
  ok(copilotSearchSummary("phat panda", 3, [{ kind: "vendor", match: { id: "v1", name: "Phat Panda", strength: 3 } }]).includes("every photo of vendor Phat Panda"), "summary: named shelf");
  return { passed, failed };
}
