/**
 * GET /api/pos/member?q=...  (POS Slice B14)
 *
 * Register-side loyalty member lookup. An authenticated POS device searches
 * customers by name / phone / email (the same matching listCustomers uses in
 * the back office) and gets back the MINIMUM the register needs:
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
 * Deliberately NOT returned: birthdate, full contact details, notes — the
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
import { listCustomers } from "@/lib/customers/store";
import { getAccountByCustomer, listTiers } from "@/lib/loyalty/loyalty-store";
import { tierForPoints } from "@/lib/loyalty/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PosMemberHit = {
  customerId: string;
  label: string;
  points: number;
  tierName: string | null;
};

/** Privacy-lean display label: first name + last initial. */
function memberLabel(firstName: string, lastName: string | null): string {
  const first = firstName.trim();
  const lastInitial = (lastName ?? "").trim().charAt(0);
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const deviceId = req.headers.get("x-pos-device-id") ?? "";
  const deviceKey = req.headers.get("x-pos-device-key") ?? "";

  const auth = await authenticateDevice(deviceId, deviceKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ error: "Type at least 2 characters (name, phone, or email)." }, { status: 400 });
  }

  const [customers, tiers] = await Promise.all([listCustomers({ q, limit: 8 }), listTiers()]);

  const members: PosMemberHit[] = await Promise.all(
    customers.map(async (c) => {
      const account = await getAccountByCustomer(c.id);
      const points = account?.balance_points ?? 0;
      return {
        customerId: c.id,
        label: memberLabel(c.first_name, c.last_name),
        points,
        tierName: tierForPoints(account?.lifetime_points ?? 0, tiers)?.name ?? null,
      };
    }),
  );

  return NextResponse.json({ members });
}
