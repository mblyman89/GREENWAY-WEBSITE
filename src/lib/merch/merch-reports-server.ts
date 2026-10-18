/**
 * R73 S8 - server reads for Reports > Merch. Never throws: every failure is a
 * plain-English `problem` the page shows.
 *
 * Traffic: Vercel Web Analytics query API (vercel.com/docs/analytics/web-analytics-api).
 *   VERCEL_ANALYTICS_TOKEN  a Vercel access token (Account Settings > Tokens)
 *   MERCH_VERCEL_PROJECT    the greenwaymerch.com project id or name
 *   VERCEL_TEAM_ID          optional; the team id when the project is in a team
 * Sales + tax: Printful orders (loadMerchOrderBoard, S1).
 */
import "server-only";
import { loadMerchOrderBoard, type MerchBoard } from "@/lib/orders/merch-orders-server";
import { parseVisits, visitsAggregateUrl, type TrafficDim, type TrafficRow } from "./merch-reports-core";

export type MerchTraffic = {
  configured: boolean;
  days: TrafficRow[];
  pages: TrafficRow[];
  referrers: TrafficRow[];
  devices: TrafficRow[];
  countries: TrafficRow[];
  problem: string;
};

const env = (k: string) => (process.env[k] ?? "").trim();

export function merchTrafficConfigured(): boolean {
  return Boolean(env("VERCEL_ANALYTICS_TOKEN") && env("MERCH_VERCEL_PROJECT"));
}

async function query(by: TrafficDim, since: string, until: string, limit?: number): Promise<{ rows: TrafficRow[]; error: string }> {
  const url = visitsAggregateUrl({
    projectId: env("MERCH_VERCEL_PROJECT"),
    teamId: env("VERCEL_TEAM_ID") || undefined,
    since,
    until,
    by,
    limit,
  });
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env("VERCEL_ANALYTICS_TOKEN")}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? "Vercel refused the token (check VERCEL_ANALYTICS_TOKEN and VERCEL_TEAM_ID)."
          : res.status === 404
            ? "Vercel couldn't find the project or Web Analytics isn't enabled on it (check MERCH_VERCEL_PROJECT)."
            : `Vercel answered ${res.status}.`;
      return { rows: [], error: hint };
    }
    return { rows: parseVisits(await res.json(), by), error: "" };
  } catch {
    return { rows: [], error: "Couldn't reach Vercel Web Analytics." };
  }
}

export async function loadMerchTraffic(fromDate: string, toDate: string): Promise<MerchTraffic> {
  const empty: MerchTraffic = { configured: merchTrafficConfigured(), days: [], pages: [], referrers: [], devices: [], countries: [], problem: "" };
  if (!empty.configured) return empty;
  const [days, pages, referrers, devices, countries] = await Promise.all([
    query("day", fromDate, toDate),
    query("requestPath", fromDate, toDate, 15),
    query("referrerHostname", fromDate, toDate, 10),
    query("deviceType", fromDate, toDate, 5),
    query("country", fromDate, toDate, 10),
  ]);
  const problem = [days, pages, referrers, devices, countries].map((q) => q.error).find(Boolean) ?? "";
  return { ...empty, days: days.rows, pages: pages.rows, referrers: referrers.rows, devices: devices.rows, countries: countries.rows, problem };
}

export async function loadMerchSales(): Promise<MerchBoard> {
  return loadMerchOrderBoard();
}
