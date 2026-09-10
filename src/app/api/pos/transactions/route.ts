/**
 * GET /api/pos/transactions   (SLICE 19)
 *
 * The register's TRANSACTION HISTORY — recent sales at this store, newest
 * first, so a return no longer depends on the customer still having the paper
 * receipt.
 *
 * Owner: "Right now it's just a box that you enter or scan the receipt code.
 * I want the register to show a history of transactions with the name of the
 * customer and total..."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ENDPOINT IS READ-ONLY, AND THAT IS THE DESIGN.
 *
 * It returns enough for staff to FIND the right sale and read its receipt
 * number. Acting on that sale — the refund itself — still goes through
 * POST /api/pos/returns, which carries the manager PIN, the WAC 314-55-079(12)
 * attestations, the CCRS correction queue and the loyalty clawback. Adding a
 * second way to move money would mean two sets of compliance rules to keep in
 * step, and they would drift. There is one refund path; this is a finder.
 *
 * PRIVACY BUDGET: customers appear as "Jane D." (first name + last initial),
 * the same convention the returns desk already used. No contact details, no
 * notes, no birthdates. A register screen is visible to whoever is standing at
 * the counter.
 *
 * ONLINE-ONLY, like /api/pos/returns and /api/pos/void: this reads durable
 * server facts (orders, returns) that a device cannot reconstruct offline.
 * Device-authenticated like every register endpoint.
 *
 * Money in MINOR UNITS (cents).
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateDevice } from "@/lib/pos/sync-store";
import { listRecentTransactions } from "@/lib/pos/transaction-history-store";
import { posPreflightResponse, withPosCors } from "@/lib/pos/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGet(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateDevice(
    req.headers.get("x-pos-device-id") ?? "",
    req.headers.get("x-pos-device-key") ?? "",
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // SEARCH IS SERVER-SIDE. The panel used to fetch the newest 50 rows and
  // filter them in the browser, so a search could only ever find a sale from
  // the last half-day — anything older answered "Nothing matches" even though
  // it was inside the return window. The query now reaches the database, which
  // scans the whole window and returns the newest 50 MATCHES.
  const query = req.nextUrl.searchParams.get("q") ?? "";

  const result = await listRecentTransactions(query);
  if (!result.ok) {
    // A failed read is reported as a failure, never as an empty history —
    // "no sales" and "could not look" are different answers.
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({
    transactions: result.transactions,
    // Told to the user verbatim when true: "no results" and "we stopped
    // looking" must never look the same at the counter.
    scanTruncated: result.scanTruncated,
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Wrap once so EVERY return path carries the CORS headers.
  return withPosCors(req, await handleGet(req));
}
