/**
 * src/lib/inbound-email/intake-ai-fallback.ts  (R74 S51)
 *
 * LAST-RESORT reader for a vendor PDF whose layout none of the layout parsers
 * recognise (a new provider, a new "CCRS_Manifest" print, a re-styled invoice).
 * Runs at most ONCE per email and ONLY when nothing else staged, so a normal
 * Cultivera / GrowFlow / OpenTHC email never spends a cent here.
 *
 * NEVER-GUESS: the model only transcribes; groundAiManifest keeps a line only
 * when its lot id is printed verbatim in the document text, and header facts
 * only when printed. Every line carries a "verify" warning. The result is a
 * DRAFT for human review like every other intake path. Budget-guarded by
 * generateStructured (refuses past the owner's monthly cap); no AI key = no-op.
 */
import "server-only";
import { generateStructured, isAiConfigured } from "@/lib/ai/provider";
import { defineSchema } from "@/lib/ai/schema";
import type { ParsedLine, ParsedManifest } from "@/lib/inventory/intake-parser";
import { groundAiManifest, parseAiManifestTsv } from "@/lib/inbound-email/intake-harden-core";

const MAX_CHARS = 14_000;

type AiOut = { manifest_number: string; vendor_name: string; vendor_license: string; transfer_date: string; rows_tsv: string };

const schema = defineSchema<AiOut>("intake_manifest_rows", {
  manifest_number: { kind: "string", description: "The manifest / transfer id exactly as printed, or empty.", maxLength: 80 },
  vendor_name: { kind: "string", description: "The SENDING licensee's name exactly as printed (not Greenway), or empty.", maxLength: 120 },
  vendor_license: { kind: "string", description: "The sending licensee's 6-digit WA license number as printed, or empty.", maxLength: 12 },
  transfer_date: { kind: "string", description: "Transfer / ship date as YYYY-MM-DD, or empty.", maxLength: 10 },
  rows_tsv: {
    kind: "string",
    description:
      "One line per shipped item: lot_or_inventory_id<TAB>product name<TAB>quantity<TAB>unit price. " +
      "Copy ids exactly as printed (e.g. GF41918905566988 or a 16-digit number). Leave price empty if not printed. " +
      "Never invent a row. Empty string if the document lists no items.",
    maxLength: 20_000,
  },
});

function line(row: { lot: string; product: string; qty: number | null; unitPrice: number | null }, source: string): ParsedLine {
  return {
    product_name: row.product || null,
    lot_code: row.lot,
    pos_product_key: row.lot,
    brand_name: null,
    category: null,
    strain_name: null,
    strain_type: null,
    received_qty: row.qty ?? 0,
    unit: "each",
    unit_cost_minor_units: row.unitPrice != null ? Math.round(row.unitPrice * 100) : null,
    unit_weight: null,
    unit_weight_uom: null,
    is_sample: false,
    is_medical: false,
    inventory_type: null,
    expires_on: null,
    low_thc_liquid: null,
    unit_thc_mg: null,
    otherwise_taken: null,
    units_per_package: null,
    lab: null,
    warnings: [`Read by the AI fallback from "${source}" (unrecognised layout) - verify every field during review.`],
    raw: { ai_fallback: true, ...row },
  };
}

/**
 * Read an unrecognised vendor document set into a grounded draft manifest.
 * Returns null (never throws) when AI is off / over budget / finds nothing
 * printed.
 */
export async function aiReadManifest(
  docs: { label: string; text: string }[],
): Promise<{ manifest: ParsedManifest; note: string } | null> {
  const usable = docs.filter((d) => d.text && d.text.trim().length > 40);
  if (usable.length === 0 || !isAiConfigured) return null;
  const joined = usable.map((d) => `=== ${d.label} ===\n${d.text}`).join("\n\n").slice(0, MAX_CHARS);
  try {
    const out = await generateStructured<AiOut>({
      system:
        "You transcribe Washington cannabis transfer manifests and invoices into rows. Copy ids, names, " +
        "quantities and prices exactly as printed. Never invent or infer anything. The receiving store is " +
        "Greenway Marijuana (license 413541); the vendor is the OTHER licensee.",
      user: `Vendor documents from one delivery email:\n\n${joined}`,
      schema,
      tier: "light",
      temperature: 0,
      maxTokens: 4000,
      context: { feature: "intake-ai-fallback" },
    });
    const grounded = groundAiManifest(
      {
        manifestNumber: out.manifest_number ?? "",
        vendorName: out.vendor_name ?? "",
        vendorLicense: out.vendor_license ?? "",
        transferDate: out.transfer_date ?? "",
        rows: parseAiManifestTsv(out.rows_tsv ?? ""),
      },
      usable.map((d) => d.text),
    );
    if (!grounded) return null;
    const source = usable[0].label;
    return {
      manifest: {
        manifest_number: grounded.manifestNumber,
        vendor_label: grounded.vendorName,
        vendor_license: grounded.vendorLicense,
        transfer_date: grounded.transferDate,
        source_format: "pdf-manifest",
        lines: grounded.rows.map((r) => line(r, source)),
        warnings: [
          `AI fallback read ${grounded.rows.length} line(s) from an unrecognised layout; every lot id was found printed in the document${
            grounded.dropped > 0 ? ` (${grounded.dropped} unprinted/duplicate row(s) dropped)` : ""
          }. Verify before accepting.`,
        ],
      },
      note: `AI fallback staged ${grounded.rows.length} grounded line(s)${grounded.dropped ? `, dropped ${grounded.dropped}` : ""}`,
    };
  } catch (err) {
    console.warn("[inbound-email] AI fallback skipped:", err instanceof Error ? err.message : err);
    return null;
  }
}
