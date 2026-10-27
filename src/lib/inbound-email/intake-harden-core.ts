/**
 * src/lib/inbound-email/intake-harden-core.ts  (R74 S51)
 *
 * PURE helpers that harden the vendor_intake@ auto-fetch so ANY vendor email
 * (GrowFlow, Cultivera, OpenTHC, Bamboo, unknown) gets read. Owner-reported
 * failure: a GrowFlow "New order INV-1010497" email (forwarded twice) never
 * staged. Causes found in recon, each fixed here:
 *
 *  1) The WCIA Transfer Data Link sits in a "copy this box" cell; forwarding /
 *     plain-text wrapping splits the long token across lines (`token=EAAA%`
 *     newline `2Fk0Hq...`) or Gmail injects <wbr>/&shy;/zero-width breaks. The
 *     link regex stopped at the break, fetched a TRUNCATED token and GrowFlow
 *     answered "Bad token" -> no JSON. `normalizeForLinks` removes the invisible
 *     breaks and `wrappedUrlVariants` rebuilds wrapped URLs (tried first).
 *  2) GrowFlow answers HTTP 200 text/plain "Link has expired" / "Bad token" -
 *     the old message ("didn't return JSON") hid that. `readTransferBody`
 *     names it, strips a BOM, and lifts JSON out of an HTML <pre> wrapper.
 *  3) LlamaParse (the primary PDF reader since #799) returns MARKDOWN; the
 *     layout parsers were written against plain unpdf text, so `**Manifest
 *     ID:** GF...` or `| Transfer Log ID: | GF... |` no longer matched.
 *     `markdownToPlain` gives the parsers a plain variant (pdf-extract also
 *     retries the free unpdf text layer).
 *  4) An unknown PDF layout (e.g. a new "CCRS_Manifest" print) matched no
 *     parser. The AI fallback is GROUNDED here: `groundAiManifest` keeps only
 *     lines whose lot id is printed verbatim in the document.
 *
 * No I/O. Self-tests: __runIntakeHardenTests.
 */

