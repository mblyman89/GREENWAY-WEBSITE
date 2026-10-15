/**
 * R41 S11: OFAC sanctions screening, the I/O half (migration 0278).
 *
 * runOfacScreening downloads OFAC's four data files, checks them, screens
 * every payee and records the run and its results in ONE database call
 * (ofac_record_run). recordOfacReview stores the owner's decision on a
 * possible match. readScreeningView feeds the Sanctions screening page.
 *
 * NEVER A PAYMENT GATE. Nothing in payroll, the vendor file builder or the
 * file checker imports this file (a vitest pins that). A failed download or
 * an unreadable payee list is recorded and emailed, and payments carry on.
 *
 * Every read of payees is paged by a unique id (pagedAllChecked): PostgREST
 * silently caps one response at 1,000 rows (SLICE 5C), and a short list
 * would screen fewer people than exist. An unfinished read fails the run
 * instead of screening part of the list.
 */
import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import {
  buildOfacIndex,
  decodeOfacAscii,
  MATCH_THRESHOLD,
  matchKey,
  OFAC_EXPORT_BASE,
  OFAC_FIELD_COUNT,
  OFAC_FILES,
  OFAC_USER_AGENT,
  ofacDbErrorMessage,
  parseOfacCsv,
  parseOfacDigest,
  payeeSetText,
  resultStatus,
  screenPayees,
  type NameMatch,
  type OfacFile,
  type OfacRecords,
  type Payee,
  type ReviewDecision,
  type StoredResult,
  type StoredReview,
} from "@/lib/payments/ofac-screening-core";

type Fail = { ok: false; error: string };
type Row = Record<string, unknown>;

const NOT_CONFIGURED = "Database not connected. Nothing was screened.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One download may take this long before it is abandoned. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function dbErr(e: { code?: string; message?: string } | null | undefined): string {
  return ofacDbErrorMessage(`${e?.code ?? ""} ${e?.message ?? ""}`.trim());
}

// ───────────────────────────────────────────────────────────── download ──

