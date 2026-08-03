/**
 * src/lib/inbound-email/llamaparse-core.ts  (LlamaParse PR-1)
 *
 * PURE, provider-agnostic helpers for the LlamaParse (LlamaCloud) vision-PDF
 * pipeline. NO network, NO env, NO Supabase here — everything in this file is
 * a pure function so it is unit-testable with tsx/vitest and registered in the
 * pure self-test battery.
 *
 * WHY THIS EXISTS (owner Michael's real problem):
 * PDFs arriving in the email intake (invoices + Washington transportation
 * manifests) are frequently SCANNED IMAGES with no text layer. Our current
 * extractor is TEXT-ONLY (unpdf / pdf.js) so it returns an empty string, and
 * the whole robust downstream machinery — the live Invoice # scanner, the
 * transport-donor readers, the vendor gold-miner — is starved of input. The
 * data is printed right there on the page; we just could not read it.
 *
 * LlamaParse is a hosted OCR + vision-LLM document parser. It returns clean
 * Markdown for each page PLUS per-page metadata that can carry a confidence
 * signal. The credits are free (10,000/month, resets monthly) and our volume
 * is tiny (~160-200 pages/month), so PR-2 will ALWAYS use LlamaParse first and
 * keep the old unpdf path only as a silent last resort if LlamaCloud is
 * unreachable (an outage), so the intake never hard-fails.
 *
 * WHAT LIVES HERE (all pure):
 *  - buildParseRequest():   shape the multipart/JSON request body + the exact
 *                           parse options we want (tier, result type, cache).
 *  - normalizeParseResult():collapse LlamaCloud's job-result JSON into a single
 *                           { text, pages[], confidence, ok } shape our
 *                           downstream text-scanners already understand.
 *  - gateConfidence():      NEVER-GUESS gate — decide whether a parse is
 *                           trustworthy enough to feed the auto-fill, or must
 *                           be flagged for human review.
 *  - pickText():            priority text selection (whole doc vs a page).
 *
 * NEVER-GUESS RULES (same spirit as fact-extraction-core):
 *  - we only ever return text that LlamaCloud actually returned; we never
 *    fabricate or infer field values in this layer;
 *  - an empty / whitespace-only parse is reported ok:false so the caller does
 *    NOT false-flag it as a success (Michael's exact worry);
 *  - confidence below the review threshold is surfaced, never hidden.
 *
 * PURE: no I/O — safe to import anywhere, including the pure self-test runner.
 */

/** LlamaParse parse tiers. Credits/page shown for owner cost visibility. */
export type LlamaParseTier =
  | "fast" // 1 credit/page  — digital text, simple layouts
  | "balanced" // 3 credits/page — DEFAULT: scanned images + tables (our case)
  | "agentic" // 10 credits/page
  | "agentic_plus"; // 45 credits/page

/** Map our tier name to the LlamaCloud API `parse_mode` value. */
export function parseModeForTier(tier: LlamaParseTier): string {
  switch (tier) {
    case "fast":
      return "parse_page_without_llm";
    case "agentic":
      return "parse_page_with_agent";
    case "agentic_plus":
      return "parse_document_with_agent";
    case "balanced":
    default:
      return "parse_page_with_llm";
  }
}

/** Rough credits/page for a tier — for the ai_usage ledger note only. */
export function creditsPerPage(tier: LlamaParseTier): number {
  switch (tier) {
    case "fast":
      return 1;
    case "agentic":
      return 10;
    case "agentic_plus":
      return 45;
    case "balanced":
    default:
      return 3;
  }
}

/** Options we expose to callers; everything has a safe default. */
export type BuildParseOptions = {
  /** Parse tier. Default "balanced" (3 cr/pg) — right for scanned manifests. */
  tier?: LlamaParseTier;
  /**
   * Docs are PUBLIC RECORD (Michael) so caching is fine and gives free
   * re-reads within LlamaCloud's 48h window. Set true to force a fresh parse.
   */
  doNotCache?: boolean;
  /** Original filename — helps LlamaCloud pick the right decoder. */
  filename?: string;
  /**
   * Language hint(s). WA manifests are English; leave undefined to auto-detect.
   */
  language?: string;
};

