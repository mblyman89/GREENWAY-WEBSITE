/**
 * src/lib/catalog/lookup-history-core.ts  (R37 S6)  PURE - no I/O.
 *
 * Owner (R37 #6): "enhance the search all products using Google Gemini
 * feature so that it is aware of past searches for the products in the
 * invoice. If the invoice has products on it that past searches have been
 * run on it, I want to know which products and what was found ... before
 * running the search again. Maybe it's been a few months since we received
 * products from that brand, maybe the vendor added new info online ... it may
 * be worth rerunning the search to find new facts. ... make it more obvious
 * it's there and what it is meant to do. It should be run every time for the
 * first while until all facts have been harvested. ... smart and connected and
 * informative."
 *
 * WHAT THIS DECIDES (every input is read by lookup-history-server.ts)
 *   - A product's past searches: batch items (lookup_job_items, 0242) and row
 *     lookups (audit catalog_draft.ai_lookup), of THIS row, of another row of
 *     this delivery, or of the SAME product on an earlier delivery (joined by
 *     the S03 identity key - the same key fact memory uses).
 *   - What those searches found: product_fact_provenance rows with source
 *     'gemini' (0235, append-only, kept by the factory reset).
 *   - What is still missing: only facts a web search CAN fill
 *     (HARVEST_FIELDS). Potency is lab-only, category is decided on the
 *     approve form and images are never attached from the web
 *     (attach-plan-core SKIP), so counting them would make "harvested"
 *     unreachable and the advice would nag forever.
 *
 * THE RECOMMENDATION (product completeness, the Akeneo PIM model: a product
 * is complete when every required attribute has a value; and a re-enrichment
 * cadence, the B2B data-enrichment baseline of re-checking every ~90 days)
 *   harvested  every harvestable fact is on file          -> nothing to do
 *   never      never searched                             -> SEARCH
 *   failed     the last search failed                     -> SEARCH
 *   stale      last search > STALE_DAYS ago, facts missing -> SEARCH AGAIN
 *   productive last search found facts, facts still missing -> SEARCH AGAIN
 *              (each run is still harvesting; run until it stops)
 *   saturated  last search recent and found nothing new    -> WAIT until
 *              it is stale (searching again tomorrow would pay for the same
 *              empty answer)
 *   unknown    the row's facts could not be counted        -> no advice
 *
 * Never guesses: an incomplete history read is said on screen, and a
 * product whose facts are unknown gets no recommendation either way.
 */

export const STALE_DAYS = 90;
const DAY_MS = 86_400_000;

/** Facts a web search can actually fill on an onboarding row (fact-chips ROW_FACT_FIELDS minus lab / form / image). */
export const HARVEST_FIELDS = ["strain_type", "description", "short_description", "effects", "aroma", "flavor", "terpenes"] as const;
export type HarvestField = (typeof HARVEST_FIELDS)[number];

const FIELD_LABEL: Readonly<Record<string, string>> = Object.freeze({
  strain_type: "strain type",
  description: "description",
  short_description: "short line",
  effects: "effects",
  aroma: "aroma",
  flavor: "flavor",
  terpenes: "terpenes",
  summary: "strain summary",
  lineage: "lineage",
  size: "size",
  images: "images",
  category: "category",
  cannabinoids: "potency ratio",
});

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field.replace(/_/g, " ");
}

export type SearchOutcome = "found" | "review" | "known" | "not_found" | "nothing_new" | "failed";
export type SearchWhere = "this row" | "this delivery" | "earlier delivery";

export interface PastSearch {
  /** ISO time the search finished. */
  at: string;
  kind: "batch" | "row";
  where: SearchWhere;
  outcome: SearchOutcome;
  /** Facts attached / queued for review by that search (batch only; 0 for row lookups). */
  attached: number;
  queued: number;
}

export interface FoundFact {
  field: string;
  /** ISO time the fact was recorded. */
  at: string;
}

export interface ProductHistoryInput {
  draftId: string;
  name: string;
  searches: readonly PastSearch[];
  found: readonly FoundFact[];
  /** Harvestable fields still missing, or null when the row's facts were not counted. */
  missing: readonly string[] | null;
}

export type HarvestStatus = "harvested" | "never" | "failed" | "stale" | "productive" | "saturated" | "unknown";

