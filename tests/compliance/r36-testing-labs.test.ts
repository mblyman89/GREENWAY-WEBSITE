/**
 * tests/compliance/r36-testing-labs.test.ts  (R36 #4)
 *
 * The testing-labs list and the certificate reader's host allow-list, end to end
 * over a fake PostgREST, a fake DNS and a fake network:
 *
 *   A. the 0256 seed IS testing-labs-core SEEDED_LAB_ROWS (parsed from the SQL,
 *      every column), so the page and the reader can never disagree;
 *   B. testing-labs-store: list / missing-schema / owner hosts (built-ins and
 *      bad hosts dropped, read failures never throw) / add (23505) / host
 *      edits (optimistic concurrency, 23514, the PATCH body);
 *   C. fetchBounded through readCoaForLab: owner hosts are DNS-checked (every
 *      address public), built-ins are not; redirects are followed BY HAND -
 *      relative Location resolved, every hop re-checked against the allow-list
 *      and DNS, the 5-redirect cap, a missing Location; runForLabs reads the
 *      owner hosts ONCE per pass and uses them;
 *   D. wiring: the Inventory button, the page's permission and sections.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEEDED_LAB_ROWS, BUILT_IN_COA_HOSTS, CULTIVERA_PLATFORM, WA_TESTING_LABS } from "@/lib/inventory/testing-labs-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const FX = join(ROOT, "tests", "fixtures", "coa");
const fx = (f: string) => readFileSync(join(FX, f), "utf8");

type Req = { method: string; url: URL; body: unknown; headers: Record<string, string> };
const net = vi.hoisted(() => ({
  reqs: [] as Array<{ method: string; url: URL; body: unknown; headers: Record<string, string> }>,
  route: null as null | ((r: { method: string; url: URL; body: unknown; headers: Record<string, string> }) => { status: number; body?: unknown } | undefined),
  http: [] as Array<{ url: string; redirect: string | undefined }>,
  httpRoute: null as null | ((url: string) => Response),
  dns: new Map<string, string[] | Error>(),
  dnsCalls: [] as Array<{ host: string; opts: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));
vi.mock("node:dns/promises", () => {
  const lookup = async (host: string, opts: unknown) => {
    net.dnsCalls.push({ host, opts });
    const a = net.dns.get(host);
    if (a instanceof Error) throw a;
    return (a ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return { lookup, default: { lookup } };
});
vi.mock("@/lib/inventory/pdf-extract", () => ({
  extractPdfText: async () => fx("item12.unpdf.txt"),
}));
vi.mock("@/lib/inbound-email/llamaparse-provider", () => ({
  isLlamaParseConfigured: () => false,
  parsePdf: async () => ({ ok: false, text: "", error: "not in tests" }),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const raw = typeof init?.body === "string" ? init.body : null;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const r = { method: init?.method ?? "GET", url, body: raw ? JSON.parse(raw) : null, headers };
    net.reqs.push(r);
    const rep = (net.route && net.route(r)) ?? { status: 200, body: [] };
    const nullBody = r.method === "HEAD" || rep.status === 204;
    return new Response(nullBody ? null : JSON.stringify(rep.body ?? []), { status: rep.status, headers: { "content-type": "application/json" } });
  };
  return {
    createSupabaseAdminClient: () => {
      const pg = new PostgrestClient("http://fake.supabase.local/rest/v1", { fetch: fakeFetch as typeof fetch });
      return Object.assign(pg, { storage: { from: () => ({ download: async () => ({ data: null, error: { message: "not found" } }) }) } });
    },
  };
});

const table = (r: Req) => r.url.pathname.split("/").pop() ?? "";
const PDF = new TextEncoder().encode("%PDF-1.7\nITEM12");
const okPdf = (url: string) => {
  const res = new Response(PDF.slice().buffer as ArrayBuffer, { status: 200, headers: { "content-type": "application/pdf" } });
  Object.defineProperty(res, "url", { value: url });
  return res;
};
const redirectTo = (location: string | null) => new Response(null, { status: 302, headers: location === null ? {} : { location } });

const realFetch = globalThis.fetch;
beforeEach(() => {
  net.reqs.length = 0;
  net.http.length = 0;
  net.dnsCalls.length = 0;
  net.dns.clear();
  net.route = null;
  net.httpRoute = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("http://fake.supabase.local")) return realFetch(input as RequestInfo, init);
    net.http.push({ url, redirect: init?.redirect });
    if (!net.httpRoute) throw new Error("no network in tests");
    return net.httpRoute(url);
  }) as typeof fetch;
});

// ============================================================================
// A. The 0256 seed is exactly SEEDED_LAB_ROWS
// ============================================================================

/** Parse the VALUES tuples of 0256's seed insert (quotes, '' escapes, null, ints, text[] literals). */
function parseSeed(sql: string): { cols: string[]; rows: Array<Array<string | number | null | string[]>> } {
  const m = sql.match(/insert into public\.testing_labs \(([^)]*)\)\s*values\s*([\s\S]*?)\non conflict do nothing;/);
  if (!m) throw new Error("seed insert not found");
  const cols = m[1].split(",").map((c) => c.trim());
  const src = m[2];
  const rows: Array<Array<string | number | null | string[]>> = [];
  let i = 0;
  const ws = () => {
    while (i < src.length && /[\s,]/.test(src[i])) i += 1;
  };
  while (i < src.length) {
    ws();
    if (i >= src.length) break;
    if (src[i] !== "(") throw new Error(`expected ( at ${i}: ${src.slice(i, i + 20)}`);
    i += 1;
    const row: Array<string | number | null | string[]> = [];
    for (;;) {
      while (/\s/.test(src[i])) i += 1;
      if (src[i] === ")") {
        i += 1;
        break;
      }
      if (src[i] === ",") {
        i += 1;
        continue;
      }
      if (src[i] === "'") {
        let s = "";
        i += 1;
        for (;;) {
          if (src[i] === "'" && src[i + 1] === "'") {
            s += "'";
            i += 2;
          } else if (src[i] === "'") {
            i += 1;
            break;
          } else {
            s += src[i];
            i += 1;
          }
        }
        row.push(s.startsWith("{") && s.endsWith("}") ? (s === "{}" ? [] : s.slice(1, -1).split(",")) : s);
      } else {
        const t = src.slice(i).match(/^[^,)\s]+/)![0];
        i += t.length;
        row.push(t === "null" ? null : /^\d+$/.test(t) ? Number(t) : (() => { throw new Error(`bad token ${t}`); })());
      }
    }
    rows.push(row);
  }
  return { cols, rows };
}

