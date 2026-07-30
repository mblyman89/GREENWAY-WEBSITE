/**
 * policy-doc-core — pure, dependency-free logic for the "Legal Policies" editor
 * (Privacy Policy · Terms of Use · Consumer Health Data).
 *
 * A policy body is an ORDERED list of rows, each either a HEADING (rendered as
 * <h2>) or a PARAGRAPH (rendered as <p> with cross-reference links). Today the
 * three bodies live as flat `string[]` arrays in src/content/*.ts and the
 * public pages decide heading-vs-paragraph with the `isPolicyHeading` regex.
 *
 * SLICE 105b makes each body editable element-by-element WITHOUT a migration by
 * storing the whole ordered document as a single JSON string inside ONE
 * content_blocks row per policy (field_type "richdoc"; content_blocks.published_value
 * / draft_value are plain unconstrained text, verified 0005 line 100). This
 * module is the single source of truth for:
 *   - the heading/paragraph rule (was duplicated across the 3 pages),
 *   - converting the legacy string[] into rows (the seed + fallback),
 *   - serialize/parse of the JSON document (safe: bad JSON -> null),
 *   - the registry of the three documents (key, page, label, hero blocks,
 *     and the vetted hardcoded fallback paragraphs).
 *
 * It is imported by BOTH the public pages (fallback + heading rule) and the
 * admin editor, and is exercised by a pure self-test runner.
 */

export type PolicyRowKind = "heading" | "paragraph";

export type PolicyRow = {
  /** Stable within a document; used as React key + drag identity. */
  id: string;
  kind: PolicyRowKind;
  text: string;
};

export type PolicyDocId = "privacy-policy" | "terms-of-use" | "consumer-health-data";

/**
 * The exact heading rule the three public pages used inline. Centralised here so
 * there is ONE definition. A row is a heading when it starts with a roman
 * numeral, a number, or a single lowercase letter followed by a dot and a
 * space (e.g. "I. ...", "1. ...", "a. ..."), OR it is the special
 * "IX. Contact Us" line (kept for byte-for-byte parity with the old pages).
 */
export function isPolicyHeading(text: string): boolean {
  return /^(?:[IVX]+\.|\d+\.|[a-z]\.)\s/.test(text) || text === "IX. Contact Us";
}

/** Deterministic row id from the document key + ordinal (stable across reloads). */
function rowId(docKey: string, index: number): string {
  return `${docKey}-r${String(index).padStart(4, "0")}`;
}

/**
 * Convert the legacy flat paragraph array into editor rows, tagging each row as
 * heading or paragraph via {@link isPolicyHeading}. This produces the seed value
 * AND the render fallback, so an un-edited document is byte-identical to today.
 */
export function rowsFromParagraphs(paragraphs: readonly string[], docKey: string): PolicyRow[] {
  return paragraphs.map((text, i) => ({
    id: rowId(docKey, i),
    kind: isPolicyHeading(text) ? "heading" : "paragraph",
    text,
  }));
}

/** Serialize rows to the JSON string stored in content_blocks (stable shape). */
export function serializePolicyDoc(rows: readonly PolicyRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text })),
  );
}

function isValidKind(v: unknown): v is PolicyRowKind {
  return v === "heading" || v === "paragraph";
}

/**
 * Parse a stored JSON document back into rows. Returns null when the input is
 * missing, not valid JSON, not an array, or contains a malformed row — callers
 * then fall back to the vetted hardcoded paragraphs, so a corrupt value can
 * NEVER blank a legal page.
 */
export function parsePolicyDoc(json: string | null | undefined): PolicyRow[] | null {
  if (json == null) return null;
  const trimmed = json.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const rows: PolicyRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const obj = item as Record<string, unknown>;
    const id = obj.id;
    const kind = obj.kind;
    const text = obj.text;
    if (typeof id !== "string" || !isValidKind(kind) || typeof text !== "string") {
      return null;
    }
    rows.push({ id, kind, text });
  }
  return rows;
}

/**
 * Resolve the rows to render for a policy: prefer a valid stored document,
 * otherwise the vetted hardcoded fallback. Used by the public pages so an
 * un-seeded (or malformed) document renders exactly as it does today.
 */
export function resolvePolicyRows(
  storedJson: string | null | undefined,
  fallbackParagraphs: readonly string[],
  docKey: string,
): PolicyRow[] {
  const parsed = parsePolicyDoc(storedJson);
  if (parsed && parsed.length > 0) return parsed;
  return rowsFromParagraphs(fallbackParagraphs, docKey);
}

/** A fresh row (used by the editor's "Add" button). */
export function makeEmptyRow(docKey: string, kind: PolicyRowKind = "paragraph"): PolicyRow {
  const rand = Math.random().toString(36).slice(2, 8);
  return { id: `${docKey}-new-${rand}`, kind, text: "" };
}

/** Metadata for one editable policy document. */
export type PolicyDocMeta = {
  /** The content_blocks key that stores the JSON body document. */
  docKey: string;
  /** PolicyDocId used by renderPolicyParagraph for correct cross-links. */
  policyId: PolicyDocId;
  /** content_blocks.page value (drives revalidation + editor grouping). */
  page: string;
  /** Public route path. */
  path: string;
  /** Human label + editor tab title. */
  label: string;
  /** Hero-title content blocks edited alongside the body on this tab. */
  heroBlockKeys: string[];
};

/**
 * The three legal documents. `page` values are new (legal-*) so publish
 * revalidates the right route (wired in actions PAGE_TO_PATH). Fallback
 * paragraph arrays are injected by the caller (the pages / seed) to avoid a
 * circular import with src/content/*.ts.
 */
