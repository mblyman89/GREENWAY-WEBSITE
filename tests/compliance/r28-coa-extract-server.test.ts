/**
 * tests/compliance/r28-coa-extract-server.test.ts
 *
 * R28 - the server side of reading lab certificates, over a fake network:
 *
 *   1. readCoaForLab: the lab JSON + the COA PDF from the REAL owner fixtures;
 *      the archived copy first, the link second; allow-list, redirect, content
 *      type, size, magic bytes; LlamaParse only when the text layer has no
 *      potency numbers (or the button forces it) - never without a key.
 *   2. runForLabs via extractCoasForManifest / extractCoaForLot: the stored
 *      patch, the counts, force vs already-read, the time budget (deferred),
 *      a database without 0252 (migrated false, NO writes), the KB fill-only.
 *   3. loadCoaFactsForDrafts: lots -> labs -> the five edibles' facts; a
 *      missing column or a failed read is an empty map, never a throw.
 *   4. the real unpdf text layer of the real item 12 PDF reads to 55 mg.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const FX = join(ROOT, "tests", "fixtures", "coa");
const fx = (f: string) => readFileSync(join(FX, f), "utf8");
const transfer = JSON.parse(fx("transfer.json")) as {
  inventory_transfer_items: { product_name: string; inventory_type: string; lab_result_link: string; lab_result_data: { coa: string; potency?: { type: string; value: number }[] } }[];
};
const items = transfer.inventory_transfer_items;
const pot = (i: number, t: string) => items[i].lab_result_data.potency?.find((p) => p.type === t)?.value ?? null;
const n2 = (i: number) => String(i).padStart(2, "0");
const PDF_MAGIC = new TextEncoder().encode("%PDF-1.7\n");
const pdfFor = (i: number) => {
  // bytes that start like a PDF and carry the item index for the mock reader
  const tag = new TextEncoder().encode(`ITEM${n2(i)}`);
  const b = new Uint8Array(PDF_MAGIC.length + tag.length);
  b.set(PDF_MAGIC, 0);
  b.set(tag, PDF_MAGIC.length);
  return b;
};
const itemOfPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes).match(/ITEM(\d\d)/)?.[1] ?? null;

type Req = { method: string; url: URL; body: unknown };
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown }>,
  route: null as null | ((r: { method: string; url: URL; body: unknown }) => { status: number; body?: unknown } | undefined),
  http: [] as string[],
  httpRoute: null as null | ((url: string) => Response | Promise<Response>),
  storage: new Map<string, Uint8Array>(),
  storageReads: [] as string[],
  llama: { configured: false, calls: 0, text: null as string | null, error: null as string | null },
  unpdf: { text: (() => null) as (item: string | null) => string | null, calls: 0 }, // set per test in beforeEach
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("@/lib/inventory/pdf-extract", () => ({
  extractPdfText: async (bytes: Uint8Array) => {
    net.unpdf.calls += 1;
    const t = net.unpdf.text(itemOfPdf(bytes));
    if (t === null) throw new Error("unpdf could not read it");
    return t;
  },
}));
vi.mock("@/lib/inbound-email/llamaparse-provider", () => ({
  isLlamaParseConfigured: () => net.llama.configured,
  parsePdf: async () => {
    net.llama.calls += 1;
    return net.llama.text !== null ? { ok: true, text: net.llama.text, via: "llamaparse" } : { ok: false, text: "", error: net.llama.error ?? "LlamaParse read nothing" };
  },
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null };
    net.reqs.push(r);
    const rep = (net.route && net.route(r)) ?? { status: 200, body: [] };
    const nullBody = r.method === "HEAD" || rep.status === 204;
    return new Response(nullBody ? null : JSON.stringify(rep.body ?? []), { status: rep.status, headers: { "content-type": "application/json" } });
  };
  return {
    createSupabaseAdminClient: () => {
      const pg = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch });
      return Object.assign(pg, {
        storage: {
          from: (bucket: string) => ({
            download: async (path: string) => {
              net.storageReads.push(`${bucket}/${path}`);
              const b = net.storage.get(path);
              return b ? { data: new Blob([b.slice().buffer as ArrayBuffer]), error: null } : { data: null, error: { message: "not found" } };
            },
          }),
        },
      });
    },
  };
});

const table = (r: Req) => r.url.pathname.split("/").pop() ?? "";
const okJson = (body: string, url: string) => {
  const res = new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  Object.defineProperty(res, "url", { value: url });
  return res;
};
const okPdf = (bytes: Uint8Array, url: string, ct = "application/pdf") => {
  const res = new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": ct } });
  Object.defineProperty(res, "url", { value: url });
  return res;
};

/** The lab answers every allowed certificate link from the fixtures. */
function labServes(opts: { pdf?: (i: number) => Uint8Array } = {}) {
  net.httpRoute = (url) => {
    const i = items.findIndex((it) => it.lab_result_link === url || it.lab_result_data.coa === url);
    if (i < 0) return new Response("nope", { status: 404 });
    if (items[i].lab_result_link === url) return okJson(fx(`item${n2(i)}.wcia.json`), url);
    return okPdf((opts.pdf ?? pdfFor)(i), url);
  };
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  net.reqs.length = 0;
  net.http.length = 0;
  net.storageReads.length = 0;
  net.storage.clear();
  net.route = null;
  net.httpRoute = null;
  net.llama = { configured: false, calls: 0, text: null, error: null };
  net.unpdf = { text: (i) => (i ? fx(`item${i}.unpdf.txt`) : null), calls: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("http://fake.supabase.local")) return realFetch(input as RequestInfo);
    net.http.push(url);
    if (!net.httpRoute) throw new Error("no network in tests");
    return net.httpRoute(url);
  }) as typeof fetch;
});

