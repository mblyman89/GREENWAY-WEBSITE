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
  it("an explicit #anchor in the landing URL wins (e.g. #ai-drafts)", () => {
    expect(
      decideRestore(rec, { path: "/admin/media/abc", hash: "#ai-drafts", now: NOW + 500 }),
    ).toEqual({ action: "drop" });
  });
  it("a different path keeps the record (redirect still in flight)", () => {
    expect(decideRestore(rec, { path: "/admin/media", hash: "", now: NOW + 500 })).toEqual({
      action: "keep",
    });
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
