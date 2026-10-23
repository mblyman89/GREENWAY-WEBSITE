/**
 * R74 S18 — a press of "Harvest the next batch" after the walk says Finished picks up vendor emails
 * that arrived since. Owner (round 9): "if a manifest comes in tomorrow, and after it does, I click
 * harvest next batch, will it find the new ones?" Before S18 a finished cursor returned at once and
 * never listed Gmail, so the answer was no. Now: yes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GmailMessage } from "@/lib/compliance/ccrs-mail-core";
import { __runCultiveraMailHarvestCoreTests, type HarvestCursor } from "@/lib/pos/cultivera-mail-harvest-core";
import { __runCultiveraMailHarvestRunCoreTests, harvestBatchLine, type HarvestDocRow } from "@/lib/pos/cultivera-mail-harvest-run-core";
import { runHarvestBatch, type HarvestIo } from "@/lib/pos/cultivera-mail-harvest-store";

const read = (p: string) => readFileSync(p, "utf8");
const MAILBOX = "stephen@greenwaymarijuana.com";
const CFG = { configured: true, mailbox: MAILBOX, mode: "service-account" } as unknown as Parameters<typeof runHarvestBatch>[1];

const wcia = (transfer: string, barcode: string) =>
  JSON.stringify({
    document_schema_version: "2.1.0",
    transfer_id: transfer,
    from_license_number: "412345",
    from_license_name: "CANNA ORGANIX LLC",
    est_departed_at: "2026-10-23T17:00:00Z",
    inventory_transfer_items: [{ inventory_id: barcode, product_name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana", qty: "10", line_price: "45.00", uom: "each" }],
  });

function jsonMail(id: string, transfer: string, barcode: string): { m: GmailMessage; att: [string, Uint8Array] } {
  const body = wcia(transfer, barcode);
  return {
    m: {
      id,
      internalDate: String(Date.parse("2026-10-23T18:00:00Z")),
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "Subject", value: "Manifest" }, { name: "From", value: "orders@cultivera.com" }],
        parts: [{ mimeType: "application/json", filename: `${transfer}.json`, body: { attachmentId: `att-${id}`, size: body.length } }] as NonNullable<GmailMessage["payload"]>[],
      },
    },
    att: [`att-${id}`, new TextEncoder().encode(body)],
  };
}

type Mailbox = { pages: string[][] };
type Fake = HarvestIo & { rows: HarvestDocRow[]; opened: string[]; listed: (string | null)[]; cursor: HarvestCursor | null; box: Mailbox; mail: Record<string, GmailMessage>; atts: Record<string, Uint8Array> };

/** Gmail lists newest first: page 0 is the newest. pageToken "pN" = page N. */
function fakeIo(box: Mailbox): Fake {
  const st: Fake = {
    box,
    rows: [],
    opened: [],
    listed: [],
    cursor: null,
    mail: {},
    atts: {},
    token: async () => "tok",
    listPage: async (_t, _q, pageToken) => {
      st.listed.push(pageToken);
      const i = pageToken ? Number(pageToken.replace("p", "")) : 0;
      return { ids: st.box.pages[i] ?? [], nextPageToken: i + 1 < st.box.pages.length ? `p${i + 1}` : null };
    },
    getMessage: async (_t, id) => {
      st.opened.push(id);
      const m = st.mail[id];
      if (!m) throw new Error(`Gmail messages.get ${id}: HTTP 404`);
      return m;
    },
    getAttachment: async (_t, _id, ref) => st.atts[ref.attachmentId ?? ""] ?? new Uint8Array(0),
    fetchLink: async () => ({ ok: false, error: "HTTP 404" }),
    readCursor: async () => st.cursor,
    saveCursor: async (c) => {
      st.cursor = c;
    },
    knownIds: async (ids) => new Set(st.rows.filter((r) => ids.includes(r.gmail_id)).map((r) => r.gmail_id)),
    upload: async () => {},
    insertRows: async (rs) => {
      let n = 0;
      for (const r of rs) {
        if (st.rows.some((x) => x.gmail_id === r.gmail_id && x.doc_index === r.doc_index)) continue;
        st.rows.push(r);
        n += 1;
      }
      return n;
    },
    now: () => Date.parse("2026-10-24T12:00:00Z"),
  };
  return st;
}

function addMail(io: Fake, id: string, transfer: string, barcode: string) {
  const { m, att } = jsonMail(id, transfer, barcode);
  io.mail[id] = m;
  io.atts[att[0]] = att[1];
}

async function walkToFinished(io: Fake) {
  for (let i = 0; i < 10; i += 1) {
    const r = await runHarvestBatch(io, CFG);
    expect(r.ok).toBe(true);
    if (io.cursor?.done) return;
  }
  throw new Error("walk never finished");
}

