/**
 * src/lib/customers/customer-table-store.ts  (customers-table-enterprise)
 *
 * Owner (verbatim): "I would like you to expand the table so it shows more
 * details, every important piece of data should be shown on the table. ...
 * Please enhance the table to be of enterprise grade quality."
 *
 * Server reads behind /admin/customers that the customers row alone does not
 * carry: each customer's loyalty balance + tier, their best medical
 * recognition card, the at-a-glance counts, and the CSV / Excel download of
 * the whole filtered table. Explicit columns; every {error} is read and
 * reported (a failed side read shows a warning, never a silent blank).
 * The pure rules live in customer-table-core.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { dbErrorForStaff } from "@/lib/db/rpc-fallback-core";
import { tierForPoints } from "@/lib/loyalty/engine";
import { listTiers } from "@/lib/loyalty/loyalty-store";
import { listCustomersPaged } from "@/lib/customers/store";
import { loadSegmentMap } from "@/lib/customers/customer-insights-server";
import { pacificToday } from "@/lib/reports/timezone";
import type { WorkbookSpec } from "@/lib/reports/workbook";
import {
  CUSTOMER_EXPORT_CAP,
  CUSTOMER_EXPORT_COLUMNS,
  authorizationStatusFor,
  customerExportRow,
  customerFilterOps,
  tableFigures,
  type AuthorizationRow,
  type AuthorizationStatus,
  type CustomerTableState,
} from "@/lib/customers/customer-table-core";
import { CUSTOMER_SORTS } from "@/lib/admin/list-filter-core";
import type { Customer } from "@/lib/customers/types";

/** PostgREST puts .in() ids in the URL; keep each request well under its limits. */
const ID_CHUNK = 150;
const PARALLEL = 4;

function chunks<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export type CustomerLoyaltyFacts = { balancePoints: number; lifetimePoints: number; tierName: string | null; active: boolean };

export type CustomerTableExtras = {
  loyalty: Map<string, CustomerLoyaltyFacts>;
  authorizations: Map<string, AuthorizationStatus>;
  /** Plain-English problems reading the side tables (shown as a warning). */
  problems: string[];
};

/** Loyalty + recognition card facts for a set of customers (one page, or a whole download). */
export async function loadCustomerTableExtras(customerIds: readonly string[], todayYmd: string = pacificToday()): Promise<CustomerTableExtras> {
  const loyalty = new Map<string, CustomerLoyaltyFacts>();
  const authorizations = new Map<string, AuthorizationStatus>();
  const problems: string[] = [];
  const ids = [...new Set(customerIds)];
  if (!isSupabaseServiceConfigured || ids.length === 0) return { loyalty, authorizations, problems };
  const admin = createSupabaseAdminClient();
  const tiers = await listTiers();

  const authRows = new Map<string, AuthorizationRow[]>();
  // A page is one chunk; a download runs PARALLEL chunks at a time.
  const readChunk = (part: string[]) =>
    Promise.all([
      admin.from("loyalty_accounts").select("customer_id, balance_points, lifetime_points, is_active").in("customer_id", part),
      admin.from("patient_authorizations").select("customer_id, status, expires_on").in("customer_id", part),
    ]);
  const parts = chunks(ids, ID_CHUNK);
  const results: Awaited<ReturnType<typeof readChunk>>[] = [];
  for (let i = 0; i < parts.length; i += PARALLEL) results.push(...(await Promise.all(parts.slice(i, i + PARALLEL).map(readChunk))));
  for (const [acc, auth] of results) {
    if (acc.error) {
      console.error("[customers-table] loyalty_accounts read failed", acc.error.code, acc.error.message);
      problems.push(`Loyalty points: ${dbErrorForStaff(acc.error)}`);
    }
    for (const a of (acc.data ?? []) as { customer_id: string | null; balance_points: number | null; lifetime_points: number | null; is_active: boolean | null }[]) {
      if (!a.customer_id) continue;
      const lifetime = Number(a.lifetime_points ?? 0) || 0;
      loyalty.set(a.customer_id, {
        balancePoints: Number(a.balance_points ?? 0) || 0,
        lifetimePoints: lifetime,
        tierName: tierForPoints(lifetime, tiers)?.name ?? null,
        active: a.is_active !== false,
      });
    }
    if (auth.error) {
      console.error("[customers-table] patient_authorizations read failed", auth.error.code, auth.error.message);
      problems.push(`Recognition cards: ${dbErrorForStaff(auth.error)}`);
    }
    for (const r of (auth.data ?? []) as AuthorizationRow[]) {
      const list = authRows.get(r.customer_id) ?? [];
      list.push(r);
      authRows.set(r.customer_id, list);
    }
  }
  for (const [id, rows] of authRows) authorizations.set(id, authorizationStatusFor(rows, todayYmd));
  return { loyalty, authorizations, problems: [...new Set(problems)] };
}

