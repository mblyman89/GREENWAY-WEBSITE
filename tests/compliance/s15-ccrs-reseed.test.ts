/**
 * S-15 (CCRS Bible v2 Part 17 §G, fresh copy G-1; U-30): re-seed / diff of the
 * production ledger from a LATER LCB Service Desk delivery.
 *
 * Why this matters to the license: the ledger decides Insert vs Update for
 * every row we send. It was seeded from the delivery current through
 * 2026-09-18, and Cultivera kept filing after that. A lot Cultivera created
 * later is missing, so we would Insert it and CCRS would refuse a duplicate.
 * But the copy may be OLDER than our own filings, so it must never overwrite
 * what our files recorded. These tests pin:
 *   1. Every bucket of the merge rule: what is written (add / refresh /
 *      settle) and what is only reported (our filings, deleted, missing).
 *   2. The safety gates: --as-of after 9/18, an unseeded ledger refused,
 *      seed rows missing from the copy refused unless accepted by exact count,
 *      --expect required to write, guards on every written row.
 *   3. The apply SQL is ONE transaction, guarded, and is EXACTLY what CI runs
 *      on a real Postgres (scripts/recon/ccrs-reseed-pg-check.sql is generated
 *      and compared here byte for byte).
 *   4. The script end to end against a saved ledger file (no database).
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_SEED_AS_OF,
  LEDGER_READ_SQL,
  LINK_SOURCE,
  ReseedError,
  __runCcrsReseedCoreTests,
  applyRefusal,
  parseLedgerLine,
  planReseed,
  reseedApplySql,
  reseedApplyStatements,
  reseedReport,
  reseedSource,
  samePayload,
  type LedgerRow,
} from "@/lib/compliance/ccrs-reseed-core";
import { SEED_SOURCE, buildLedgerSeed, type SeedEntity, type SeedSource } from "@/lib/compliance/ccrs-ledger-seed-core";
import { routeOperation, buildLedgerView } from "@/lib/compliance/ccrs-ledger-core";
import { FIXTURE_AS_OF, FIXTURE_PROVENANCE, buildReseedPgCheck, fixtureDeliveryTexts, fixturePlan } from "../../scripts/compliance/reseed-pg-check-fixture";
import { main } from "../../scripts/compliance/reseed-ccrs-ledger";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const ent = (t: SeedSource, id: string, over: Partial<SeedEntity> = {}): SeedEntity => ({
  env: "prod", fileType: t, externalId: id, filedName: t === "Inventory" ? null : id, productExternalId: null, state: "seed", source: SEED_SOURCE, seedPayload: { k: id }, seedConflicts: null, ...over,
});
const row = (t: SeedSource, id: string, over: Partial<LedgerRow> = {}): LedgerRow => ({
  t, id, name: t === "Inventory" ? null : id, prod: null, state: "seed", source: SEED_SOURCE, lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789898400000000", payload: { k: id }, ...over,
});
const AS_OF = "2026-11-08";
const plan1 = (copy: SeedEntity[], ledger: LedgerRow[]) => planReseed(copy, [row("Area", "ANCHOR"), ...ledger], AS_OF);
const anchor = ent("Area", "ANCHOR");
const PROV = FIXTURE_PROVENANCE;

describe("S-15 pure self-tests", () => {
  it("ccrs-reseed-core self-tests pass", () => {
    const r = __runCcrsReseedCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(12);
  });
});

describe("S-15 source tag and inputs", () => {
  it("--as-of becomes seed:<date>-delivery, which 0248's source regex accepts", () => {
    expect(reseedSource("2026-11-08")).toBe("seed:2026-11-08-delivery");
    expect(/^seed:[0-9]{4}-[0-9]{2}-[0-9]{2}-delivery$/.test(reseedSource("2026-11-08"))).toBe(true);
    expect(FIRST_SEED_AS_OF).toBe("2026-09-18");
    expect(SEED_SOURCE).toBe(`seed:${FIRST_SEED_AS_OF}-delivery`);
  });
  it("refuses the first seed's date, an earlier date, an impossible date and other formats", () => {
    for (const bad of ["2026-09-18", "2026-09-17", "2026-02-30", "2026-13-01", "11/08/2026", "2026-11-8", "", " 2026-11-08"]) {
      expect(() => reseedSource(bad), bad).toThrow(ReseedError);
    }
    expect(reseedSource("2026-09-19")).toBe("seed:2026-09-19-delivery");
  });
  it("parseLedgerLine accepts exactly the LEDGER_READ_SQL shape and refuses anything else", () => {
    const good = { t: "Inventory", id: "L1", name: null, prod: "P1", state: "seed", source: SEED_SOURCE, lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789898400000000", payload: { a: "1" } };
    expect(parseLedgerLine(JSON.stringify(good))).toEqual(good);
    const bad: Record<string, unknown>[] = [
      { ...good, t: "Sale" }, { ...good, state: "gone" }, { ...good, updatedAt: "2026-09-20 10:00:00+00" }, { ...good, updatedAt: 5 },
      { ...good, id: 7 }, { ...good, payload: [] }, { ...good, lastOp: 1 }, Object.fromEntries(Object.entries(good).filter(([k]) => k !== "lastOp")),
    ];
    for (const b of bad) expect(() => parseLedgerLine(JSON.stringify(b)), JSON.stringify(b)).toThrow(ReseedError);
    expect(() => parseLedgerLine("not json")).toThrow(/not JSON/);
  });
  it("LEDGER_READ_SQL reads prod Inventory/Product/Strain/Area with the guard in integer microseconds", () => {
    expect(LEDGER_READ_SQL).toContain("where e.env = 'prod' and e.file_type in ('Inventory', 'Product', 'Strain', 'Area')");
    expect(LEDGER_READ_SQL).toContain("(extract(epoch from e.updated_at) * 1000000)::bigint::text");
    expect(LEDGER_READ_SQL).toContain("left join public.ccrs_files f on f.id = e.last_file_id");
    for (const k of ["'t'", "'id'", "'name'", "'prod'", "'state'", "'source'", "'lastFile'", "'lastOp'", "'uploadedAt'", "'updatedAt'", "'payload'"]) expect(LEDGER_READ_SQL).toContain(k);
  });
  it("samePayload ignores key order only", () => {
    expect(samePayload({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
    expect(samePayload({ a: "1" }, { a: "2" })).toBe(false);
    expect(samePayload({ a: "1" }, { a: "1", b: "1" })).toBe(false);
    expect(samePayload({ a: "1", c: "1" }, { a: "1", b: "1" })).toBe(false);
    expect(samePayload(null, null)).toBe(true);
    expect(samePayload(null, {})).toBe(false);
  });
});

describe("S-15 merge rule: what is written", () => {
  it("add: an id the ledger lacks, with the seed's state rules kept", () => {
    const p = plan1([anchor, ent("Inventory", "NEW", { productExternalId: "P1" }), ent("Inventory", "NEW0", { state: "closed" }), ent("Product", "1", { state: "unknown" })], []);
    expect(p.writes.map((w) => [w.op, w.id, w.state])).toEqual([["add", "NEW", "seed"], ["add", "NEW0", "closed"], ["add", "1", "unknown"]]);
    expect(p.writes[0].prod).toBe("P1");
    expect(p.writes[0].expectState).toBeNull();
    expect(p.writes[0].expectUpdatedAt).toBeNull();
    expect(p.counts.add).toBe(3);
  });
  it("refresh: only an UNTOUCHED seed/closed row with a seed source, and only when the copy differs", () => {
    const p = plan1(
      [anchor, ent("Inventory", "Z", { state: "closed" }), ent("Inventory", "R", { state: "seed" }), ent("Product", "N", { filedName: "New" }), ent("Inventory", "D", { seedPayload: { k: "changed" } }), ent("Inventory", "S")],
      [row("Inventory", "Z"), row("Inventory", "R", { state: "closed" }), row("Product", "N", { name: "Old" }), row("Inventory", "D"), row("Inventory", "S")],
    );
    const by = Object.fromEntries(p.writes.map((w) => [w.id, w]));
    expect(by.Z.op).toBe("refresh");
    expect(by.Z.state).toBe("closed");
    expect(by.Z.why).toBe("seed -> closed");
    expect(by.R.state).toBe("seed");
    expect(by.N.why).toBe("name changed");
    expect(by.N.name).toBe("New");
    expect(by.D.why).toBe("details changed");
    expect(by.S).toBeUndefined();
    expect(p.counts.unchanged).toBe(2); // anchor + S
    expect(by.Z.expectState).toBe("seed");
    expect(by.Z.expectUpdatedAt).toBe("1789898400000000");
  });
  it("refresh reports a product change on a lot", () => {
    const p = plan1([anchor, ent("Inventory", "L", { productExternalId: "P2" })], [row("Inventory", "L", { prod: "P1" })]);
    expect(p.writes[0].why).toBe("product changed");
    expect(p.writes[0].prod).toBe("P2");
  });
  it("a seed row a file has touched is NOT refreshed (ours wins; reported if it disagrees)", () => {
    const p = plan1([anchor, ent("Inventory", "T", { state: "closed" })], [row("Inventory", "T", { lastFile: "f", lastOp: "Update", uploadedAt: "2026-11-01T20:00:00Z" })]);
    expect(p.writes).toEqual([]);
    expect(p.review.oursDiffers.map((i) => [i.id, i.why])).toEqual([["T", "ledger seed, copy closed"]]);
  });
  it("a seed/closed row whose source is not seed:* is not refreshed", () => {
    const p = plan1([anchor, ent("Inventory", "X", { state: "closed" })], [row("Inventory", "X", { source: "file:x.csv" })]);
    expect(p.writes).toEqual([]);
    expect(p.review.oursDiffers).toHaveLength(1);
  });
  it("settleLink: an untouched linker 'unknown' lot the copy now holds takes the copy's state", () => {
    const p = plan1([anchor, ent("Inventory", "M", { productExternalId: "P1" }), ent("Inventory", "M0", { state: "closed" }), ent("Inventory", "MJ", { state: "unknown" })],
      [row("Inventory", "M", { state: "unknown", source: LINK_SOURCE, payload: null }), row("Inventory", "M0", { state: "unknown", source: LINK_SOURCE, payload: null }), row("Inventory", "MJ", { state: "unknown", source: LINK_SOURCE, payload: null }), row("Inventory", "MX", { state: "unknown", source: LINK_SOURCE, payload: null })]);
    expect(p.writes.map((w) => [w.op, w.id, w.state])).toEqual([["settleLink", "M", "seed"], ["settleLink", "M0", "closed"]]);
    expect(p.counts.linkStillUnfiled).toBe(2); // MJ (copy junk) + MX (absent)
  });
  it("a linker row that a file touched is not settled by the copy", () => {
    const p = plan1([anchor, ent("Inventory", "M")], [row("Inventory", "M", { state: "unknown", source: LINK_SOURCE, lastFile: "f", lastOp: "Insert", payload: null })]);
    expect(p.writes).toEqual([]);
    expect(p.review.oursDiffers.map((i) => i.why)).toEqual(["ledger unknown, the copy holds a real record"]);
  });
  it("settleUncertain: uploaded strictly before 00:00 UTC of the as-of day -> confirmed (or closed for QoH 0)", () => {
    const p = plan1([anchor, ent("Inventory", "U"), ent("Inventory", "U0", { state: "closed" }), ent("Product", "UP", { filedName: "Copy Name" })], [
      row("Inventory", "U", { state: "uncertain", lastFile: "f", lastOp: "Update", uploadedAt: "2026-11-07T23:59:59.999Z" }),
      row("Inventory", "U0", { state: "uncertain", lastFile: "f", lastOp: "Insert", uploadedAt: "2026-11-01T00:00:00Z" }),
      row("Product", "UP", { state: "uncertain", lastFile: "f", lastOp: "Insert", uploadedAt: "2026-11-01T00:00:00Z", name: "Ours" }),
    ]);
    expect(p.writes.map((w) => [w.op, w.id, w.state])).toEqual([["settleUncertain", "U", "confirmed"], ["settleUncertain", "U0", "closed"], ["settleUncertain", "UP", "confirmed"]]);
    expect(p.writes[2].name).toBe("Copy Name");
    expect(p.writes[0].expectState).toBe("uncertain");
  });
  it("uncertain NOT settled: uploaded at/after the as-of day, no upload time, a Delete, or junk in the copy", () => {
    const p = plan1([anchor, ent("Inventory", "A"), ent("Inventory", "B"), ent("Inventory", "C"), ent("Product", "1", { state: "unknown" })], [
      row("Inventory", "A", { state: "uncertain", lastFile: "f", lastOp: "Update", uploadedAt: "2026-11-08T00:00:00Z" }),
      row("Inventory", "B", { state: "uncertain", lastFile: "f", lastOp: "Update", uploadedAt: null }),
      row("Inventory", "C", { state: "uncertain", lastFile: "f", lastOp: "Delete", uploadedAt: "2026-11-01T00:00:00Z" }),
      row("Product", "1", { state: "uncertain", lastFile: "f", lastOp: "Insert", uploadedAt: "2026-11-01T00:00:00Z" }),
    ]);
    expect(p.writes).toEqual([]);
    expect(p.review.uncertainNotProven.map((i) => [i.id, i.why])).toEqual([
      ["A", "its file was uploaded 2026-11-08T00:00:00Z, not before the copy date 2026-11-08"],
      ["B", "no upload time on its file"],
      ["C", "its last file asked for a Delete; whether a copy lists Deleted records is not verified"],
      ["1", "the copy holds it only as a known-junk id"],
    ]);
  });
});

describe("S-15 merge rule: what is only reported", () => {
  it("our filing (filed/confirmed/closed) is never written; disagreement is reported with the reason", () => {
    const p = plan1([anchor, ent("Inventory", "F", { state: "closed" }), ent("Inventory", "G", { productExternalId: "P9" }), ent("Product", "H", { filedName: "Copy" }), ent("Inventory", "K"), ent("Inventory", "Q", { seedPayload: { other: "x" } })], [
      row("Inventory", "F", { state: "filed", source: "file:a", lastFile: "f", lastOp: "Update" }),
      row("Inventory", "G", { state: "confirmed", source: "file:a", lastFile: "f", lastOp: "Insert", prod: "P1" }),
      row("Product", "H", { state: "filed", source: "file:a", lastFile: "f", lastOp: "Update", name: "Ours" }),
      row("Inventory", "K", { state: "closed", source: "file:a", lastFile: "f", lastOp: "Update" }),
      row("Inventory", "Q", { state: "filed", source: "file:a", lastFile: "f", lastOp: "Update", payload: null }),
    ]);
    expect(p.writes).toEqual([]);
    expect(p.review.oursDiffers.map((i) => [i.id, i.why])).toEqual([
      ["F", "ledger filed, copy seed".replace("seed", "closed")],
      ["G", 'product "P1" vs "P9"'],
      ["H", 'name "Ours" vs "Copy"'],
      ["K", "ledger closed, copy seed"],
    ]);
    expect(p.counts.unchanged).toBe(2); // anchor + Q (payload is not a disagreement for our filings)
  });

  it("only seed/closed rows are refreshable: a filed/confirmed row is never written even with a seed source and no file", () => {
    // Defensive: the merge keys on STATE first, so a row in a state our pipeline
    // owns is never overwritten from a copy, whatever its source/lastFile say.
    const p = plan1([anchor, ent("Product", "FS", { filedName: "Copy" }), ent("Product", "CS", { filedName: "Copy" })], [
      row("Product", "FS", { state: "filed", name: "Ours" }),
      row("Product", "CS", { state: "confirmed", name: "Ours" }),
    ]);
    expect(p.writes).toEqual([]);
    expect(p.review.oursDiffers.map((i) => i.id)).toEqual(["FS", "CS"]);
  });
  it("Inventory filed_name is never compared (lots carry their name from the Product, S-12a)", () => {
    const p = plan1([anchor, ent("Inventory", "N", { filedName: null })], [row("Inventory", "N", { state: "filed", source: "file:a", lastFile: "f", lastOp: "Insert", name: "anything" })]);
    expect(p.review.oursDiffers).toEqual([]);
  });
  it("deleted in the ledger but present in the copy is reported, never revived", () => {
    const p = plan1([anchor, ent("Inventory", "D")], [row("Inventory", "D", { state: "deleted", source: "file:a", lastFile: "f", lastOp: "Delete" })]);
    expect(p.writes).toEqual([]);
    expect(p.review.deletedPresent.map((i) => i.id)).toEqual(["D"]);
  });
  it("seeded junk (Product '1', unknown, untouched) is left alone either way", () => {
    expect(plan1([anchor, ent("Product", "1", { state: "unknown" })], [row("Product", "1", { state: "unknown" })]).writes).toEqual([]);
    const p = plan1([anchor, ent("Product", "1")], [row("Product", "1", { state: "unknown" })]);
    expect(p.writes).toEqual([]);
    expect(p.review.oursDiffers).toHaveLength(1);
  });
  it("ledger rows absent from the copy go to the right bucket", () => {
    const p = plan1([anchor], [
      row("Inventory", "SEEDGONE"), row("Inventory", "CLOSEDGONE", { state: "closed" }),
      row("Inventory", "UNCGONE", { state: "uncertain", lastFile: "f", lastOp: "Insert" }),
      row("Inventory", "UNCDEL", { state: "uncertain", lastFile: "f", lastOp: "Delete" }),
      row("Inventory", "OURS", { state: "filed", source: "file:a", lastFile: "f", lastOp: "Insert", uploadedAt: "2026-11-09T00:00:00Z" }),
      row("Inventory", "OURS2", { state: "confirmed", source: "file:a", lastFile: "f", lastOp: "Insert" }),
      row("Inventory", "TOUCHEDSEED", { lastFile: "f", lastOp: "Update" }),
      row("Inventory", "DELGONE", { state: "deleted", source: "file:a", lastFile: "f", lastOp: "Delete" }),
      row("Inventory", "LINKGONE", { state: "unknown", source: LINK_SOURCE, payload: null }),
      row("Product", "JUNKGONE", { state: "unknown" }),
    ]);
    // a seeded junk id the copy no longer holds is also "missing": the partial-copy signal does not skip junk
    expect(p.review.seedMissing.map((i) => i.id)).toEqual(["SEEDGONE", "CLOSEDGONE", "JUNKGONE"]);
    expect(p.review.uncertainAbsent.map((i) => [i.id, i.why])).toEqual([
      ["UNCGONE", "uncertain, and the copy does not hold it"],
      ["UNCDEL", "uncertain Delete, and the copy does not hold it (the Delete may have landed)"],
    ]);
    expect(p.review.oursMissing.map((i) => [i.id, i.why])).toEqual([["OURS", "filed by us (uploaded 2026-11-09T00:00:00Z)"], ["OURS2", "filed by us"], ["TOUCHEDSEED", "filed by us"]]);
    expect(p.review.deletedPresent).toEqual([]);
    expect(p.counts.linkStillUnfiled).toBe(1);
    expect(p.counts.review).toEqual({ uncertainAbsent: 2, uncertainNotProven: 0, oursDiffers: 0, deletedPresent: 0, seedMissing: 3, oursMissing: 3 });
  });
});

describe("S-15 refusals and gates", () => {
  it("refuses a ledger with no seed:* rows (never seeded), a duplicate ledger key, a duplicate copy key, a non-prod copy", () => {
    expect(() => planReseed([anchor], [row("Area", "A", { source: "file:x" })], AS_OF)).toThrow(/run seed-ccrs-ledger.ts first/);
    expect(() => planReseed([anchor], [], AS_OF)).toThrow(ReseedError);
    expect(() => plan1([anchor], [row("Inventory", "X"), row("Inventory", "X")])).toThrow(/twice/);
    expect(() => plan1([anchor, ent("Inventory", "X"), ent("Inventory", "X")], [])).toThrow(/twice/);
    expect(() => plan1([anchor, { ...ent("Inventory", "X"), env: "preprod" as "prod" }], [])).toThrow(/not prod/);
  });
  it("ids are exact: a trailing space or another case is a different record (CCRS matches the exact id)", () => {
    const p = plan1([anchor, ent("Inventory", "abc "), ent("Inventory", "ABC")], [row("Inventory", "abc")]);
    expect(p.writes.map((w) => [w.op, w.id])).toEqual([["add", "abc "], ["add", "ABC"]]);
    expect(p.review.seedMissing.map((i) => i.id)).toEqual(["abc"]);
  });
  it("the same id under two file types is two records", () => {
    const p = plan1([anchor, ent("Product", "X"), ent("Inventory", "X")], [row("Product", "X")]);
    expect(p.writes.map((w) => [w.op, w.t])).toEqual([["add", "Inventory"]]);
  });
  it("applyRefusal: seed rows missing need the EXACT count; a count given when none are missing is refused too", () => {
    const missing = plan1([anchor], [row("Inventory", "G1"), row("Inventory", "G2")]);
    expect(applyRefusal(missing, null)).toMatch(/2 seeded record\(s\) are missing from this copy.*--accept-seed-missing 2/);
    expect(applyRefusal(missing, 1)).not.toBeNull();
    expect(applyRefusal(missing, 3)).not.toBeNull();
    expect(applyRefusal(missing, 2)).toBeNull();
    const none = plan1([anchor], []);
    expect(applyRefusal(none, null)).toBeNull();
    expect(applyRefusal(none, 0)).toBeNull();
    expect(applyRefusal(none, 4)).toMatch(/none are missing/);
  });
  it("a second plan after the apply plans nothing (idempotent by construction)", () => {
    const { plan, ledger, copy } = fixturePlan();
    const byKey = new Map(plan.writes.map((w) => [`${w.t}\u0000${w.id}`, w]));
    const after: LedgerRow[] = ledger.map((r) => {
      const w = byKey.get(`${r.t}\u0000${r.id}`);
      return w ? { ...r, state: w.state, name: w.name, prod: w.prod, payload: w.payload, source: plan.source, updatedAt: "1789990000000000" } : r;
    });
    for (const w of plan.writes.filter((x) => x.op === "add")) after.push({ t: w.t, id: w.id, name: w.name, prod: w.prod, state: w.state, source: plan.source, lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789990000000000", payload: w.payload });
    const again = planReseed(copy, after, FIXTURE_AS_OF);
    // settleUncertain wrote "confirmed": that row is now "ours", and agrees with the copy
    expect(again.writes).toEqual([]);
    expect(again.counts.review.oursDiffers).toBe(plan.counts.review.oursDiffers);
  });
});

describe("S-15 apply SQL", () => {
  const { plan } = fixturePlan();
  it("is one transaction: begin, the advisory lock finalize uses, the seeded check, staging, the guarded merge, provenance, commit", () => {
    const sql = reseedApplySql(plan, PROV);
    expect(sql.startsWith("begin;\nset local statement_timeout = 0;\ndo $$ begin perform pg_advisory_xact_lock(hashtext('ccrs_seed_finalize')); end $$;\n")).toBe(true);
    expect(sql.endsWith("commit;\n")).toBe(true);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql).toContain("CCRS_RESEED_NOT_SEEDED");
    expect(sql).toContain("purpose = 'seed' and state = 'closed'");
    expect(sql).toContain("on commit drop");
    const order = ["CCRS_RESEED_NOT_SEEDED", "insert into ccrs_reseed_stage", "CCRS_RESEED_STALE", "ccrs_link_unfiled_migration_lots(true)", "insert into public.ccrs_files"].map((s) => sql.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("every update is guarded by the state AND updated_at the plan saw, and both counts are asserted", () => {
    const sql = reseedApplySql(plan, PROV);
    expect(sql).toContain("and e.state = s.expect_state and (extract(epoch from e.updated_at) * 1000000)::bigint = s.expect_us;");
    expect(sql).toContain(`if v_add <> ${plan.counts.add} then`);
    expect(sql).toContain(`if v_upd <> ${plan.counts.refresh + plan.counts.settleLink + plan.counts.settleUncertain} then`);
    expect(sql).toContain(`if v_stage <> ${plan.writes.length} then`);
    expect(sql).toContain("on conflict (env, file_type, external_id) do nothing;");
    expect(sql).toContain("where s.op <> 'add' and e.env = 'prod'");
  });
  it("writes the new source on every written row, and provenance names the new delivery", () => {
    const sql = reseedApplySql(plan, PROV);
    expect(sql.match(/'seed:2026-11-08-delivery'/g)!.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("'seed:2026-11-08-delivery:111111111111:Inventory_fixture.csv'");
    expect(sql).toContain("+2 new, 3 refreshed, 1 migration lots, 1 uncertain settled.");
  });
  it("quotes are doubled in ids and payloads (the fixture has O'Brien.LOT)", () => {
    const sql = reseedApplySql(plan, PROV);
    expect(sql).toContain("'O''Brien.LOT'");
    expect(sql).not.toMatch(/[^']'O'Brien/);
  });
  it("batches the staging insert", () => {
    const st = reseedApplyStatements(plan, PROV, 2);
    expect(st.filter((s) => s.startsWith("insert into ccrs_reseed_stage")).length).toBe(Math.ceil(plan.writes.length / 2));
  });
  it("refuses bad provenance and a malformed plan", () => {
    expect(() => reseedApplySql(plan, PROV.slice(0, 3))).toThrow(/exactly one provenance entry/);
    expect(() => reseedApplySql(plan, [...PROV.slice(0, 3), { ...PROV[0] }])).toThrow(/exactly one provenance entry/);
    expect(() => reseedApplySql(plan, PROV.map((p, i) => (i === 1 ? { ...p, sha256: "XYZ" } : p)))).toThrow(/64 lower-case hex/);
    expect(() => reseedApplySql(plan, PROV.map((p, i) => (i === 1 ? { ...p, rows: -1 } : p)))).toThrow(/row count/);
    const w0 = plan.writes.find((w) => w.op === "refresh")!;
    expect(() => reseedApplySql({ ...plan, writes: [{ ...w0, expectUpdatedAt: "1; drop table x" }] }, PROV)).toThrow(/integer microseconds/);
    expect(() => reseedApplySql({ ...plan, writes: [{ ...w0, expectState: null }] }, PROV)).toThrow(/only an add has no guard/);
    const a0 = plan.writes.find((w) => w.op === "add")!;
    expect(() => reseedApplySql({ ...plan, writes: [{ ...a0, expectState: "seed" }] }, PROV)).toThrow(/only an add has no guard/);
  });
});

describe("S-15 the SQL CI runs is the SQL the script sends", () => {
  it("scripts/recon/ccrs-reseed-pg-check.sql equals the generator output byte for byte", () => {
    expect(read("scripts/recon/ccrs-reseed-pg-check.sql")).toBe(buildReseedPgCheck());
  });
  it("the pg-check embeds every apply statement, unchanged", () => {
    const pg = read("scripts/recon/ccrs-reseed-pg-check.sql");
    for (const s of reseedApplyStatements(fixturePlan().plan, FIXTURE_PROVENANCE)) expect(pg).toContain(s);
  });
  it("the pg-check proves the stale refusals, the outcomes and the all-clear line, and rolls back", () => {
    const pg = read("scripts/recon/ccrs-reseed-pg-check.sql");
    expect(pg.match(/'CCRS_RESEED_STALE'\);/g)).toHaveLength(3);
    expect(pg).toContain("'CCRS_RESEED_NOT_SEEDED');");
    for (const m of ["'new lot added with the new source'", "'zeroed lot refreshed to closed'", "'uncertain proven by the copy -> confirmed'", "'our filing untouched'", "'deleted stays deleted'", "'unfiled migration lot still held'", "'migration lot linked as unknown'", "'provenance recorded'", "'stale refusal wrote nothing'"]) {
      expect(pg).toContain(m);
    }
    expect(pg).toContain("raise notice 'CCRS RESEED CHECK PASSED'");
    expect(pg.trimEnd().endsWith("rollback;")).toBe(true);
  });
  it("is registered as a post-apply check in CI's migration run", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-reseed-pg-check.sql", mustPrint: "CCRS RESEED CHECK PASSED" });
  });
  it("the fixture covers every write and review bucket", () => {
    const c = fixturePlan().plan.counts;
    for (const k of ["add", "refresh", "settleLink", "settleUncertain", "unchanged", "linkStillUnfiled"] as const) expect(c[k], k).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(c.review)) expect(v, k).toBeGreaterThan(0);
  });
});

describe("S-15 routing after the merge", () => {
  it("added lots route as Update (no duplicate Insert); settled uncertain routes as Update; unproven stays withheld", () => {
    const { plan, ledger } = fixturePlan();
    const byKey = new Map(plan.writes.map((w) => [`${w.t}\u0000${w.id}`, w]));
    const rows = ledger.map((r) => {
      const w = byKey.get(`${r.t}\u0000${r.id}`);
      return { fileType: r.t, externalId: r.id, filedName: w ? w.name : r.name, state: w ? w.state : r.state, productExternalId: w ? w.prod : r.prod };
    });
    for (const w of plan.writes.filter((x) => x.op === "add")) rows.push({ fileType: w.t, externalId: w.id, filedName: w.name, state: w.state, productExternalId: w.prod });
    const { view, duplicates } = buildLedgerView("prod", rows);
    expect(duplicates).toEqual([]);
    expect(routeOperation(view, "Inventory", "LOT-NEW", "upsert").op).toBe("Update");
    expect(routeOperation(view, "Inventory", "UNC-1", "upsert").op).toBe("Update");
    expect(routeOperation(view, "Inventory", "MIG-1", "upsert").op).toBe("Update");
    expect(routeOperation(view, "Inventory", "UNC-LATE", "upsert").op).toBe("withhold");
    expect(routeOperation(view, "Inventory", "DEL-1", "upsert").op).toBe("withhold");
    expect(routeOperation(view, "Inventory", "MIG-2", "upsert").op).toBe("withhold");
    expect(routeOperation(view, "Product", "1", "upsert").op).toBe("withhold");
  });
});

describe("S-15 report", () => {
  it("lists every change count and every review section with its items", () => {
    const md = reseedReport(fixturePlan().plan);
    expect(md).toContain("# CCRS ledger re-seed plan: delivery current through 2026-11-08");
    expect(md).toContain("| New | 2 |");
    expect(md).toContain("| Refreshed | 3 |");
    expect(md).toContain("| Migration lots now filed | 1 |");
    expect(md).toContain("| Uncertain settled | 1 |");
    expect(md).toContain("Migration lots still not on the record: 1");
    for (const s of ["Seeded records missing from this copy: 1", "Uncertain, not in the copy: 1", "Uncertain, not proven by this copy: 1", "Our filings that the copy disagrees with: 1", "Deleted in the ledger, still in the copy: 1", "Our filings not in the copy: 1"]) expect(md).toContain(`### ${s}`);
    expect(md).toContain("| Inventory | LOT-GONE | seed | seeded earlier, missing from this copy |");
  });
  it("escapes table characters and caps long sections", () => {
    const p = plan1([anchor], Array.from({ length: 5 }, (_, i) => row("Inventory", `a|b_${i}`)));
    const md = reseedReport(p, 3);
    expect(md).toContain("a\\|b\\_0");
    expect(md).not.toContain("| a|b");
    expect(md).toContain("| ... | 2 more | | |");
  });
});

describe("S-15 script end to end (saved ledger file, no database)", () => {
  let dir: string;
  let errs: string[];
  let logs: string[];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "s15-"));
    const t = fixtureDeliveryTexts();
    for (const [k, v] of Object.entries(t)) writeFileSync(path.join(dir, `${k}.csv`), v);
    writeFileSync(path.join(dir, "ledger.jsonl"), fixturePlan().ledger.map((r) => JSON.stringify(r)).join("\n") + "\n");
    errs = [];
    logs = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => { errs.push(String(m)); });
    vi.spyOn(console, "log").mockImplementation((m: unknown) => { logs.push(String(m)); });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });
  const files = () => ["--inventory", path.join(dir, "Inventory.csv"), "--product", path.join(dir, "Product.csv"), "--strain", path.join(dir, "Strain.csv"), "--area", path.join(dir, "Area.csv"), "--ledger-file", path.join(dir, "ledger.jsonl")];
  const run = (...extra: string[]) => main(["node", "reseed-ccrs-ledger.ts", "--as-of", FIXTURE_AS_OF, ...files(), ...extra]);
  const counts = () => JSON.stringify(buildLedgerSeed(fixtureDeliveryTexts()).counts);

  it("plan only: prints counts and the plan, writes the report, touches nothing else", () => {
    expect(run("--report", path.join(dir, "plan.md"))).toBe(0);
    expect(logs[0]).toBe(`copy counts: ${counts()}`);
    expect(logs[1]).toMatch(/^plan: \+2 new, 3 refreshed, 1 migration lots, 1 uncertain settled, 5 unchanged; review /);
    expect(logs.at(-1)).toBe("plan only (no --sql-file / --apply): nothing written to the database");
    expect(readFileSync(path.join(dir, "plan.md"), "utf8")).toBe(reseedReport(fixturePlan().plan));
  });
  it("writing needs --expect equal to the copy counts", () => {
    expect(run("--sql-file", path.join(dir, "r.sql"))).toBe(1);
    expect(errs.join("\n")).toMatch(/--expect '<copy counts>' is required/);
    expect(existsSync(path.join(dir, "r.sql"))).toBe(false);
    errs.length = 0;
    expect(run("--sql-file", path.join(dir, "r.sql"), "--expect", counts().replace('"Area":1', '"Area":2'))).toBe(1);
    expect(errs.join("\n")).toMatch(/copy counts differ from --expect/);
    expect(existsSync(path.join(dir, "r.sql"))).toBe(false);
  });
  it("writing refuses missing seed rows unless the exact count is accepted", () => {
    expect(run("--sql-file", path.join(dir, "r.sql"), "--expect", counts())).toBe(1);
    expect(errs.join("\n")).toMatch(/1 seeded record\(s\) are missing/);
    expect(existsSync(path.join(dir, "r.sql"))).toBe(false);
    expect(run("--sql-file", path.join(dir, "r.sql"), "--expect", counts(), "--accept-seed-missing", "2")).toBe(1);
    expect(existsSync(path.join(dir, "r.sql"))).toBe(false);
  });
  it("--sql-file writes exactly reseedApplySql with the real file hashes", () => {
    expect(run("--sql-file", path.join(dir, "r.sql"), "--expect", counts(), "--accept-seed-missing", "1")).toBe(0);
    const sql = readFileSync(path.join(dir, "r.sql"), "utf8");
    const t = fixtureDeliveryTexts();
    const prov = (["Inventory", "Product", "Strain", "Area"] as const).map((k) => ({ source: k, fileName: `${k}.csv`, sha256: createHash("sha256").update(Buffer.from(t[k], "utf8")).digest("hex"), rows: buildLedgerSeed(t).counts.sourceRows[k] }));
    expect(sql).toBe(reseedApplySql(fixturePlan().plan, prov));
    expect(logs.at(-1)).toMatch(/^wrote .*r\.sql \(\d+ bytes, sha256 [0-9a-f]{64}\)\. Run: psql/);
  });
  it("never overwrites an existing --sql-file or --report", () => {
    writeFileSync(path.join(dir, "r.sql"), "keep");
    expect(run("--sql-file", path.join(dir, "r.sql"), "--expect", counts(), "--accept-seed-missing", "1")).toBe(2);
    expect(readFileSync(path.join(dir, "r.sql"), "utf8")).toBe("keep");
    writeFileSync(path.join(dir, "p.md"), "keep");
    expect(run("--report", path.join(dir, "p.md"))).toBe(2);
    expect(readFileSync(path.join(dir, "p.md"), "utf8")).toBe("keep");
  });
  it("bad arguments exit 2; refusals exit 1", () => {
    expect(main(["node", "x", ...files()])).toBe(2); // no --as-of
    expect(run("--apply")).toBe(2); // --apply without --psql
    expect(run("--apply", "--sql-file", path.join(dir, "r.sql"))).toBe(2);
    expect(run("--accept-seed-missing", "one")).toBe(2);
    expect(main(["node", "x", "--as-of", FIXTURE_AS_OF, "--inventory", path.join(dir, "nope.csv")])).toBe(2);
    expect(main(["node", "x", "--as-of", "2026-09-18", ...files()])).toBe(1);
    expect(main(["node", "x", "--as-of", FIXTURE_AS_OF, ...files().slice(0, 8)])).toBe(1); // no ledger source
    expect(errs.join("\n")).toMatch(/--psql <PGURL> or --ledger-file/);
  });
  it("a delivery whose header changed is refused (the seed reader's exact-header rule)", () => {
    writeFileSync(path.join(dir, "Area.csv"), "Name,IsQuarantine,ExternalId\r\nx,FALSE,A\r\n");
    expect(run()).toBe(1);
    expect(errs.join("\n")).toMatch(/Area: header does not match the delivery layout/);
  });
});

describe("S-15 wiring and guards", () => {
  const CLI = read("scripts/compliance/reseed-ccrs-ledger.ts");
  const CORE = read("src/lib/compliance/ccrs-reseed-core.ts");
  it("the core is pure (no I/O, no clock, no Supabase)", () => {
    expect(CORE).not.toMatch(/from "node:|require\(|Date\.now\(|new Date\(\)|supabase|fetch\(/);
  });
  it("the CLI sends the one-transaction script with ON_ERROR_STOP and never edits the seed script's constant", () => {
    expect(CLI).toContain('execFileSync("psql", [arg(argv, "psql")!, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql');
    expect(read("scripts/compliance/seed-ccrs-ledger.ts")).toContain("export const EXPECTED_2026_09_18 = {");
  });
  it("no migration is added for S-15 (the merge is plain SQL under the existing grants)", () => {
    const last = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f: string) => /^\d{4}_.*\.sql$/.test(f)).sort().at(-1);
    expect(last).toBe("0332_money_path_smoke_test.sql");
  });
});
