/**
 * src/lib/ai/ai-cost-core.ts - AI-$ (pure core; no I/O).
 *
 * Owner (verbatim): "I need your help enhancing my ai usage page of my back
 * office. I am hoping we can include dollars spent for all the credits I've
 * used. ... Please make the page much more detailed with regard to money
 * spent."
 *
 * Turns each `ai_usage` ledger row into a dollar figure (in CENTS, rule 8)
 * and rolls the rows up for the AI Usage page. Every figure carries HOW it was
 * priced so nothing is presented as more certain than it is (rule 3):
 *
 *   measured   - the vendor told us the cost on that call: FLUX rows note
 *                "credits N" (BFL: 1 credit = $0.01), Gemini Batch lookup rows
 *                note "~$X.XX" (priced by gemini-batch-core from Google's own
 *                usage numbers).
 *   list-price - real or estimated token counts x the vendor's published
 *                price per 1M tokens (table below), or a published flat price
 *                per image.
 *   free       - work done on our own server (unpdf, knowledge-base memory)
 *                or a failed request the vendor does not bill.
 *   unpriced   - a model this table has no published price for. Counted and
 *                shown as a warning; never guessed.
 *
 * Prices (USD per 1M tokens, Standard tier) read 2026-11-28 from:
 *   OpenAI   https://platform.openai.com/docs/pricing
 *   Gemini   https://ai.google.dev/gemini-api/docs/pricing  (Batch = 50% off)
 *   FLUX     https://docs.bfl.ai/pricing  (first megapixel / per image)
 *   LlamaParse https://www.llamaindex.ai/pricing  ($1.50 per 1,000 credits
 *            after 10,000 free a month; the free credits are NOT subtracted,
 *            so LlamaParse is an upper bound)
 * Gemini 4 Carbon/Argon double on 2026-12-01 and Gemini 3.8/3.6 Flash on
 * 2027-01-01; each row is priced at the rate in force on its Pacific day.
 * Not included: Google Search grounding on live calls ($14 / 1,000 after
 * 5,000 free a month) because live rows do not record a search count.
 */
import { pacificDayKey, pacificMonthKey } from "@/lib/reports/timezone";

export const PRICES_READ_ON = "2026-11-28";

export type CostBasis = "measured" | "list-price" | "free" | "unpriced";

/** USD per 1M tokens. `from` = first Pacific day (YYYY-MM-DD) the rate applies. */
type TokenRate = { input: number; output: number; from?: string };

const T = (input: number, output: number, from?: string): TokenRate => ({ input, output, from });

/** Token-priced models. Each list is oldest-first; the last rate whose `from` <= the row's day wins. */
export const TOKEN_PRICES: Record<string, TokenRate[]> = {
  // OpenAI
  "gpt-6.2-astra": [T(8, 40)],
  "gpt-6.2-sol": [T(2, 10)],
  "gpt-6-astra": [T(10, 50)],
  "gpt-6.1-sol": [T(2, 10)],
  "gpt-6.1-terra": [T(1, 5)],
  "gpt-6-luna": [T(0.1, 0.5)],
  "gpt-5": [T(1.25, 10)],
  "gpt-5-mini": [T(0.25, 2)],
  "gpt-5-nano": [T(0.05, 0.4)],
  "gpt-4.1": [T(2, 8)],
  "gpt-4.1-mini": [T(0.4, 1.6)],
  "gpt-4o": [T(2.5, 10)],
  "gpt-4o-mini": [T(0.15, 0.6)],
  "gpt-image-2": [T(5, 30)],
  // Google Gemini
  "gemini-4-carbon": [T(2, 10), T(4, 20, "2026-12-01")],
  "gemini-4-argon": [T(2, 10), T(4, 20, "2026-12-01")],
  "gemini-4-neon": [T(3, 15)],
  "gemini-4-hydrogen": [T(1.5, 7.5)],
  "gemini-3.8-flash": [T(0.75, 3.75), T(1.5, 7.5, "2027-01-01")],
  "gemini-3.7-flash": [T(0.75, 3.75), T(1.5, 7.5, "2027-01-01")], // routed to 3.8 and billed as 3.8
  "gemini-3.6-flash": [T(0.75, 3.75), T(1.5, 7.5, "2027-01-01")],
  "gemini-3.5-flash-lite": [T(0.3, 2.5)],
  "gemini-3.1-flash-lite": [T(0.25, 1.5)],
  "gemini-3.1-pro-preview": [T(2, 12)],
  "gemini-3-flash-preview": [T(0.5, 3)],
  "gemini-embedding-2": [T(0.2, 0)],
};

