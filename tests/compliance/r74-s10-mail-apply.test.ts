/**
 * tests/compliance/r74-s10-mail-apply.test.ts — R74 S10, the email step's executor (Wave 2).
 *
 * Pins, against a stateful in-memory PostgREST fake:
 *   - the pure core's self-tests (floor = measured count) and the re-home's new "leave
 *     email-placed lots alone" rule;
 *   - BOTH orders: email step before the re-home (lots leave the POS-IMPORT manifest) and after it
 *     (lots leave the received-date manifests, which are then removed when empty);
 *   - the re-home afterwards never pulls an email-placed lot back and stays "done";
 *   - preview is read-only, Apply runs only the previewed plan (digest), is idempotent, resumes
 *     after a crash, verifies from a DB re-read, upgrades lots off CV-UNMATCHED after a later
 *     harvest (lineage grows FIRST), refuses before 0293 / with no documents / on a foreign key;
 *   - rollback restores the original placement and never destroys work;
 *   - the wiring (permissions, attest, digest, audit, page, server-only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __runCultiveraMailApplyCoreTests, EMAIL_GROUP_KIND, UNMATCHED_GROUP_KIND } from "../../src/lib/pos/cultivera-mail-apply-core";
import { applyMailPlan, mailApplyDigest, previewMailApply, rollbackMailPlan } from "../../src/lib/pos/cultivera-mail-apply-store";
import { applyRehome, previewRehome, type RehomeSources } from "../../src/lib/inventory/cultivera-rehome-store";
import { __runCultiveraRehomeCoreTests, buildPlanInputs, REHOME_EXISTING_SELECT } from "../../src/lib/inventory/cultivera-rehome-core";
import { rehomeStage } from "../../src/lib/inventory/cultivera-rehome-ui-core";
import { POS_IMPORT_MANIFEST_KIND, RECONSTRUCTED_MANIFEST_KIND } from "../../src/lib/inventory/cultivera-manifest-group-core";
import { posImportManifestNumber } from "../../src/lib/inventory/import-lineage-core";

const ROOT = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ---------------- fake PostgREST ---------------- */

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
type Op = "select" | "insert" | "update" | "delete";
type Fail = { table: string; op: Op; nth?: number; lie?: boolean; code?: string; before?: (db: Db) => void; pass?: boolean };

function colValue(r: Row, col: string): unknown {
  const j = /^raw_payload->(\w+)$/.exec(col);
  if (j) {
    const p = r.raw_payload as Row | null | undefined;
    return p ? (p[j[1]] ?? null) : null;
  }
  const m = /^raw_payload->>(\w+)$/.exec(col);
  if (m) {
    const p = r.raw_payload as Row | null | undefined;
    const v = p ? p[m[1]] : undefined;
    return v == null ? null : String(v);
  }
  return r[col];
}

function project(r: Row, select: string): Row {
  const out: Row = {};
  for (const part of select.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [alias, col] = part.includes(":") ? part.split(":") : [part, part];
    out[alias] = structuredClone(colValue(r, col));
  }
  return out;
}

// Ids must be unique across every fake client, as the database's are.
let seq = 0;

