/**
 * src/lib/ai/grounding-core.ts  (S06 — structured, cited lookup)
 *
 * PURE extractors for the grounding metadata a live web-search reply carries,
 * beyond the flat source-URL list provider.ts already returned:
 *
 *   1. CITATIONS with their cited span. Both providers attach
 *      `{ type: "url_citation", url, title?, start_index, end_index }`
 *      annotations to a TEXT BLOCK:
 *        - Gemini Interactions API: steps[type="model_output"].content[type="text"]
 *          (https://ai.google.dev/gemini-api/docs/google-search — "Each
 *          url_citation annotation links a text segment (defined by start_index
 *          and end_index) to a source URL"; Google's own sample slices
 *          `text[start_index:end_index]` from the SAME block).
 *        - OpenAI Responses API: output[].content[type="output_text"].
 *      Offsets are relative to their own block, so we slice the cited text out
 *      of that block HERE and hand callers the text itself (`citedText`). The
 *      lookup core then locates that text inside the model's JSON. This does
 *      not depend on how blocks were joined or trimmed. An out-of-range span
 *      is kept without `citedText`, so it becomes a record-level citation.
 *      It is never guessed onto a field.
 *
 *   2. GOOGLE SEARCH SUGGESTIONS. The Gemini Interactions API returns
 *      `steps[type="google_search_result"].result[].search_suggestions`, which
 *      is an HTML+CSS snippet. The Gemini API Terms ("Grounding with Google
 *      Search" > Use Restrictions) say you "will only display the Grounded
 *      Results with the associated Search Suggestion(s) to the end user who
 *      submitted the prompt". So the UI must render them next to the result.
 *      We return them exactly as Google sent them, and nothing here stores them.
 *
 * No imports, no I/O. Registered in the pure self-test runner.
 */

/** One url_citation annotation, with the text it cites when resolvable. */
export type WebCitation = {
  url: string;
  title?: string;
  /** The exact cited text sliced from its own block, when the span is valid. */
  citedText?: string;
};

/** Cap so a pathological payload can never balloon the action response. */
export const MAX_CITATIONS = 200;
/** Google's widget is small; anything larger than this is not a widget. */
export const MAX_SUGGESTION_HTML_CHARS = 20_000;
/** At most this many suggestion widgets are rendered per lookup. The ToS
 *  mentions "up to a maximum of 5 Search Suggestions" for refined results. */
export const MAX_SUGGESTION_WIDGETS = 5;

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Read the annotations of ONE text block into citations (block-relative). */
function citationsFromBlock(block: Record<string, unknown>, out: WebCitation[]): void {
  const text = typeof block.text === "string" ? block.text : "";
  const anns = block.annotations;
  if (!Array.isArray(anns)) return;
  for (const a of anns) {
    if (out.length >= MAX_CITATIONS) return;
    if (!isObj(a)) continue;
    if (a.type !== "url_citation") continue;
    const url = typeof a.url === "string" ? a.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const c: WebCitation = { url };
    if (typeof a.title === "string" && a.title.trim()) c.title = a.title.trim();
    const s = a.start_index;
    const e = a.end_index;
    if (
      typeof s === "number" &&
      typeof e === "number" &&
      Number.isInteger(s) &&
      Number.isInteger(e) &&
      s >= 0 &&
      e > s &&
      e <= text.length
    ) {
      const cited = text.slice(s, e);
      if (cited.trim()) c.citedText = cited;
    }
    out.push(c);
  }
}

/**
 * Citations from a Gemini Interactions payload (model_output text blocks) OR
 * an OpenAI Responses payload (output[].content[] output_text parts). Order is
 * preserved. The same URL may appear several times, once per cited span.
 */
export function extractCitations(payload: unknown): WebCitation[] {
  const out: WebCitation[] = [];
  if (!isObj(payload)) return out;
  // Gemini Interactions.
  if (Array.isArray(payload.steps)) {
    for (const step of payload.steps) {
      if (!isObj(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
      for (const block of step.content) {
        if (isObj(block) && block.type === "text") citationsFromBlock(block, out);
      }
    }
  }
  // OpenAI Responses.
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (!isObj(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (isObj(part) && (part.type === "output_text" || part.type === "text")) {
          citationsFromBlock(part, out);
        }
      }
    }
  }
  return out;
}

/**
 * Google Search Suggestions HTML widgets from a Gemini Interactions payload.
 * Returns [] for OpenAI payloads, which do not carry them. Deduplicated and
 * capped. Never modified: the ToS requires displaying what Google sent.
 */
export function extractSearchSuggestions(payload: unknown): string[] {
  const out: string[] = [];
  if (!isObj(payload) || !Array.isArray(payload.steps)) return out;
  for (const step of payload.steps) {
    if (!isObj(step) || step.type !== "google_search_result" || !Array.isArray(step.result)) continue;
    for (const r of step.result) {
      if (!isObj(r)) continue;
      const html = typeof r.search_suggestions === "string" ? r.search_suggestions : "";
      if (!html.trim() || html.length > MAX_SUGGESTION_HTML_CHARS) continue;
      if (out.includes(html)) continue;
      out.push(html);
      if (out.length >= MAX_SUGGESTION_WIDGETS) return out;
    }
  }
  return out;
}

/**
 * Wrap one suggestions widget for a sandboxed <iframe srcdoc>. A
 * `<base target="_blank">` makes every link open a NEW tab. The admin page is
 * never navigated away, and Google's destination page is shown in full, as
 * the ToS requires ("will not ... redirect end users away from the destination
 * pages"). The widget markup itself is unchanged.
 */
export function suggestionSrcDoc(html: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
    "<style>html,body{margin:0;padding:0;background:transparent}</style></head><body>" +
    html +
    "</body></html>"
  );
}

