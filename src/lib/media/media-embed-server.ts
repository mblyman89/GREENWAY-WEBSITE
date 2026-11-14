/**
 * src/lib/media/media-embed-server.ts  (D244 R-4)
 *
 * The I/O half of hybrid semantic photo search (design: media-embed-core.ts).
 *
 *   runMediaEmbedTick   the background indexer. Runs on the idle tick of
 *                       /api/cron/lookup-jobs (no new cron, AGENTS.md rule 12).
 *                       One site_settings row ('media_embed_state') holds the
 *                       cursor and the lease, written by compare-and-set on
 *                       updated_at. An idle tick (paused, leased, or a pass
 *                       that found nothing under 15 minutes ago) is ONE read.
 *                       Each page of 100 photos: read what is already
 *                       embedded, embed only what is new or changed (text in
 *                       chunks of 50, pictures in chunks of 4), upsert.
 *   semanticSearch      a typed query -> nearest photos (text + picture rows).
 *   semanticNeighbors   one photo -> photos that read / look like it.
 *   loadEmbedPanel      the status card on /admin/media.
 *
 * Never throws to a caller. When 0365 is not applied, pgvector is off, or no
 * Gemini key is set, every search returns [] and the app keeps using word
 * search alone.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { geminiApiKey } from "@/lib/ai/provider";
import { gemini } from "@/lib/ai/gemini-http";
import { logAiUsage, estimateTokens } from "@/lib/ai/usage";
import { publicUrlForKey } from "./store";
import {
  EMBED_DIMS,
  EMBED_IMAGE_CHUNK,
  EMBED_IMAGE_MAX_BYTES,
  EMBED_MODEL_VAR,
  EMBED_PAGE_SIZE,
  EMBED_TEXT_CHUNK,
  EMPTY_EMBED_STATE,
  MEDIA_EMBED_STATE_KEY,
  MEDIA_EMBED_STATE_LABEL,
  MEDIA_EMBED_TICK_BUDGET_MS,
  embedDocumentText,
  embedQueryText,
  embedStatusLine,
  embedTickDecision,
  imageSourceHash,
  isEmbeddableImageMime,
  parseEmbedCapability,
  parseEmbedHealth,
  parseEmbedResponse,
  parseEmbedState,
  planEmbedJobs,
  releaseEmbedLease,
  resolveEmbedModel,
  takeEmbedLease,
  textSourceHash,
  vectorLiteral,
  type EmbedCapability,
  type EmbedHealth,
  type EmbedJob,
  type EmbedStatusLine,
  type ExistingEmbedding,
  type MediaEmbedState,
} from "./media-embed-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type CallFn = typeof gemini;
type FetchImage = (url: string) => Promise<{ ok: boolean; mime: string; data: string; note: string }>;

const SAFETY_MS = 8_000;
const CAS_TRIES = 4;

export function embedModel(): string {
  return resolveEmbedModel(process.env[EMBED_MODEL_VAR]);
}

/** True when a Gemini key is set (the embedding model is Gemini's). */
export function embedConfigured(): boolean {
  try {
    return Boolean(geminiApiKey());
  } catch {
    return false;
  }
}

const short = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 240);
const missingDb = (msg: string) => /does not exist|could not find|schema cache|PGRST20[0-9]/i.test(msg);

