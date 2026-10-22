/**
 * R74 S12: the harvest shows the date of the oldest / newest email kept and when the last batch ran.
 * Owner (round 7): "i have been fetching emails, i have no idea how many times i will need to do it,
 * maybe there is a way to add a date of the last email read? so i dont repeatedly push the button
 * for no reason."
 *
 * readHarvestStatus runs against a small fake Supabase client: the dates come from the kept rows
 * (email_at, oldest + newest), the last run from the saved cursor, and a failed date read is
 * reported as an error - never as "no emails".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildHarvestQuery, startCursor, type HarvestCursor } from "@/lib/pos/cultivera-mail-harvest-core";
import { readHarvestStatus } from "@/lib/pos/cultivera-mail-harvest-store";

const MAILBOX = "stephen@greenwaymarijuana.com";

type Row = { mailbox: string; status: string; doc_index: number; email_at: string | null };

function fakeAdmin(rows: Row[], cursor: HarvestCursor | null, opts: { failDates?: boolean } = {}) {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let head = false;
    let order: { col: string; asc: boolean } | null = null;
    let lim = Infinity;
    let cols = "";
    const q = {
      select(c: string, o?: { head?: boolean }) {
        cols = c;
        head = Boolean(o?.head);
        return q;
      },
      eq(col: string, v: unknown) {
        if (table === "site_settings") return q;
        filters.push((r) => (r as unknown as Record<string, unknown>)[col] === v);
        return q;
      },
      not(col: string) {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col] != null);
        return q;
      },
      order(col: string, o: { ascending: boolean }) {
        order = { col, asc: o.ascending };
        return q;
      },
      limit(n: number) {
        lim = n;
        return q;
      },
      maybeSingle() {
        return Promise.resolve({ data: cursor ? { value_json: cursor } : null, error: null });
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        let out = rows.filter((r) => filters.every((f) => f(r)));
        if (head) return Promise.resolve({ count: out.length, error: null }).then(res, rej);
        if (cols === "email_at" && opts.failDates) return Promise.resolve({ data: null, error: { message: "statement timeout" } }).then(res, rej);
        if (order) {
          const o = order as { col: string; asc: boolean };
          out = [...out].sort((a, b) => String((a as never)[o.col]).localeCompare(String((b as never)[o.col])) * (o.asc ? 1 : -1));
        }
        return Promise.resolve({ data: out.slice(0, lim).map((r) => ({ email_at: r.email_at })), error: null }).then(res, rej);
      },
    };
    return q;
  };
  return { from } as unknown as Parameters<typeof readHarvestStatus>[0];
}

const ROWS: Row[] = [
  { mailbox: MAILBOX, status: "parsed", doc_index: 0, email_at: "2024-07-03T10:00:00Z" },
  { mailbox: MAILBOX, status: "stored", doc_index: 1, email_at: "2024-07-03T10:00:00Z" },
  { mailbox: MAILBOX, status: "parsed", doc_index: 0, email_at: "2023-01-05T09:00:00Z" },
  { mailbox: MAILBOX, status: "unreadable", doc_index: 0, email_at: null },
  { mailbox: "other@greenwaymarijuana.com", status: "parsed", doc_index: 0, email_at: "2019-01-01T00:00:00Z" },
];

function cursorAt(pages: number, done: boolean): HarvestCursor {
  const c = startCursor(MAILBOX, buildHarvestQuery(), "2024-07-01T00:00:00Z");
  return { ...c, pagesDone: pages, listed: pages * 100, done, pageToken: done || pages === 0 ? null : "tok", updatedAt: "2024-07-04T15:07:00Z" };
}

describe("readHarvestStatus dates (R74 S12)", () => {
  it("in progress: oldest/newest kept (this mailbox only), last run, and where the next press goes", async () => {
    const st = await readHarvestStatus(fakeAdmin(ROWS, cursorAt(3, false)), MAILBOX);
    expect(st.ready).toBe(true);
    if (!st.ready) return;
    expect(st.dates).toEqual({
      oldestEmailAt: "2023-01-05T09:00:00Z",
      newestEmailAt: "2024-07-03T10:00:00Z",
      lastRunAt: "2024-07-04T15:07:00Z",
      done: false,
      started: true,
    });
    expect(st.datesLine).toContain("Emails kept run from Jan 5, 2023 (oldest) to Jul 3, 2024 (newest).");
    expect(st.datesLine).toContain("Last batch ran Jul 4, 2024 15:07 UTC.");
    expect(st.datesLine).toContain("older than Jan 5, 2023");
    expect(st.datesLine).toContain("until it says Finished");
    expect(st.emails).toBe(3);
  });

  it("finished: says the whole mailbox is read and there is no need to press Harvest again", async () => {
    const st = await readHarvestStatus(fakeAdmin(ROWS, cursorAt(9, true)), MAILBOX);
    expect(st.ready && st.dates.done).toBe(true);
    if (!st.ready) return;
    expect(st.datesLine).toContain("The whole mailbox has been read - no need to press Harvest again");
    expect(st.cursorLine).toMatch(/^Finished:/);
  });

  it("never run: no dates, no last run", async () => {
    const st = await readHarvestStatus(fakeAdmin([], null), MAILBOX);
    expect(st.ready).toBe(true);
    if (!st.ready) return;
    expect(st.dates.lastRunAt).toBeNull();
    expect(st.datesLine).toBe("No email with a date has been kept yet. No batch has run yet.");
  });

  it("a failed date read is an error, never 'no emails' (fail loud)", async () => {
    const st = await readHarvestStatus(fakeAdmin(ROWS, cursorAt(3, false), { failDates: true }), MAILBOX);
    expect(st.ready).toBe(false);
    if (st.ready) return;
    expect(st.why).toContain("statement timeout");
  });

  it("the Menu Imports page shows the dates line and the order guidance", () => {
    const page = readFileSync("src/app/admin/menu-imports/page.tsx", "utf8");
    expect(page).toContain('data-testid="mail-harvest-dates"');
    expect(page).toContain("{harvestStatus.datesLine}");
  });
});
