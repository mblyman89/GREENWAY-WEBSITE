/**
 * src/lib/inbound-email/llamaparse-status-core.ts  (PR-A — observability)
 *
 * PURE logic that turns raw `ai_usage` ledger rows (the ones the LlamaParse
 * provider writes on every intake parse) into a HUMAN-READABLE parse status the
 * UI can show two ways:
 *   1. the intake table's compact badge  →  "llama" (vision succeeded) / "FB"
 *      (fell back to basic text, or failed);
 *   2. the detail receiving page's transport section  →  a plain-English
 *      statement of which engine ran and the HONEST reason when it did not
 *      (key missing, out of credits, timeout, empty read).
 *
 * WHY PURE: no I/O, no imports beyond types — unit-testable with tsx and mirror-
 * tested in vitest. The server reader (llamaparse-status-server.ts) fetches the
 * rows; this module decides what they MEAN. Never import server code here.
 *
 * Owner rule (Michael): fail LOUDLY and honestly. Never imply success when the
 * engine could not run. "llama" = LlamaParse vision produced the text; "FB" =
 * anything else (unpdf fallback OR a hard failure) so the reviewer always knows
 * the AI read did not win.
 */

/** The subset of an ai_usage row this module needs. */
export type ParseLedgerRow = {
  /** ISO timestamp; newest row wins. */
  created_at: string;
  /** false when the parse errored. */
  ok: boolean;
  /** short machine note we classify into plain English (e.g. "402 credits exhausted"). */
  error_note: string | null;
  /** e.g. "llamaparse-max" — used only to detect the engine family. */
  model: string | null;
  /** which engine produced the text: "llamaparse" | "unpdf" | "none" (may be null on old rows). */
  engine?: string | null;
};

/** The compact badge shown on the intake table. */
export type ParseBadge = "llama" | "FB";

/** A fully-derived, presentation-ready status. */
export type ParseStatus = {
  /** "llama" only when vision succeeded; "FB" otherwise (fallback or failure). */
  badge: ParseBadge;
  /** true when LlamaParse vision produced the text. */
  ok: boolean;
  /** which engine ultimately produced the text. */
  engine: "llamaparse" | "unpdf" | "none";
  /** a stable machine reason code for the failure/fallback (or "ok"). */
  reason: ParseReason;
  /** short label for the badge tooltip (a few words). */
  shortReason: string;
  /** a full plain-English sentence for the detail page. */
  statement: string;
};

/** Stable reason codes so the UI/tests never depend on message wording. */
export type ParseReason =
  | "ok"
  | "no_key"
  | "credits"
  | "timeout"
  | "network"
  | "empty"
  | "unpdf_fallback"
  | "unknown"
  | "none";

/**
 * Classify a raw error_note into a stable reason + human phrase. Case-insensitive,
 * order matters (most specific first). Kept small and explicit — no guessing:
 * every branch maps to a note the provider actually emits.
 */
export function classifyParseReason(note: string | null | undefined): {
  reason: ParseReason;
  phrase: string;
} {
  const n = (note ?? "").toLowerCase();
  if (!n.trim()) return { reason: "unknown", phrase: "an unknown problem" };
  if (n.includes("not set") || n.includes("not configured") || n.includes("no key") || n.includes("api_key")) {
    return { reason: "no_key", phrase: "the LlamaParse API key is not set in the environment" };
  }
  if (n.includes("402") || n.includes("credit") || n.includes("quota") || n.includes("payment")) {
    return { reason: "credits", phrase: "the LlamaParse account is out of credits" };
  }
  if (n.includes("timed out") || n.includes("timeout")) {
    return { reason: "timeout", phrase: "the LlamaParse job timed out" };
  }
  if (n.includes("empty") || n.includes("no text")) {
    return { reason: "empty", phrase: "LlamaParse ran but found no readable text" };
  }
  if (n.includes("network") || n.includes("fetch") || n.includes("econn") || /\b5\d{2}\b/.test(n) || n.includes("unreachable")) {
    return { reason: "network", phrase: "LlamaParse could not be reached (network/outage)" };
  }
  return { reason: "unknown", phrase: `LlamaParse reported: ${(note ?? "").trim()}` };
}

/** Normalize an engine string from a ledger row. */
function normalizeEngine(engine: string | null | undefined, model: string | null | undefined): ParseStatus["engine"] {
  const e = (engine ?? "").toLowerCase();
  if (e === "llamaparse" || e === "unpdf" || e === "none") return e;
  // Fall back to inferring from the model tag ("llamaparse-max" => llamaparse).
  const m = (model ?? "").toLowerCase();
  if (m.includes("llama")) return "llamaparse";
  return "none";
}

/**
 * Derive the presentation status from a manifest's ledger rows (any order).
 * The NEWEST row wins (a re-parse supersedes an earlier attempt). When there are
 * no rows at all we return a neutral "no record yet" FB status — never a false
 * "llama". This is the single source of truth for both the badge and the
 * detail-page statement.
 */
