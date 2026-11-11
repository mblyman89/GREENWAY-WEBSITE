/**
 * D232 M-4 (SOP-11 G-79, G-81) - pure rules for server-saved Merch Studio
 * designs and the sample gate. No I/O: the server actions
 * (src/app/admin/merch-studio/design-actions.ts) and the browser
 * (DesignStudio / ProofPanel / PublishPanel) both call these, so the browser
 * and the server always agree.
 *
 *   printHash(d)     what gets PRINTED (garment + every side's method and
 *                    elements). A sample is approved for one printHash. A
 *                    changed design needs a new sample (owner D232
 *                    "Q2: yes, owner only and reason" - the override).
 *   contentHash(d)   everything the person typed (adds name, colour, acks).
 *                    Says "this computer has edits the server hasn't got".
 *   parseImport()    reads design.json, or the Proof & Export ZIP (STORE, no
 *                    compression - zipStore in print-export-core) and pulls
 *                    design.json out of it.
 *   mergeDesigns()   server list + this browser's list -> one list. Never
 *                    loses work: when both changed, this browser's version is
 *                    kept as a copy.
 *   sampleGate()     may this design be published?
 *   approvalProblem() is a sample approval complete?
 */
import { normalizeDesign, type MElement, type MerchDesign } from "./merch-design-core";

export const DESIGN_ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
/** Artwork in the private merch-files bucket (0360): art/<asset id>. */
export const ART_KEY_RE = /^art\/[A-Za-z0-9_-]{1,60}$/;
/** Sample photo (0360 check constraint): sample/<design id>/<12 hex>.<ext>. */
export const SAMPLE_PHOTO_RE = /^sample\/[A-Za-z0-9_-]{1,60}\/[a-f0-9]{12}\.(png|jpg|webp)$/;
export const ART_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export const PHOTO_MIME: Record<string, "png" | "jpg" | "webp"> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX_DESIGN_BYTES = 1_000_000;
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
export const MIN_OVERRIDE_REASON = 5;
export const DESIGN_CONFLICT = "This design was changed on another computer. Load the newest copy - your version is kept as a copy.";

export type SampleStatus = "none" | "approved" | "overridden";

/** One merch_designs row as the app sees it. */
export interface DesignRow {
  id: string;
  name: string;
  blankId: string;
  design: MerchDesign;
  designHash: string;
  rev: number;
  updatedAt: string;
  updatedByEmail: string | null;
  sampleStatus: SampleStatus;
  sampleDesignHash: string | null;
  sampleChecklist: string[];
  samplePhotoKey: string | null;
  sampleByEmail: string | null;
  sampleAt: string | null;
  sampleReason: string | null;
}

// Hashing -------------------------------------------------------------------------

/** Stable JSON: object keys sorted, undefined dropped (same bytes on every machine). */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

