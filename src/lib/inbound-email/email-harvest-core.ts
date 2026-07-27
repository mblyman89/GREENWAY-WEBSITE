/**
 * src/lib/inbound-email/email-harvest-core.ts  (SLICE 69)
 *
 * The "leave no stone unturned" harvest brain for vendor intake emails. PURE
 * (no I/O) so every rule is unit-testable. Three jobs:
 *
 *  1) KEYWORDS + LINK HARVEST — one canonical keyword list per document role
 *     (manifest / invoice / COA), and a harvester that walks EVERY anchor and
 *     EVERY plaintext URL in the body and role-tags each candidate. This is
 *     the full census of what the email OFFERS, independent of what the
 *     first-pass fetch already grabbed.
 *
 *  2) CHECKLIST — assessEmailDocs answers, from what was actually fetched:
 *     did I get the transfer JSON? the manifest PDF? the invoice PDF? the
 *     COA? the body text? checklistNote turns that into the human-readable
 *     validation trail the owner asked for ("did it get everything, with
 *     checks to ensure it did").
 *
 *  3) SECOND PASS ("try harder") — planSecondPassFetches compares the
 *     checklist against the harvested link census and plans a fetch for every
 *     STILL-MISSING role that has any candidate link, plus every unclaimed
 *     PDF link (fetched under its own name, role "other" — bring everything
 *     back, but NEVER mislabel a document we can't identify).
 *
 * Safety: a harvested link still has to actually fetch, magic-byte-validate
 * as a PDF (fetchPdfBytes) or JSON.parse + pass the strict WCIA gate before
 * anything downstream uses it — a false-positive keyword costs one HTTP GET,
 * never a junk manifest. DRAFTS-ONLY as always: nothing here activates stock.
 */
import {
  classifyAttachmentRole,
  isPdfAttachment,
  type NormalizedAttachment,
} from "@/lib/inbound-email/inbound-normalize-core";
import { pathLooksTransferData } from "@/lib/inbound-email/resend-receiving-core";

/** What a document in a vendor intake email can BE. */
export type DocRole = "manifest" | "invoice" | "coa" | "transfer-json" | "other";

/**
 * The canonical keyword list per role — the words the fetcher looks for in
 * anchor text, surrounding context, plaintext lines, and URL paths. Owner
 * directive: this is the fetcher's search vocabulary, kept in ONE place so
 * tests can pin it and future vendors only need a keyword added here.
 */
export const HARVEST_KEYWORDS: Record<"manifest" | "invoice" | "coa", readonly string[]> = {
  manifest: ["manifest", "shipping document", "transfer log", "transportation", "chain of custody"],
  invoice: ["invoice", "billing", "bill of sale", "statement"],
  coa: ["certificate of analysis", "lab results", "lab result", "test results", "test result", "coa", "qa report"],
};

/** One role-tagged link candidate found in the email body. */
export type HarvestedLink = {
  url: string;
  role: DocRole;
};

const ANY_URL_RE = /https?:\/\/[^\s<>"']+/gi;

function stripTrailingPunct(u: string): string {
  return u.replace(/[.,;:)\]}>'"]+$/, "");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").trim();
}

/**
 * Block boundaries that end a "segment" of context. Without this, the
 * context window bleeds across paragraphs and an anchor inherits keywords
 * from the PREVIOUS sentence (e.g. the invoice link tagged "manifest"
 * because "...download the manifest.</p>" sat just before it).
 */
const BLOCK_BOUNDARY_RE = /<\/?(?:p|br|li|div|td|tr|table|ul|ol|h[1-6])\b[^>]*>|\r?\n/gi;

/** Keep only the text AFTER the last block boundary in a before-window. */
function segmentBefore(raw: string): string {
  let lastEnd = 0;
  BLOCK_BOUNDARY_RE.lastIndex = 0;
  let b: RegExpExecArray | null;
  while ((b = BLOCK_BOUNDARY_RE.exec(raw)) !== null) lastEnd = b.index + b[0].length;
  return stripTags(raw.slice(lastEnd));
}

/** Keep only the text BEFORE the first block boundary in an after-window. */
function segmentAfter(raw: string): string {
  BLOCK_BOUNDARY_RE.lastIndex = 0;
  const b = BLOCK_BOUNDARY_RE.exec(raw);
  return stripTags(b ? raw.slice(0, b.index) : raw);
}