export interface ProductHistory {
  draftId: string;
  name: string;
  status: HarvestStatus;
  /** True when this product is worth a (re)search now. */
  recommend: boolean;
  searchCount: number;
  lastAt: string | null;
  lastOutcome: SearchOutcome | null;
  lastWhere: SearchWhere | null;
  /** Distinct field labels the web has found for this product, newest first. */
  foundFields: string[];
  lastFoundAt: string | null;
  missing: string[] | null;
  /** When a saturated product becomes worth searching again (ISO), else null. */
  retryAfter: string | null;
  /** The plain line shown under the product. */
  line: string;
}

/** Keep only well-formed, real timestamps. */
function ms(iso: unknown): number | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** "Mar 12, 2026" in the shop's time zone (deterministic for tests). */
export function shortDate(iso: string | null): string {
  const t = ms(iso);
  if (t === null) return "an unknown date";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
}

/** "today", "yesterday", "12 days ago" (never negative). */
export function agoText(iso: string | null, now: Date): string {
  const t = ms(iso);
  if (t === null) return "";
  const days = Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const OUTCOME_TEXT: Readonly<Record<SearchOutcome, string>> = Object.freeze({
  found: "found facts",
  review: "found facts for review",
  known: "everything was already on file (no search paid)",
  not_found: "nothing found on the web",
  nothing_new: "nothing new",
  failed: "the search failed",
});

/** Did that search produce anything (counts the row lookups' 'found' too)? */
export function searchYielded(s: Pick<PastSearch, "outcome" | "attached" | "queued">): boolean {
  if (s.outcome === "failed" || s.outcome === "not_found" || s.outcome === "nothing_new" || s.outcome === "known") return false;
  return true;
}

export function buildProductHistory(input: ProductHistoryInput, now: Date, staleDays: number = STALE_DAYS): ProductHistory {
  const searches = input.searches.filter((s) => ms(s.at) !== null).slice().sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0));
  const found = input.found.filter((f) => ms(f.at) !== null && typeof f.field === "string" && f.field).slice().sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0));
  const foundFields: string[] = [];
  for (const f of found) {
    const l = fieldLabel(f.field);
    if (!foundFields.includes(l)) foundFields.push(l);
  }
  const last = searches[0] ?? null;
  const missing = input.missing === null ? null : HARVEST_FIELDS.filter((f) => input.missing!.includes(f)).map((f) => fieldLabel(f));
  const lastMs = last ? (ms(last.at) as number) : null;
  const stale = lastMs !== null && now.getTime() - lastMs > staleDays * DAY_MS;

  let status: HarvestStatus;
  if (missing !== null && missing.length === 0) status = "harvested";
  else if (!last) status = "never";
  else if (missing === null) status = "unknown";
  else if (last.outcome === "failed") status = "failed";
  else if (stale) status = "stale";
  else if (searchYielded(last)) status = "productive";
  else status = "saturated";
  const recommend = status === "never" || status === "failed" || status === "stale" || status === "productive";
  const retryAfter = status === "saturated" && lastMs !== null ? new Date(lastMs + staleDays * DAY_MS).toISOString() : null;

  const parts: string[] = [];
  if (!last) parts.push("Never searched on the web");
  else {
    const where = last.where === "this row" ? "" : last.where === "this delivery" ? " (another row of this delivery)" : " (same product, earlier delivery)";
    parts.push(`Searched ${searches.length === 1 ? "once" : `${searches.length} times`} \u00b7 last ${shortDate(last.at)} (${agoText(last.at, now)})${where}: ${OUTCOME_TEXT[last.outcome]}`);
  }
  if (foundFields.length > 0) parts.push(`the web has given: ${foundFields.join(", ")}`);
  if (missing === null) parts.push("facts not counted");
  else if (missing.length === 0) parts.push("every web fact is on file");
  else parts.push(`still missing: ${missing.join(", ")}`);
  if (status === "saturated" && retryAfter) parts.push(`worth another try after ${shortDate(retryAfter)}`);
  if (status === "stale") parts.push(`over ${staleDays} days old - the vendor may have posted more since`);

  return {
    draftId: input.draftId,
    name: input.name,
    status,
    recommend,
    searchCount: searches.length,
    lastAt: last?.at ?? null,
    lastOutcome: last?.outcome ?? null,
    lastWhere: last?.where ?? null,
    foundFields,
    lastFoundAt: found[0]?.at ?? null,
    missing,
    retryAfter,
    line: parts.join(" \u00b7 "),
  };
}

