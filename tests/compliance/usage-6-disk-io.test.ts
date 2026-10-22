/**
 * USAGE-6 · Disk IO budget: the Orders board's newest-change reads use an index.
 *
 * `orders_board_snapshot()` (0233) runs every VISIBLE_POLL_MS (15 s) per open
 * Orders tab and ends with max(updated_at) on orders and leafly_orders. With
 * no index on either column every call read both tables end to end. Migration
 * 0292 adds the two indexes. Behaviour on Postgres is proven by
 * scripts/recon/orders-updated-at-0292-pg-check.sql (wired into
 * verify-migrations-execute POST_APPLY_CHECKS, so CI runs it); this file pins
 * the text so nobody quietly drops a piece.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HIDDEN_POLL_MS, VISIBLE_POLL_MS } from "@/lib/orders/new-order-watch-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const noComments = (sql: string) => sql.replace(/--.*$/gm, "");

const MIG = "supabase/migrations/0292_orders_updated_at_indexes.sql";
const RB = "supabase/rollbacks/0292_orders_updated_at_indexes.rollback.sql";
const CHECK = "scripts/recon/orders-updated-at-0292-pg-check.sql";
const DIAG = "scripts/recon/disk-io-diagnose.sql";
const TOP = "scripts/recon/disk-io-top-queries.sql";
const MIRROR_DISK = "docs/usage-sources/supabase-compute-and-disk.txt";
const MIRROR_IO = "docs/usage-sources/supabase-high-disk-io.txt";

describe("USAGE-6 · the poll that 0292 serves", () => {
  it("the board polls every 15 s visible and every 2 min hidden", () => {
    expect(VISIBLE_POLL_MS).toBe(15000);
    expect(HIDDEN_POLL_MS).toBe(120000);
  });
  it("0233's snapshot still ends with max(updated_at) on both tables", () => {
    const s = flat(noComments(read("supabase/migrations/0233_orders_board_snapshot.sql")));
    expect(s).toContain("'orders_updated_at', (select max(updated_at) from public.orders)");
    expect(s).toContain("'leafly_updated_at', (select max(updated_at) from public.leafly_orders)");
  });
});

describe("USAGE-6 · migration 0292", () => {
  const sql = flat(noComments(read(MIG))).toLowerCase();
  it("creates exactly the two descending btree indexes, idempotently", () => {
    expect(sql).toContain("create index if not exists orders_updated_at_idx on public.orders (updated_at desc)");
    expect(sql).toContain(
      "create index if not exists leafly_orders_updated_at_idx on public.leafly_orders (updated_at desc)",
    );
    expect(sql.match(/create index/g)?.length).toBe(2);
  });
  it("creates no table, function, policy or trigger and deletes nothing", () => {
    for (const bad of ["create table", "create or replace function", "create policy", "create trigger", "delete from", "drop ", "truncate", "update public."]) {
      expect(sql.includes(bad), bad).toBe(false);
    }
  });
  it("refreshes planner statistics on both tables", () => {
    expect(sql).toContain("analyze public.orders");
    expect(sql).toContain("analyze public.leafly_orders");
  });
  it("the rollback drops only those two indexes", () => {
    const rb = flat(noComments(read(RB))).toLowerCase();
    expect(rb).toContain("drop index if exists public.orders_updated_at_idx");
    expect(rb).toContain("drop index if exists public.leafly_orders_updated_at_idx");
    expect(rb.match(/drop /g)?.length).toBe(2);
  });
});

describe("USAGE-6 · the Postgres check", () => {
  const chk = read(CHECK);
  it("is a rolled-back transaction that prints the pass line", () => {
    expect(chk).toMatch(/^begin;$/m);
    expect(chk).toMatch(/^rollback;$/m);
    expect(chk).toContain("raise notice 'USAGE 0292 CHECK PASSED'");
  });
  it("reads EXPLAIN as JSON (one row) and looks for each index by quoted name", () => {
    // Text-format EXPLAIN returns one row per plan line; EXECUTE ... INTO keeps
    // only the first ("Aggregate"), which never names the index. Found live.
    expect(chk).toContain("explain (format json) select max(updated_at) from public.orders");
    expect(chk).toContain("explain (format json) select max(updated_at) from public.leafly_orders");
    expect(chk).toContain(`position('"orders_updated_at_idx"' in plan)`);
    expect(chk).toContain(`position('"leafly_orders_updated_at_idx"' in plan)`);
    expect(chk).not.toContain("format text");
  });
  it("prices out seq scans so an empty local table cannot hide a missing index", () => {
    expect(chk).toContain("set local enable_seqscan = off");
  });
  it("checks the snapshot keeps its four keys", () => {
    expect(chk).toContain("array['counts', 'arrivals', 'orders_updated_at', 'leafly_updated_at']");
  });
  it("is wired into the CI post-apply checks", () => {
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain(
      '{ file: "scripts/recon/orders-updated-at-0292-pg-check.sql", mustPrint: "USAGE 0292 CHECK PASSED" }',
    );
  });
});

describe("USAGE-6 · owner diagnostics are read-only", () => {
  for (const f of [DIAG, TOP]) {
    it(`${f} only reads`, () => {
      const s = noComments(read(f)).toLowerCase();
      expect(s).toContain("set transaction read only");
      expect(s).toMatch(/^rollback;$/m);
      for (const bad of ["insert ", "update ", "delete ", "drop ", "create ", "alter ", "truncate", "vacuum", "reindex"]) {
        expect(s.includes(bad), `${f}: ${bad}`).toBe(false);
      }
    });
  }
  it("the diagnose script covers cache, seq scans, sizes and unused indexes", () => {
    const s = read(DIAG);
    for (const k of ["pg_statio_user_tables", "pg_statio_user_indexes", "seq_tup_read", "pg_total_relation_size", "idx_scan = 0"]) {
      expect(s, k).toContain(k);
    }
    expect(s).toContain("'DISK IO DIAGNOSE DONE'");
  });
  it("the top-queries script orders pg_stat_statements by disk reads", () => {
    expect(flat(read(TOP))).toContain("from pg_stat_statements order by shared_blks_read desc limit 20");
  });
});

describe("USAGE-6 · platform facts are quoted from the mirrors", () => {
  const disk = flat(read(MIRROR_DISK));
  const io = flat(read(MIRROR_IO));
  it("both mirrors exist with a SOURCE line and fingerprint", () => {
    for (const f of [MIRROR_DISK, MIRROR_IO]) {
      expect(existsSync(path.join(ROOT, f))).toBe(true);
      expect(read(f)).toMatch(/^SOURCE: https:\/\/supabase\.com\/docs\/.+sha256 of the HTML: [0-9a-f]{64}$/m);
    }
  });
  const quotes: Record<string, string> = {
    burst: "Compute sizes up to 2XL can burst above their baseline for short periods of time, drawing on a disk IO budget",
    gp3: "The default disk type is gp3, which comes with a baseline throughput of 125 MB/s and a default IOPS of 3,000",
    lower: "The effective IOPS is the lower of the IOPS supported by the compute size or the provisioned IOPS of the disk.",
    lowest: "the lowest sampled balance over the last seven days",
    hide: "can hide periods when the balance was exhausted",
  };
  for (const [k, q] of Object.entries(quotes)) {
    it(`"${k}" is verbatim in the compute-and-disk mirror and in the roadmap`, () => {
      expect(disk.includes(q), k).toBe(true);
      expect(flat(read("docs/USAGE-BLEED-ROADMAP.md")).includes(q), k).toBe(true);
    });
  }
  it("the Large row reads 79 / 594 MB/s and 3,600 / 20,000 IOPS in the mirror", () => {
    expect(disk).toContain("Large 79 MB/s 594 MB/s 3,600 IOPS 20,000 IOPS");
    expect(disk).toContain("Small 22 MB/s 261 MB/s 1,000 IOPS 11,800 IOPS");
  });
  it("the IO guide names Database Health and the common causes", () => {
    expect(io).toContain("Database Health in the Observability section");
    expect(io).toContain("Low Cache Usage:");
    expect(io).toContain("Query performance:");
  });
});

describe("USAGE-6 · docs", () => {
  it("roadmap has the Slice 6 section and its verify paragraph", () => {
    const r = read("docs/USAGE-BLEED-ROADMAP.md");
    expect(r).toContain("## Slice 6 — Disk IO budget: the Orders board poll stops scanning (PR: USAGE-6)");
    expect(r).toContain("**Slice 6.** After 0292 is applied");
  });
  it("analytics pruning is a recommendation, not code", () => {
    const r = read("docs/USAGE-BLEED-ROADMAP.md");
    expect(r).toContain("deleting data needs the owner's approval");
    expect(read(MIG).toLowerCase()).not.toContain("website_web_vitals");
  });
  it("MIGRATIONS_TO_RUN lists 0292 after 0291 with its check and rollback", () => {
    const m = read("docs/MIGRATIONS_TO_RUN.md");
    const i291 = m.indexOf("## R41 — 0291");
    const i292 = m.indexOf("## USAGE-6 — 0292");
    expect(i291).toBeGreaterThan(0);
    expect(i292).toBeGreaterThan(i291);
    const sec = m.slice(i292);
    expect(sec).toContain("Apply it **after 0291**");
    expect(sec).toContain("USAGE 0292 CHECK PASSED");
    expect(sec).toContain(RB);
    expect(sec).toContain("Manual test T-379.");
  });
  it("TEST-PLAN and the test manual carry T-379", () => {
    expect(read("docs/audit/TEST-PLAN.md")).toContain("- **T-379 (");
    const h = read("docs/audit/test-manual/index.html");
    expect(h).toContain('data-test="T-379"');
    expect(h).toContain('"T-379": "part-b--the-results-log"');
  });
});