/** Image embeddings are billed at the image input rate ($0.45 / 1M = $0.00012 per image). */
const EMBED_IMAGE_RATE: TokenRate = T(0.45, 0);

/** Flat USD per call where the ledger has no tokens (first megapixel / 1K image). */
export const FLAT_PRICES: Record<string, number> = {
  "flux-tools/erase-v1": 0.03,
  "flux-tools/deblur-v1": 0.03,
  "flux-pro-1.0-fill": 0.05,
  "flux-pro-1.0-expand": 0.05, // FLUX.1 Fill [pro] covers in- and outpainting
  "flux-kontext-pro": 0.04,
  "flux-kontext-max": 0.08,
  "flux-2-pro": 0.03,
  "flux-2-max": 0.07,
  "flux-2-flex": 0.05,
  "gemini-nano-banana-2.1": 0.0336, // 1K image; larger images cost more
};

/** LlamaParse: $1.50 per 1,000 credits = 0.15 cents per credit. */
export const LLAMAPARSE_CENTS_PER_CREDIT = 0.15;

export type CostRow = {
  id?: string;
  feature: string;
  model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated: boolean;
  ok: boolean;
  error_note: string | null;
  actor_email?: string | null;
  created_at: string;
};

export type RowCost = { cents: number; basis: CostBasis; provider: string; model: string };

/** Strip routing prefixes and case so "models/Gemini-4-Carbon" prices as gemini-4-carbon. */
export function normalizeModel(raw: string | null | undefined): string {
  let m = String(raw ?? "").trim().toLowerCase();
  for (const p of ["models/", "openai/", "google/"]) if (m.startsWith(p)) m = m.slice(p.length);
  return m;
}

export function providerOf(model: string): string {
  if (model.startsWith("gpt-") || /^o\d/.test(model)) return "OpenAI";
  if (model.startsWith("gemini")) return "Google Gemini";
  if (model.startsWith("flux")) return "Black Forest Labs (FLUX)";
  if (model.startsWith("llamaparse")) return "LlamaParse";
  if (model === "" ) return "Unknown";
  return "Our own server";
}

/** Longest known key that the model id equals or starts with ("gpt-4o-mini-2024" -> gpt-4o-mini). */
function lookup<T>(table: Record<string, T>, model: string): T | undefined {
  if (table[model] !== undefined) return table[model];
  let best = "";
  for (const k of Object.keys(table)) if (model.startsWith(k + "-") && k.length > best.length) best = k;
  return best ? table[best] : undefined;
}

