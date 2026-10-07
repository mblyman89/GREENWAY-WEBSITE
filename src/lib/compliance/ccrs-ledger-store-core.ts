/**
 * src/lib/compliance/ccrs-ledger-store-core.ts — CCRS Bible v2 slice S-12b (PURE).
 *
 * Decodes the answer of public.ccrs_ledger_slice (migration 0248) into the
 * LedgerView the S-11 planner routes against. Kept pure (no I/O) so every
 * branch is unit-tested; ccrs-ledger-store.ts only does the RPC call.
 *
 * The decision "is there a ledger?" is made HERE and is fail-closed in the
 * direction that cannot corrupt the State's record:
 *   - function missing (migration 0248 not applied: PGRST202 / 42883)  → null
 *   - `loaded` false (seed not finalized in this env)                  → null
 * null means the legacy routing (every row Insert, our ids) — exactly what the
 * app did before S-12b, so nothing changes until the owner finishes the seed.
 * Any OTHER error, or a malformed answer, THROWS: routing against a partial or
 * garbled ledger could turn an Update into an Insert (Part 03 §D.3).
 */
import { isMissingDbFunctionError, type RpcErrorLike } from "@/lib/db/rpc-fallback-core";
import { LEDGER_STATES, buildLedgerView, type LedgerEntry, type LedgerEnv, type LedgerFileType, type LedgerView } from "./ccrs-ledger-core";

export const LEDGER_SLICE_RPC = "ccrs_ledger_slice";

const FILE_TYPES: readonly LedgerFileType[] = ["Strain", "Area", "Product", "Inventory", "Sale", "InventoryAdjustment", "InventoryTransfer"];

export type LoadedLedger = {
  view: LedgerView;
  /** greatest stamp already stored for this env (null = none yet). */
  lastStamp: Date | null;
  /** duplicate (type,id) rows reported by buildLedgerView — a data fault. */
  duplicates: string[];
};

export type LedgerSliceOutcome =
  | { kind: "absent"; reason: "migration-not-applied" | "seed-not-finalized" }
  | { kind: "loaded"; ledger: LoadedLedger };

export class CcrsLedgerSliceError extends Error {}

function bad(m: string): never {
  throw new CcrsLedgerSliceError(`ccrs_ledger_slice: ${m}`);
}

const isStr = (x: unknown): x is string => typeof x === "string";

/** Decode the RPC result. `env` is what we asked for; the answer must echo it. */
export function decodeLedgerSlice(env: LedgerEnv, data: unknown, error: RpcErrorLike | null | undefined): LedgerSliceOutcome {
  if (error) {
    if (isMissingDbFunctionError(error)) return { kind: "absent", reason: "migration-not-applied" };
    bad(`${error.code ?? "?"} ${error.message ?? ""}`.trim());
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) bad("answer is not an object");
  const d = data as Record<string, unknown>;
  if (d.env !== env) bad(`answer is for env ${String(d.env)}, asked for ${env}`);
  if (typeof d.loaded !== "boolean") bad("`loaded` is not a boolean");
  if (!d.loaded) return { kind: "absent", reason: "seed-not-finalized" };

  let lastStamp: Date | null = null;
  if (d.last_stamp !== null && d.last_stamp !== undefined) {
    if (!isStr(d.last_stamp) || Number.isNaN(Date.parse(d.last_stamp))) bad("`last_stamp` is not a timestamp");
    lastStamp = new Date(d.last_stamp);
  }

  if (!Array.isArray(d.entries)) bad("`entries` is not an array");
  const rows: LedgerEntry[] = (d.entries as unknown[]).map((x, i) => {
    if (!Array.isArray(x) || x.length !== 5) bad(`entry ${i} is not [type,id,name,state,product]`);
    const [t, id, name, state, prod] = x as unknown[];
    if (!isStr(t) || !(FILE_TYPES as readonly string[]).includes(t)) bad(`entry ${i}: file type ${String(t)}`);
    if (!isStr(id) || id === "") bad(`entry ${i}: external id`);
    if (name !== null && !isStr(name)) bad(`entry ${i}: filed name`);
    if (!isStr(state) || !(LEDGER_STATES as readonly string[]).includes(state)) bad(`entry ${i}: state ${String(state)}`);
    if (prod !== null && !isStr(prod)) bad(`entry ${i}: product id`);
    return {
      fileType: t as LedgerFileType,
      externalId: id,
      filedName: name as string | null,
      state: state as LedgerEntry["state"],
      productExternalId: prod as string | null,
    };
  });

  if (!Array.isArray(d.product_ids)) bad("`product_ids` is not an array");
  const productIdByKey = new Map<string, string>();
  (d.product_ids as unknown[]).forEach((x, i) => {
    if (!Array.isArray(x) || x.length !== 2 || !isStr(x[0]) || !isStr(x[1])) bad(`product_ids ${i} is not [key,id]`);
    if (productIdByKey.has(x[0])) bad(`product key ${x[0]} assigned twice`);
    productIdByKey.set(x[0], x[1]);
  });

  const { view, duplicates } = buildLedgerView(env, rows, productIdByKey);
  return { kind: "loaded", ledger: { view, lastStamp, duplicates } };
}

/** The env the batch export targets. Anything but an exact "preprod" is prod. */
export function parseLedgerEnv(raw: string | null | undefined): LedgerEnv {
  return raw === "preprod" ? "preprod" : "prod";
}

export type AssignedProductId = { productKey: string; externalId: string; newlyAssigned: boolean };

