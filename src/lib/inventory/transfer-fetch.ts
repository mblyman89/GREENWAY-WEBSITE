import "server-only";

import { cleanUrl } from "./intake-parser";

/**
 * Result of attempting to fetch a vendor Transfer Data Link.
 */
export type TransferFetchResult =
  | { ok: true; jsonText: string; finalUrl: string }
  | { ok: false; error: string };

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB guard — transfer JSON is tiny.
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch a WCIA "Transfer Data Link" URL server-side and return the raw JSON text.
 *
 * Handles two real-world quirks from the Cultivera order emails:
 *  1) The link often arrives doubled, e.g. `https://host/https://real-host/...`.
 *     We collapse it with the same `cleanUrl` helper used elsewhere.
 *  2) The endpoint may serve `text/plain` or `application/octet-stream` rather
 *     than `application/json`, so we don't hard-require a JSON content type —
 *     we validate by attempting to `JSON.parse` the body instead.
 *
 * The caller is responsible for running the text through `parseVendorJson`.
 */
export async function fetchTransferJson(rawUrl: string): Promise<TransferFetchResult> {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) {
    return { ok: false, error: "That doesn't look like a URL." };
  }

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http(s) links are supported." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/json, text/plain, */*" },
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error && err.name === "AbortError"
      ? "The link took too long to respond (timed out)."
      : "Couldn't reach that link from the server.";
    return { ok: false, error: msg };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { ok: false, error: `The link returned an error (HTTP ${res.status}).` };
  }

  // Size guard via Content-Length when present.
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) {
    return { ok: false, error: "That file is too large to import automatically." };
  }

  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, error: "Couldn't read the response from that link." };
  }
  if (text.length > MAX_BYTES) {
    return { ok: false, error: "That file is too large to import automatically." };
  }

  // Validate it's JSON (the endpoint may mislabel the content type).
  try {
    JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "The link didn't return JSON — paste the JSON directly instead.",
    };
  }

  return { ok: true, jsonText: text, finalUrl: url.toString() };
}

/** Result of attempting to fetch a vendor PDF (invoice / manifest / COA) link. */
export type PdfFetchResult =
  | { ok: true; base64: string; contentType: string; finalUrl: string; bytes: number }
  | { ok: false; error: string };

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB guard — COA PDFs can be large.

/**
 * Fetch a vendor invoice/manifest/COA PDF link server-side and return its bytes
 * as base64 so the inbound-email path can treat it exactly like a MIME
 * attachment (H16b-6 link-only fallback). Used ONLY when the richer WCIA
 * transfer JSON is dead/absent AND no PDF was MIME-attached (Gmail forwarding
 * stripped the files but left the download links).
 *
 * Validates it's actually a PDF (magic bytes "%PDF") since a dead link may
 * return an HTML error page. Never throws.
 */
export async function fetchPdfBytes(rawUrl: string): Promise<PdfFetchResult> {
  const cleaned = cleanUrl(rawUrl);
  if (!cleaned) return { ok: false, error: "That doesn't look like a URL." };

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http(s) links are supported." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "application/pdf, application/octet-stream, */*" },
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timer);
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? "The link took too long to respond (timed out)."
        : "Couldn't reach that link from the server.";
    return { ok: false, error: msg };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { ok: false, error: `The link returned an error (HTTP ${res.status}).` };
  }
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_PDF_BYTES) {
    return { ok: false, error: "That file is too large to import automatically." };
  }

  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch {
    return { ok: false, error: "Couldn't read the response from that link." };
  }
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return { ok: false, error: "That file is too large to import automatically." };
  }
  // Validate PDF magic bytes ("%PDF") — a dead link often returns an HTML page.
  if (bytes.byteLength < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return { ok: false, error: "The link didn't return a PDF (it may be dead or an HTML page)." };
  }
  const contentType = (res.headers.get("content-type") ?? "application/pdf").split(";")[0].trim();
  return {
    ok: true,
    base64: Buffer.from(bytes).toString("base64"),
    contentType: contentType || "application/pdf",
    finalUrl: url.toString(),
    bytes: bytes.byteLength,
  };
}
