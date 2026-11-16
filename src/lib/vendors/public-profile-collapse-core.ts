/**
 * src/lib/vendors/public-profile-collapse-core.ts   (D246)
 *
 * PURE. Folds merged vendor duplicates into their survivor BEFORE the public
 * vendor directory matches menu vendor names to back-office profiles.
 *
 * The bug (owner, D246: "the image set on a vendor does not reach the website
 * because there are two to three duplicates for all vendors"): the public
 * /vendor-delivery page and the home page match a menu vendor name to the
 * FIRST profile with that name (enrichVendorDirectory). listPublicVendorProfiles
 * fed it every vendors row, including rows already merged away
 * (merged_into_id set, migration 0350), ordered by sort_order then name. A
 * merged duplicate with no logo therefore won the match and the survivor's
 * logo never showed. Measured on the live DB (2026-11-16): 32 of 118 menu
 * vendor names had two or more rows; only 1 of them had two LIVE rows.
 *
 * The rule here:
 *   1. A merged row never stands alone. Its names (display / dba / legal and
 *      aliases) become extra aliases of its survivor (following the chain),
 *      so a menu that still says the old name lands on the survivor.
 *   2. The survivor's own logo / copy win. Only when the survivor has none is
 *      a merged row's logo / copy used (7 menu vendors had the logo on the
 *      merged row only).
 *   3. When two LIVE rows still share a name, the one with a logo, then the
 *      published one, then the lower sort_order is listed first (so it wins
 *      the "first profile wins" tie-break), never an empty draft.
 */

export type CollapsibleVendorRow = {
  id: string;
  merged_into_id: string | null;
  status: string | null;
  sort_order: number | null;
  display_name: string;
  dba: string | null;
  legal_name: string | null;
  aliases: string[];
  logoUrl: string | null;
  about: string | null;
  mission_statement: string | null;
  product_philosophy: string | null;
};

/** Follow merged_into_id to the live survivor (cycle-safe, max 20 hops). */
export function survivorIdOf(id: string, mergedInto: ReadonlyMap<string, string | null>): string {
  let cur = id;
  const seen = new Set<string>();
  for (let i = 0; i < 20; i += 1) {
    const next = mergedInto.get(cur);
    if (!next || seen.has(next)) return cur;
    seen.add(cur);
    cur = next;
  }
  return cur;
}

const blank = (s: string | null | undefined) => !s || !s.trim();

export function collapseMergedVendorProfiles<T extends CollapsibleVendorRow>(rows: readonly T[]): T[] {
  const mergedInto = new Map<string, string | null>();
  const byId = new Map<string, T>();
  for (const r of rows) {
    mergedInto.set(r.id, r.merged_into_id ?? null);
    byId.set(r.id, r);
  }
  // Survivors start as copies of themselves.
  const out = new Map<string, T>();
  for (const r of rows) {
    if (r.merged_into_id) continue;
    out.set(r.id, { ...r, aliases: [...(r.aliases ?? [])] });
  }
  // Fold each merged row into its survivor.
  for (const r of rows) {
    if (!r.merged_into_id) continue;
    const sid = survivorIdOf(r.id, mergedInto);
    const s = out.get(sid);
    if (!s) continue; // survivor not in the list: drop the merged row (never shown on its own)
    const names = [r.display_name, r.dba, r.legal_name, ...(r.aliases ?? [])];
    for (const n of names) {
      if (blank(n)) continue;
      const t = (n as string).trim();
      const own = [s.display_name, s.dba, s.legal_name, ...s.aliases].map((a) => (a ?? "").trim().toLowerCase());
      if (!own.includes(t.toLowerCase())) s.aliases.push(t);
    }
    if (blank(s.logoUrl) && !blank(r.logoUrl)) s.logoUrl = r.logoUrl;
    if (blank(s.mission_statement) && !blank(r.mission_statement)) s.mission_statement = r.mission_statement;
    if (blank(s.about) && !blank(r.about)) s.about = r.about;
    if (blank(s.product_philosophy) && !blank(r.product_philosophy)) s.product_philosophy = r.product_philosophy;
  }
  const rank = (v: T) => [blank(v.logoUrl) ? 1 : 0, v.status === "published" ? 0 : 1, v.sort_order ?? 0] as const;
  return [...out.values()].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.display_name.localeCompare(b.display_name);
  });
}