// ---------------------------------------------------------------------------
// Gemini calls
// ---------------------------------------------------------------------------

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** batchEmbedContents: one embedding per part. Never throws. */
async function embedParts(parts: Part[], model: string, call: CallFn): Promise<{ vectors: (number[] | null)[]; error: string | null }> {
  if (parts.length === 0) return { vectors: [], error: null };
  const body = { requests: parts.map((p) => ({ model: `models/${model}`, content: { parts: [p] }, outputDimensionality: EMBED_DIMS })) };
  const res = await call(`v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const msg = ((res.json as { error?: { message?: string } } | null)?.error?.message ?? res.text ?? "").slice(0, 200);
    return { vectors: parts.map(() => null), error: `Gemini answered ${res.status}: ${msg || "no detail"}` };
  }
  return { vectors: parseEmbedResponse(res.json, parts.length), error: null };
}

const defaultFetchImage: FetchImage = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ok: false, mime: "", data: "", note: `The picture could not be downloaded (${res.status}).` };
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!isEmbeddableImageMime(mime)) return { ok: false, mime, data: "", note: `Not a PNG or JPEG (${mime || "unknown"}).` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > EMBED_IMAGE_MAX_BYTES) return { ok: false, mime, data: "", note: "The picture is larger than 4 MB." };
    return { ok: true, mime: mime === "image/jpg" ? "image/jpeg" : mime, data: buf.toString("base64"), note: "" };
  } catch (e) {
    return { ok: false, mime: "", data: "", note: `The picture could not be downloaded (${short(e)}).` };
  }
};

// Query embeddings are cached per server instance (the same product is asked
// about again and again while a person works on it).
const QUERY_CACHE_MAX = 300;
const queryCache = new Map<string, number[]>();

export async function embedQuery(q: string, deps: { call?: CallFn; model?: string } = {}): Promise<number[] | null> {
  const text = embedQueryText(q);
  if (!text || (!deps.call && !embedConfigured())) return null;
  const model = deps.model ?? embedModel();
  const key = `${model}|${text}`;
  const hit = queryCache.get(key);
  if (hit) return hit;
  const r = await embedParts([{ text }], model, deps.call ?? gemini);
  const v = r.vectors[0] ?? null;
  if (v) {
    if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value as string);
    queryCache.set(key, v);
    void logAiUsage({ feature: "media.embed.query", model, promptTokens: estimateTokens(text), completionTokens: 0, estimated: true, ok: true });
  }
  return v;
}

// ---------------------------------------------------------------------------
// Capability (cached briefly: one RPC per few minutes per instance)
// ---------------------------------------------------------------------------

let capCache: { at: number; migrated: boolean; cap: EmbedCapability } | null = null;
const CAP_TTL_MS = 5 * 60_000;

async function readCapability(admin: Admin, nowMs: number, fresh = false): Promise<{ migrated: boolean; cap: EmbedCapability }> {
  if (!fresh && capCache && nowMs - capCache.at < CAP_TTL_MS) return capCache;
  const { data, error } = await admin.rpc("media_embedding_capability");
  const out = error
    ? { migrated: !missingDb(error.message ?? ""), cap: parseEmbedCapability(null) }
    : { migrated: true, cap: parseEmbedCapability(data) };
  capCache = { at: nowMs, ...out };
  return out;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SemanticRow = { media_id: string; kind: string; similarity: number };

/** Nearest photos to a typed query (text and picture rows, best first). [] when off. */
export async function semanticSearch(query: string, limit = 40, deps: { admin?: Admin; call?: CallFn } = {}): Promise<SemanticRow[]> {
  if ((!deps.admin && !isSupabaseServiceConfigured) || (!deps.call && !embedConfigured())) return [];
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const { cap } = await readCapability(admin, Date.now());
    if (!cap.columnReady) return [];
    const v = await embedQuery(query, { call: deps.call });
    if (!v) return [];
    const { data, error } = await admin.rpc("media_vector_search", { p_embedding: vectorLiteral(v), p_limit: Math.max(1, Math.min(100, limit)) });
    if (error || !Array.isArray(data)) return [];
    return (data as SemanticRow[]).filter((r) => r && typeof r.media_id === "string" && Number.isFinite(Number(r.similarity))).map((r) => ({ ...r, similarity: Number(r.similarity) }));
  } catch {
    return [];
  }
}

/** Photos whose words / picture are nearest to one photo. [] when off or not indexed. */
export async function semanticNeighbors(id: string, limit = 24, deps: { admin?: Admin } = {}): Promise<SemanticRow[]> {
  if (!deps.admin && !isSupabaseServiceConfigured) return [];
  try {
    const admin = deps.admin ?? createSupabaseAdminClient();
    const { cap } = await readCapability(admin, Date.now());
    if (!cap.columnReady) return [];
    const { data, error } = await admin.rpc("media_vector_neighbors", { p_id: id, p_limit: Math.max(1, Math.min(100, limit)) });
    if (error || !Array.isArray(data)) return [];
    return (data as SemanticRow[]).filter((r) => r && typeof r.media_id === "string").map((r) => ({ ...r, similarity: Number(r.similarity) }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Worker state (site_settings, compare-and-set on updated_at)
// ---------------------------------------------------------------------------

type Snapshot = { state: MediaEmbedState; updatedAt: string | null };

async function readState(admin: Admin): Promise<Snapshot> {
  const { data, error } = await admin.from("site_settings").select("value_json, updated_at").eq("key", MEDIA_EMBED_STATE_KEY).maybeSingle();
  if (error) throw new Error(`The search index state could not be read: ${short(error)}`);
  const row = data as { value_json?: unknown; updated_at?: string | null } | null;
  return { state: parseEmbedState(row?.value_json ?? null), updatedAt: row ? (row.updated_at ?? null) : null };
}

async function casWrite(admin: Admin, snap: Snapshot, next: MediaEmbedState, actorId: string | null): Promise<boolean> {
  if (snap.updatedAt === null) {
    const { error } = await admin.from("site_settings").insert({ key: MEDIA_EMBED_STATE_KEY, label: MEDIA_EMBED_STATE_LABEL, value_json: next, updated_by: actorId });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(`The search index state could not be saved: ${short(error)}`);
  }
  const { data, error } = await admin.from("site_settings").update({ value_json: next, updated_by: actorId }).eq("key", MEDIA_EMBED_STATE_KEY).eq("updated_at", snap.updatedAt).select("key");
  if (error) throw new Error(`The search index state could not be saved: ${short(error)}`);
  return ((data as unknown[] | null) ?? []).length === 1;
}

async function mutate(admin: Admin, actorId: string | null, change: (s: MediaEmbedState) => MediaEmbedState | null): Promise<boolean> {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const snap = await readState(admin);
    const next = change(snap.state);
    if (!next) return false;
    if (await casWrite(admin, snap, next, actorId)) return true;
  }
  return false;
}

/** Pause / resume the background indexer (the admin card buttons). */
export async function setMediaEmbedPaused(paused: boolean, actorId: string | null): Promise<{ ok: boolean; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured." };
  try {
    const ok = await mutate(createSupabaseAdminClient(), actorId, (s) => ({ ...s, paused, quietSince: null, leaseToken: paused ? null : s.leaseToken, leaseUntil: paused ? null : s.leaseUntil }));
    return ok ? { ok: true, error: null } : { ok: false, error: "The index state kept changing. Try again." };
  } catch (e) {
    return { ok: false, error: short(e) };
  }
}

/** Retry every failed photo: reset attempts and start a fresh pass. */
export async function retryFailedEmbeddings(actorId: string | null): Promise<{ ok: boolean; error: string | null; n: number }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured.", n: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("media_embeddings").delete().eq("status", "failed").select("media_id");
    if (error) return { ok: false, error: short(error), n: 0 };
    await mutate(admin, actorId, (s) => ({ ...s, cursor: null, quietSince: null }));
    return { ok: true, error: null, n: ((data as unknown[] | null) ?? []).length };
  } catch (e) {
    return { ok: false, error: short(e), n: 0 };
  }
}

// ---------------------------------------------------------------------------
// The background indexer
// ---------------------------------------------------------------------------

const PAGE_COLUMNS =
  "id, status, mime_type, storage_key, public_url, content_hash, title, product_name, strain_name, seo_title, ai_caption, visible_text, alt_text, seo_alt, ai_description, description, tags, ai_tags, category, subcategory, role, pack_size, vendor_id, brand_id";

type PageRow = {
  id: string;
  status: string | null;
  mime_type: string | null;
  storage_key: string | null;
  public_url: string | null;
  content_hash: string | null;
  title: string | null;
  product_name: string | null;
  strain_name: string | null;
  seo_title: string | null;
  ai_caption: string | null;
  visible_text: string | null;
  alt_text: string | null;
  seo_alt: string | null;
  ai_description: string | null;
  description: string | null;
  tags: string[] | null;
  ai_tags: string[] | null;
  category: string | null;
  subcategory: string | null;
  role: string | null;
  pack_size: string | null;
  vendor_id: string | null;
  brand_id: string | null;
};

async function namesById(admin: Admin, table: "vendors" | "brands", ids: (string | null)[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (clean.length === 0) return new Map();
  const { data } = await admin.from(table).select("id, display_name").in("id", clean);
  return new Map((((data as { id: string; display_name: string | null }[] | null) ?? [])).map((r) => [r.id, r.display_name ?? ""] as const));
}

export type MediaEmbedTickResult =
  | { ok: true; skipped: "paused" | "leased" | "quiet" | "not_configured" | "not_migrated" | "no_vector"; note: string }
  | { ok: true; skipped?: undefined; embedded: number; failed: number; skippedImages: number; pages: number; passDone: boolean; note: string }
  | { ok: false; error: string };

export async function runMediaEmbedTick(
  opts: { budgetMs?: number; admin?: Admin; now?: () => number; token?: string; call?: CallFn; fetchImage?: FetchImage; model?: string } = {},
): Promise<MediaEmbedTickResult> {
  if (!opts.admin && !isSupabaseServiceConfigured) return { ok: true, skipped: "not_configured", note: "Supabase is not configured." };
  const now = opts.now ?? Date.now;
  const t0 = now();
  const deadline = t0 + (opts.budgetMs ?? MEDIA_EMBED_TICK_BUDGET_MS) - SAFETY_MS;
  const token = opts.token ?? crypto.randomUUID();
  const call = opts.call ?? gemini;
  const fetchImage = opts.fetchImage ?? defaultFetchImage;
  const model = opts.model ?? embedModel();
  let admin: Admin;
  try {
    admin = opts.admin ?? createSupabaseAdminClient();
  } catch (e) {
    return { ok: false, error: short(e) };
  }

  // Decide + lease. An idle tick is ONE read of one site_settings row.
  let startCursor: string | null = null;
  try {
    const snap = await readState(admin);
    const d = embedTickDecision(snap.state, t0);
    if (d !== "go") return { ok: true, skipped: d, note: d === "paused" ? "Semantic indexing is paused." : d === "leased" ? "Another run is indexing." : "Nothing new to index." };
    if (!opts.call && !embedConfigured()) return { ok: true, skipped: "not_configured", note: "No Gemini key (AI_GEMINI_API_KEY), so photos cannot be indexed for semantic search." };
    const capRead = await readCapability(admin, t0, true);
    if (!capRead.migrated || !capRead.cap.columnReady) {
      // Remember the answer for EMBED_RESWEEP_MS so a database without 0365 / pgvector is asked rarely.
      await casWrite(admin, snap, { ...snap.state, quietSince: new Date(t0).toISOString(), lastNote: capRead.migrated ? "pgvector is not on." : "Database update 0365 is not applied." }, null).catch(() => false);
      return capRead.migrated
        ? { ok: true, skipped: "no_vector", note: "pgvector is not on; run 0365 again after enabling it." }
        : { ok: true, skipped: "not_migrated", note: "Apply database update 0365 first." };
    }
    startCursor = snap.state.cursor;
    if (!(await casWrite(admin, snap, takeEmbedLease(snap.state, token, t0), null))) return { ok: true, skipped: "leased", note: "Another run is indexing." };
  } catch (e) {
    return { ok: false, error: short(e) };
  }

  let cursor = startCursor;
  let embedded = 0;
  let failed = 0;
  let skippedImages = 0;
  let pages = 0;
  let passDone = false;
  let lastError = "";

  const writeRows = async (rows: Record<string, unknown>[]) => {
    if (rows.length === 0) return;
    const { error } = await admin.from("media_embeddings").upsert(rows, { onConflict: "media_id,kind" });
    if (error) throw new Error(`Saving embeddings failed: ${short(error)}`);
  };

  try {
    while (now() < deadline) {
      let q = admin.from("media_assets").select(PAGE_COLUMNS).neq("status", "archived").order("id", { ascending: true }).limit(EMBED_PAGE_SIZE);
      if (cursor) q = q.gt("id", cursor);
      const { data, error } = await q;
      if (error) throw new Error(`Reading photos failed: ${short(error)}`);
      const page = ((data as PageRow[] | null) ?? []).filter((r) => r && typeof r.id === "string");
      pages += 1;
      if (page.length === 0) {
        cursor = null;
        passDone = true;
        break;
      }
      const ids = page.map((r) => r.id);
      const [vendors, brands, existingRead] = await Promise.all([
        namesById(admin, "vendors", page.map((r) => r.vendor_id)),
        namesById(admin, "brands", page.map((r) => r.brand_id)),
        admin.from("media_embeddings").select("media_id, kind, source_hash, status, attempts").in("media_id", ids),
      ]);
      if (existingRead.error) throw new Error(`Reading the index failed: ${short(existingRead.error)}`);
      const existing = ((existingRead.data as ExistingEmbedding[] | null) ?? []);
      const attemptsOf = new Map(existing.map((e) => [`${e.media_id}|${e.kind}`, e] as const));
      const urlOf = new Map<string, string>();
      const assets = page.map((r) => {
        const doc = embedDocumentText({ ...r, vendor_name: r.vendor_id ? vendors.get(r.vendor_id) ?? null : null, brand_name: r.brand_id ? brands.get(r.brand_id) ?? null : null });
        const url = (r.storage_key ? publicUrlForKey(r.storage_key) : null) ?? r.public_url ?? "";
        if (url) urlOf.set(r.id, url);
        const isImage = String(r.mime_type ?? "").toLowerCase().startsWith("image/");
        return {
          id: r.id,
          doc,
          textHash: doc ? textSourceHash(model, doc) : "",
          imageHash: isImage && url ? imageSourceHash(model, r) : "",
          imageOk: isImage && Boolean(url) && isEmbeddableImageMime(r.mime_type),
        };
      });
      const plan = planEmbedJobs(assets, existing);
      const row = (j: EmbedJob, v: number[] | null, note: string | null, status: "done" | "failed" | "skipped") => {
        const prev = attemptsOf.get(`${j.mediaId}|${j.kind}`);
        const attempts = status === "failed" ? (prev && prev.source_hash === j.hash ? prev.attempts : 0) + 1 : 1;
        return { media_id: j.mediaId, kind: j.kind, model, dims: EMBED_DIMS, source_hash: j.hash, status, note: note ? note.slice(0, 300) : null, attempts, embedded_at: new Date(now()).toISOString(), embedding: v ? vectorLiteral(v) : null };
      };
      await writeRows(plan.skips.map((j) => row(j, null, "Not a PNG or JPEG, so the picture itself is not indexed (its words still are).", "skipped")));
      skippedImages += plan.skips.length;

      const texts = plan.jobs.filter((j) => j.kind === "text");
      const images = plan.jobs.filter((j) => j.kind === "image");
      let outOfTime = false;
      for (let i = 0; i < texts.length; i += EMBED_TEXT_CHUNK) {
        if (now() >= deadline) {
          outOfTime = true;
          break;
        }
        const chunk = texts.slice(i, i + EMBED_TEXT_CHUNK);
        const r = await embedParts(chunk.map((j) => ({ text: j.doc })), model, call);
        if (r.error) lastError = r.error;
        await writeRows(chunk.map((j, k) => (r.vectors[k] ? row(j, r.vectors[k], null, "done") : row(j, null, r.error ?? "The answer had no usable embedding.", "failed"))));
        const good = r.vectors.filter(Boolean).length;
        embedded += good;
        failed += chunk.length - good;
        void logAiUsage({ feature: "media.embed.text", model, promptTokens: chunk.reduce((n, j) => n + estimateTokens(j.doc), 0), completionTokens: 0, estimated: true, ok: !r.error, errorNote: r.error });
      }
      for (let i = 0; !outOfTime && i < images.length; i += EMBED_IMAGE_CHUNK) {
        if (now() >= deadline) {
          outOfTime = true;
          break;
        }
        const chunk = images.slice(i, i + EMBED_IMAGE_CHUNK);
        const files = await Promise.all(chunk.map((j) => fetchImage(urlOf.get(j.mediaId) ?? "")));
        const sendIdx = files.map((f, k) => (f.ok ? k : -1)).filter((k) => k >= 0);
        const r = await embedParts(sendIdx.map((k) => ({ inlineData: { mimeType: files[k].mime, data: files[k].data } })), model, call);
        if (r.error) lastError = r.error;
        const out: Record<string, unknown>[] = [];
        chunk.forEach((j, k) => {
          const at = sendIdx.indexOf(k);
          if (at < 0) {
            out.push(row(j, null, files[k].note, "failed"));
            failed += 1;
          } else if (r.vectors[at]) {
            out.push(row(j, r.vectors[at], null, "done"));
            embedded += 1;
          } else {
            out.push(row(j, null, r.error ?? "The answer had no usable embedding.", "failed"));
            failed += 1;
          }
        });
        await writeRows(out);
        // Images bill per image; ~258 tokens is Google's per-image figure for PDFs pages / pictures.
        if (sendIdx.length) void logAiUsage({ feature: "media.embed.image", model, promptTokens: 258 * sendIdx.length, completionTokens: 0, estimated: true, ok: !r.error, errorNote: r.error });
      }
      if (outOfTime) break; // the cursor stays on this page: its unfinished photos are planned again next tick
      cursor = ids[ids.length - 1];
      if (page.length < EMBED_PAGE_SIZE) {
        cursor = null;
        passDone = true;
        break;
      }
    }
  } catch (e) {
    lastError = short(e);
  }

  const quiet = passDone && startCursor === null && embedded === 0 && failed === 0;
  const note = lastError
    ? `Indexed ${embedded}, ${failed} failed. Last problem: ${lastError}`
    : passDone
      ? quiet
        ? "Every photo is indexed."
        : `Indexed ${embedded} photo embedding${embedded === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}; reached the end of the library.`
      : `Indexed ${embedded}${failed ? `, ${failed} failed` : ""}; continues next tick.`;
  try {
    await mutate(admin, null, (s) => (s.leaseToken === token ? releaseEmbedLease(s, token, { cursor, embedded, failed, passDoneQuiet: quiet, note, nowIso: new Date(now()).toISOString() }) : null));
  } catch {
    /* the lease simply expires */
  }
  if (lastError && embedded === 0 && failed === 0) return { ok: false, error: lastError };
  return { ok: true, embedded, failed, skippedImages, pages, passDone, note };
}

// ---------------------------------------------------------------------------
// The admin card
// ---------------------------------------------------------------------------

export type EmbedPanel = {
  model: string;
  line: EmbedStatusLine;
  health: EmbedHealth | null;
  state: MediaEmbedState;
  migrated: boolean;
  cap: EmbedCapability;
  error: string | null;
};

export async function loadEmbedPanel(): Promise<EmbedPanel> {
  const model = embedModel();
  const keySet = embedConfigured();
  const base = { model, health: null, state: { ...EMPTY_EMBED_STATE }, migrated: false, cap: parseEmbedCapability(null), error: null as string | null };
  if (!isSupabaseServiceConfigured) {
    return { ...base, error: "The database is not configured.", line: embedStatusLine({ migrated: false, cap: base.cap, keySet, health: null, state: base.state }) };
  }
  try {
    const admin = createSupabaseAdminClient();
    const [capRead, healthRead, snap] = await Promise.all([
      readCapability(admin, Date.now(), true),
      admin.rpc("media_embedding_health"),
      readState(admin).catch(() => ({ state: { ...EMPTY_EMBED_STATE }, updatedAt: null })),
    ]);
    const health = healthRead.error ? null : parseEmbedHealth(healthRead.data);
    const line = embedStatusLine({ migrated: capRead.migrated, cap: capRead.cap, keySet, health, state: snap.state });
    return { model, line, health, state: snap.state, migrated: capRead.migrated, cap: capRead.cap, error: null };
  } catch (e) {
    return { ...base, error: short(e), line: embedStatusLine({ migrated: false, cap: base.cap, keySet, health: null, state: base.state }) };
  }
}