describe("R36 A - the 0256 seed is testing-labs-core SEEDED_LAB_ROWS, column for column", () => {
  const { cols, rows } = parseSeed(read("supabase/migrations/0256_testing_labs.sql"));
  const KEY: Record<string, keyof (typeof SEEDED_LAB_ROWS)[number]> = {
    lab_number: "labNumber",
    name: "name",
    address: "address",
    city: "city",
    zip: "zip",
    phone: "phone",
    website: "website",
    status: "status",
    cert_start: "certStart",
    cert_current: "certCurrent",
    cert_valid_through: "certValidThrough",
    source: "source",
    coa_hosts: "coaHosts",
  };

  it("the insert names the 13 columns and seeds 12 rows (11 WSLCB labs + Cultivera)", () => {
    expect(cols).toEqual(Object.keys(KEY));
    expect(rows).toHaveLength(12);
    expect(SEEDED_LAB_ROWS).toHaveLength(12);
    expect(WA_TESTING_LABS).toHaveLength(11);
  });

  it("every row, every column, in order", () => {
    rows.forEach((row, r) => {
      const want = SEEDED_LAB_ROWS[r];
      cols.forEach((c, k) => {
        const w = want[KEY[c]];
        expect(row[k], `row ${r} (${want.name}) ${c}`).toEqual(Array.isArray(w) ? [...w] : w);
      });
    });
  });

  it("4 active (2026 list), 7 historical (2021 list), 1 platform without a lab #", () => {
    const by = (s: string) => SEEDED_LAB_ROWS.filter((l) => l.status === s).map((l) => l.labNumber);
    expect(by("active")).toEqual([3, 9, 12, 18]);
    expect(by("historical")).toEqual([4, 6, 7, 8, 21, 22, 25]);
    expect(by("platform")).toEqual([null]);
    expect(CULTIVERA_PLATFORM.coaHosts).toEqual(["files.cultivera.com"]);
  });

  it("every built-in host sits on the seeded row it belongs to", () => {
    for (const h of BUILT_IN_COA_HOSTS) {
      const row = SEEDED_LAB_ROWS.find((l) => l.labNumber === h.labNumber && (h.labNumber !== null || l.status === "platform"));
      expect(row?.coaHosts, h.host).toContain(h.host);
    }
  });

  it("the parser itself sees a changed value (negative)", () => {
    const sql = read("supabase/migrations/0256_testing_labs.sql").replace("'Poulsbo'", "'Seattle'").replace("'{files.cultivera.com}'", "'{files.cultivera.org}'");
    const bad = parseSeed(sql).rows;
    expect(bad[6][3]).toBe("Seattle");
    expect(bad[11][12]).toEqual(["files.cultivera.org"]);
    expect(parseSeed(read("supabase/migrations/0256_testing_labs.sql")).rows[11][11]).toContain("owner's sample");
  });
});