/**
 * The provider-agnostic description of ONE parse request. The server-only
 * provider turns this into an actual multipart POST; keeping it as a plain
 * object here means the shaping logic is unit-testable without any network.
 */
export type ParseRequestPlan = {
  /** Multipart form fields (strings) to send alongside the file. */
  fields: Record<string, string>;
  /** The parse tier that was chosen (echoed for the ledger). */
  tier: LlamaParseTier;
  /** Suggested filename for the multipart part. */
  filename: string;
};

/**
 * Shape a LlamaCloud parse request from our options. Pure — returns the exact
 * form fields the provider will POST. Defaults chosen for Michael's case:
 * balanced tier (handles scanned images) and caching ON (public docs).
 */
export function buildParseRequest(opts: BuildParseOptions = {}): ParseRequestPlan {
  const tier: LlamaParseTier = opts.tier ?? "balanced";
  const fields: Record<string, string> = {
    parse_mode: parseModeForTier(tier),
    // We want Markdown per page; it preserves tables/labels our scanners read.
    result_type: "markdown",
    // Public docs → allow the 48h cache unless the caller opts out.
    do_not_cache: String(Boolean(opts.doNotCache)),
  };
  if (opts.language) fields.language = opts.language;
  return {
    fields,
    tier,
    filename: opts.filename?.trim() || "document.pdf",
  };
}

/** One normalized page of a parse result. */
export type ParsedPage = {
  /** 1-based page number. */
  page: number;
  /** Markdown/plain text for this page (never null; "" if blank). */
  text: string;
  /** 0..1 confidence for this page when LlamaCloud reports it, else null. */
  confidence: number | null;
};

/** The single shape every downstream text-scanner will consume. */
export type NormalizedParse = {
  /** True only when the parse produced real, non-empty text. */
  ok: boolean;
  /** All pages joined with double-newline — what text scanners read. */
  text: string;
  /** Per-page breakdown (order preserved). */
  pages: ParsedPage[];
  /** Overall confidence 0..1 (min across pages that report it) or null. */
  confidence: number | null;
  /** Total pages seen (for the ai_usage credit estimate). */
  pageCount: number;
  /** Non-fatal note (e.g. "no text layer", "empty result"). */
  note: string | null;
};