export const POLICY_DOCS: Record<PolicyDocId, PolicyDocMeta> = {
  "privacy-policy": {
    docKey: "privacy.body.doc",
    policyId: "privacy-policy",
    page: "legal-privacy",
    path: "/privacy-policy",
    label: "Privacy Policy",
    heroBlockKeys: ["privacy.hero.title"],
  },
  "terms-of-use": {
    docKey: "terms.body.doc",
    policyId: "terms-of-use",
    page: "legal-terms",
    path: "/terms-of-use",
    label: "Terms of Use",
    heroBlockKeys: ["terms.hero.title"],
  },
  "consumer-health-data": {
    docKey: "chd.body.doc",
    policyId: "consumer-health-data",
    page: "legal-chd",
    path: "/consumer-health-data",
    label: "Consumer Health Data",
    heroBlockKeys: ["chd.hero.title.line1", "chd.hero.title.line2"],
  },
};

export const POLICY_DOC_KEYS: string[] = Object.values(POLICY_DOCS).map((d) => d.docKey);

/** True when a block key is one of the three policy body documents. */
export function isPolicyDocBlock(blockKey: string): boolean {
  return POLICY_DOC_KEYS.includes(blockKey);
}

// ---------------------------------------------------------------------------
// Pure self-tests (run by scripts/compliance/run-pure-selftests.ts).
// Throws on the first failure; returns the assertion count on success.
// ---------------------------------------------------------------------------
export function __runPolicyDocCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`policy-doc-core self-test failed: ${msg}`);
    passed++;
  };

  // isPolicyHeading — the exact rule the pages used.
  ok(isPolicyHeading("I. Information We Collect"), "roman heading");
  ok(isPolicyHeading("1. Information collected via Technology"), "number heading");
  ok(isPolicyHeading("a. Information Regarding Your Consumer Health Data"), "letter heading");
  ok(isPolicyHeading("IX. Contact Us"), "special IX. Contact Us");
  ok(!isPolicyHeading("Effective Date: June 20, 2026"), "plain line is not a heading");
  ok(!isPolicyHeading("We reserve the right to update this Privacy Policy at any time."), "sentence is not a heading");
  ok(!isPolicyHeading("contact@greenwaymarijuana.com"), "email is not a heading");

  // rowsFromParagraphs tags kinds and assigns stable ids.
  const sample = ["Effective Date: June 20, 2026", "I. Information We Collect", "Some body text."];
  const rows = rowsFromParagraphs(sample, "privacy.body.doc");
  ok(rows.length === 3, "rowsFromParagraphs preserves length");
  ok(rows[0].kind === "paragraph", "row 0 paragraph");
  ok(rows[1].kind === "heading", "row 1 heading");
  ok(rows[2].kind === "paragraph", "row 2 paragraph");
  ok(rows[0].id !== rows[1].id && rows[1].id !== rows[2].id, "ids unique");
  ok(rows[0].text === sample[0], "text preserved");

  // serialize -> parse round-trips exactly.
  const json = serializePolicyDoc(rows);
  const back = parsePolicyDoc(json);
  ok(back !== null, "parse of serialized doc is non-null");
  ok(back!.length === rows.length, "round-trip length");
  ok(back![1].kind === "heading" && back![1].text === "I. Information We Collect", "round-trip content");

  // parse rejects bad input safely.
  ok(parsePolicyDoc(null) === null, "null -> null");
  ok(parsePolicyDoc("") === null, "empty -> null");
  ok(parsePolicyDoc("not json") === null, "garbage -> null");
  ok(parsePolicyDoc("{}") === null, "object (not array) -> null");
  ok(parsePolicyDoc('[{"id":"x","kind":"bogus","text":"y"}]') === null, "bad kind -> null");
  ok(parsePolicyDoc('[{"id":"x","text":"y"}]') === null, "missing kind -> null");
  ok(parsePolicyDoc('[{"id":1,"kind":"paragraph","text":"y"}]') === null, "non-string id -> null");
  ok(parsePolicyDoc("[]")!.length === 0, "empty array parses to empty rows");

  // resolvePolicyRows: valid doc wins; else fallback; malformed -> fallback.
  const fb = ["A", "1. B", "C"];
  ok(resolvePolicyRows(json, fb, "privacy.body.doc").length === 3, "valid doc used");
  ok(resolvePolicyRows(null, fb, "privacy.body.doc").length === 3, "null -> fallback rows");
  ok(resolvePolicyRows("garbage", fb, "privacy.body.doc")[1].kind === "heading", "malformed -> fallback (heading detected)");
  ok(resolvePolicyRows("[]", fb, "privacy.body.doc").length === 3, "empty doc -> fallback (never blank a legal page)");

  // registry sanity.
  ok(POLICY_DOC_KEYS.length === 3, "3 policy docs");
  ok(isPolicyDocBlock("privacy.body.doc"), "isPolicyDocBlock true for known");
  ok(!isPolicyDocBlock("home.hero.title"), "isPolicyDocBlock false for other");
  ok(POLICY_DOCS["consumer-health-data"].heroBlockKeys.length === 2, "chd has 2 hero lines");
  ok(POLICY_DOCS["privacy-policy"].page === "legal-privacy", "privacy page key");

  // makeEmptyRow.
  const empty = makeEmptyRow("terms.body.doc", "heading");
  ok(empty.kind === "heading" && empty.text === "", "makeEmptyRow heading blank");

  return { passed };
}
