/**
 * tests/compliance/batch-import.test.ts — Slice H11b (batch Transfer-Link
 * importer, drafts-only).
 *
 * Pins the PURE URL-list parsing (doubled-prefix collapse, dedupe, cap,
 * invalid-line reporting), the chunker the client uses to avoid serverless
 * timeouts, and the shared result/summary vocabulary. The server action
 * reuses the long-standing fetchTransferJson → parseVendorJson →
 * stageManifest pipeline, so the compliance surface to pin is this list
 * hygiene: never import garbage, never double-count, never exceed the cap.
 */
import { describe, it, expect } from "vitest";
import {
  collapseDoubledUrl,
  parseUrlList,
  chunkUrls,
  summarizeBatch,
  statusLabel,
  MAX_BATCH_URLS,
  BATCH_CHUNK_SIZE,
  type BatchUrlResult,
} from "@/lib/inventory/batch-import-core";

const GOOD = "https://files.cultivera.com/ABC/Interop/25/10/XYZ/Cultivera_ORD-20636_413541.json";

describe("collapseDoubledUrl (Cultivera email link bug)", () => {
  it("collapses https://host/https://real-host/... to the real URL", () => {
    expect(collapseDoubledUrl(`https://files.cultivera.com/${GOOD}`)).toBe(GOOD);
  });
  it("leaves a normal URL untouched", () => {
    expect(collapseDoubledUrl(GOOD)).toBe(GOOD);
    expect(collapseDoubledUrl(`  ${GOOD}  `)).toBe(GOOD);
  });
});

describe("parseUrlList", () => {
  it("splits on newlines / commas / whitespace and keeps order", () => {
    const r = parseUrlList(`${GOOD}\nhttps://a.example/1.json, https://a.example/2.json`);
    expect(r.urls).toEqual([GOOD, "https://a.example/1.json", "https://a.example/2.json"]);
    expect(r.invalid).toEqual([]);
    expect(r.duplicates).toBe(0);
    expect(r.truncated).toBe(false);
  });

  it("de-duplicates AFTER collapsing the doubled prefix (same real link once)", () => {
    const r = parseUrlList(`${GOOD}\nhttps://files.cultivera.com/${GOOD}`);
    expect(r.urls).toEqual([GOOD]);
    expect(r.duplicates).toBe(1);
  });

  it("rejects non-URL lines and non-http(s) schemes without dropping the rest", () => {
    const r = parseUrlList(`not-a-url\nftp://x.example/a.json\n${GOOD}`);
    expect(r.urls).toEqual([GOOD]);
    expect(r.invalid).toEqual(["not-a-url", "ftp://x.example/a.json"]);
  });

  it("caps at MAX_BATCH_URLS and flags truncation", () => {
    const many = Array.from({ length: MAX_BATCH_URLS + 3 }, (_, i) => `https://x.example/${i}.json`);
    const r = parseUrlList(many.join("\n"));
    expect(r.urls.length).toBe(MAX_BATCH_URLS);
    expect(r.truncated).toBe(true);
  });

  it("empty / whitespace input → empty result", () => {
    expect(parseUrlList("").urls).toEqual([]);
    expect(parseUrlList("   \n  ").urls).toEqual([]);
  });
});

describe("chunkUrls", () => {
  it("splits into chunks of BATCH_CHUNK_SIZE, last chunk partial", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://x.example/${i}.json`);
    const chunks = chunkUrls(urls);
    expect(BATCH_CHUNK_SIZE).toBe(5); // pinned: small enough for serverless windows
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(5);
    expect(chunks[2].length).toBe(2);
    expect(chunks.flat()).toEqual(urls);
  });
  it("guards a bad size (min 1) and empty input", () => {
    expect(chunkUrls([], 5)).toEqual([]);
    expect(chunkUrls(["https://x.example/1.json"], 0).length).toBe(1);
  });
});

describe("summarizeBatch + statusLabel", () => {
  const r = (status: BatchUrlResult["status"]): BatchUrlResult => ({
    url: GOOD,
    status,
    detail: null,
    manifestId: null,
  });

  it("counts staged / duplicates / failed correctly", () => {
    const s = summarizeBatch([
      r("staged"),
      r("staged"),
      r("duplicate"),
      r("fetch_failed"),
      r("parse_failed"),
      r("no_lines"),
      r("save_failed"),
    ]);
    expect(s).toEqual({ total: 7, staged: 2, duplicates: 1, failed: 4 });
  });

  it("every status has a human label", () => {
    const statuses: BatchUrlResult["status"][] = [
      "staged",
      "duplicate",
      "fetch_failed",
      "parse_failed",
      "no_lines",
      "save_failed",
    ];
    for (const s of statuses) expect(statusLabel(s).length).toBeGreaterThan(0);
    expect(statusLabel("staged")).toBe("Staged for review");
    expect(statusLabel("duplicate")).toBe("Already imported");
  });
});
