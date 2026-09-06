/**
 * SLICE 20 — the blocked-stock banner's fix links, and historical reprint.
 *
 * Owner: "when I click either issue, it takes me to the product detail page of
 * the affected product, but there is nothing for me to do there that I can see
 * that would unhide them and approve them. will you deep recon this and link
 * those warning errors to where I should go to fix them. then link all of them
 * so I can work through them all. ... test the connections and the redirects
 * and such so everything points where it should."
 *
 * That last sentence is why this file leans so hard on the FILESYSTEM. It is
 * not enough for a link to look plausible in a unit test: the page it points
 * at has to exist, and the control that performs the fix has to be on it. Each
 * destination is therefore resolved to a real `page.tsx` and, where the fix is
 * a form control, the control itself is grepped for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  fixLinkForLot,
  bulkFixLinkForCause,
  CAUSE_ORDER,
  FIX_ROUTE_FILES,
  type BlockedCause,
} from "@/lib/inventory/blocked-stock-fix-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Map an emitted href to the Next.js route file that must serve it. */
function routeFileFor(href: string): string | null {
  const path = href.split("?")[0];
  if (path === "/admin/inventory/drafts") return "src/app/admin/inventory/drafts/page.tsx";
  if (path === "/admin/inventory") return "src/app/admin/inventory/page.tsx";
  if (path === "/admin/products") return "src/app/admin/products/page.tsx";
  if (/^\/admin\/inventory\/[^/]+$/.test(path)) return "src/app/admin/inventory/[id]/page.tsx";
  if (/^\/admin\/products\/[^/]+$/.test(path)) return "src/app/admin/products/[key]/page.tsx";
  return null;
}

const ALL_CAUSES: BlockedCause[] = [
  "no_product_link",
  "no_menu_card",
  "hidden_card",
  "recall_hold",
  "lot_not_active",
  "lot_empty",
];

describe("SLICE 20 — every fix link points at a page that really exists", () => {
  it("resolves each per-lot destination to a real route file", () => {
    for (const cause of ALL_CAUSES) {
      const link = fixLinkForLot(cause, "lot-123", "SKU-9");
      const file = routeFileFor(link.href);
      expect(file, `${cause} -> ${link.href} did not match a known route`).not.toBeNull();
      expect(existsSync(join(ROOT, file!)), `${cause} -> ${file} missing`).toBe(true);
    }
  });

  it("resolves each bulk destination to a real route file", () => {
    for (const cause of ALL_CAUSES) {
      const link = bulkFixLinkForCause(cause, 10);
      if (!link) continue;
      const file = routeFileFor(link.href);
      expect(file, `${cause} bulk -> ${link.href}`).not.toBeNull();
      expect(existsSync(join(ROOT, file!))).toBe(true);
    }
  });

  it("keeps its own route manifest honest", () => {
    for (const [route, file] of Object.entries(FIX_ROUTE_FILES)) {
      expect(existsSync(join(ROOT, file)), `${route} -> ${file}`).toBe(true);
    }
  });
});

