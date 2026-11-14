/**
 * src/lib/media/media-embed-core.ts  (D244 R-4)
 *
 * Owner, verbatim (D244 round 2): "for the embeddings question, I am not
 * sure. is this the professional enterprise grade solution? please use your
 * expert judgement to implement this properly, the right way, not the easy
 * way."
 *
 * THE DESIGN (hybrid retrieval, the standard production pattern):
 *   - Word search (0352 media_search: weighted full text + typo tolerance)
 *     stays. It is exact and explainable: "Blue Dream 3.5g" finds that jar.
 *   - Semantic search is added beside it. Each photo gets two embeddings
 *     from Gemini's multimodal model (gemini-embedding-2, 768 numbers):
 *       text  = the photo's words (product / strain / title / AI caption /
 *               package text / tags) as a search DOCUMENT;
 *       image = the picture itself, so a photo with no caption yet is still
 *               found by what it shows.
 *     Stored in Postgres (pgvector, HNSW cosine index, 0365) beside the data,
 *     so there is no second database to keep in sync.
 *   - The ranked lists are fused by Reciprocal Rank Fusion (RRF, k = 60):
 *     score = sum over lists of 1 / (k + rank). RRF needs no score
 *     normalisation between very different scorers, which is why it is the
 *     default fusion in Elasticsearch, OpenSearch and Azure AI Search.
 *   - In the product recommender, a semantic match is EVIDENCE with its own
 *     calibrated confidence (semanticConfidence), capped below "High":
 *     meaning alone never outranks a name + brand match or a person's past
 *     pick, but it can surface a photo the word match missed. When both
 *     agree the photo gets a small boost.
 *
 * Gemini specifics (ai.google.dev/gemini-api/docs/embeddings, Apr 2026):
 *   - gemini-embedding-2 takes no task_type; the task goes in the text:
 *       query:    "task: search result | query: {content}"
 *       document: "title: {title} | text: {content}"   ("title: none" if none)
 *   - output_dimensionality 768 is a recommended size; truncated sizes are
 *     re-normalised by the model, so cosine distance is correct as is.
 *   - batchEmbedContents = one embedding per request entry.
 *   - images: PNG / JPEG only.
 *
 * PURE. No I/O. The server half is media-embed-server.ts.
 */

/** Env var naming the embedding model (default gemini-embedding-2). */
export const EMBED_MODEL_VAR = "AI_EMBED_MODEL";
export const EMBED_MODEL_DEFAULT = "gemini-embedding-2";
/** Fixed by the 0365 column type vector(768). */
export const EMBED_DIMS = 768;
/** RRF constant (the value from the original Cormack et al. paper). */
export const RRF_K = 60;
/** Texts per batchEmbedContents call. */
export const EMBED_TEXT_CHUNK = 50;
/** Pictures per batchEmbedContents call (each is its own request entry). */
export const EMBED_IMAGE_CHUNK = 4;
/** A picture larger than this is not sent (inline data limit headroom). */
export const EMBED_IMAGE_MAX_BYTES = 4_000_000;
/** Photos read per page of the sweep. */
export const EMBED_PAGE_SIZE = 100;
/** A failed (photo, kind) is retried this many times, then left as failed. */
export const EMBED_MAX_ATTEMPTS = 3;
/** Work time per idle tick of /api/cron/lookup-jobs. */
export const MEDIA_EMBED_TICK_BUDGET_MS = 120_000;
/** The lease outlives the tick budget. */
export const MEDIA_EMBED_LEASE_MS = 180_000;
/** After a sweep that found nothing to do, the next sweep waits this long (an idle tick is one read). */
export const EMBED_RESWEEP_MS = 15 * 60_000;
/** Text sent per document (well under the 8,192 token limit). */
export const EMBED_DOC_MAX_CHARS = 6000;
/** site_settings key of the worker state. */
export const MEDIA_EMBED_STATE_KEY = "media_embed_state";
export const MEDIA_EMBED_STATE_LABEL = "Semantic photo search index (D244 R-4)";
/** Picture types the embedding model accepts. */
export const EMBED_IMAGE_MIME = ["image/png", "image/jpeg", "image/jpg"] as const;