function fakeAdmin(db: Db, fails: Fail[] = []) {
  const counts: Record<string, number> = {};
  const failNow = (table: string, op: Op) => {
    const k = `${table}:${op}`;
    counts[k] = (counts[k] ?? 0) + 1;
    return fails.find((f) => f.table === table && f.op === op && (f.nth == null || f.nth === counts[k]));
  };
  return {
    from(table: string) {
      let op: Op = "select";
      let sel = "*";
      let head = false;
      let payload: Row[] | Row | null = null;
      let returning: string | null = null;
      let lim: number | null = null;
      let rng: [number, number] | null = null;
      const preds: ((r: Row) => boolean)[] = [];
      const run = () => {
        const f = failNow(table, op);
        if (f?.before) f.before(db);
        if (f && !f.lie && !f.pass) return { data: null, error: { message: f.code ? `relation "${table}" does not exist` : "boom", code: f.code }, count: null };
        db[table] ??= [];
        const rows = db[table];
        if (op === "insert") {
          const list: Row[] = (payload as Row[]).map((p) => ({ id: `gen-${table}-${++seq}`, ...structuredClone(p) }));
          if (table === "inbound_manifests") {
            const keys = new Set(rows.map((r) => r.dedupe_key));
            for (const r of list) {
              if (keys.has(r.dedupe_key)) return { data: null, error: { message: "duplicate key value violates unique constraint" }, count: null };
              keys.add(r.dedupe_key);
            }
          }
          rows.push(...list);
          return { data: returning ? list.map((r) => project(r, returning!)) : null, error: null, count: null };
        }
        const hit = rows.filter((r) => preds.every((p) => p(r)));
        if (op === "update") {
          if (!f?.lie) for (const r of hit) Object.assign(r, structuredClone(payload as Row));
          return { data: returning ? hit.map((r) => project(r, returning!)) : null, error: null, count: null };
        }
        if (op === "delete") {
          db[table] = rows.filter((r) => !hit.includes(r));
          return { data: returning ? hit.map((r) => project(r, returning!)) : null, error: null, count: null };
        }
        if (head) return { data: null, error: null, count: hit.length };
        let out = [...hit].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (rng) out = out.slice(rng[0], rng[1] + 1);
        if (lim != null) out = out.slice(0, lim);
        return { data: out.map((r) => project(r, sel)), error: null, count: null };
      };
      const b = {
        select(s: string, o?: { count?: string; head?: boolean }) {
          if (op === "select") sel = s;
          else returning = s;
          head = !!o?.head;
          return b;
        },
        insert(rows: Row[]) { op = "insert"; payload = rows; return b; },
        update(patch: Row) { op = "update"; payload = patch; return b; },
        delete() { op = "delete"; return b; },
        eq(col: string, v: unknown) { preds.push((r) => colValue(r, col) === v); return b; },
        neq(col: string, v: unknown) { preds.push((r) => colValue(r, col) !== v); return b; },
        in(col: string, vs: unknown[]) { preds.push((r) => vs.includes(colValue(r, col))); return b; },
        overlaps(col: string, vs: unknown[]) { preds.push((r) => Array.isArray(r[col]) && (r[col] as unknown[]).some((x) => vs.includes(x))); return b; },
        or(f: string) {
          const alts = f.split(",").map((x) => {
            const m = /^(.+)\.eq\.(.+)$/.exec(x)!;
            return [m[1], m[2]] as const;
          });
          preds.push((r) => alts.some(([c, v]) => colValue(r, c) === v));
          return b;
        },
        order() { return b; },
        limit(n: number) { lim = n; return b; },
        range(f: number, t: number) { rng = [f, t]; return b; },
        maybeSingle() { return b; },
        then<T>(res: (v: ReturnType<typeof run>) => T, rej?: (e: unknown) => T) {
          return new Promise<ReturnType<typeof run>>((ok) => setImmediate(() => ok(run()))).then(res, rej);
        },
      };
      return b;
    },
  } as never;
}

/* ---------------- seed ---------------- */

const IMP = "5c2c0000-0000-4000-8000-00000000000a";
const SRC = "5c2c1000-0000-4000-8000-000000000001";

