/**
 * scripts/r28/coa-fixture-extract.ts
 *
 * R28 - builds a CoaExtract from the real owner fixtures exactly as the
 * server does (buildCoaExtract over the lab JSON + the best PDF reading),
 * minus the network. Shared by the pure runner and the R28 mutation loop.
 *
 * "unpdf" = the unpdf text layer; "layout" = pdftotext -layout of the same
 * PDF (also a text layer, so it is fed with via "unpdf").
 */
import { buildCoaExtract, pickPdfText } from "../../src/lib/inventory/coa-extract-core";
import type { CoaExtract } from "../../src/lib/inventory/coa-facts-core";

export const R28_FIXTURE_AT = "2026-01-01T00:00:00.000Z";

export function r28MakeExtract(fx: Record<string, string>): (i: number, text: "unpdf" | "layout") => CoaExtract {
  const items = (JSON.parse(fx["transfer"]) as {
    inventory_transfer_items: { lab_result_link: string; lab_result_data: { coa: string } }[];
  }).inventory_transfer_items;
  return (i, text) => {
    const n = String(i).padStart(2, "0");
    const it = items[i];
    if (!it) throw new Error(`no transfer item ${i}`);
    return buildCoaExtract({
      jsonUrl: it.lab_result_link,
      transferCoaUrl: it.lab_result_data.coa,
      json: { text: fx[`item${n}.wcia`] ?? null, error: fx[`item${n}.wcia`] ? null : "no fixture" },
      pdf: pickPdfText([{ via: "unpdf", text: fx[`item${n}.${text}`] ?? null, error: null }]),
      at: R28_FIXTURE_AT,
    });
  };
}