const lab = (i: number, over: Record<string, unknown> = {}) => ({
  id: `lab${i}`,
  coa_url: items[i].lab_result_data.coa,
  wcia_json_url: items[i].lab_result_link,
  coa_storage_path: null as string | null,
  coa_extract_status: null as string | null,
  ...over,
});

// === 1. readCoaForLab =========================================================
describe("R28 readCoaForLab (one certificate, both documents)", () => {
  it("item 12: lab JSON + PDF text layer -> ok, 5.5 mg per serving, no LlamaParse credit spent", async () => {
    labServes();
    net.llama.configured = true;
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12), { actorId: "u1" });
    expect(ex.status).toBe("ok");
    expect(ex.pdfVia).toBe("unpdf");
    expect(ex.identity.every((c) => c.ok)).toBe(true);
    expect(ex.agreement.length).toBeGreaterThan(0);
    expect(ex.agreement.every((c) => c.ok)).toBe(true);
    expect(ex.pdf?.servingWeightG).toBe(4.54);
    expect(ex.pdf?.summary.totalThcMgPerServing).toBe(5.5);
    expect(net.llama.calls).toBe(0); // the text layer had the numbers
    expect(net.http).toEqual([items[12].lab_result_link, items[12].lab_result_data.coa]);
  });

  it("the archived copy is read first; the link is not fetched", async () => {
    labServes();
    net.storage.set("coa/lab12.pdf", pdfFor(12));
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12, { coa_storage_path: "coa/lab12.pdf" }), { actorId: null });
    expect(ex.status).toBe("ok");
    expect(net.storageReads).toEqual(["coa/coa/lab12.pdf"]);
    expect(net.http).toEqual([items[12].lab_result_link]);
  });

  it("an archived file that is not a PDF falls back to the link", async () => {
    labServes();
    net.storage.set("bad.pdf", new TextEncoder().encode("<html>"));
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12, { coa_storage_path: "bad.pdf" }), { actorId: null });
    expect(ex.status).toBe("ok");
    expect(net.http).toContain(items[12].lab_result_data.coa);
  });

  it("GGL image-style certificate (item 01): the text layer has no numbers -> LlamaParse is used and wins", async () => {
    labServes();
    net.llama.configured = true;
    // LlamaParse returns a full reading (the layout text stands in for its output).
    net.llama.text = fx("item01.layout.txt");
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(1), { actorId: "u1" });
    expect(net.llama.calls).toBe(1);
    expect(ex.pdfVia).toBe("llamaparse");
    expect(ex.pdf?.potencyReadable).toBe(true);
  });

  it("GGL without a LlamaParse key: never called, the reason is kept, the read is partial (not ok)", async () => {
    labServes();
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(1), { actorId: null });
    expect(net.llama.calls).toBe(0);
    expect(ex.status).not.toBe("ok");
  });

  it("the lot page button (alwaysLlama) asks LlamaParse even when the text layer was enough", async () => {
    labServes();
    net.llama.configured = true;
    net.llama.text = fx("item12.layout.txt");
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12), { actorId: "u1", alwaysLlama: true });
    expect(net.llama.calls).toBe(1);
    expect(ex.status).toBe("ok");
  });

  it("a LlamaParse failure is recorded and the text layer still wins", async () => {
    labServes();
    net.llama.configured = true;
    net.llama.error = "job timed out";
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12), { actorId: "u1", alwaysLlama: true });
    expect(ex.status).toBe("ok");
    expect(ex.pdfVia).toBe("unpdf");
  });

  it("links off the allow-list are never fetched", async () => {
    labServes();
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12, { coa_url: "https://evil.example/x.pdf", wcia_json_url: "http://certs.conflabs.com/wcia/x" }), { actorId: null });
    expect(net.http).toEqual([]);
    expect(ex.status).toBe("failed");
    expect(JSON.stringify(ex)).toContain("evil.example is not a known lab host");
  });

  it("a redirect off the lab host is refused", async () => {
    net.httpRoute = () => okJson("{}", "https://evil.example/landing");
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12, { coa_url: null }), { actorId: null });
    expect(JSON.stringify(ex)).toContain("redirected off the lab host (evil.example)");
  });

  it("an HTML answer, a non-PDF body, an HTTP error and an oversize PDF are each refused with the reason", async () => {
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    net.httpRoute = (url) => okPdf(new TextEncoder().encode("<html>"), url, "text/html");
    expect(JSON.stringify(await readCoaForLab(lab(12, { wcia_json_url: null }), { actorId: null }))).toContain("unexpected content type text/html");
    net.httpRoute = (url) => okPdf(new TextEncoder().encode("<html>hello"), url);
    expect(JSON.stringify(await readCoaForLab(lab(12, { wcia_json_url: null }), { actorId: null }))).toContain("the COA link did not return a PDF");
    net.httpRoute = () => new Response("x", { status: 503 });
    expect(JSON.stringify(await readCoaForLab(lab(12, { wcia_json_url: null }), { actorId: null }))).toContain("HTTP 503");
    const { COA_PDF_MAX_BYTES } = await import("@/lib/inventory/coa-extract-core");
    net.httpRoute = (url) => {
      const res = okPdf(pdfFor(12), url);
      res.headers.set("content-length", String(COA_PDF_MAX_BYTES + 1));
      return res;
    };
    expect(JSON.stringify(await readCoaForLab(lab(12, { wcia_json_url: null }), { actorId: null }))).toContain("too large");
  });

  it("the JSON unreachable -> the PDF alone is a PARTIAL read with the reason (never ok)", async () => {
    net.httpRoute = (url) => (url === items[12].lab_result_link ? new Response("x", { status: 500 }) : okPdf(pdfFor(12), url));
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(lab(12), { actorId: null });
    expect(ex.status).toBe("partial");
    expect(ex.summary).toContain("HTTP 500");
  });
});