/** Coerce anything to a trimmed string ("" when nullish). */
function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Coerce a confidence-ish value into 0..1 or null. Never guesses. */
function conf(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // LlamaCloud reports 0..1. Be tolerant of a 0..100 percentage style: only
  // values clearly in the percentage range (> 2) are rescaled; a stray 1..2
  // is a malformed fraction and is simply clamped to 1 (never guessed lower).
  const n = v > 2 ? v / 100 : v;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Collapse a raw LlamaCloud job-result object into our NormalizedParse. Pure.
 * Accepts the two shapes the API has shipped: `{ pages: [{ md|markdown|text,
 * page, confidence|metadata.confidence }] }` and a top-level `{ markdown }`.
 * Anything empty → ok:false with a note, so the caller never false-flags it.
 */
export function normalizeParseResult(raw: unknown): NormalizedParse {
  const root = (raw ?? {}) as Record<string, unknown>;
  const rawPages = Array.isArray(root.pages) ? (root.pages as unknown[]) : [];

  const pages: ParsedPage[] = [];
  if (rawPages.length > 0) {
    rawPages.forEach((p, i) => {
      const po = (p ?? {}) as Record<string, unknown>;
      const text = str(po.md ?? po.markdown ?? po.text ?? po.value);
      const meta = (po.metadata ?? {}) as Record<string, unknown>;
      const c = conf(po.confidence ?? meta.confidence);
      const pageNo =
        typeof po.page === "number" && Number.isFinite(po.page)
          ? (po.page as number)
          : i + 1;
      pages.push({ page: pageNo, text, confidence: c });
    });
  } else {
    // Fallback: a single top-level markdown/text field (older result shape).
    const single = str(root.markdown ?? root.md ?? root.text);
    if (single) pages.push({ page: 1, text: single, confidence: conf(root.confidence) });
  }

  const text = pages
    .map((p) => p.text)
    .filter((t) => t.length > 0)
    .join("\n\n")
    .trim();

  const reported = pages
    .map((p) => p.confidence)
    .filter((c): c is number => c != null);
  const confidence = reported.length > 0 ? Math.min(...reported) : null;

  const ok = text.length > 0;
  const note = ok
    ? null
    : pages.length === 0
      ? "empty result: LlamaCloud returned no pages"
      : "empty result: pages contained no extractable text";

  return {
    ok,
    text,
    pages,
    confidence,
    pageCount: Math.max(pages.length, 0),
    note,
  };
}

/** Result of the never-guess confidence gate. */
export type ConfidenceGate = {
  /** Safe to feed auto-fill without flagging for review. */
  trusted: boolean;
  /** Human-readable reason (always set). */
  reason: string;
};

/**
 * NEVER-GUESS gate. A parse is `trusted` only when it produced real text AND
 * (there is no confidence signal at all — treat text presence as enough) OR
 * (confidence >= threshold). Below-threshold parses are surfaced, not hidden,
 * so PR-2 can still store the data but mark it for human review. Default
 * threshold 0.5 mirrors the "single-source vs verified" spirit elsewhere.
 */
export function gateConfidence(
  parse: Pick<NormalizedParse, "ok" | "confidence">,
  threshold = 0.5,
): ConfidenceGate {
  if (!parse.ok) {
    return { trusted: false, reason: "no extractable text — nothing to trust" };
  }
  if (parse.confidence == null) {
    return {
      trusted: true,
      reason: "text extracted; provider reported no confidence signal",
    };
  }
  if (parse.confidence >= threshold) {
    return {
      trusted: true,
      reason: `confidence ${parse.confidence.toFixed(2)} ≥ ${threshold}`,
    };
  }
  return {
    trusted: false,
    reason: `low confidence ${parse.confidence.toFixed(2)} < ${threshold} — flag for review`,
  };
}

/**
 * Priority text selection. Callers usually want the whole document's text for
 * the existing scanners; pass a 1-based page to get just that page. Returns ""
 * (never null) so it drops straight into the text-based readers.
 */
export function pickText(parse: NormalizedParse, page?: number): string {
  if (page != null) {
    const hit = parse.pages.find((p) => p.page === page);
    return hit?.text ?? "";
  }
  return parse.text;
}

/**
 * Estimate credits consumed for the ai_usage ledger note. Pure arithmetic:
 * pageCount × creditsPerPage(tier). Free tier is 10,000/month so this is for
 * visibility only, never a hard limit here.
 */
export function estimateCredits(pageCount: number, tier: LlamaParseTier): number {
  return Math.max(0, pageCount) * creditsPerPage(tier);
}

/* ------------------------------------------------------------------------- *
 * PURE SELF-TESTS
 * ------------------------------------------------------------------------- */

export function __runLlamaparseCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL: llamaparse-core", msg);
    }
  };

  // --- parseModeForTier / creditsPerPage ---
  ok(parseModeForTier("fast") === "parse_page_without_llm", "fast mode");
  ok(parseModeForTier("balanced") === "parse_page_with_llm", "balanced mode (default)");
  ok(parseModeForTier("agentic") === "parse_page_with_agent", "agentic mode");
  ok(parseModeForTier("agentic_plus") === "parse_document_with_agent", "agentic+ mode");
  ok(creditsPerPage("fast") === 1, "fast = 1 credit/pg");
  ok(creditsPerPage("balanced") === 3, "balanced = 3 credits/pg");
  ok(creditsPerPage("agentic") === 10, "agentic = 10 credits/pg");
  ok(creditsPerPage("agentic_plus") === 45, "agentic+ = 45 credits/pg");

  // --- buildParseRequest defaults ---
  const req = buildParseRequest();
  ok(req.tier === "balanced", "default tier is balanced");
  ok(req.fields.parse_mode === "parse_page_with_llm", "default parse_mode");
  ok(req.fields.result_type === "markdown", "result_type markdown");
  ok(req.fields.do_not_cache === "false", "caching ON by default (public docs)");
  ok(req.filename === "document.pdf", "default filename");
  ok(!("language" in req.fields), "no language field unless provided");

  const req2 = buildParseRequest({
    tier: "fast",
    doNotCache: true,
    filename: " manifest.pdf ",
    language: "en",
  });
  ok(req2.tier === "fast", "explicit tier respected");
  ok(req2.fields.parse_mode === "parse_page_without_llm", "fast parse_mode");
  ok(req2.fields.do_not_cache === "true", "doNotCache honored");
  ok(req2.filename === "manifest.pdf", "filename trimmed");
  ok(req2.fields.language === "en", "language passed through");

  // --- normalizeParseResult: pages shape ---
  const n1 = normalizeParseResult({
    pages: [
      { page: 1, md: "Invoice #: 0000016167", confidence: 0.98 },
      { page: 2, markdown: "Driver Name: Jane Q", metadata: { confidence: 0.7 } },
    ],
  });
  ok(n1.ok === true, "pages with text -> ok");
  ok(n1.pageCount === 2, "page count = 2");
  ok(n1.text.includes("0000016167") && n1.text.includes("Jane Q"), "joined text");
  ok(n1.confidence === 0.7, "overall confidence = min of reported");
  ok(n1.pages[0].confidence === 0.98, "page1 conf preserved");
  ok(n1.pages[1].confidence === 0.7, "page2 conf from metadata");
  ok(n1.note === null, "no note on success");

  // --- normalizeParseResult: top-level markdown fallback ---
  const n2 = normalizeParseResult({ markdown: "Order # 12345", confidence: 0.9 });
  ok(n2.ok === true && n2.pageCount === 1, "top-level markdown -> single page");
  ok(n2.confidence === 0.9, "top-level confidence");

  // --- normalizeParseResult: empty -> ok:false with note (Michael's worry) ---
  const n3 = normalizeParseResult({ pages: [] });
  ok(n3.ok === false, "no pages -> not ok");
  ok(n3.note != null && n3.note.includes("no pages"), "empty pages note");
  const n4 = normalizeParseResult({ pages: [{ page: 1, md: "   " }] });
  ok(n4.ok === false, "whitespace-only -> not ok (no false success)");
  ok(n4.note != null && n4.note.includes("no extractable"), "whitespace note");
  const n5 = normalizeParseResult(null);
  ok(n5.ok === false && n5.pageCount === 0, "null raw -> not ok, 0 pages");

  // --- confidence coercion (0..100 tolerance, clamping) ---
  const n6 = normalizeParseResult({ pages: [{ page: 1, md: "x", confidence: 87 }] });
  ok(n6.confidence === 0.87, "0..100 confidence rescaled to 0..1");
  const n7 = normalizeParseResult({ pages: [{ page: 1, md: "x", confidence: 1.5 }] });
  ok(n7.confidence === 1, "confidence clamped to 1");

  // --- gateConfidence ---
  ok(gateConfidence({ ok: false, confidence: null }).trusted === false, "not ok -> not trusted");
  ok(
    gateConfidence({ ok: true, confidence: null }).trusted === true,
    "ok + no signal -> trusted on text presence",
  );
  ok(
    gateConfidence({ ok: true, confidence: 0.8 }).trusted === true,
    "high confidence -> trusted",
  );
  ok(
    gateConfidence({ ok: true, confidence: 0.3 }).trusted === false,
    "low confidence -> not trusted (flag for review)",
  );
  ok(
    gateConfidence({ ok: true, confidence: 0.6 }, 0.7).trusted === false,
    "custom threshold respected",
  );

  // --- pickText ---
  ok(pickText(n1) === n1.text, "pickText no page -> whole doc");
  ok(pickText(n1, 2).includes("Jane Q"), "pickText page 2");
  ok(pickText(n1, 99) === "", "pickText missing page -> empty string, never null");

  // --- estimateCredits ---
  ok(estimateCredits(4, "balanced") === 12, "4 pages balanced = 12 credits");
  ok(estimateCredits(3, "fast") === 3, "3 pages fast = 3 credits");
  ok(estimateCredits(0, "agentic") === 0, "0 pages -> 0 credits");

  console.log(`llamaparse-core self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
