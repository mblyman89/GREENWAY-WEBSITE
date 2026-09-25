/**
 * SLICE L-38 — the details page for a Leafly order that has NOT been accepted
 * yet (so there is no Greenway copy of it to open).
 *
 * The online-orders dashboard no longer moves any order along; every order's
 * "Details" button opens a page and the steps are done there. A Leafly order
 * that has been accepted has a Greenway copy, and its Details button opens
 * that copy's page (/admin/orders/<id>), which shows the Leafly steps. Before
 * acceptance there is no copy, so the Details button lands HERE, where the
 * only meaningful step — Accept (acknowledge) — lives, together with the
 * countdown, the order itself and any warning.
 *
 * If the order has been accepted since the link was rendered (another tab,
 * the auto-acknowledge, or the Accept press on this very page), this page
 * forwards to the Greenway copy so staff always land on the one place that
 * has the rest of the steps. The step's outcome banner and the "Back to
 * orders" view travel with the redirect.
 */
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink } from "@/components/admin/ux";
import { getLeaflyBoardOrder } from "@/lib/leafly/order-board-server";
import { loadLeaflyOrderIntegrationKey } from "@/lib/leafly/webhook-server";
import {
  LeaflyOrderWorkflow,
  LeaflyOutcomeBanners,
} from "@/components/admin/orders/LeaflyOrderWorkflow";

export const dynamic = "force-dynamic";
// The Leafly step actions posted from this page inherit its budget; the
// Accept round trip to Leafly must not be cut off by the platform default.
export const maxDuration = 300;

type SearchParams = {
  back?: string;
  leaflyMsg?: string;
  leaflyWarn?: string;
  leaflyErr?: string;
  leaflyCode?: string;
  leaflyFix?: string;
};

/** Params carried to the Greenway copy when this page forwards there. */
const FORWARDED_KEYS = ["back", "leaflyMsg", "leaflyWarn", "leaflyErr", "leaflyCode", "leaflyFix"] as const;

export default async function LeaflyOrderDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leaflyOrderId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  await requirePermission("orders.view");
  const { leaflyOrderId: raw } = await params;
  const sp: SearchParams = searchParams ? await searchParams : {};

  let leaflyOrderId = raw;
  try {
    leaflyOrderId = decodeURIComponent(raw);
  } catch {
    /* a malformed escape is just a non-matching id → 404 below */
  }

  const order = await getLeaflyBoardOrder(leaflyOrderId);
  if (!order) notFound();

  const localId = (order.local_order_id ?? "").trim();
  if (localId) {
    const qs = new URLSearchParams();
    for (const key of FORWARDED_KEYS) {
      const v = sp[key];
      if (typeof v === "string" && v) qs.set(key, v);
    }
    const s = qs.toString();
    redirect(`/admin/orders/${encodeURIComponent(localId)}${s ? `?${s}` : ""}`);
  }

  const key = await loadLeaflyOrderIntegrationKey();
  const handle = (order.leafly_order_id ?? leaflyOrderId).slice(-6).toUpperCase();

  return (
    <div>
      <AdminPageHeader
        title={`Leafly order ·${handle}`}
        subtitle="Not accepted yet — accept it before the countdown runs out or Leafly cancels it."
        action={
          <BackLink
            fallback="/admin/orders"
            back={sp.back}
            className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/10"
          >
            Back to orders
          </BackLink>
        }
      />
      <div className="space-y-5 px-5 py-6 sm:px-8">
        <LeaflyOutcomeBanners
          message={sp.leaflyMsg ?? null}
          warning={sp.leaflyWarn ?? null}
          error={sp.leaflyErr ?? null}
          errorCode={sp.leaflyFix ?? sp.leaflyCode ?? null}
        />
        <div className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-white/70">
            Leafly steps
          </h2>
          <div className="mt-4">
            <LeaflyOrderWorkflow
              order={order}
              orderIntegrationKeyPresent={Boolean(key && key.trim())}
              now={new Date()}
              back={sp.back}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
