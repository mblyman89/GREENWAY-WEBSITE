/**
 * P-F (2026-10-31): never send an Inventory row with a blank Strain.
 * PURE: no I/O, no clock.
 *
 * The rule: Inventory "Strain (the name of the associated strain) ... Required
 * on which operations: Insert, Update and Delete ... Valid Values:
 * Strain.Strain ... Error Messages: Strain is required" [G L0547-L0554].
 *
 * The evidence: Inventory_413541_20261031142647.csv (PREprod) sent 6 lot
 * Updates whose products (infused pre-rolls) carry no strain on the menu, so
 * the Strain cell was blank and CCRS refused all 6 with "Strain is required".
 *
 * Where the strain comes from, in order:
 *   1. the product's strain on the published menu (what we always used);
 *   2. the lot's own strain (inventory_lots.strain_name, from the transfer),
 *      but only when CCRS already holds that strain or the Strain file of this
 *      batch files it (Valid Values: Strain.Strain [G L0552]); otherwise CCRS
 *      would answer "Invalid Strain";
 *   3. for a lot CCRS holds, the strain CCRS last ACCEPTED for it. Examiner
 *      Brian, 2026-10-29: "You will need to use the same strain name that was
 *      already provided for the product" [EXAM2 L0034-L0035].
 * When none exists the row is held back (E64) with a plain fix: set the strain
 * on the product. Nothing is guessed.
 */
import { CCRS_COLUMNS } from "./ccrs-batch-core";
import type { LedgerView } from "./ccrs-ledger-core";

export const NO_STRAIN_REASON =
  'no strain: CCRS needs a Strain on every Inventory row ("Strain is required" [G L0551-L0554]); set the strain on the product, then rebuild';

const COLS = CCRS_COLUMNS.Inventory;
const STRAIN = COLS.indexOf("Strain");
const EXT = COLS.indexOf("ExternalIdentifier");
const NAME = COLS.indexOf("Product");

/** Step 1 + 2: the strain a lot is planned with ("" = none yet). */
export function pickLotStrain(input: {
  productStrain: string | null | undefined;
  lotStrain: string | null | undefined;
  /** strains on the published menu (the Strain file files these). */
  menuStrains: ReadonlySet<string>;
  view: LedgerView | null;
}): string {
  const p = (input.productStrain ?? "").trim();
  if (p) return p;
  const l = (input.lotStrain ?? "").trim();
  if (!l) return "";
  if (input.menuStrains.has(l)) return l;
  const filed = input.view?.strainsByFold.get(l.toLowerCase());
  if (filed && filed.length > 0) return filed.includes(l) ? l : filed[0];
  return "";
}

export type StrainFillResult = {
  rows: string[][];
  /** filled from what CCRS last accepted for the lot (Brian 4d). */
  filled: { id: string; label: string; strain: string }[];
  /** still no strain: held back (E64). */
  held: { id: string; label: string; reason: string }[];
};

/**
 * Step 3: before the delta, a row whose Strain is still blank takes the strain
 * CCRS last accepted for that lot; a row with none is held back.
 */
export function fillBlankStrains(
  rows: readonly (readonly string[])[],
  lastAcceptedStrain: (id: string) => string | null | undefined,
): StrainFillResult {
  if (STRAIN < 0 || EXT < 0) throw new Error("P-F: Inventory columns changed");
  const out: string[][] = [];
  const filled: StrainFillResult["filled"] = [];
  const held: StrainFillResult["held"] = [];
  for (const r of rows) {
    if ((r[STRAIN] ?? "").trim()) {
      out.push([...r]);
      continue;
    }
    const id = r[EXT] ?? "";
    const label = (NAME >= 0 && r[NAME]) || id;
    const told = (lastAcceptedStrain(id) ?? "").trim();
    if (told) {
      const row = [...r];
      row[STRAIN] = told;
      out.push(row);
      filled.push({ id, label, strain: told });
      continue;
    }
    held.push({ id, label, reason: NO_STRAIN_REASON });
  }
  return { rows: out, filled, held };
}

/* ------------------------------------------------------------------ *
 * Embedded pure self-tests (registered in run-pure-selftests.ts).
 * ------------------------------------------------------------------ */
export function __runCcrsStrainFillTests(): void {
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`ccrs-strain-fill-core: ${m}`);
  };
  const view = { strainsByFold: new Map([["dutch treat", ["Dutch Treat"]]]) } as unknown as LedgerView;
  const menu = new Set(["Blue Dream"]);
  ok(pickLotStrain({ productStrain: " OG ", lotStrain: "Blue Dream", menuStrains: menu, view }) === "OG", "product strain first");
  ok(pickLotStrain({ productStrain: "", lotStrain: "Blue Dream", menuStrains: menu, view }) === "Blue Dream", "lot strain on the menu");
  ok(pickLotStrain({ productStrain: null, lotStrain: "dutch treat", menuStrains: menu, view }) === "Dutch Treat", "lot strain in CCRS's casing");
  ok(pickLotStrain({ productStrain: null, lotStrain: "Nowhere", menuStrains: menu, view }) === "", "unfiled lot strain is not used");
  ok(pickLotStrain({ productStrain: null, lotStrain: "Nowhere", menuStrains: menu, view: null }) === "", "legacy: unfiled lot strain is not used");

  // The owner's 2026-10-31 row: blank Strain, Update.
  const row = (id: string, strain: string) => {
    const r = COLS.map(() => "");
    r[EXT] = id;
    r[STRAIN] = strain;
    r[NAME] = `Product ${id}`;
    return r;
  };
  const res = fillBlankStrains([row("GF41918905566983", ""), row("GF41244605628871", ""), row("L3", "OG")], (id) => (id === "GF41918905566983" ? "Oil Tanker" : null));
  ok(res.rows.length === 2 && res.rows[0][STRAIN] === "Oil Tanker" && res.rows[1][STRAIN] === "OG", "blank filled from CCRS, filled kept");
  ok(res.filled.length === 1 && res.filled[0].id === "GF41918905566983", "fill reported");
  ok(res.held.length === 1 && res.held[0].id === "GF41244605628871" && res.held[0].reason === NO_STRAIN_REASON, "no strain anywhere: held");
}