/** A, B on the real Cultivera transfer 11. C, D, E are open: C on one emailed manifest (0007), D on none, E on two. */
function seed(): { db: Db; sources: RehomeSources } {
  const doc = (id: string, gmail: string, number: string | null, barcodes: string[], cost = 1234) => ({
    id,
    mailbox: "stephen@greenwaymarijuana.com",
    gmail_id: gmail,
    doc_index: 0,
    email_at: "2024-07-01T10:00:00Z",
    filename: `${gmail}.json`,
    status: "parsed",
    source_format: "wcia",
    manifest_number: number,
    vendor_label: "Leaf Co LLC",
    vendor_license: "412999",
    transfer_date: "2024-07-01",
    lines: barcodes.map((b) => [b, 2, `Leaf ${b} 3.5g`, "Usable Marijuana", cost]),
    barcodes,
  });
  const db: Db = {
    inbound_manifests: [
      { id: SRC, manifest_number: posImportManifestNumber(IMP), dedupe_key: `POS-IMPORT|${IMP}`, status: "accepted", raw_payload: { kind: POS_IMPORT_MANIFEST_KIND, import_id: IMP } },
      { id: "native-1", manifest_number: "WCIA-1", dedupe_key: "native|1", status: "accepted", raw_payload: { kind: "wcia" } },
    ],
    inventory_lots: [
      { id: "lot-a", manifest_id: SRC, ccrs_inventory_external_id: "A", vendor_id: null, on_hand_qty: 5, received_qty: 5, unit_cost_minor_units: 250, status: "active" },
      { id: "lot-b", manifest_id: SRC, ccrs_inventory_external_id: "B", vendor_id: null, on_hand_qty: 2, received_qty: 3, unit_cost_minor_units: 1000, status: "active" },
      { id: "lot-c", manifest_id: SRC, ccrs_inventory_external_id: "C", vendor_id: "v-leaf", on_hand_qty: 1, received_qty: 2, unit_cost_minor_units: 99, status: "active" },
      { id: "lot-d", manifest_id: SRC, ccrs_inventory_external_id: "D", vendor_id: "v-leaf", on_hand_qty: 4, received_qty: 4, unit_cost_minor_units: 10, status: "active" },
      { id: "lot-e", manifest_id: SRC, ccrs_inventory_external_id: "E", vendor_id: "v-leaf", on_hand_qty: 1, received_qty: 1, unit_cost_minor_units: 0, status: "active" },
      { id: "lot-n", manifest_id: "native-1", ccrs_inventory_external_id: "N", vendor_id: null, on_hand_qty: 9, received_qty: 9, unit_cost_minor_units: 1, status: "active" },
    ],
    manifest_events: [],
    catalog_product_drafts: [],
    pos_fact_reviews: [],
    manifest_documents: [],
    vendor_manifest_payments: [],
    cultivera_mail_docs: [doc("d1", "gm-c1", "0007", ["C", "Z-SOLD"]), doc("d2", "gm-c2", "0007", ["C"]), doc("d3", "gm-e1", "0008", ["E"]), doc("d4", "gm-e2", "0009", ["E"]), { ...doc("d5", "gm-pdf", null, []), status: "stored", source_format: null, lines: null, barcodes: [] }],
  };
  const inputs = buildPlanInputs({
    importId: IMP,
    runId: "run-1",
    pacificToday: "2024-09-10",
    transferDetails: [
      {
        Id: 11, TransferNumber: "0001234567", FromVendor: "Grow Co", TransferDate: "2024-08-30T15:00:00Z",
        DateAccepted: "2024-08-30T18:56:03.507Z", StatusDisplay: "Accepted",
        Details: [{ Barcode: "A", AcceptedQuantity: 5, Quantity: 5 }, { Barcode: "B", AcceptedQuantity: 3, Quantity: 3 }],
      },
    ],
    listLots: [{ Barcode: "A", IncomingTransferId: 11 }, { Barcode: "B", IncomingTransferId: 11 }, { Barcode: "C" }, { Barcode: "D" }, { Barcode: "E" }],
  });
  const sources: RehomeSources = {
    lotSources: [
      { barcode: "A", vendor: "Grow Co", receivedDateRaw: "2024-08-30 12:00:00.000", units: 5, productName: "Alpha" },
      { barcode: "B", vendor: "Grow Co", receivedDateRaw: "2024-08-30 12:00:00.000", units: 3, productName: "Beta" },
      { barcode: "C", vendor: "Leaf Co", receivedDateRaw: "2024-07-03 12:00:00.000", units: 1, productName: "Gamma" },
      { barcode: "D", vendor: "Leaf Co", receivedDateRaw: "2024-07-03 12:10:00.000", units: 4, productName: "Delta" },
      { barcode: "E", vendor: "Leaf Co", receivedDateRaw: "2024-07-03 12:20:00.000", units: 1, productName: "Eps" },
    ],
    transfers: inputs.transfers,
    links: new Map(inputs.links),
    pacificToday: inputs.pacificToday,
    indexSkipped: inputs.indexSkipped,
  };
  return { db, sources };
}