export type HarvestTone = "go" | "wait" | "done" | "unknown";

export interface DeliveryHarvest {
  products: ProductHistory[];
  total: number;
  counts: Record<HarvestStatus, number>;
  searchedBefore: number;
  recommendCount: number;
  /** Products worth searching AGAIN that an earlier batch of this delivery already did (the plain press skips them). */
  againIds: string[];
  tone: HarvestTone;
  headline: string;
  detail: string;
  /** Earliest date a saturated product becomes worth searching again. */
  nextRetry: string | null;
}

/**
 * The delivery verdict. `doneInThisDelivery` = draft ids a batch of THIS
 * delivery already finished (the plain press skips those, so "search again"
 * is offered for the ones still worth it).
 */
export function summarizeDeliveryHarvest(
  inputs: readonly ProductHistoryInput[],
  now: Date,
  opts: { doneInThisDelivery?: ReadonlySet<string>; complete?: boolean; staleDays?: number } = {},
): DeliveryHarvest {
  const staleDays = opts.staleDays ?? STALE_DAYS;
  const seen = new Set<string>();
  const products: ProductHistory[] = [];
  for (const i of inputs) {
    const k = i.draftId.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    products.push(buildProductHistory(i, now, staleDays));
  }
  const counts: Record<HarvestStatus, number> = { harvested: 0, never: 0, failed: 0, stale: 0, productive: 0, saturated: 0, unknown: 0 };
  for (const p of products) counts[p.status] += 1;
  const done = new Set([...(opts.doneInThisDelivery ?? new Set<string>())].map((x) => x.toLowerCase()));
  const againIds = products.filter((p) => p.recommend && done.has(p.draftId.toLowerCase())).map((p) => p.draftId);
  const recommendCount = products.filter((p) => p.recommend).length;
  const searchedBefore = products.filter((p) => p.searchCount > 0).length;
  const retries = products.map((p) => p.retryAfter).filter((x): x is string => x !== null).sort();
  const nextRetry = retries[0] ?? null;
  const total = products.length;
  const incomplete = opts.complete === false ? " Part of the search history could not be read just now, so some earlier searches may be missing from this list." : "";

  let tone: HarvestTone;
  let headline: string;
  const why: string[] = [];
  if (counts.never > 0) why.push(`${plural(counts.never, "product has", "products have")} never been searched`);
  if (counts.productive > 0) why.push(`${plural(counts.productive, "product is", "products are")} still turning up new facts`);
  if (counts.stale > 0) why.push(`${plural(counts.stale, "product was", "products were")} last searched over ${staleDays} days ago`);
  if (counts.failed > 0) why.push(`${plural(counts.failed, "search", "searches")} failed last time`);
  if (total === 0) {
    tone = "unknown";
    headline = "No products to check on this page.";
  } else if (recommendCount > 0) {
    tone = "go";
    headline = `Recommended: run the search - ${why.join("; ")}.`;
  } else if (counts.harvested === total) {
    tone = "done";
    headline = "Every product here has every fact a web search can find. Nothing left to harvest.";
  } else if (counts.saturated > 0) {
    tone = "wait";
    headline = `Not worth paying for again yet: the last search found nothing new for ${plural(counts.saturated, "product", "products")} still missing facts.${nextRetry ? ` Try again after ${shortDate(nextRetry)}, or fill them by hand.` : ""}`;
  } else {
    tone = "unknown";
    headline = "The facts on these rows could not be counted, so there is no recommendation either way.";
  }
  const detail =
    `${searchedBefore} of ${total} searched before` +
    ` \u00b7 ${counts.harvested} fully harvested \u00b7 ${recommendCount} worth searching now` +
    (againIds.length > 0 ? ` (${againIds.length} already searched once on this delivery - use Search again)` : "") +
    "." +
    incomplete;
  return { products, total, counts, searchedBefore, recommendCount, againIds, tone, headline, detail, nextRetry };
}

/** The bar's title: names Google Gemini only when the configured model IS Gemini. */
export function searchEngineLabel(model: string | null | undefined): string {
  const m = (model ?? "").trim();
  if (/^gemini/i.test(m)) return "Google Gemini with Google Search";
  return m ? `AI web search (${m})` : "AI web search";
}

export function harvestBarTitle(model: string | null | undefined): string {
  return `Search the web for every product on this delivery - ${searchEngineLabel(model)}`;
}

