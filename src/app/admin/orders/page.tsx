import { Fragment } from "react";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Card } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { formatMinorCurrency } from "@/lib/leafly/format";
import { listOrdersPaged, getOrderStatusCounts } from "@/lib/orders/orders-store";
import { listWindow, parsePageParam, DEFAULT_PAGE_SIZE } from "@/lib/admin/list-window-core";
import {
  ORDER_SORTS,
  endOfDayIso,
  parseDollarsToMinor,
  parseIsoDate,
  resolveSort,
} from "@/lib/admin/list-filter-core";
import { ListPager } from "@/components/admin/ux/ListPager";
import {
  ORDER_STATUS_LABELS,
  ORDER_FORWARD_TRANSITIONS,
  type OrderStatus,
} from "@/lib/orders/types";
import { resolveOrderDisplay } from "@/lib/orders/order-name-pool-core";
import { OrderOriginBadge } from "@/components/admin/orders/OrderOriginBadge";
import { listPoolNamesStatus } from "@/lib/orders/order-name-pool-store";
import { getPrinterSettings, isPrinterOnline } from "@/lib/printing/printer-store";
import { setOrderStatusAction, testPrintFromOrdersAction } from "./actions";
import { OrderStatusFlow } from "@/components/admin/orders/OrderStatusFlow";
import { OrderNamePoolManager } from "@/components/admin/orders/OrderNamePoolManager";
import { NewOrderAlert } from "@/components/admin/orders/NewOrderAlert";
import { AnnouncerPanel } from "@/components/admin/orders/AnnouncerPanel";
import { withBackParam } from "@/lib/admin/back-link-core";
// SLICE L-6 — Leafly orders live on THIS page, with Greenway's own orders,
// because the owner asked for exactly that and because a Leafly order carries a
// 15-minute auto-cancel deadline that must not sit behind a tab.
import {
  loadLeaflyOrderBoard,
  countLeaflyOrdersAwaitingAck,
} from "@/lib/leafly/order-board-server";
// SLICE L-14 — register cancellation interrupts, shown per order on the
// board so the back office can see which tills are blocked and how each
// cancellation was answered. Non-throwing and degrade-safe by construction.
import {
  listInterruptsForOrders,
  type BoardInterrupts,
} from "@/lib/leafly/register-claim-server";
import { LeaflyOrdersPanel } from "@/components/admin/orders/LeaflyOrdersPanel";
// SLICE L-28 — validate the Leafly board's view params before they reach the
// panel, so a hand-edited URL cannot produce an empty board.
import {
  parseBoardFilter,
  parseBoardSearch,
  parseBoardSort,
} from "@/lib/leafly/board-view-core";
// SLICE M-2 — the owner placed a real Leafly order and got four silences: no
// row, no receipt, no sound, and no Leafly section on this page. The last of
// those was the orders panel correctly hiding itself while setup was
// incomplete. This panel owns that empty state so the page explains itself
// instead of going blank, and it shows the six webhook addresses that have to
// be emailed to Leafly before any order can arrive at all.
import {
  emptyLeaflyOrderSetupState,
  loadLeaflyOrderSetupState,
} from "@/lib/leafly/order-readiness-server";
// SLICE L-26 — the render backstop. See `render-budget.ts` for why a page
// that a redirecting server action navigates to needs one of these at all.
import { withRenderBudget } from "@/lib/supabase/render-budget";

import { assessEmailReadiness } from "@/lib/orders/email-readiness-core";
import { EmailReadinessBanner } from "@/components/admin/orders/EmailReadinessBanner";
import { LeaflyOrderSetupPanel } from "@/components/admin/orders/LeaflyOrderSetupPanel";
// SLICE L-21 — the setup tab. The pure core owns tab resolution AND the
// judgement about which live alarms may not be hidden behind a tab.
import {
  leaflyBoardRendersNothing,
  ordersTabHref,
  resolveOrdersTab,
  setupTabNeedsAttention,
  urgentSignals,
} from "@/lib/admin/orders-tabs-core";
import {
  emptyAnnouncerPanelData,
  getAnnouncerPanelDataCached,
} from "@/lib/announcer/announcer-admin-store";
// SLICE L-22 — the owner's requested board order, and the rule that bends it
// when a Leafly auto-cancel clock is actually running. Also owns the "label
// everything or label nothing" rule for the combined history.
import {
  decideBoardLayout,
  describeOriginMix,
  shouldLabelWebsiteRows,
  tallyOrigins,
} from "@/lib/admin/orders-board-order-core";
// The badge's own word for an origin, passed INTO the summary line rather than
// re-typed there, so the sentence above the list and the badges inside it can
// never call the same thing by two different names.
import { orderOriginLabel } from "@/lib/orders/order-origin-core";

export const dynamic = "force-dynamic";

/**
 * SLICE L-25 — an explicit ceiling for the page the acknowledge REDIRECTS TO.
 *
 * ── WHY A PAGE'S BUDGET IS PART OF A BUTTON'S BUG ────────────────────────
 * The Leafly Accept control is a real `<form>` posting to a server action,
 * and its spinner is driven by `useFormStatus().pending`. That flag does not
 * clear when the action returns — it clears when the NAVIGATION RESOLVES,
 * which includes rendering the redirect target. This page IS that target.
 *
 * So a slow render here keeps the button spinning long after the
 * acknowledgement has succeeded, and the operator cannot tell the difference
 * between "Leafly never answered" and "Leafly answered instantly and the
 * board is slow". That is a real part of the defect the owner reported, and
 * it is why bounding the outbound request twice did not change what he saw.
 *
 * This render is expensive and honest about it: an eight-way `Promise.all`
 * plus follow-up reads. Declaring the ceiling explicitly — rather than
 * silently inheriting the platform maximum — means a pathological render ends
 * in a visible error page instead of a killed function that renders nothing
 * and leaves the spinner as the last thing on screen.
 */
