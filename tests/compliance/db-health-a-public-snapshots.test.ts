/**
 * DB HEALTH A (owner 2026-11-06: "Every few hours the database will become unhealthy ... This
 * has to be something we are doing ... I want a healthy db always.")
 *
 * Measured cause: public page renders re-read the same small tables thousands of times a minute
 * (content_blocks ~1,600/min, product_enrichments ~800/min) until the Micro database (1 GB RAM)
 * stopped answering and restarted (2026-11-05 21:07 UTC, 2026-11-06 02:24 UTC).
 *
 * These pins keep the public overlays on the shared one-minute snapshots, keep staff preview on
 * the live read, keep every snapshot failure on the original keyed read, and keep money paths off
 * the snapshots entirely.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __runPublicSnapshotTests } from "@/lib/site/public-snapshot-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("DB HEALTH A: public renders read shared snapshots", () => {
  it("the pure core passes its self-tests", () => {
    const r = __runPublicSnapshotTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(24);
  });

  it("content: public visitors use the snapshot; preview keeps the live read", () => {
    const s = read("src/lib/cms/render-content.ts");
    expect(s.match(/if \(!isPreview\) \{\s*const snap = await publicContentSnapshot\(\);/g)?.length).toBe(2);
    // The live keyed read is still there as the fallback (and the preview path).
    expect(s).toContain('.eq("block_key", blockKey)');
    expect(s).toContain('.in("block_key", blockKeys)');
  });

  it("images: exact and identity rungs read the snapshot first, keyed reads remain the fallback", () => {
    const s = read("src/lib/enrichment/image-resolver.ts");
    expect(s).toContain("if (snap) return exactImagesFromSnapshot(snap, keys);");
    expect(s).toContain("identityImagesFromSnapshot(snap, withId,");
    expect(s).toContain("if (!enrichmentFollowsIdentityOn()) return out;");
    expect(s).toContain('.in("pos_product_key", chunk)');
  });

  it("overrides and DOH: snapshot first, keyed read on null", () => {
    expect(read("src/lib/menu/menu-category-override-server.ts")).toContain(
      "const overrides = snap ? pickKeys(snap, keys) : await getOverridesForKeys(keys);",
    );
    const doh = read("src/lib/menu/menu-doh-server.ts");
    expect(doh).toContain("await medicalRegistrySnapshot()");
    expect(doh).toContain(": await getMedicalRegistryForKeys(keys);");
    expect(doh).toContain("isDohCategory(e[1])");
  });

  it("every snapshot is cached for one minute, tagged, and a failure is never stored", () => {
    const s = read("src/lib/site/public-snapshot-server.ts");
    expect(s.match(/unstable_cache\(/g)?.length).toBe(4);
    expect(s.match(/revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS/g)?.length).toBe(4);
    expect(s).toContain("tags: [PUBLIC_CONTENT_TAG]");
    expect(s.match(/tags: \[MENU_CACHE_TAG\]/g)?.length).toBe(3);
    // Errors throw INSIDE the cached function (never cached) and every wrapper returns null.
    expect(s.match(/if \(error\) throw new Error/g)?.length).toBeGreaterThanOrEqual(5);
    expect(s.match(/return null;\n  \}\n\}/g)?.length).toBe(4);
    // Size caps refuse an oversized snapshot (the keyed read takes over).
    expect(s.match(/if \(!withinCap\(n, SNAPSHOT_CAPS\./g)?.length).toBe(4);
  });

  it("the DOH registry save clears the public menu at once", () => {
    const s = read("src/app/admin/medical/actions.ts");
    expect(s.match(/revalidatePublicMenuSurfaces\(\);/g)?.length).toBe(2);
  });

  it("NEVER MONEY: no order, POS, price, tax, CCRS or accounting module reads a public snapshot", () => {
    const moneyDirs = ["src/lib/orders", "src/lib/pos", "src/lib/accounting", "src/lib/compliance", "src/lib/tax", "src/app/api/pos"];
    const offenders: string[] = [];
    for (const d of moneyDirs) {
      let files: string[] = [];
      try {
        files = walk(d);
      } catch {
        continue;
      }
      for (const f of files) if (read(f).includes("public-snapshot-server")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