export type FetchLike = (url: string, init: { method: "GET" | "HEAD"; headers: Record<string, string>; signal?: AbortSignal; redirect?: "follow" }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type FileMeta = { file: OfacFile; sha256: string; bytes: number; records: number; lastModified: string | null };

export type Download =
  | { ok: true; records: OfacRecords; files: FileMeta[]; listSha256: string; lastModified: string | null; digestVerified: boolean; digestNote: string }
  | Fail;

/**
 * The four files, with OFAC's User-Agent rule (2024-05-16 notice) and the
 * redirect to S3 followed. SDN.CSV is checked against OFAC's published Digest
 * when the HEAD answer has one; a mismatch refuses the whole download. The
 * other three have no published digest (HEAD answers 400; docs/authorities/
 * ofac/README.md) and are checked by structure only.
 */
export async function downloadOfacLists(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<Download> {
  const headers = { "User-Agent": OFAC_USER_AGENT };
  const records = {} as OfacRecords;
  const files: FileMeta[] = [];
  let sdnSha = "";
  for (const file of OFAC_FILES) {
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await fetchImpl(`${OFAC_EXPORT_BASE}${file}`, { method: "GET", headers, redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch {
      return { ok: false, error: `${file}: OFAC's server did not answer (network error or more than ${DOWNLOAD_TIMEOUT_MS / 1000} seconds). Nothing was screened.` };
    }
    if (!res.ok) return { ok: false, error: `${file}: OFAC's server answered ${res.status}. Nothing was screened.` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = decodeOfacAscii(bytes, file);
    if (!text.ok) return { ok: false, error: text.error };
    const parsed = parseOfacCsv(text.text, OFAC_FIELD_COUNT[file], file);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    records[file] = parsed.records;
    const h = sha256(bytes);
    if (file === "SDN.CSV") sdnSha = h;
    files.push({ file, sha256: h, bytes: bytes.length, records: parsed.records.length, lastModified: res.headers.get("last-modified") });
  }
  let digestVerified = false;
  let digestNote = "OFAC's published fingerprint for SDN.CSV could not be read; the files were checked by structure.";
  try {
    const head = await fetchImpl(`${OFAC_EXPORT_BASE}SDN.CSV`, { method: "HEAD", headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    const published = head.ok ? parseOfacDigest(head.headers.get("digest")) : null;
    if (published) {
      if (published !== sdnSha) {
        // OFAC may have republished between the GET and the HEAD; the next run will tell. Never screen against an unverified mismatch.
        return { ok: false, error: "SDN.CSV did not match OFAC's published fingerprint (it may have been republished during the download). Nothing was screened; the next run tries again." };
      }
      digestVerified = true;
      digestNote = "SDN.CSV matched OFAC's published fingerprint.";
    }
  } catch {
    /* recorded as not verified */
  }
  const listSha256 = sha256(files.map((f) => `${f.file}:${f.sha256}`).join("\n"));
  return { ok: true, records, files, listSha256, lastModified: files[0]?.lastModified ?? null, digestVerified, digestNote };
}

// ───────────────────────────────────────────────────────────── payees ──

async function pagedRead(table: string, cols: string): Promise<{ ok: true; rows: Row[] } | Fail> {
  const sb = createSupabaseAdminClient();
  const { rows, verdict } = await pagedAllChecked<Row>(async (from, to) => {
    const { data, error } = await sb.from(table).select(cols).order("id", { ascending: true }).range(from, to);
    return { rows: (data ?? []) as unknown as Row[], ok: !error };
  });
  if (!verdict.complete) return { ok: false, error: `The ${table.replace(/_/g, " ")} list could not be read in full, so nobody was screened (a partial screen would look complete).` };
  return { ok: true, rows };
}

/**
 * Who is screened: every employee who is not terminated (or is still marked
 * active), every active vendor, with every name the app holds for them: the
 * HR name and the W-2 name; the vendor's display, legal and DBA names, the
 * account-holder name on its bank record, and the payee name on any ACH
 * authorization. Archived or revoked bank records and authorizations are
 * still screened: the names were real.
 */
export async function gatherPayees(): Promise<{ ok: true; payees: Payee[] } | Fail> {
  const [emp, ven, vbd, auth] = await Promise.all([
    pagedRead("employees", "id, full_name, w2_first_name_and_initial, w2_last_name, active, employment_status"),
    pagedRead("vendors", "id, display_name, legal_name, dba, is_active"),
    pagedRead("vendor_bank_details", "id, vendor_id, vendor_name"),
    pagedRead("ach_authorizations", "id, payee_type, employee_id, vendor_id, payee_name"),
  ]);
  for (const r of [emp, ven, vbd, auth]) if (!r.ok) return r;
  if (!emp.ok || !ven.ok || !vbd.ok || !auth.ok) return { ok: false, error: "unreachable" };
  const extra = new Map<string, string[]>();
  const add = (k: string, n: unknown) => {
    if (typeof n !== "string" || !n.trim()) return;
    extra.set(k, [...(extra.get(k) ?? []), n]);
  };
  for (const r of vbd.rows) add(`vendor:${str(r.vendor_id)}`, r.vendor_name);
  for (const r of auth.rows) {
    if (r.payee_type === "employee") add(`employee:${str(r.employee_id)}`, r.payee_name);
    if (r.payee_type === "vendor") add(`vendor:${str(r.vendor_id)}`, r.payee_name);
  }
  const payees: Payee[] = [];
  for (const e of emp.rows) {
    if (e.employment_status === "terminated" && e.active !== true) continue;
    const id = str(e.id);
    const w2 = [str(e.w2_first_name_and_initial), str(e.w2_last_name)].filter(Boolean).join(" ");
    const names = [str(e.full_name), w2, ...(extra.get(`employee:${id}`) ?? [])];
    payees.push({ payeeType: "employee", payeeId: id, label: str(e.full_name) || w2 || "Employee (no name)", names });
  }
  for (const v of ven.rows) {
    if (v.is_active === false) continue;
    const id = str(v.id);
    const names = [str(v.display_name), str(v.legal_name), str(v.dba), ...(extra.get(`vendor:${id}`) ?? [])];
    payees.push({ payeeType: "vendor", payeeId: id, label: str(v.display_name) || str(v.legal_name) || "Vendor (no name)", names });
  }
  return { ok: true, payees };
}

// ───────────────────────────────────────────────────────────── reviews ──

function toReview(r: Row): StoredReview {
  return {
    id: str(r.id),
    resultId: str(r.result_id),
    payeeType: r.payee_type === "vendor" ? "vendor" : "employee",
    payeeId: str(r.payee_id),
    decision: r.decision === "true_match" ? "true_match" : "not_a_match",
    matchKeys: Array.isArray(r.match_keys) ? (r.match_keys as unknown[]).map(str) : [],
    note: str(r.note),
    reviewedAt: str(r.created_at),
  };
}

function toResult(r: Row): StoredResult {
  return {
    id: str(r.id),
    runId: str(r.run_id),
    payeeType: r.payee_type === "vendor" ? "vendor" : "employee",
    payeeId: str(r.payee_id),
    label: str(r.label),
    namesScreened: Array.isArray(r.names_screened) ? (r.names_screened as unknown[]).map(str) : [],
    result: r.result === "possible_match" ? "possible_match" : "clear",
    topScore: Number(r.top_score ?? 0),
    matches: Array.isArray(r.matches) ? (r.matches as NameMatch[]) : [],
  };
}

const REVIEW_COLS = "id, result_id, payee_type, payee_id, decision, match_keys, note, created_at";
const RESULT_COLS = "id, run_id, payee_type, payee_id, label, names_screened, result, top_score, matches";

export async function readAllReviews(): Promise<{ ok: true; reviews: StoredReview[] } | Fail> {
  const r = await pagedRead("ofac_match_reviews", REVIEW_COLS);
  if (!r.ok) return { ok: false, error: "The earlier screening reviews could not be read." };
  return { ok: true, reviews: r.rows.map(toReview) };
}

// ───────────────────────────────────────────────────────────── run ──

export type RunOutcome =
  | {
      ok: true;
      runId: string;
      payees: number;
      possibleMatches: number;
      needsReview: number;
      trueMatches: number;
      unscreenable: number;
      /** sha256 of the sorted match keys still needing review (the email dedupe key). */
      pendingKey: string;
      listLastModified: string | null;
      digestVerified: boolean;
    }
  | { ok: false; error: string; recorded: boolean };

async function recordFailure(trigger: "cron" | "manual", actorId: string | null, error: string): Promise<boolean> {
  const { error: e } = await createSupabaseAdminClient().rpc("ofac_record_run", {
    p_run: { trigger, created_by: actorId, status: "failed", error: error.slice(0, 1000), threshold: MATCH_THRESHOLD },
    p_results: [],
  });
  return !e;
}

/** Download, check, screen every payee, record. Never touches a payment. */
export async function runOfacScreening(input: { trigger: "cron" | "manual"; actorId: string | null; fetchImpl?: FetchLike }): Promise<RunOutcome> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: NOT_CONFIGURED, recorded: false };
  const actor = input.trigger === "manual" ? input.actorId : null;
  const fail = async (error: string): Promise<RunOutcome> => ({ ok: false, error, recorded: await recordFailure(input.trigger, actor, error) });

  const dl = await downloadOfacLists(input.fetchImpl);
  if (!dl.ok) return fail(dl.error);
  const idx = buildOfacIndex(dl.records);
  if (!idx.ok) return fail(idx.error);
  const people = await gatherPayees();
  if (!people.ok) return fail(people.error);
  const prior = await readAllReviews();
  if (!prior.ok) return fail(prior.error);

  const { results, unscreenable } = screenPayees(idx.index, people.payees);
  let needsReview = 0;
  let trueMatches = 0;
  const pending: string[] = [];
  for (const r of results) {
    const st = resultStatus({ ...r, id: "(new)", runId: "(new)" }, prior.reviews);
    if (st.status === "needs_review") {
      needsReview++;
      pending.push(...r.matches.map((m) => `${r.payeeType}:${r.payeeId}:${matchKey(m)}`));
    }
    if (st.status === "true_match") trueMatches++;
  }
  const possible = results.filter((r) => r.result === "possible_match").length;
  const { data, error } = await createSupabaseAdminClient().rpc("ofac_record_run", {
    p_run: {
      trigger: input.trigger,
      created_by: actor,
      status: "ok",
      list_last_modified: dl.lastModified,
      list_sha256: dl.listSha256,
      files: dl.files,
      digest_verified: dl.digestVerified,
      payees_sha256: sha256(payeeSetText(people.payees)),
      payees_count: people.payees.length,
      possible_matches: possible,
      unscreenable: unscreenable.length,
      threshold: MATCH_THRESHOLD,
    },
    p_results: results.map((r) => ({
      payee_type: r.payeeType,
      payee_id: r.payeeId,
      label: r.label || "(no name)",
      names_screened: r.namesScreened.slice(0, 20),
      result: r.result,
      top_score: r.topScore,
      matches: r.matches,
    })),
  });
  if (error) return { ok: false, error: dbErr(error), recorded: false };
  const runId = typeof data === "string" ? data : "";
  if (!UUID.test(runId)) return { ok: false, error: "The database did not confirm the screening record.", recorded: false };
  return {
    ok: true,
    runId,
    payees: people.payees.length,
    possibleMatches: possible,
    needsReview,
    trueMatches,
    unscreenable: unscreenable.length,
    pendingKey: sha256(pending.sort().join("\n")),
    listLastModified: dl.lastModified,
    digestVerified: dl.digestVerified,
  };
}

// ───────────────────────────────────────────────────────────── review ──

/** The owner's decision on one possible match (checked by checkReviewForm first; the 0278 trigger checks again). */
export async function recordOfacReview(input: { resultId: string; decision: ReviewDecision; note: string; actorId: string }): Promise<{ ok: true; id: string; label: string } | Fail> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected. Nothing was saved." };
  if (!UUID.test(input.resultId)) return { ok: false, error: "That screening result could not be found. Reload the page." };
  const sb = createSupabaseAdminClient();
  const res = await sb.from("ofac_screening_results").select(RESULT_COLS).eq("id", input.resultId).maybeSingle();
  if (res.error) return { ok: false, error: dbErr(res.error) };
  if (!res.data) return { ok: false, error: "That screening result could not be found. Reload the page." };
  const r = toResult(res.data as Row);
  if (r.result !== "possible_match" || r.matches.length === 0) return { ok: false, error: "That screening result is clear; there is nothing to review." };
  const { data, error } = await sb
    .from("ofac_match_reviews")
    .insert({
      result_id: r.id,
      payee_type: r.payeeType,
      payee_id: r.payeeId,
      decision: input.decision,
      match_keys: [...new Set(r.matches.map(matchKey))].slice(0, 10),
      note: input.note,
      created_by: input.actorId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: dbErr(error) };
  const id = str((data as Row | null)?.id);
  if (!id) return { ok: false, error: "The database did not confirm the review. Reload the page and check before recording it again." };
  return { ok: true, id, label: r.label };
}

// ───────────────────────────────────────────────────────────── page ──

export type RunRow = {
  id: string;
  ranAt: string;
  trigger: "cron" | "manual";
  status: "ok" | "failed";
  error: string | null;
  listLastModified: string | null;
  digestVerified: boolean;
  payeesCount: number;
  possibleMatches: number;
  unscreenable: number;
  files: FileMeta[];
};

export type ScreeningItem = { result: StoredResult; status: ReturnType<typeof resultStatus> };

export type ScreeningView =
  | { ok: true; runs: RunRow[]; lastOk: RunRow | null; items: ScreeningItem[]; clearCount: number; reviews: StoredReview[] }
  | Fail;

const RUN_COLS = "id, ran_at, trigger, status, error, list_last_modified, digest_verified, payees_count, possible_matches, unscreenable, files";
/** The run history the page lists. */
export const RUN_HISTORY = 30;

function toRun(r: Row): RunRow {
  return {
    id: str(r.id),
    ranAt: str(r.ran_at),
    trigger: r.trigger === "manual" ? "manual" : "cron",
    status: r.status === "ok" ? "ok" : "failed",
    error: typeof r.error === "string" ? r.error : null,
    listLastModified: typeof r.list_last_modified === "string" ? r.list_last_modified : null,
    digestVerified: r.digest_verified === true,
    payeesCount: Number(r.payees_count ?? 0),
    possibleMatches: Number(r.possible_matches ?? 0),
    unscreenable: Number(r.unscreenable ?? 0),
    files: Array.isArray(r.files) ? (r.files as FileMeta[]) : [],
  };
}

/** Last runs, and every result of the last successful run that is not plainly clear. */
export async function readScreeningView(): Promise<ScreeningView> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected, so screening cannot be shown." };
  const sb = createSupabaseAdminClient();
  const runs = await sb.from("ofac_screening_runs").select(RUN_COLS).order("ran_at", { ascending: false }).limit(RUN_HISTORY);
  if (runs.error) return { ok: false, error: dbErr(runs.error) };
  const runRows = ((runs.data ?? []) as Row[]).map(toRun);
  let lastOk = runRows.find((r) => r.status === "ok") ?? null;
  if (!lastOk && runRows.length >= RUN_HISTORY) {
    const one = await sb.from("ofac_screening_runs").select(RUN_COLS).eq("status", "ok").order("ran_at", { ascending: false }).limit(1).maybeSingle();
    if (one.error) return { ok: false, error: dbErr(one.error) };
    lastOk = one.data ? toRun(one.data as Row) : null;
  }
  const reviews = await readAllReviews();
  if (!reviews.ok) return reviews;
  if (!lastOk) return { ok: true, runs: runRows, lastOk: null, items: [], clearCount: 0, reviews: reviews.reviews };
  const runId = lastOk.id;
  const { rows, verdict } = await pagedAllChecked<Row>(async (from, to) => {
    const { data, error } = await sb.from("ofac_screening_results").select(RESULT_COLS).eq("run_id", runId).order("id", { ascending: true }).range(from, to);
    return { rows: (data ?? []) as Row[], ok: !error };
  });
  if (!verdict.complete) return { ok: false, error: "The last screen's results could not be read in full. Reload the page." };
  const items: ScreeningItem[] = [];
  let clearCount = 0;
  for (const raw of rows) {
    const result = toResult(raw);
    const status = resultStatus(result, reviews.reviews);
    if (status.status === "clear") clearCount++;
    else items.push({ result, status });
  }
  const rank = { true_match: 0, needs_review: 1, covered: 2, reviewed: 3, clear: 4 } as const;
  items.sort((a, b) => rank[a.status.status] - rank[b.status.status] || b.result.topScore - a.result.topScore || a.result.label.localeCompare(b.result.label));
  return { ok: true, runs: runRows, lastOk, items, clearCount, reviews: reviews.reviews };
}

/** For the page badge and the go-live board: how many results need the owner. */
export function needsAttention(v: Extract<ScreeningView, { ok: true }>): number {
  return v.items.filter((i) => i.status.status === "needs_review" || i.status.status === "true_match").length;
}

