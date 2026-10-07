/**
 * ccrs-area-core.ts — S-13: the Area file, planned over the CCRS ledger (PURE).
 *
 * WHY (Bible v2 gap E23, cleanup wave W1, Part 04 §B):
 *   - CCRS already holds 9 Area records for license 413541 under 5 names
 *     (analysis2/sheets/Area.csv, LCB delivery 2026-09-18): `A65303`
 *     ("A65303 - Default Inventory Room"), set C `C1100011`–`C1100014`
 *     (Sales Floor / Incoming Orders / POS Returns / Vendor Returns) and set
 *     C1- `C1-11021100011`–`14` (the same four names, same minute).
 *   - Inventory.Area names an Area by NAME, and "It captures the most recent
 *     file that was ingested for that name and license." [BRIAN A12]. So the
 *     old builder's `Insert Sales Floor AREA-SALES-FLOOR` would silently make a
 *     brand-new record the join target for every lot (E23).
 *   - "Using a delete operation for those not in use is advised … I would
 *     recommend using the most recent dated Sales Floor" [BRIAN A11]. D-03
 *     (Bible v2 Part 08): keep set C, retire C1- + A65303. The owner accepted
 *     "all of your recommendations" in one message; the D-03 line he was shown
 *     read "most-recently-dated Sales Floor set". Both sets carry the same
 *     CreatedDate, so set C is our resolution: CONFIRM WITH THE OWNER before
 *     mode "delete" is ever switched on (Update-only touches nothing retired).
 *   - "IsQuarantine True only applies to imported CBD. There are no
 *     quarantine requirements for cannabis products and must have an entry
 *     as False." [G L0298-L0299]. Every row we write is FALSE, and a held
 *     (quarantine/recalled) lot is NOT moved to a quarantine Area.
 *   - Operation: Insert creates "a new record with a unique external
 *     identifier", Update alters "an existing record indicated by external
 *     identifier", Delete deletes one [G L0246-L0248].
 *
 * WHAT THE PLAN DOES (production, D-03):
 *   - every RETIRED id CCRS still holds → `Delete` (mode "delete" only);
 *   - while ANY retired id is still on file, every KEPT id → `Update` with its
 *     filed name, so the kept record is the most recently ingested one for
 *     its name [BRIAN A12] (Part 04 §B.3 row 2);
 *   - a name Inventory needs (`Sales Floor`) that no surviving record holds →
 *     `Insert` under a minted `GWA-<slug>` id (D-01a);
 *   - nothing else. When every name is held and no retirement is pending the
 *     file is EMPTY, and an empty file is not uploaded (S-12b planner).
 *
 * WHY THE DEFAULT IS UPDATE-ONLY (U-31, never assume):
 *   whether CCRS refuses to Delete an Area that live Inventory rows are bound
 *   to is UNPROVEN (U-31). PREprod probe P-02 answers it. Update-only is safe
 *   in BOTH outcomes (Part 04 §B.3: "If Delete is refused … W1 becomes
 *   Update-only"). `PROD_AREA_PLAN.mode` flips to "delete" only in the commit
 *   that files the P-02 evidence. A test pins the current value.
 *
 * A NOTE ON "ALREADY REFRESHED": an Area Update leaves the ledger entity in its
 * state (0249 ccrs_promote_rows keeps e.state for Area), so the ledger cannot
 * say "this Update already went". The refresh rule is therefore tied to
 * retirement: Updates go out while a retired id is still on file. In "delete"
 * mode that ends once the Deletes land; in "update-only" mode the 4 identical
 * Updates repeat each batch, which is harmless (an Update of an existing
 * record [G L0247]) and keeps the kept set the most recent [BRIAN A12].
 */
import { routeOperation, type LedgerEnv, type LedgerState, type LedgerView } from "./ccrs-ledger-core";

/** The one Area name our Inventory rows use (byte-identical to what we filed before). */
export const SALES_FLOOR_AREA = "Sales Floor";

export type AreaPlanMode = "update-only" | "delete";

export type AreaPlanConfig = {
  /** Area ids that survive; refreshed by Update while a retirement is pending. */
  keep: readonly string[];
  /** Area ids to retire; Deleted in mode "delete", left untouched in "update-only". */
  retire: readonly string[];
  mode: AreaPlanMode;
};