// === 2. runForLabs ===========================================================
const MAN = "11111111-1111-4111-8111-111111111111";
function db(w: { labs: ReturnType<typeof lab>[]; lots?: { lab_result_id: string; kb_product_id?: string | null }[]; kb?: { id: string; terpenes: string[]; cannabinoids: string[] }[]; missingColumn?: boolean; updateError?: boolean; lotsKbError?: { status: number; body: unknown }; kbReadError?: boolean; kbWriteError?: boolean }) {
  net.route = (r) => {
    const t = table(r);
    if (t === "inventory_lots" && r.method === "GET") {
      const sel = r.url.searchParams.get("select") ?? "";
      if (sel.includes("kb_product_id")) {
        if (w.lotsKbError) return w.lotsKbError;
        const labId = (r.url.searchParams.get("lab_result_id") ?? "").replace("eq.", "");
        return { status: 200, body: (w.lots ?? []).filter((l) => l.lab_result_id === labId && l.kb_product_id).map((l) => ({ kb_product_id: l.kb_product_id })) };
      }
      if (r.url.searchParams.get("id")) return { status: 200, body: { lab_result_id: w.labs[0]?.id ?? null, manifest_id: MAN } };
      return { status: 200, body: (w.lots ?? w.labs.map((l) => ({ lab_result_id: l.id }))).map((l) => ({ lab_result_id: l.lab_result_id })) };
    }
    if (t === "lab_results" && r.method === "GET") {
      if (w.missingColumn) return { status: 400, body: { code: "42703", message: "column lab_results.wcia_json_url does not exist" } };
      return { status: 200, body: w.labs };
    }
    if (t === "lab_results" && r.method === "PATCH") return w.updateError ? { status: 500, body: { code: "XX000", message: "disk full" } } : { status: 204, body: null };
    if (t === "kb_products" && r.method === "GET") return w.kbReadError ? { status: 500, body: { code: "XX000", message: "kb read boom" } } : { status: 200, body: w.kb ?? [] };
    if (t === "kb_products" && r.method === "PATCH") return w.kbWriteError ? { status: 500, body: { code: "XX000", message: "kb write boom" } } : { status: 204, body: null };
    return undefined;
  };
}
const patches = () => net.reqs.filter((r) => table(r) === "lab_results" && r.method === "PATCH");