export function deriveParseStatus(rows: ParseLedgerRow[]): ParseStatus {
  if (!rows || rows.length === 0) {
    return {
      badge: "FB",
      ok: false,
      engine: "none",
      reason: "none",
      shortReason: "no AI record",
      statement:
        "No document-AI parse was recorded for this manifest yet. It may have been " +
        "imported by JSON/CSV, or added before AI parsing was enabled.",
    };
  }
  // Newest first.
  const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const row = sorted[0];
  const engine = normalizeEngine(row.engine, row.model);

  // SUCCESS via vision.
  if (row.ok && engine === "llamaparse") {
    return {
      badge: "llama",
      ok: true,
      engine: "llamaparse",
      reason: "ok",
      shortReason: "LlamaParse vision",
      statement:
        "LlamaParse (vision) read this document successfully. Any transport fields " +
        "below were filled from what it found; blanks are fields it could not locate " +
        "on this layout.",
    };
  }

  // Ran but fell back to unpdf (LlamaParse unavailable). Loud + honest.
  if (row.ok && engine === "unpdf") {
    return {
      badge: "FB",
      ok: false,
      engine: "unpdf",
      reason: "unpdf_fallback",
      shortReason: "basic-text fallback",
      statement:
        "LlamaParse (vision) did NOT run — the system fell back to basic text " +
        "extraction, which is less reliable. Check the API key and credits. Any " +
        "blanks below may simply be fields the basic reader could not parse.",
    };
  }

  // Hard failure — classify the reason honestly.
  const { reason, phrase } = classifyParseReason(row.error_note);
  return {
    badge: "FB",
    ok: false,
    engine,
    reason,
    shortReason:
      reason === "no_key"
        ? "API key missing"
        : reason === "credits"
        ? "out of credits"
        : reason === "timeout"
        ? "timed out"
        : reason === "network"
        ? "network error"
        : reason === "empty"
        ? "no text found"
        : "parse failed",
    statement:
      `Document AI did not run for this manifest because ${phrase}. ` +
      "Transport fields below were not auto-filled by AI; please enter any missing " +
      "details by hand.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (tsx). Registered in scripts/compliance/run-pure-selftests.ts.
// ─────────────────────────────────────────────────────────────────────────────
export function __runLlamaParseStatusCoreTests(): string {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`llamaparse-status-core: ${msg}`);
    passed++;
  };
  const row = (over: Partial<ParseLedgerRow>): ParseLedgerRow => ({
    created_at: "2026-01-01T00:00:00Z",
    ok: true,
    error_note: null,
    model: "llamaparse-max",
    engine: "llamaparse",
    ...over,
  });

  // Empty → neutral FB, never a false llama.
  {
    const s = deriveParseStatus([]);
    ok(s.badge === "FB" && s.reason === "none" && !s.ok, "empty rows -> FB/none");
  }

  // Vision success → llama.
  {
    const s = deriveParseStatus([row({})]);
    ok(s.badge === "llama" && s.ok && s.engine === "llamaparse" && s.reason === "ok", "vision success -> llama");
  }

  // unpdf fallback (ok but not vision) → FB/unpdf_fallback, loud.
  {
    const s = deriveParseStatus([row({ engine: "unpdf", model: null })]);
    ok(s.badge === "FB" && !s.ok && s.engine === "unpdf" && s.reason === "unpdf_fallback", "unpdf ok -> FB fallback");
    ok(/did NOT run/i.test(s.statement), "unpdf statement is loud");
  }

  // Newest row wins: old success, new failure → FB.
  {
    const s = deriveParseStatus([
      row({ created_at: "2026-01-01T00:00:00Z", ok: true, engine: "llamaparse" }),
      row({ created_at: "2026-02-01T00:00:00Z", ok: false, engine: "llamaparse", error_note: "402 credits exhausted" }),
    ]);
    ok(s.badge === "FB" && s.reason === "credits", "newest row (failure) wins");
  }

  // Reason classification.
  {
    ok(classifyParseReason("LLAMA_CLOUD_API_KEY not set").reason === "no_key", "classify no_key");
    ok(classifyParseReason("402 credits exhausted").reason === "credits", "classify credits");
    ok(classifyParseReason("LlamaParse job timed out").reason === "timeout", "classify timeout");
    ok(classifyParseReason("empty parse").reason === "empty", "classify empty");
    ok(classifyParseReason("fetch failed 503").reason === "network", "classify network");
    ok(classifyParseReason(null).reason === "unknown", "classify null -> unknown");
    ok(classifyParseReason("weird thing").reason === "unknown", "classify unmapped -> unknown");
  }

  // Failure statements are honest and instruct manual entry.
  {
    const s = deriveParseStatus([row({ ok: false, engine: "none", model: null, error_note: "LLAMA_CLOUD_API_KEY not set" })]);
    ok(s.reason === "no_key" && /API key is not set/i.test(s.statement), "no_key statement honest");
    ok(s.shortReason === "API key missing", "no_key short reason");
  }

  // Engine inference from model when engine field absent (old rows).
  {
    const s = deriveParseStatus([row({ engine: null, model: "llamaparse-max" })]);
    ok(s.engine === "llamaparse" && s.badge === "llama", "engine inferred from model");
  }

  return `llamaparse-status-core: ${passed} assertions passed`;
}
