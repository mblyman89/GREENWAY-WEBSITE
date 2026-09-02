/**
 * SLICE 8 — bulk fill compliance tests.
 *
 * The safety property this slice must never violate:
 *
 *   A bulk fill may ONLY turn a BLANK into a value, ONLY on a lot from the
 *   one-time Cultivera migration, ONLY for the three fields that import
 *   demonstrably failed to carry.
 *
 * These tests attack that property from every angle a real dataset would,
 * including a generated corpus that mixes migration and intake lots, blank and
 * populated fields, and the two traps (empty-string product key, deliberate
 * zero cost).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIGRATION_MARKER,
  BULK_FILLABLE_FIELDS,
  BULK_LOCKED_FIELDS,
  isMigrationLot,
  isBlank,
  eligibility,
  ineligibleMessage,
  parseExpiryInput,
  parseCostInput,
  parseProductKeyInput,
  parseFieldValue,
  planBulkFill,
  fieldLabel,
  formatFillValue,
  planHeadline,
  summarizePlan,
  __runBulkFillCoreTests,
  type BulkFillLot,
  type BulkFillField,
} from "../../src/lib/inventory/bulk-fill-core";

const TODAY = "2026-09-01";
const REPO = join(__dirname, "..", "..");

const migNote = `${MIGRATION_MARKER} Received 2026-06-17. COA flag N in POS export — obtain and attach the COA during enrichment. Expiration date not provided by POS export — set during enrichment.`;

function lot(over: Partial<BulkFillLot> = {}): BulkFillLot {
  return {
    id: "lot-1",
    notes: migNote,
    status: "active",
    expires_on: null,
    unit_cost_minor_units: null,
    pos_product_key: null,
    product_name: "Blue Dream 1g",
    ...over,
  };
}

describe("SLICE 8 — the pure core's own self-tests", () => {
  it("passes every embedded self-test", () => {
    const { passed } = __runBulkFillCoreTests();
    expect(passed).toBeGreaterThan(60);
  });
});

describe("SLICE 8 — the marker really is the importer's own string", () => {
  it("matches the literal string import-lot-core.ts writes", () => {
    // Anti-drift: if someone edits the importer's note, this test fails rather
    // than bulk fill silently matching zero lots forever.
    const importer = readFileSync(
      join(REPO, "src/lib/pos/import-lot-core.ts"),
      "utf8",
    );
    expect(importer).toContain(MIGRATION_MARKER);
  });

  it("the importer still declares these fields are set during enrichment", () => {
    const importer = readFileSync(
      join(REPO, "src/lib/pos/import-lot-core.ts"),
      "utf8",
    );
    // This sentence is the written authority for the whole slice.
    expect(importer).toContain("Expiration date not provided by POS export");
    expect(importer).toContain("set during enrichment");
  });
});

describe("SLICE 8 — the locks that must never move", () => {
  it("never exposes a quantity, lot code, classification or created_at", () => {
    for (const forbidden of [
      "on_hand_qty",
      "received_qty",
      "lot_code",
      "unit",
      "category",
      "inventory_type",
      "lab_result_id",
      "manifest_id",
      "created_at",
      "status",
    ]) {
      expect(BULK_FILLABLE_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });

  it("fillable and locked lists are disjoint", () => {
    for (const f of BULK_FILLABLE_FIELDS) {
      expect(BULK_LOCKED_FIELDS as readonly string[]).not.toContain(f);
    }
  });

  it("fills exactly the three fields the import dropped", () => {
    expect([...BULK_FILLABLE_FIELDS].sort()).toEqual(
      ["expires_on", "pos_product_key", "unit_cost_minor_units"].sort(),
    );
  });

  it("refuses a field that is not on the list", () => {
    const plan = planBulkFill({
      field: "on_hand_qty" as unknown as BulkFillField,
      rawValue: "999",
      lots: [lot()],
      todayPacific: TODAY,
    });
    expect(plan.ok).toBe(false);
  });
});

describe("SLICE 8 — eligibility", () => {
  it("accepts a blank field on an active migration lot", () => {
    expect(eligibility(lot(), "expires_on").eligible).toBe(true);
  });

  it("refuses a go-forward intake lot", () => {
    const e = eligibility(lot({ notes: "Intake receipt, manifest 8891." }), "expires_on");
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reason).toBe("not_migration_lot");
  });

  it("refuses a lot with no notes at all", () => {
    expect(eligibility(lot({ notes: null }), "expires_on").eligible).toBe(false);
  });

  it("refuses a destroyed lot", () => {
    const e = eligibility(lot({ status: "destroyed" }), "expires_on");
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reason).toBe("destroyed");
  });

  it("refuses a field that already carries a value", () => {
    const e = eligibility(lot({ expires_on: "2027-01-01" }), "expires_on");
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reason).toBe("already_set");
  });

  it("every reason produces a plain-English message", () => {
    for (const r of ["not_migration_lot", "already_set", "destroyed"] as const) {
      expect(ineligibleMessage(r).length).toBeGreaterThan(10);
    }
  });
});

describe("SLICE 8 — the two blankness traps", () => {
  it("treats an EMPTY STRING pos_product_key as blank (0023:96 allows it)", () => {
    expect(isBlank(lot({ pos_product_key: "" }), "pos_product_key")).toBe(true);
    expect(eligibility(lot({ pos_product_key: "" }), "pos_product_key").eligible).toBe(true);
  });

  it("treats a DELIBERATE ZERO cost as a KNOWN cost, never a blank", () => {
    expect(isBlank(lot({ unit_cost_minor_units: 0 }), "unit_cost_minor_units")).toBe(false);
    const e = eligibility(lot({ unit_cost_minor_units: 0 }), "unit_cost_minor_units");
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reason).toBe("already_set");
  });

  it("a zero-cost lot is skipped by a cost fill, not overwritten", () => {
    const plan = planBulkFill({
      field: "unit_cost_minor_units",
      rawValue: "9.99",
      lots: [lot({ id: "z", unit_cost_minor_units: 0 })],
      todayPacific: TODAY,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.apply).toHaveLength(0);
      expect(plan.skip[0].reason).toBe("already_set");
    }
  });
});

describe("SLICE 8 — value validation is never bypassed by bulk", () => {
  it("accepts a real expiry, past or future", () => {
    expect(parseExpiryInput("2027-01-15", TODAY).ok).toBe(true);
    expect(parseExpiryInput("2026-02-01", TODAY).ok).toBe(true);
  });

  it("refuses impossible and absurd dates", () => {
    for (const bad of ["", "2026-02-31", "2026-13-01", "junk", "2010-01-01", "2099-01-01", "1999-01-01"]) {
      expect(parseExpiryInput(bad, TODAY).ok).toBe(false);
    }
  });

  it("parses money into MINOR UNITS (standing rule 7)", () => {
    const a = parseCostInput("12.50");
    expect(a.ok && a.value).toBe(1250);
    const b = parseCostInput("$1,234.05");
    expect(b.ok && b.value).toBe(123405);
    const c = parseCostInput("7");
    expect(c.ok && c.value).toBe(700);
    const z = parseCostInput("0.00");
    expect(z.ok && z.value).toBe(0);
  });

  it("refuses negative, junk, over-precise and over-large costs", () => {
    for (const bad of ["-5", "abc", "1.234", "", "99999999999"]) {
      expect(parseCostInput(bad).ok).toBe(false);
    }
  });

  it("trims and bounds a product key", () => {
    const k = parseProductKeyInput("  SKU-9 ");
    expect(k.ok && k.value).toBe("SKU-9");
    expect(parseProductKeyInput("").ok).toBe(false);
    expect(parseProductKeyInput("x".repeat(201)).ok).toBe(false);
  });

  it("dispatches to the right validator per field", () => {
    expect(parseFieldValue("expires_on", "2027-01-01", TODAY).ok).toBe(true);
    expect(parseFieldValue("expires_on", "12.50", TODAY).ok).toBe(false);
    expect(parseFieldValue("unit_cost_minor_units", "12.50", TODAY).ok).toBe(true);
    expect(parseFieldValue("unit_cost_minor_units", "2027-01-01", TODAY).ok).toBe(false);
  });

  it("an invalid value refuses the ENTIRE plan — no partial writes", () => {
    const plan = planBulkFill({
      field: "expires_on",
      rawValue: "2026-02-31",
      lots: [lot({ id: "a" }), lot({ id: "b" })],
      todayPacific: TODAY,
    });
    expect(plan.ok).toBe(false);
  });
});

describe("SLICE 8 — the plan is a drafts-only preview (standing rule 3)", () => {
  it("partitions into apply and skip, explaining every skip", () => {
    const lots = [
      lot({ id: "a" }),
      lot({ id: "b", expires_on: "2027-05-05" }),
      lot({ id: "c", notes: "intake" }),
      lot({ id: "d", status: "destroyed" }),
      lot({ id: "e" }),
    ];
    const plan = planBulkFill({
      field: "expires_on",
      rawValue: "2027-03-01",
      lots,
      todayPacific: TODAY,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.apply.map((p) => p.lotId)).toEqual(["a", "e"]);
      expect(plan.skip).toHaveLength(3);
      for (const s of plan.skip) expect(s.message.length).toBeGreaterThan(10);
    }
  });

  it("refuses an empty selection", () => {
    expect(
      planBulkFill({ field: "expires_on", rawValue: "2027-01-01", lots: [], todayPacific: TODAY }).ok,
    ).toBe(false);
  });

  it("an all-ineligible selection still builds, and applies nothing", () => {
    const plan = planBulkFill({
      field: "expires_on",
      rawValue: "2027-03-01",
      lots: [lot({ id: "x", notes: "intake" }), lot({ id: "y", expires_on: "2027-01-01" })],
      todayPacific: TODAY,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.apply).toHaveLength(0);
      expect(plan.skip).toHaveLength(2);
    }
  });

  it("produces a contextual headline and a two-sided summary", () => {
    const plan = planBulkFill({
      field: "unit_cost_minor_units",
      rawValue: "8.25",
      lots: [lot({ id: "a" }), lot({ id: "b", unit_cost_minor_units: 500 })],
      todayPacific: TODAY,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(planHeadline(plan)).toBe("Set Unit cost to $8.25 on 1 lot");
      expect(summarizePlan(plan)).toBe("1 will be filled, 1 skipped.");
    }
  });

  it("renders money back as dollars for the preview", () => {
    expect(formatFillValue("unit_cost_minor_units", 825)).toBe("$8.25");
    expect(formatFillValue("unit_cost_minor_units", 0)).toBe("$0.00");
    expect(formatFillValue("expires_on", "2027-01-01")).toBe("2027-01-01");
  });

  it("gives every field a distinct human label", () => {
    const labels = BULK_FILLABLE_FIELDS.map(fieldLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("SLICE 8 — generated corpus: the safety property under volume", () => {
  /**
   * 600 rows spanning every combination that matters: migration vs intake,
   * blank vs populated (including empty-string and zero traps), and every
   * status. If ANY populated or non-migration row ever reaches `apply`, these
   * fail.
   */
  function corpus(): BulkFillLot[] {
    const statuses = ["active", "quarantine", "recalled", "sold_out", "destroyed"];
    const rows: BulkFillLot[] = [];
    for (let i = 0; i < 600; i += 1) {
      const isMig = i % 3 !== 0;
      const status = statuses[i % statuses.length];
      rows.push({
        id: `lot-${i}`,
        notes: isMig ? migNote : "Intake receipt, manifest 42.",
        status,
        expires_on: i % 4 === 0 ? "2027-01-01" : null,
        unit_cost_minor_units: i % 5 === 0 ? 0 : i % 7 === 0 ? 1500 : null,
        pos_product_key: i % 6 === 0 ? "" : i % 11 === 0 ? "SKU-X" : null,
        product_name: `Product ${i}`,
      });
    }
    return rows;
  }

  const rows = corpus();

  for (const field of BULK_FILLABLE_FIELDS) {
    const raw =
      field === "expires_on" ? "2027-06-01" : field === "unit_cost_minor_units" ? "10.00" : "SKU-NEW";

    it(`${field}: never applies to a populated field`, () => {
      const plan = planBulkFill({ field, rawValue: raw, lots: rows, todayPacific: TODAY });
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        const applied = new Set(plan.apply.map((p) => p.lotId));
        for (const r of rows) {
          if (!isBlank(r, field)) expect(applied.has(r.id)).toBe(false);
        }
      }
    });

    it(`${field}: never applies to a non-migration lot`, () => {
      const plan = planBulkFill({ field, rawValue: raw, lots: rows, todayPacific: TODAY });
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        const applied = new Set(plan.apply.map((p) => p.lotId));
        for (const r of rows) {
          if (!isMigrationLot(r)) expect(applied.has(r.id)).toBe(false);
        }
      }
    });

    it(`${field}: never applies to a destroyed lot`, () => {
      const plan = planBulkFill({ field, rawValue: raw, lots: rows, todayPacific: TODAY });
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        const applied = new Set(plan.apply.map((p) => p.lotId));
        for (const r of rows) {
          if (r.status === "destroyed") expect(applied.has(r.id)).toBe(false);
        }
      }
    });

    it(`${field}: apply + skip accounts for EVERY selected row (nothing silently vanishes)`, () => {
      const plan = planBulkFill({ field, rawValue: raw, lots: rows, todayPacific: TODAY });
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        expect(plan.apply.length + plan.skip.length).toBe(rows.length);
        const seen = new Set([
          ...plan.apply.map((p) => p.lotId),
          ...plan.skip.map((s) => s.lotId),
        ]);
        expect(seen.size).toBe(rows.length);
      }
    });

    it(`${field}: every applied row is independently eligible`, () => {
      const plan = planBulkFill({ field, rawValue: raw, lots: rows, todayPacific: TODAY });
      expect(plan.ok).toBe(true);
      if (plan.ok) {
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const p of plan.apply) {
          expect(eligibility(byId.get(p.lotId)!, field).eligible).toBe(true);
        }
      }
    });

    it(`${field}: the plan is deterministic`, () => {
      const a = planBulkFill({ field, rawValue: raw, lots: rows, todayPacific: TODAY });
      const b = planBulkFill({ field, rawValue: raw, lots: rows, todayPacific: TODAY });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  }

  it("the corpus actually exercises both sides (guards against a vacuous pass)", () => {
    const plan = planBulkFill({
      field: "expires_on",
      rawValue: "2027-06-01",
      lots: rows,
      todayPacific: TODAY,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.apply.length).toBeGreaterThan(20);
      expect(plan.skip.length).toBeGreaterThan(20);
    }
  });
});

