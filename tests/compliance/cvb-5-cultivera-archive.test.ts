/**
 * CVB-5: Admin -> Cultivera Archive (owner only). Michael, 2026-11-01: "This will also allow me to retain
 * Cultivera historical data safely in our system. This will be owner only access." and "Add a new page in
 * the admin".
 *
 * Locks: the pure archive core (and its agreement with the crawler's STAGES and the 0337 bucket), the owner-only
 * gate on the page AND every server action, the nav entry, and the archive order (sha256-checked copy, upsert:false,
 * register, then the daily figures read back from the bucket).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARCHIVE_STAGES,
  MANIFEST_FILE,
  UPLOAD_BUDGET_MS,
  __runCultiveraArchiveCoreTests,
  archiveRunSummary,
  contentTypeFor,
  dailySalesFiles,
  datasetRollup,
  parseJsonlRows,
  planUploads,
  storagePath,
} from "@/lib/reports/cultivera-archive-core";
import { ALL_PERMISSIONS, PERMISSION_LABELS, can, rolesForPermission } from "@/lib/auth/roles";
import { adminNav } from "@/components/admin/admin-nav-data";

const REPO = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO, ...p), "utf8");

describe("cultivera-archive-core", () => {
  it("passes its embedded self-tests", () => {
    expect(__runCultiveraArchiveCoreTests().passed).toBeGreaterThanOrEqual(28);
  });

  it("names the crawler's eight stages in the crawler's order", () => {
    const py = read("crawler", "app", "cultivera_archive.py");
    const m = py.match(/^STAGES = \(([\s\S]*?)\)\n/m);
    expect(m).toBeTruthy();
    const stages = [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    expect(stages).toEqual([...ARCHIVE_STAGES]);
  });

  it("only offers Archive for a finished harvest, and Continue for a stopped one", () => {
    expect(archiveRunSummary(false, { status: "done" }).canArchive).toBe(true);
    expect(archiveRunSummary(true, { status: "done" }).canArchive).toBe(false);
    for (const s of ["paused", "cancelled", "failed"]) {
      expect(archiveRunSummary(false, { status: s }).canResume).toBe(true);
      expect(archiveRunSummary(false, { status: s }).canArchive).toBe(false);
    }
  });

  it("never plans to overwrite: a stored file of a different size is a mismatch", () => {
    const f = [{ name: "x.json", bytes: 5, sha256: "a".repeat(64), rows: null }];
    expect(planUploads(f, [{ name: "x.json", size: 6 }]).mismatched).toHaveLength(1);
    expect(planUploads(f, [{ name: "x.json", size: 6 }]).toUpload).toHaveLength(0);
    expect(planUploads(f, [{ name: "x.json", size: 5 }]).present).toEqual(["x.json"]);
  });

  it("uses exactly the mime types the 0337 bucket allows", () => {
    const sql = read("supabase", "migrations", "0337_cultivera_benchmark_archive.sql");
    for (const name of ["a.p0001.jsonl.gz", "lookups.json", "errors.jsonl"]) {
      const mime = contentTypeFor(name);
      expect(mime).toBeTruthy();
      expect(sql).toContain(`''${mime}''`);
    }
    expect(contentTypeFor("a.txt")).toBeNull();
  });

  it("stores files under <run>/<name>, the 0337 storage_path rule", () => {
    const sql = read("supabase", "migrations", "0337_cultivera_benchmark_archive.sql");
    expect(sql).toContain("check (storage_path = run_id || '/' || file_name)");
    expect(storagePath("20261101T000000Z-abcdef01", "a.json")).toBe("20261101T000000Z-abcdef01/a.json");
  });

  it("rolls datasets up and picks the daily_sales parts", () => {
    expect(datasetRollup([{ name: "a.p0001.jsonl.gz", bytes: 1, rows: 2 }])[0]).toEqual({ dataset: "a", files: 1, rows: 2, bytes: 1 });
    expect(dailySalesFiles([{ name: "daily_sales.p0001.jsonl.gz" }, { name: "x.json" }]).map((f) => f.name)).toEqual(["daily_sales.p0001.jsonl.gz"]);
    expect(parseJsonlRows("{}\nbad\n")).toEqual({ rows: [{}], bad: 1 });
  });

  it("leaves headroom under the page's 300 s limit", () => {
    expect(UPLOAD_BUDGET_MS).toBeLessThanOrEqual(240_000);
    expect(read("src", "app", "admin", "cultivera-archive", "page.tsx")).toContain("export const maxDuration = 300");
  });

  it("the keyless daily_sales part name matches the crawler's part_name", () => {
    const py = read("crawler", "app", "cultivera_archive.py");
    expect(py).toContain('return f"{dataset}.p{n:04d}.jsonl.gz"');
    expect(py).toContain('Keyless("daily_sales", "reports/daily-sales"');
  });
});

describe("cultivera.benchmark is owner only", () => {
  it("is a real permission held by the owner alone", () => {
    expect(ALL_PERMISSIONS).toContain("cultivera.benchmark");
    expect(rolesForPermission("cultivera.benchmark")).toEqual(["owner"]);
    expect(can("admin", "cultivera.benchmark")).toBe(false);
    expect(can("manager", "cultivera.benchmark")).toBe(false);
    expect(PERMISSION_LABELS["cultivera.benchmark"]).toMatch(/owner only/);
  });

  it("guards the page and EVERY server action with it", () => {
    const page = read("src", "app", "admin", "cultivera-archive", "page.tsx");
    expect(page).toContain('await requirePermission("cultivera.benchmark")');
    const actions = read("src", "app", "admin", "cultivera-archive", "actions.ts");
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual(["archiveRunAction", "cancelArchiveAction", "rebuildDaysAction", "startArchiveAction"]);
    for (const fn of exported) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`)).split("\nexport async function ")[0];
      expect(body, fn).toContain('requirePermission("cultivera.benchmark")');
      expect(body, fn).toContain("recordAudit(");
    }
  });

  it("is in the owner's Lyman menu", () => {
    const item = adminNav.find((i) => i.href === "/admin/cultivera-archive");
    expect(item?.permission).toBe("cultivera.benchmark");
    expect(item?.group).toBe("Lyman");
  });
});

describe("the archive order", () => {
  const runner = read("src", "lib", "reports", "cultivera-archive-runner.ts");
  const store = read("src", "lib", "reports", "cultivera-benchmark-store.ts");
  const client = read("src", "lib", "reports", "cultivera-archive-client.ts");

  it("checks every crawler file against the manifest before storing it", () => {
    expect(client).toContain("verifyFile(manifest, name, b.length, sha256Hex(b))");
    expect(runner.indexOf("verifiedArchiveFile(")).toBeLessThan(runner.indexOf("uploadArchiveFile(runId, name, bytes)"));
  });

  it("never overwrites a stored object", () => {
    expect(store).toContain("upsert: false");
    expect(store).not.toContain("upsert: true");
  });

  it("refuses a manifest whole, stores the manifest itself, then registers", () => {
    const iProblems = runner.indexOf("manifestToRegisterFiles(manifest)");
    const iManifest = runner.indexOf(`uploadArchiveFile(runId, MANIFEST_FILE, mb)`);
    const iRegister = runner.indexOf("registerArchiveRun(runId, capturedAt, sha256Hex(mb)");
    expect(iProblems).toBeGreaterThan(0);
    expect(iManifest).toBeGreaterThan(iProblems);
    expect(iRegister).toBeGreaterThan(iManifest);
    expect(MANIFEST_FILE).toBe("manifest.json");
  });

  it("reads the daily figures back from the BUCKET and checks them against the registered sha256", () => {
    const ingest = runner.slice(runner.indexOf("export async function ingestDailyFigures"));
    expect(ingest).toContain("downloadArchiveFile(runId, f.name)");
    expect(ingest).toContain("sha256Hex(b) !== f.sha256");
    expect(ingest).not.toContain("verifiedArchiveFile(");
    expect(ingest).toContain("dayBatches(norm.rows)");
  });

  it("does not archive without a capture time (never guessed)", () => {
    expect(runner).toContain("The manifest has no finish time");
    expect(runner).not.toMatch(/capturedAt\s*=.*new Date\(\)/);
  });

  it("reads every database answer's error", () => {
    const calls = (store.match(/await admin\(\)/g) ?? []).length + (store.match(/await db\./g) ?? []).length;
    const checks = (store.match(/if \(error\)|if \(!error\)|\.error\) throw|if \(error \|\| !data\)/g) ?? []).length;
    expect(checks).toBeGreaterThanOrEqual(calls - 1);
  });
});
