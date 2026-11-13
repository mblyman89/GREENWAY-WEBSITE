/**
 * D241 — Budalerts fetcher wiring (structural). Pins the politeness rails,
 * the internal-use-only media rules, the standing data rules, and that
 * everything lives on the ONE Vendor Menus page with a "done" table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const fetcher = read("src/lib/purchasing/budalerts-fetch.ts");
const store = read("src/lib/purchasing/budalerts-store.ts");
const media = read("src/lib/purchasing/budalerts-media.ts");
const board = read("src/lib/purchasing/budalerts-board-store.ts");
const actions = read("src/app/admin/purchasing/menus/budalerts-actions.ts");
const controls = read("src/app/admin/purchasing/menus/budalerts-controls.tsx");
const sections = read("src/app/admin/purchasing/menus/budalerts-sections.tsx");
const page = read("src/app/admin/purchasing/menus/page.tsx");
const browser = read("src/app/admin/purchasing/menus/budalerts/[id]/page.tsx");
const vercel = read("vercel.json");

describe("D241 Budalerts fetcher — politeness", () => {
  it("only requests allow-listed URLs with an honest User-Agent", () => {
    expect(fetcher).toContain('import "server-only"');
    expect(fetcher).toContain("isAllowedBudalertsUrl(url)");
    expect(fetcher).toContain('"User-Agent": BUDALERTS_USER_AGENT');
    expect(fetcher).toContain('redirect: "manual"');
  });

  it("keeps a shared 3 s clock in the database and one lease at a time", () => {
    expect(fetcher).toContain("politeWaitMs(last, Date.now(), BUDALERTS_MIN_GAP_MS)");
    expect(fetcher).toContain("readFetchState()");
    expect(fetcher).toContain("stampRequest(");
    expect(fetcher).toContain("acquireLease(");
    expect(fetcher).toContain("releaseLease(");
    expect(store).toContain("lease_until.is.null");
  });

  it("caps time and size, stops on 429/503/403, honours the 7-day cache and a run budget", () => {
    expect(fetcher).toContain("BUDALERTS_TIMEOUT_MS");
    expect(fetcher).toContain("BUDALERTS_MAX_BYTES");
    expect(fetcher).toContain("shouldStopRun(res.status)");
    expect(fetcher).toContain("pickDueSlugs(");
    expect(fetcher).toContain("BUDALERTS_RUN_BUDGET");
  });

  it("adds no new Vercel cron (fetches are a person's click or the client loop)", () => {
    expect(vercel).not.toContain("budalerts");
  });
});

describe("D241 Budalerts — standing data rules", () => {
  it("store selects named columns, pages its reads and handles a missing 0364", () => {
    expect(store).not.toMatch(/\.select\(\s*["']\*["']/);
    expect(store).toContain("pagedAll");
    expect(store).toContain("chunkedIn");
    expect(store).toContain('"42P01"');
    expect(store).toContain('"PGRST205"');
    expect(store).toContain("0364_budalerts_menus.sql");
    expect(store).toContain("price_minor: it.priceMinor");
  });

  it("board loader is cache()d, paged and named-column", () => {
    expect(board).toContain("cache(loadUncached)");
    expect(board).toContain("pagedAll");
    expect(board).toContain('.select("id, vendor_id, display_name")');
    expect(board).toContain("splitNeededByBudalerts(");
  });
});

describe("D241 Budalerts — internal use only", () => {
  it("saves photos as drafts with platform other (never auto-published) and never into the public KB", () => {
    expect(media).toContain('platform: "other"');
    expect(media).toContain("BUDALERTS_CREDIT");
    expect(media).toContain("budalertsMediaTags(");
    expect(media).toContain('recordUsage(asset.id, "budalerts_menu_item"');
    expect(media).not.toContain("writeBackProductFacts");
  });

  it("the listings browser says internal use only and offers no purchase-order hand-off", () => {
    expect(browser).toContain("BUDALERTS_INTERNAL_NOTE");
    expect(browser).not.toContain("/admin/purchasing/new");
    expect(browser).toContain('requirePermission("inventory.manage")');
  });
});

describe("D241 Budalerts — actions", () => {
  it("every action needs inventory.manage and writes an audit row", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    const exported = actions.match(/export async function \w+/g) ?? [];
    expect(exported.length).toBe(7);
    const perms = actions.match(/requirePermission\("inventory\.manage"\)/g) ?? [];
    expect(perms.length).toBe(7);
    for (const a of ["budalerts.brand.linked", "budalerts.brand.unlinked", "budalerts.brand.fetched", "budalerts.batch.fetched", "budalerts.brand_list.refreshed", "budalerts.media.saved", "budalerts.media.bulk_saved"]) {
      expect(actions).toContain(`"${a}"`);
    }
  });

  it("stays out of the shared menus/actions.ts file", () => {
    expect(read("src/app/admin/purchasing/menus/actions.ts")).not.toContain("budalerts");
  });
});

describe("D241 Budalerts — one Vendor Menus page with a done table", () => {
  it("the page splits Still need a menu and adds the Done table", () => {
    expect(page).toContain("loadBudalertsBoard(now)");
    expect(page).toContain("board.stillNeeded");
    expect(page).toContain("<BudalertsToolbar now={now} />");
    expect(page).toContain("<BudalertsDoneTable now={now} />");
    expect(page).toContain('id="budalerts-done"');
    expect(page).toContain("<BudalertsRowControls");
    // D209 pins still hold.
    expect(page).toContain('id="needed"');
    expect(page).toContain('id="searched"');
  });

  it("the done table and the client loops are there", () => {
    expect(sections).toContain("Done — data gathered from Budalerts");
    expect(controls.startsWith('"use client"')).toBe(true);
    expect(controls).toContain("fetchDueBudalertsAction()");
    expect(controls).toContain("r.stopped");
    expect(controls).toContain("saveAllBudalertsImagesAction(fd)");
  });
});