export const HARVEST_BAR_PURPOSE =
  "Finds the facts the menu and Leafly need - description, short line, effects, aroma, flavor, terpenes and strain type - from the brand's own pages and trusted sites, with a source for each one. Run it on every new delivery until every product is harvested; facts already on file are reused for free, so a repeat run only pays for what is still missing.";

export function searchAgainLabel(n: number): string {
  return n === 1 ? "Search again: 1 product still missing facts" : `Search again: ${n} products still missing facts`;
}

/** The short chip under a row's facts count: "\u{1F50E} never searched" / "\u{1F50E} searched 12 days ago \u00b7 worth again". */
export function rowSearchChip(p: Pick<ProductHistory, "status" | "lastAt" | "recommend" | "retryAfter">, now: Date): string {
  if (p.status === "harvested") return p.lastAt ? `\u{1F50E} searched ${agoText(p.lastAt, now)} \u00b7 all harvested` : "\u{1F50E} all harvested";
  if (!p.lastAt) return "\u{1F50E} never searched";
  const when = `\u{1F50E} searched ${agoText(p.lastAt, now)}`;
  if (p.status === "unknown") return when;
  if (p.recommend) return `${when} \u00b7 worth searching again`;
  return p.retryAfter ? `${when} \u00b7 again after ${shortDate(p.retryAfter)}` : when;
}

/** Closed set the action accepts back from the form (uuid-shaped, de-duplicated, capped). */
export function parseAgainIds(raw: readonly unknown[], cap = 200): string[] {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!re.test(t) || out.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/** Map a stored lookup_job_items row to a PastSearch outcome (defensive). */
export function outcomeFromItem(status: unknown, resultOutcome: unknown): SearchOutcome | null {
  if (status === "failed") return "failed";
  if (status !== "done") return null;
  switch (resultOutcome) {
    case "attached":
      return "found";
    case "review":
      return "review";
    case "known":
      return "known";
    case "not_found":
      return "not_found";
    case "nothing_new":
      return "nothing_new";
    default:
      return null;
  }
}

/** Map a catalog_draft.ai_lookup audit row (after_json) to an outcome. */
export function outcomeFromAudit(after: unknown): SearchOutcome | null {
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const a = after as Record<string, unknown>;
  const mem = a.memory && typeof a.memory === "object" ? (a.memory as Record<string, unknown>) : null;
  if (mem && mem.skippedGemini === true) return "known";
  if (a.found === true) return "found";
  if (a.found === false) return "not_found";
  return null;
}

// --- Assembly (the server reads rows; this joins them, pure) ---------------------

/** Marker written into a queued lookup_job_items.result_json by "Search again": the worker forces a fresh web search for it. */
export const AGAIN_MARKER = Object.freeze({ again: true });

/** Was this queued item created by "Search again"? (a finished item's result never carries it) */
export function isAgainMarker(raw: unknown): boolean {
  return Boolean(raw) && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).again === true && !("outcome" in (raw as Record<string, unknown>));
}

export interface HistoryTarget {
  draftId: string;
  /** Every identity key the product may be stamped under (blank ignored). */
  keys: readonly string[];
}
export interface SiblingRow {
  id: string;
  identity_key: string | null;
  manifest_id: string | null;
}
export interface ItemRow {
  draft_id: string;
  status: unknown;
  result_json: unknown;
  finished_at: string | null;
}
export interface AuditRow {
  entity_id: string | null;
  after_json: unknown;
  created_at: string | null;
}
export interface ProvenanceRow {
  identity_key: string | null;
  field: string | null;
  created_at: string | null;
}

const lc = (x: string) => x.trim().toLowerCase();

/**
 * Joins every past search to the products on this page:
 *   - the row itself ("this row"),
 *   - another row of THIS delivery with the same identity ("this delivery"),
 *   - the same identity on an earlier delivery ("earlier delivery").
 * Found facts are the gemini provenance rows under any of the product's keys.
 */