/** 64-bit FNV-1a (two 32-bit lanes) over UTF-16 code units -> 16 hex. Change detection, not security. */
export function hash64(s: string): string {
  let a = 0x811c9dc5; let b = (0x01000193 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((c * 31 + i) & 0xffff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** What prints: the garment and each side. Element names / locks don't print. */
export function printHash(d: MerchDesign): string {
  const sides: Record<string, unknown> = {};
  for (const pid of Object.keys(d.sides).sort()) {
    const s = d.sides[pid];
    const els = s.elements.filter((e) => !e.hidden).map((e) => ({ ...e, name: undefined, locked: undefined }));
    if (!els.length) continue;
    sides[pid] = { method: s.method, puff: !!s.puff, elements: els };
  }
  return hash64(stableJson({ blankId: d.blankId, sides }));
}

/** Everything the person edits (not the save time). */
export function contentHash(d: MerchDesign): string {
  return hash64(stableJson({ name: d.name, blankId: d.blankId, colorHex: d.colorHex, sides: d.sides, ack: d.ack }));
}

// Import --------------------------------------------------------------------------

/** One file out of a STORE zip (the Proof & Export ZIP). Null when absent or compressed. */
export function unzipStoreFile(z: Uint8Array, want: string): Uint8Array | null {
  const rd32 = (k: number) => (z[k] | (z[k + 1] << 8) | (z[k + 2] << 16) | (z[k + 3] << 24)) >>> 0;
  const rd16 = (k: number) => z[k] | (z[k + 1] << 8);
  const dec = new TextDecoder();
  let i = 0;
  while (i + 30 <= z.length && rd32(i) === 0x04034b50) {
    const method = rd16(i + 8); const csize = rd32(i + 18); const nlen = rd16(i + 26); const xlen = rd16(i + 28);
    const name = dec.decode(z.subarray(i + 30, i + 30 + nlen));
    const start = i + 30 + nlen + xlen;
    if (name === want || name.endsWith(`/${want}`)) return method === 0 ? z.slice(start, start + csize) : null;
    i = start + csize;
  }
  return null;
}

export type ImportResult = { ok: true; design: MerchDesign; renamed: boolean } | { ok: false; error: string };

/**
 * A .json or .zip the person picked. The design keeps its id unless that id
 * is already in this list with DIFFERENT content - then it comes in as a copy
 * (new id, "(imported)"), so an import never overwrites work.
 */
export function parseImport(fileName: string, bytes: Uint8Array, existing: readonly MerchDesign[], makeId: () => string, nowIso: string): ImportResult {
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: "That file is too big to be a Merch Studio design." };
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  let text: string;
  if (isZip) {
    const f = unzipStoreFile(bytes, "design.json");
    if (!f) return { ok: false, error: "That ZIP has no design.json inside. Pick the ZIP from Proof & Export (Download print files), or its design.json." };
    text = new TextDecoder().decode(f);
  } else if (/\.zip$/i.test(fileName)) {
    return { ok: false, error: "That file isn't a ZIP Merch Studio can read." };
  } else {
    text = new TextDecoder().decode(bytes);
  }
  if (text.length > MAX_DESIGN_BYTES) return { ok: false, error: "That design.json is over 1 MB - it isn't one Merch Studio wrote." };
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { return { ok: false, error: "That file isn't valid JSON." }; }
  const d = normalizeDesign(raw);
  if (!d) return { ok: false, error: "That isn't a Merch Studio design (no known garment)." };
  const id = DESIGN_ID_RE.test(d.id) ? d.id : makeId();
  const same = existing.find((x) => x.id === id);
  if (same && contentHash(same) !== contentHash({ ...d, id })) {
    return { ok: true, renamed: true, design: { ...d, id: makeId(), name: `${d.name} (imported)`.slice(0, 80), updatedAt: nowIso } };
  }
  return { ok: true, renamed: false, design: { ...d, id, updatedAt: nowIso } };
}

// Merge (server + this browser) ------------------------------------------------------

/** What this browser last agreed with the server, per design id. */
export type SyncMeta = Record<string, { rev: number; hash: string }>;

export interface MergeOut {
  list: MerchDesign[];
  meta: SyncMeta;
  /** Designs this browser should push (new here, or edited here since the last sync). */
  push: string[];
  /** Server moved on AND this browser had edits: the browser copy was kept under a new id. */
  forked: { from: string; copy: string }[];
}

export function mergeDesigns(local: readonly MerchDesign[], server: readonly DesignRow[], meta: SyncMeta, makeId: () => string): MergeOut {
  const out: MerchDesign[] = []; const nextMeta: SyncMeta = {}; const push: string[] = []; const forked: MergeOut["forked"] = [];
  const byId = new Map(server.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const l of local) {
    const r = byId.get(l.id);
    const m = meta[l.id];
    const dirty = !m || m.hash !== contentHash(l);
    if (!r) {
      // Never on the server, or archived elsewhere. If we had synced it before and
      // it hasn't changed here, it was archived on another computer: drop it.
      if (m && !dirty) continue;
      out.push(l); push.push(l.id); seen.add(l.id);
      continue;
    }
    seen.add(l.id);
    if (m && m.rev === r.rev) {
      out.push(l); nextMeta[l.id] = m;
      if (dirty) push.push(l.id);
      continue;
    }
    // Server is newer (or this browser never synced it).
    out.push(r.design); nextMeta[l.id] = { rev: r.rev, hash: contentHash(r.design) };
    if (dirty && contentHash(l) !== contentHash(r.design)) {
      const copy = makeId();
      out.push({ ...l, id: copy, name: `${l.name} (this computer)`.slice(0, 80) });
      push.push(copy);
      forked.push({ from: l.id, copy });
    }
  }
  for (const r of server) {
    if (seen.has(r.id)) continue;
    out.push(r.design); nextMeta[r.id] = { rev: r.rev, hash: contentHash(r.design) };
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return { list: out, meta: nextMeta, push, forked };
}

/** Server-side: may this save land? baseRev 0 = "new on the server". */
export function saveDecision(current: { rev: number } | null, baseRev: number): "insert" | "update" | "conflict" {
  if (!current) return baseRev === 0 ? "insert" : "conflict";
  return current.rev === baseRev ? "update" : "conflict";
}

// Sample gate ---------------------------------------------------------------------

export type GateResult = { ok: true; how: "approved" | "overridden"; by: string | null; at: string | null; reason: string | null } | { ok: false; reason: string };

/**
 * G-81. `publishedHash` = printHash of the design being published (server
 * recomputes it from the design it was sent). Passes only when the saved row
 * is the same print AND its sample was approved or overridden for that print.
 */
export function sampleGate(row: DesignRow | null, publishedHash: string): GateResult {
  if (!row) return { ok: false, reason: "This design isn't saved on the server yet. Open it in Design (it saves by itself), then approve its sample on Proof & Export." };
  if (row.designHash !== publishedHash) return { ok: false, reason: "The design on this screen is different from the saved one. Wait for \"Saved on the server\" in Design, then try again." };
  if (row.sampleStatus === "none") return { ok: false, reason: "The sample isn't approved yet. Order one sample, inspect it and approve it on Proof & Export (or the owner can override with a reason)." };
  if (row.sampleDesignHash !== publishedHash) return { ok: false, reason: "The design changed after its sample was approved. A changed print needs a new sample (or an owner override with a reason)." };
  return { ok: true, how: row.sampleStatus, by: row.sampleByEmail, at: row.sampleAt, reason: row.sampleReason };
}

/** Approve: every checklist item ticked and a photo of the real sample. */
export function approvalProblem(required: readonly string[], ticked: readonly string[], photoKey: string | null): string | null {
  const t = new Set(ticked);
  const missing = required.filter((id) => !t.has(id));
  if (!required.length) return "This design has nothing to print yet.";
  if (missing.length) return `Tick every checklist item first (${missing.length} left).`;
  if (!photoKey) return "Add a photo of the real sample.";
  if (!SAMPLE_PHOTO_RE.test(photoKey)) return "That photo reference isn't valid. Upload the photo again.";
  return null;
}

/** Override: owner only (checked by the action) with a typed reason. */
export function overrideProblem(reason: string): string | null {
  return reason.trim().length < MIN_OVERRIDE_REASON ? `Type the reason (at least ${MIN_OVERRIDE_REASON} characters).` : null;
}

/** For the Journey bar: id -> "sample OK for the print as saved". */
export function approvalsMap(rows: readonly DesignRow[]): Record<string, boolean> {
  return Object.fromEntries(rows.map((r) => [r.id, r.sampleStatus !== "none" && r.sampleDesignHash === r.designHash]));
}

/** DB row (snake_case) -> DesignRow. Null when the stored design no longer parses. */
export function rowFromDb(raw: Record<string, unknown>): DesignRow | null {
  const design = normalizeDesign(raw.design);
  if (!design || typeof raw.id !== "string") return null;
  const st = raw.sample_status === "approved" || raw.sample_status === "overridden" ? raw.sample_status : "none";
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: raw.id, name: String(raw.name ?? design.name), blankId: String(raw.blank_id ?? design.blankId), design: { ...design, id: raw.id },
    designHash: String(raw.design_hash ?? ""), rev: Number(raw.rev) || 1, updatedAt: String(raw.updated_at ?? ""), updatedByEmail: s(raw.updated_by_email),
    sampleStatus: st, sampleDesignHash: s(raw.sample_design_hash),
    sampleChecklist: Array.isArray(raw.sample_checklist) ? raw.sample_checklist.filter((x): x is string => typeof x === "string") : [],
    samplePhotoKey: s(raw.sample_photo_key), sampleByEmail: s(raw.sample_by_email), sampleAt: s(raw.sample_at), sampleReason: s(raw.sample_reason),
  };
}

// Self-tests ----------------------------------------------------------------------
export function __runMerchDesignSyncTests(): { passed: number; failures: string[] } {
  let passed = 0; const failures: string[] = [];
  const ok = (c: boolean, m: string) => { if (c) passed++; else failures.push(m); };
  const el = (id: string, extra: Partial<MElement> = {}): MElement => ({ id, kind: "text", x: 1, y: 1, w: 2, h: 1, rotate: 0, opacity: 100, fill: "#ffffff", strokeIn: 0, strokeColor: "#000000", text: "GW", fontSizeIn: 1, ...extra });
  const base = normalizeDesign({ v: 1, id: "ds-a", name: "Logo", blankId: "cc-1717", colorHex: "#000000", sides: {}, ack: [], updatedAt: "2026-01-01T00:00:00.000Z" });
  ok(!!base, "fixture design parses");
  if (!base) return { passed, failures };
  const pid = Object.keys(normalizeDesign({ ...base, sides: { front: { method: "dtg", elements: [el("e1")] } } })!.sides)[0] ?? "front";
  const d1 = normalizeDesign({ ...base, sides: { [pid]: { method: "dtg", elements: [el("e1")] } } })!;
  ok(stableJson({ b: 1, a: [1, { d: 2, c: 3 }] }) === '{"a":[1,{"c":3,"d":2}],"b":1}', "stable json sorts keys");
  ok(hash64("abc") === hash64("abc") && hash64("abc") !== hash64("abd") && /^[0-9a-f]{16}$/.test(hash64("")), "hash64 deterministic, 16 hex");
  ok(printHash(d1) === printHash({ ...d1, name: "Renamed", colorHex: "#ffffff", updatedAt: "x", ack: ["a"] }), "printHash ignores name/colour/time/ack");
  ok(printHash(d1) === printHash({ ...d1, sides: { [pid]: { ...d1.sides[pid], elements: [{ ...d1.sides[pid].elements[0], name: "n", locked: true }] } } }), "printHash ignores element name/lock");
  ok(printHash(d1) !== printHash({ ...d1, sides: { [pid]: { ...d1.sides[pid], elements: [{ ...d1.sides[pid].elements[0], x: 1.5 }] } } }), "printHash sees a moved element");
  ok(printHash(d1) !== printHash({ ...d1, sides: { [pid]: { ...d1.sides[pid], method: "dtf" } } }) || d1.sides[pid].method === "dtf", "printHash sees the method");
  ok(printHash(base) === printHash({ ...base, sides: { [pid]: { method: "dtg", elements: [] } } }), "empty side = no side");
  ok(contentHash(d1) !== contentHash({ ...d1, name: "Other" }) && contentHash(d1) === contentHash({ ...d1, updatedAt: "later" }), "contentHash: name yes, time no");

  // zip + import
  const enc = new TextEncoder();
  const json = enc.encode(JSON.stringify(d1));
  const le16 = (n: number) => [n & 255, (n >>> 8) & 255]; const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const entry = (name: string, data: Uint8Array, method = 0) => { const nm = enc.encode(name); return [...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(method), 0, 0, 0, 0, ...le32(0), ...le32(data.length), ...le32(data.length), ...le16(nm.length), ...le16(0), ...nm, ...data]; };
  const zip = Uint8Array.from([...entry("front.png", Uint8Array.of(1, 2, 3)), ...entry("design.json", json)]);
  ok(new TextDecoder().decode(unzipStoreFile(zip, "design.json") ?? new Uint8Array()) === JSON.stringify(d1), "unzip finds design.json after a PNG");
  ok(unzipStoreFile(Uint8Array.from(entry("design.json", json, 8)), "design.json") === null, "compressed entry refused");
  let n = 0; const mk = () => `ds-new${++n}`;
  const a = parseImport("x.zip", zip, [], mk, "2026-02-01T00:00:00.000Z");
  ok(a.ok && a.design.id === "ds-a" && !a.renamed && a.design.updatedAt === "2026-02-01T00:00:00.000Z", "zip import keeps id");
  const b = parseImport("design.json", json, [d1], mk, "t");
  ok(b.ok && b.design.id === "ds-a" && !b.renamed, "same content, same id: no copy");
  const c = parseImport("design.json", json, [{ ...d1, name: "Changed here" }], mk, "t");
  ok(c.ok && c.renamed && c.design.id === "ds-new1" && c.design.name === "Logo (imported)", "different content: imported as a copy");
  ok(!parseImport("a.json", enc.encode("{nope"), [], mk, "t").ok, "bad json");
  ok(!parseImport("a.json", enc.encode('{"id":"x","blankId":"nope"}'), [], mk, "t").ok, "unknown garment");
  const nz = parseImport("a.zip", Uint8Array.from(entry("front.png", Uint8Array.of(1))), [], mk, "t");
  ok(!nz.ok && /design\.json/.test(nz.error), "zip without design.json");
  ok(!parseImport("a.zip", enc.encode("hello"), [], mk, "t").ok, "not a zip");
  ok(parseImport("a.json", enc.encode("\uFEFF" + JSON.stringify(d1)), [], mk, "t").ok, "BOM tolerated");

  // merge
  const row = (d: MerchDesign, rev: number, extra: Partial<DesignRow> = {}): DesignRow => ({ id: d.id, name: d.name, blankId: d.blankId, design: d, designHash: printHash(d), rev, updatedAt: d.updatedAt, updatedByEmail: null, sampleStatus: "none", sampleDesignHash: null, sampleChecklist: [], samplePhotoKey: null, sampleByEmail: null, sampleAt: null, sampleReason: null, ...extra });
  const m0 = mergeDesigns([d1], [], {}, mk);
  ok(m0.list.length === 1 && m0.push[0] === "ds-a", "local-only design is pushed");
  const m1 = mergeDesigns([], [row(d1, 3)], {}, mk);
  ok(m1.list[0].id === "ds-a" && m1.meta["ds-a"].rev === 3 && !m1.push.length, "server-only design comes down");
  const synced = { "ds-a": { rev: 3, hash: contentHash(d1) } };
  const m2 = mergeDesigns([d1], [row(d1, 3)], synced, mk);
  ok(!m2.push.length && !m2.forked.length, "in sync: nothing to do");
  const edited = { ...d1, name: "Edited here" };
  const m3 = mergeDesigns([edited], [row(d1, 3)], synced, mk);
  ok(m3.push[0] === "ds-a" && m3.list[0].name === "Edited here", "local edit on same rev is pushed");
  const srv = { ...d1, name: "Edited there" };
  const m4 = mergeDesigns([d1], [row(srv, 4)], synced, mk);
  ok(m4.list[0].name === "Edited there" && !m4.forked.length && m4.meta["ds-a"].rev === 4, "server newer, clean here: take server");
  const m5 = mergeDesigns([edited], [row(srv, 4)], synced, mk);
  ok(m5.forked.length === 1 && m5.list.some((x) => x.name === "Edited here (this computer)") && m5.list.some((x) => x.name === "Edited there"), "both changed: keep both");
  const m6 = mergeDesigns([d1], [], synced, mk);
  ok(m6.list.length === 0, "synced + unchanged + gone from server = archived elsewhere");
  ok(mergeDesigns([edited], [], synced, mk).push[0] === "ds-a", "archived elsewhere but edited here: kept + pushed");
  ok(saveDecision(null, 0) === "insert" && saveDecision(null, 2) === "conflict" && saveDecision({ rev: 2 }, 2) === "update" && saveDecision({ rev: 3 }, 2) === "conflict", "rev rules");

  // gate
  const h = printHash(d1);
  ok(!sampleGate(null, h).ok, "gate: not saved");
  ok(!sampleGate(row(d1, 1), h).ok, "gate: no sample");
  ok(!sampleGate(row(d1, 1, { sampleStatus: "approved", sampleDesignHash: h }), "other").ok, "gate: screen differs from saved");
  ok(!sampleGate(row(d1, 1, { sampleStatus: "approved", sampleDesignHash: "old" }), h).ok, "gate: changed after approval");
  const g = sampleGate(row(d1, 1, { sampleStatus: "approved", sampleDesignHash: h, sampleByEmail: "o@x" }), h);
  ok(g.ok && g.how === "approved" && g.by === "o@x", "gate: approved passes");
  const go = sampleGate(row(d1, 1, { sampleStatus: "overridden", sampleDesignHash: h, sampleReason: "Reprint of tested shirt" }), h);
  ok(go.ok && go.how === "overridden" && go.reason === "Reprint of tested shirt", "gate: override passes with reason");
  ok(approvalProblem(["a", "b"], ["a"], "sample/ds-a/0123456789ab.jpg") === "Tick every checklist item first (1 left).", "approve: ticks");
  ok(approvalProblem(["a"], ["a"], null) === "Add a photo of the real sample.", "approve: photo");
  ok(approvalProblem(["a"], ["a"], "sample/other/../x.jpg") !== null, "approve: bad key");
  ok(approvalProblem(["a"], ["a", "zzz"], "sample/ds-a/0123456789ab.jpg") === null, "approve: ok");
  ok(overrideProblem("  ok  ") !== null && overrideProblem("Reprint") === null, "override reason length");
  ok(approvalsMap([row(d1, 1, { sampleStatus: "approved", sampleDesignHash: h }), row({ ...d1, id: "ds-b" }, 1, { sampleStatus: "approved", sampleDesignHash: "old" })])["ds-b"] === false, "approvals map needs the same print");
  const fromDb = rowFromDb({ id: "ds-a", name: "Logo", blank_id: "cc-1717", design: d1, design_hash: h, rev: 2, updated_at: "u", sample_status: "weird", sample_checklist: ["a", 1] });
  ok(!!fromDb && fromDb.sampleStatus === "none" && fromDb.sampleChecklist.length === 1 && fromDb.rev === 2, "rowFromDb normalizes");
  ok(rowFromDb({ id: "x", design: { blankId: "nope" } }) === null, "rowFromDb rejects a broken design");
  ok(ART_KEY_RE.test("art/asset-abc123") && !ART_KEY_RE.test("art/../x") && SAMPLE_PHOTO_RE.test("sample/ds-a/0123456789ab.webp"), "key patterns");
  return { passed, failures };
}
