/**
 * D232 slice M-4 (SOP-11 B.6): designs saved on the server + Import
 * (G-79 / F-11-2) and the sample gate (G-81 / F-11-6).
 * Owner, verbatim: "Q2: yes, owner only and reason."
 * Owner: "Please work on M-3 through M-5."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runMerchDesignSyncTests, DESIGN_CONFLICT, MIN_OVERRIDE_REASON } from "@/lib/merch-studio/merch-design-sync-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D232 M-4: pure rules", () => {
  it("design sync self-tests pass (hash, import, merge, gate)", () => {
    const r = __runMerchDesignSyncTests();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(43);
  });
  it("override reason is at least 5 characters, same as the database check", () => {
    expect(MIN_OVERRIDE_REASON).toBe(5);
    expect(read("supabase/migrations/0360_merch_designs.sql")).toContain("length(btrim(coalesce(sample_reason, ''))) >= 5");
  });
  it("the conflict message keeps the person's work", () => {
    expect(DESIGN_CONFLICT).toContain("your version is kept as a copy");
  });
});

describe("D232 M-4: migration 0360", () => {
  const sql = read("supabase/migrations/0360_merch_designs.sql");
  const rb = read("supabase/rollbacks/0360_merch_designs.rollback.sql");
  it("service role only, RLS on, no foreign keys", () => {
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("revoke all on table public.merch_designs from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/references\s/i);
  });
  it("merch-files takes art + photos; the rollback puts PNG-only back", () => {
    expect(sql).toContain("image/jpeg");
    expect(rb).toContain("drop table if exists public.merch_designs");
    expect(rb).toContain("image/png");
  });
  it("factory reset keeps the designs", () => {
    expect(read("src/lib/accounting/factory-reset-core.ts")).toContain('table: "merch_designs", disposition: "KEEP"');
  });
});

describe("D232 M-4: wiring", () => {
  const acts = read("src/app/admin/merch-studio/design-actions.ts");
  const pub = read("src/app/admin/merch-studio/catalog-actions.ts");
  const ds = read("src/components/admin/merch-studio/DesignStudio.tsx");
  const panel = read("src/components/admin/merch-studio/PublishPanel.tsx");
  const proof = read("src/components/admin/merch-studio/ProofPanel.tsx");
  const page = read("src/app/admin/merch-studio/page.tsx");
  it("saves are compare-and-set on rev", () => {
    expect(acts).toContain('.eq("rev", baseRev)');
    expect(acts).toContain("conflict: true, error: DESIGN_CONFLICT");
  });
  it("the override is owner-only with a reason, and audited", () => {
    const i = acts.indexOf("export async function overrideMerchSampleAction");
    const body = acts.slice(i, acts.indexOf("export async function clearMerchSampleAction"));
    expect(body).toContain('session.profile.role !== "owner"');
    expect(body).toContain("overrideProblem(reason)");
    expect(body).toContain('"merch.sample_overridden"');
    expect(acts).toContain("await recordAudit(");
  });
  it("approval needs every checklist item and a real photo in Storage", () => {
    const i = acts.indexOf("export async function approveMerchSampleAction");
    const body = acts.slice(i, acts.indexOf("export async function overrideMerchSampleAction"));
    expect(body).toContain('requirePermission("merch.publish")');
    expect(body).toContain("approvalProblem(required, ticked");
    expect(body).toContain("readObjectHead(BUCKET, photoKey");
  });
  it("Publish refuses before uploading anything unless the sample gate passes", () => {
    const gate = pub.indexOf("const gate = await sampleGateFor(");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(pub.indexOf("await readObjectHead(BUCKET, key, 8)"));
    expect(gate).toBeLessThan(pub.indexOf("await updateMerchCatalog("));
    expect(pub).toContain("screenHash !== r.row.designHash");
    expect(pub).toContain("sampleOverrideReason: gate.reason");
  });
  it("the Studio has Import, a server status and the gate on Proof + Publish", () => {
    expect(ds).toContain("Import design (.json/.zip)");
    expect(ds).toContain("Saved on the server");
    expect(ds).not.toContain("saved in THIS browser only (not on the server yet)");
    expect(proof).toContain('<SampleGate design={design} rights={rights} mode="proof"');
    expect(panel).toContain('mode="publish"');
    expect(panel).toContain("!sampleOk");
    expect(panel).toContain("designHash: printHash(design)");
    expect(page).toContain('isOwner: session.profile.role === "owner"');
    expect(page).toContain("approvalsMap(designs.rows)");
  });
});