describe("SLICE 20 — the links land on the control that performs the fix", () => {
  /**
   * The owner's complaint in one test: the destination must contain the thing
   * that fixes the problem, not merely be related to it.
   */
  it("sends a HIDDEN product to the page with the Visibility control", () => {
    const link = fixLinkForLot("hidden_card", "lot-1", "SKU-9");
    expect(link.href).toBe("/admin/products/SKU-9");

    const page = read("src/app/admin/products/[key]/page.tsx");
    // The select that writes the override, and the option that un-hides.
    expect(page).toContain('name="visibility"');
    expect(page).toContain('value="show"');

    // And the action behind it really writes the field the diagnosis reads.
    const actions = read("src/app/admin/products/actions.ts");
    expect(actions).toContain("hidden_override");
  });

  it("does NOT send a hidden product to the lot page, which has no such control", () => {
    const link = fixLinkForLot("hidden_card", "lot-1", "SKU-9");
    expect(link.href).not.toContain("/admin/inventory/lot-1");

    // Prove the old destination genuinely lacked the fix — this is the bug.
    const lotPage = read("src/app/admin/inventory/[id]/page.tsx");
    expect(lotPage).not.toContain('name="visibility"');
  });

  it("sends an UNAPPROVED product to Product Onboarding", () => {
    const link = fixLinkForLot("no_menu_card", "lot-2", "SKU-9");
    expect(link.href).toBe("/admin/inventory/drafts?status=draft");

    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page).toContain("Product Onboarding");
    // The approve action must exist on that page.
    expect(page).toContain("approveDraftAction");
  });

  /**
   * THE TRAP. `/admin/products/[key]` calls notFound() when the key is not on
   * the published menu, and `no_menu_card` means exactly that. Linking there
   * would turn a dead end into a 404.
   */
  it("never sends an unpublished key to the product page, which would 404", () => {
    const page = read("src/app/admin/products/[key]/page.tsx");
    expect(page).toContain("notFound()");

    for (const key of ["SKU-9", "", "  "]) {
      const link = fixLinkForLot("no_menu_card", "lot-2", key);
      expect(link.href.startsWith("/admin/products/")).toBe(false);
    }
  });

  it("uses a filter the inventory page actually parses for the bulk unlinked link", () => {
    const link = bulkFixLinkForCause("no_product_link", 12);
    expect(link!.href).toBe("/admin/inventory?missingProductLink=1");

    // The knob must be a real, parsed search param — not a hopeful string.
    expect(read("src/app/admin/inventory/page.tsx")).toContain("missingProductLink");
    expect(read("src/lib/inventory/lot-gap-core.ts")).toContain("missingProductLink");
  });

  it("offers NO bulk link for hidden products, because no such filter exists", () => {
    expect(bulkFixLinkForCause("hidden_card", 900)).toBeNull();

    // The reason, asserted: products/page.tsx only parses ENRICHMENT status.
    const matchCore = read("src/lib/enrichment/match-core.ts");
    expect(matchCore).toContain("parseEnrichmentStatusFilter");
    expect(matchCore).not.toContain('raw === "hidden"');
  });
});

describe("SLICE 20 — links are safe to build", () => {
  it("never emits null, undefined or unencoded characters in a URL", () => {
    const nasty = ['A B', 'a/b', 'a?b', 'a&b', 'a#b', '<script>'];
    for (const key of nasty) {
      const link = fixLinkForLot("hidden_card", "lot-1", key);
      expect(link.href).not.toContain(" ");
      expect(link.href).not.toContain("<");
      expect(link.href).not.toContain("null");
      expect(link.href).not.toContain("undefined");
      // Everything after /admin/products/ must be a single encoded segment.
      expect(link.href).toBe(`/admin/products/${encodeURIComponent(key)}`);
    }
  });

  it("falls back to the lot when a cause needs a key it does not have", () => {
    for (const key of [null, "", "   "]) {
      const link = fixLinkForLot("hidden_card", "lot-7", key);
      expect(link.href).toBe("/admin/inventory/lot-7");
    }
  });

  it("every cause yields a label and an explanation", () => {
    for (const cause of ALL_CAUSES) {
      const link = fixLinkForLot(cause, "L", "K");
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.why.length).toBeGreaterThan(0);
    }
  });
});

describe("SLICE 20 — the banner uses the core rather than a hard-coded link", () => {
  const banner = () => read("src/components/admin/inventory/RegisterSellabilityBanner.tsx");

  it("no longer sends every blocked lot to the lot page", () => {
    // The exact dead-end template the owner hit.
    expect(banner()).not.toContain("href={`/admin/inventory/${lot.lotId}`}");
  });

  it("builds its links from the tested core", () => {
    const b = banner();
    expect(b).toContain("fixLinkForLot");
    expect(b).toContain("bulkFixLinkForCause");
    expect(b).toContain("blocked-stock-fix-core");
  });

  it("reports the TRUE total per cause, not the number displayed", () => {
    // summary.byCode counts every diagnosis; blocked[] is only the page shown.
    expect(banner()).toContain("summary.byCode");
  });

  it("keeps the cause order the core defines", () => {
    expect(CAUSE_ORDER.map((c) => c.code)).toEqual([
      "no_product_link",
      "no_menu_card",
      "hidden_card",
      "recall_hold",
    ]);
  });
});