export const maxDuration = 300;

const STATUS_STYLES: Record<OrderStatus, string> = {
  new: "border-[var(--admin-orange)]/50 bg-[var(--admin-orange-soft)] text-[var(--admin-orange)]",
  acknowledged:
    "border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] text-[var(--admin-gold)]",
  preparing:
    "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  ready:
    "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]",
  completed: "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]",
  cancelled:
    "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
  no_show:
    "border-[var(--admin-danger)]/30 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]",
};

const FILTERS: { key: string; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "new", label: "New" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no_show", label: "No-show" },
  { key: "all", label: "All" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function OrdersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    page?: string;
    sort?: string;
    from?: string;
    to?: string;
    min?: string;
    max?: string;
    poolMsg?: string;
    poolErr?: string;
    printTest?: string;
    // SLICE L-21 — "orders" (default) or "setup". Anything unrecognised
    // resolves to the orders board, never to a settings screen: see
    // resolveOrdersTab() for why a bad query string must not be able to land
    // somebody on configuration while a customer is waiting.
    tab?: string;
    // SLICE L-6 — outcome of a Leafly acknowledge/status push, carried back by
    // the server action. `leaflyCode`/`leaflyFix` are the pure core's decision
    // codes, kept separate from the message so the panel can offer the RIGHT
    // next step (a link to Integrations for a credential problem, the same
    // button again for a transient one) instead of one flattened sentence.
    leaflyMsg?: string;
    leaflyWarn?: string;
    leaflyErr?: string;
    leaflyCode?: string;
    leaflyFix?: string;
    // SLICE L-28 — the Leafly board's own view controls. Prefixed `l` so they
    // cannot collide with the Greenway order list's existing `q`/`sort`
    // params, which sit on the same page and would otherwise be driven by the
    // same dropdown. Anything unrecognised resolves to the default view (open
    // orders, most urgent first) rather than to an empty board — a stale link
    // must never look like "no orders".
    lfilter?: string;
    lsort?: string;
    lq?: string;
  }>;
}) {
  await requirePermission("orders.view");
  const sp = await searchParams;
  const status = (sp.status as OrderStatus | "active" | "all" | undefined) ?? "active";
  const search = sp.q ?? "";
  const rawPage = parsePageParam(sp.page);
  // SLICE 26: every filter knob validated by the pure grammar — garbage
  // params silently mean "filter off", never an exception.
  const sort = resolveSort(sp.sort, ORDER_SORTS);
  const placedFrom = parseIsoDate(sp.from);
  const placedToDate = parseIsoDate(sp.to);
  const placedTo = placedToDate ? endOfDayIso(placedToDate) : undefined;
  const totalMin = parseDollarsToMinor(sp.min);
  const totalMax = parseDollarsToMinor(sp.max);
  // GW-029: carry the current filters/search into detail links so BackLink
  // can restore this exact view.
  const detailHref = (id: string) => withBackParam(`/admin/orders/${id}`, sp);

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader
          title="Orders"
          subtitle="Live pickup orders — acknowledge, prepare, and complete from any device."
        />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn’t fully set up yet. Once your administrator finishes the one-time
            setup, live orders will appear here automatically. Until then the storefront confirms
            orders locally.
          </div>
        </div>
      </div>
    );
  }

  // GW-033: fetch the requested page window plus the exact total. If the
  // requested page is past the end (stale link), clamp and refetch the real
  // last page so the screen is never empty while rows exist.
  const queryFilter = {
    status,
    search,
    sort: sort.columns,
    placedFrom,
    placedTo,
    totalMin,
    totalMax,
  };
  const firstWin = listWindow(Number.MAX_SAFE_INTEGER, rawPage, DEFAULT_PAGE_SIZE);
  const [
    firstPage,
    counts,
    poolStatus,
    printerSettings,
    leaflyBoard,
    leaflyPendingAck,
    leaflySetup,
    announcerData,
  ] = await Promise.all([
    listOrdersPaged({ ...queryFilter, from: firstWin.from, to: firstWin.to }),
    getOrderStatusCounts(),
    // SLICE 113: order-NAME pool + printer heartbeat, both fallback-safe (empty
    // pool / null settings when 0147 isn't applied or the printer isn't set up).
    //
    // ── SLICE L-26 ────────────────────────────────────────────────────────
    // From here down, each SECONDARY reader is wrapped in `withRenderBudget`.
    //
    // WHY ONLY THE SECONDARY ONES: the first two entries above ARE this page.
    // An orders board with no orders and no counts is not a degraded board,
    // it is a lie — it would show "no orders" to a shop that has orders,
    // which on a screen with a fifteen-minute acknowledgement clock is worse
    // than an error. Those two are allowed to fail loudly. Everything below
    // is a side panel whose absence the page already renders gracefully.
    //
    // WHY AT ALL, GIVEN THE FLOOR: `db-floor.ts` caps each PostgREST request
    // at 15s, and that is the primary fix. But this page's spinner is the
    // Leafly acknowledge button — Next.js documents that a redirecting action
    // does not answer the browser until the destination has rendered ("the
    // mutation, the cache invalidation, and the page re-render all complete
    // in a single roundtrip"). So this render's worst case IS the button's
    // worst case, and several readers here are internally sequential:
    // `loadLeaflyOrderSetupState` alone awaits two full Promise.all passes.
    // Capping each request does not cap their sum. This does.
    withRenderBudget(listPoolNamesStatus(), { names: [], migrationReady: false }, "order name pool"),
    withRenderBudget(getPrinterSettings(), null, "printer settings"),
    // SLICE L-6: both are non-throwing by construction and report their own
    // failures, so a Leafly or migration problem degrades the Leafly panel
    // rather than 500-ing the screen the shop runs its own orders on. They join
    // the existing Promise.all so the Leafly read costs no extra round trip.
    withRenderBudget(
      loadLeaflyOrderBoard(),
      {
        orders: [],
        ready: false,
        orderIntegrationKeyPresent: false,
        // Not an empty string. An empty `problem` means "the read succeeded
        // and there is genuinely nothing here", and the panel renders a
        // calm "no Leafly orders yet". Saying that when we simply stopped
        // waiting would hide a live order from a shop that has fifteen
        // minutes to acknowledge it — the single most expensive wrong
        // sentence this page can produce.
        // Worded WITHOUT the promotion banner's sentence on purpose. The
        // L-22 rule is that the "waiting to be acknowledged" phrasing and the
        // deadline belong to `orders-board-order-core`, which owns the
        // singular/plural and the minutes and asserts both; a second copy
        // here would drift from the rule the moment the core changed.
        // Enforced by tests/compliance/orders-board-order.test.ts.
        problem:
          "Leafly orders took too long to load, so this panel is showing nothing. " +
          "Refresh to try again — anything live is still on the clock.",
      },
      "leafly board",
    ),
    // `null` is this reader's documented "couldn't check" value — it returns
    // null rather than 0 precisely so a failed read is never mistaken for
    // "nothing needs acknowledging". Reusing it here keeps the timeout
    // indistinguishable from any other failure, which is correct: the panel
    // already knows how to say "couldn't check".
    withRenderBudget(countLeaflyOrdersAwaitingAck(), null, "leafly pending-ack count"),
    // SLICE M-2: why a placed Leafly order produced no record, no receipt and
    // no sound. Joins the same Promise.all for the same reason as the two
    // above, and is non-throwing by construction — a failure degrades to
    // "couldn't check" inside the panel rather than 500-ing this page.
    withRenderBudget(
      loadLeaflyOrderSetupState(),
      emptyLeaflyOrderSetupState(
        "The Leafly setup checks took too long to run, so this panel could not " +
          "be filled in. Nothing here means anything is wrong with your setup — " +
          "refresh to check again.",
      ),
      "leafly setup state",
    ),
    // SLICE L-21: the announcer's own verdict, needed HERE and not only in the
    // panel, because the panel moved to the setup tab and "orders are arriving
    // silently" is not allowed to move with it. This is the cached reader, so
    // when the setup tab renders the panel as well the database is read once.
    // It is non-throwing by construction (every reader degrades to an empty
    // state), so it cannot 500 the screen the shop runs its orders on.
    withRenderBudget(
      getAnnouncerPanelDataCached(),
      emptyAnnouncerPanelData(),
      "announcer panel",
    ),
  ]);
  // SLICE L-14 — cancellation interrupts for the orders the board just loaded.
  //
  // NOT part of the Promise.all above, and deliberately so: this takes the ids
  // the board ACTUALLY returned rather than re-deriving them with a second
  // query. Re-deriving would let the two disagree about which orders are on
  // screen, and a mismatch there shows one order’s cancellation on another
  // order’s card. One sequential round trip — indexed, capped, and skipped
  // entirely when the board is empty — is the cheaper side of that trade.
  //
  // No try/catch: listInterruptsForOrders never throws and reports its own
  // failure in `problem`. Wrapping it would imply a failure mode that cannot
  // happen and invite someone to swallow a real one.
  //
  // SLICE L-26 — budgeted, and this one matters more than most: it is
  // SEQUENTIAL, so its time is added to the Promise.all above rather than
  // overlapped with it. It is the last thing between an acknowledged order
  // and the operator seeing a page again.
  const leaflyInterrupts: BoardInterrupts =
    leaflyBoard.orders.length > 0
      ? await withRenderBudget(
          listInterruptsForOrders(
            leaflyBoard.orders.map((o) => o.local_order_id ?? ""),
          ),
          // `degraded: true` with a plain-English `problem`, NOT a silent
          // empty map. An empty map renders as "no order was cancelled",
          // which is a claim; this reader exists to surface cancellations,
          // and inventing a confident "none" from a read we abandoned is
          // precisely the class of lie the rest of this page avoids.
          {
            byOrderId: new Map(),
            degraded: true,
            problem:
              "Cancellation notices took too long to load, so any that exist " +
              "aren’t shown on these cards. Refresh to check.",
          },
          "leafly register interrupts",
        )
      : { byOrderId: new Map(), degraded: false, problem: "" };
  let { rows: orders, total } = firstPage;
  const win = listWindow(total, rawPage, DEFAULT_PAGE_SIZE);
  if (win.page !== rawPage && total > 0) {
    ({ rows: orders, total } = await listOrdersPaged({
      ...queryFilter,
      from: win.from,
      to: win.to,
    }));
  }
  /** Current filter state as URL params (page excluded — added per link). */
  const filterParams = () => {
    const params = new URLSearchParams();
    if (status !== "active") params.set("status", status);
    if (search) params.set("q", search);
    if (sort.key !== ORDER_SORTS[0].key) params.set("sort", sort.key);
    if (placedFrom) params.set("from", placedFrom);
    if (placedToDate) params.set("to", placedToDate);
    if (totalMin != null && sp.min) params.set("min", sp.min);
    if (totalMax != null && sp.max) params.set("max", sp.max);
    return params;
  };
  const pageHref = (p: number) => {
    const params = filterParams();
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };
  /** Status-chip links carry every OTHER filter and reset to page 1. */
  const statusHref = (key: string) => {
    const params = filterParams();
    params.delete("status");
    if (key !== "active") params.set("status", key);
    const qs = params.toString();
    return `/admin/orders${qs ? `?${qs}` : ""}`;
  };
  const hasExtraFilters = Boolean(
    placedFrom || placedToDate || totalMin != null || totalMax != null || sort.key !== ORDER_SORTS[0].key,
  );

  const activeCount = counts.new + counts.acknowledged + counts.preparing + counts.ready;

  // SLICE 113 — printer heartbeat + auto-print status for the at-a-glance chip.
  const printerConfigured = Boolean(printerSettings?.poll_token);
  const printerOnline = isPrinterOnline(printerSettings?.last_poll_at ?? null);
  const autoPrintOn = Boolean(printerSettings?.auto_print_orders);
  const printerLabel = printerSettings?.printer_label?.trim() || "Receipt printer";
  // Only nag when it actually matters: live orders waiting AND the printer is
  // configured for auto-print but hasn't checked in.
  const printerNeedsAttention = printerConfigured && autoPrintOn && !printerOnline && activeCount > 0;
  const printTestQueued = sp.printTest === "1";

  // ── SLICE L-21 — THE SETUP TAB ────────────────────────────────────────────
  // The owner asked for the four equipment/configuration panels to move to
  // their own tab, in a specific order. They did. But a tab is a place things
  // go to be forgotten, and two of those panels carry LIVE warnings that were
  // previously impossible to miss because they were bolted to the top of this
  // page. Moving them wholesale would make the shop quieter while appearing to
  // tidy it up.
  //
  // So: the PANEL moves, the ALARM does not. The pure core decides which
  // conditions are urgent enough to stay on the orders board, and it owns that
  // judgement so no screen can disagree with it. See orders-tabs-core.ts.
  const tab = resolveOrdersTab(sp.tab);
  const tabInput = {
    printerNeedsAttention,
    // "Will I hear the next order?" is the announcer's own verdict, read from
    // the same store the panel reads. Re-deriving it here from device rows
    // would be a second opinion that can drift from the first — house rule 11.
    // A never-installed announcer is a setup state, not a silent shop: it has
    // never made a noise and nobody is expecting one. Only an INSTALLED
    // announcer that will not announce is an alarm.
    announcerSilent: !announcerData.notInstalled && !announcerData.verdict.willAnnounce,
    activeCount,
    // The SAME expression the setup panel uses for its step count
    // (LeaflyOrderSetupPanel.tsx:184), so the dot on the tab and the badge on
    // the bar can never disagree about how many steps are left.
    leaflyBlockingSteps: leaflySetup.readiness.steps.filter((s) => !s.done && s.blocking).length,
    leaflyEverReceived: leaflySetup.readiness.anyOrderEverReceived,
  };
  const orderBoardSignals = urgentSignals(tabInput);
  const setupNeedsAttention = setupTabNeedsAttention(tabInput);

  // ── SLICE L-22 — WHAT GOES FIRST, AND WHO GETS A LABEL ────────────────────
  //
  // The owner worked this screen for real and asked for his own orders first,
  // with Leafly below and a combined history carrying origin labels. Both of
  // those reverse a decision an earlier slice made for a stated reason, so
  // neither is simply overwritten here: the pure core makes each one
  // CONDITIONAL on a fact, which is how the owner gets the layout he asked for
  // without losing what the earlier reasoning was buying.
  //
  //   - L-6 put Leafly on top because of the 15-minute auto-cancel clock. That
  //     clock is real, but it is only running when an order is actually
  //     unacknowledged. decideBoardLayout() keeps the owner's order the normal
  //     case and promotes Leafly only while the deadline is live — visibly,
  //     with the reason printed on screen.
  //   - L-12 hid the "Website" badge because forty identical badges train the
  //     eye to skip the column. Still true for a shop that never sees a Leafly
  //     order; wrong for one that does, where an unlabelled row is identified
  //     only by the ABSENCE of a badge. shouldLabelWebsiteRows() decides.
  const boardLayout = decideBoardLayout({ leaflyPendingAck });
  // Shop-level and therefore stable across pages and filters. Deliberately NOT
  // derived from the rows on screen: page 1 could be mixed and page 2 all
  // website, and a table that changes its labelling convention as you page
  // through it is worse than either convention. `anyOrderEverReceived` is
  // already loaded — echoed, not re-derived (house rule 11) — so this costs no
  // extra query. The core keeps a safety valve for the case where the flag is
  // false but a Leafly row is visibly on screen anyway.
  const labelWebsiteRows = shouldLabelWebsiteRows({
    shopReceivesLeaflyOrders: leaflySetup.readiness.anyOrderEverReceived,
    originsOnScreen: orders.map((o) => o.origin),
  });
  // The mix summary describes THIS PAGE only, and says so in words the core
  // owns and asserts, because the alternative reading — that these are the
  // shop's totals — is the one a reader will reach for first.
  const originMix = describeOriginMix(
    tallyOrigins(orders.map((o) => o.origin)),
    orderOriginLabel,
  );

  // SLICE L-19 — computed here, on the server, from the same single predicate
  // the setup checklist uses (setup-status.ts). Two readers, one answer: the
  // bug this replaces was the checklist saying "email is configured" while the
  // notifier silently sent nothing, because they asked different questions.
  const emailReadiness = assessEmailReadiness({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ORDER_EMAIL_FROM: process.env.ORDER_EMAIL_FROM,
    ORDER_STAFF_EMAILS: process.env.ORDER_STAFF_EMAILS,
  });

  // ── SLICE L-22 — THE TWO BOARDS, DEFINED ONCE EACH ──────────────────────
  //
  // Each board is built into exactly ONE const and then rendered from the
  // order the pure core returned. The alternative — writing each board twice
  // under opposite conditions — is how a page ends up showing the same Leafly
  // order twice, with two Acknowledge buttons, one of which is stale. There is
  // one copy of each, so that cannot happen, and a test asserts the count.
  const leaflySection = (
    <>
    {/* SLICE L-6 — LEAFLY ORDERS.  (position revised by L-22, see below)

        L-6 pinned this block directly under the status summary and ABOVE
        Greenway's own order cards, and said why: a Leafly order is the only
        order in the building with a hard external deadline — Leafly
        auto-cancels anything not acknowledged within fifteen minutes — so it
        was the first thing on the page that could cost a real customer their
        order.

        That is still the reason the block can be promoted, but it is no
        longer the reason it is WHERE it is. The owner worked this screen for
        real and found the absolute version wrong in the ordinary case: nearly
        every order is a Greenway order, so the emergency layout was slightly
        wrong all day in exchange for being right occasionally. L-22 therefore
        hands the position to decideBoardLayout(), which keeps the owner's
        order normally and promotes this block only while an acknowledgement
        is actually outstanding.

        This comment is kept rather than deleted because the deadline reasoning
        is still load-bearing — anyone who removes the promotion needs to know
        what it was protecting.

        It renders NOTHING when Leafly order handling has never been set up
        and nothing has arrived, so the page is unchanged for a shop not
        using it. It never hides a failure. */}
    {/* SLICE L-21 — THE M-2 FIX, PRESERVED ACROSS THE MOVE.

        The full setup panel now lives on the setup tab. That move had one
        dangerous side effect: M-2 was the report "there is nothing in the
        online orders dashboard page that has a Leafly orders section", and
        the fix for it was precisely this panel, rendered here, explaining
        why the board below is blank. Moving it away without replacement
        would have handed that bug straight back.

        So when — and only when — the board will render nothing at all,
        the orders tab keeps a single line saying so and pointing at the
        tab that can fix it. The condition is the board's OWN predicate,
        imported rather than re-typed, so the two cannot drift.

        When the board does render, this disappears entirely: an explained
        blank space is useful, a note above a working board is clutter. */}
    {leaflyBoardRendersNothing({
      hasOrders: leaflyBoard.orders.length > 0,
      hasProblem: leaflyBoard.problem.trim().length > 0,
      hasOutcome: Boolean(sp.leaflyMsg || sp.leaflyWarn || sp.leaflyErr),
      orderIntegrationKeyPresent: leaflyBoard.orderIntegrationKeyPresent,
    }) ? (
      <div className="mb-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3 text-sm text-[var(--admin-text-muted)]">
        Leafly orders are not set up yet, so there is no Leafly section
        below.{" "}
        <Link
          href={ordersTabHref("setup")}
          className="font-bold text-[var(--admin-accent)] underline underline-offset-2"
        >
          Finish setup in Setup &amp; equipment →
        </Link>
      </div>
    ) : null}

    <LeaflyOrdersPanel
      board={leaflyBoard}
      pendingAckCount={leaflyPendingAck}
      // SLICE L-28 — the chosen view, validated by the pure core. Garbage in
      // the URL becomes the default view, never an empty screen.
      filter={parseBoardFilter(sp.lfilter)}
      sort={parseBoardSort(sp.lsort)}
      search={parseBoardSearch(sp.lq)}
      interrupts={leaflyInterrupts}
      // The clock is read ONCE here and injected, so every countdown on the
      // page is measured from the same instant. Reading the time inside the
      // component per order would let two rows disagree about what time it
      // is; the pure core takes `now` as a parameter precisely so this is a
      // decision made in one visible place.
      now={new Date()}
      message={sp.leaflyMsg ?? sp.leaflyWarn ?? null}
      error={sp.leaflyErr ?? null}
      errorCode={sp.leaflyFix ?? sp.leaflyCode ?? null}
    />
    </>
  );

  const greenwaySection = (
    <>
    {/* Filters + search (SLICE 26: full control — status, search, date
        range, total range, and sort, all URL-driven and combinable). */}
    <form method="get" className="mt-6 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={statusHref(f.key)}
            className={`admin-focus rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
              status === f.key
                ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] text-black"
                : "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="status" value={status} />
        <div className="min-w-52 flex-1">
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Search
          </label>
          <Input name="q" defaultValue={search} placeholder="Name, phone, order #" />
        </div>
        <div>
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Placed from
          </label>
          <Input type="date" name="from" defaultValue={placedFrom ?? ""} className="w-40" />
        </div>
        <div>
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Placed to
          </label>
          <Input type="date" name="to" defaultValue={placedToDate ?? ""} className="w-40" />
        </div>
        <div>
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Total min $
          </label>
          <Input name="min" defaultValue={sp.min ?? ""} placeholder="0.00" inputMode="decimal" className="w-24" />
        </div>
        <div>
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Total max $
          </label>
          <Input name="max" defaultValue={sp.max ?? ""} placeholder="0.00" inputMode="decimal" className="w-24" />
        </div>
        <div>
          <label className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Sort by
          </label>
          <Select name="sort" defaultValue={sort.key} aria-label="Sort orders">
            {ORDER_SORTS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="neutral">
          Apply
        </Button>
        {(search || hasExtraFilters) && (
          <Link
            href={status !== "active" ? `/admin/orders?status=${status}` : "/admin/orders"}
            className="pb-2 text-xs text-[var(--admin-text-faint)] underline-offset-2 hover:text-[var(--admin-text)] hover:underline"
          >
            Clear
          </Link>
        )}
      </div>
    </form>

    {/* GW-033: exact count + pager — a clipped list is never silent. */}
    <div className="mt-4">
      <ListPager window={win} total={total} noun="order" makeHref={pageHref} />
    </div>

    {/* SLICE L-22 — WHAT THIS COMBINED LIST IS MADE OF.

        The owner asked for a combined history with origin labels. The list
        was ALREADY combined — listOrdersPaged selects from `orders` with no
        origin filter, and Leafly orders are written into that same table —
        so what was missing was the ability to SEE the mix without reading
        forty badges one at a time.

        The sentence itself comes from the core, which owns the one claim
        here that is easy to get wrong: these are the rows on THIS page,
        after the current filters, not the shop's totals. It renders nothing
        at all when every row on the page came from the same place, because
        then the count is just the row count again and the pager above
        already showed that. */}
    {originMix ? (
      <p className="mt-2 text-xs font-semibold text-[var(--admin-text-muted)]">
        {originMix}
      </p>
    ) : null}

    {/* Order cards */}
    {orders.length === 0 ? (
      <div className="mt-8">
        <EmptyState
          icon="🧾"
          title="No orders match this view"
          description="When customers place pickup orders online, they'll show up here automatically — newest first."
        />
      </div>
    ) : (
      <div className="mt-5 grid gap-3">
        {orders.map((order) => {
          const next = ORDER_FORWARD_TRANSITIONS[order.status];
          return (
            <Card key={order.id} padding="sm" className="sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={detailHref(order.id)}
                      className="text-lg font-black text-[var(--admin-text)] hover:text-[var(--admin-accent)]"
                    >
                      {resolveOrderDisplay(order.display_name, order.order_number)}
                    </Link>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[0.65rem] font-black uppercase tracking-[0.1em] ${STATUS_STYLES[order.status]}`}
                    >
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                    {/* SLICE L-12 hid the "Website" badge unconditionally,
                        because badging all forty rows trains the eye to
                        skip the column and takes the Leafly badge with
                        it. SLICE L-22 keeps that for a shop that has
                        never had a Leafly order, and drops it for one
                        that has: in a genuinely mixed list, an unbadged
                        row is identified only by the ABSENCE of a badge,
                        which is indistinguishable from a badge that
                        failed to render. Label everything, or label
                        nothing — never half. The core decides, once, for
                        the whole list. */}
                    <OrderOriginBadge origin={order.origin} hideWebsite={!labelWebsiteRows} />
                  </div>
                  {order.display_name && order.display_name.trim() ? (
                    <p className="mt-0.5 font-mono text-xs text-[var(--admin-text-faint)]">
                      #{order.order_number}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
                    {order.customer_first_name}
                    {order.customer_last_name ? ` ${order.customer_last_name}` : ""}
                    {order.customer_phone ? ` · ${order.customer_phone}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">
                    {order.item_count} item{order.item_count === 1 ? "" : "s"} ·{" "}
                    {formatMinorCurrency(order.total_minor_units)} · placed {timeAgo(order.placed_at)}
                  </p>
                  <div className="mt-3">
                    <OrderStatusFlow status={order.status} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {next ? (
                    <form action={setOrderStatusAction}>
                      <input type="hidden" name="id" value={order.id} />
                      <input type="hidden" name="status" value={next} />
                      <Button type="submit" variant="primary" size="sm">
                        Mark {ORDER_STATUS_LABELS[next]}
                      </Button>
                    </form>
                  ) : null}
                  <Button href={detailHref(order.id)} variant="neutral" size="sm">
                    Details
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    )}

    {/* Bottom pager (long lists — save the scroll back up). */}
    {win.totalPages > 1 && (
      <div className="mt-5">
        <ListPager window={win} total={total} noun="order" makeHref={pageHref} />
      </div>
    )}
    </>
  );

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        subtitle="Live pickup orders — acknowledge, prepare, and complete from any device."
        breadcrumbs={<Breadcrumbs items={[{ label: "Orders" }]} />}
        help={
          <HelpPanel
            id="orders"
            title="How to handle orders"
            steps={[
              "New online orders appear here automatically.",
              "Open an order to see the items and customer info.",
              "Move it through the stages as you prepare it.",
              "Print the ticket if you need a paper copy.",
            ]}
          >
            <p>
              The big touch-friendly cards work on a phone or tablet at the
              counter. Each order&apos;s status flow shows exactly where it is.
            </p>
            {/* SLICE B. Leafly orders behave differently from website orders in
                one way that matters enormously: they carry a countdown, and
                acknowledging one permanently ends our access to the shopper's
                ID images. That is explained in full in the handbook rather
                than compressed into this panel, where it would be either too
                long to read or too short to be true. */}
            <p>
              Leafly orders work differently &mdash; they arrive with a deadline, and
              one of the buttons cannot be undone.{" "}
              <Link
                href="/admin/integrations/leafly/help"
                className="text-[var(--admin-accent)] underline"
              >
                Read the Leafly handbook
              </Link>{" "}
              before you handle your first one.
            </p>
          </HelpPanel>
        }
      />


      {/* ── SLICE L-21 ─ TABS ──────────────────────────────────────────
          Four equipment/configuration panels used to sit between the owner and
          the thing he opened this page for. They now live on their own tab, in
          the order he asked for: printer, name pool, announcer, Leafly setup.

          The dot on the setup tab is what pays for them having moved out of
          sight — it appears whenever there is anything worth knowing back
          there, so the tab can be ignored safely the rest of the time.

          Same pattern as /admin/equipment (equipment/page.tsx:116-138), on
          purpose: two tab bars in the same back office that behave differently
          is two things to learn instead of one. */}
      <div className="border-b border-[var(--admin-border)] px-5 pt-1 sm:px-8">
        <nav className="-mb-px flex gap-1" aria-label="Orders tabs">
          <Link
            href={ordersTabHref("orders")}
            aria-current={tab === "orders" ? "page" : undefined}
            className={`rounded-t-[var(--admin-radius)] border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === "orders"
                ? "border-[var(--admin-accent)] text-[var(--admin-accent)]"
                : "border-transparent text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
            }`}
          >
            Orders
          </Link>
          <Link
            href={ordersTabHref("setup")}
            aria-current={tab === "setup" ? "page" : undefined}
            className={`flex items-center gap-2 rounded-t-[var(--admin-radius)] border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === "setup"
                ? "border-[var(--admin-accent)] text-[var(--admin-accent)]"
                : "border-transparent text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"
            }`}
          >
            <span aria-hidden>⚙️</span> Setup &amp; equipment
            {/* A dot, not a number. The count is on the panels themselves; out
                here all that is needed is "there is something back there".
                aria-label carries it for a screen reader, because a coloured
                dot with no text is invisible to one. */}
            {setupNeedsAttention ? (
              <span
                className="inline-block h-2 w-2 rounded-full bg-[var(--admin-gold)]"
                aria-label="Needs attention"
              />
            ) : null}
          </Link>
        </nav>
      </div>

      {tab === "setup" ? (
        <div className="px-5 py-6 sm:px-8">
          {/* The owner asked for this exact order: receipt printer status bar,
              then the order name pool, then the announcer, with the Leafly
              setup panel at the bottom. It runs most-operational to
              most-one-off, which is also the order they are needed in. */}
          {/* SLICE 113 — Receipt-printer status at a glance + one-tap test print.
              Lives here so whoever is working the orders queue can confirm the
              printer is alive without leaving the page. */}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  !printerConfigured
                    ? "bg-[var(--admin-text-faint)]"
                    : printerOnline
                      ? "bg-[var(--admin-accent)]"
                      : "bg-[var(--admin-danger)]"
                }`}
                aria-hidden
              />
              <span className="text-sm font-bold text-[var(--admin-text)]">
                🖨️ {printerLabel}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] ${
                  !printerConfigured
                    ? "border-[var(--admin-border-strong)] bg-white/5 text-[var(--admin-text-muted)]"
                    : printerOnline
                      ? "border-[var(--admin-accent)]/60 bg-[var(--admin-accent)]/15 text-[var(--admin-accent)]"
                      : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] text-[var(--admin-danger)]"
                }`}
              >
                {!printerConfigured ? "Not set up" : printerOnline ? "Connected" : "Not seen recently"}
              </span>
              {printerConfigured ? (
                <span className="text-xs text-[var(--admin-text-muted)]">
                  Auto-print {autoPrintOn ? "on" : "off"}
                </span>
              ) : null}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <form action={testPrintFromOrdersAction}>
                <Button type="submit" variant="neutral" size="sm">
                  Send test print
                </Button>
              </form>
              <Link
                href="/admin/equipment?tab=printer"
                className="admin-focus rounded-lg border border-[var(--admin-border-strong)] bg-white/5 px-3 py-1.5 text-xs font-bold text-[var(--admin-text-muted)] transition hover:text-[var(--admin-text)]"
              >
                Printer settings →
              </Link>
            </div>
          </div>

          {printTestQueued ? (
            <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
              ✅ Test print queued. If the printer is on and connected it should print within a few seconds.
            </div>
          ) : null}

          {printerNeedsAttention ? (
            <div className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]">
              ⚠️ You have {activeCount} active order{activeCount === 1 ? "" : "s"} and auto-print is on, but
              the printer hasn’t checked in for a while. Receipts may not be printing — check that it’s
              powered on and connected, then send a test print.
            </div>
          ) : null}

          {/* SLICE 113 — Order-name pool manager (fun recycling names for online
              orders). Fallback-safe: shows a gentle "finish setup" note until
              migration 0147 is applied. */}
          <div className="mt-4">
            <OrderNamePoolManager
              names={poolStatus.names}
              migrationReady={poolStatus.migrationReady}
              message={sp.poolMsg ?? null}
              error={sp.poolErr ?? null}
            />
          </div>

          {/* SLICE 30 — the Raspberry Pi speakers in the office, sales floor
              and storage. SLICE L-21 moved it here, third, exactly where the
              owner asked for it, and made it collapsible.

              It is collapsed when the shop is healthy and OPEN when the next
              order would not be heard — see announcerStartsOpen(). The
              speaker count rides on the closed bar either way, so "will I hear
              the next order?" is still answerable without a click.

              The matching alarm stays on the orders tab. A panel may move; an
              alarm may not. */}
          <AnnouncerPanel />

          {/* SLICE M-2 — LEAFLY ORDER SETUP / "WHERE DID MY ORDER GO".

              Rendered ABOVE the orders board, and only when there is something
              to say: `showPanel` is true once any setup progress exists or any
              order has ever arrived, so a shop that has never touched Leafly
              orders sees this page exactly as it did before.

              It is shown even when everything is ready, in `compact` form — the
              two optional steps it tracks (speaker, printer) are precisely the
              ones that let an order arrive SILENTLY, and a silent arrival is
              worse than no arrival: the order is real, the 15-minute
              auto-cancel clock is running, and nobody in the building has been
              told. The compact form drops the explanatory paragraph and keeps
              the evidence and the checklist.

              SLICE L-21: it sits LAST on this tab, and it is the only panel
              here that is not day-to-day equipment — it is a one-off job that
              ends. It is also the reason the orders tab now carries a one-line
              pointer when the Leafly board is empty: the blank space still has
              to be explained on the tab where the blank space is. */}
          {leaflySetup.readiness.showPanel ? (
            <LeaflyOrderSetupPanel setup={leaflySetup} compact={leaflySetup.readiness.ready} />
          ) : null}
        </div>
      ) : (
      <div className="px-5 py-6 sm:px-8">
        {/* SLICE L-19 — "the customer never got a confirmation email."
            It was not Leafly and it was not a broken send: the email provider
            was not configured, so notify.ts skipped both emails and said
            nothing. This banner is the "said nothing" half of that bug. It
            renders NOTHING when email is configured, and nothing for a Leafly
            order, so it cannot become furniture. First thing on the page,
            above even the new-order watcher, because if this is showing then
            this page is the only notification anyone is getting. */}
        <EmailReadinessBanner readiness={emailReadiness} />

        {/* New-order watcher (polls + chimes when new orders arrive) */}
        <NewOrderAlert />

        {/* ── SLICE L-21 ─ THE ALARMS THAT MAY NOT BE HIDDEN ─────────────────
            The printer bar and the announcer panel moved to the setup tab, and
            both of them carried a LIVE warning that was previously impossible
            to miss because it was bolted to the top of this page:

              "auto-print is on, you have live orders, and the printer has not
               checked in" — receipts are silently not printing, right now.
              "no speaker is online" — orders are arriving in silence.

            Moving those behind a tab would have made the shop QUIETER while
            appearing to tidy it up. So the panel moved and the alarm did not.

            `urgentSignals()` decides what qualifies, not this file. Unfinished
            Leafly SETUP deliberately does NOT qualify, however many steps are
            outstanding: nothing is failing, and nagging about it on every page
            load is how a shop learns to ignore this strip — taking the two
            real alarms with it. It gets the dot on the tab instead.

            This renders NOTHING when the shop is healthy, so it cannot become
            furniture. */}
        {orderBoardSignals.length > 0 ? (
          <div className="mb-4 space-y-2">
            {orderBoardSignals.map((signal) => (
              <div
                key={signal.id}
                className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] px-4 py-3 text-sm text-[var(--admin-danger)]"
              >
                <p className="font-bold">⚠️ {signal.message}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span>{signal.action}</span>
                  <Link
                    href={ordersTabHref("setup")}
                    className="font-bold underline underline-offset-2"
                  >
                    Open setup &amp; equipment →
                  </Link>
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {/* Status summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="New" value={counts.new} accent="orange" hint="Awaiting acknowledgement" icon="🔔" />
          <StatCard label="Preparing" value={counts.preparing} accent="green" icon="📦" />
          <StatCard label="Ready" value={counts.ready} accent="green" hint="Waiting for pickup" icon="✅" />
          <StatCard label="Active total" value={activeCount} icon="🧾" />
        </div>

        {/* ── SLICE L-22 — THE OWNER'S ORDER, AND WHEN IT BENDS ─────────────

            He asked for his own orders first and Leafly below, and that is now
            the normal case. The one exception is a Leafly order sitting
            unacknowledged: Leafly cancels it automatically after fifteen
            minutes, and that clock is a fact about the world rather than a
            preference this page gets to hold an opinion about.

            When that happens the Leafly board moves to the top AND says so, in
            the banner below. A layout that rearranges itself silently is
            indistinguishable from a bug, and teaches the reader to distrust
            the next rearrangement — including the one that mattered. */}
        {boardLayout.leaflyPromoted ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-3 text-sm font-semibold text-[var(--admin-gold)]"
            role="status"
          >
            <span aria-hidden>⏱️</span>
            {/* The sentence comes from the core, which owns the singular/plural
                and the mention of the deadline, so the explanation cannot drift
                away from the rule that caused it. */}
            <span>{boardLayout.reason}</span>
          </div>
        ) : null}

        {boardLayout.sections.map((section) => (
          <Fragment key={section}>
            {section === "leafly" ? leaflySection : greenwaySection}
          </Fragment>
        ))}
      </div>
      )}
    </div>
  );
}