const lotsOn = (db: Db, id: string) => db.inventory_lots.filter((l) => l.manifest_id === id).map((l) => l.id).sort();
const byGroup = (db: Db, kind: string) => db.inbound_manifests.filter((m) => (m.raw_payload as Row)?.kind === RECONSTRUCTED_MANIFEST_KIND && (m.raw_payload as Row)?.group_kind === kind);
const homeOf = (db: Db, lotId: string) => {
  const mid = db.inventory_lots.find((l) => l.id === lotId)!.manifest_id;
  const m = db.inbound_manifests.find((x) => x.id === mid)!;
  return `${(m.raw_payload as Row).group_kind ?? (m.raw_payload as Row).kind}:${m.manifest_number}`;
};
const fingerprint = (db: Db) => JSON.stringify(db.inventory_lots.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== "manifest_id"))));

/* ---------------- 1. pure ---------------- */

describe("R74 S10 pure cores", () => {
  it("mail-apply core passes its self-tests (floor = measured 52)", () => {
    const r = __runCultiveraMailApplyCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(52);
  });
  it("re-home core still passes (floor raised to 76 with the email-placed rule)", () => {
    const r = __runCultiveraRehomeCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(76);
  });
  it("the re-home reads each manifest's group kind (it needs it to recognise the email step)", () => {
    expect(REHOME_EXISTING_SELECT).toContain("payload_group_kind:raw_payload->>group_kind");
  });
});

/* ---------------- 2. store ---------------- */

