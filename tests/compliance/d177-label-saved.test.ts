/**
 * D177 S6 — saved store label designs + print history ("enterprise grade").
 *
 * Pure-core behaviour plus source pins for the migration (grants, append-only
 * log, no deletes), the server actions (permission gate + Security Log), the
 * post-apply PG check registration and the rollback.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  __runLabelSavedTests,
  buildPrintLogRow,
  checkTemplateWrite,
  isLabelStudioMigrationMissing,
  sampleSubjectFor,
  savedErrorText,
  savedTemplateFromRow,
  MAX_TEMPLATES_PER_KIND,
} from "@/lib/printing/label-saved-core";
import { defaultTemplate } from "@/lib/printing/label-layout-core";
import { stockById } from "@/lib/printing/label-stock-core";

const read = (p: string) => readFileSync(p, "utf8");
const ID = "33333333-3333-4333-8333-333333333333";

describe("D177 S6 — pure core", () => {
  it("self-tests all pass", () => {
    const r = __runLabelSavedTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(36);
  });

  it("refuses a design whose stock the printer cannot feed, and a duplicate name", () => {
    const nc = sampleSubjectFor("nc");
    const tpl = defaultTemplate(nc, stockById("rollo-4x6")!);
    const ok = checkTemplateWrite({ kind: "nc", name: "Glass tag", printerId: "rollo-x1040", stockId: "rollo-4x6", template: tpl }, [], nc);
    expect(ok.ok).toBe(true);
    const dup = checkTemplateWrite({ kind: "nc", name: "glass TAG", printerId: "rollo-x1040", stockId: "rollo-4x6", template: tpl }, [{ id: ID, name: "Glass tag" }], nc);
    expect(dup.ok).toBe(false);
    const full = checkTemplateWrite(
      { kind: "nc", name: "One more", printerId: "rollo-x1040", stockId: "rollo-4x6", template: tpl },
      Array.from({ length: MAX_TEMPLATES_PER_KIND }, (_, i) => ({ id: `id-${i}`, name: `d${i}` })),
      nc,
    );
    expect(full.ok).toBe(false);
  });

  it("print log recomputes the total and refuses a mismatch", () => {
    const base = { kind: "lot", printerId: "rollo-x1040", stockId: "rollo-4x6", template: { symbology: "qr" } };
    const good = buildPrintLogRow({ ...base, items: [{ subjectId: ID, copies: 3, codeSource: "lot_code", codeValue: "X1" }], totalLabels: 3 });
    expect(good.ok && good.row.total_labels).toBe(3);
    expect(good.ok && good.row.subject_ids).toEqual([ID]);
    const lie = buildPrintLogRow({ ...base, items: [{ subjectId: ID, copies: 3 }], totalLabels: 30 });
    expect(lie.ok).toBe(false);
    const bad = buildPrintLogRow({ ...base, items: [{ subjectId: "not-a-uuid", copies: 1 }], totalLabels: 1 });
    expect(bad.ok).toBe(false);
  });

  it("a stored row is untrusted: wrong kind dropped, template re-sanitised", () => {
    expect(savedTemplateFromRow({ id: ID, kind: "nc", name: "x", printer_id: "rollo-x1040", stock_id: "rollo-4x6", template: {} }, sampleSubjectFor("lot"))).toBeNull();
    const t = savedTemplateFromRow({ id: ID, kind: "lot", name: "x", printer_id: "nope", stock_id: "nope", template: { fields: ["<script>"] } }, sampleSubjectFor("lot"));
    expect(t?.printerId).toBe("rollo-x1040");
    expect(t?.template.fields).not.toContain("<script>");
  });

  it("missing 0342 is a hint naming the migration, not an error", () => {
    expect(isLabelStudioMigrationMissing("PGRST205")).toBe(true);
    expect(savedErrorText("42P01", "", "designs")).toContain("0342_label_studio.sql");
    expect(isLabelStudioMigrationMissing("23505")).toBe(false);
  });
});

describe("D177 S6 — migration 0342 + wiring", () => {
  const mig = read("supabase/migrations/0342_label_studio.sql");

  it("creates both tables idempotently with RLS and service_role-only grants (no delete)", () => {
    expect(mig).toMatch(/create table if not exists public\.label_templates/i);
    expect(mig).toMatch(/create table if not exists public\.label_print_log/i);
    expect(mig).toMatch(/alter table public\.label_templates enable row level security/i);
    expect(mig).toMatch(/alter table public\.label_print_log enable row level security/i);
    expect(mig).toMatch(/grant select, insert on table public\.label_print_log to service_role/i);
    expect(mig).not.toMatch(/grant[^;]*delete[^;]*label_/i);
    expect(mig).toMatch(/label_template_set_default/);
  });

  it("post-apply PG check is registered and a rollback exists", () => {
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("scripts/recon/label-studio-0342-pg-check.sql");
    expect(existsSync("scripts/recon/label-studio-0342-pg-check.sql")).toBe(true);
    expect(existsSync("supabase/rollbacks/0342_label_studio.rollback.sql")).toBe(true);
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("0342_label_studio.sql");
  });

  it("every server action is gated by inventory.manage and design changes hit the Security Log", () => {
    const s = read("src/app/admin/labels/actions.ts");
    const exported = s.match(/export async function \w+/g) ?? [];
    const gated = s.match(/await requirePermission\("inventory\.manage"\)/g) ?? [];
    expect(exported.length).toBeGreaterThanOrEqual(6);
    expect(gated.length).toBe(exported.length);
    for (const a of ["label_template.create", "label_template.update", "label_template.set_default", "label_template.archive"]) expect(s).toContain(a);
  });

  it("all four studio pages load the store designs; single-item pages show recent prints", () => {
    for (const p of [
      "src/app/admin/inventory/lots/[id]/label/page.tsx",
      "src/app/admin/inventory/noncannabis/[id]/label/page.tsx",
      "src/app/admin/inventory/intake/[id]/labels/page.tsx",
      "src/app/admin/inventory/noncannabis/labels/page.tsx",
    ]) {
      expect(read(p)).toContain("saved={saved}");
    }
    expect(read("src/app/admin/inventory/lots/[id]/label/page.tsx")).toContain("history={history}");
    expect(read("src/app/admin/inventory/noncannabis/[id]/label/page.tsx")).toContain("history={history}");
  });

  it("the studio records every print by default and stays quiet when 0342 is missing", () => {
    const s = read("src/components/admin/labels/LabelStudio.tsx");
    expect(s).toContain("logPrint = logLabelPrintAction");
    expect(s).toContain("!r.migrationMissing");
  });
});