/**
 * Calibration of cosine similarity to a recommender confidence.
 * Below SEMANTIC_FLOOR_SIM the match is noise (0). From the floor up the
 * confidence climbs linearly from MIN shown (35) to SEMANTIC_MAX at
 * SEMANTIC_TOP_SIM. SEMANTIC_MAX (74) is the same ceiling a name match
 * without a brand word gets (NO_BRAND_CAP): meaning alone is never "High".
 */
export const SEMANTIC_FLOOR_SIM = 0.55;
export const SEMANTIC_TOP_SIM = 0.8;
export const SEMANTIC_MIN_CONFIDENCE = 35;
export const SEMANTIC_MAX = 74;
/** Name match and semantic match agree: a small lift (never past the name ceiling). */
export const SEMANTIC_AGREE_BOOST = 6;

export type EmbedKind = "text" | "image";

// ---------------------------------------------------------------------------
// Model + text formatting
// ---------------------------------------------------------------------------

/** The configured model; any non-empty, plain id is accepted. */
export function resolveEmbedModel(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(v) ? v : EMBED_MODEL_DEFAULT;
}

function clean(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/** The photo fields the text embedding reads (named columns of media_assets). */
export type EmbedAssetText = {
  title?: string | null;
  product_name?: string | null;
  strain_name?: string | null;
  seo_title?: string | null;
  ai_caption?: string | null;
  visible_text?: string | null;
  alt_text?: string | null;
  seo_alt?: string | null;
  ai_description?: string | null;
  description?: string | null;
  tags?: readonly string[] | null;
  ai_tags?: readonly string[] | null;
  category?: string | null;
  subcategory?: string | null;
  role?: string | null;
  pack_size?: string | null;
  vendor_name?: string | null;
  brand_name?: string | null;
};

/**
 * The search DOCUMENT for one photo: "title: {title} | text: {content}".
 * Title = product name, else title, else "none". Content = everything else
 * that describes the photo, de-duplicated, capped at EMBED_DOC_MAX_CHARS.
 * "" when the photo has no words at all (nothing to embed as text).
 */
export function embedDocumentText(a: EmbedAssetText): string {
  const title = clean(a.product_name) || clean(a.title) || clean(a.seo_title);
  const parts: string[] = [];
  const add = (label: string, v: string | null | undefined) => {
    const c = clean(v);
    if (c && c !== title && !parts.some((p) => p.endsWith(`: ${c}`))) parts.push(`${label}: ${c}`);
  };
  add("brand", a.brand_name);
  add("vendor", a.vendor_name);
  add("strain", a.strain_name);
  add("title", a.title);
  add("category", [clean(a.category), clean(a.subcategory)].filter(Boolean).join(" / "));
  add("pack", a.pack_size);
  add("kind of image", a.role);
  add("package text", a.visible_text);
  add("caption", a.ai_caption);
  add("alt", a.alt_text || a.seo_alt);
  add("description", a.ai_description || a.description);
  const tags = [...new Set([...(a.tags ?? []), ...(a.ai_tags ?? [])].map((t) => clean(t).toLowerCase()).filter(Boolean))];
  if (tags.length) parts.push(`tags: ${tags.join(", ")}`);
  if (!title && parts.length === 0) return "";
  const text = parts.join(". ").slice(0, EMBED_DOC_MAX_CHARS);
  return `title: ${title || "none"} | text: ${text || title}`;
}

/** The QUERY form: "task: search result | query: {content}". "" for a blank query. */
export function embedQueryText(q: string | null | undefined): string {
  const c = clean(q).slice(0, 500);
  return c ? `task: search result | query: ${c}` : "";
}

/** The semantic question the recommender asks for one product. */
export function productSemanticQuery(p: { name: string | null | undefined; brand?: string | null; category?: string | null }): string {
  const name = clean(p.name);
  if (name.length < 2) return "";
  const brand = clean(p.brand);
  const cat = clean(p.category);
  return [brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : "", name, cat ? `${cat} product photo` : "product photo"].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Hashing (what was embedded) and work planning
// ---------------------------------------------------------------------------

/** cyrb53: a fast, well-mixed 53-bit string hash (hex). Deterministic, pure. */
export function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Hash of exactly what a text embedding was made from (model + dims + text). */
export function textSourceHash(model: string, doc: string): string {
  return `t:${hash53(`${model}|${EMBED_DIMS}|${doc}`)}`;
}

/** Hash of a picture embedding: the file's content hash (else its storage key) + model. */
export function imageSourceHash(model: string, a: { content_hash?: string | null; storage_key?: string | null; public_url?: string | null }): string {
  const id = clean(a.content_hash) || clean(a.storage_key) || clean(a.public_url);
  return id ? `i:${hash53(`${model}|${EMBED_DIMS}|${id}`)}` : "";
}

export function isEmbeddableImageMime(mime: string | null | undefined): boolean {
  return (EMBED_IMAGE_MIME as readonly string[]).includes(String(mime ?? "").toLowerCase().trim());
}

export type ExistingEmbedding = { media_id: string; kind: EmbedKind; source_hash: string; status: "done" | "failed" | "skipped"; attempts: number };

export type EmbedJob = { mediaId: string; kind: EmbedKind; hash: string; doc: string };

/**
 * What to (re-)embed for one page of photos. A (photo, kind) is embedded when
 * it has no row, its hash changed (new caption / new file / new model), or it
 * failed fewer than EMBED_MAX_ATTEMPTS times with the same hash. A "skipped"
 * row with the same hash is left alone (e.g. a GIF the model cannot read).
 */
export function planEmbedJobs(
  assets: readonly { id: string; doc: string; textHash: string; imageHash: string; imageOk: boolean }[],
  existing: readonly ExistingEmbedding[],
): { jobs: EmbedJob[]; skips: EmbedJob[] } {
  const have = new Map(existing.map((e) => [`${e.media_id}|${e.kind}`, e] as const));
  const jobs: EmbedJob[] = [];
  const skips: EmbedJob[] = [];
  const want = (e: ExistingEmbedding | undefined, hash: string) =>
    !e || e.source_hash !== hash || (e.status === "failed" && e.attempts < EMBED_MAX_ATTEMPTS);
  for (const a of assets) {
    if (a.doc && a.textHash && want(have.get(`${a.id}|text`), a.textHash)) jobs.push({ mediaId: a.id, kind: "text", hash: a.textHash, doc: a.doc });
    if (a.imageHash) {
      const e = have.get(`${a.id}|image`);
      if (want(e, a.imageHash)) (a.imageOk ? jobs : skips).push({ mediaId: a.id, kind: "image", hash: a.imageHash, doc: "" });
    }
  }
  // A skip already recorded with the same hash is not re-written.
  return { jobs, skips: skips.filter((s) => have.get(`${s.mediaId}|image`)?.source_hash !== s.hash) };
}

// ---------------------------------------------------------------------------
// The API answer and the stored literal
// ---------------------------------------------------------------------------

/**
 * Parse a batchEmbedContents / embedContent answer into vectors. Each vector
 * must have exactly `dims` finite numbers, else that slot is null (the row
 * is recorded as failed, never stored half-right).
 */
export function parseEmbedResponse(json: unknown, expected: number, dims: number = EMBED_DIMS): (number[] | null)[] {
  const out: (number[] | null)[] = Array.from({ length: Math.max(0, expected) }, () => null);
  const o = (json ?? {}) as { embeddings?: unknown; embedding?: unknown };
  const list = Array.isArray(o.embeddings) ? o.embeddings : o.embedding ? [o.embedding] : [];
  for (let i = 0; i < Math.min(list.length, out.length); i += 1) {
    const v = (list[i] as { values?: unknown } | null)?.values;
    if (Array.isArray(v) && v.length === dims && v.every((x) => typeof x === "number" && Number.isFinite(x))) out[i] = v as number[];
  }
  return out;
}

/** pgvector text literal "[0.1,0.2,...]" (what PostgREST stores into a vector column). */
export function vectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? Number(x.toFixed(7)) : 0)).join(",")}]`;
}

/** Cosine similarity (tests and diagnostics). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : d / Math.sqrt(na * nb);
}

// ---------------------------------------------------------------------------
// Fusion and calibration
// ---------------------------------------------------------------------------

export type FusedHit = { id: string; score: number; ranks: (number | null)[] };

/**
 * Reciprocal Rank Fusion. Each list is ids best-first (duplicates inside a
 * list keep their best rank). score = sum w_i / (k + rank_i), rank from 1.
 * Ties break by the best single rank, then by first appearance. PURE.
 */
export function rrfFuse(lists: readonly (readonly string[])[], opts: { k?: number; weights?: readonly number[] } = {}): FusedHit[] {
  const k = opts.k && opts.k > 0 ? opts.k : RRF_K;
  const acc = new Map<string, { score: number; ranks: (number | null)[]; first: number }>();
  let order = 0;
  lists.forEach((list, li) => {
    const w = opts.weights?.[li] ?? 1;
    const seen = new Set<string>();
    let rank = 0;
    for (const raw of list) {
      const id = String(raw ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rank += 1;
      let e = acc.get(id);
      if (!e) {
        e = { score: 0, ranks: lists.map(() => null), first: order++ };
        acc.set(id, e);
      }
      e.score += w / (k + rank);
      e.ranks[li] = rank;
    }
  });
  const best = (r: (number | null)[]) => Math.min(...r.map((x) => (x === null ? Infinity : x)));
  return [...acc.entries()]
    .sort(([, x], [, y]) => y.score - x.score || best(x.ranks) - best(y.ranks) || x.first - y.first)
    .map(([id, e]) => ({ id, score: e.score, ranks: e.ranks }));
}

/** Calibrated recommender confidence for a cosine similarity (0 = noise). */
export function semanticConfidence(similarity: number | null | undefined): number {
  const s = Number(similarity);
  if (!Number.isFinite(s) || s < SEMANTIC_FLOOR_SIM) return 0;
  const t = Math.min(1, (s - SEMANTIC_FLOOR_SIM) / (SEMANTIC_TOP_SIM - SEMANTIC_FLOOR_SIM));
  return Math.round(SEMANTIC_MIN_CONFIDENCE + t * (SEMANTIC_MAX - SEMANTIC_MIN_CONFIDENCE));
}

/** Best similarity per photo over its text / image rows. */
export function bestSimilarity(rows: readonly { media_id: string; kind: string; similarity: number }[]): Map<string, { similarity: number; kind: EmbedKind }> {
  const m = new Map<string, { similarity: number; kind: EmbedKind }>();
  for (const r of rows ?? []) {
    const id = String(r?.media_id ?? "").trim();
    const s = Number(r?.similarity);
    if (!id || !Number.isFinite(s)) continue;
    const prev = m.get(id);
    if (!prev || s > prev.similarity) m.set(id, { similarity: s, kind: r.kind === "image" ? "image" : "text" });
  }
  return m;
}

// ---------------------------------------------------------------------------
// Worker state (one site_settings row, compare-and-set) and the health line
// ---------------------------------------------------------------------------

export type MediaEmbedState = {
  v: 1;
  paused: boolean;
  cursor: string | null;
  leaseToken: string | null;
  leaseUntil: string | null;
  /** When the last full pass over the library found nothing to embed. */
  quietSince: string | null;
  lastRunAt: string | null;
  lastNote: string | null;
  embedded: number;
  failed: number;
};

export const EMPTY_EMBED_STATE: MediaEmbedState = {
  v: 1, paused: false, cursor: null, leaseToken: null, leaseUntil: null, quietSince: null, lastRunAt: null, lastNote: null, embedded: 0, failed: 0,
};

const isoOrNull = (x: unknown): string | null => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : null);
const nat = (x: unknown): number => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : 0);

export function parseEmbedState(raw: unknown): MediaEmbedState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_EMBED_STATE };
  const o = raw as Record<string, unknown>;
  const cursor = typeof o.cursor === "string" && /^[0-9a-f-]{36}$/i.test(o.cursor) ? o.cursor : null;
  return {
    v: 1,
    paused: o.paused === true,
    cursor,
    leaseToken: typeof o.leaseToken === "string" && o.leaseToken ? o.leaseToken : null,
    leaseUntil: isoOrNull(o.leaseUntil),
    quietSince: isoOrNull(o.quietSince),
    lastRunAt: isoOrNull(o.lastRunAt),
    lastNote: typeof o.lastNote === "string" ? o.lastNote.slice(0, 300) : null,
    embedded: nat(o.embedded),
    failed: nat(o.failed),
  };
}

export type EmbedTickDecision = "go" | "paused" | "leased" | "quiet";

/** Should this idle tick work? "quiet" = the last pass found nothing and it was under EMBED_RESWEEP_MS ago. */
export function embedTickDecision(s: MediaEmbedState, nowMs: number): EmbedTickDecision {
  if (s.paused) return "paused";
  if (s.leaseToken && s.leaseUntil && Date.parse(s.leaseUntil) > nowMs) return "leased";
  if (s.quietSince && nowMs - Date.parse(s.quietSince) < EMBED_RESWEEP_MS) return "quiet";
  return "go";
}

export function takeEmbedLease(s: MediaEmbedState, token: string, nowMs: number): MediaEmbedState {
  return { ...s, leaseToken: token, leaseUntil: new Date(nowMs + MEDIA_EMBED_LEASE_MS).toISOString(), lastRunAt: new Date(nowMs).toISOString() };
}

/** End of a tick: release the lease, keep the cursor, add the counts. */
export function releaseEmbedLease(
  s: MediaEmbedState,
  token: string,
  r: { cursor: string | null; embedded: number; failed: number; passDoneQuiet: boolean; note: string; nowIso: string },
): MediaEmbedState {
  if (s.leaseToken !== token) return s;
  return {
    ...s,
    leaseToken: null,
    leaseUntil: null,
    cursor: r.cursor,
    quietSince: r.passDoneQuiet ? r.nowIso : null,
    lastNote: r.note.slice(0, 300),
    embedded: s.embedded + Math.max(0, r.embedded),
    failed: s.failed + Math.max(0, r.failed),
  };
}

export type EmbedHealth = {
  live_images: number;
  text_done: number;
  image_done: number;
  failed: number;
  skipped: number;
  last_embedded_at: string | null;
  models: string[];
};

export function parseEmbedHealth(raw: unknown): EmbedHealth | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.round(x)) : Number.parseInt(String(x ?? "0"), 10) || 0);
  return {
    live_images: n(o.live_images),
    text_done: n(o.text_done),
    image_done: n(o.image_done),
    failed: n(o.failed),
    skipped: n(o.skipped),
    last_embedded_at: isoOrNull(o.last_embedded_at),
    models: Array.isArray(o.models) ? o.models.filter((m): m is string => typeof m === "string") : [],
  };
}

export type EmbedCapability = { vectorAvailable: boolean; vectorInstalled: boolean; columnReady: boolean };

export function parseEmbedCapability(raw: unknown): EmbedCapability {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { vectorAvailable: o.vector_available === true, vectorInstalled: o.vector_installed === true, columnReady: o.column_ready === true };
}

export type EmbedStatusLine = { tone: "ok" | "working" | "warn" | "off"; title: string; detail: string; pct: number };

/** One plain-English status line for the admin panel. PURE. */
export function embedStatusLine(input: { migrated: boolean; cap: EmbedCapability; keySet: boolean; health: EmbedHealth | null; state: MediaEmbedState }): EmbedStatusLine {
  if (!input.migrated) return { tone: "off", title: "Semantic search is not installed yet", detail: "Apply database update 0365 (docs/MIGRATIONS_TO_RUN.md). Until then search matches words only.", pct: 0 };
  if (!input.cap.columnReady)
    return {
      tone: "warn",
      title: "Semantic search needs the pgvector extension",
      detail: input.cap.vectorAvailable
        ? "pgvector is available but not on. Run 0365 again in the Supabase SQL editor; it turns it on and adds the index."
        : "This database cannot install pgvector. Search keeps matching words only.",
      pct: 0,
    };
  if (!input.keySet) return { tone: "warn", title: "Semantic search needs a Gemini key", detail: "Set AI_GEMINI_API_KEY on Vercel. Search keeps matching words until then.", pct: 0 };
  const h = input.health;
  const total = h?.live_images ?? 0;
  const done = Math.min(total, h?.image_done ?? 0);
  const textDone = Math.min(total, h?.text_done ?? 0);
  const pct = total > 0 ? Math.round((100 * Math.max(done, textDone)) / total) : 100;
  if (input.state.paused) return { tone: "off", title: "Semantic indexing is paused", detail: `${textDone} of ${total} photos indexed by their words, ${done} by the picture. Search uses what is indexed.`, pct };
  const counts = `${textDone} of ${total} photos indexed by their words, ${done} by the picture${h && h.failed ? `, ${h.failed} could not be read` : ""}.`;
  if (pct >= 100 || (input.state.quietSince && pct >= 95)) return { tone: "ok", title: "Semantic search is on", detail: `${counts} New photos are indexed within about 15 minutes.`, pct };
  return { tone: "working", title: "Semantic search is indexing the library", detail: `${counts} It works in the background when the AI worker is otherwise idle.`, pct };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runMediaEmbedTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  media-embed-core FAILED: ${label}`);
    }
  };

  // Model + formatting
  ok(resolveEmbedModel(undefined) === "gemini-embedding-2", "default model");
  ok(resolveEmbedModel(" gemini-embedding-001 ") === "gemini-embedding-001", "override kept");
  ok(resolveEmbedModel("bad model; drop") === "gemini-embedding-2", "unsafe id refused");
  const doc = embedDocumentText({ product_name: "Blue Dream 3.5g", brand_name: "Phat Panda", ai_caption: "Green buds in a glass jar", tags: ["Flower", "flower", "hybrid"], visible_text: "BLUE DREAM | 3.5G" });
  ok(doc.startsWith("title: Blue Dream 3.5g | text: "), "document title form");
  ok(doc.includes("brand: Phat Panda") && doc.includes("caption: Green buds in a glass jar"), "document carries brand + caption");
  ok(doc.includes("tags: flower, hybrid"), "tags de-duplicated and lower-cased");
  ok(doc.split(" | ").length === 2, "a pipe inside the data cannot break the format");
  ok(embedDocumentText({ ai_caption: "A dog" }).startsWith("title: none | text: caption: A dog"), "no title -> title: none");
  ok(embedDocumentText({}) === "", "no words -> nothing to embed");
  ok(embedDocumentText({ caption: undefined, description: "x".repeat(9000) } as EmbedAssetText).length <= EMBED_DOC_MAX_CHARS + 40, "document capped");
  ok(embedQueryText("  indica  flower ") === "task: search result | query: indica flower", "query form");
  ok(embedQueryText("   ") === "", "blank query");
  ok(productSemanticQuery({ name: "Blue Dream 3.5g", brand: "Phat Panda", category: "flower" }) === "Phat Panda Blue Dream 3.5g flower product photo", "product query");
  ok(productSemanticQuery({ name: "Phat Panda Gelato", brand: "Phat Panda" }) === "Phat Panda Gelato product photo", "brand not repeated");
  ok(productSemanticQuery({ name: "x" }) === "", "too short");

  // Hashes + planning
  ok(hash53("a") === hash53("a") && hash53("a") !== hash53("b"), "hash deterministic and distinct");
  ok(textSourceHash("m", "d") !== textSourceHash("m2", "d"), "model change re-embeds");
  ok(imageSourceHash("m", { content_hash: "abc" }) === imageSourceHash("m", { content_hash: "abc", storage_key: "other" }), "image hash from content hash");
  ok(imageSourceHash("m", {}) === "", "no file id -> no image job");
  ok(isEmbeddableImageMime("image/JPEG") && !isEmbeddableImageMime("image/gif") && !isEmbeddableImageMime(null), "png/jpeg only");
  const assets = [
    { id: "a", doc: "title: A | text: A", textHash: "t1", imageHash: "i1", imageOk: true },
    { id: "b", doc: "title: B | text: B", textHash: "t2", imageHash: "i2", imageOk: false },
    { id: "c", doc: "", textHash: "", imageHash: "i3", imageOk: true },
  ];
  const p1 = planEmbedJobs(assets, []);
  ok(p1.jobs.length === 4 && p1.skips.length === 1 && p1.skips[0].mediaId === "b", "fresh: text a,b + image a,c; gif b skipped");
  const p2 = planEmbedJobs(assets, [
    { media_id: "a", kind: "text", source_hash: "t1", status: "done", attempts: 1 },
    { media_id: "a", kind: "image", source_hash: "old", status: "done", attempts: 1 },
    { media_id: "b", kind: "text", source_hash: "t2", status: "failed", attempts: 3 },
    { media_id: "b", kind: "image", source_hash: "i2", status: "skipped", attempts: 1 },
    { media_id: "c", kind: "image", source_hash: "i3", status: "failed", attempts: 1 },
  ]);
  ok(p2.jobs.map((j) => `${j.mediaId}:${j.kind}`).join(",") === "a:image,c:image", "unchanged kept, changed + retryable re-run, exhausted left");
  ok(p2.skips.length === 0, "recorded skip not re-written");

  // Parsing + literal
  const v = Array.from({ length: EMBED_DIMS }, (_, i) => (i === 0 ? 1 : 0));
  const parsed = parseEmbedResponse({ embeddings: [{ values: v }, { values: [1, 2] }, { values: v.map(() => Number.NaN) }] }, 3);
  ok(parsed[0]?.length === EMBED_DIMS && parsed[1] === null && parsed[2] === null, "wrong length / NaN -> failed slot");
  ok(parseEmbedResponse({ embedding: { values: v } }, 1)[0] !== null, "single embedContent answer");
  ok(parseEmbedResponse(null, 2).length === 2 && parseEmbedResponse(null, 2).every((x) => x === null), "garbage -> all failed");
  ok(parseEmbedResponse({ embeddings: [{ values: v }] }, 2)[1] === null, "short answer -> missing slot failed");
  ok(vectorLiteral([0.123456789, 1, -2]) === "[0.1234568,1,-2]", "vector literal");
  ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9 && cosine([1, 0], [0, 1]) === 0 && cosine([], []) === 0, "cosine");

  // RRF
  const f = rrfFuse([["a", "b", "c"], ["c", "a", "d"]]);
  ok(f[0].id === "a", "in both lists near the top wins");
  ok(f.map((x) => x.id).join(",") === "a,c,b,d", "fused order");
  ok(Math.abs(f[0].score - (1 / 61 + 1 / 62)) < 1e-12, "RRF score formula k=60");
  ok(f[0].ranks[0] === 1 && f[0].ranks[1] === 2 && f[3].ranks[0] === null, "ranks recorded");
  ok(rrfFuse([["a", "a", "b"]])[1].ranks[0] === 2, "duplicates keep best rank");
  ok(rrfFuse([["a"], ["b"]], { weights: [1, 2] })[0].id === "b", "weights respected");
  ok(rrfFuse([]).length === 0 && rrfFuse([["", " "]]).length === 0, "empty");

  // Calibration
  ok(semanticConfidence(0.5) === 0 && semanticConfidence(null) === 0 && semanticConfidence(Number.NaN) === 0, "below floor = noise");
  ok(semanticConfidence(SEMANTIC_FLOOR_SIM) === SEMANTIC_MIN_CONFIDENCE, "floor = shown minimum");
  ok(semanticConfidence(0.95) === SEMANTIC_MAX && SEMANTIC_MAX < 80, "capped below High");
  ok(semanticConfidence(0.7) > semanticConfidence(0.6), "monotonic");
  const bs = bestSimilarity([{ media_id: "a", kind: "text", similarity: 0.6 }, { media_id: "a", kind: "image", similarity: 0.7 }, { media_id: "", kind: "text", similarity: 1 }]);
  ok(bs.size === 1 && bs.get("a")?.kind === "image" && bs.get("a")?.similarity === 0.7, "best per photo");

  // State
  const s0 = parseEmbedState({ cursor: "not-a-uuid", embedded: -3, paused: "yes" });
  ok(s0.cursor === null && s0.embedded === 0 && s0.paused === false, "state parse is strict");
  const now = Date.parse("2026-05-01T12:00:00Z");
  ok(embedTickDecision(EMPTY_EMBED_STATE, now) === "go", "fresh -> go");
  ok(embedTickDecision({ ...EMPTY_EMBED_STATE, paused: true }, now) === "paused", "paused");
  const leased = takeEmbedLease(EMPTY_EMBED_STATE, "tok", now);
  ok(embedTickDecision(leased, now + 1000) === "leased" && embedTickDecision(leased, now + MEDIA_EMBED_LEASE_MS + 1) === "go", "lease holds, then expires");
  ok(MEDIA_EMBED_LEASE_MS > MEDIA_EMBED_TICK_BUDGET_MS, "lease outlives the tick");
  const quiet = { ...EMPTY_EMBED_STATE, quietSince: new Date(now).toISOString() };
  ok(embedTickDecision(quiet, now + 60_000) === "quiet" && embedTickDecision(quiet, now + EMBED_RESWEEP_MS + 1) === "go", "quiet then re-sweep");
  const rel = releaseEmbedLease(leased, "tok", { cursor: null, embedded: 5, failed: 1, passDoneQuiet: true, note: "n", nowIso: new Date(now).toISOString() });
  ok(rel.leaseToken === null && rel.embedded === 5 && rel.failed === 1 && rel.quietSince !== null, "release adds counts");
  ok(releaseEmbedLease(leased, "other", { cursor: null, embedded: 5, failed: 0, passDoneQuiet: false, note: "", nowIso: "" }) === leased, "a lost lease writes nothing");

  // Status line
  const cap = { vectorAvailable: true, vectorInstalled: true, columnReady: true };
  const h = { live_images: 200, text_done: 100, image_done: 80, failed: 2, skipped: 0, last_embedded_at: null, models: [] };
  ok(embedStatusLine({ migrated: false, cap, keySet: true, health: null, state: EMPTY_EMBED_STATE }).tone === "off", "not migrated");
  ok(embedStatusLine({ migrated: true, cap: { ...cap, columnReady: false }, keySet: true, health: null, state: EMPTY_EMBED_STATE }).detail.includes("Run 0365 again"), "pgvector available but off");
  ok(embedStatusLine({ migrated: true, cap, keySet: false, health: h, state: EMPTY_EMBED_STATE }).title.includes("Gemini key"), "no key");
  const w = embedStatusLine({ migrated: true, cap, keySet: true, health: h, state: EMPTY_EMBED_STATE });
  ok(w.tone === "working" && w.pct === 50 && w.detail.includes("2 could not be read"), "indexing with counts");
  ok(embedStatusLine({ migrated: true, cap, keySet: true, health: { ...h, text_done: 200, image_done: 190 }, state: EMPTY_EMBED_STATE }).tone === "ok", "done -> on");
  ok(parseEmbedHealth({ live_images: "12", models: ["m", 3] })?.live_images === 12, "health parse");

  return { passed, failed };
}