describe("SLICE 20 — the diagnosis carries the key the links need", () => {
  it("threads productKey through every blocked verdict", async () => {
    const { diagnoseLot } = await import("@/lib/pos/register-availability-core");
    const cards = new Map();
    const d = diagnoseLot(
      { id: "l1", posProductKey: "SKU-1", status: "active", onHandQty: 5 },
      cards,
    );
    expect(d.productKey).toBe("SKU-1");
  });

  it("reports null rather than inventing a key when there is none", async () => {
    const { diagnoseLot } = await import("@/lib/pos/register-availability-core");
    const d = diagnoseLot(
      { id: "l1", posProductKey: null, status: "active", onHandQty: 5 },
      new Map(),
    );
    expect(d.code).toBe("no_product_link");
    expect(d.productKey).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The 25-of-973 problem
// ───────────────────────────────────────────────────────────────────────────

describe("SLICE 20 — one loud cause can no longer bury a quiet one", () => {
  it("caps the display PER CAUSE so every cause stays visible", () => {
    const store = read("src/lib/inventory/register-sellability-store.ts");
    // The old flat slice is gone...
    expect(store).not.toContain(
      "diagnoses.filter((d) => !d.sellable).slice(0, BLOCKED_LOT_DISPLAY_LIMIT)",
    );
    // ...replaced by a per-cause tally.
    expect(store).toContain("perCause");
  });

  it("raised the per-cause limit above the old flat 25", async () => {
    const { BLOCKED_LOT_DISPLAY_LIMIT } = await import(
      "@/lib/inventory/register-sellability-store"
    );
    expect(BLOCKED_LOT_DISPLAY_LIMIT).toBeGreaterThan(25);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Historical receipt reprint
// ───────────────────────────────────────────────────────────────────────────

let events: {
  client_uuid: string;
  occurred_at: string;
  employee_id: string | null;
  register_id: string | null;
  payload: unknown;
}[] = [];
let eventsFail = false;
let serviceConfigured = true;
const touched: { table: string; op: string }[] = [];

vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return serviceConfigured;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      touched.push({ table, op: "from" });
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        not: () => b,
        gte: () => b,
        order: () => b,
        limit() {
          if (eventsFail) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({ data: events, error: null });
        },
        maybeSingle() {
          if (table === "registers") return Promise.resolve({ data: { name: "Register 2" }, error: null });
          if (table === "employees") return Promise.resolve({ data: { full_name: "Sam Rivera" }, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        // A reprint must never write.
        update() {
          touched.push({ table, op: "update" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
        insert() {
          touched.push({ table, op: "insert" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
        delete() {
          touched.push({ table, op: "delete" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
      };
      return b;
    },
  }),
}));

const UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const CODE = "05E82C3301".slice(-8);

async function reprint(code: string) {
  vi.resetModules();
  const { reprintReceiptByNumber } = await import("@/lib/pos/receipt-reprint-store");
  return reprintReceiptByNumber(code);
}

beforeEach(() => {
  serviceConfigured = true;
  eventsFail = false;
  touched.length = 0;
  events = [
    {
      client_uuid: UUID,
      occurred_at: "2026-09-01T18:30:00.000Z",
      employee_id: "e1",
      register_id: "r1",
      payload: {
        lines: [
          { productName: "Blue Dream 3.5g", quantity: 2, unitPriceMinor: 1200, regularPriceMinor: 1200 },
        ],
        subtotalMinor: 2400,
        taxMinor: 526,
        totalMinor: 2926,
        paymentMethod: "cash",
        tenderedMinor: 3000,
        changeMinor: 74,
      },
    },
  ];
});

describe("SLICE 20 — reprinting a PAST receipt", () => {
  it("rebuilds the receipt from the stored envelope", async () => {
    const res = await reprint(CODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.totalMinor).toBe(2926);
    expect(res.receipt.tenderedMinor).toBe(3000);
    expect(res.receipt.changeMinor).toBe(74);
    expect(res.receipt.lines[0].productName).toBe("Blue Dream 3.5g");
  });

  it("prints what was CHARGED, never a recomputed total", async () => {
    // A total that disagrees with the lines must still print as stored: the
    // receipt is a record of the transaction, not a fresh calculation.
    events[0].payload = { ...(events[0].payload as object), totalMinor: 9999 };
    const res = await reprint(CODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.totalMinor).toBe(9999);
  });

  it("carries the register and the staff name onto the slip", async () => {
    const res = await reprint(CODE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.registerLabel).toBe("Register 2");
    expect(res.receipt.servedBy).toBe("Sam Rivera");
  });

  it("is case-insensitive and tolerant of whitespace", async () => {
    const res = await reprint(`  ${CODE.toLowerCase()}  `);
    expect(res.ok).toBe(true);
  });

  it("performs NO writes", async () => {
    await reprint(CODE);
    expect(touched.filter((t) => t.op !== "from")).toEqual([]);
  });

  it("exports no mutating function", async () => {
    vi.resetModules();
    const mod = await vi.importActual<Record<string, unknown>>("@/lib/pos/receipt-reprint-store");
    expect(Object.keys(mod)).toEqual(["reprintReceiptByNumber"]);
  });

  it("says so plainly when the receipt is not found", async () => {
    const res = await reprint("ZZZZZZZZ");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.toLowerCase()).toContain("no sale found");
  });

  it("distinguishes a failed read from a missing sale", async () => {
    eventsFail = true;
    const res = await reprint(CODE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.toLowerCase()).toContain("could not read");
  });

  it("refuses a too-short code instead of scanning the ledger", async () => {
    const res = await reprint("AB");
    expect(res.ok).toBe(false);
    expect(touched).toEqual([]);
  });

  it("refuses rather than printing a slip with invented numbers", async () => {
    events[0].payload = { lines: [{ productName: "X", quantity: 1, unitPriceMinor: 100 }] };
    const res = await reprint(CODE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.toLowerCase()).toContain("totals");
  });

  it("refuses a line that has no price, rather than printing it as free", async () => {
    // Totals ARE stored here, so the only defect is the priceless line. A
    // reprint that "helpfully" prints it at 0 would hand a customer a slip
    // saying they got an item free, which is a compliance problem, not a
    // cosmetic one.
    events[0].payload = {
      lines: [{ productName: "Blue Dream 3.5g", quantity: 1 }],
      subtotalMinor: 1200,
      taxMinor: 447,
      totalMinor: 1647,
    };
    const res = await reprint(CODE);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.toLowerCase()).toContain("incomplete");
  });

  it("refuses a line whose price is present but unreadable", async () => {
    events[0].payload = {
      lines: [{ productName: "Blue Dream 3.5g", quantity: 1, unitPriceMinor: "not-a-number" }],
      subtotalMinor: 1200,
      taxMinor: 447,
      totalMinor: 1647,
    };
    const res = await reprint(CODE);
    expect(res.ok).toBe(false);
  });

  it("refuses when the sale stored no lines at all", async () => {
    events[0].payload = { lines: [], totalMinor: 1, subtotalMinor: 1, taxMinor: 0 };
    const res = await reprint(CODE);
    expect(res.ok).toBe(false);
  });

  it("matches the receipt number the rest of the register uses", async () => {
    const { receiptNumber } = await import("@/lib/pos/receipt-core");
    expect(receiptNumber(UUID)).toBe(CODE);
    const res = await reprint(receiptNumber(UUID));
    expect(res.ok).toBe(true);
  });
});

describe("SLICE 20 — a reprint may never open the cash drawer", () => {
  it("declares the job kind and drawer flag the printer core demands", async () => {
    const { REPRINT_JOB_KIND, REPRINT_OPENS_DRAWER } = await import(
      "@/lib/pos/receipt-reprint-core"
    );
    expect(REPRINT_JOB_KIND).toBe("reprint");
    expect(REPRINT_OPENS_DRAWER).toBe(false);
  });

  it("is refused by the printer core if anyone ever flips the flag", async () => {
    const { validatePrintJob } = await import("@/lib/pos/star-printer-core");
    expect(
      validatePrintJob({ html: "<p>x</p>", openDrawer: true, jobKind: "reprint" }),
    ).not.toBeNull();
    expect(
      validatePrintJob({ html: "<p>x</p>", openDrawer: false, jobKind: "reprint" }),
    ).toBeNull();
  });

  it("the register prints reprints with the drawer shut", () => {
    const shell = read("src/app/pos/RegisterShell.tsx");
    expect(shell).toContain('printSlip(html, false, "reprint")');
    // And never with the drawer open.
    expect(shell).not.toContain('printSlip(html, true, "reprint")');
  });

  it("offers the button on every history row, including closed sales", () => {
    const shell = read("src/app/pos/RegisterShell.tsx");
    expect(shell).toContain("Reprint receipt");
    expect(shell).toContain("void reprint(t.receiptNumber)");
  });
});
