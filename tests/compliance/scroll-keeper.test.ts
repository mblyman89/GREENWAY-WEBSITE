/**
 * tests/compliance/scroll-keeper.test.ts — Slice H12e.
 *
 * Pins the scroll-restore decision rules: save on the same page restores the
 * exact position; real navigations and explicit #anchors never get hijacked;
 * stale/junk records never fire.
 */
import { describe, it, expect } from "vitest";
import {
  parseScrollRecord,
  decideRestore,
  makeScrollRecord,
  SCROLL_RECORD_TTL_MS,
} from "@/lib/admin/scroll-keeper-core";

const NOW = 1_700_000_000_000;

describe("makeScrollRecord / parseScrollRecord", () => {
  it("round-trips through JSON", () => {
    const rec = makeScrollRecord("/admin/media/abc", 842.7, NOW);
    expect(rec).toEqual({ path: "/admin/media/abc", y: 843, t: NOW });
    expect(parseScrollRecord(JSON.stringify(rec))).toEqual(rec);
  });
  it("clamps negative scroll and rejects junk", () => {
    expect(makeScrollRecord("/a", -5, NOW).y).toBe(0);
    expect(parseScrollRecord(null)).toBeNull();
    expect(parseScrollRecord("")).toBeNull();
    expect(parseScrollRecord("not json")).toBeNull();
    expect(parseScrollRecord('{"path":"","y":10,"t":1}')).toBeNull();
    expect(parseScrollRecord('{"path":"/a","y":"tall","t":1}')).toBeNull();
    expect(parseScrollRecord('{"path":"/a","y":10,"t":0}')).toBeNull();
  });
});

describe("decideRestore", () => {
  const rec = makeScrollRecord("/admin/media/abc", 800, NOW);

  it("save lands on the SAME page → restore the exact position", () => {
    expect(decideRestore(rec, { path: "/admin/media/abc", hash: "", now: NOW + 500 })).toEqual({
      action: "restore",
      y: 800,
    });
  });
  it("H13a: save on the SAME page restores even when the redirect added a #hash", () => {
    // The vendor page's accept/save actions redirect to "?saved=1#ai-drafts".
    // A fresh same-path record means the user just saved here, so their real
    // scroll position must beat the server-appended anchor (which sits near
    // the top and was the cause of the 'jumps to top after every save' bug).
    expect(
      decideRestore(rec, { path: "/admin/vendors/v1", hash: "#ai-drafts", now: NOW + 500 }),
    ).toEqual({ action: "drop" });
    const vendorRec = makeScrollRecord("/admin/vendors/v1", 800, NOW);
    expect(
      decideRestore(vendorRec, { path: "/admin/vendors/v1", hash: "#ai-drafts", now: NOW + 500 }),
    ).toEqual({ action: "restore", y: 800 });
  });
  it("a different path (no hash) keeps the record (redirect still in flight)", () => {
    expect(decideRestore(rec, { path: "/admin/media", hash: "", now: NOW + 500 })).toEqual({
      action: "keep",
    });
  });
  it("a different path WITH a #anchor drops (genuine anchor navigation elsewhere)", () => {
    // The record is for /admin/media/abc but we landed on a different page at
    // an anchor — that anchor is the intended target; this record is not ours.
    expect(
      decideRestore(rec, { path: "/admin/other", hash: "#section", now: NOW + 500 }),
    ).toEqual({ action: "drop" });
  });
  it("stale records never fire", () => {
    expect(
      decideRestore(rec, {
        path: "/admin/media/abc",
        hash: "",
        now: NOW + SCROLL_RECORD_TTL_MS + 1,
      }),
    ).toEqual({ action: "drop" });
  });
  it("missing record → drop (nothing to do)", () => {
    expect(decideRestore(null, { path: "/admin/media", hash: "", now: NOW })).toEqual({
      action: "drop",
    });
  });
});