// ============================================================================
// B. testing-labs-store
// ============================================================================

const ID = "11111111-2222-3333-4444-555555555555";
const labRow = (over: Record<string, unknown> = {}) => ({
  id: ID,
  lab_number: 18,
  name: "Medicine Creek Analytics",
  address: null,
  city: "Fife",
  zip: null,
  phone: null,
  website: null,
  status: "active",
  cert_start: null,
  cert_current: null,
  cert_valid_through: null,
  source: null,
  notes: null,
  coa_hosts: [] as string[],
  updated_at: "2026-08-10T10:00:00.000000+00:00",
  ...over,
});
const MISSING = { code: "PGRST205", message: "Could not find the table 'public.testing_labs' in the schema cache" };

describe("R36 B - testing-labs-store", () => {
  it("listTestingLabs: ordered by lab # then name, bounded with range(0, 499), coa_hosts null -> []", async () => {
    net.route = (r) => (table(r) === "testing_labs" ? { status: 200, body: [labRow({ coa_hosts: null })] } : undefined);
    const { listTestingLabs } = await import("@/lib/inventory/testing-labs-store");
    const got = await listTestingLabs();
    expect(got).toMatchObject({ ok: true });
    if (got.ok) expect(got.labs[0].coa_hosts).toEqual([]);
    const q = net.reqs[0].url.searchParams;
    expect(q.get("order")).toBe("lab_number.asc.nullslast,name.asc");
    // this postgrest-js sends .range(0, 499) as offset/limit query params
    expect(q.get("offset")).toBe("0");
    expect(q.get("limit")).toBe("500");
  });

  it("listTestingLabs: 0256 missing -> migrated:false with the plain migration message; other errors -> migrated:true", async () => {
    const { listTestingLabs, MIGRATION_0256_MESSAGE } = await import("@/lib/inventory/testing-labs-store");
    net.route = () => ({ status: 404, body: MISSING });
    expect(await listTestingLabs()).toEqual({ ok: false, migrated: false, error: MIGRATION_0256_MESSAGE });
    net.route = () => ({ status: 500, body: { code: "XX000", message: "disk full" } });
    expect(await listTestingLabs()).toEqual({ ok: false, migrated: true, error: "Could not read the testing labs (disk full)." });
    expect(MIGRATION_0256_MESSAGE).toContain("0256_testing_labs.sql");
  });

  it("isMissingLabsSchema: only THIS table's missing table/column errors", async () => {
    const { isMissingLabsSchema } = await import("@/lib/inventory/testing-labs-store");
    expect(isMissingLabsSchema(MISSING)).toBe(true);
    expect(isMissingLabsSchema({ code: "42P01", message: 'relation "public.testing_labs" does not exist' })).toBe(true);
    expect(isMissingLabsSchema({ code: "42703", message: "column testing_labs.coa_hosts does not exist" })).toBe(true);
    expect(isMissingLabsSchema({ code: "42P01", message: 'relation "public.lab_results" does not exist' })).toBe(false);
    expect(isMissingLabsSchema({ code: "XX000", message: "testing_labs disk full" })).toBe(false);
    expect(isMissingLabsSchema(null)).toBe(false);
  });

  it("loadOwnerCoaHosts: owner hosts only (built-ins, duplicates and invalid hosts dropped)", async () => {
    net.route = () => ({
      status: 200,
      body: [
        { coa_hosts: ["certs.conflabs.com"] },
        { coa_hosts: ["coa.newlab.com", "COA.NEWLAB.COM", "10.0.0.1", "localhost"] },
        { coa_hosts: null },
        { coa_hosts: ["files.cultivera.com", "reports.otherlab.org"] },
      ],
    });
    const { loadOwnerCoaHosts } = await import("@/lib/inventory/testing-labs-store");
    expect(await loadOwnerCoaHosts()).toEqual({ hosts: ["coa.newlab.com", "reports.otherlab.org"], note: null });
    expect(net.reqs[0].url.searchParams.get("select")).toBe("coa_hosts");
  });

  it("loadOwnerCoaHosts never throws: missing table -> [] silently; other error -> [] + the reason", async () => {
    const { loadOwnerCoaHosts } = await import("@/lib/inventory/testing-labs-store");
    net.route = () => ({ status: 404, body: MISSING });
    expect(await loadOwnerCoaHosts()).toEqual({ hosts: [], note: null });
    net.route = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
    expect(await loadOwnerCoaHosts()).toEqual({ hosts: [], note: "owner lab hosts not read (boom); built-in hosts only" });
  });

  it("addTestingLab: inserts as owner_added with the actor; 23505 -> already on the list; 0256 missing -> the message", async () => {
    const { addTestingLab, MIGRATION_0256_MESSAGE } = await import("@/lib/inventory/testing-labs-store");
    const lab = { name: "New Lab", labNumber: 31, city: "Tacoma", phone: null, website: "https://newlab.com/", notes: null };
    net.route = (r) => (r.method === "POST" ? { status: 201, body: { id: ID } } : undefined);
    expect(await addTestingLab(lab, "u1")).toEqual({ ok: true, id: ID });
    expect(net.reqs[0].body).toMatchObject({ name: "New Lab", lab_number: 31, status: "owner_added", created_by: "u1", source: "Added on /admin/inventory/labs" });
    net.route = () => ({ status: 409, body: { code: "23505", message: "duplicate key value violates unique constraint" } });
    expect(await addTestingLab(lab, "u1")).toEqual({ ok: false, error: "A lab with that name or lab # is already on the list." });
    expect(await addTestingLab({ ...lab, labNumber: null }, "u1")).toEqual({ ok: false, error: "A lab with that name is already on the list." });
    net.route = () => ({ status: 404, body: MISSING });
    expect(await addTestingLab(lab, "u1")).toEqual({ ok: false, error: MIGRATION_0256_MESSAGE });
  });

  /** A lab row the store reads, then the PATCH answer. */
  function hostDb(o: { row?: Record<string, unknown> | null; patch?: { status: number; body?: unknown } }) {
    net.route = (r) => {
      if (table(r) !== "testing_labs") return undefined;
      if (r.method === "GET") return { status: 200, body: o.row === null ? [] : [labRow(o.row ?? {})] };
      if (r.method === "PATCH") return o.patch ?? { status: 200, body: [{ id: ID }] };
      return undefined;
    };
  }
  const patches = () => net.reqs.filter((r) => r.method === "PATCH");
  const SEEN = "2026-08-10T10:00:00.000000+00:00";

  it("editLabHost add: normalizes a pasted link to its host; the PATCH re-asserts the updated_at it read", async () => {
    hostDb({ row: { coa_hosts: ["reports.medicinecreek.com"] } });
    const { editLabHost } = await import("@/lib/inventory/testing-labs-store");
    const r = await editLabHost(ID, "add", " https://COA.MedicineCreekAnalytics.com/x/y.pdf ", SEEN);
    expect(r).toEqual({ ok: true, id: ID, host: "coa.medicinecreekanalytics.com", before: ["reports.medicinecreek.com"], after: ["reports.medicinecreek.com", "coa.medicinecreekanalytics.com"] });
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toEqual({ coa_hosts: ["reports.medicinecreek.com", "coa.medicinecreekanalytics.com"] });
    expect(patches()[0].url.searchParams.get("id")).toBe(`eq.${ID}`);
    expect(patches()[0].url.searchParams.get("updated_at")).toBe(`eq.${SEEN}`);
  });

  it("editLabHost remove: the host leaves the array; a host not on the lab is refused with no write", async () => {
    hostDb({ row: { coa_hosts: ["a.example.com", "b.labhost.com"] } });
    const { editLabHost } = await import("@/lib/inventory/testing-labs-store");
    expect(await editLabHost(ID, "remove", " B.LABHOST.COM ", SEEN)).toMatchObject({ ok: true, host: "b.labhost.com", after: ["a.example.com"] });
    expect(patches()[0].body).toEqual({ coa_hosts: ["a.example.com"] });
    net.reqs.length = 0;
    expect(await editLabHost(ID, "remove", "c.labhost.com", SEEN)).toEqual({ ok: false, error: "c.labhost.com is not on this lab." });
    expect(patches()).toHaveLength(0);
  });

  it("editLabHost refuses BEFORE writing: bad id, gone row, changed since the page was opened, invalid host, built-in host", async () => {
    const { editLabHost } = await import("@/lib/inventory/testing-labs-store");
    hostDb({});
    expect(await editLabHost("not-a-uuid", "add", "x.labhost.com", SEEN)).toEqual({ ok: false, error: "That lab could not be found." });
    expect(net.reqs).toHaveLength(0);
    hostDb({ row: null });
    expect(await editLabHost(ID, "add", "x.labhost.com", SEEN)).toEqual({ ok: false, error: "That lab is no longer on the list." });
    hostDb({});
    expect(await editLabHost(ID, "add", "x.labhost.com", "2026-08-10T09:00:00+00:00")).toMatchObject({ ok: false, error: expect.stringContaining("was changed since you opened this page") });
    expect((await editLabHost(ID, "add", "http://10.0.0.1/", SEEN)).ok).toBe(false);
    expect(await editLabHost(ID, "add", "certs.conflabs.com", SEEN)).toMatchObject({ ok: false, error: expect.stringContaining("already built in") });
    expect(patches()).toHaveLength(0);
  });

  it("editLabHost: a PATCH matching 0 rows (someone else saved first) -> changed at the same moment; 23514 -> the database refused it", async () => {
    const { editLabHost, MIGRATION_0256_MESSAGE } = await import("@/lib/inventory/testing-labs-store");
    hostDb({ patch: { status: 200, body: [] } });
    expect(await editLabHost(ID, "add", "x.labhost.com", SEEN)).toMatchObject({ ok: false, error: expect.stringContaining("changed at the same moment") });
    hostDb({ patch: { status: 400, body: { code: "23514", message: "violates check constraint testing_labs_hosts_chk" } } });
    expect(await editLabHost(ID, "add", "x.labhost.com", SEEN)).toEqual({ ok: false, error: "The database refused x.labhost.com (not a plain host name). Nothing was changed." });
    hostDb({ patch: { status: 404, body: MISSING } });
    expect(await editLabHost(ID, "add", "x.labhost.com", SEEN)).toEqual({ ok: false, error: MIGRATION_0256_MESSAGE });
  });
});