describe("SLICE 8 — the write path is actually WIRED, not merely available", () => {
  const store = readFileSync(join(REPO, "src/lib/inventory/store.ts"), "utf8");
  const actions = readFileSync(join(REPO, "src/app/admin/inventory/actions.ts"), "utf8");
  const page = readFileSync(join(REPO, "src/app/admin/inventory/page.tsx"), "utf8");
  const panel = readFileSync(
    join(REPO, "src/components/admin/inventory/BulkFillPanel.tsx"),
    "utf8",
  );

  it("the store writer re-asserts blankness in the WHERE clause", () => {
    expect(store).toContain("applyBulkFill");
    // The race guard: the update only lands while the column is still blank.
    expect(store).toContain('q.is(field, null)');
    expect(store).toContain('pos_product_key.is.null,pos_product_key.eq.');
  });

  /**
   * Scope a read to EXACTLY one function body: from its `export async function`
   * to the start of the next top-level export. A wider window silently spills
   * into the neighbouring function and can match ITS code — which is precisely
   * how an early version of the destroyed-lot assertion passed while the guard
   * was removed. Caught by sabotage testing; fixed here.
   */
  function functionBody(src: string, name: string): string {
    const start = src.indexOf(`export async function ${name}`);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start + 10);
    const nextExport = rest.indexOf("\nexport ");
    return nextExport === -1 ? rest : rest.slice(0, nextExport);
  }

  it("the store writer refuses to touch destroyed lots", () => {
    const fn = functionBody(store, "applyBulkFill");
    expect(fn).toContain('.neq("status", "destroyed")');
  });

  it("the destroyed-lot guard is on the UPDATE statement itself", () => {
    const fn = functionBody(store, "applyBulkFill");
    // The guard must be chained onto the update, not merely present somewhere.
    expect(fn).toMatch(
      /update\(patch\)[\s\S]{0,120}\.neq\("status",\s*"destroyed"\)/,
    );
  });

  it("the store writer stamps provenance", () => {
    const body = functionBody(store, "applyBulkFill");
    expect(body).toContain("owner_entered");
    expect(body).toContain("expires_on_set_by");
    expect(body).toContain("unit_cost_set_by");
    expect(body).toContain("pos_product_key_set_by");
  });

  it("the action is permission-gated and audited", () => {
    const fn = actions.slice(actions.indexOf("export async function bulkFillLotsAction"));
    expect(fn).toContain('requirePermission("inventory.manage")');
    expect(fn).toContain("recordAudit");
    expect(fn).toContain("inventory_lot.bulk_filled");
  });

  it("the action re-reads lots server-side instead of trusting the form", () => {
    const fn = actions.slice(actions.indexOf("export async function bulkFillLotsAction"));
    expect(fn).toContain("listLotsForBulkFill");
    expect(fn).toContain("planBulkFill");
  });

  it("preview mode writes NOTHING (standing rule 3, drafts-only)", () => {
    const fn = actions.slice(actions.indexOf("export async function bulkFillLotsAction"));
    const previewGuard = fn.indexOf('if (mode !== "apply")');
    const firstWrite = fn.indexOf("applyBulkFill(");
    expect(previewGuard).toBeGreaterThan(-1);
    // The preview early-return must come BEFORE any write call.
    expect(previewGuard).toBeLessThan(firstWrite);
  });

  it("the panel is rendered by the inventory page behind an explicit mode", () => {
    expect(page).toContain("BulkFillPanel");
    expect(page).toContain('sp.bulk === "1"');
  });

  it("the panel offers a preview step before the save step", () => {
    expect(panel).toContain('value="preview"');
    expect(panel).toContain('value="apply"');
    expect(panel).toContain("Review before saving");
  });

  it("the panel explains skipped rows rather than hiding them", () => {
    expect(panel).toContain("skipped");
    expect(panel).toContain("protected");
  });

  it("the core is registered in the pure self-test sweep", () => {
    const runner = readFileSync(
      join(REPO, "scripts/compliance/run-pure-selftests.ts"),
      "utf8",
    );
    expect(runner).toContain("__runBulkFillCoreTests");
  });

  it("the migration adds provenance columns idempotently", () => {
    const mig = readFileSync(
      join(REPO, "supabase/migrations/0215_inventory_lot_bulk_fill_provenance.sql"),
      "utf8",
    );
    expect(mig).toContain("add column if not exists expires_on_source");
    expect(mig).toContain("add column if not exists unit_cost_source");
    expect(mig).toContain("add column if not exists pos_product_key_source");
    // Vocabulary guarded, like 0214.
    expect(mig).toContain("inventory_lots_expires_on_source_chk");
    expect(mig).toContain("owner_entered");
    // Idempotent: no bare ALTER that would fail on a re-run.
    expect(mig).toContain("if not exists");
  });
});
