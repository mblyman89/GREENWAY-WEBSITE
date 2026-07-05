#!/usr/bin/env tsx
/**
 * scripts/seed/seed_vendors_from_cultivera.ts
 *
 * Seed the `vendors` table from the cleaned Cultivera export
 * (scripts/seed/data/vendor_export_clean.csv, produced by clean_vendor_export.py).
 *
 * Owner directive: "seed my vendor data with the vendor data I was able to get
 * from Cultivera. Please add all the details where they belong." + "add whatever
 * fields needed to the vendors page, I want all the data."
 *
 * Standing rules honored:
 *   - GAP-FILL upsert BY SLUG: we SELECT the existing row and only fill columns
 *     that are currently empty. Curated / owner-authored data is NEVER clobbered.
 *   - New rows land status 'draft' (staff review/publish later).
 *   - Money in MINOR UNITS: TotalAcceptedYtd is already cents in the clean CSV.
 *   - Idempotent: safe to re-run.
 *   - Uses PostgREST REST API directly (no supabase-js) to avoid the Node 20
 *     realtime WebSocket init issue, mirroring seed_vendors_brands.ts.
 *
 * Requires migration 0081 to be applied first (adds the address/ops columns).
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.
 *
 * Run: npm run seed:vendors:cultivera
 * Dry run (parse + report only, no writes): SEED_DRY_RUN=1 npm run seed:vendors:cultivera
 */
import fs from "node:fs";
import path from "node:path";

/** Slug identical to src/lib/vendors/import.ts slugifyName (kept in sync). */
function slugifyName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.SEED_DRY_RUN === "1";

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or set SEED_DRY_RUN=1).");
  process.exit(1);
}

const REST = `${SUPABASE_URL}/rest/v1`;
const BASE_HEADERS = {
  apikey: SERVICE_KEY ?? "",
  Authorization: `Bearer ${SERVICE_KEY ?? ""}`,
  "Content-Type": "application/json",
};

const CSV_PATH = path.join(process.cwd(), "scripts", "seed", "data", "vendor_export_clean.csv");

// ── Minimal RFC-4180 CSV parser (quotes, escaped quotes, embedded commas) ──────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell); cell = "";
    } else if (c === "\n") {
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}
function toBool(v: string | undefined): boolean | null {
  const t = clean(v)?.toLowerCase();
  if (t === "true" || t === "1") return true;
  if (t === "false" || t === "0") return false;
  return null;
}
function toInt(v: string | undefined): number | null {
  const t = clean(v);
  if (t == null) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}
function toIso(v: string | undefined): string | null {
  const t = clean(v);
  if (t == null) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type Row = Record<string, unknown>;

async function getExistingBySlug(slug: string): Promise<Row | null> {
  const url = `${REST}/vendors?slug=eq.${encodeURIComponent(slug)}&select=*`;
  const res = await fetch(url, { headers: BASE_HEADERS });
  if (!res.ok) throw new Error(`select failed (${res.status}): ${await res.text()}`);
  const arr = (await res.json()) as Row[];
  return arr[0] ?? null;
}

async function insertVendor(row: Row): Promise<void> {
  const res = await fetch(`${REST}/vendors`, {
    method: "POST",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`insert failed (${res.status}): ${await res.text()}`);
}

async function updateVendorById(id: string, patch: Row): Promise<void> {
  const res = await fetch(`${REST}/vendors?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...BASE_HEADERS, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update failed (${res.status}): ${await res.text()}`);
}

/** Only fill columns currently empty on the existing row. */
function gapFillPatch(existing: Row, incoming: Row): Row | null {
  const patch: Row = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null || v === "") continue;
    const cur = existing[k];
    if (cur == null || cur === "") patch[k] = v;
  }
  return Object.keys(patch).length ? patch : null;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`Clean CSV not found at ${CSV_PATH}`);
  const grid = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
  const header = grid[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const body = grid.slice(1);

  const c = {
    id: idx("Id"), vendorNo: idx("VendorNo"), license: idx("LicenseNo"),
    trade: idx("TradeName"), dba: idx("DBA"), phone: idx("Phone"),
    sa1: idx("ShippingAddress1"), sa2: idx("ShippingAddress2"), sc: idx("ShippingCity"),
    ss: idx("ShippingState"), sz: idx("ShippingZip"),
    ba1: idx("BillingAddress1"), ba2: idx("BillingAddress2"), bc: idx("BillingCity"),
    bs: idx("BillingState"), bz: idx("BillingZip"),
    active: idx("IsActive"), same: idx("BillingAddressSameAsShipping"),
    ytd: idx("TotalAcceptedYtd"), last: idx("LastDateAccepted"),
  };

  let inserted = 0, updated = 0, skipped = 0, seen = 0;
  const seenSlugs = new Set<string>();

  for (const r of body) {
    const name = clean(r[c.trade]);
    if (!name) continue;
    seen += 1;
    let slug = slugifyName(name);
    // De-dupe slugs within the file by appending the vendor number when needed.
    if (seenSlugs.has(slug)) {
      const vn = clean(r[c.vendorNo]);
      slug = vn ? `${slug}-${slugifyName(vn)}` : `${slug}-${seen}`;
    }
    seenSlugs.add(slug);

    const incoming: Row = {
      // The export has no distinct legal name — DBA lives in its own `dba`
      // column, so we leave `legal_name` untouched for owner-curated data.
      license_number: clean(r[c.license]),
      phone: clean(r[c.phone]),
      vendor_number: clean(r[c.vendorNo]),
      dba: clean(r[c.dba]),
      external_id: clean(r[c.id]),
      shipping_address1: clean(r[c.sa1]),
      shipping_address2: clean(r[c.sa2]),
      shipping_city: clean(r[c.sc]),
      shipping_state: clean(r[c.ss]),
      shipping_zip: clean(r[c.sz]),
      billing_address1: clean(r[c.ba1]),
      billing_address2: clean(r[c.ba2]),
      billing_city: clean(r[c.bc]),
      billing_state: clean(r[c.bs]),
      billing_zip: clean(r[c.bz]),
      billing_same_as_shipping: toBool(r[c.same]),
      is_active: toBool(r[c.active]),
      total_accepted_ytd_cents: toInt(r[c.ytd]),
      last_accepted_at: toIso(r[c.last]),
    };

    if (DRY_RUN) {
      inserted += 1; // count as would-insert for reporting
      continue;
    }

    const existing = await getExistingBySlug(slug);
    if (!existing) {
      await insertVendor({ display_name: name, slug, status: "draft", ...incoming });
      inserted += 1;
    } else {
      const patch = gapFillPatch(existing, incoming);
      if (!patch) { skipped += 1; continue; }
      await updateVendorById(existing.id as string, patch);
      updated += 1;
    }
    if ((inserted + updated + skipped) % 200 === 0) {
      console.log(`  …progress: +${inserted} ~${updated} =${skipped}`);
    }
  }

  console.log(
    `\nDone${DRY_RUN ? " (DRY RUN — no writes)" : ""}. rows=${seen} inserted=${inserted} updated=${updated} skipped=${skipped}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