describe("R74 S10 email step: before the re-home", () => {
  it("preview is read-only and is exactly S6's plan", async () => {
    const { db, sources } = seed();
    const before = JSON.stringify(db);
    const p = await previewMailApply(fakeAdmin(db), IMP, sources);
    expect(JSON.stringify(db)).toBe(before);
    expect(p.plan.ok).toBe(true);
    expect(p.mail?.summary).toMatchObject({ openLots: 3, placedByEmail: 1, severalManifests: 1, unmatched: 1 });
    expect(p.plan.summary).toMatchObject({ emailManifests: 1, unmatchedManifest: true, lotsToMove: 3, lotsToEmail: 1, lotsToUnmatched: 2, movesFromImport: 3 });
    expect(p.plan.warnings.join()).toMatch(/1 kept PDF\/spreadsheet file/);
    expect(p.digest).toBe(mailApplyDigest(p.plan));
  });

  it("Apply creates the emailed + unmatched manifests, moves only manifest_id, and the re-home then leaves them alone", async () => {
    const { db, sources } = seed();
    const fp = fingerprint(db);
    const p = await previewMailApply(fakeAdmin(db), IMP, sources, { actorId: "u-1" });
    const a = await applyMailPlan(fakeAdmin(db), IMP, sources, { actorId: "u-2", expectedDigest: p.digest });
    expect(a.ok).toBe(true);
    expect(a.problems).toEqual([]);
    expect(a.created).toBe(2);
    expect(a.moved).toBe(3);
    expect(a.eventsLogged).toBe(2);
    expect(fingerprint(db)).toBe(fp);
    expect(homeOf(db, "lot-c")).toBe("email:0007");
    expect(homeOf(db, "lot-d")).toBe("unmatched:CV-UNMATCHED");
    expect(homeOf(db, "lot-e")).toBe("unmatched:CV-UNMATCHED");
    expect(lotsOn(db, SRC)).toEqual(["lot-a", "lot-b"]);
    expect(lotsOn(db, "native-1")).toEqual(["lot-n"]);
    const [em] = byGroup(db, EMAIL_GROUP_KIND);
    const pl = em.raw_payload as Row;
    expect(em).toMatchObject({ manifest_number: "0007", vendor_label: "Leaf Co LLC", vendor_id: "v-leaf", transfer_date: "2024-07-01", status: "accepted", accepted_at: null, created_by: "u-2" });
    expect(pl).toMatchObject({ import_id: IMP, source_manifest_id: SRC, vendor_license: "412999", barcodes: ["C"], other_lines: 1 });
    expect((pl.message_ids as string[]).sort()).toEqual(["gm-c1", "gm-c2"]);
    expect((pl.line_facts as Row).C).toEqual({ productName: "Leaf C 3.5g", inventoryType: "Usable Marijuana", unitCostCents: 1234, qty: 2 });
    const [un] = byGroup(db, UNMATCHED_GROUP_KIND);
    expect(un).toMatchObject({ manifest_number: "CV-UNMATCHED", vendor_label: "Unmatched Cultivera stock", vendor_id: null });
    expect((un.raw_payload as Row).several_manifests).toEqual({ E: ["0008|412999", "0009|412999"] });
    expect(db.manifest_events.every((e) => e.event_type === "accepted" && e.actor_id === "u-2")).toBe(true);

    // The re-home afterwards: only A, B move; no received-date manifest for C/D/E; no refusal.
    const r = await applyRehome(fakeAdmin(db), IMP, sources);
    expect(r.ok).toBe(true);
    expect(r.moved).toBe(2);
    expect(r.plan.summary.lotsPlacedByEmail).toBe(3);
    expect(r.plan.summary.rebuiltManifests).toBe(0);
    expect(homeOf(db, "lot-c")).toBe("email:0007");
    expect(lotsOn(db, SRC)).toEqual([]);
    expect(rehomeStage((await previewRehome(fakeAdmin(db), IMP, sources)).plan)).toBe("done");

    // A second email Apply is a no-op.
    const a2 = await applyMailPlan(fakeAdmin(db), IMP, sources);
    expect(a2).toMatchObject({ ok: true, created: 0, moved: 0, reused: 2 });
  });
});

describe("R74 S10 email step: after the re-home", () => {
  it("moves lots off the received-date manifests, removes them when empty, and the re-home stays done", async () => {
    const { db, sources } = seed();
    const r = await applyRehome(fakeAdmin(db), IMP, sources);
    expect(r.ok).toBe(true);
    const fallback = db.inbound_manifests.filter((m) => ["session", "day", "undated"].includes(String((m.raw_payload as Row)?.group_kind)));
    expect(fallback.length).toBeGreaterThan(0);
    const fp = fingerprint(db);
    const a = await applyMailPlan(fakeAdmin(db), IMP, sources);
    expect(a.ok).toBe(true);
    expect(a.plan.summary.movesFromRebuilt).toBe(3);
    expect(a.removedEmpty).toBe(fallback.length);
    expect(db.inbound_manifests.some((m) => fallback.some((f) => f.id === m.id))).toBe(false);
    expect(fingerprint(db)).toBe(fp);
    expect(homeOf(db, "lot-a")).toBe("transfer:0001234567");
    expect(homeOf(db, "lot-c")).toBe("email:0007");
    const again = await previewRehome(fakeAdmin(db), IMP, sources);
    expect(again.plan.ok).toBe(true);
    expect(rehomeStage(again.plan)).toBe("done");
  });

  it("a received-date manifest that carries onboarding work is kept (warning), never deleted", async () => {
    const { db, sources } = seed();
    await applyRehome(fakeAdmin(db), IMP, sources);
    const fb = db.inbound_manifests.find((m) => ["session", "day", "undated"].includes(String((m.raw_payload as Row)?.group_kind)))!;
    db.catalog_product_drafts.push({ id: "draft-1", manifest_id: fb.id });
    const a = await applyMailPlan(fakeAdmin(db), IMP, sources);
    expect(a.ok).toBe(true);
    expect(db.inbound_manifests.some((m) => m.id === fb.id)).toBe(true);
    expect(a.warnings.join()).toMatch(/carries onboarding work/);
  });
});