function rateOn(rates: TokenRate[], day: string): TokenRate {
  let r = rates[0];
  for (const x of rates) if (!x.from || x.from <= day) r = x;
  return r;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Price one ledger row. PURE. */
export function priceRow(r: CostRow): RowCost {
  const model = normalizeModel(r.model);
  const provider = providerOf(model);
  const note = r.error_note ?? "";
  const out = (cents: number, basis: CostBasis): RowCost => ({ cents: round4(cents), basis, provider, model: model || "(none)" });

  // 1) The vendor's own number wins.
  const credits = /credits\s+([0-9]+(?:\.[0-9]+)?)/i.exec(note);
  if (credits && model.startsWith("flux")) return out(Number(credits[1]), "measured"); // 1 BFL credit = 1 cent
  const usd = /~\$([0-9]+(?:\.[0-9]+)?)/.exec(note);
  if (usd) return out(Number(usd[1]) * 100, "measured");

  // 2) Free work on our own server.
  if (model === "unpdf" || model === "none" || model === "llamaparse" || model.startsWith("already on file")) return out(0, "free");
  // 3) A failed request with no real usage is not billed.
  if (!r.ok && (r.estimated || r.total_tokens === 0) && !model.startsWith("llamaparse-")) return out(0, "free");

  if (model.startsWith("llamaparse-")) return r.ok ? out(Math.max(0, r.total_tokens) * LLAMAPARSE_CENTS_PER_CREDIT, "list-price") : out(0, "free");

  const day = pacificDayKey(r.created_at);
  const rates = lookup(TOKEN_PRICES, model);
  const prompt = Math.max(0, r.prompt_tokens || 0);
  const completion = Math.max(0, r.completion_tokens || 0);
  if (rates && prompt + completion > 0) {
    const rate = r.feature === "media.embed.image" ? EMBED_IMAGE_RATE : rateOn(rates, day);
    const batch = r.feature.endsWith(".batch") ? 0.5 : 1;
    return out(((prompt * rate.input + completion * rate.output) / 1_000_000) * 100 * batch, "list-price");
  }
  const flat = lookup(FLAT_PRICES, model);
  if (flat !== undefined) return out(flat * 100, "list-price");
  return out(0, "unpriced");
}

export type SpendBucket = { key: string; calls: number; tokens: number; cents: number; measuredCents: number };
export type SpendReport = {
  windowDays: number;
  totalCents: number;
  measuredCents: number;
  listPriceCents: number;
  estimatedTokenCents: number;
  freeCalls: number;
  unpricedCalls: number;
  unpricedModels: string[];
  monthKey: string;
  monthToDateCents: number;
  lastMonthCents: number;
  projectedMonthCents: number;
  todayCents: number;
  last7dCents: number;
  avgCentsPerCall: number;
  byProvider: SpendBucket[];
  byModel: SpendBucket[];
  byFeature: SpendBucket[];
  byPerson: SpendBucket[];
  byDay: { date: string; cents: number; calls: number }[];
  byMonth: { month: string; cents: number; calls: number }[];
  topCalls: { id: string; feature: string; model: string; cents: number; basis: CostBasis; actor: string | null; created_at: string }[];
};

function prevMonthKey(mk: string): string {
  const [y, m] = mk.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function daysInMonth(mk: string): number {
  const [y, m] = mk.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Roll up priced rows. `rows` may reach further back than `windowDays` (the
 * caller reads at least two Pacific months so month-to-date and last month are
 * whole); the window breakdowns only count rows inside it. PURE.
 */
export function summarizeSpend(rows: CostRow[], nowIso: string, windowDays: number): SpendReport {
  const nowMs = Date.parse(nowIso);
  const windowStart = nowMs - windowDays * 86_400_000;
  const weekStart = nowMs - 7 * 86_400_000;
  const today = pacificDayKey(nowIso);
  const monthKey = pacificMonthKey(nowIso);
  const lastKey = prevMonthKey(monthKey);
  const maps = { provider: new Map<string, SpendBucket>(), model: new Map<string, SpendBucket>(), feature: new Map<string, SpendBucket>(), person: new Map<string, SpendBucket>() };
  const dayMap = new Map<string, { cents: number; calls: number }>();
  const monthMap = new Map<string, { cents: number; calls: number }>();
  const unpriced = new Set<string>();
  const rep: SpendReport = {
    windowDays, totalCents: 0, measuredCents: 0, listPriceCents: 0, estimatedTokenCents: 0, freeCalls: 0, unpricedCalls: 0, unpricedModels: [],
    monthKey, monthToDateCents: 0, lastMonthCents: 0, projectedMonthCents: 0, todayCents: 0, last7dCents: 0, avgCentsPerCall: 0,
    byProvider: [], byModel: [], byFeature: [], byPerson: [], byDay: [], byMonth: [], topCalls: [],
  };
  const bump = (m: Map<string, SpendBucket>, key: string, r: CostRow, c: RowCost) => {
    const b = m.get(key) ?? { key, calls: 0, tokens: 0, cents: 0, measuredCents: 0 };
    b.calls += 1;
    b.tokens += r.total_tokens || 0;
    b.cents += c.cents;
    if (c.basis === "measured") b.measuredCents += c.cents;
    m.set(key, b);
  };
  let windowCalls = 0;
  const priced: { r: CostRow; c: RowCost }[] = [];

  for (const r of rows) {
    const c = priceRow(r);
    const t = Date.parse(r.created_at);
    const mk = pacificMonthKey(r.created_at);
    const mm = monthMap.get(mk) ?? { cents: 0, calls: 0 };
    mm.cents += c.cents;
    mm.calls += 1;
    monthMap.set(mk, mm);
    if (mk === monthKey) rep.monthToDateCents += c.cents;
    if (mk === lastKey) rep.lastMonthCents += c.cents;
    if (t < windowStart) continue;

    windowCalls += 1;
    rep.totalCents += c.cents;
    if (c.basis === "measured") rep.measuredCents += c.cents;
    if (c.basis === "list-price") rep.listPriceCents += c.cents;
    if (c.basis === "list-price" && r.estimated && r.total_tokens > 0 && !c.model.startsWith("llamaparse-")) rep.estimatedTokenCents += c.cents;
    if (c.basis === "free") rep.freeCalls += 1;
    if (c.basis === "unpriced") { rep.unpricedCalls += 1; unpriced.add(c.model); }
    if (t >= weekStart) rep.last7dCents += c.cents;
    const day = pacificDayKey(r.created_at);
    if (day === today) rep.todayCents += c.cents;
    const d = dayMap.get(day) ?? { cents: 0, calls: 0 };
    d.cents += c.cents;
    d.calls += 1;
    dayMap.set(day, d);
    bump(maps.provider, c.provider, r, c);
    bump(maps.model, c.model, r, c);
    bump(maps.feature, r.feature, r, c);
    bump(maps.person, r.actor_email?.trim() || "System / automatic", r, c);
    if (c.cents > 0) priced.push({ r, c });
  }

  const dayOfMonth = Number(today.slice(8, 10));
  rep.projectedMonthCents = dayOfMonth > 0 ? (rep.monthToDateCents / dayOfMonth) * daysInMonth(monthKey) : 0;
  rep.avgCentsPerCall = windowCalls > 0 ? rep.totalCents / windowCalls : 0;
  rep.unpricedModels = [...unpriced].sort();
  const sorted = (m: Map<string, SpendBucket>) => [...m.values()].map((b) => ({ ...b, cents: round4(b.cents), measuredCents: round4(b.measuredCents) })).sort((a, b) => b.cents - a.cents || b.calls - a.calls);
  rep.byProvider = sorted(maps.provider);
  rep.byModel = sorted(maps.model);
  rep.byFeature = sorted(maps.feature);
  rep.byPerson = sorted(maps.person);
  rep.byDay = [...dayMap.entries()].map(([date, v]) => ({ date, cents: round4(v.cents), calls: v.calls })).sort((a, b) => a.date.localeCompare(b.date));
  rep.byMonth = [...monthMap.entries()].map(([month, v]) => ({ month, cents: round4(v.cents), calls: v.calls })).sort((a, b) => a.month.localeCompare(b.month));
  rep.topCalls = priced
    .sort((a, b) => b.c.cents - a.c.cents)
    .slice(0, 15)
    .map(({ r, c }) => ({ id: r.id ?? `${r.created_at}-${r.feature}`, feature: r.feature, model: c.model, cents: c.cents, basis: c.basis, actor: r.actor_email ?? null, created_at: r.created_at }));
  for (const k of ["totalCents", "measuredCents", "listPriceCents", "estimatedTokenCents", "monthToDateCents", "lastMonthCents", "projectedMonthCents", "todayCents", "last7dCents", "avgCentsPerCall"] as const) rep[k] = round4(rep[k]);
  return rep;
}

/** "$1,234.56"; amounts under a dollar keep enough digits to be readable ("$0.0042"). */
export function formatCents(cents: number): string {
  const usd = cents / 100;
  if (usd !== 0 && Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── self-tests ──────────────────────────────────────────────────────────
export function __runAiCostCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`ai-cost-core FAIL: ${label}`);
    }
  };
  const row = (o: Partial<CostRow>): CostRow => ({ feature: "ai.generate", model: "gpt-4o-mini", prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated: false, ok: true, error_note: null, created_at: "2026-11-20T20:00:00Z", ...o });
  const M = 1_000_000;

  // List price: 1M in + 1M out on gpt-4o-mini = $0.15 + $0.60 = 75 cents.
  ok(priceRow(row({ prompt_tokens: M, completion_tokens: M, total_tokens: 2 * M })).cents === 75, "gpt-4o-mini list price");
  ok(priceRow(row({ model: "gpt-4o-mini-2024-07-18", prompt_tokens: M, total_tokens: M })).cents === 15, "dated id falls back to its family, mini not 4o");
  ok(priceRow(row({ model: "models/Gemini-4-Carbon", prompt_tokens: M, total_tokens: M })).cents === 200, "prefix + case normalized");
  // Gemini 4 Carbon doubles on 2026-12-01 (Pacific). 2026-12-01T05:00Z is still Nov 30 in Pacific.
  ok(priceRow(row({ model: "gemini-4-carbon", prompt_tokens: M, total_tokens: M, created_at: "2026-12-01T05:00:00Z" })).cents === 200, "Pacific Nov 30 keeps the old rate");
  ok(priceRow(row({ model: "gemini-4-carbon", prompt_tokens: M, total_tokens: M, created_at: "2026-12-01T12:00:00Z" })).cents === 400, "Dec 1 Pacific doubles");
  ok(priceRow(row({ model: "gemini-4-carbon", feature: "product.all_fields.batch", prompt_tokens: M, total_tokens: M })).cents === 100, "batch is half");
  ok(priceRow(row({ model: "gemini-embedding-2", feature: "media.embed.image", prompt_tokens: 258, total_tokens: 258 })).cents === 0.0116, "image embed at image rate");
  // Measured beats list.
  ok(priceRow(row({ model: "flux-kontext-pro", error_note: "credits 4" })).basis === "measured" && priceRow(row({ model: "flux-kontext-pro", error_note: "credits 4" })).cents === 4, "BFL credits = cents");
  ok(priceRow(row({ model: "flux-kontext-pro" })).cents === 4 && priceRow(row({ model: "flux-kontext-pro" })).basis === "list-price", "FLUX flat fallback");
  ok(priceRow(row({ model: "gemini-3.8-flash", feature: "inventory.product_lookup.batch", prompt_tokens: 5, total_tokens: 5, error_note: "batch x: 3 answered, 0 failed, 2 searches, ~$1.25" })).cents === 125, "batch measured dollars");
  // Free and failed.
  ok(priceRow(row({ model: "unpdf" })).basis === "free" && priceRow(row({ model: "llamaparse" })).cents === 0, "own-server / status rows free");
  ok(priceRow(row({ ok: false, estimated: true, prompt_tokens: 500, total_tokens: 500 })).basis === "free", "failed HTTP call not billed");
  ok(priceRow(row({ ok: false, estimated: false, prompt_tokens: M, total_tokens: M })).cents === 15, "failed validation with real usage IS billed");
  ok(priceRow(row({ model: "flux-pro-1.0-fill", ok: false })).cents === 0, "failed image edit not billed");
  ok(priceRow(row({ model: "llamaparse-balanced", total_tokens: 30 })).cents === 4.5, "LlamaParse credits at $1.50/1k");
  // Never guess.
  const u = priceRow(row({ model: "mystery-9", prompt_tokens: 100, total_tokens: 100 }));
  ok(u.basis === "unpriced" && u.cents === 0, "unknown model is unpriced, not guessed");

  // Roll-up.
  const now = "2026-11-28T20:00:00Z";
  const rep = summarizeSpend(
    [
      row({ id: "a", prompt_tokens: M, completion_tokens: M, total_tokens: 2 * M, actor_email: "m@g.com", created_at: "2026-11-28T18:00:00Z" }),
      row({ id: "b", model: "flux-kontext-pro", error_note: "credits 4", created_at: "2026-11-25T18:00:00Z" }),
      row({ id: "c", model: "mystery-9", prompt_tokens: 1, total_tokens: 1, created_at: "2026-11-27T18:00:00Z" }),
      row({ id: "d", prompt_tokens: M, total_tokens: M, created_at: "2026-10-10T18:00:00Z" }),
    ],
    now,
    30,
  );
  ok(rep.totalCents === 79 && rep.measuredCents === 4 && rep.listPriceCents === 75, "window totals by basis");
  ok(rep.monthToDateCents === 79 && rep.lastMonthCents === 15, "month-to-date and last month (Pacific)");
  ok(Math.abs(rep.projectedMonthCents - (79 / 28) * 30) < 0.001, "projection = MTD / day x days in month");
  ok(rep.todayCents === 75 && rep.unpricedCalls === 1 && rep.unpricedModels[0] === "mystery-9", "today + unpriced surfaced");
  ok(rep.byProvider[0].key === "OpenAI" && rep.byPerson.some((p) => p.key === "System / automatic"), "provider and person buckets");
  ok(rep.topCalls[0].id === "a" && rep.topCalls.length === 2, "top calls exclude $0 rows");
  ok(rep.byMonth.length === 2 && rep.byDay.length === 3, "day buckets only inside the window; months over all rows");
  ok(formatCents(123456) === "$1,234.56" && formatCents(0.42) === "$0.0042" && formatCents(0) === "$0.00", "money format");
  return { passed, failed };
}