// ─── Self-tests ─────────────────────────────────────────────────────────────

export function __runGroundingCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL grounding-core: " + msg);
    passed += 1;
  };

  // The documented Gemini example (ai.google.dev google-search page).
  const text =
    "Spain won Euro 2024, defeating England 2-1 in the final. This victory marks Spain's record fourth European Championship title.";
  const gemini = {
    steps: [
      { type: "google_search_call", arguments: { queries: ["UEFA Euro 2024 winner"] } },
      { type: "google_search_result", call_id: "s1", result: [{ search_suggestions: "<div>chip</div>" }] },
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text,
            annotations: [
              { type: "url_citation", url: "https://www.aljazeera.com/x", title: "aljazeera.com", start_index: 0, end_index: 56 },
              { type: "url_citation", url: "https://www.uefa.com/y", title: "uefa.com", start_index: 57, end_index: 124 },
            ],
          },
        ],
      },
    ],
  };
  const c = extractCitations(gemini);
  ok(c.length === 2, "two gemini citations");
  ok(c[0].citedText === "Spain won Euro 2024, defeating England 2-1 in the final.", "span 0..56 sliced from its block");
  ok(c[1].citedText === text.slice(57, 124), "span 57..124 sliced");
  ok(c[0].title === "aljazeera.com" && c[0].url === "https://www.aljazeera.com/x", "url + title kept");

  // Out-of-range / inverted / non-integer spans keep the URL but no citedText.
  const bad = extractCitations({
    steps: [
      {
        type: "model_output",
        content: [
          {
            type: "text",
            text: "abc",
            annotations: [
              { type: "url_citation", url: "https://a.example/1", start_index: 0, end_index: 99 },
              { type: "url_citation", url: "https://a.example/2", start_index: 2, end_index: 1 },
              { type: "url_citation", url: "https://a.example/3", start_index: 0.5, end_index: 2 },
              { type: "url_citation", url: "https://a.example/4", start_index: 0, end_index: 3 },
            ],
          },
        ],
      },
    ],
  });
  ok(bad.length === 4, "all four urls kept");
  ok(bad[0].citedText === undefined && bad[1].citedText === undefined && bad[2].citedText === undefined, "bad spans -> record-level (no citedText)");
  ok(bad[3].citedText === "abc", "exact full-block span is valid (end == length)");

  // Non-http URLs, non-citation annotations, non-text blocks ignored.
  const junk = extractCitations({
    steps: [
      { type: "thought", summary: [{ type: "text", text: "x", annotations: [{ type: "url_citation", url: "https://t.example" }] }] },
      {
        type: "model_output",
        content: [
          { type: "image", annotations: [{ type: "url_citation", url: "https://i.example" }] },
          { type: "text", text: "t", annotations: [{ type: "url_citation", url: "javascript:alert(1)" }, { type: "file_citation", url: "https://f.example" }] },
        ],
      },
    ],
  });
  ok(junk.length === 0, "thought steps, image blocks, js: urls, non-url_citation all ignored");

  // OpenAI Responses shape.
  const oa = extractCitations({
    output: [
      { type: "web_search_call" },
      {
        type: "message",
        content: [
          { type: "output_text", text: "Hello world", annotations: [{ type: "url_citation", url: "https://o.example", title: "O", start_index: 6, end_index: 11 }] },
        ],
      },
    ],
  });
  ok(oa.length === 1 && oa[0].citedText === "world", "openai output_text annotations sliced");

  ok(extractCitations(null).length === 0 && extractCitations("x").length === 0 && extractCitations([]).length === 0, "non-object payloads -> []");

  // Cap.
  const many = Array.from({ length: MAX_CITATIONS + 50 }, (_, i) => ({ type: "url_citation", url: `https://m.example/${i}` }));
  ok(
    extractCitations({ steps: [{ type: "model_output", content: [{ type: "text", text: "", annotations: many }] }] }).length === MAX_CITATIONS,
    "citations capped",
  );

  // Search suggestions.
  ok(JSON.stringify(extractSearchSuggestions(gemini)) === JSON.stringify(["<div>chip</div>"]), "suggestion html extracted verbatim");
  ok(
    extractSearchSuggestions({
      steps: [
        { type: "google_search_result", result: [{ search_suggestions: "<a>1</a>" }, { search_suggestions: "<a>1</a>" }, { search_suggestions: "  " }] },
        { type: "google_search_result", result: [{ search_suggestions: "<a>2</a>" }, { other: 1 }] },
        { type: "model_output", result: [{ search_suggestions: "<a>no</a>" }] },
      ],
    }).join("|") === "<a>1</a>|<a>2</a>",
    "deduped, blanks + non-result steps skipped",
  );
  ok(
    extractSearchSuggestions({ steps: [{ type: "google_search_result", result: [{ search_suggestions: "x".repeat(MAX_SUGGESTION_HTML_CHARS + 1) }] }] }).length === 0,
    "oversize html rejected",
  );
  ok(
    extractSearchSuggestions({
      steps: [{ type: "google_search_result", result: Array.from({ length: 9 }, (_, i) => ({ search_suggestions: `<b>${i}</b>` })) }],
    }).length === MAX_SUGGESTION_WIDGETS,
    "widgets capped at 5",
  );
  ok(extractSearchSuggestions({ output: [] }).length === 0, "openai payload has no suggestions");

  const doc = suggestionSrcDoc("<div>w</div>");
  ok(doc.includes('<base target="_blank">') && doc.includes("<div>w</div>"), "srcdoc opens links in a new tab, markup verbatim");
  ok(!/<script/i.test(doc), "wrapper adds no script");

  return { passed, failed: 0 };
}
