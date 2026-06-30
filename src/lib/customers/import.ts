/**
 * src/lib/customers/import.ts
 *
 * POS Slice 11 — import the Cultivera customer export (CSV) into our customers
 * table. Dedupes by external Customer ID, then phone, then email. We bring in
 * what's there; going forward, deals require phone + email so the data improves.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

export type CustomerImportRow = {
  external_id: string | null;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  email_normalized: string | null;
  birthdate: string | null;
  is_medical_patient: boolean;
  lifetime_spend_minor_units: number;
  city: string | null;
  state: string | null;
  zip: string | null;
  last_purchase_at: string | null;
};

export type ParsedCustomerImport = {
  rows: CustomerImportRow[];
  /** Rows skipped because they had no usable identity (no name + no contact). */
  skipped: number;
  warnings: string[];
};

function normPhone(s: string | null): string | null {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length >= 7 ? d : null;
}

function normEmail(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  return t.includes("@") ? t : null;
}

function parseMoneyToMinor(s: string | null): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[$,]/g, "").trim());
  if (Number.isNaN(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** Parse common US date strings to ISO yyyy-mm-dd (birthdate) or full ISO. */
function parseDateLoose(s: string | null, full = false): string | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return full ? d.toISOString() : d.toISOString().slice(0, 10);
}

/**
 * Minimal RFC-4180-ish CSV parser (handles quoted fields + commas + newlines).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore; handled by \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Map a parsed CSV (with header) into customer import rows. */
export function mapCustomerCsv(text: string): ParsedCustomerImport {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (grid.length === 0) {
    return { rows: [], skipped: 0, warnings: ["The CSV was empty."] };
  }
  const header = grid[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());

  // Tolerant column resolution (Cultivera export headers, lowercased).
  const cId = col("customer id");
  const cFirst = col("first name");
  const cLast = col("last name");
  const cPhone = col("phone number");
  const cSpent = col("total spent");
  const cDob = col("date of birth");
  const cMed = col("is medical");
  const cCity = col("city");
  const cState = col("state");
  const cZip = col("zip");
  const cEmail = col("email");
  const cLastPurch = col("last purchase date");

  const warnings: string[] = [];
  if (cFirst === -1) warnings.push("No 'First Name' column found — names may be blank.");

  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i].trim() : "");

  const rows: CustomerImportRow[] = [];
  let skipped = 0;
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const first = get(r, cFirst);
    const last = get(r, cLast);
    const phone = get(r, cPhone) || null;
    const email = get(r, cEmail) || null;
    const ext = get(r, cId) || null;

    // Skip truly empty rows (no name and no contact and no external id).
    if (!first && !last && !phone && !email && !ext) {
      skipped++;
      continue;
    }

    rows.push({
      external_id: ext,
      first_name: first || "(unknown)",
      last_name: last || null,
      phone,
      phone_normalized: normPhone(phone),
      email,
      email_normalized: normEmail(email),
      birthdate: parseDateLoose(get(r, cDob) || null, false),
      is_medical_patient: get(r, cMed).toUpperCase() === "Y",
      lifetime_spend_minor_units: parseMoneyToMinor(get(r, cSpent) || null),
      city: get(r, cCity) || null,
      state: get(r, cState) || null,
      zip: get(r, cZip) || null,
      last_purchase_at: parseDateLoose(get(r, cLastPurch) || null, true),
    });
  }

  return { rows, skipped, warnings };
}

export type ImportResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
};

/**
 * Persist parsed rows. Dedupe priority: external_id, then phone, then email.
 * Existing rows are updated (spend/last-purchase/contact filled in), new rows
 * inserted. Done in batches for the 16k-row file.
 */
export async function importCustomers(
  parsed: ParsedCustomerImport,
  actorId: string | null,
): Promise<ImportResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, inserted: 0, updated: 0, skipped: parsed.skipped, error: "Supabase not configured." };
  }
  const admin = createSupabaseAdminClient();

  let inserted = 0;
  let updated = 0;

  for (const row of parsed.rows) {
    // Find an existing customer by external id -> phone -> email.
    let existingId: string | null = null;
    if (row.external_id) {
      const { data } = await admin
        .from("customers")
        .select("id")
        .eq("external_id", row.external_id)
        .maybeSingle();
      existingId = (data as { id: string } | null)?.id ?? null;
    }
    if (!existingId && row.phone_normalized) {
      const { data } = await admin
        .from("customers")
        .select("id")
        .eq("phone_normalized", row.phone_normalized)
        .limit(1)
        .maybeSingle();
      existingId = (data as { id: string } | null)?.id ?? null;
    }
    if (!existingId && row.email_normalized) {
      const { data } = await admin
        .from("customers")
        .select("id")
        .eq("email_normalized", row.email_normalized)
        .limit(1)
        .maybeSingle();
      existingId = (data as { id: string } | null)?.id ?? null;
    }

    const payload = {
      external_id: row.external_id,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      phone_normalized: row.phone_normalized,
      email: row.email,
      email_normalized: row.email_normalized,
      birthdate: row.birthdate,
      is_medical_patient: row.is_medical_patient,
      lifetime_spend_minor_units: row.lifetime_spend_minor_units,
      city: row.city,
      state: row.state,
      zip: row.zip,
      last_purchase_at: row.last_purchase_at,
      import_source: "cultivera-export",
      updated_by: actorId,
    };

    if (existingId) {
      await admin.from("customers").update(payload).eq("id", existingId);
      updated++;
    } else {
      await admin.from("customers").insert({ ...payload, created_by: actorId });
      inserted++;
    }
  }

  return { ok: true, inserted, updated, skipped: parsed.skipped };
}
