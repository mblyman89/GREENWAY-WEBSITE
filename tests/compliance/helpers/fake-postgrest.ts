/**
 * tests/compliance/helpers/fake-postgrest.ts   (R19 S13)
 *
 * A small in-memory PostgREST, driven through the REAL @supabase/postgrest-js
 * client via its `fetch` option. It exists so the S13 lease / claim
 * compare-and-swap logic is exercised exactly as the client encodes it
 * (eq./in./is. filters, order, offset/limit, Prefer return=representation,
 * the object Accept header) instead of against a hand-written chain mock
 * that would agree with whatever the code does.
 *
 * Each request is applied atomically (JavaScript is single-threaded and the
 * handler has no await), which is the guarantee one SQL statement gives: so
 * two interleaved runs racing on the same conditional UPDATE see exactly one
 * winner, like Postgres.
 *
 * Supported: GET (select columns, filters, order, offset, limit), POST
 * (insert object or array, defaults, return=representation), PATCH (filtered
 * update, return=representation), unique constraints with an optional
 * partial predicate (23505), "missing table" mode (PGRST205, as PostgREST
 * answers for a table that is not in its schema cache), (R24) upsert via
 * Prefer resolution=merge-duplicates + on_conflict, and (R24 S12) HEAD probes
 * and the not.is.null filter.
 */

export type Row = Record<string, unknown>;

export interface UniqueRule {
  table: string;
  columns: string[];
  /** Partial index predicate (e.g. status in ('queued','running')). */
  where?: (r: Row) => boolean;
  name: string;
}

export interface FakeRequest {
  method: string;
  table: string;
  url: URL;
  body: unknown;
}

export class FakePostgrest {
  tables = new Map<string, Row[]>();
  missing = new Set<string>();
  uniques: UniqueRule[] = [];
  defaults = new Map<string, () => Row>();
  log: FakeRequest[] = [];
  /** Runs before a request is applied; may mutate state (to simulate a racing writer) or return a canned reply. */
  before: ((req: FakeRequest) => { status: number; body: unknown } | void) | null = null;
  private seq = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  nextId(): string {
    this.seq += 1;
    const hex = this.seq.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const table = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : null;
    const req: FakeRequest = { method, table, url, body: raw ? JSON.parse(raw) : null };
    this.log.push(req);
    const headers = new Headers(init?.headers);
    const canned = this.before?.(req);
    if (canned) return json(canned.status, canned.body);
    const { status, body } = this.apply(req, headers);
    if (body === undefined) return new Response(null, { status });
    return json(status, body);
  };

  private apply(req: FakeRequest, headers: Headers): { status: number; body: unknown } {
    if (this.missing.has(req.table)) {
      return {
        status: 404,
        body: { code: "PGRST205", details: null, hint: null, message: `Could not find the table 'public.${req.table}' in the schema cache` },
      };
    }
    const prefer = headers.get("Prefer") ?? "";
    const wantRows = prefer.includes("return=representation");
    const objectAccept = (headers.get("Accept") ?? "").includes("vnd.pgrst.object+json");
    const all = this.rows(req.table);
    const filters = parseFilters(req.url);
    const select = req.url.searchParams.get("select");

    // R24 S12: HEAD (postgrest-js `{ head: true }`, the writer's column/table
    // probes) is a GET without a body. A column this fake does not know is
    // simply absent from rows - Postgres would say 42703; tests that need that
    // answer it from `before`.
    if (req.method === "HEAD") return { status: 200, body: undefined };

    if (req.method === "GET") {
      let out = all.filter((r) => filters.every((f) => f(r)));
      out = sortRows(out, req.url.searchParams.get("order"));
      const offset = Number(req.url.searchParams.get("offset") ?? 0);
      const limit = req.url.searchParams.get("limit");
      out = out.slice(offset, limit === null ? undefined : offset + Number(limit));
      return this.shape(out.map((r) => pick(r, select)), objectAccept);
    }

    if (req.method === "POST") {
      const input = (Array.isArray(req.body) ? req.body : [req.body]) as Row[];
      const created: Row[] = [];
      const staged = [...all];
      // R24: upsert (Prefer resolution=merge-duplicates + on_conflict), as
      // postgrest-js sends it: a row whose on_conflict columns equal an
      // existing row's is MERGED into it instead of inserted.
      const onConflict = req.url.searchParams.get("on_conflict");
      if (prefer.includes("resolution=merge-duplicates") && onConflict) {
        const cols = onConflict.split(",").map((c) => c.trim());
        const keyOf = (r: Row) => cols.map((c) => String(r[c])).join("\u0000");
        const merged: Row[] = [];
        for (const r of input) {
          const hit = all.find((e) => keyOf(e) === keyOf(r));
          if (hit) {
            Object.assign(hit, r);
            merged.push(hit);
          } else {
            const row: Row = { id: this.nextId(), ...(this.defaults.get(req.table)?.() ?? {}), ...r };
            all.push(row);
            merged.push(row);
          }
        }
        if (!wantRows) return { status: 201, body: undefined };
        return this.shape(merged.map((r) => pick(r, select)), objectAccept);
      }
      for (const r of input) {
        const row: Row = { id: this.nextId(), ...(this.defaults.get(req.table)?.() ?? {}), ...r };
        const clash = this.violates(req.table, row, staged);
        if (clash) return { status: 409, body: { code: "23505", details: null, hint: null, message: `duplicate key value violates unique constraint "${clash}"` } };
        staged.push(row);
        created.push(row);
      }
      all.push(...created);
      if (!wantRows) return { status: 201, body: undefined };
      return this.shape(created.map((r) => pick(r, select)), objectAccept);
    }

    if (req.method === "PATCH") {
      const patch = req.body as Row;
      const hit = all.filter((r) => filters.every((f) => f(r)));
      const next = all.map((r) => (hit.includes(r) ? { ...r, ...patch } : r));
      for (const r of hit) {
        const updated = { ...r, ...patch };
        const others = next.filter((x) => x.id !== r.id);
        const clash = this.violates(req.table, updated, others);
        if (clash) return { status: 409, body: { code: "23505", details: null, hint: null, message: `duplicate key value violates unique constraint "${clash}"` } };
      }
      for (const r of hit) Object.assign(r, patch);
      if (!wantRows) return { status: 204, body: undefined };
      return this.shape(hit.map((r) => pick(r, select)), objectAccept);
    }

    // R34: DELETE with filters (a bare DELETE with no filter is refused, as
    // a safety net - real code never deletes a whole table through PostgREST).
    if (req.method === "DELETE") {
      if (filters.length === 0) return { status: 400, body: { code: "21000", message: "DELETE requires a WHERE clause" } };
      const hit = all.filter((r) => filters.every((f) => f(r)));
      const keep = all.filter((r) => !hit.includes(r));
      all.length = 0;
      all.push(...keep);
      if (!wantRows) return { status: 204, body: undefined };
      return this.shape(hit.map((r) => pick(r, select)), objectAccept);
    }

    return { status: 405, body: { code: "PGRST000", message: `method ${req.method} not emulated` } };
  }