/** Characters that may legally continue a URL token across a wrap. */
const URL_TOKEN_RE = /^[A-Za-z0-9%._~+\/=&?#:@!$'*,;-]+$/;

/** Remove invisible line-break helpers and decode the entities that hide URLs. PURE. */
export function normalizeForLinks(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<wbr\s*\/?>/gi, "")
    .replace(/&shy;|&#173;|&#xad;/gi, "")
    .replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/=\r?\n/g, "") // quoted-printable soft line breaks left in a body
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;|&#47;/gi, "/")
    .replace(/&#x3d;|&#61;/gi, "=")
    .replace(/&#x25;|&#37;/gi, "%")
    .replace(/&#x2b;|&#43;/gi, "+");
}

/**
 * Rebuild URLs that a mail client wrapped across lines. For every https URL that
 * ends a line, glue on the following lines while each is ONE token of URL-safe
 * characters (no spaces) - up to 4 lines. Returns the rebuilt (longer) URLs
 * only; callers try them BEFORE the truncated originals. A wrong guess costs
 * one GET: the fetched body must still JSON.parse and pass the strict WCIA gate.
 * PURE.
 */
export function wrappedUrlVariants(text: string | null | undefined): string[] {
  if (!text) return [];
  const lines = normalizeForLinks(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|td|tr|li|pre|textarea)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s>]+/, "").trimEnd());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(https?:\/\/[^\s"'<>()]+)$/);
    if (!m) continue;
    let url = m[1];
    let glued = 0;
    for (let j = i + 1; j < lines.length && glued < 4; j++) {
      const next = lines[j].trim();
      if (!next) {
        // one blank line is tolerated only right after a percent-escape split
        if (/%[0-9A-Fa-f]?$/.test(url) && glued === 0) continue;
        break;
      }
      if (!URL_TOKEN_RE.test(next) || /^https?:\/\//i.test(next) || next.length < 4) break;
      url += next;
      glued += 1;
    }
    if (glued > 0) out.push(url.replace(/[.,;:)\]}>'"]+$/, ""));
  }
  return Array.from(new Set(out));
}

/** What a fetched Transfer Data Link body turned out to be. */
export type TransferBody =
  | { kind: "json"; text: string }
  | { kind: "expired"; message: string }
  | { kind: "bad-token"; message: string }
  | { kind: "html"; message: string }
  | { kind: "not-json"; message: string };

/**
 * Classify a Transfer Data Link response body. Strips a UTF-8 BOM, unwraps JSON
 * printed inside an HTML <pre>/<body>, and names GrowFlow's 200-OK refusals
 * ("Link has expired", "Bad token, please contact support"). PURE.
 */
export function readTransferBody(raw: string): TransferBody {
  const text = (raw ?? "").replace(/^\ufeff/, "").trim();
  const tryJson = (s: string): string | null => {
    try {
      JSON.parse(s);
      return s;
    } catch {
      return null;
    }
  };
  const direct = tryJson(text);
  if (direct) return { kind: "json", text: direct };
  if (/^</.test(text)) {
    const pre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? text.replace(/<[^>]+>/g, " ");
    const decoded = pre.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
    const start = decoded.search(/[{[]/);
    if (start >= 0) {
      const inner = tryJson(decoded.slice(start));
      if (inner) return { kind: "json", text: inner };
    }
  }
  const head = text.slice(0, 400).toLowerCase();
  if (/expired/.test(head)) {
    return { kind: "expired", message: "the vendor's link has expired (GrowFlow links expire - the PDFs were used instead)" };
  }
  if (/bad token|invalid token|token (is )?invalid|not authori[sz]ed|access denied/.test(head)) {
    return { kind: "bad-token", message: "the vendor's server refused the link token (bad/incomplete token)" };
  }
  if (/^</.test(text)) return { kind: "html", message: "the link returned a web page, not JSON" };
  return { kind: "not-json", message: "the link didn't return JSON" };
}

/** Sniff text content that LOOKS like JSON regardless of the declared type. PURE. */
export function looksLikeJsonText(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.replace(/^\ufeff/, "").trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

/**
 * Flatten LlamaParse markdown into the plain text the layout parsers expect:
 * drops bold/italic markers, heading hashes, table pipes and separator rows,
 * <br> tags and backslash escapes. PURE.
 */
export function markdownToPlain(md: string | null | undefined): string {
  if (!md) return "";
  return md
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\s)\*(\S[^*]*\S)\*(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\\([_*#|\\-])/g, "$1")
    .replace(/\s*\|\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One AI-transcribed manifest row before grounding. */
export type AiManifestRow = {
  lot: string;
  product: string;
  qty: number | null;
  unitPrice: number | null;
};

/** Parse the AI's TSV: lot<TAB>product<TAB>qty<TAB>unit price. PURE. */
export function parseAiManifestTsv(tsv: string): AiManifestRow[] {
  const out: AiManifestRow[] = [];
  for (const raw of (tsv ?? "").split(/\r?\n/)) {
    const cols = raw.split("\t").map((c) => c.trim());
    if (cols.length < 2 || !cols[0] || /^lot/i.test(cols[0])) continue;
    const num = (v: string | undefined): number | null => {
      if (!v) return null;
      const n = Number(v.replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    out.push({ lot: cols[0], product: cols[1] ?? "", qty: num(cols[2]), unitPrice: num(cols[3]) });
  }
  return out;
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * NEVER-GUESS gate for the AI fallback. A row survives only when its lot id
 * (>= 6 alphanumerics) is printed verbatim in the document text, its quantity is
 * a positive number, and it is not a repeat. The manifest number survives only
 * when it is printed too. Returns null when no row survives. PURE.
 */
export function groundAiManifest(
  ai: { manifestNumber: string; vendorName: string; vendorLicense: string; transferDate: string; rows: AiManifestRow[] },
  docTexts: string[],
): {
  manifestNumber: string | null;
  vendorName: string | null;
  vendorLicense: string | null;
  transferDate: string | null;
  rows: AiManifestRow[];
  dropped: number;
} | null {
  const hay = squash(docTexts.join("\n"));
  if (!hay) return null;
  const printed = (v: string | null | undefined, min = 4): boolean => {
    const k = squash(v ?? "");
    return k.length >= min && hay.includes(k);
  };
  const seen = new Set<string>();
  const rows: AiManifestRow[] = [];
  let dropped = 0;
  for (const r of ai.rows) {
    const key = squash(r.lot);
    if (key.length < 6 || !printed(r.lot, 6) || !(r.qty != null && r.qty > 0) || seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    rows.push({ ...r, unitPrice: r.unitPrice != null && r.unitPrice >= 0 ? r.unitPrice : null });
  }
  if (rows.length === 0) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ai.transferDate ?? "") ? ai.transferDate : null;
  return {
    manifestNumber: printed(ai.manifestNumber) ? ai.manifestNumber.trim() : null,
    vendorName: printed(ai.vendorName, 3) ? ai.vendorName.trim() : null,
    vendorLicense: /^\d{6}$/.test((ai.vendorLicense ?? "").trim()) && printed(ai.vendorLicense, 6) ? ai.vendorLicense.trim() : null,
    transferDate: date,
    rows,
    dropped,
  };
}

// ---------------------------------------------------------------------------
export function __runIntakeHardenTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", m);
    }
  };

  // 1) The owner's GrowFlow email: the token wraps after a "%".
  const body = [
    "WCIA Transfer Data Link (JSON):",
    "Copy entire link in the box below and paste into your system",
    "",
    "https://go.growflow.com/wa/wcia/transfer?token=EAAAAA8xM1c%",
    "2Fk0HqoZTljijaQITCjchpL1%2B93BBYk1yxkFrI6igvOsNNGswxTOu",
    "dP7dblpXkNwpsSu1hue25Igtx%2FhMMj1aGcI3654GLbU%2FGRdnV",
    "",
    "QA Certificates:",
  ].join("\n");
  const v = wrappedUrlVariants(body);
  ok(
    v[0] ===
      "https://go.growflow.com/wa/wcia/transfer?token=EAAAAA8xM1c%2Fk0HqoZTljijaQITCjchpL1%2B93BBYk1yxkFrI6igvOsNNGswxTOudP7dblpXkNwpsSu1hue25Igtx%2FhMMj1aGcI3654GLbU%2FGRdnV",
    "wrapped GrowFlow token rebuilt",
  );
  ok(wrappedUrlVariants("see https://x.com/a\nThanks for your order!").length === 0, "prose after a URL is not glued");
  ok(wrappedUrlVariants("> https://h.com/t?token=AB%\n> 2Fcdefgh").includes("https://h.com/t?token=AB%2Fcdefgh"), "quoted forward prefix ignored");
  ok(normalizeForLinks("https://go.growflow.com/wa/wcia/transfer?token=AB<wbr>CD&amp;x=1\u200b") === "https://go.growflow.com/wa/wcia/transfer?token=ABCD&x=1", "wbr / entities / zero-width removed");
  ok(wrappedUrlVariants("<td>https://h.com/t?token=AAAA<br>BBBBBBBB</td>")[0] === "https://h.com/t?token=AAAABBBBBBBB", "html <br> wrap rebuilt");

  // 2) Transfer bodies.
  ok(readTransferBody("Link has expired").kind === "expired", "GrowFlow expired named");
  ok(readTransferBody("Bad token, please contact support").kind === "bad-token", "GrowFlow bad token named");
  ok(readTransferBody('\ufeff{"document_name":"WCIA Transfer Schema"}').kind === "json", "BOM stripped");
  const pre = readTransferBody('<html><body><pre>{&quot;a&quot;:1}</pre></body></html>');
  ok(pre.kind === "json" && pre.text === '{"a":1}', "json lifted out of <pre>");
  ok(readTransferBody("<html><body>Sign in</body></html>").kind === "html", "html page named");
  ok(looksLikeJsonText('\ufeff  {"x":1}') && !looksLikeJsonText("%PDF-1.4"), "json sniff");

  // 3) Markdown flattening keeps the layout anchors the parsers need.
  const md = "# Transfer Log\n(This document is NOT a manifest)\n\n| **Transfer Log ID:** | GF41918900001 |\n|---|---|\n| LCB Manifest ID: | 0001234567 |";
  const plain = markdownToPlain(md);
  ok(/Transfer Log ID:\s*GF\d{6,}/.test(plain), "markdown table -> 'Transfer Log ID: GF...'");
  ok(/Transfer Log\s*\(This document is NOT a manifest\)/.test(plain), "heading kept");
  ok(/Manifest ID:\s*GF\d{6,}/.test(markdownToPlain("**Manifest ID:**GF42612700007100")), "bold label unwrapped");

  // 4) AI grounding.
  const doc = "Manifest ID: 0009876543 Legit Cannabis Co License 412345 GF41918905566988 Banana Cake 1g 24 GF41918905566980 Blue Dream 12";
  const g = groundAiManifest(
    {
      manifestNumber: "0009876543",
      vendorName: "Legit Cannabis Co",
      vendorLicense: "412345",
      transferDate: "2026-07-15",
      rows: parseAiManifestTsv(
        "lot\tproduct\tqty\tprice\nGF41918905566988\tBanana Cake 1g\t24\t$4.50\nGF41918905566980\tBlue Dream\t12\t\nGF99999999999999\tInvented\t5\t1\nGF41918905566988\tdup\t3\t1\nSHORT\tx\t1\t1",
      ),
    },
    [doc],
  );
  ok(!!g && g.rows.length === 2, "only printed, unique, long lot ids survive");
  ok(!!g && g.dropped === 3, "invented / duplicate / short rows dropped");
  ok(!!g && g.rows[0].unitPrice === 4.5 && g.rows[1].unitPrice === null, "price parsed, blank stays null");
  ok(!!g && g.manifestNumber === "0009876543" && g.vendorLicense === "412345", "printed header facts kept");
  ok(groundAiManifest({ manifestNumber: "X", vendorName: "", vendorLicense: "", transferDate: "", rows: [{ lot: "GF00000000000001", product: "a", qty: 1, unitPrice: null }] }, [doc]) === null, "nothing printed -> null");
  const g2 = groundAiManifest({ manifestNumber: "NOT-PRINTED-1", vendorName: "Somebody", vendorLicense: "999999", transferDate: "July", rows: [{ lot: "GF41918905566980", product: "b", qty: 2, unitPrice: null }] }, [doc]);
  ok(!!g2 && g2.manifestNumber === null && g2.vendorLicense === null && g2.transferDate === null, "unprinted header facts dropped");

  if (failed === 0) console.log(`intake-harden-core: all ${passed} tests passed`);
  return { passed, failed };
}