/**
 * D-03 (Part 08 of Bible v2; see the note above on what the owner saw). The inference that the
 * C1- ids are a migration composite is flagged as inference there; any
 * surviving `Sales Floor` works once it is the most recently ingested one.
 * mode: "update-only" until P-02 proves an Area Delete (U-31).
 */
export const PROD_AREA_PLAN: AreaPlanConfig = Object.freeze({
  keep: Object.freeze(["C1100011", "C1100012", "C1100013", "C1100014"]),
  retire: Object.freeze(["A65303", "C1-11021100011", "C1-11021100012", "C1-11021100013", "C1-11021100014"]),
  mode: "update-only",
}) as AreaPlanConfig;

/** PREprod holds only what we filed there; nothing is retired. */
export const PREPROD_AREA_PLAN: AreaPlanConfig = Object.freeze({ keep: Object.freeze([]), retire: Object.freeze([]), mode: "update-only" }) as AreaPlanConfig;

export function areaPlanFor(env: LedgerEnv): AreaPlanConfig {
  return env === "prod" ? PROD_AREA_PLAN : PREPROD_AREA_PLAN;
}

/** D-01a: `GWA-<slug>`; upper-case, every run of non [A-Z0-9] becomes one `-`. */
export function mintAreaId(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`mintAreaId: name ${JSON.stringify(name)} has no letters or digits`);
  return `GWA-${slug}`;
}

export type AreaPlanProblem = {
  severity: "error" | "warning";
  id: string;
  detail: string;
};

export type AreaPlan = {
  /** Area.csv data rows in CCRS_COLUMNS.Area order. */
  rows: string[][];
  /** the Area name every Inventory row carries. */
  inventoryAreaName: string;
  problems: AreaPlanProblem[];
  summary: { inserts: number; updates: number; deletes: number; retirementPending: boolean };
};

const PRESENT: ReadonlySet<LedgerState> = new Set(["seed", "filed", "confirmed"]);

export type AreaPlanInput = {
  view: LedgerView | null;
  config: AreaPlanConfig;
  license: string;
  by: string;
  /** MM/DD/YYYY (ccrsDate) */
  date: string;
  /** names Inventory rows will carry; today only `Sales Floor`. */
  needed?: readonly string[];
};