/** Is this URL the WCIA transfer DATA (JSON), not a downloadable document? */
function isTransferDataUrl(url: string): boolean {
  const clean = stripTrailingPunct(url);
  if (/\.json(?:\?|$)/i.test(clean)) return true;
  if (/\/(?:wa\/)?wcia\/transfer\?/i.test(clean)) return true;
  return pathLooksTransferData(clean);
}

/** Role-tag a snippet of text (anchor text / context / line / URL path). */
function roleFromText(s: string): "manifest" | "invoice" | "coa" | null {
  const t = s.toLowerCase();
  // COA first: its phrases are the most specific ("certificate of analysis",
  // "lab results") and "coa" can ride inside longer manifest sentences.
  for (const kw of HARVEST_KEYWORDS.coa) if (t.includes(kw)) return "coa";
  for (const kw of HARVEST_KEYWORDS.manifest) if (t.includes(kw)) return "manifest";
  for (const kw of HARVEST_KEYWORDS.invoice) if (t.includes(kw)) return "invoice";
  return null;
}

/**
 * Walk EVERY anchor and EVERY plaintext URL in the body and role-tag each one.
 * Returns the full census, order-preserved and de-duplicated by URL:
 *  - anchors: role from the anchor text or its ±80-char context;
 *  - plaintext: role from the line the URL sits on;
 *  - any remaining `.pdf` URL: role from its own path, else "other";
 *  - transfer-data URLs (JSON / WCIA endpoints) are tagged "transfer-json"
 *    and never offered as document candidates (they're data, not PDFs).
 * PURE.
 */
export function harvestDocLinks(
  html: string | null | undefined,
  text: string | null | undefined,
): HarvestedLink[] {
  const htmlStr = typeof html === "string" ? html : "";
  const textStr = typeof text === "string" ? text : "";
  const seen = new Set<string>();
  const out: HarvestedLink[] = [];

  const push = (rawUrl: string, role: DocRole) => {
    const url = stripTrailingPunct(rawUrl);
    if (!/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, role: isTransferDataUrl(url) ? "transfer-json" : role });
  };

  // 1) HTML anchors with a context window on both sides.
  const anchorRe = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(htmlStr)) !== null) {
    const href = m[1];
    const inner = stripTags(m[2]);
    // Context stops at block boundaries so an anchor never inherits a
    // keyword from the previous/next paragraph.
    const before = segmentBefore(htmlStr.slice(Math.max(0, m.index - 80), m.index));
    const after = segmentAfter(
      htmlStr.slice(m.index + m[0].length, m.index + m[0].length + 80),
    );
    const role =
      roleFromText(inner) ?? roleFromText(before) ?? roleFromText(after) ?? null;
    if (role) push(href, role);
  }

  // 2) Plaintext lines: a URL on a line that mentions a keyword.
  for (const line of textStr.split(/\r?\n/)) {
    const role = roleFromText(line);
    if (!role) continue;
    for (const url of line.match(ANY_URL_RE) ?? []) push(url, role);
  }

  // 3) Sweep for anything left: every URL in the combined body. `.pdf` URLs
  //    get a role from their own path (else "other"); non-PDF URLs are only
  //    kept when their path names a role (a bare tracking link is noise).
  const combined = `${htmlStr}\n${textStr}`;
  for (const raw of combined.match(ANY_URL_RE) ?? []) {
    const url = stripTrailingPunct(raw);
    if (seen.has(url)) continue;
    if (isTransferDataUrl(url)) {
      push(url, "transfer-json");
      continue;
    }
    let path = "";
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      continue;
    }
    const pathRole = roleFromText(path);
    if (/\.pdf(?:\?|$)/i.test(url) || path.endsWith(".pdf")) {
      push(url, pathRole ?? "other");
    } else if (pathRole) {
      push(url, pathRole);
    }
  }

  return out;
}

/** The fetch checklist: what the email actually YIELDED after fetching. */
export type EmailDocsChecklist = {
  transferJson: boolean;
  manifestPdf: boolean;
  invoicePdf: boolean;
  coa: boolean;
  bodyText: boolean;
  /** The human-readable names of the document roles still missing. */
  missing: string[];
};

