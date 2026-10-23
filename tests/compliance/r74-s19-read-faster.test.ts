/**
 * R74 S19: read the kept documents faster per press (owner round 10).
 * Owner: "right now it says it can do up to 12 at a time ... it starts at the very last one ...
 * it takes about a minute per button click. I am hoping we can bump up the read rate from llama parse."
 *
 * The batch runner with fake I/O and a controllable clock:
 *   - five documents are read AT ONCE (never more), so a press does five times the work per minute;
 *   - one press takes up to 100 documents, and the 180 s budget (not a count of 12) ends it;
 *   - a storage outage stops every worker from starting more, the in-flight ones are still written;
 *   - the claim guard still counts a document another press wrote once, never twice;
 *   - the newest email is read first (the store orders by email_at descending).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const core = await import("@/lib/pos/cultivera-mail-read-core");
const store = await import("@/lib/pos/cultivera-mail-read-store");
type ReadIo = import("@/lib/pos/cultivera-mail-read-store").ReadIo;

const LCB_TEXT = readFileSync("tests/compliance/fixtures/pdf-manifest-sample.txt", "utf8");
const enc = (s: string) => new TextEncoder().encode(s);

type Row = { id: string; kind: string; filename: string; storage_key: string; status: string };

/** Fake I/O. Each LlamaParse read takes `readMs` of fake time; the clock only moves when reads finish. */
function slowIo(n: number, opts: { readMs?: number; failKey?: string; stealId?: string } = {}) {
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, kind: "pdf", filename: `d${i}.pdf`, storage_key: `mail-harvest/d${i}.pdf`, status: "stored" }));
  let clock = 0;
  let inFlight = 0;
  const seen = { maxInFlight: 0, started: [] as string[], listLimit: 0, written: [] as string[] };
  const io: ReadIo = {
    countStored: async () => rows.filter((r) => r.status === "stored").length,
    listStored: async (limit) => {
      seen.listLimit = limit;
      return rows.filter((r) => r.status === "stored").slice(0, limit);
    },
    download: async (key) => {
      seen.started.push(key);
      if (key === opts.failKey) throw new Error("storage: 503");
      return enc("%PDF");
    },
    readLayer: async () => LCB_TEXT,
    readPdf: async () => {
      inFlight += 1;
      seen.maxInFlight = Math.max(seen.maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      clock += opts.readMs ?? 0;
      inFlight -= 1;
      return { text: LCB_TEXT, engine: "llamaparse", note: null };
    },
    workbook: async () => [],
    update: async (id) => {
      const r = rows.find((x) => x.id === id)!;
      if (opts.stealId === id) r.status = "parsed";
      if (r.status !== "stored") return false;
      r.status = "parsed";
      seen.written.push(id);
      return true;
    },
    now: () => clock,
  };
  return { io, rows, seen };
}

describe("R74 S19 limits (pure core)", () => {
  it("five at once, up to 100 per press, a 180 s budget that fits the 300 s page", () => {
    expect(core.READ_CONCURRENCY).toBe(5);
    expect(core.READ_BATCH_MAX_DOCS).toBe(100);
    expect(core.READ_BATCH_TIME_BUDGET_MS).toBe(180_000);
    expect(readFileSync("src/app/admin/menu-imports/page.tsx", "utf8")).toMatch(/export const maxDuration = 300;/);
  });
  it("self-tests pass at the pinned count", () => {
    const r = core.__runCultiveraMailReadCoreTests();
    expect(r).toEqual({ passed: 60, failed: 0 });
  });
});

describe("R74 S19 parallel batch", () => {
  it("reads five documents at once and never more", async () => {
    const { io, seen } = slowIo(23);
    const r = await store.runReadBatch(io);
    expect(seen.maxInFlight).toBe(5);
    expect(r).toMatchObject({ ok: true, waiting: 23, read: 23, parsed: 23, llamaparse: 23, left: 0, stoppedBecause: null });
    expect(seen.listLimit).toBe(100);
  });

  it("the time budget, not a count of 12, ends a press: 40 quick documents all read", async () => {
    const { io } = slowIo(40, { readMs: 1_000 });
    const r = await store.runReadBatch(io);
    expect(r.read).toBe(40);
    expect(r.left).toBe(0);
  });

  it("past the budget no new document starts, the started ones are written, and it says so", async () => {
    // 5 workers, each read moves the clock 30 s: after a few rounds the clock passes 180 s.
    const { io, seen } = slowIo(100, { readMs: 30_000 });
    const r = await store.runReadBatch(io);
    expect(r.read).toBeGreaterThan(5);
    expect(r.read).toBeLessThan(100);
    expect(seen.written.length).toBe(r.read);
    expect(seen.started.length).toBe(r.read);
    expect(r.left).toBe(100 - r.read);
    expect(r.stoppedBecause).toMatch(/time budget reached/);
    expect(core.readBatchLine(r)).toMatch(/left; press again/);
  });

  it("a storage outage stops every worker from starting more; in-flight reads are still written", async () => {
    const { io, seen } = slowIo(30, { failKey: "mail-harvest/d2.pdf" });
    const r = await store.runReadBatch(io);
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.stoppedBecause).toMatch(/could not open d2\.pdf: storage: 503/);
    // only the first round of five was ever started
    expect(seen.started.length).toBeLessThanOrEqual(5);
    expect(r.read).toBe(seen.started.length - 1);
    expect(r.left).toBe(30 - r.read);
    expect(core.readBatchLine(r)).toMatch(/1 could not be opened/);
  });

  it("the claim guard: a document another press wrote is not counted", async () => {
    const { io } = slowIo(6, { stealId: "d3" });
    const r = await store.runReadBatch(io);
    expect(r.read).toBe(5);
    expect(r.left).toBe(0);
  });

  it("one document: one worker; none: no reads", async () => {
    const one = slowIo(1);
    expect((await store.runReadBatch(one.io)).read).toBe(1);
    expect(one.seen.maxInFlight).toBe(1);
    const none = slowIo(0);
    const r = await store.runReadBatch(none.io);
    expect(r.waiting).toBe(0);
    expect(none.seen.started).toEqual([]);
  });

  it("an explicit width of 1 reads one at a time (the background reader can choose)", async () => {
    const { io, seen } = slowIo(7);
    await store.runReadBatch(io, { concurrency: 1 });
    expect(seen.maxInFlight).toBe(1);
  });
});

describe("R74 S19 wiring", () => {
  const st = readFileSync("src/lib/pos/cultivera-mail-read-store.ts", "utf8");
  const page = readFileSync("src/app/admin/menu-imports/page.tsx", "utf8");
  it("newest email first, with the id as a stable tie-break", () => {
    expect(st).toMatch(/\.order\("email_at", \{ ascending: false, nullsFirst: false \}\)\s*\n\s*\.order\("id", \{ ascending: true \}\)/);
  });
  it("the page tells the truth about the new rate and order", () => {
    expect(page).toContain("newest email first, five at a time");
    expect(page).not.toContain("up to 12 per press");
  });
});