/**
 * Validate the answer of public.ccrs_assign_product_ids. Every key asked for
 * (trimmed, de-duplicated, blanks dropped, exactly as the SQL does) must come
 * back exactly once, with an id of the env's shape (D-01a: `GWP-<6 digits>`;
 * PREprod adds the run prefix). Anything else throws: an id is the State's key
 * forever, so a garbled answer is never written into a file.
 */
export function checkAssignResult(env: LedgerEnv, keys: readonly string[], data: unknown, preprodRun?: string): AssignedProductId[] {
  const want = [...new Set(keys.map((k) => k.trim()).filter((k) => k !== ""))].sort();
  const idRe = env === "prod" ? /^GWP-[0-9]{6}$/ : new RegExp(`^${preprodRun ?? "(?!)"}-GWP-[0-9]{6}$`);
  if (env === "preprod" && !(preprodRun && /^P\d{8}[A-Z]$/.test(preprodRun))) throw new CcrsLedgerSliceError("ccrs_assign_product_ids: PREprod needs a run id");
  if (!Array.isArray(data)) throw new CcrsLedgerSliceError("ccrs_assign_product_ids: answer is not an array");
  const out: AssignedProductId[] = [];
  const seenKey = new Set<string>();
  const seenId = new Set<string>();
  for (const [i, r] of (data as unknown[]).entries()) {
    const x = r as Record<string, unknown> | null;
    if (!x || typeof x !== "object" || !isStr(x.product_key) || !isStr(x.external_id) || typeof x.newly_assigned !== "boolean") {
      throw new CcrsLedgerSliceError(`ccrs_assign_product_ids: row ${i} is not {product_key, external_id, newly_assigned}`);
    }
    if (!idRe.test(x.external_id)) throw new CcrsLedgerSliceError(`ccrs_assign_product_ids: row ${i} id ${x.external_id} is not a ${env} GWP- id`);
    if (seenKey.has(x.product_key)) throw new CcrsLedgerSliceError(`ccrs_assign_product_ids: key ${x.product_key} answered twice`);
    if (seenId.has(x.external_id)) throw new CcrsLedgerSliceError(`ccrs_assign_product_ids: id ${x.external_id} given to two keys`);
    seenKey.add(x.product_key);
    seenId.add(x.external_id);
    out.push({ productKey: x.product_key, externalId: x.external_id, newlyAssigned: x.newly_assigned });
  }
  const got = [...seenKey].sort();
  if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
    throw new CcrsLedgerSliceError(`ccrs_assign_product_ids: asked for ${want.length} key(s), answered ${got.length} (keys differ)`);
  }
  return out;
}

export function __runCcrsLedgerStoreCoreTests(): void {
  const assert = (c: unknown, m: string) => { if (!c) throw new Error("ccrs-ledger-store-core: " + m); };
  const throws = (f: () => unknown, m: string) => { try { f(); } catch (e) { if (e instanceof CcrsLedgerSliceError) return; throw e; } throw new Error("ccrs-ledger-store-core: expected throw: " + m); };
  assert(decodeLedgerSlice("prod", null, { code: "PGRST202", message: "x" }).kind === "absent", "PGRST202 → absent");
  throws(() => decodeLedgerSlice("prod", null, { code: "57014", message: "timeout" }), "other error throws");
  assert(decodeLedgerSlice("prod", { env: "prod", loaded: false, entries: [], product_ids: [] }, null).kind === "absent", "not loaded → absent");
  throws(() => decodeLedgerSlice("prod", { env: "preprod", loaded: true, entries: [], product_ids: [] }, null), "env echo");
  const ok = decodeLedgerSlice("prod", {
    env: "prod", loaded: true, last_stamp: "2026-10-07T19:00:05+00:00",
    entries: [["Inventory", "L1", null, "seed", "P1"], ["Product", "P1", "Blue", "seed", null]],
    product_ids: [["k1", "GWP-000001"]],
  }, null);
  assert(ok.kind === "loaded" && ok.ledger.view.entries.size === 2 && ok.ledger.lastStamp?.toISOString() === "2026-10-07T19:00:05.000Z" && ok.ledger.view.productIdByKey.get("k1") === "GWP-000001", "decoded");
  throws(() => decodeLedgerSlice("prod", { env: "prod", loaded: true, entries: [["Inventory", "L1", null, "live", null]], product_ids: [] }, null), "bad state");
  assert(parseLedgerEnv("preprod") === "preprod" && parseLedgerEnv("PREPROD") === "prod" && parseLedgerEnv(null) === "prod", "env parse");
  const a = checkAssignResult("prod", [" k1 ", "k1", "", "k2"], [
    { product_key: "k1", external_id: "GWP-000001", newly_assigned: true },
    { product_key: "k2", external_id: "GWP-000002", newly_assigned: false },
  ]);
  assert(a.length === 2 && a[0].externalId === "GWP-000001", "assign ok");
  throws(() => checkAssignResult("prod", ["k1"], [{ product_key: "k1", external_id: "P20261007A-GWP-000001", newly_assigned: true }]), "prod id with run prefix");
  throws(() => checkAssignResult("prod", ["k1", "k2"], [{ product_key: "k1", external_id: "GWP-000001", newly_assigned: true }]), "missing key");
  assert(checkAssignResult("preprod", ["k1"], [{ product_key: "k1", external_id: "P20261007A-GWP-000003", newly_assigned: true }], "P20261007A").length === 1, "preprod ok");
  console.log("ccrs-ledger-store-core: all tests passed");
}
