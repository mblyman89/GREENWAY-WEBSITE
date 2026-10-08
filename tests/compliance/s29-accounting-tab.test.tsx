/**
 * tests/compliance/s29-accounting-tab.test.tsx  (S29)
 *
 * The Accounting tab on the Manifest page ("accounting goes quiet — the wire
 * stays, the noise moves", bible S19.4 / S29), proven six ways:
 *   1. the pure manifest-event-labels-core self-tests (pinned count) run here
 *      AND in run-pure-selftests;
 *   2. every event_type literal any writer puts into manifest_events has a
 *      human label — a new event without one fails CI (bible S29.5);
 *   3. D-R2-3 is locked: Accounts Payable stays in Product Intake on
 *      payables.manage (manager included) and no Product Intake item points
 *      into the owner-only books;
 *   4. the receiving wire now writes receipt_posted / receipt_refused to the
 *      durable timeline, in BOTH the answer path and the throw path, driven
 *      through the real server action with mocks (bible S29.5 "mock admin
 *      client" — here the store seam) — and the URL behaviour is unchanged;
 *   5. the Accounting tab resolves on booksError only, renders the stored
 *      refusal with NO URL param, and gates books links on books.view;
 *   6. the timeline renders labels, groups, collapses Books, never truncates.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __runManifestEventLabelsCoreTests,
  isKnownEventType,
  labelForEvent,
  receiptEventFor,
} from "@/lib/inventory/manifest-event-labels-core";
import { resolveTab } from "@/lib/admin/page-tabs-core";
import { MANIFEST_PAGE_TABS } from "@/lib/admin/page-tab-sets";
import { manifestHeldAutoOpen } from "@/lib/admin/issues-core";
import { ManifestTimeline } from "@/components/admin/inventory/ManifestTimeline";
import { ManifestAccountingPanel } from "@/components/admin/inventory/ManifestAccountingPanel";
import { adminNav } from "@/components/admin/admin-nav-data";
import { ALL_ROLES, can } from "@/lib/auth/roles";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MANIFEST = "src/app/admin/inventory/intake/[id]/page.tsx";
const ACTIONS = "src/app/admin/inventory/intake/actions.ts";
const PANEL = "src/components/admin/inventory/ManifestAccountingPanel.tsx";
const TIMELINE = "src/components/admin/inventory/ManifestTimeline.tsx";
const NAV = "src/components/admin/admin-nav-data.ts";

// ── 4. the action, driven for real (mocks hoisted by vitest) ────────────────
const st = vi.hoisted(() => ({
  calls: [] as string[],
  events: [] as Array<{ id: string; type: string; note: string | null; actor: string | null }>,
  lifecycleOk: true,
  receipt: null as null | { ok: boolean; code: string; message: string } | "throw",
  throwMsg: "socket hang up",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => st.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    st.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    st.calls.push(`perm:${p}`);
    return { userId: "u-manager", email: "m@x", profile: { role: "manager" } };
  },
}));
vi.mock("@/lib/inventory/intake-store", () => ({
  setManifestLifecycle: async () => (st.lifecycleOk ? { ok: true } : { ok: false, error: "db" }),
  logManifestEvent: async (manifestId: string, type: string, note: string | null, actor: string | null) => {
    st.events.push({ id: manifestId, type, note, actor });
  },
  stageManifest: vi.fn(),
  rejectManifest: vi.fn(),
  setLotDisposition: vi.fn(),
  finalizeManifestDispositions: vi.fn(),
  gatherSampleCapNotice: vi.fn(),
  setManifestInvoiceOverride: vi.fn(),
}));
vi.mock("@/lib/accounting/receipt-service", () => ({
  postManifestReceipt: async () => {
    if (st.receipt === "throw") throw new Error(st.throwMsg);
    return st.receipt;
  },
}));
vi.mock("@/lib/reports/timezone", () => ({ pacificParts: () => ({ year: 2026, month: 3, day: 7 }) }));
vi.mock("@/lib/compliance/sample-cap-notify", () => ({ sendSampleCapVendorNotice: vi.fn() }));
vi.mock("@/lib/inventory/transfer-fetch", () => ({ fetchTransferJson: vi.fn() }));
vi.mock("@/lib/inventory/pdf-extract", () => ({ parsePdfManifest: vi.fn() }));
vi.mock("@/lib/inbound-email/llamaparse-recovery", () => ({ makeCapturingRecovery: vi.fn() }));
vi.mock("@/lib/inbound-email/llamaparse-status-server", () => ({ recordManifestParseStatus: vi.fn() }));

const M = "m-1";
async function markReceived(): Promise<string> {
  const { setManifestLifecycleAction } = await import("@/app/admin/inventory/intake/actions");
  await expect(setManifestLifecycleAction(M, "received")).rejects.toThrow("NEXT_REDIRECT");
  return st.calls.filter((c) => c.startsWith("redirect:")).at(-1) ?? "";
}

beforeEach(() => {
  st.calls = [];
  st.events = [];
  st.lifecycleOk = true;
  st.receipt = null;
  st.throwMsg = "socket hang up";
});

describe("1. manifest-event-labels-core self-tests", () => {
  it("pins the embedded self-test count (42) with zero failures", () => {
    // R26 pin update (on purpose): 49 -> 50 — one assertion added for the new
    // invoice_number_detected event label (migration 0245 writer).
    // R27 pin update (on purpose): 50 -> 51 - one assertion added for the
    // menu_published_some_withheld event label (per-product withhold).
    expect(__runManifestEventLabelsCoreTests()).toEqual({ passed: 51, failed: 0 });
  });
  it("is registered in run-pure-selftests (import AND run)", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toMatch(/import \{ __runManifestEventLabelsCoreTests \} from "\.\.\/\.\.\/src\/lib\/inventory\/manifest-event-labels-core"/);
    expect(runner).toMatch(/__runManifestEventLabelsCoreTests\(\)/);
  });
  it("the core is pure: no React, no next/*, no I/O, no process.env", () => {
    const src = read("src/lib/inventory/manifest-event-labels-core.ts");
    expect(src).not.toMatch(/from "react"|from "next\/|supabase|process\.env|fetch\(/);
  });
});

describe("2. every event a writer logs has a human label (bible S29.5)", () => {
  // Every file that writes manifest_events (grep `manifest_events` / logManifestEvent in src).
  const WRITERS = [
    "src/app/admin/inventory/intake/actions.ts",
    "src/lib/inventory/intake-store.ts",
    "src/lib/inventory/po-link-store.ts",
    "src/lib/pos/import-service.ts",
    "src/lib/pos/intake-menu-staging.ts",
    "src/lib/inventory/vendor-goldminer-store.ts",
    "src/lib/inventory/manifest-kb-bridge.ts",
    "src/lib/inventory/kb-link-store.ts",
  ];
  const literalTypes = (src: string): string[] => {
    const out = new Set<string>();
    // logManifestEvent(id, "type", ...)
    for (const m of src.matchAll(/logManifestEvent\(\s*[\w.]+\s*,\s*"([a-z_]+)"/g)) out.add(m[1]);
    // logManifestEvent(id, ok ? "a" : "b", ...)
    for (const m of src.matchAll(/logManifestEvent\(\s*[\w.]+\s*,\s*[\w.]+\s*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)) {
      out.add(m[1]);
      out.add(m[2]);
    }
    // event_type: "type" (direct inserts)
    for (const m of src.matchAll(/event_type:\s*"([a-z_]+)"/g)) out.add(m[1]);
    // logEvent("type", ...) — intake-menu-staging's local helper
    for (const m of src.matchAll(/logEvent\(\s*"([a-z_]+)"/g)) out.add(m[1]);
    return [...out];
  };

  it("finds the literals it should (the grep itself is tested)", () => {
    const all = WRITERS.flatMap((f) => literalTypes(read(f)));
    for (const t of ["vendor_bill_posted", "vendor_bill_refused", "vendor_bill_skipped", "sample_cap_vendor_notified", "rejected", "vendor_link", "sample_cap_block", "draft_seed_error", "menu_auto_carry", "note", "transport", "invoice_number_override", "po_auto_receive", "po_link", "accepted", "menu_publish_held_for_fact_review", "menu_auto_publish_failed", "menu_auto_publish", "vendor_goldminer", "kb_writeback"]) {
      expect(all).toContain(t);
    }
  });

  it.each([
    "src/app/admin/inventory/intake/actions.ts",
    "src/lib/inventory/intake-store.ts",
    "src/lib/inventory/po-link-store.ts",
    "src/lib/pos/import-service.ts",
    "src/lib/pos/intake-menu-staging.ts",
    "src/lib/inventory/vendor-goldminer-store.ts",
    "src/lib/inventory/manifest-kb-bridge.ts",
    "src/lib/inventory/kb-link-store.ts",
  ])("%s: every literal event_type is labelled", (file) => {
    const missing = literalTypes(read(file)).filter((t) => !isKnownEventType(t));
    expect(missing).toEqual([]);
  });

  it("the named-constant writers are labelled too (constants read from their cores)", () => {
    const constant = (file: string, name: string) => {
      const m = read(file).match(new RegExp(`export const ${name} = "([a-z_]+)"`));
      expect(m, `${name} in ${file}`).not.toBeNull();
      return (m as RegExpMatchArray)[1];
    };
    const names = [
      constant("src/lib/inventory/cutover-guard-core.ts", "CUTOVER_EVENT"),
      constant("src/lib/pos/intake-menu-staging-core.ts", "CARRY_FORWARD_INCOMPLETE_EVENT"),
      constant("src/lib/inventory/identity-stamp-core.ts", "KB_LINK_EVENT"),
      constant("src/lib/inventory/identity-stamp-core.ts", "KB_WRITEBACK_ERROR_EVENT"),
      constant("src/lib/inventory/intake-checklist-core.ts", "KB_WRITEBACK_EVENT"),
    ];
    for (const n of names) expect(isKnownEventType(n), n).toBe(true);
  });

  it("the variable writers are labelled: lifecycle statuses, finalize outcomes, receipt events", () => {
    // setManifestLifecycle logs `status` ("in_transit" | "received");
    // finalize logs derivedStatus ("accepted" | "rejected" | "partially_accepted").
    const store = read("src/lib/inventory/intake-store.ts");
    expect(store).toMatch(/status: "in_transit" \| "received",/);
    expect(store).toMatch(/derivedStatus: "accepted" \| "rejected" \| "partially_accepted";/);
    for (const t of ["in_transit", "received", "accepted", "rejected", "partially_accepted", "receipt_posted", "receipt_refused"]) {
      expect(isKnownEventType(t), t).toBe(true);
    }
  });

  it("bible S29.4 label copy: vendor_bill_refused reads 'Books · vendor bill not posted'", () => {
    expect(labelForEvent("vendor_bill_refused").label).toBe("Books \u00b7 vendor bill not posted");
    expect(labelForEvent("vendor_bill_refused").group).toBe("accounting");
  });
});

describe("3. D-R2-3 lock: Accounts Payable stays in Product Intake for the manager", () => {
  it("the AP nav item is unchanged: href, group, permission", () => {
    const ap = adminNav.filter((i) => i.href === "/admin/vendor-payments");
    expect(ap).toHaveLength(1);
    expect(ap[0].group).toBe("Product Intake");
    expect(ap[0].permission).toBe("payables.manage");
    expect(ap[0].label).toBe("Accounts Payable");
  });
  it("the nav line carries the decision comment", () => {
    expect(read(NAV)).toMatch(/\/\/ Stays in Product Intake: owner decision D-R2-3 \(manager runs AP\)\n\s*\{ label: "Accounts Payable", href: "\/admin\/vendor-payments"/);
  });
  it("roles: manager has payables.manage; books.view is the owner alone", () => {
    expect(can("manager", "payables.manage")).toBe(true);
    expect(ALL_ROLES.filter((r) => can(r, "books.view"))).toEqual(["owner"]);
    expect(can("manager", "books.view")).toBe(false);
    // Everyone who can open the manifest page (inventory.manage) can open AP,
    // so the AP link on the Accounting tab never dead-ends.
    for (const r of ALL_ROLES) if (can(r, "inventory.manage")) expect(can(r, "payables.manage"), r).toBe(true);
  });
  it("no Product Intake item points into /admin/books", () => {
    const intake = adminNav.filter((i) => i.group === "Product Intake");
    expect(intake.length).toBeGreaterThan(3);
    expect(intake.filter((i) => i.href.startsWith("/admin/books"))).toEqual([]);
  });
});

describe("4. the receiving wire logs its answer to the timeline (action driven)", () => {
  it("ok answer → receipt_posted with CODE: message, URL books= unchanged", async () => {
    st.receipt = { ok: true, code: "RECEIPT_OK", message: "Delivery capitalised." };
    const url = await markReceived();
    expect(url).toBe(`redirect:/admin/inventory/intake/${M}?lifecycle=received&books=RECEIPT_OK`);
    expect(st.events).toEqual([{ id: M, type: "receipt_posted", note: "RECEIPT_OK: Delivery capitalised.", actor: "u-manager" }]);
  });
  it("refusal → receipt_refused, URL booksError= unchanged (300-char cap kept)", async () => {
    const long = "No category for lot L-9. ".repeat(20);
    st.receipt = { ok: false, code: "RECEIPT_CATEGORY_REFUSED", message: long };
    const url = await markReceived();
    expect(url).toBe(
      `redirect:/admin/inventory/intake/${M}?lifecycle=received&booksError=${encodeURIComponent(long.slice(0, 300))}`,
    );
    expect(st.events).toHaveLength(1);
    expect(st.events[0].type).toBe("receipt_refused");
    // The timeline keeps the FULL reason (the URL is capped, the record is not).
    expect(st.events[0].note).toBe(`RECEIPT_CATEGORY_REFUSED: ${long}`);
  });
  it("a throw → receipt_refused with the error text; the receipt still stands", async () => {
    st.receipt = "throw";
    const url = await markReceived();
    const reason = "The delivery was marked received, but the books could not be updated: socket hang up";
    expect(url).toBe(`redirect:/admin/inventory/intake/${M}?lifecycle=received&booksError=${encodeURIComponent(reason)}`);
    expect(st.events).toEqual([{ id: M, type: "receipt_refused", note: reason, actor: "u-manager" }]);
  });
  it("a long throw: the URL keeps the 300-char cap, the timeline keeps the full text", async () => {
    st.receipt = "throw";
    st.throwMsg = "E".repeat(600);
    const url = await markReceived();
    const reason = `The delivery was marked received, but the books could not be updated: ${"E".repeat(600)}`;
    expect(url).toBe(
      `redirect:/admin/inventory/intake/${M}?lifecycle=received&booksError=${encodeURIComponent(reason.slice(0, 300))}`,
    );
    expect(st.events[0].note).toBe(reason);
  });
  it("in_transit never touches the books or the timeline from the action", async () => {
    const { setManifestLifecycleAction } = await import("@/app/admin/inventory/intake/actions");
    await expect(setManifestLifecycleAction(M, "in_transit")).rejects.toThrow("NEXT_REDIRECT");
    expect(st.events).toEqual([]);
    expect(st.calls.at(-1)).toBe(`redirect:/admin/inventory/intake/${M}?lifecycle=in_transit`);
  });
  it("a failed lifecycle write stops before the books", async () => {
    st.lifecycleOk = false;
    st.receipt = { ok: true, code: "RECEIPT_OK", message: "x" };
    await markReceived();
    expect(st.calls.at(-1)).toBe(`redirect:/admin/inventory/intake/${M}?error=lifecycle`);
    expect(st.events).toEqual([]);
  });
  it("source: both the try and the catch log via receiptEventFor (no swallowed catch)", () => {
    const src = read(ACTIONS);
    const start = src.indexOf("export async function setManifestLifecycleAction");
    const fn = src.slice(start, src.indexOf("\n}\n", start));
    expect(fn.match(/const ev = receiptEventFor\(/g)).toHaveLength(2);
    expect(fn).toContain("receiptEventFor(booked)");
    expect(fn).toContain("receiptEventFor({ thrown })");
    expect(fn.match(/await logManifestEvent\(manifestId, ev\.eventType, ev\.note, session\.userId\)/g)).toHaveLength(2);
    expect(fn).not.toMatch(/catch\s*\{\s*\}/);
  });
  it("receiptEventFor strings match what the action writes", () => {
    expect(receiptEventFor({ thrown: "x" }).note).toBe(
      "The delivery was marked received, but the books could not be updated: x",
    );
  });
});

describe("5. the Accounting tab", () => {
  it("tab set: Delivery, Issues, Accounting; R19: NOTHING auto-opens Accounting", () => {
    expect(MANIFEST_PAGE_TABS.map((t) => t.key)).toEqual(["delivery", "issues", "accounting"]);
    const acc = MANIFEST_PAGE_TABS.find((t) => t.key === "accounting");
    expect(acc?.autoOpenParams).toBeUndefined();
    expect(acc?.autoOpenOn).toBeUndefined();
    expect(acc?.keepParams).toEqual(["booksError", "books"]);
    // Even if a caller still passed booksError, it must not open Accounting.
    expect(resolveTab(MANIFEST_PAGE_TABS, { booksError: "no category" }, "delivery")).toBe("delivery");
    expect(resolveTab(MANIFEST_PAGE_TABS, { books: "BILL_OK" }, "delivery")).toBe("delivery");
    expect(resolveTab(MANIFEST_PAGE_TABS, { booksError: "" }, "delivery")).toBe("delivery");
    expect(resolveTab(MANIFEST_PAGE_TABS, { held: manifestHeldAutoOpen("2"), booksError: "x" }, "delivery")).toBe("issues");
    expect(resolveTab(MANIFEST_PAGE_TABS, { tab: "accounting" }, "delivery")).toBe("accounting");
  });

  it("the page no longer feeds booksError to resolveTab, marks the tab instead, and keeps the books-83 pins", () => {
    const page = read(MANIFEST);
    expect(page).toContain("resolveTab(MANIFEST_PAGE_TABS, { tab, held: manifestHeldAutoOpen(held) }, \"delivery\")");
    expect(page).not.toMatch(/resolveTab\([^)]*booksError/);
    expect(page).toContain("attention: booksNeedsAttention(booksState.open, booksError),");
    expect(page).toContain("keep={{ booksError, books }}");
    expect(page).toMatch(/booksError\?:\s*string;/);
    expect(page).toMatch(/\{booksError\s*&&\s*\(/);
  });

  it("the books banners render ONLY inside the Accounting tab, in neutral styling", () => {
    const page = read(MANIFEST);
    const accStart = page.indexOf('{activeTab === "accounting" && (');
    const accEnd = page.indexOf("\n        )}\n", accStart);
    expect(accStart).toBeGreaterThan(0);
    const acc = page.slice(accStart, accEnd);
    expect(acc).toMatch(/\{booksError\s*&&\s*\(/);
    expect(acc).toContain("{books && !booksError && (");
    expect(acc).toContain("<ManifestAccountingPanel events={events} canBooks={canBooks} />");
    expect(acc).not.toMatch(/admin-danger/);
    // Outside the tab: no books banner anywhere.
    const outside = page.slice(0, accStart) + page.slice(accEnd);
    expect(outside).not.toMatch(/\{booksError\s*&&/);
    expect(outside).not.toContain("{books && !booksError");
    expect(page).not.toContain("The delivery stands, but the books were not updated.");
  });

  it("honest copy: no 'finalize again' promise, calls the step 'recorded' not 'posted'", () => {
    const page = read(MANIFEST);
    const accStart = page.indexOf('{activeTab === "accounting" && (');
    const acc = page.slice(accStart, page.indexOf("\n        )}\n", accStart));
    expect(acc).toContain("<strong>Books: not recorded yet</strong>");
    expect(acc).toContain("The delivery itself");
    expect(acc).toContain("{booksRefusalNextStep(inProgress)}");
    expect(acc).toContain("{booksResultText(books)}");
    expect(acc).not.toMatch(/finali[sz]e again|re-?finali/i);
  });

  it("the page gates owner-only links on books.view via the shared can()", () => {
    const page = read(MANIFEST);
    expect(page).toContain('const session = await requirePermission("inventory.manage");');
    expect(page).toContain('const canBooks = can(session.profile.role, "books.view");');
    expect(page).toContain('import { can } from "@/lib/auth/roles";');
    // The page itself never links into the books; only the gated panel does.
    expect(page).not.toMatch(/href="\/admin\/books/);
  });

  const refused = [
    { id: "e1", event_type: "received", note: null, created_at: "2026-03-07T20:00:00Z" },
    {
      id: "e2",
      event_type: "receipt_refused",
      note: "RECEIPT_CATEGORY_REFUSED: Lot L-9 has no category.",
      created_at: "2026-03-07T20:00:01Z",
    },
  ];

  it("renders a STORED refusal with no URL param (survives reload)", () => {
    const html = renderToStaticMarkup(<ManifestAccountingPanel events={refused} canBooks={false} />);
    expect(html).toContain("Books \u00b7 goods receipt not posted");
    expect(html).toContain("RECEIPT_CATEGORY_REFUSED: Lot L-9 has no category.");
    expect(html).toContain("Goods receipt: not recorded yet");
    expect(html).toContain("Vendor bill: not attempted yet");
    // Delivery events are not books events.
    expect(html).not.toContain("Marked received");
  });

  it("a manager sees AP and the owner sentence — never a books link", () => {
    const html = renderToStaticMarkup(<ManifestAccountingPanel events={refused} canBooks={false} />);
    expect(html).toContain('href="/admin/vendor-payments"');
    expect(html).toContain("Open Accounts Payable");
    expect(html).toContain("The owner reviews this in the books.");
    expect(html).not.toContain("/admin/books");
  });

  it("the owner gets the Waiting to Post link and no owner sentence", () => {
    const html = renderToStaticMarkup(<ManifestAccountingPanel events={refused} canBooks />);
    expect(html).toContain('href="/admin/books/drafts"');
    expect(html).not.toContain("The owner reviews this in the books.");
    expect(existsSync(join(ROOT, "src/app/admin/books/drafts/page.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/admin/vendor-payments/page.tsx"))).toBe(true);
  });

  it("the Books drafts page is the owner-only gate the link assumes", () => {
    expect(read("src/app/admin/books/drafts/page.tsx")).toContain("await requireBooksAccess();");
  });

  it("empty state and a later success superseding a refusal", () => {
    const empty = renderToStaticMarkup(<ManifestAccountingPanel events={[]} canBooks={false} />);
    expect(empty).toContain("Nothing has been sent to the books for this delivery yet.");
    const fixed = renderToStaticMarkup(
      <ManifestAccountingPanel
        events={[
          ...refused,
          { id: "e3", event_type: "receipt_posted", note: "RECEIPT_OK: ok", created_at: "2026-03-08T20:00:00Z" },
          { id: "e4", event_type: "vendor_bill_skipped", note: "none", created_at: "2026-03-08T21:00:00Z" },
        ]}
        canBooks={false}
      />,
    );
    expect(fixed).toContain("Goods receipt: recorded in the books");
    expect(fixed).toContain("Vendor bill: none needed");
    // History is kept: the old refusal row is still listed.
    expect(fixed).toContain("Books \u00b7 goods receipt not posted");
  });

  it("the tab badge counts only LIVE refusals (neutral tone)", () => {
    const page = read(MANIFEST);
    // R19 reshaped the map (the tab also carries `attention`) but the badge rule is unchanged.
    expect(page).toContain('t.key === "accounting"');
    expect(page).toContain('...(booksState.open > 0 ? { count: booksState.open, countTone: "neutral" as const } : {}),');
  });

  it("the panel and timeline read no env and do no I/O", () => {
    for (const f of [PANEL, TIMELINE]) {
      const src = read(f);
      expect(src).not.toMatch(/process\.env|supabase|fetch\(/);
    }
  });
});

describe("6. the timeline: labels, groups, Books collapsed, no truncation", () => {
  const long = "Menu update staged but NOT auto-published: ".padEnd(400, "x");
  const events = [
    { id: "a", event_type: "received", note: null, created_at: "2026-03-07T20:00:00Z" },
    { id: "b", event_type: "vendor_bill_refused", note: "BILL_LOT_COST_UNKNOWN: key costs", created_at: "2026-03-07T21:00:00Z" },
    { id: "c", event_type: "menu_publish_held_for_fact_review", note: long, created_at: "2026-03-07T22:00:00Z" },
    { id: "d", event_type: "brand_new_thing", note: "n", created_at: "2026-03-07T23:00:00Z" },
  ];
  const html = renderToStaticMarkup(<ManifestTimeline status="accepted" events={events} />);

  it("renders human labels, not raw event types", () => {
    expect(html).toContain("Marked received");
    expect(html).toContain("Books \u00b7 vendor bill not posted");
    expect(html).toContain("Menu update held \u00b7 fact check");
    expect(html).not.toContain("vendor bill refused");
    // Unknown types fall back to the humanised text (never break the page).
    expect(html).toContain("Brand new thing");
  });

  it("groups in order Delivery, Menu, Books; Books collapsed in <details>", () => {
    const iD = html.indexOf('data-group="delivery"');
    const iM = html.indexOf('data-group="menu"');
    const iB = html.indexOf('data-group="accounting"');
    expect(iD).toBeGreaterThan(-1);
    expect(iD).toBeLessThan(iM);
    expect(iM).toBeLessThan(iB);
    expect(html).toMatch(/<details data-group="accounting">/);
    expect(html).toContain("Books (1)");
    expect(html).not.toMatch(/<details data-group="delivery"/);
    expect(html).not.toContain('data-group="kb"');
  });

  it("never truncates: the full long note is in the markup, inside <details>", () => {
    expect(html).toContain(long);
    expect(html).not.toMatch(/\btruncate\b/);
    expect(read(TIMELINE)).not.toMatch(/\btruncate\b/);
  });

  it("uses the admin danger token, not raw red", () => {
    expect(read(TIMELINE)).not.toMatch(/red-500|red-300/);
    const rej = renderToStaticMarkup(<ManifestTimeline status="rejected" events={[]} />);
    expect(rej).toContain("var(--admin-danger)");
    expect(rej).toContain("Rejected");
  });

  it("no events → no event groups", () => {
    const none = renderToStaticMarkup(<ManifestTimeline status="pending" events={[]} />);
    expect(none).not.toContain("timeline-groups");
  });
});

describe("S29 declutter: catalog AP row and purchasing explanation", () => {
  it("catalog stage 8 is one compact row with 'Accounts Payable →'", () => {
    const src = read("src/app/admin/catalog/page.tsx");
    const i = src.indexOf("{/* 8 \u2014 Accounts Payable.");
    const block = src.slice(i, src.indexOf(") : null}", i));
    expect(i).toBeGreaterThan(0);
    expect(block).toContain('{canSee("pay") ? (');
    expect(block).toContain('<Link href="/admin/vendor-payments"');
    expect(block).toContain('Accounts Payable {"\\u2192"}');
    expect(block).not.toContain("<Card");
  });
  it("purchasing keeps the exception count and AP link; the explanation is in <details>", () => {
    const src = read("src/app/admin/purchasing/page.tsx");
    expect(src).toContain("title={`Received but not paid (${exceptions.length})`}");
    expect(src).toMatch(/<details[^>]*>\s*<summary[^>]*>What does this mean\?<\/summary>[\s\S]*?three-way-match exception[\s\S]*?<\/details>/);
    expect(src).toContain("Open Vendor payments");
  });
});
