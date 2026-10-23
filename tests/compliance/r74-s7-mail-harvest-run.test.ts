/**
 * R74 S7: the Cultivera email harvest RUN ("Harvest the next batch").
 * Owner (round 2): "every Cultivera manifest was sent to stephen@. Please go as far back as you are
 * allowed to go." and "Whatever Cultivera doesn't find, the email will."
 *
 * Drives the real batch (runHarvestBatch) with fake Gmail / storage / table I/O, so the claim rule,
 * the transient stop, the cursor and the real WCIA parser are proven end to end without a network.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GmailMessage } from "@/lib/compliance/ccrs-mail-core";
import { buildHarvestQuery, startCursor, type HarvestCursor } from "@/lib/pos/cultivera-mail-harvest-core";
import { __runCultiveraMailHarvestRunCoreTests, harvestBatchLine, mailDocsFromRows, type HarvestDocRow } from "@/lib/pos/cultivera-mail-harvest-run-core";
import { HarvestTableMissing, runHarvestBatch, type HarvestIo } from "@/lib/pos/cultivera-mail-harvest-store";
import { planMailMatch } from "@/lib/pos/cultivera-mail-match-core";

const read = (p: string) => readFileSync(p, "utf8");
const MAILBOX = "stephen@greenwaymarijuana.com";
const CFG = { configured: true, mailbox: MAILBOX, mode: "service-account" } as unknown as Parameters<typeof runHarvestBatch>[1];

const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64url");

const WCIA = JSON.stringify({
  document_schema_version: "2.1.0",
  transfer_id: "0009001",
  from_license_number: "412345",
  from_license_name: "CANNA ORGANIX LLC",
  est_departed_at: "2025-03-01T17:00:00Z",
  inventory_transfer_items: [
    { inventory_id: "1234567890123456", product_name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana", qty: "10", line_price: "45.00", uom: "each" },
  ],
});

function msg(id: string, parts: GmailMessage["payload"][], subject = "Manifest"): GmailMessage {
  return {
    id,
    internalDate: String(Date.parse("2025-03-01T18:00:00Z")),
    payload: { mimeType: "multipart/mixed", headers: [{ name: "Subject", value: subject }, { name: "From", value: "orders@cultivera.com" }], parts: parts as NonNullable<GmailMessage["payload"]>[] },
  };
}

const MESSAGES: Record<string, GmailMessage> = {
  // attached WCIA JSON
  msgJson0001: msg("msgJson0001", [
    { mimeType: "text/plain", body: { data: b64("see attached") } },
    { mimeType: "application/json", filename: "0009001.json", body: { attachmentId: "att1", size: WCIA.length } },
  ]),
  // Cultivera-style email: transfer link in the html body, no attachment
  msgLink0002: msg("msgLink0002", [
    { mimeType: "text/html", body: { data: b64('<p>Transfer Data Link: <a href="https://transfers.example.com/t/0009002">here</a></p>') } },
  ]),
  // nothing useful
  msgNone0003: msg("msgNone0003", [{ mimeType: "text/plain", body: { data: b64("lunch on friday?") } }], "Lunch"),
  // a PDF that is really a PDF
  msgPdf00004: msg("msgPdf00004", [
    { mimeType: "application/pdf", filename: "manifest.pdf", body: { attachmentId: "att4", size: 20 } },
  ]),
};

const ATTACH: Record<string, Uint8Array> = {
  att1: new TextEncoder().encode(WCIA),
  att4: new TextEncoder().encode("%PDF-1.4 fake pdf body"),
};

type Fake = HarvestIo & { rows: HarvestDocRow[]; uploads: string[]; cursor: HarvestCursor | null; opened: string[] };

function fakeIo(pages: { ids: string[]; next: string | null }[], over: Partial<HarvestIo> = {}): Fake {
  const rows: HarvestDocRow[] = [];
  const uploads: string[] = [];
  const opened: string[] = [];
  const st: Fake = {
    rows,
    uploads,
    opened,
    cursor: null,
    token: async () => "tok",
    listPage: async (_t, _q, pageToken) => {
      const i = pageToken ? Number(pageToken.replace("p", "")) : 0;
      return { ids: pages[i].ids, nextPageToken: pages[i].next };
    },
    getMessage: async (_t, id) => {
      opened.push(id);
      const m = MESSAGES[id];
      if (!m) throw new Error(`Gmail messages.get ${id}: HTTP 404`);
      return m;
    },
    getAttachment: async (_t, _id, ref) => ATTACH[ref.attachmentId ?? ""] ?? new Uint8Array(0),
    fetchLink: async (url) =>
      url.includes("0009002")
        ? { ok: true, jsonText: WCIA.replace("0009001", "0009002").replace("1234567890123456", "2222222222222222") }
        : { ok: false, error: "HTTP 404" },
    readCursor: async () => st.cursor,
    saveCursor: async (c) => {
      st.cursor = c;
    },
    knownIds: async (ids) => new Set(rows.filter((r) => ids.includes(r.gmail_id)).map((r) => r.gmail_id)),
    upload: async (key) => {
      uploads.push(key);
    },
    insertRows: async (rs) => {
      let n = 0;
      for (const r of rs) {
        if (rows.some((x) => x.mailbox === r.mailbox && x.gmail_id === r.gmail_id && x.doc_index === r.doc_index)) continue; // ON CONFLICT DO NOTHING
        rows.push(r);
        n += 1;
      }
      return n;
    },
    now: () => Date.parse("2026-10-22T12:00:00Z"),
    ...over,
  };
  return st;
}

describe("R74 S7 pure core", () => {
  it("self-tests pass at the pinned count", () => {
    const r = __runCultiveraMailHarvestRunCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(53);
  });
  it("is registered in the pure self-test runner with its floor", () => {
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runCultiveraMailHarvestRunCoreTests()");
    expect(src).toMatch(/cultivera-mail-harvest-run-core: .*expected >= 53/);
  });
});

describe("R74 S7 one batch with fake Gmail", () => {
  it("keeps attached JSON, linked WCIA JSON, PDFs; records an email with nothing once; moves the cursor", async () => {
    const io = fakeIo([{ ids: ["msgJson0001", "msgLink0002", "msgNone0003", "msgPdf00004"], next: "p1" }, { ids: [], next: null }]);
    const r = await runHarvestBatch(io, CFG);
    expect(r.ok).toBe(true);
    expect(r.opened).toBe(4);
    expect(r.documents).toBe(3);
    expect(r.parsed).toBe(2);
    expect(r.pageComplete).toBe(true);
    expect(io.cursor?.pagesDone).toBe(1);
    expect(io.cursor?.pageToken).toBe("p1");
    expect(io.cursor?.query).toBe(buildHarvestQuery());

    const byId = (id: string) => io.rows.filter((x) => x.gmail_id === id);
    const j = byId("msgJson0001");
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ status: "parsed", kind: "json", source: "attachment", source_format: "wcia", manifest_number: "0009001", barcodes: ["1234567890123456"] });
    expect(j[0].lines[0]).toEqual(["1234567890123456", 10, "Blue Dream 3.5g", "Usable Marijuana", 450]);
    expect(j[0].storage_key).toBe("mail-harvest/stephen_greenwaymarijuana.com/msgJson0001/0-0009001.json");
    expect(j[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    const l = byId("msgLink0002");
    expect(l[0]).toMatchObject({ status: "parsed", kind: "link-json", source: "link", barcodes: ["2222222222222222"] });

    const n = byId("msgNone0003");
    expect(n).toEqual([expect.objectContaining({ status: "no_documents", kind: "none", source: "email", doc_index: 0 })]);

    const p = byId("msgPdf00004");
    expect(p[0]).toMatchObject({ status: "stored", kind: "pdf" });
    expect(io.uploads).toHaveLength(3);

    // The rows feed S6: both parsed documents place their lots by barcode.
    const docs = mailDocsFromRows(io.rows);
    expect(docs.map((d) => d.messageId).sort()).toEqual(["msgJson0001", "msgLink0002"]);
    const plan = planMailMatch(
      [
        { barcode: "1234567890123456", vendorLabel: "Canna Organix", product: "Blue Dream", units: 4 },
        { barcode: "2222222222222222", vendorLabel: "Canna Organix", product: "Blue Dream", units: 1 },
      ],
      docs,
    );
    expect(plan.summary.placedByEmail).toBe(2);
    expect(plan.summary.unmatched).toBe(0);
  });

  it("a second press never opens a kept email again and stores nothing twice; the next page is next", async () => {
    const io = fakeIo([{ ids: ["msgJson0001", "msgNone0003"], next: "p1" }, { ids: ["msgPdf00004"], next: null }]);
    await runHarvestBatch(io, CFG);
    const before = io.rows.length;
    // replay page 0 (as if the cursor save was lost): nothing is opened, nothing stored
    io.cursor = null;
    io.opened.length = 0;
    const again = await runHarvestBatch(io, CFG);
    expect(io.opened).toEqual([]);
    expect(again.stored).toBe(0);
    expect(io.rows.length).toBe(before);
    // then page 1 finishes the walk
    const last = await runHarvestBatch(io, CFG);
    expect(io.opened).toEqual(["msgPdf00004"]);
    expect(last.cursorLine).toMatch(/^Finished/);
    expect((io.cursor as HarvestCursor | null)?.done).toBe(true);
    // finished + no new mail (R74 S18): the press checks the newest page, opens nothing, ends the pass
    io.opened.length = 0;
    const done = await runHarvestBatch(io, CFG);
    expect(done.ok).toBe(true);
    expect(io.opened).toEqual([]);
    expect(done.newMailPass).toBe("finished");
    expect((io.cursor as HarvestCursor | null)?.topUp ?? null).toBeNull();
    expect(harvestBatchLine(done)).toContain("none since the last press");
  });

  it("a Gmail rate limit stops the batch, writes nothing for that email and keeps the cursor on the page", async () => {
    let calls = 0;
    const io = fakeIo([{ ids: ["msgJson0001", "msgLink0002"], next: "p1" }], {
      getMessage: async (_t, id) => {
        calls += 1;
        if (calls === 2) throw new Error("Gmail messages.get x: HTTP 429: rate limit");
        return MESSAGES[id];
      },
    });
    const r = await runHarvestBatch(io, CFG);
    expect(r.ok).toBe(false);
    expect(r.opened).toBe(1);
    expect(r.pageComplete).toBe(false);
    expect(r.stoppedBecause).toMatch(/slow down/);
    expect(io.rows.some((x) => x.gmail_id === "msgLink0002")).toBe(false);
    expect(io.cursor).toBeNull();
  });

  it("an attachment whose bytes are not what its name says is a failed row, not a stored file", async () => {
    const io = fakeIo([{ ids: ["msgPdf00004"], next: null }], { getAttachment: async () => new TextEncoder().encode("not a pdf at all") });
    const r = await runHarvestBatch(io, CFG);
    expect(r.ok).toBe(true);
    expect(io.rows[0]).toMatchObject({ status: "failed", kind: "pdf", storage_key: null });
    expect(io.uploads).toEqual([]);
  });

  it("a mailbox / search change starts over from the oldest page and says why", async () => {
    const io = fakeIo([{ ids: [], next: "p1" }, { ids: [], next: null }]);
    io.cursor = { ...startCursor("someone@greenwaymarijuana.com", buildHarvestQuery(), "2026-01-01T00:00:00Z"), pagesDone: 3, pageToken: "p1" };
    const r = await runHarvestBatch(io, CFG);
    expect(r.cursorLine).toMatch(/Started over.*mailbox changed/);
    expect(io.cursor?.mailbox).toBe(MAILBOX);
    expect(io.cursor?.pagesDone).toBe(1);
  });

  it("0293 not applied: the batch refuses with the fix", async () => {
    const io = fakeIo([{ ids: ["msgJson0001"], next: null }], {
      knownIds: async () => {
        throw new HarvestTableMissing();
      },
    });
    await expect(runHarvestBatch(io, CFG)).rejects.toThrow(/Apply database update 0293 first/);
  });
});

describe("R74 S7 wiring", () => {
  const action = read("src/app/admin/menu-imports/mail-harvest-actions.ts");
  const page = read("src/app/admin/menu-imports/page.tsx");
  const store = read("src/lib/pos/cultivera-mail-harvest-store.ts");
  const mig = read("supabase/migrations/0293_cultivera_mail_docs.sql");

  it("the button runs the batch under menu.import, audited, and the page allows the batch its time", () => {
    expect(action).toMatch(/export async function harvestMailboxBatchAction[\s\S]*requirePermission\("menu\.import"\)/);
    expect(action).toContain('action: "cultivera_mail.harvest"');
    expect(page).toContain("Harvest the next batch");
    expect(page).toContain("harvestMailboxBatchAction");
    expect(page).toMatch(/export const maxDuration = 300;/);
  });

  it("the insert is the claim (ON CONFLICT DO NOTHING on the unique key) and files go to private pos-raw", () => {
    expect(store).toContain('onConflict: "mailbox,gmail_id,doc_index", ignoreDuplicates: true');
    expect(store).toContain('import "server-only"');
    expect(mig).toContain("constraint cultivera_mail_docs_once unique (mailbox, gmail_id, doc_index)");
    expect(read("supabase/migrations/0002_slice2_pos_import.sql")).toMatch(/values \('pos-raw', 'pos-raw', false\)/);
  });

  it("0293 is guarded, kept by the factory reset and proven on Postgres", () => {
    expect(mig).toContain("CULTIVERA_MAIL_DOC_KEPT");
    expect(mig).toContain("CULTIVERA_MAIL_DOC_IMMUTABLE");
    expect(mig).toContain("CULTIVERA_MAIL_DOC_STATUS");
    expect(mig).toContain("enable row level security");
    expect(mig).toMatch(/create table if not exists public\.cultivera_mail_docs/);
    expect(read("src/lib/accounting/factory-reset-core.ts")).toMatch(/table: "cultivera_mail_docs", disposition: "KEEP"/);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain(
      '{ file: "scripts/recon/cultivera-mail-docs-0293-pg-check.sql", mustPrint: "R74 0293 CHECK PASSED" }',
    );
    expect(read("scripts/recon/cultivera-mail-docs-0293-pg-check.sql")).toContain("raise notice 'R74 0293 CHECK PASSED'");
    expect(read("supabase/rollbacks/0293_cultivera_mail_docs.rollback.sql")).toContain("drop table if exists public.cultivera_mail_docs");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("## R74 — 0293 — Cultivera email harvest");
  });

  it("no new cron: the harvest runs from the button", () => {
    expect(read("vercel.json")).not.toMatch(/mail-harvest/);
  });
});
