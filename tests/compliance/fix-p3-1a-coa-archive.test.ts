/**
 * tests/compliance/fix-p3-1a-coa-archive.test.ts  (Fix Phase 3.1a)
 *
 * Owner (message 6, verbatim): "We need a supremely robust table and fetcher,
 * it needs to work every time for every invoice and manifest".
 *
 * When an email carries SEVERAL lab PDFs, each PDF must be filed only under
 * the lab results read from IT (`archiveEmailedCoaForManifest(..., ids)`),
 * never under every lab of the delivery - otherwise QA_1.pdf would become the
 * "certificate on file" for products it does not test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  uploads: [] as string[],
  updates: [] as string[],
  labs: [] as { id: string; labtest_external_identifier: string | null; coa_url: string | null; coa_storage_path: string | null }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...((await orig()) as object), isSupabaseServiceConfigured: true }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "inventory_lots") {
        const q = { select: () => q, eq: () => q, not: async () => ({ data: db.labs.map((l) => ({ lab_result_id: l.id })) }) };
        return q;
      }
      // lab_results
      return {
        select: () => ({ in: async () => ({ data: db.labs }) }),
        update: () => ({
          eq: async (_c: string, id: string) => {
            db.updates.push(id);
            return { error: null };
          },
        }),
      };
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          db.uploads.push(path);
          return { error: null };
        },
      }),
    },
  }),
}));

const { archiveEmailedCoaForManifest } = await import("@/lib/inventory/coa-archive");
const PDF = Buffer.from("%PDF-1.4 test").toString("base64");

beforeEach(() => {
  db.uploads = [];
  db.updates = [];
  db.labs = [
    { id: "lab-a", labtest_external_identifier: "WA-260902-019", coa_url: null, coa_storage_path: null },
    { id: "lab-b", labtest_external_identifier: "WA-260921-006", coa_url: null, coa_storage_path: null },
    { id: "lab-c", labtest_external_identifier: "WA-260000-001", coa_url: "https://vendor/coa.pdf", coa_storage_path: null },
  ];
});

describe("archiveEmailedCoaForManifest files a PDF only under its own lab results", () => {
  it("with an id list: only that lab result gets this PDF", async () => {
    const n = await archiveEmailedCoaForManifest("m-1", PDF, ["WA-260902-019"]);
    expect(n).toBe(1);
    expect(db.uploads).toEqual(["lab-a/WA-260902-019.pdf"]);
    expect(db.updates).toEqual(["lab-a"]);
  });
  it("an empty id list files nothing", async () => {
    expect(await archiveEmailedCoaForManifest("m-1", PDF, [])).toBe(0);
    expect(db.uploads).toEqual([]);
  });
  it("no list (one COA Summary): every emailed-only lab, never one with the vendor's own link", async () => {
    expect(await archiveEmailedCoaForManifest("m-1", PDF)).toBe(2);
    expect(db.uploads).toEqual(["lab-a/WA-260902-019.pdf", "lab-b/WA-260921-006.pdf"]);
  });
  it("an already archived lab result is not filed again", async () => {
    db.labs[0].coa_storage_path = "lab-a/old.pdf";
    expect(await archiveEmailedCoaForManifest("m-1", PDF, ["WA-260902-019"])).toBe(0);
  });
});