export function assembleLookupHistory(input: {
  manifestId: string | null;
  targets: readonly HistoryTarget[];
  siblings: readonly SiblingRow[];
  items: readonly ItemRow[];
  audits: readonly AuditRow[];
  provenance: readonly ProvenanceRow[];
}): Map<string, { searches: PastSearch[]; found: FoundFact[] }> {
  const out = new Map<string, { searches: PastSearch[]; found: FoundFact[] }>();
  const targetIds = new Set<string>();
  const byKey = new Map<string, string[]>();
  for (const t of input.targets) {
    if (typeof t.draftId !== "string" || !t.draftId.trim()) continue;
    const id = lc(t.draftId);
    if (out.has(id)) continue;
    out.set(id, { searches: [], found: [] });
    targetIds.add(id);
    for (const k of t.keys) {
      if (typeof k !== "string" || !k.trim()) continue;
      const list = byKey.get(k.trim()) ?? [];
      if (!list.includes(id)) list.push(id);
      byKey.set(k.trim(), list);
    }
  }
  const manifest = input.manifestId ? lc(input.manifestId) : null;
  // draft id -> [(target, where)]
  const route = new Map<string, { target: string; where: SearchWhere }[]>();
  for (const id of targetIds) route.set(id, [{ target: id, where: "this row" }]);
  for (const s of input.siblings) {
    if (typeof s.id !== "string" || !s.id.trim()) continue;
    const sid = lc(s.id);
    if (targetIds.has(sid)) continue;
    const key = typeof s.identity_key === "string" ? s.identity_key.trim() : "";
    const targets = key ? byKey.get(key) ?? [] : [];
    if (targets.length === 0) continue;
    const where: SearchWhere = manifest !== null && typeof s.manifest_id === "string" && lc(s.manifest_id) === manifest ? "this delivery" : "earlier delivery";
    const list = route.get(sid) ?? [];
    for (const t of targets) if (!list.some((r) => r.target === t)) list.push({ target: t, where });
    route.set(sid, list);
  }
  for (const it of input.items) {
    if (typeof it.draft_id !== "string") continue;
    const outcome = outcomeFromItem(it.status, it.result_json && typeof it.result_json === "object" ? (it.result_json as Record<string, unknown>).outcome : null);
    if (outcome === null || ms(it.finished_at) === null) continue;
    const r = it.result_json && typeof it.result_json === "object" ? (it.result_json as Record<string, unknown>) : {};
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    for (const dest of route.get(lc(it.draft_id)) ?? []) {
      out.get(dest.target)!.searches.push({ at: it.finished_at as string, kind: "batch", where: dest.where, outcome, attached: n(r.attached), queued: n(r.queued) });
    }
  }
  for (const a of input.audits) {
    if (typeof a.entity_id !== "string") continue;
    const outcome = outcomeFromAudit(a.after_json);
    if (outcome === null || ms(a.created_at) === null) continue;
    for (const dest of route.get(lc(a.entity_id)) ?? []) {
      out.get(dest.target)!.searches.push({ at: a.created_at as string, kind: "row", where: dest.where, outcome, attached: 0, queued: 0 });
    }
  }
  for (const p of input.provenance) {
    const key = typeof p.identity_key === "string" ? p.identity_key.trim() : "";
    if (!key || typeof p.field !== "string" || !p.field || ms(p.created_at) === null) continue;
    for (const t of byKey.get(key) ?? []) {
      const bucket = out.get(t)!;
      if (!bucket.found.some((f) => f.field === p.field && f.at === p.created_at)) bucket.found.push({ field: p.field, at: p.created_at as string });
    }
  }
  return out;
}

// --- Self-tests -------------------------------------------------------------------

