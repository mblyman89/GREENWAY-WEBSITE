"use client";

/**
 * VendorSearch — client island for the UNIFIED vendor menus command center
 * (GF-5, evolving the CV-4 Cultivera-only island).
 *
 * ONE search box, ALL marketplaces (Cultivera, GrowFlow, LeafLink). The
 * server action runs the smart sequential search: the vendor's remembered /
 * preferred platform is queried FIRST, the others only when the earlier ones
 * find nothing. Every result carries a platform badge (Cultivera / GrowFlow /
 * LeafLink) and the fetch button routes to the right per-platform menu action.
 *
 * Talks to typed server actions (PoReviewPanel pattern: useTransition + local
 * state, programmatically-built FormData). The actions map every raw record
 * through the tolerant readers server-side, so this island only ever sees
 * safe strings (UnifiedVendorHit) — no unpinned marketplace field names in
 * the browser.
 *
 * A successful fetch saves a snapshot and navigates straight to its browse
 * page (/admin/purchasing/menus/<id> or /admin/purchasing/menus/growflow/<id>).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input } from "@/components/admin/ui";
import {
  platformLabel,
  platformTone,
} from "@/lib/purchasing/unified-menus-ui-core";
import type { UnifiedVendorHit } from "@/lib/purchasing/unified-search-core";
import {
  unifiedVendorSearchAction,
  fetchCultiveraMenuAction,
  fetchGrowflowMenuAction,
  fetchLeaflinkMenuAction,
} from "./actions";

/** Stable per-row key for busy tracking (platform + ref/slug). */
function hitKey(h: UnifiedVendorHit, i: number): string {
  return `${h.platform}:${h.refId || h.slug || i}`;
}

export function VendorSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UnifiedVendorHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fetchingKey, setFetchingKey] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [fetching, startFetch] = useTransition();

  function runSearch() {
    setError(null);
    setNotice(null);
    startSearch(async () => {
      const fd = new FormData();
      fd.set("query", query);
      const res = await unifiedVendorSearchAction(fd);
      if (res.ok) {
        setHits(res.hits);
        const where = res.searchedSecond
          ? "all marketplaces"
          : `${platformLabel(res.searchedFirst)} (remembered platform)`;
        if (res.hits.length === 0) {
          setNotice(`No vendors matched on ${where}. Try a shorter name, or leave the box empty to list everything.`);
        } else if (res.notes.length > 0) {
          setNotice(res.notes.join(" · "));
        }
      } else {
        setHits(null);
        setError(res.error || res.notes.join(" · ") || "Search failed.");
      }
    });
  }

  function runFetch(h: UnifiedVendorHit, key: string) {
    setError(null);
    setNotice(null);
    setFetchingKey(key);
    startFetch(async () => {
      const fd = new FormData();
      let res: { ok: boolean; snapshotId: string | null; itemCount: number; error: string };
      if (h.platform === "growflow") {
        fd.set("store_front_id", h.refId);
        fd.set("store_name", h.name);
        fd.set("license_number", h.license);
        res = await fetchGrowflowMenuAction(fd);
      } else if (h.platform === "leaflink") {
        fd.set("brand_id", h.refId);
        fd.set("brand_name", h.name);
        fd.set("company_name", "");
        res = await fetchLeaflinkMenuAction(fd);
      } else {
        fd.set("market_id", h.refId);
        fd.set("slug", h.slug);
        fd.set("seller_name", h.name);
        res = await fetchCultiveraMenuAction(fd);
      }
      setFetchingKey(null);
      if (res.ok && res.snapshotId) {
        setNotice(`Saved ${res.itemCount} item${res.itemCount === 1 ? "" : "s"} from ${h.name}.`);
        const base =
          h.platform === "growflow"
            ? "/admin/purchasing/menus/growflow"
            : h.platform === "leaflink"
              ? "/admin/purchasing/menus/leaflink"
              : "/admin/purchasing/menus";
        router.push(`${base}/${res.snapshotId}`);
      } else {
        setError(res.error || "Menu fetch failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Vendor name — searches Cultivera + GrowFlow + LeafLink (their platform is remembered)"
          aria-label="Vendor name"
          className="sm:max-w-md"
        />
        <Button type="submit" variant="primary" size="sm" disabled={searching}>
          {searching ? "Searching…" : "Search vendors"}
        </Button>
      </form>

      {error && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-text)]">
          {notice}
        </div>
      )}

      {hits && hits.length > 0 && (
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">License / City</th>
                <th className="px-4 py-3 text-right">Live menu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {hits.map((h, i) => {
                const key = hitKey(h, i);
                const busy = fetching && fetchingKey === key;
                const detail = [h.license, h.city].filter(Boolean).join(" · ");
                return (
                  <tr key={key} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                    <td className="px-4 py-3 font-medium text-[var(--admin-text)]">
                      {h.name}
                      {h.slug && (
                        <span className="ml-2 align-middle text-xs text-[var(--admin-text-faint)]">{h.slug}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={platformTone(h.platform)}>{platformLabel(h.platform)}</Badge>
                        {h.locked && <Badge tone="orange">locked</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">{detail || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="confirm"
                        size="sm"
                        disabled={!h.fetchable || fetching}
                        onClick={() => runFetch(h, key)}
                      >
                        {busy ? "Fetching…" : "Fetch menu"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