// ---------------------------------------------------------------------------
// self-tests (pure) — registered in scripts/compliance/run-pure-selftests.ts
// ---------------------------------------------------------------------------
export function __runPublicProfileCollapseTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL public-profile-collapse-core: " + msg);
    passed += 1;
  };
  const row = (p: Partial<CollapsibleVendorRow> & { id: string; display_name: string }): CollapsibleVendorRow => ({
    merged_into_id: null,
    status: "draft",
    sort_order: 0,
    dba: null,
    legal_name: null,
    aliases: [],
    logoUrl: null,
    about: null,
    mission_statement: null,
    product_philosophy: null,
    ...p,
  });

  // The D246 shape: an archived duplicate (no logo) sorted before the survivor.
  const rows = [
    row({ id: "dup", display_name: "AVITAS", merged_into_id: "live", sort_order: 0 }),
    row({ id: "live", display_name: "AVITAS", status: "published", sort_order: 5, logoUrl: "https://x/avitas.png" }),
  ];
  const c = collapseMergedVendorProfiles(rows);
  ok(c.length === 1, "merged row folded away");
  ok(c[0].id === "live" && c[0].logoUrl === "https://x/avitas.png", "survivor keeps its logo");
  ok(c[0].aliases.length === 0, "same name not re-added as an alias");

  // Logo only on the merged row -> survivor borrows it.
  const c2 = collapseMergedVendorProfiles([
    row({ id: "a", display_name: "CERES", legal_name: "CERES GARDEN LLC" }),
    row({ id: "b", display_name: "Ceres Garden", merged_into_id: "a", logoUrl: "https://x/ceres.png", about: "About ceres" }),
  ]);
  ok(c2.length === 1 && c2[0].logoUrl === "https://x/ceres.png", "logo borrowed from merged row");
  ok(c2[0].about === "About ceres", "copy borrowed when survivor blank");
  ok(c2[0].aliases.includes("Ceres Garden"), "merged name becomes an alias");

  // Survivor's own logo is never replaced.
  const c3 = collapseMergedVendorProfiles([
    row({ id: "a", display_name: "X", logoUrl: "own" }),
    row({ id: "b", display_name: "X2", merged_into_id: "a", logoUrl: "other" }),
  ]);
  ok(c3[0].logoUrl === "own", "survivor logo wins");

  // Chain a <- b <- c.
  const c4 = collapseMergedVendorProfiles([
    row({ id: "c", display_name: "Old Old", merged_into_id: "b" }),
    row({ id: "b", display_name: "Old", merged_into_id: "a" }),
    row({ id: "a", display_name: "New" }),
  ]);
  ok(c4.length === 1 && c4[0].aliases.includes("Old Old") && c4[0].aliases.includes("Old"), "chain followed");

  // Cycle does not hang.
  ok(survivorIdOf("p", new Map([["p", "q"], ["q", "p"]])).length > 0, "cycle-safe");

  // Two live rows, same name: the one with a logo / published comes first.
  const c5 = collapseMergedVendorProfiles([
    row({ id: "empty", display_name: "Same", sort_order: 0 }),
    row({ id: "good", display_name: "Same", status: "published", sort_order: 9, logoUrl: "l" }),
  ]);
  ok(c5[0].id === "good", "with-logo live row first");
  const c6 = collapseMergedVendorProfiles([
    row({ id: "d", display_name: "Same", status: "draft" }),
    row({ id: "p", display_name: "Same", status: "published" }),
  ]);
  ok(c6[0].id === "p", "published before draft");

  // Orphan merged row (survivor absent) is dropped.
  ok(collapseMergedVendorProfiles([row({ id: "o", display_name: "O", merged_into_id: "gone" })]).length === 0, "orphan merged dropped");

  // Input not mutated.
  const orig = row({ id: "a", display_name: "A" });
  collapseMergedVendorProfiles([orig, row({ id: "b", display_name: "B", merged_into_id: "a" })]);
  ok(orig.aliases.length === 0, "input not mutated");

  return { passed, failed: 0 };
}
