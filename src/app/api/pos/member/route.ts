/**
 * GET /api/pos/member?q=...  (POS Slice B14)
 *
 * Register-side customer lookup. An authenticated POS device searches
 * customers with THE customer search (G-75, owner message 17: searchCustomers,
 * exactly what the back office uses): every word of a name in any order and
 * any part, phone digits anywhere, email, Cultivera Customer ID, and the
 * closest spellings when nothing matches exactly. Up to 25 hits, best match
 * first, plus the total so the register can say there are more. It gets back
 * the MINIMUM the register needs:
 *
 *   customerId  — customers.id, attached to the sale payload; at sync the
 *                 server re-verifies it exists and writes orders.customer_id,
 *                 which makes the EXISTING completion accrual earn points.
 *   label       — privacy-lean display label ("Jane D."), frozen into the
 *                 payload + receipt.
 *   points      — current balance (0 when not yet enrolled — accrual at
 *                 completion auto-enrolls, matching website behavior).
 *   tierName    — current tier, display only.
 *
 *   fullName / detail — G-75: the full name and one line (last 4 phone
 *                 digits, last purchase, total spent incl. the old POS,
 *                 medical, Customer ID) so two customers with the same first
 *                 name can be told apart. Display only, never stored.
 *
 * Deliberately NOT returned: birthdate, full phone, email, notes — the
 * register never needs them and the response may sit in device memory.
 *
 * Lookup is ONLINE-ONLY by design: attaching a member offline would mean
 * caching the entire customer book on an iPad (a privacy hazard). An offline
 * register still rings the sale — just without the member attached.
 *
 * Auth: same X-POS-Device-Id / X-POS-Device-Key headers as /api/pos/sync.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { searchCustomers } from "@/lib/customers/store";
import { getAccountsByCustomers, listTiers } from "@/lib/loyalty/loyalty-store";
import { MIN_SEARCH_CHARS, memberLabel, registerHitDetail, registerResultNote } from "@/lib/customers/customer-search-core";
import { tierForPoints } from "@/lib/loyalty/engine";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PosMemberHit = {
  customerId: string;
  label: string;
  points: number;
  tierName: string | null;
  /** G-75: display only (not frozen into the sale). */
  fullName?: string;
  detail?: string;
};

/** G-75: how many hits the register shows at most. */
const REGISTER_HIT_LIMIT = 25;

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";

  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_SEARCH_CHARS) {
    return NextResponse.json({ error: "Type at least 2 characters (name, phone, email or Customer ID)." }, { status: 400 });
  }

  const [found, tiers] = await Promise.all([searchCustomers(q, { limit: REGISTER_HIT_LIMIT }), listTiers()]);
  const accounts = await getAccountsByCustomers(found.rows.map((c) => c.id));

  const members: PosMemberHit[] = found.rows.map((c) => {
    const account = accounts.get(c.id) ?? null;
    const { fullName, detail } = registerHitDetail(c);
    return {
      customerId: c.id,
      label: memberLabel(c.first_name, c.last_name),
      points: account?.balance_points ?? 0,
      tierName: tierForPoints(account?.lifetime_points ?? 0, tiers)?.name ?? null,
      fullName,
      detail,
    };
  });
  const note = registerResultNote(members.length, found.total, found.fuzzy);

  return NextResponse.json({ members, total: found.total, note });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handleGet(req));
}
