/**
 * tests/compliance/intake-roadmap-decisions.test.ts  (owner answers, Round 6)
 *
 * docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md records two owner answers and one
 * new roadmap item. Each decision rests on facts about the code. This test pins
 * those facts, so if the code moves the decision is looked at again instead of
 * silently going stale:
 *
 *   D-R3-1  "owner and admin can add cost if missing ... let's not build this
 *            for the cannabis inventory, but we should for non cannabis"
 *     - the cannabis parser really leaves cost null when no line price;
 *     - review really treats a missing cost as INFO, not an error;
 *     - the vendor bill really refuses with BILL_LOT_COST_UNKNOWN;
 *     - non-cannabis blank cost really becomes 0 and cannot be edited later;
 *     - inventory.manage / payables.manage really include manager (so the
 *       owner/admin-only rule needs a dedicated permission).
 *   Q-02   15-20 manifests per week vs the S14 picker caps.
 *   R-LLAMA  markdown vs flat-text: the probe that proves the root cause is
 *            re-run here, so the roadmap item's claim is a test, not a story.
 *            When the S34 normalizer ships, flip these expectations.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractInvoiceNumberFromText } from "@/lib/inventory/manifest-table-core";
import { readDriverLicenseNumber } from "@/lib/inventory/transport-fields-core";
import { summarizeIntakeForReview } from "@/lib/inventory/intake-review-core";
import { can, rolesForPermission } from "@/lib/auth/roles";
import {
  PICKER_MAX_MANIFESTS,
  PICKER_WINDOW_DAYS,
} from "@/lib/catalog/onboarding-list-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const DOC = "docs/INTAKE_PIPELINE_ROADMAP_DECISIONS.md";

describe("decisions doc exists and carries the owner's words", () => {
  const doc = read(DOC);
  it("records D-R3-1, Q-02 and R-LLAMA", () => {
    expect(doc).toContain("## D-R3-1");
    expect(doc).toContain("## Q-02");
    expect(doc).toContain("## R-LLAMA");
    expect(doc).toContain("## S32 as built");
  });
  it("quotes the owner verbatim", () => {
    expect(doc).toContain("let's not build this for the cannabis inventory");
    expect(doc).toContain("try one more time to get llama ai to work better");
    expect(doc).toContain("15–20 manifests per week");
  });
  it("corrects the 'refuses the manifest' belief with the real behaviour", () => {
    expect(doc).toContain("does **not** refuse the manifest");
    expect(doc).toContain("BILL_LOT_COST_UNKNOWN");
  });
});

describe("D-R3-1 code facts", () => {
  it("cannabis parser: no line price -> null unit cost (not 0)", () => {
    const src = read("src/lib/inventory/intake-parser.ts");
    expect(src).toContain("let unit_cost_minor_units: number | null = null;");
    expect(src).toContain("if (linePrice != null && qty > 0) {");
  });

  it("review: missing cost is INFO only", () => {
    const src = read("src/lib/inventory/intake-review-core.ts");
    expect(src).toContain('add("info", "No unit cost on this line — confirm pricing.");');
    expect(typeof summarizeIntakeForReview).toBe("function");
  });

  it("vendor bill refuses the whole bill on unknown cost", () => {
    const src = read("src/lib/accounting/vendor-bill-service.ts");
    expect(src).toContain('code: "BILL_LOT_COST_UNKNOWN"');
    expect(src).toContain("Key the unit costs, then finalize again.");
    const fin = read("src/app/admin/inventory/intake/actions.ts");
    expect(fin).toContain('"vendor_bill_refused"');
  });

  it("non-cannabis: blank cost becomes 0, and the only edit action cannot change cost", () => {
    const src = read("src/app/admin/inventory/noncannabis/actions.ts");
    expect(src).toContain("if (!s) return 0;");
    const start = src.indexOf("export async function updateNonCannabisOpsAction");
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf("export async function", start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);
    expect(body).not.toMatch(/cost_minor_units/);
    const mig = read("supabase/migrations/0076_noncannabis_products.sql");
    expect(mig).toContain("cost_minor_units   integer not null default 0");
  });

  it("inventory.manage and payables.manage include manager (owner/admin-only needs its own permission)", () => {
    expect(rolesForPermission("inventory.manage")).toContain("manager");
    expect(rolesForPermission("payables.manage")).toContain("manager");
    expect(can("manager", "inventory.manage")).toBe(true);
    const doc = read(DOC);
    expect(doc).toContain("To confirm when S33-NC starts");
  });
});

describe("Q-02 volume vs the S14 picker caps", () => {
  it("20/week over the picker window stays under the manifest cap", () => {
    const perWindow = Math.ceil((20 * PICKER_WINDOW_DAYS) / 7);
    expect(perWindow).toBeLessThanOrEqual(PICKER_MAX_MANIFESTS);
    // the doc's watch threshold (~23/week) is where the cap starts to bite
    expect(Math.ceil((24 * PICKER_WINDOW_DAYS) / 7)).toBeGreaterThan(PICKER_MAX_MANIFESTS);
  });
});

describe("R-LLAMA root cause: scanners read flat text, not LlamaParse markdown", () => {
  it("LlamaParse is asked for markdown", () => {
    expect(read("src/lib/inbound-email/llamaparse-core.ts")).toContain('result_type: "markdown"');
  });

  it("S32 as built: the own-card rule the doc describes is the code", () => {
    const core = read("src/lib/pos/intake-mastering-core.ts");
    expect(core).toContain("export function ownCardKeyOf(");
    expect(core).toContain("own_card_key: ownCardKeyOf(group.items),");
    expect(core).toContain("sameCardKeySet([...decision.candidate_card_keys, own], matchedKeys);");
    expect(read("supabase/migrations/0239_intake_merge_decisions.sql")).toContain("own_card_key text");
  });

  it("invoice #: flat text found, markdown shapes missed (flip when S34 ships)", () => {
    expect(extractInvoiceNumberFromText("Invoice #: INV-15121 Order #: 15121")).toBe("INV-15121");
    expect(extractInvoiceNumberFromText("**Invoice #:** INV-15121")).toBeNull();
    expect(extractInvoiceNumberFromText("| Invoice # | INV-15121 |")).toBeNull();
    expect(
      extractInvoiceNumberFromText("| Invoice # | Order Date |\n|---|---|\n| INV-15121 | 07/14/2026 |"),
    ).toBeNull();
    expect(extractInvoiceNumberFromText("Invoice \\# 0000020830")).toBeNull();
  });

  it("driver license: flat text found, markdown shapes missed (flip when S34 ships)", () => {
    expect(
      readDriverLicenseNumber("Driver's Name: John Doe License #: H0M3R Vehicle Make: Ford"),
    ).toBe("H0M3R");
    expect(
      readDriverLicenseNumber("| Driver's Name: | John Doe |\n| License #: | H0M3R |\n| Vehicle Make: | Ford |"),
    ).toBeNull();
    expect(
      readDriverLicenseNumber("**Driver's Name:** John Doe **License #:** H0M3R **Vehicle Make:** Ford"),
    ).toBeNull();
  });
});
