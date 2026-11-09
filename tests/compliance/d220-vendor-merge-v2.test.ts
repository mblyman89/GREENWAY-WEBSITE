/**
 * D220 S1: finish merging vendors. Owner: "I thought I had merged the remaining duplicate vendors. can you
 * help me finish merging all the vendors."
 *
 * Found on production (read-only recon): 0104's merge_vendors() repoints 12 tables but 27 now reference
 * vendors(id); 240 lots, 41 manifests, 244 kb_products and 627 catalog drafts sat on archived (merged)
 * cards because intake's license lookup kept matching the old card. 0350 fixes both sides.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergedTargetOf, resolveSurvivor, type SurvivorCard } from "../../src/lib/vendors/vendor-survivor-core";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const MIG = read("supabase/migrations/0350_vendor_merge_v2.sql");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const C = "cccccccc-0000-4000-8000-000000000002";
const D = "dddddddd-0000-4000-8000-000000000003";

describe("D220 survivor core", () => {
  const cards: Record<string, SurvivorCard> = {
    [A]: { id: A, status: "published" },
    [C]: { id: C, status: "archived", internal_notes: `Imported.\nMerged into "A" (${A}) on 2026-07-26.` },
    [D]: { id: D, status: "archived", merged_into_id: C },
  };
  const lookup = (id: string) => cards[id];

  it("a live card is its own survivor", () => {
    expect(resolveSurvivor(A, lookup)).toEqual({ survivorId: A, hops: 0, path: [A] });
  });
  it("follows merged_into_id, then the 0104 note (chain D -> C -> A)", () => {
    expect(resolveSurvivor(D, lookup).survivorId).toBe(A);
    expect(resolveSurvivor(D, lookup).hops).toBe(2);
  });
  it("a note on a card that is NOT archived is ignored (only merged_into_id counts there)", () => {
    expect(mergedTargetOf({ id: C, status: "published", internal_notes: `Merged into "A" (${A}) on 2026-07-26.` })).toBeNull();
  });
  it("the LAST note wins", () => {
    expect(
      mergedTargetOf({ id: C, status: "archived", internal_notes: `Merged into "D" (${D}) on 2026-01-01.\nMerged into "A" (${A}) on 2026-07-26.` }),
    ).toBe(A);
  });
  it("loops and unknown targets stop safely", () => {
    const loop: Record<string, SurvivorCard> = {
      [A]: { id: A, status: "archived", merged_into_id: C },
      [C]: { id: C, status: "archived", merged_into_id: A },
    };
    expect(resolveSurvivor(A, (id) => loop[id]).survivorId).toBe(C);
    expect(resolveSurvivor(C, () => ({ id: C, status: "archived", merged_into_id: D })).survivorId).toBe(D);
    expect(resolveSurvivor(C, (id) => (id === C ? { id: C, status: "archived", merged_into_id: D } : undefined)).survivorId).toBe(C);
    expect(mergedTargetOf({ id: A, merged_into_id: A })).toBeNull();
  });
});

describe("D220 migration 0350", () => {
  it("adds merged_into_id with a self-reference guard and backfills from 0104's exact note (last one wins)", () => {
    expect(MIG).toMatch(/add column if not exists merged_into_id uuid/);
    expect(MIG).toMatch(/vendors_merged_into_not_self check \(merged_into_id is null or merged_into_id <> id\)/);
    expect(MIG).toMatch(/Merged into "\[\^"\]\*" \\\(/);
    expect(MIG).toMatch(/with ordinality as t\(mm, n\)/);
    expect(MIG).toMatch(/order by t\.n desc/);
  });
  it("repoints every vendor FK from the catalog, never the guarded money tables", () => {
    expect(MIG).toMatch(/c\.confrelid = 'public\.vendors'::regclass/);
    for (const t of ["vendor_bank_details", "ach_authorizations", "ach_authorization_documents", "ach_authorization_events", "ach_return_notices", "payee_contacts", "vendor_esign_invites"]) {
      expect(MIG).toContain(`'${t}'`);
    }
    expect(MIG).toMatch(/if fk\.tname = any\(guarded\) then/);
    expect(MIG).toMatch(/needs_attention/);
  });
  it("keeps each moved manifest's sending license for CCRS", () => {
    expect(MIG).toMatch(/'from_license_number', btrim\(d\.license_number\)/);
    expect(read("src/lib/compliance/ccrs-batch.ts")).toMatch(/from_license_number:raw_payload->>from_license_number/);
  });
  it("v2 refuses an archived or merged survivor and a duplicate merged elsewhere", () => {
    expect(MIG).toMatch(/was itself merged into another card/);
    expect(MIG).toMatch(/is archived; un-archive it/);
    expect(MIG).toMatch(/was already merged into a different card/);
  });
  it("has the follow-the-merge trigger on the operational tables", () => {
    expect(MIG).toMatch(/before insert or update of vendor_id on public\.%I/);
    for (const t of ["inventory_lots", "inbound_manifests", "catalog_product_drafts", "kb_products"]) expect(MIG).toContain(`'${t}'`);
  });
  it("finishes only the confirmed pairs, guarded, and sweeps", () => {
    expect(MIG).toContain("'b9483868-45be-4088-a39e-20ce19a1f68d'::uuid, 'fdfb3531-33ea-47b4-9f68-0a1538a15a87'::uuid");
    expect(MIG).toContain("'f69231c1-18ef-4e19-92de-834dbb12352b'::uuid, '366ec135-cfc0-41ab-9ff7-89319e476abc'::uuid");
    expect(MIG).toContain("'bc64f709-dec7-4e51-9e31-27e8b7febece'::uuid, '477204dc-f790-441b-9103-3f6b43dc15ff'::uuid");
    // The uncertain / different-company pairs are NOT merged automatically.
    for (const id of ["cce1e12a", "f3234d2a", "c25873f0", "99baf1a9", "82f14f9f", "afc13a77", "85232fb1"]) expect(MIG).not.toContain(id);
    expect(MIG).toMatch(/select public\.sweep_merged_vendor_rows\(\);\s*$/);
  });
  it("functions are service_role only; rollback and pg-check exist and are wired", () => {
    for (const f of ["vendor_survivor_id(uuid)", "vendor_repoint_references(uuid, uuid[])", "merge_vendors_v2(uuid, uuid[])", "sweep_merged_vendor_rows()"]) {
      expect(MIG).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(MIG).toContain(`grant execute on function public.${f} to service_role;`);
    }
    expect(read("supabase/rollbacks/0350_vendor_merge_v2.rollback.sql")).toMatch(/drop column if exists merged_into_id/);
    expect(read("scripts/recon/vendor-merge-v2-0350-pg-check.sql")).toMatch(/VENDOR MERGE V2 0350 CHECK PASSED/);
    expect(read("scripts/compliance/verify-migrations-execute.ts")).toContain("vendor-merge-v2-0350-pg-check.sql");
    expect(read("docs/MIGRATIONS_TO_RUN.md")).toContain("supabase/migrations/0350_vendor_merge_v2.sql");
  });
});

describe("D220 app wiring", () => {
  it("merge-service calls v2 and falls back to 0104 only when v2 is missing", () => {
    const s = read("src/lib/vendors/merge-service.ts");
    expect(s).toMatch(/admin\.rpc\("merge_vendors_v2", args\)/);
    expect(s).toMatch(/isMergeV2Missing\(error\.message\)/);
    expect(s).toMatch(/admin\.rpc\("merge_vendors", args\)/);
  });
  it("intake follows a merged card to its survivor", () => {
    const s = read("src/lib/inventory/intake-store.ts");
    expect(s).toMatch(/return found \? followVendorMerge\(admin, found\) : null;/);
    expect(s).toMatch(/select\("id, status, internal_notes, merged_into_id"\)/);
  });
  it("the merge screen names what was held back", () => {
    expect(read("src/app/admin/vendors/actions.ts")).toMatch(/money records are never moved automatically/);
  });
});