describe("R74 S10 safety", () => {
  it("Apply runs only the previewed plan: a new harvested file after the preview writes nothing", async () => {
    const { db, sources } = seed();
    const p = await previewMailApply(fakeAdmin(db), IMP, sources);
    db.cultivera_mail_docs.push({ ...db.cultivera_mail_docs[0], id: "d9", gmail_id: "gm-d", manifest_number: "0010", lines: [["D", 1, "Leaf D", "Usable Marijuana", 5]], barcodes: ["D"] });
    const before = JSON.stringify(db);
    await expect(applyMailPlan(fakeAdmin(db), IMP, sources, { expectedDigest: p.digest })).rejects.toThrow(/plan changed since you previewed/);
    expect(JSON.stringify(db)).toBe(before);
  });

  it("refuses before 0293 is applied, and with no harvested documents at all (never dumps everything on unmatched)", async () => {
    const { db, sources } = seed();
    const before = JSON.stringify(db);
    const p = await previewMailApply(fakeAdmin(db, [{ table: "cultivera_mail_docs", op: "select", code: "42P01" }]), IMP, sources);
    expect(p.plan.ok).toBe(false);
    expect(p.plan.refusals.join()).toMatch(/0293/);
    db.cultivera_mail_docs = [];
    await expect(applyMailPlan(fakeAdmin(db), IMP, sources)).rejects.toThrow(/no harvested email document/);
    db.cultivera_mail_docs = JSON.parse(before).cultivera_mail_docs;
    expect(JSON.stringify(db)).toBe(before);
  });

  it("a manifest from elsewhere holding a planned key refuses in PREVIEW", async () => {
    const { db, sources } = seed();
    db.inbound_manifests.push({ id: "foreign-1", manifest_number: "CV-UNMATCHED", dedupe_key: `CV-UNMATCHED|IMPORT-${IMP}`, raw_payload: { kind: "wcia" } });
    const p = await previewMailApply(fakeAdmin(db), IMP, sources);
    expect(p.plan.ok).toBe(false);
    expect(p.plan.refusals.join()).toMatch(/foreign-1 already holds the key/);
  });

  it("a lot hand-moved to a native manifest refuses (nothing is pulled off a native delivery)", async () => {
    const { db, sources } = seed();
    db.inventory_lots.find((l) => l.id === "lot-d")!.manifest_id = "native-1";
    const p = await previewMailApply(fakeAdmin(db), IMP, sources);
    // lot-d is no longer on this import's manifests, so it is simply not found (logged, never invented).
    expect(p.plan.summary.exceptionCounts.open_barcode_without_lot).toBe(1);
    expect(p.plan.manifests.some((m) => m.lotIds.includes("lot-d"))).toBe(false);
  });

  it("an interrupted Apply resumes without duplicating (insert failure, then move failure)", async () => {
    const { db, sources } = seed();
    await expect(applyMailPlan(fakeAdmin(db, [{ table: "inbound_manifests", op: "insert" }]), IMP, sources)).rejects.toThrow(/Nothing was moved/);
    expect(byGroup(db, EMAIL_GROUP_KIND)).toHaveLength(0);
    await expect(applyMailPlan(fakeAdmin(db, [{ table: "inventory_lots", op: "update", nth: 2 }]), IMP, sources)).rejects.toThrow(/resume/);
    const a = await applyMailPlan(fakeAdmin(db), IMP, sources);
    expect(a.ok).toBe(true);
    expect(a.created).toBe(0);
    expect(byGroup(db, EMAIL_GROUP_KIND)).toHaveLength(1);
    expect(byGroup(db, UNMATCHED_GROUP_KIND)).toHaveLength(1);
    expect(lotsOn(db, SRC)).toEqual(["lot-a", "lot-b"]);
  });

  it("verifies from a DB re-read: a move that reports success but did not land fails the run", async () => {
    const { db, sources } = seed();
    const a = await applyMailPlan(fakeAdmin(db, [{ table: "inventory_lots", op: "update", nth: 1, lie: true }]), IMP, sources);
    expect(a.ok).toBe(false);
    expect(a.problems.join()).toMatch(/not on their planned/);
    expect((await applyMailPlan(fakeAdmin(db), IMP, sources)).ok).toBe(true);
  });

  it("the move is guarded by the manifest the plan saw: a lot moved meanwhile is left alone and reported", async () => {
    const { db, sources } = seed();
    const sneak = (d: Db) => {
      d.inventory_lots.find((l) => l.id === "lot-c")!.manifest_id = "native-1";
    };
    const a = await applyMailPlan(fakeAdmin(db, [{ table: "inventory_lots", op: "update", nth: 1, before: sneak, pass: true }]), IMP, sources);
    expect(a.skippedByGuard).toBeGreaterThan(0);
    expect(a.ok).toBe(false);
    expect(db.inventory_lots.find((l) => l.id === "lot-c")!.manifest_id).toBe("native-1");
  });

  it("a later harvest upgrades a lot off CV-UNMATCHED onto its emailed manifest; lineage grows BEFORE the move", async () => {
    const { db, sources } = seed();
    await applyMailPlan(fakeAdmin(db), IMP, sources);
    // D shows up on the already-created 0007 manifest in a new email.
    db.cultivera_mail_docs.push({ ...db.cultivera_mail_docs[0], id: "d9", gmail_id: "gm-d", lines: [["D", 4, "Leaf D 1g", "Usable Marijuana", 700]], barcodes: ["D"] });
    const p = await previewMailApply(fakeAdmin(db), IMP, sources);
    expect(p.plan.summary).toMatchObject({ movesFromUnmatched: 1, lineageUpdates: 1, manifestsToCreate: 0 });
    // If the lineage write fails, nothing moves.
    await expect(applyMailPlan(fakeAdmin(db, [{ table: "inbound_manifests", op: "update" }]), IMP, sources)).rejects.toThrow(/Nothing was moved/);
    expect(homeOf(db, "lot-d")).toBe("unmatched:CV-UNMATCHED");
    const a = await applyMailPlan(fakeAdmin(db), IMP, sources);
    expect(a.ok).toBe(true);
    expect(a.lineageUpdated).toBe(1);
    expect(homeOf(db, "lot-d")).toBe("email:0007");
    const em = byGroup(db, EMAIL_GROUP_KIND)[0];
    expect((em.raw_payload as Row).barcodes).toEqual(["C", "D"]);
    expect(em.accepted_lot_count).toBe(2);
    expect(((em.raw_payload as Row).line_facts as Row).D).toMatchObject({ unitCostCents: 700 });
  });

  it("rollback restores the original placement exactly and never destroys work", async () => {
    const { db, sources } = seed();
    const before = fingerprint(db);
    await applyMailPlan(fakeAdmin(db), IMP, sources);
    const r = await rollbackMailPlan(fakeAdmin(db), IMP);
    expect(r).toMatchObject({ movedBack: 3, deleted: 2, keptNonEmpty: 0, keptWithWork: 0 });
    expect(lotsOn(db, SRC)).toEqual(["lot-a", "lot-b", "lot-c", "lot-d", "lot-e"]);
    expect(fingerprint(db)).toBe(before);
    expect(byGroup(db, EMAIL_GROUP_KIND)).toHaveLength(0);

    await applyMailPlan(fakeAdmin(db), IMP, sources);
    const em = byGroup(db, EMAIL_GROUP_KIND)[0];
    db.pos_fact_reviews.push({ id: "rev-1", manifest_id: em.id });
    db.inventory_lots.push({ id: "lot-x", manifest_id: byGroup(db, UNMATCHED_GROUP_KIND)[0].id, ccrs_inventory_external_id: "X", vendor_id: null, on_hand_qty: 1, received_qty: 1, unit_cost_minor_units: 1, status: "active" });
    const r2 = await rollbackMailPlan(fakeAdmin(db), IMP);
    expect(r2).toMatchObject({ movedBack: 3, deleted: 0, keptNonEmpty: 1, keptWithWork: 1 });
    expect(db.inventory_lots.find((l) => l.id === "lot-x")!.manifest_id).toBe(byGroup(db, UNMATCHED_GROUP_KIND)[0].id);
    // rollback never touches the re-home's transfer manifests
    expect(db.pos_fact_reviews).toHaveLength(1);
  });

  it("rollback refuses to guess when an emailed manifest has no barcode lineage", async () => {
    const { db, sources } = seed();
    await applyMailPlan(fakeAdmin(db), IMP, sources);
    delete (byGroup(db, EMAIL_GROUP_KIND)[0].raw_payload as Row).barcodes;
    await expect(rollbackMailPlan(fakeAdmin(db), IMP)).rejects.toThrow(/no barcode lineage/);
  });

  it("after a rollback, the re-home puts the lots back on received-date manifests", async () => {
    const { db, sources } = seed();
    await applyRehome(fakeAdmin(db), IMP, sources);
    await applyMailPlan(fakeAdmin(db), IMP, sources);
    await rollbackMailPlan(fakeAdmin(db), IMP);
    const r = await applyRehome(fakeAdmin(db), IMP, sources);
    expect(r.ok).toBe(true);
    expect(r.moved).toBe(3);
    expect(homeOf(db, "lot-c")).toMatch(/^(session|day|undated):CV-/);
  });
});

