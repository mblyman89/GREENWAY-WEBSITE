/**
 * POST /api/pos/member-match  (Task AO-3)
 *
 * ID scan -> loyalty member, automatically. After the register's ID gate
 * PASSES on a scanned license, the register (online) posts the parsed
 * name + DOB here; the server pulls the (tiny) pool of customers sharing
 * that exact birthdate and asks the PURE matcher (member-match-core) whether
 * exactly ONE of them is unambiguously the person at the counter.
 *
 *   match     -> the SAME privacy-lean hit /api/pos/member returns
 *                (customerId + label + points + tierName) — the register
 *                attaches it and the sale earns points like a manual attach.
 *   ambiguous -> no attach (duplicate records; the budtender can use the
 *                manual lookup, which shows candidates to a human).
 *   none      -> no attach; nothing else happens.
 *
 * Privacy budget UNCHANGED from B14: the scanned name/DOB come off the
 * physical card the budtender is already holding; the response never carries
 * DOB, contact details, or anything beyond label/points/tier. Nothing about
 * the scan is stored. ONLINE-ONLY like every member feature — an offline
 * register still gates age locally and simply skips the attach.
 *
 * Auth: same X-POS-Device-Id / X-POS-Device-Key headers as /api/pos/sync.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { listCustomersByBirthdate } from "@/lib/customers/store";
import { getAccountByCustomer, listTiers } from "@/lib/loyalty/loyalty-store";
import { tierForPoints } from "@/lib/loyalty/engine";
import { matchScannedCustomer } from "@/lib/pos/member-match-core";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Privacy-lean display label: first name + last initial (mirrors B14). */
function memberLabel(firstName: string, lastName: string | null): string {
  const first = firstName.trim();
  const lastInitial = (lastName ?? "").trim().charAt(0);
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";

  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as {
    firstName?: unknown;
    lastName?: unknown;
    dateOfBirth?: unknown;
  } | null;

  const firstName = typeof body?.firstName === "string" ? body.firstName : null;
  const lastName = typeof body?.lastName === "string" ? body.lastName : null;
  const dateOfBirth = typeof body?.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return NextResponse.json({ error: "dateOfBirth must be YYYY-MM-DD." }, { status: 400 });
  }

  // DOB-equality keeps the candidate pool tiny; names are compared by the
  // pure core so normalization rules live in exactly one tested place.
  const candidates = await listCustomersByBirthdate(dateOfBirth);
  const result = matchScannedCustomer({ firstName, lastName, dateOfBirth }, candidates);

  if (result.kind !== "match") {
    // "ambiguous" is deliberately reported as no-match to the device — the
    // register behaves identically (no attach) and learns nothing about how
    // many records share this identity.
    return NextResponse.json({ member: null });
  }

  const customer = candidates.find((c) => c.id === result.customerId);
  if (!customer) return NextResponse.json({ member: null });

  const [account, tiers] = await Promise.all([getAccountByCustomer(customer.id), listTiers()]);
  return NextResponse.json({
    member: {
      customerId: customer.id,
      label: memberLabel(customer.first_name, customer.last_name),
      points: account?.balance_points ?? 0,
      tierName: tierForPoints(account?.lifetime_points ?? 0, tiers)?.name ?? null,
    },
  });
}

/**
 * CORS preflight. The packaged register app ("Greenway Point of Transaction")
 * calls this API cross-origin from capacitor://localhost. Policy lives in
 * @/lib/pos/cors-core (pure).
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  return posPreflightResponse(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handlePost(req));
}