/**
 * Assess what was actually fetched (attachments carry real bytes/text by the
 * time this runs). This is the "did I get everything" gate. PURE.
 */
export function assessEmailDocs(
  attachments: readonly NormalizedAttachment[],
  bodyText: string | null | undefined,
): EmailDocsChecklist {
  const transferJson = attachments.some(
    (a) =>
      a.text != null &&
      ((a.contentType ?? "").toLowerCase().includes("json") ||
        (a.filename ?? "").toLowerCase().endsWith(".json")),
  );
  const havePdfRole = (role: "manifest" | "invoice" | "coa"): boolean =>
    attachments.some(
      (a) => isPdfAttachment(a) && !!a.base64 && classifyAttachmentRole(a) === role,
    );
  const manifestPdf = havePdfRole("manifest");
  const invoicePdf = havePdfRole("invoice");
  const coa = havePdfRole("coa");
  const body = typeof bodyText === "string" && bodyText.trim().length > 0;

  const missing: string[] = [];
  if (!transferJson) missing.push("transfer JSON");
  if (!manifestPdf) missing.push("manifest PDF");
  if (!invoicePdf) missing.push("invoice PDF");
  if (!coa) missing.push("COA");

  return { transferJson, manifestPdf, invoicePdf, coa, bodyText: body, missing };
}

/**
 * The validation trail written to the inbound email log: every checklist item
 * with a pass/fail mark, and an explicit "not offered anywhere in this email"
 * statement for whatever is genuinely absent after BOTH passes. PURE.
 */
export function checklistNote(c: EmailDocsChecklist): string {
  const mark = (ok: boolean) => (ok ? "OK" : "MISSING");
  const parts = [
    `transfer JSON ${mark(c.transferJson)}`,
    `manifest PDF ${mark(c.manifestPdf)}`,
    `invoice PDF ${mark(c.invoicePdf)}`,
    `COA ${mark(c.coa)}`,
    `body text ${mark(c.bodyText)}`,
  ];
  const missingSuffix =
    c.missing.length > 0
      ? ` — still missing after full harvest: ${c.missing.join(", ")} (no attachment or working link offered this in the email)`
      : " — everything found";
  return `harvest checklist: ${parts.join(", ")}${missingSuffix}`;
}

/** One planned second-pass fetch. */
export type SecondPassFetch = {
  role: DocRole;
  url: string;
  /**
   * Filename to store the bytes under. Role-classifying ("manifest.pdf") when
   * we KNOW the role; null means "keep the URL's own filename" (role "other" —
   * we bring it back but never mislabel it).
   */
  filename: string | null;
};

/** Guard: never fan out on a link-farm email. */
export const MAX_SECOND_PASS_FETCHES = 8;

/**
 * The "try harder" planner. Compares the checklist (what we HAVE) against the
 * harvested census (what the email OFFERS) and plans:
 *  - for each still-missing role, EVERY candidate link of that role, in order
 *    (the fetcher tries them until one succeeds — that's the retry the owner
 *    asked for);
 *  - every unclaimed "other" PDF link (fetched under its own name — bring
 *    everything back for the archive + transport mining, never mislabeled).
 * Hard-capped at MAX_SECOND_PASS_FETCHES. PURE.
 */
export function planSecondPassFetches(
  checklist: EmailDocsChecklist,
  harvested: readonly HarvestedLink[],
  alreadyTriedUrls: readonly string[],
): SecondPassFetch[] {
  const tried = new Set(alreadyTriedUrls.map(stripTrailingPunct));
  const plan: SecondPassFetch[] = [];

  const wantRole = (
    role: "manifest" | "invoice" | "coa",
    have: boolean,
    filename: string,
  ) => {
    if (have) return;
    for (const h of harvested) {
      if (h.role !== role) continue;
      if (tried.has(h.url)) continue;
      tried.add(h.url);
      plan.push({ role, url: h.url, filename });
    }
  };

  wantRole("manifest", checklist.manifestPdf, "manifest.pdf");
  wantRole("invoice", checklist.invoicePdf, "invoice.pdf");
  wantRole("coa", checklist.coa, "coa.pdf");

  // Unclaimed "other" PDFs: fetch under their own names (role stays "other").
  for (const h of harvested) {
    if (h.role !== "other") continue;
    if (tried.has(h.url)) continue;
    tried.add(h.url);
    plan.push({ role: "other", url: h.url, filename: null });
  }

  return plan.slice(0, MAX_SECOND_PASS_FETCHES);
}