export function __runLookupHistoryCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("lookup-history-core FAIL:", name);
    }
  };
  const now = new Date("2026-06-01T19:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * DAY_MS).toISOString();
  const s = (d: number, outcome: SearchOutcome, where: SearchWhere = "this row", attached = 0, queued = 0): PastSearch => ({ at: daysAgo(d), kind: "batch", where, outcome, attached, queued });

  // statuses
  const never = buildProductHistory({ draftId: "a", name: "A", searches: [], found: [], missing: ["effects"] }, now);
  ok("never", never.status === "never" && never.recommend && never.line.startsWith("Never searched"));
  const harvested = buildProductHistory({ draftId: "b", name: "B", searches: [], found: [], missing: [] }, now);
  ok("harvested beats never", harvested.status === "harvested" && !harvested.recommend && harvested.line.includes("every web fact is on file"));
  ok("non-harvest fields ignored", buildProductHistory({ draftId: "b", name: "B", searches: [], found: [], missing: ["potency", "images", "category"] }, now).status === "harvested");
  const failedP = buildProductHistory({ draftId: "c", name: "C", searches: [s(2, "failed")], found: [], missing: ["aroma"] }, now);
  ok("failed", failedP.status === "failed" && failedP.recommend);
  const stale = buildProductHistory({ draftId: "d", name: "D", searches: [s(120, "not_found")], found: [], missing: ["aroma"] }, now);
  ok("stale", stale.status === "stale" && stale.recommend && stale.line.includes("over 90 days old"));
  ok("90 days exactly is not stale", buildProductHistory({ draftId: "d", name: "D", searches: [s(90, "not_found")], found: [], missing: ["aroma"] }, now).status === "saturated");
  ok("91 days stale", buildProductHistory({ draftId: "d", name: "D", searches: [s(91, "not_found")], found: [], missing: ["aroma"] }, now).status === "stale");
  const productive = buildProductHistory({ draftId: "e", name: "E", searches: [s(3, "found", "this row", 2)], found: [{ field: "effects", at: daysAgo(3) }], missing: ["aroma"] }, now);
  ok("productive", productive.status === "productive" && productive.recommend);
  const sat = buildProductHistory({ draftId: "f", name: "F", searches: [s(10, "nothing_new"), s(40, "found", "earlier delivery", 3)], found: [{ field: "description", at: daysAgo(40) }], missing: ["terpenes"] }, now);
  ok("saturated uses NEWEST search", sat.status === "saturated" && !sat.recommend);
  ok("saturated retryAfter = last + 90d", sat.retryAfter === new Date(now.getTime() - 10 * DAY_MS + 90 * DAY_MS).toISOString());
  ok("saturated line says when", sat.line.includes("worth another try after"));
  ok("known is not a yield", buildProductHistory({ draftId: "g", name: "G", searches: [s(1, "known")], found: [], missing: ["aroma"] }, now).status === "saturated");
  ok("review is a yield", buildProductHistory({ draftId: "g", name: "G", searches: [s(1, "review", "this row", 0, 2)], found: [], missing: ["aroma"] }, now).status === "productive");
  ok("unknown facts -> no advice", buildProductHistory({ draftId: "h", name: "H", searches: [s(1, "found")], found: [], missing: null }, now).status === "unknown");
  ok("unknown never searched -> still never", buildProductHistory({ draftId: "h", name: "H", searches: [], found: [], missing: null }, now).status === "never");

  // line content
  ok("count + date + where", sat.line.startsWith("Searched 2 times \u00b7 last ") && sat.line.includes("(10 days ago)") && sat.line.includes("nothing new"));
  ok("earlier delivery named", buildProductHistory({ draftId: "i", name: "I", searches: [s(5, "found", "earlier delivery")], found: [], missing: ["aroma"] }, now).line.includes("(same product, earlier delivery)"));
  ok("another row named", buildProductHistory({ draftId: "i", name: "I", searches: [s(5, "found", "this delivery")], found: [], missing: ["aroma"] }, now).line.includes("(another row of this delivery)"));
  ok("once", productive.line.startsWith("Searched once"));
  const ff = buildProductHistory({ draftId: "j", name: "J", searches: [s(1, "found")], found: [{ field: "aroma", at: daysAgo(1) }, { field: "effects", at: daysAgo(30) }, { field: "aroma", at: daysAgo(30) }, { field: "short_description", at: daysAgo(2) }], missing: ["flavor"] }, now);
  ok("found fields distinct newest first", ff.foundFields.join("|") === "aroma|short line|effects");
  ok("lastFoundAt newest", ff.lastFoundAt === daysAgo(1));
  ok("missing labels", ff.line.includes("still missing: flavor"));
  ok("bad timestamps dropped", buildProductHistory({ draftId: "k", name: "K", searches: [{ ...s(1, "found"), at: "nope" }], found: [{ field: "aroma", at: "" }], missing: ["aroma"] }, now).status === "never");
  ok("shortDate PT", shortDate("2026-06-01T03:00:00Z") === "May 31, 2026");
  ok("shortDate bad", shortDate(null) === "an unknown date");
  ok("ago today/yesterday", agoText(daysAgo(0), now) === "today" && agoText(daysAgo(1), now) === "yesterday");
  ok("ago future clamps", agoText(new Date(now.getTime() + 5 * DAY_MS).toISOString(), now) === "today");

  // delivery verdict
  const mk = (id: string, searches: PastSearch[], missing: string[] | null): ProductHistoryInput => ({ draftId: id, name: id, searches, found: [], missing });
  const go = summarizeDeliveryHarvest([mk("p1", [], ["aroma"]), mk("p2", [s(3, "found", "this row", 1)], ["flavor"]), mk("p3", [], [])], now, { doneInThisDelivery: new Set(["P2"]) });
  ok("go tone", go.tone === "go" && go.headline.startsWith("Recommended: run the search"));
  ok("go reasons", go.headline.includes("1 product has never been searched") && go.headline.includes("1 product is still turning up new facts"));
  ok("againIds = recommended AND already done here (case-insensitive)", go.againIds.join() === "p2");
  ok("counts", go.counts.never === 1 && go.counts.productive === 1 && go.counts.harvested === 1 && go.recommendCount === 2 && go.searchedBefore === 1);
  ok("detail mentions search again", go.detail.includes("use Search again"));
  const done = summarizeDeliveryHarvest([mk("p1", [s(1, "found")], []), mk("p2", [], [])], now);
  ok("done tone", done.tone === "done" && done.recommendCount === 0);
  const wait = summarizeDeliveryHarvest([mk("p1", [s(5, "not_found")], ["aroma"]), mk("p2", [s(20, "nothing_new")], ["flavor"]), mk("p3", [], [])], now);
  ok("wait tone", wait.tone === "wait" && wait.headline.includes("2 products still missing facts"));
  ok("wait next retry = earliest", wait.nextRetry === new Date(now.getTime() - 20 * DAY_MS + 90 * DAY_MS).toISOString());
  ok("unknown tone", summarizeDeliveryHarvest([mk("p1", [s(1, "found")], null)], now).tone === "unknown");
  ok("empty", summarizeDeliveryHarvest([], now).tone === "unknown");
  ok("dedupe by draft id", summarizeDeliveryHarvest([mk("p1", [], ["aroma"]), mk("P1", [], ["aroma"])], now).total === 1);
  ok("incomplete read said", summarizeDeliveryHarvest([mk("p1", [], ["aroma"])], now, { complete: false }).detail.includes("could not be read"));
  ok("stale + failed reasons", (() => {
    const v = summarizeDeliveryHarvest([mk("p1", [s(200, "found")], ["aroma"]), mk("p2", [s(1, "failed")], ["aroma"])], now);
    return v.headline.includes("last searched over 90 days ago") && v.headline.includes("1 search failed last time");
  })());
  ok("detail counts", go.detail.startsWith("1 of 3 searched before \u00b7 1 fully harvested \u00b7 2 worth searching now"));

  // assembly
  {
    const T1 = "11111111-1111-4111-8111-111111111111";
    const T2 = "22222222-2222-4222-8222-222222222222";
    const SIB = "33333333-3333-4333-8333-333333333333";
    const OLD = "44444444-4444-4444-8444-444444444444";
    const M = "99999999-9999-4999-8999-999999999999";
    const h = assembleLookupHistory({
      manifestId: M,
      targets: [{ draftId: T1, keys: ["v|flower|gelato", "raw|gelato"] }, { draftId: T2, keys: ["v|vape|other"] }, { draftId: T1.toUpperCase(), keys: ["x"] }],
      siblings: [
        { id: SIB, identity_key: "v|flower|gelato", manifest_id: M.toUpperCase() },
        { id: OLD, identity_key: "raw|gelato", manifest_id: "88888888-8888-4888-8888-888888888888" },
        { id: T2, identity_key: "v|flower|gelato", manifest_id: M },
        { id: "55555555-5555-4555-8555-555555555555", identity_key: "nobody", manifest_id: null },
      ],
      items: [
        { draft_id: T1, status: "done", result_json: { outcome: "attached", attached: 3, queued: 1 }, finished_at: daysAgo(2) },
        { draft_id: OLD, status: "done", result_json: { outcome: "nothing_new" }, finished_at: daysAgo(100) },
        { draft_id: SIB, status: "failed", result_json: null, finished_at: daysAgo(1) },
        { draft_id: T1, status: "canceled", result_json: null, finished_at: daysAgo(1) },
        { draft_id: T1, status: "done", result_json: { outcome: "attached" }, finished_at: null },
        { draft_id: T2, status: "queued", result_json: AGAIN_MARKER, finished_at: null },
      ],
      audits: [
        { entity_id: OLD.toUpperCase(), after_json: { found: true }, created_at: daysAgo(101) },
        { entity_id: T2, after_json: { found: false }, created_at: daysAgo(5) },
        { entity_id: T2, after_json: { nope: 1 }, created_at: daysAgo(5) },
      ],
      provenance: [
        { identity_key: "raw|gelato", field: "effects", created_at: daysAgo(100) },
        { identity_key: "raw|gelato", field: "effects", created_at: daysAgo(100) },
        { identity_key: "v|vape|other", field: "aroma", created_at: daysAgo(5) },
        { identity_key: "elsewhere", field: "aroma", created_at: daysAgo(5) },
        { identity_key: "raw|gelato", field: "flavor", created_at: "bad" },
      ],
    });
    const a = h.get(T1.toLowerCase())!;
    const b = h.get(T2.toLowerCase())!;
    ok("assembly targets deduped", h.size === 2);
    ok("assembly T1 searches", a.searches.length === 4);
    ok("assembly own row", a.searches.some((x) => x.where === "this row" && x.kind === "batch" && x.attached === 3 && x.queued === 1 && x.outcome === "found"));
    ok("assembly sibling this delivery (case-insensitive manifest)", a.searches.some((x) => x.where === "this delivery" && x.outcome === "failed"));
    ok("assembly earlier delivery batch + row", a.searches.filter((x) => x.where === "earlier delivery").map((x) => x.kind).sort().join() === "batch,row");
    ok("assembly a target is never its own sibling", !b.searches.some((x) => x.where !== "this row"));
    ok("assembly T2 row audit only", b.searches.length === 1 && b.searches[0].kind === "row" && b.searches[0].outcome === "not_found");
    ok("assembly found dedup + bad time dropped", a.found.length === 1 && a.found[0].field === "effects");
    ok("assembly found by key", b.found.length === 1 && b.found[0].field === "aroma");
    ok("again marker", isAgainMarker(AGAIN_MARKER) && !isAgainMarker({ again: true, outcome: "attached" }) && !isAgainMarker(null) && !isAgainMarker([]) && !isAgainMarker({ again: "yes" }));
  }
  ok("chip never", rowSearchChip({ status: "never", lastAt: null, recommend: true, retryAfter: null }, now) === "\u{1F50E} never searched");
  ok("chip harvested", rowSearchChip(harvested, now) === "\u{1F50E} all harvested" && rowSearchChip({ ...harvested, lastAt: daysAgo(3) }, now).endsWith("searched 3 days ago \u00b7 all harvested"));
  ok("chip productive", rowSearchChip(productive, now).endsWith("searched 3 days ago \u00b7 worth searching again"));
  ok("chip saturated", rowSearchChip(sat, now).includes("\u00b7 again after "));
  ok("chip unknown", rowSearchChip({ status: "unknown", lastAt: daysAgo(1), recommend: false, retryAfter: null }, now) === "\u{1F50E} searched yesterday");
  // labels + parsing
  ok("gemini label", harvestBarTitle("gemini-2.5-pro").endsWith("Google Gemini with Google Search"));
  ok("non-gemini label never claims gemini", searchEngineLabel("gpt-4o") === "AI web search (gpt-4o)" && searchEngineLabel(null) === "AI web search");
  ok("again label", searchAgainLabel(1).includes("1 product still") && searchAgainLabel(3).includes("3 products still"));
  const U = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  ok("parseAgainIds", parseAgainIds([U, U.toUpperCase(), "x", 5, ` ${U} `]).length === 1);
  ok("parseAgainIds cap", parseAgainIds(Array.from({ length: 5 }, (_, i) => `aaaaaaaa-1111-4111-8111-${String(i).padStart(12, "0")}`), 3).length === 3);
  ok("outcomeFromItem", outcomeFromItem("done", "attached") === "found" && outcomeFromItem("failed", null) === "failed" && outcomeFromItem("canceled", "attached") === null && outcomeFromItem("done", "weird") === null);
  ok("outcomeFromAudit", outcomeFromAudit({ found: true }) === "found" && outcomeFromAudit({ found: false }) === "not_found" && outcomeFromAudit({ found: true, memory: { skippedGemini: true } }) === "known" && outcomeFromAudit(null) === null && outcomeFromAudit({}) === null);
  ok("fieldLabel fallback", fieldLabel("brand_description") === "brand description" && fieldLabel("short_description") === "short line");
  ok("purpose names the facts", HARVEST_BAR_PURPOSE.includes("terpenes") && HARVEST_BAR_PURPOSE.includes("until every product is harvested"));
  return { passed, failed };
}