export type CustomerTableStats = {
  total: number;
  medical: number;
  consented: number;
  doNotContact: number;
  withPhone: number;
  withEmail: number;
  loyaltyMembers: number;
  problems: string[];
};

/** The at-a-glance counts (whole table, not the filtered page). Head-only counts. */
export async function countCustomerTableStats(): Promise<CustomerTableStats> {
  const zero: CustomerTableStats = { total: 0, medical: 0, consented: 0, doNotContact: 0, withPhone: 0, withEmail: 0, loyaltyMembers: 0, problems: [] };
  if (!isSupabaseServiceConfigured) return zero;
  const admin = createSupabaseAdminClient();
  const head = () => admin.from("customers").select("id", { count: "exact", head: true });
  const results = await Promise.all([
    head(),
    head().eq("is_medical_patient", true),
    head().eq("marketing_consent", true),
    head().eq("do_not_contact", true),
    head().not("phone_normalized", "is", null),
    head().not("email", "is", null),
    admin.from("loyalty_accounts").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  const names = ["customers", "medical", "consent", "do not contact", "phone", "email", "loyalty members"];
  const problems: string[] = [];
  results.forEach((r, i) => {
    if (r.error) {
      console.error("[customers-table] count failed", names[i], r.error.code, r.error.message);
      problems.push(`Count of ${names[i]}: ${dbErrorForStaff(r.error)}`);
    }
  });
  const n = (i: number) => results[i].count ?? 0;
  return { total: n(0), medical: n(1), consented: n(2), doNotContact: n(3), withPhone: n(4), withEmail: n(5), loyaltyMembers: n(6), problems: [...new Set(problems)] };
}

/**
 * The download: the same filters, search and sort as the screen, every
 * column, up to CUSTOMER_EXPORT_CAP rows. Money stays in cents (the workbook
 * helper renders dollars).
 */
export async function exportCustomerWorkbook(state: CustomerTableState): Promise<{ spec: WorkbookSpec; rows: number; truncated: boolean; error?: string }> {
  const today = pacificToday();
  const ops = customerFilterOps(state.filters);
  const filter = { q: state.q, sort: state.sort.columns, bestMatch: state.sort.key === CUSTOMER_SORTS[0].key, ops };
  const step = 1000;
  const customers: Customer[] = [];
  let truncated = false;
  let error: string | undefined;
  for (let from = 0; from < CUSTOMER_EXPORT_CAP; from += step) {
    const res = await listCustomersPaged({ ...filter, from, to: from + step - 1 });
    if (res.error) {
      error = res.error;
      break;
    }
    customers.push(...res.rows);
    if (res.rows.length < step || customers.length >= res.total) break;
    if (from + step >= CUSTOMER_EXPORT_CAP) truncated = true;
  }
  const [segMap, extras] = await Promise.all([loadSegmentMap(), loadCustomerTableExtras(customers.map((c) => c.id), today)]);
  const computed = segMap?.source === "computed";
  const rows = customers.map((c) => {
    const r = segMap?.rollups.get(c.id);
    const figures = tableFigures(c, r ? { visits: r.visits, netSpendMinor: r.netSpendMinor, lastVisitAt: r.lastVisitAt, firstVisitAt: r.firstVisitAt } : undefined, computed);
    const l = extras.loyalty.get(c.id);
    return customerExportRow(
      {
        customer: c,
        figures,
        loyalty: l ? { balancePoints: l.balancePoints, lifetimePoints: l.lifetimePoints, tierName: l.tierName } : null,
        authorization: extras.authorizations.get(c.id) ?? { state: "none", expiresOn: null, daysLeft: null },
        segmentLabel: segMap?.segments.get(c.id)?.label ?? null,
      },
      today,
    );
  });
  const notes = [
    truncated ? `Only the first ${CUSTOMER_EXPORT_CAP.toLocaleString("en-US")} customers are included; narrow the filters for the rest.` : "",
    error ? `The list could not be read completely: ${error}` : "",
    ...extras.problems,
  ].filter(Boolean);
  return {
    rows: rows.length,
    truncated,
    error,
    spec: {
      filename: `greenway-customers-${today}`,
      title: "Greenway \u2014 Customers",
      sheets: [
        {
          name: "Customers",
          caption: notes.length > 0 ? notes.join(" ") : undefined,
          columns: CUSTOMER_EXPORT_COLUMNS.map((c) => ({ key: c.key, header: c.header, type: c.type })),
          rows,
        },
      ],
    },
  };
}
