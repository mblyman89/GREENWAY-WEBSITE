/**
 * R74 S5: the Cultivera mail harvest foundation.
 * Owner (round 2 #2): "every Cultivera manifest was sent to stephen@. Please go as far back as you are allowed to go."
 * Pins: the pure core's self-test count, the one-page list call (resumable), and attachment BYTES
 * (a PDF must survive; getAttachmentText decodes through UTF-8 and corrupts it).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __runCultiveraMailHarvestCoreTests,
  advanceCursor,
  buildHarvestQuery,
  resumeOrStart,
} from "@/lib/pos/cultivera-mail-harvest-core";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("R74 S5 pure core", () => {
  it("self-tests pass at the pinned count", () => {
    const r = __runCultiveraMailHarvestCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(75);
  });

  it("is registered in the pure self-test runner with its floor", () => {
    const src = readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8");
    expect(src).toContain("__runCultiveraMailHarvestCoreTests()");
    expect(src).toMatch(/cultivera-mail-harvest-core: .*expected >= 75/);
  });
});

describe("R74 S5 Gmail I/O (fake Google)", () => {
  it("lists ONE page with the token, and a walk resumes from the saved cursor", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const u = new URL(url);
        const pt = u.searchParams.get("pageToken");
        if (!pt) return new Response(JSON.stringify({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "P2", resultSizeEstimate: 3 }));
        return new Response(JSON.stringify({ messages: [{ id: "m3" }], resultSizeEstimate: 3 }));
      }),
    );
    const { listMessageIdsPage } = await import("@/lib/compliance/ccrs-mail-fetch");
    const q = buildHarvestQuery();
    let { cursor } = resumeOrStart(null, "stephen@greenwaymarijuana.com", q, "t0");
    const p1 = await listMessageIdsPage("TOK", cursor.mailbox, q, cursor.pageToken);
    expect(p1).toEqual({ ids: ["m1", "m2"], nextPageToken: "P2", resultSizeEstimate: 3 });
    cursor = advanceCursor(cursor, p1, "t1");
    // A new run reads the stored cursor back (JSON round-trip) and continues.
    const again = resumeOrStart(JSON.parse(JSON.stringify(cursor)), "stephen@greenwaymarijuana.com", q, "t2");
    expect(again.restarted).toBe(false);
    const p2 = await listMessageIdsPage("TOK", again.cursor.mailbox, q, again.cursor.pageToken);
    cursor = advanceCursor(again.cursor, p2, "t3");
    expect(cursor.done).toBe(true);
    expect(cursor.listed).toBe(3);
    expect(urls).toHaveLength(2);
    const u1 = new URL(urls[0]);
    expect(u1.pathname).toBe("/gmail/v1/users/stephen%40greenwaymarijuana.com/messages");
    expect(u1.searchParams.get("q")).toBe(q);
    expect(u1.searchParams.get("maxResults")).toBe("100");
    expect(u1.searchParams.get("pageToken")).toBeNull();
    expect(new URL(urls[1]).searchParams.get("pageToken")).toBe("P2");
  });

  it("a refused list is an error with the fix, never an empty page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Gmail API has not been used in project 1" } }), { status: 403 })));
    const { listMessageIdsPage } = await import("@/lib/compliance/ccrs-mail-fetch");
    await expect(listMessageIdsPage("TOK", "stephen@greenwaymarijuana.com", "q", null)).rejects.toThrow(/turn on the Gmail API/);
  });

  it("attachment bytes survive (a binary PDF is not mangled through UTF-8)", async () => {
    const raw = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x00, 0x80]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ size: raw.length, data: raw.toString("base64url") }))));
    const { getAttachmentBytes } = await import("@/lib/compliance/ccrs-mail-fetch");
    const ref = { filename: "manifest.pdf", mimeType: "application/pdf", size: raw.length, attachmentId: "ATT", inlineData: null };
    const got = await getAttachmentBytes("TOK", "stephen@greenwaymarijuana.com", "m1", ref);
    expect(Buffer.from(got).equals(raw)).toBe(true);
    const inline = await getAttachmentBytes("TOK", "x@y.com", "m1", { ...ref, attachmentId: null, inlineData: raw.toString("base64url") });
    expect(Buffer.from(inline).equals(raw)).toBe(true);
    expect((await getAttachmentBytes("TOK", "x@y.com", "m1", { ...ref, attachmentId: null })).length).toBe(0);
  });
});