  private violates(table: string, row: Row, existing: Row[]): string | null {
    for (const u of this.uniques) {
      if (u.table !== table) continue;
      if (u.where && !u.where(row)) continue;
      const key = u.columns.map((c) => String(row[c])).join("|");
      const dup = existing.some((e) => e !== row && e.id !== row.id && (!u.where || u.where(e)) && u.columns.map((c) => String(e[c])).join("|") === key);
      if (dup) return u.name;
    }
    return null;
  }

  private shape(rows: Row[], objectAccept: boolean): { status: number; body: unknown } {
    if (!objectAccept) return { status: 200, body: rows };
    if (rows.length !== 1) {
      return { status: 406, body: { code: "PGRST116", details: `The result contains ${rows.length} rows`, hint: null, message: "JSON object requested, multiple (or no) rows returned" } };
    }
    return { status: 200, body: rows[0] };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const RESERVED = new Set(["select", "order", "offset", "limit", "on_conflict", "columns"]);

function parseList(v: string): string[] {
  const inner = v.replace(/^\(/, "").replace(/\)$/, "");
  const out: string[] = [];
  for (const m of inner.matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function parseFilters(url: URL): Array<(r: Row) => boolean> {
  const out: Array<(r: Row) => boolean> = [];
  for (const [col, raw] of url.searchParams.entries()) {
    if (RESERVED.has(col)) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    if (op === "eq") out.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) === val);
    else if (op === "neq") out.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) !== val);
    else if (op === "in") {
      const set = new Set(parseList(val));
      out.push((r) => r[col] !== null && r[col] !== undefined && set.has(String(r[col])));
    } else if (op === "is") {
      if (val === "null") out.push((r) => r[col] === null || r[col] === undefined);
      else if (val === "true") out.push((r) => r[col] === true);
      else if (val === "false") out.push((r) => r[col] === false);
      else throw new Error(`is.${val} not emulated`);
    } else if (op === "not" && val === "is.null") {
      // R24 S12: .not(col, "is", null)
      out.push((r) => r[col] !== null && r[col] !== undefined);
    } else if (op === "lt" || op === "lte" || op === "gt" || op === "gte") {
      out.push((r) => {
        const a = r[col];
        if (a === null || a === undefined) return false;
        const x = typeof a === "number" ? a : String(a);
        const y = typeof a === "number" ? Number(val) : val;
        return op === "lt" ? x < y : op === "lte" ? x <= y : op === "gt" ? x > y : x >= y;
      });
    } else throw new Error(`filter ${op} not emulated (column ${col})`);
  }
  return out;
}

function sortRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((k) => {
    const [col, dir] = k.split(".");
    return { col, desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const x = a[k.col];
      const y = b[k.col];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const c = x < y ? -1 : 1;
      return k.desc ? -c : c;
    }
    return 0;
  });
}

function pick(r: Row, select: string | null): Row {
  if (!select || select === "*") return { ...r };
  const out: Row = {};
  for (const c of select.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = r[c] ?? null;
  return out;
}