describe("R28 extractCoasForManifest / extractCoaForLot", () => {
  it("reads every unread certificate of the delivery and stores each read (status, time, the read)", async () => {
    labServes();
    db({ labs: [lab(12), lab(13), lab(0)] });
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(run).toMatchObject({ migrated: true, pending: 3, read: 3, ok: 3, partial: 0, failed: 0, deferred: 0, errors: [] });
    expect(patches()).toHaveLength(3);
    const body = patches()[0].body as { coa_extract_json: { version: number }; coa_extract_status: string; coa_extracted_at: string };
    expect(body.coa_extract_status).toBe("ok");
    expect(body.coa_extract_json.version).toBeGreaterThan(0);
    expect(body.coa_extracted_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("already-read rows are skipped at finalize; the lot button forces a re-read", async () => {
    labServes();
    db({ labs: [lab(12, { coa_extract_status: "ok" })] });
    const { extractCoasForManifest, extractCoaForLot } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(run.pending).toBe(0);
    expect(patches()).toHaveLength(0);
    const forced = await extractCoaForLot("lot-1", "u1");
    expect(forced).toMatchObject({ read: 1, ok: 1, manifestId: MAN });
    expect(patches()).toHaveLength(1);
  });

  it("a database without 0252 -> migrated false, nothing fetched, nothing written", async () => {
    labServes();
    db({ labs: [lab(12)], missingColumn: true });
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(run.migrated).toBe(false);
    expect(net.http).toHaveLength(0);
    expect(patches()).toHaveLength(0);
  });

  it("a failed write is an error, not a read", async () => {
    labServes();
    db({ labs: [lab(12)], updateError: true });
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(run.read).toBe(0);
    expect(run.errors.join(" ")).toContain("disk full");
  });

  it("the time budget: no new batch after it; the rest are deferred for the next pass", async () => {
    labServes();
    db({ labs: [lab(12), lab(13), lab(14), lab(15), lab(16), lab(0)] });
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1", { budgetMs: -1 });
    expect(run.pending).toBe(6);
    expect(run.deferred).toBe(6);
    expect(run.read).toBe(0);
    const { coaExtractRunNote } = await import("@/lib/inventory/coa-extract-core");
    expect(coaExtractRunNote(run)).toContain("6 left for the next pass");
  });

  it("a lot with no lab result says so (the button's 'nolab' banner)", async () => {
    net.route = (r) => (table(r) === "inventory_lots" ? { status: 200, body: { lab_result_id: null, manifest_id: MAN } } : undefined);
    const { extractCoaForLot } = await import("@/lib/inventory/coa-extract");
    const { coaRereadCode } = await import("@/lib/inventory/coa-panel-core");
    const run = await extractCoaForLot("lot-1", "u1");
    expect(run.errors).toEqual(["this lot has no lab result"]);
    expect(coaRereadCode(run)).toBe("nolab");
  });

  it("KB fill-only: an empty terpene list is filled from the certificate; a list a person saved is never touched", async () => {
    labServes();
    db({
      labs: [lab(0)],
      lots: [{ lab_result_id: "lab0", kb_product_id: "kb-empty" }],
      kb: [{ id: "kb-empty", terpenes: [], cannabinoids: [] }],
    });
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(run.kbFilled).toBe(1);
    const kbPatch = net.reqs.find((r) => table(r) === "kb_products" && r.method === "PATCH")!;
    expect((kbPatch.body as { terpenes: string[] }).terpenes.length).toBeGreaterThan(3);

    net.reqs.length = 0;
    const full = { id: "kb-full", terpenes: ["myrcene", "limonene", "caryophyllene", "pinene", "linalool", "humulene", "terpinolene", "ocimene", "bisabolol", "nerolidol", "guaiol", "camphene", "carene", "terpineol", "fenchol", "borneol", "eucalyptol", "isopulegol", "geraniol", "valencene", "phellandrene", "sabinene", "cymene", "farnesene"], cannabinoids: ["thc", "thca", "cbd", "cbda", "cbg", "cbga", "cbn", "cbc", "thcv", "cbdv", "d8-thc"] };
    db({ labs: [lab(0)], lots: [{ lab_result_id: "lab0", kb_product_id: "kb-full" }], kb: [full] });
    await extractCoasForManifest(MAN, "u1");
    const p2 = net.reqs.find((r) => table(r) === "kb_products" && r.method === "PATCH");
    if (p2) {
      // only ADDS: every saved entry is still there, in order, at the front
      const next = (p2.body as { terpenes?: string[] }).terpenes;
      if (next) expect(next.slice(0, full.terpenes.length)).toEqual(full.terpenes);
    }
  });

  it("KB fill before 0234 (no inventory_lots.kb_product_id): nothing to follow, the read still counts, NO error", async () => {
    labServes();
    db({
      labs: [lab(0)],
      lotsKbError: { status: 400, body: { code: "42703", message: "column inventory_lots.kb_product_id does not exist" } },
    });
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(run).toMatchObject({ read: 1, ok: 1, kbFilled: 0, errors: [] });
    expect(net.reqs.some((r) => table(r) === "kb_products")).toBe(false);
  });

  it("any OTHER KB fill failure is reported in errors (lots, product read, product write) - never swallowed", async () => {
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const cases: [Parameters<typeof db>[0], string][] = [
      [{ labs: [lab(0)], lotsKbError: { status: 500, body: { code: "XX000", message: "lots boom" } } }, "the lots could not be read (lots boom)"],
      [{ labs: [lab(0)], lots: [{ lab_result_id: "lab0", kb_product_id: "kb-1" }], kbReadError: true }, "the products could not be read (kb read boom)"],
      [{ labs: [lab(0)], lots: [{ lab_result_id: "lab0", kb_product_id: "kb-1" }], kb: [{ id: "kb-1", terpenes: [], cannabinoids: [] }], kbWriteError: true }, "product kb-1 was not updated (kb write boom)"],
    ];
    for (const [w, msg] of cases) {
      net.reqs.length = 0;
      labServes();
      db(w);
      const run = await extractCoasForManifest(MAN, "u1");
      expect(run.read, msg).toBe(1); // the certificate read itself is kept
      expect(run.kbFilled, msg).toBe(0);
      expect(run.errors, msg).toEqual([`lab0: knowledge base fill: ${msg}`]);
    }
  });
});

// === 3. loadCoaFactsForDrafts ================================================
describe("R28 loadCoaFactsForDrafts (staging's bridge)", () => {
  const drafts = [12, 13, 14, 15, 16, 0].map((i) => ({ id: `d${i}`, name: items[i].product_name, inventory_type: items[i].inventory_type, lot_id: `lot${i}` }));

  async function storedReads() {
    const { buildCoaExtract, pickPdfText } = await import("@/lib/inventory/coa-extract-core");
    return [12, 13, 14, 15, 16, 0].map((i) => ({
      id: `lab${i}`,
      coa_extract_json: JSON.parse(
        JSON.stringify(
          buildCoaExtract({
            jsonUrl: items[i].lab_result_link,
            transferCoaUrl: items[i].lab_result_data.coa,
            json: { text: fx(`item${n2(i)}.wcia.json`), error: null },
            pdf: pickPdfText([{ via: "unpdf", text: fx(`item${n2(i)}.unpdf.txt`), error: null }]),
            at: "2026-01-01T00:00:00.000Z",
          }),
        ),
      ),
      total_thc_pct: pot(i, "total-thc"),
      total_cbd_pct: pot(i, "total-cbd"),
      cbd_pct: null,
    }));
  }

  it("the five edibles get the certificate's package THC; flower gets none; items 13/14 carry the WA hold", async () => {
    const labs = await storedReads();
    net.route = (r) => {
      if (table(r) === "inventory_lots") return { status: 200, body: drafts.map((d, k) => ({ id: d.lot_id, lab_result_id: labs[k].id })) };
      if (table(r) === "lab_results") return { status: 200, body: labs };
      return undefined;
    };
    const { loadCoaFactsForDrafts } = await import("@/lib/inventory/coa-facts-server");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const m = await loadCoaFactsForDrafts(createSupabaseAdminClient(), drafts);
    expect(Array.from(m.keys()).sort()).toEqual(["d12", "d13", "d14", "d15", "d16"]);
    expect(m.get("d12")?.packageThcMg?.value).toBe(55);
    expect(m.get("d15")?.packageThcMg?.value).toBe(100);
    expect(m.get("d16")?.packageThcMg?.value).toBe(100);
    expect(m.get("d13")?.reasons.join(" ")).toContain("100 mg");
    expect(m.get("d14")?.reasons.join(" ")).toContain("100 mg");
    // the lab read selects only the lots of mg-dosed drafts (flower's lot is not asked for)
    const lotQ = net.reqs.find((r) => table(r) === "inventory_lots")!;
    expect(lotQ.url.searchParams.get("id")).not.toContain("lot0");
  });

  it("no mg-dosed drafts -> no reads at all", async () => {
    const { loadCoaFactsForDrafts } = await import("@/lib/inventory/coa-facts-server");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const m = await loadCoaFactsForDrafts(createSupabaseAdminClient(), [drafts[5]]);
    expect(m.size).toBe(0);
    expect(net.reqs).toHaveLength(0);
  });

  it("a database without 0252, or any failed read -> empty map (staging runs as before), never a throw", async () => {
    const { loadCoaFactsForDrafts } = await import("@/lib/inventory/coa-facts-server");
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    net.route = (r) =>
      table(r) === "inventory_lots"
        ? { status: 200, body: [{ id: "lot12", lab_result_id: "lab12" }] }
        : { status: 400, body: { code: "42703", message: "column lab_results.coa_extract_json does not exist" } };
    expect((await loadCoaFactsForDrafts(createSupabaseAdminClient(), drafts)).size).toBe(0);
    net.route = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
    expect((await loadCoaFactsForDrafts(createSupabaseAdminClient(), drafts)).size).toBe(0);
  });
});

// === 4. The real PDF =========================================================
describe("R28 the real item 12 COA PDF", () => {
  it("unpdf's text layer of the archived owner PDF parses to 4.54 g servings and 5.5 mg THC each", async () => {
    const real = await vi.importActual<typeof import("@/lib/inventory/pdf-extract")>("@/lib/inventory/pdf-extract");
    const bytes = new Uint8Array(readFileSync(join(FX, "item12.coa.pdf")));
    const text = await real.extractPdfText(bytes);
    const { parseCoaPdfText } = await import("@/lib/inventory/coa-pdf-text-core");
    const r = parseCoaPdfText(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.servingWeightG).toBe(4.54);
      expect(r.doc.summary.totalThcMgPerServing).toBe(5.5);
      expect(r.doc.potencyReadable).toBe(true);
    }
  });
});