describe("R74 S18 a press after Finished picks up new vendor emails", () => {
  it("a manifest that arrives after Finished is found and kept by the next press", async () => {
    const io = fakeIo({ pages: [["oldMail0001", "oldMail0002"], ["oldMail0003"]] });
    addMail(io, "oldMail0001", "0001001", "1000000000000001");
    addMail(io, "oldMail0002", "0001002", "1000000000000002");
    addMail(io, "oldMail0003", "0001003", "1000000000000003");
    await walkToFinished(io);
    expect(io.rows.map((r) => r.gmail_id).sort()).toEqual(["oldMail0001", "oldMail0002", "oldMail0003"]);

    // tomorrow: a new manifest lands at the top of the newest-first list
    addMail(io, "newMail0009", "0009009", "9000000000000009");
    io.box.pages = [["newMail0009", "oldMail0001"], ["oldMail0002", "oldMail0003"]];
    io.opened.length = 0;
    io.listed.length = 0;
    const r = await runHarvestBatch(io, CFG);
    expect(r.ok).toBe(true);
    expect(io.listed).toEqual([null]); // the newest page, never the walk's old position
    expect(io.opened).toEqual(["newMail0009"]); // only the new email is opened
    const kept = io.rows.find((x) => x.gmail_id === "newMail0009");
    expect(kept).toMatchObject({ status: "parsed", manifest_number: "0009009", barcodes: ["9000000000000009"] });
    // the page held a kept email too, but this press opened something, so the pass looks one page further
    expect(r.newMailPass).toBe("continues");
    expect(harvestBatchLine(r)).toMatch(/press the button again/i);
    expect(io.cursor?.done).toBe(true);
    expect(io.cursor?.listed).toBe(3); // the walk's totals are untouched

    // the next press sees an all-kept page and ends the pass
    io.opened.length = 0;
    io.listed.length = 0;
    const r2 = await runHarvestBatch(io, CFG);
    expect(io.listed).toEqual(["p1"]);
    expect(io.opened).toEqual([]);
    expect(r2.newMailPass).toBe("finished");
    expect(io.cursor?.topUp ?? null).toBeNull();
    expect(harvestBatchLine(r2)).toContain("none since the last press");

    // and a later press with nothing new opens nothing and lists only the first page
    io.opened.length = 0;
    io.listed.length = 0;
    const r3 = await runHarvestBatch(io, CFG);
    expect(io.listed).toEqual([null]);
    expect(io.opened).toEqual([]);
    expect(r3.newMailPass).toBe("finished");
    expect(io.rows.filter((x) => x.gmail_id === "newMail0009")).toHaveLength(1); // stored once
  });

  it("a whole page of new mail keeps the pass going until it reaches a kept page", async () => {
    const io = fakeIo({ pages: [["oldMail0001"]] });
    addMail(io, "oldMail0001", "0001001", "1000000000000001");
    await walkToFinished(io);
    for (const n of ["newMailA001", "newMailA002", "newMailA003"]) addMail(io, n, `00${n.slice(-5)}`, `90000000000${n.slice(-5)}`);
    io.box.pages = [["newMailA003", "newMailA002"], ["newMailA001"], ["oldMail0001"]];
    io.opened.length = 0;
    const a = await runHarvestBatch(io, CFG);
    expect(a.newMailPass).toBe("continues");
    const b = await runHarvestBatch(io, CFG);
    expect(b.newMailPass).toBe("continues");
    const c = await runHarvestBatch(io, CFG);
    expect(c.newMailPass).toBe("finished");
    expect(io.opened).toEqual(["newMailA003", "newMailA002", "newMailA001"]);
    expect(io.cursor?.topUp ?? null).toBeNull();
  });

  it("a failure during the pass keeps its place: the email is tried again on the next press", async () => {
    const io = fakeIo({ pages: [["oldMail0001"]] });
    addMail(io, "oldMail0001", "0001001", "1000000000000001");
    await walkToFinished(io);
    io.box.pages = [["newMailB001", "oldMail0001"]];
    // newMailB001 is not in io.mail yet: Gmail answers 404 -> the batch stops loudly, nothing saved for it
    const bad = await runHarvestBatch(io, CFG);
    expect(bad.ok).toBe(false);
    expect(bad.failedEmails).toBe(1);
    expect(bad.newMailPass).toBeUndefined();
    expect(io.rows.some((x) => x.gmail_id === "newMailB001")).toBe(false);
    addMail(io, "newMailB001", "0002001", "2000000000000001");
    io.opened.length = 0;
    const good = await runHarvestBatch(io, CFG);
    expect(good.ok).toBe(true);
    expect(io.opened).toEqual(["newMailB001"]);
  });

  it("a cursor saved before S18 (Finished, no topUp) still works: no restart, the press checks for new mail", async () => {
    const io = fakeIo({ pages: [["oldMail0001"]] });
    addMail(io, "oldMail0001", "0001001", "1000000000000001");
    await walkToFinished(io);
    const legacy = { ...(io.cursor as HarvestCursor) } as Partial<HarvestCursor>;
    delete legacy.topUp;
    io.cursor = legacy as HarvestCursor;
    const r = await runHarvestBatch(io, CFG);
    expect(r.cursorLine).not.toContain("Started over");
    expect(r.newMailPass).toBe("finished");
  });
});

describe("R74 S18 pins", () => {
  it("self-test counts and runner floors", () => {
    expect(__runCultiveraMailHarvestCoreTests()).toEqual({ passed: 75, failed: 0 });
    expect(__runCultiveraMailHarvestRunCoreTests()).toEqual({ passed: 53, failed: 0 });
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toMatch(/cultivera-mail-harvest-core: .*expected >= 75/);
    expect(src).toMatch(/cultivera-mail-harvest-run-core: .*expected >= 53/);
  });
  it("the store no longer returns early on a finished cursor", () => {
    const src = read("src/lib/pos/cultivera-mail-harvest-store.ts");
    expect(src).not.toMatch(/if \(cursor\.done\) \{\s*res\.ok = true;/);
    expect(src).toContain("const topUp = cursor.done;");
    expect(src).toContain("advanceTopUp(cursor, page, allKnown, iso())");
  });
  it("the page tells staff a press after Finished picks up new emails", () => {
    expect(read("src/app/admin/menu-imports/page.tsx")).toContain("press it whenever new vendor emails may have");
  });
});