/* ---------------- 3. wiring ---------------- */

describe("R74 S10 wiring", () => {
  const actions = src("src/app/admin/menu-imports/mail-apply-actions.ts");
  const page = src("src/app/admin/menu-imports/[id]/coverage/page.tsx");
  const store = src("src/lib/pos/cultivera-mail-apply-store.ts");
  it("actions need inventory.manage, a tick and a 64-hex digest, and are audited", () => {
    expect(actions.match(/requirePermission\("inventory\.manage"\)/g)).toHaveLength(2);
    expect(actions).toContain('String(formData.get("attest") ?? "") !== "1"');
    expect(actions).toContain("/^[0-9a-f]{64}$/.test(digest)");
    expect(actions).toContain("expectedDigest: digest");
    for (const a of ["applied", "applyProblems", "applyRefused", "rolledBack"]) expect(actions).toContain(`MAIL_APPLY_AUDIT.${a}`);
  });
  it("the coverage page reads the workbooks once and shows the Apply only to inventory managers", () => {
    expect(page.match(/loadRehomeSources\(admin, id\)/g)).toHaveLength(1);
    expect(page).toContain("loadCoverage(admin, id, sources)");
    expect(page).toContain('can(session.profile.role, "inventory.manage")');
    for (const t of ["mail-apply", "mail-apply-run", "mail-apply-rollback", "mail-apply-refusals", "mail-apply-summary"]) expect(page).toContain(`data-testid="${t}"`);
    expect(page).toContain('name="digest" value={apply.digest}');
  });
  it("the store is server-only, guards every move by its source manifest and deletes only by lineage", () => {
    expect(store).toContain('import "server-only"');
    expect(store).toContain('.eq("manifest_id", b.fromManifestId)');
    expect(store.match(/\.eq\("raw_payload->>import_id", importId\)/g)!.length).toBeGreaterThanOrEqual(4);
    expect(store).not.toMatch(/on_hand_qty|unit_cost_minor_units\s*:/);
  });
});
