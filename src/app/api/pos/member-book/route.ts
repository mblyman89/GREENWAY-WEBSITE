/**
 * GET /api/pos/member-book?after=<customerId>  (D170 O15)
 *
 * Owner, 2026-11-04: "Please add customer loyalty to the iPad. Our data is
 * safe. I want all features unlocked."
 *
 * One page (up to 1,000 customers, ordered by id) of the member book the
 * register keeps in its ENCRYPTED store so member lookup, scan auto-attach
 * and loyalty rewards keep working during an internet outage. The iPad
 * follows `next` until it is null, then swaps the whole copy in at once (a
 * failed page keeps the old copy; it is never half-replaced).
 *
 * The row shape and why each field is there are documented in
 * src/lib/pos/member-book-core.ts. Notes and addresses are never sent.
 *
 * Auth: same X-POS-Device-Id / X-POS-Device-Key headers as /api/pos/sync.
 * A database error is a 503 so the iPad keeps its copy.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { listTiers } from "@/lib/loyalty/loyalty-store";
import { MEMBER_BOOK_PAGE_SIZE, type BookRow } from "@/lib/pos/member-book-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CustomerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone_normalized: string | null;
  email_normalized: string | null;
  email: string | null;
  birthdate: string | null;
  external_id: string | null;
  is_medical_patient: boolean | null;
  lifetime_spend_minor_units: number | null;
  imported_spend_minor_units: number | null;
  last_visit_at: string | null;
  last_purchase_at: string | null;
  loyalty_accounts:
    | { balance_points: number | null; lifetime_points: number | null }
    | { balance_points: number | null; lifetime_points: number | null }[]
    | null;
};

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(req.headers.get("x-pos-device-id") ?? "", req.headers.get("x-pos-device-key") ?? "");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isSupabaseServiceConfigured) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  const after = (req.nextUrl.searchParams.get("after") ?? "").trim();
  if (after && !UUID.test(after)) return NextResponse.json({ error: "after must be a customer id." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("customers")
    .select(
      "id, first_name, last_name, phone_normalized, email_normalized, email, birthdate, external_id, is_medical_patient, lifetime_spend_minor_units, imported_spend_minor_units, last_visit_at, last_purchase_at, loyalty_accounts(balance_points, lifetime_points)",
    )
    .order("id", { ascending: true })
    .limit(MEMBER_BOOK_PAGE_SIZE);
  if (after) query = query.gt("id", after);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: `Could not read the member book: ${error.message}` }, { status: 503 });

  const rows: BookRow[] = ((data as CustomerRow[] | null) ?? []).map((c) => {
    const acct = Array.isArray(c.loyalty_accounts) ? (c.loyalty_accounts[0] ?? null) : c.loyalty_accounts;
    return {
      i: c.id,
      f: (c.first_name ?? "").trim(),
      l: c.last_name?.trim() || null,
      p: c.phone_normalized || null,
      e: (c.email_normalized ?? c.email ?? "").toLowerCase().trim() || null,
      b: c.birthdate ? String(c.birthdate).slice(0, 10) : null,
      x: c.external_id || null,
      m: c.is_medical_patient === true,
      s: Math.max(0, Number(c.lifetime_spend_minor_units ?? 0) || 0),
      o: Math.max(0, Number(c.imported_spend_minor_units ?? 0) || 0),
      v: c.last_visit_at,
      lp: c.last_purchase_at,
      bp: Math.max(0, Number(acct?.balance_points ?? 0) || 0),
      lt: Math.max(0, Number(acct?.lifetime_points ?? 0) || 0),
    };
  });
  const next = rows.length === MEMBER_BOOK_PAGE_SIZE ? rows[rows.length - 1].i : null;
  // Tiers ride the first page only (they are tiny and rarely change).
  const tiers = after ? undefined : (await listTiers()).map((t) => ({ name: t.name, minPoints: t.minPoints }));
  return NextResponse.json({ rows, next, ...(tiers ? { tiers } : {}) }, { headers: { "cache-control": "no-store" } });
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withPosCors(req, await handleGet(req));
}