export function planAreaFile(input: AreaPlanInput): AreaPlan {
  const { view, config, license, by, date } = input;
  const needed = input.needed ?? [SALES_FLOOR_AREA];
  const rows: string[][] = [];
  const problems: AreaPlanProblem[] = [];
  const summary = { inserts: 0, updates: 0, deletes: 0, retirementPending: false };
  const row = (name: string, id: string, op: "Insert" | "Update" | "Delete") =>
    op === "Insert" ? [license, name, "FALSE", id, by, date, "", "", op] : [license, name, "FALSE", id, by, date, by, date, op];

  // Legacy (no ledger: 0248 not applied / seed not finalized / PREprod ledger
  // not started). The batch is not recorded (amber banner). In production the
  // LCB delivery (2026-09-18) proves CCRS already holds every kept name, so an
  // Insert would create the E23 duplicate join target: emit nothing. With no
  // kept set (PREprod) keep the file self-consistent: one Insert per needed
  // name under its D-01a id.
  if (!view) {
    if (config.keep.length > 0) return { rows, inventoryAreaName: SALES_FLOOR_AREA, problems, summary };
    for (const name of needed) {
      rows.push(row(name, mintAreaId(name), "Insert"));
      summary.inserts += 1;
    }
    return { rows, inventoryAreaName: SALES_FLOOR_AREA, problems, summary };
  }

  const overlap = config.keep.filter((id) => config.retire.includes(id));
  if (overlap.length) throw new Error(`planAreaFile: ids both kept and retired: ${overlap.join(", ")}`);

  const areaEntries = [...view.entries.values()].filter((e) => e.fileType === "Area");
  const entry = (id: string) => areaEntries.find((e) => e.externalId === id);
  const retireSet = new Set(config.retire);

  // 1) Retired ids.
  for (const id of config.retire) {
    const e = entry(id);
    if (e?.state === "deleted") continue; // done
    if (!e || !PRESENT.has(e.state)) {
      problems.push({ severity: "error", id, detail: e ? `retired Area ${id} is in state "${e.state}"; reconcile it first` : `retired Area ${id} is not in the CCRS ledger` });
      continue;
    }
    summary.retirementPending = true;
    if (config.mode === "delete") {
      const r = routeOperation(view, "Area", id, "delete");
      if (r.op !== "Delete") throw new Error(`planAreaFile: ${id} routed ${r.op} (${r.reason})`);
      rows.push(row(e.filedName ?? "", id, "Delete"));
      summary.deletes += 1;
    }
  }

  // 2) Kept ids: refreshed while a retirement is pending.
  for (const id of config.keep) {
    const e = entry(id);
    if (!e || !PRESENT.has(e.state)) {
      problems.push({ severity: "error", id, detail: e ? `kept Area ${id} is in state "${e.state}"; reconcile it first` : `kept Area ${id} is not in the CCRS ledger` });
      continue;
    }
    if (!e.filedName) {
      problems.push({ severity: "error", id, detail: `kept Area ${id} has no filed name` });
      continue;
    }
    if (!summary.retirementPending) continue;
    const r = routeOperation(view, "Area", id, "upsert");
    if (r.op !== "Update") throw new Error(`planAreaFile: ${id} routed ${r.op} (${r.reason})`);
    rows.push(row(e.filedName, id, "Update"));
    summary.updates += 1;
  }

  // 3) Every name Inventory needs must be held by a SURVIVING record.
  //    In "delete" mode a retired record does not survive this file.
  const survives = (id: string) => !(config.mode === "delete" && retireSet.has(id));
  const updatedHere = new Set(rows.filter((r) => r[8] === "Update").map((r) => r[1]));
  for (const name of needed) {
    const holders = areaEntries.filter((e) => e.filedName === name && PRESENT.has(e.state) && survives(e.externalId));
    if (holders.length === 0) {
      // A record for this name whose CCRS status is unproven blocks a new one:
      // it may already be the join target (Part 03 §D.3: never guess).
      const unproven = areaEntries.find((e) => e.filedName === name && (e.state === "uncertain" || e.state === "unknown"));
      if (unproven) {
        problems.push({ severity: "error", id: unproven.externalId, detail: `Area "${name}" is needed; record ${unproven.externalId} holding that name is "${unproven.state}". Reconcile it before a new record is created` });
        continue;
      }
      // D-01a id; an id that ever existed (e.g. Deleted) is never re-used, so
      // the next free numbered id is taken.
      const base = mintAreaId(name);
      let id = base;
      for (let n = 2; entry(id) && n <= 99; n += 1) id = `${base}-${n}`;
      if (entry(id)) {
        problems.push({ severity: "error", id: base, detail: `Area "${name}" is needed but ids ${base} … ${id} are all taken` });
        continue;
      }
      rows.push(row(name, id, "Insert"));
      summary.inserts += 1;
    } else if (holders.length > 1 && !updatedHere.has(name)) {
      problems.push({
        severity: "warning",
        id: name,
        detail: `${holders.length} Area records hold the name "${name}" (${holders.map((h) => h.externalId).join(", ")}); CCRS uses the most recently ingested one [BRIAN A12]`,
      });
    }
  }

  return { rows, inventoryAreaName: SALES_FLOOR_AREA, problems, summary };
}

/** Lot statuses the store holds back from sale (0023 enum). Not an Area [G L0298]. */
export function isHeldLotStatus(status: string | null | undefined): boolean {
  return status === "quarantine" || status === "recalled";
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in run-pure-selftests.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsAreaCoreTests(): void {
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`ccrs-area-core: ${m}`);
  };
  ok(mintAreaId("Sales Floor") === "GWA-SALES-FLOOR", "slug");
  ok(mintAreaId("  a--b c ") === "GWA-A-B-C", "slug collapse");
  ok(PROD_AREA_PLAN.mode === "update-only", "prod default is update-only until P-02");
  ok(areaPlanFor("preprod").keep.length === 0 && areaPlanFor("prod") === PROD_AREA_PLAN, "per env");
  ok(isHeldLotStatus("quarantine") && isHeldLotStatus("recalled") && !isHeldLotStatus("active"), "held");
  const legacy = planAreaFile({ view: null, config: PREPROD_AREA_PLAN, license: "413541", by: "G", date: "10/08/2026" });
  ok(legacy.rows.length === 1 && legacy.rows[0].join(",") === "413541,Sales Floor,FALSE,GWA-SALES-FLOOR,G,10/08/2026,,,Insert", "legacy preprod one insert");
  ok(planAreaFile({ view: null, config: PROD_AREA_PLAN, license: "413541", by: "G", date: "10/08/2026" }).rows.length === 0, "legacy prod emits nothing");
}