// ============================================================================
// C. The certificate fetch: owner hosts, DNS, hand-followed redirects
// ============================================================================

const OWNER = "coa.newlab.com";
const pdfLab = (coa_url: string) => ({ id: "lab-x", coa_url, wcia_json_url: null, coa_storage_path: null, coa_extract_status: null });
const ctx = { extraHosts: [OWNER] };

describe("R36 C - owner hosts are DNS-checked; built-ins are not", () => {
  it("an owner host whose every address is public is fetched (lookup all:true, verbatim)", async () => {
    net.dns.set(OWNER, ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    net.httpRoute = okPdf;
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(pdfLab(`https://${OWNER}/c/1.pdf`), { actorId: null, hosts: ctx });
    expect(net.http).toEqual([{ url: `https://${OWNER}/c/1.pdf`, redirect: "manual" }]);
    expect(net.dnsCalls).toEqual([{ host: OWNER, opts: { all: true, verbatim: true } }]);
    expect(ex.pdfVia).toBe("unpdf");
  });

  for (const [why, answer, expectText] of [
    ["a private address", ["10.0.0.5"], "resolves to a non-public address (10.0.0.5) - not fetched"],
    ["the cloud metadata address among public ones", ["93.184.216.34", "169.254.169.254"], "non-public address (169.254.169.254)"],
    ["IPv6 loopback", ["::1"], "non-public address (::1)"],
    ["no address at all", [], `${OWNER} did not resolve`],
    ["a DNS failure", new Error("getaddrinfo ENOTFOUND"), `${OWNER} did not resolve (getaddrinfo ENOTFOUND)`],
  ] as const) {
    it(`an owner host with ${why} is NOT fetched`, async () => {
      net.dns.set(OWNER, answer instanceof Error ? answer : [...answer]);
      net.httpRoute = okPdf;
      const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
      const ex = await readCoaForLab(pdfLab(`https://${OWNER}/c/1.pdf`), { actorId: null, hosts: ctx });
      expect(net.http).toEqual([]);
      expect(ex.status).toBe("failed");
      expect(JSON.stringify(ex)).toContain(expectText);
    });
  }

  it("a built-in host is fetched without a DNS lookup", async () => {
    net.httpRoute = okPdf;
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    await readCoaForLab(pdfLab("https://files.cultivera.com/abc/coa.pdf"), { actorId: null, hosts: ctx });
    expect(net.dnsCalls).toEqual([]);
    expect(net.http.map((h) => h.url)).toEqual(["https://files.cultivera.com/abc/coa.pdf"]);
  });

  it("the owner host is refused when the pass did not load it (no extra hosts) - and the reason says where to add it", async () => {
    net.dns.set(OWNER, ["93.184.216.34"]);
    net.httpRoute = okPdf;
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(pdfLab(`https://${OWNER}/c/1.pdf`), { actorId: null, hosts: { extraHosts: [] } });
    expect(net.http).toEqual([]);
    expect(JSON.stringify(ex)).toContain(`${OWNER} is not a known lab host`);
    expect(JSON.stringify(ex)).toContain("Inventory -> Testing labs");
  });
});

describe("R36 C - redirects are followed by hand, every hop re-checked", () => {
  it("a relative Location is resolved against the current link and followed (on an allowed host)", async () => {
    net.httpRoute = (url) => (url.endsWith("/a.pdf") ? redirectTo("../b/c.pdf") : okPdf(url));
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(pdfLab("https://files.cultivera.com/x/y/a.pdf"), { actorId: null, hosts: ctx });
    expect(net.http).toEqual([
      { url: "https://files.cultivera.com/x/y/a.pdf", redirect: "manual" },
      { url: "https://files.cultivera.com/x/b/c.pdf", redirect: "manual" },
    ]);
    expect(ex.pdfVia).toBe("unpdf");
  });

  it("a hop off the allow-list is refused BEFORE it is requested", async () => {
    net.httpRoute = () => redirectTo("https://169.254.169.254/latest/meta-data/");
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(pdfLab("https://files.cultivera.com/a.pdf"), { actorId: null, hosts: ctx });
    expect(net.http).toHaveLength(1);
    expect(JSON.stringify(ex)).toContain("redirected off the lab host (169.254.169.254)");
  });

  it("a hop onto an owner host is DNS-checked before it is requested", async () => {
    net.dns.set(OWNER, ["192.168.1.10"]);
    net.httpRoute = (url) => (url.startsWith("https://files.cultivera.com") ? redirectTo(`https://${OWNER}/z.pdf`) : okPdf(url));
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(pdfLab("https://files.cultivera.com/a.pdf"), { actorId: null, hosts: ctx });
    expect(net.http.map((h) => h.url)).toEqual(["https://files.cultivera.com/a.pdf"]);
    expect(net.dnsCalls.map((d) => d.host)).toEqual([OWNER]);
    expect(JSON.stringify(ex)).toContain("non-public address (192.168.1.10)");
  });

  it("an https -> http downgrade hop is refused", async () => {
    net.httpRoute = () => redirectTo("http://files.cultivera.com/a.pdf");
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(pdfLab("https://files.cultivera.com/a.pdf"), { actorId: null, hosts: ctx });
    expect(net.http).toHaveLength(1);
    expect(JSON.stringify(ex)).toContain("redirected off the lab host (files.cultivera.com)");
  });

  it("a 3xx without a Location is an error, never a guess", async () => {
    net.httpRoute = () => redirectTo(null);
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    const ex = await readCoaForLab(pdfLab("https://files.cultivera.com/a.pdf"), { actorId: null, hosts: ctx });
    expect(JSON.stringify(ex)).toContain("redirect with no Location");
  });

  it("at most 5 redirects: 5 hops are followed, the 6th 3xx is refused", async () => {
    const { COA_MAX_REDIRECTS } = await import("@/lib/inventory/coa-extract-core");
    expect(COA_MAX_REDIRECTS).toBe(5);
    const { readCoaForLab } = await import("@/lib/inventory/coa-extract");
    net.httpRoute = (url) => {
      const n = Number(url.match(/r(\d+)\.pdf$/)?.[1] ?? 0);
      return n < 5 ? redirectTo(`/r${n + 1}.pdf`) : okPdf(url);
    };
    const five = await readCoaForLab(pdfLab("https://files.cultivera.com/r0.pdf"), { actorId: null, hosts: ctx });
    expect(net.http).toHaveLength(6);
    expect(five.pdfVia).toBe("unpdf");
    net.http.length = 0;
    net.httpRoute = (url) => redirectTo(`/r${Number(url.match(/r(\d+)\.pdf$/)?.[1] ?? 0) + 1}.pdf`);
    const loop = await readCoaForLab(pdfLab("https://files.cultivera.com/r0.pdf"), { actorId: null, hosts: ctx });
    expect(net.http).toHaveLength(6);
    expect(JSON.stringify(loop)).toContain("more than 5 redirects");
  });
});

describe("R36 C - a COA pass reads the owner hosts once and uses them", () => {
  const MAN = "99999999-8888-7777-6666-555555555555";
  it("extractCoasForManifest: testing_labs read once for 2 certificates; the owner-host links are fetched", async () => {
    net.dns.set(OWNER, ["93.184.216.34"]);
    net.httpRoute = okPdf;
    net.route = (r) => {
      const t = table(r);
      if (t === "inventory_lots") return { status: 200, body: [{ lab_result_id: "l1" }, { lab_result_id: "l2" }] };
      if (t === "lab_results" && r.method === "GET") return { status: 200, body: [pdfLab(`https://${OWNER}/1.pdf`), { ...pdfLab(`https://${OWNER}/2.pdf`), id: "l2" }] };
      if (t === "lab_results" && r.method === "PATCH") return { status: 204, body: null };
      if (t === "testing_labs") return { status: 200, body: [{ coa_hosts: [OWNER] }] };
      return undefined;
    };
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(net.reqs.filter((r) => table(r) === "testing_labs")).toHaveLength(1);
    expect(net.http.map((h) => h.url).sort()).toEqual([`https://${OWNER}/1.pdf`, `https://${OWNER}/2.pdf`]);
    expect(run.read).toBe(2);
  });

  it("no pending certificate -> the hosts are not even read", async () => {
    net.route = (r) => {
      const t = table(r);
      if (t === "inventory_lots") return { status: 200, body: [{ lab_result_id: "l1" }] };
      if (t === "lab_results") return { status: 200, body: [{ ...pdfLab("https://files.cultivera.com/1.pdf"), id: "l1", coa_extract_status: "ok" }] };
      return undefined;
    };
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    expect((await extractCoasForManifest(MAN, "u1")).pending).toBe(0);
    expect(net.reqs.filter((r) => table(r) === "testing_labs")).toHaveLength(0);
  });

  it("the labs table missing -> the pass still reads built-in hosts (the owner host is refused, nothing thrown)", async () => {
    net.httpRoute = okPdf;
    net.route = (r) => {
      const t = table(r);
      if (t === "inventory_lots") return { status: 200, body: [{ lab_result_id: "l1" }, { lab_result_id: "l2" }] };
      if (t === "lab_results" && r.method === "GET") return { status: 200, body: [pdfLab("https://files.cultivera.com/1.pdf"), { ...pdfLab(`https://${OWNER}/2.pdf`), id: "l2" }] };
      if (t === "lab_results" && r.method === "PATCH") return { status: 204, body: null };
      if (t === "testing_labs") return { status: 404, body: MISSING };
      return undefined;
    };
    const { extractCoasForManifest } = await import("@/lib/inventory/coa-extract");
    const run = await extractCoasForManifest(MAN, "u1");
    expect(run.read).toBe(2);
    expect(run.errors).toEqual([]);
    expect(net.http.map((h) => h.url)).toEqual(["https://files.cultivera.com/1.pdf"]);
  });
});

// ============================================================================
// D. Wiring
// ============================================================================

describe("R36 D - the Inventory button and the labs page", () => {
  const inv = read("src/app/admin/inventory/page.tsx");
  const page = read("src/app/admin/inventory/labs/page.tsx");
  const actions = read("src/app/admin/inventory/labs/actions.ts");

  it("Inventory's header has a Testing labs button to /admin/inventory/labs", () => {
    expect(inv).toMatch(/<Button href="\/admin\/inventory\/labs" variant="neutral" size="sm" data-testid="inventory-testing-labs-button">\s*Testing labs\s*<\/Button>/);
  });

  it("the page needs inventory.manage, is always fresh, and has every section", () => {
    expect(page).toContain('await requirePermission("inventory.manage");');
    expect(page).toContain('export const dynamic = "force-dynamic";');
    expect(page).toContain('{ label: "Inventory", href: "/admin/inventory" }, { label: "Testing labs" }');
    for (const s of ["<form action={addLabAction}", "<form action={addHostAction}", "<form action={removeHostAction}", 'name="updated_at" value={l.updated_at}', "BUILT_IN_COA_HOSTS.map", "READABLE_LAYOUTS[l.lab_number]", 'id="add-lab"']) {
      expect(page, s).toContain(s);
    }
    // built-in hosts get no Remove button (they are always allowed anyway)
    expect(page).toContain("{isBuiltInHost(h) ? null : (");
  });

  it("every action checks the permission first and audits", () => {
    expect(actions.startsWith('"use server";')).toBe(true);
    expect(actions.match(/await requirePermission\("inventory\.manage"\)/g)).toHaveLength(2);
    for (const a of ['"testing_lab.add"', '"testing_lab.host_added"', '"testing_lab.host_removed"']) expect(actions).toContain(a);
  });
});