/**
 * Drop byte-identical duplicate attachments (same base64, or same text when
 * no bytes) so a document that arrived BOTH as a MIME attachment and via a
 * link fetch is stored and parsed once. First occurrence wins (MIME
 * attachments are pushed before link fetches). PURE.
 */
export function dedupeAttachments(
  attachments: readonly NormalizedAttachment[],
): NormalizedAttachment[] {
  const seen = new Set<string>();
  const out: NormalizedAttachment[] = [];
  for (const a of attachments) {
    const key = a.base64 ? `b:${a.base64}` : a.text != null ? `t:${a.text}` : null;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests — run via scripts/compliance/run-pure-selftests.ts + vitest.
// ---------------------------------------------------------------------------
export function __runEmailHarvestTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL: ${msg}`);
    }
  };

  const att = (
    filename: string,
    contentType: string | null,
    text: string | null,
    base64: string | null,
  ): NormalizedAttachment => ({ filename, contentType, text, base64 });

  // ── harvestDocLinks ────────────────────────────────────────────────────────
  const html = [
    `<p>Please find your delivery documents below.</p>`,
    `<p>Click <a href="https://vendor.example.com/dl/abc123">here</a> to download the manifest.</p>`,
    `<p>Click <a href="https://vendor.example.com/dl/def456">here</a> to download the invoice.</p>`,
    `<p><a href="https://labs.example.com/certs/x9.pdf">Certificate of Analysis</a></p>`,
    `<p>WCIA Transfer Data Link: <a href="https://api.cultivera.com/transfers/t1.json">JSON</a></p>`,
    `<p><a href="https://vendor.example.com/files/extra-notes.pdf">extra-notes.pdf</a></p>`,
  ].join("\n");
  const links = harvestDocLinks(html, "");
  ok(
    links.some((l) => l.url.endsWith("/dl/abc123") && l.role === "manifest"),
    "anchor context tags the manifest link",
  );
  ok(
    links.some((l) => l.url.endsWith("/dl/def456") && l.role === "invoice"),
    "anchor context tags the invoice link",
  );
  ok(
    links.some((l) => l.url.endsWith("/certs/x9.pdf") && l.role === "coa"),
    "anchor text tags the COA link",
  );
  ok(
    links.some((l) => l.url.endsWith("/t1.json") && l.role === "transfer-json"),
    "transfer JSON is tagged transfer-json, never a document candidate",
  );
  ok(
    links.some((l) => l.url.endsWith("/extra-notes.pdf") && l.role === "other"),
    "an unclaimed .pdf link is swept up as role other",
  );

  const textOnly = "Your lab results: https://labs.example.com/r/77\nTracking: https://track.example.com/z";
  const tLinks = harvestDocLinks("", textOnly);
  ok(
    tLinks.some((l) => l.url.endsWith("/r/77") && l.role === "coa"),
    "plaintext line keyword tags the COA link",
  );
  ok(
    !tLinks.some((l) => l.url.endsWith("/z")),
    "a bare tracking link with no keyword and no .pdf is ignored",
  );

  // De-dupe: same URL as anchor and plaintext appears once.
  const dupLinks = harvestDocLinks(
    `<a href="https://v.example.com/m.pdf">manifest</a>`,
    "manifest: https://v.example.com/m.pdf",
  );
  ok(
    dupLinks.filter((l) => l.url === "https://v.example.com/m.pdf").length === 1,
    "duplicate URLs harvest once",
  );

  // ── assessEmailDocs + checklistNote ───────────────────────────────────────
  const full = [
    att("transfer.json", "application/json", "{}", "e30="),
    att("Manifest_123.pdf", "application/pdf", null, "JVBERi0="),
    att("Invoice_123.pdf", "application/pdf", null, "JVBERi0="),
    att("COA_Summary.pdf", "application/pdf", null, "JVBERi0="),
  ];
  const cFull = assessEmailDocs(full, "body");
  ok(
    cFull.transferJson && cFull.manifestPdf && cFull.invoicePdf && cFull.coa && cFull.bodyText,
    "full bundle: every checklist item true",
  );
  ok(cFull.missing.length === 0, "full bundle: nothing missing");
  ok(checklistNote(cFull).includes("everything found"), "full bundle note says everything found");

  const partial = [att("transfer.json", "application/json", "{}", "e30=")];
  const cPartial = assessEmailDocs(partial, null);
  ok(
    !cPartial.manifestPdf && !cPartial.invoicePdf && !cPartial.coa && !cPartial.bodyText,
    "JSON-only email: PDFs and body text are missing",
  );
  ok(
    cPartial.missing.join(",") === "manifest PDF,invoice PDF,COA",
    "missing list names exactly the absent documents",
  );
  const note = checklistNote(cPartial);
  ok(note.includes("transfer JSON OK"), "note marks the JSON as fetched");
  ok(
    note.includes("manifest PDF MISSING") && note.includes("still missing after full harvest"),
    "note calls out what is still missing",
  );

  // ── planSecondPassFetches ─────────────────────────────────────────────────
  const harvested: HarvestedLink[] = [
    { url: "https://v.example.com/manifest-a", role: "manifest" },
    { url: "https://v.example.com/manifest-b", role: "manifest" },
    { url: "https://v.example.com/inv", role: "invoice" },
    { url: "https://v.example.com/extra.pdf", role: "other" },
    { url: "https://api.cultivera.com/t1.json", role: "transfer-json" },
  ];
  const plan = planSecondPassFetches(cPartial, harvested, ["https://v.example.com/inv"]);
  ok(
    plan.filter((p) => p.role === "manifest").length === 2,
    "EVERY manifest candidate is planned (try harder: fall through to the next on failure)",
  );
  ok(
    plan.every((p) => p.url !== "https://v.example.com/inv"),
    "an already-tried URL is never re-planned",
  );
  ok(
    plan.some((p) => p.role === "other" && p.filename === null),
    "unclaimed other PDFs are planned under their own filename",
  );
  ok(
    plan.every((p) => p.role !== "transfer-json"),
    "transfer-json links are never planned as document fetches",
  );
  ok(
    plan.filter((p) => p.role === "manifest").every((p) => p.filename === "manifest.pdf"),
    "role-known fetches are stored under role-classifying filenames",
  );

  // Satisfied checklist plans no role fetches.
  const planNone = planSecondPassFetches(cFull, harvested, []);
  ok(
    planNone.every((p) => p.role === "other"),
    "a complete email plans only the other-PDF sweep",
  );

  // Cap.
  const many: HarvestedLink[] = Array.from({ length: 20 }, (_, i) => ({
    url: `https://v.example.com/m${i}`,
    role: "manifest" as const,
  }));
  ok(
    planSecondPassFetches(cPartial, many, []).length === MAX_SECOND_PASS_FETCHES,
    "second pass is hard-capped",
  );

  // ── dedupeAttachments ─────────────────────────────────────────────────────
  const deduped = dedupeAttachments([
    att("Manifest_123.pdf", "application/pdf", null, "JVBERi0x"),
    att("manifest.pdf", "application/pdf", null, "JVBERi0x"), // same bytes, link fetch
    att("Invoice.pdf", "application/pdf", null, "JVBERi0y"),
    att("t1.json", "application/json", "{}", null),
    att("t2.json", "application/json", "{}", null), // same text
  ]);
  ok(deduped.length === 3, "byte-identical and text-identical duplicates drop");
  ok(deduped[0].filename === "Manifest_123.pdf", "first occurrence (MIME attachment) wins");

  // Keyword list is pinned (a vendor rename should be a conscious edit).
  ok(HARVEST_KEYWORDS.manifest.includes("manifest"), "keyword list carries manifest");
  ok(HARVEST_KEYWORDS.coa.includes("certificate of analysis"), "keyword list carries certificate of analysis");
  ok(HARVEST_KEYWORDS.invoice.includes("invoice"), "keyword list carries invoice");

  console.log(`email-harvest-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
