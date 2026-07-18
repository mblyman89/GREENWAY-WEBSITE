"use client";

/**
 * VendorSearch — client island for the Cultivera command center (CV-4).
 *
 * Search the marketplace's vendors, then pull ONE vendor's live menu with a
 * click. Talks to typed server actions (PoReviewPanel pattern: useTransition +
 * local state, submitting programmatically-built FormData). The actions map
 * every raw market record through the tolerant readers server-side, so this
 * island only ever sees safe strings (VendorHit) — no unpinned Cultivera
 * field names in the browser.
 *
 * A successful fetch saves a snapshot and navigates straight to its browse
 * page (/admin/purchasing/menus/<id>).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input } from "@/components/admin/ui";
import {
  searchCultiveraVendorsAction,
  fetchCultiveraMenuAction,
  type VendorHit,
} from "./actions";

export function VendorSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [vendors, setVendors] = useState<VendorHit[] | null>(null);
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
      const res = await searchCultiveraVendorsAction(fd);
      if (res.ok) {
        setVendors(res.vendors);
        if (res.vendors.length === 0) {
          setNotice("No vendors matched. Try a shorter name, or leave the box empty to list everything.");
        }
      } else {
        setVendors(null);
        setError(res.error);
      }
    });
  }

  function runFetch(v: VendorHit) {
    const key = v.slug || v.id;
    setError(null);
    setNotice(null);
    setFetchingKey(key);
    startFetch(async () => {
      const fd = new FormData();
      fd.set("market_id", v.id);
      fd.set("slug", v.slug);
      fd.set("seller_name", v.name);
      const res = await fetchCultiveraMenuAction(fd);
      setFetchingKey(null);
      if (res.ok && res.snapshotId) {
        setNotice(`Saved ${res.itemCount} item${res.itemCount === 1 ? "" : "s"} from ${v.name}.`);
        router.push(`/admin/purchasing/menus/${res.snapshotId}`);
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
          placeholder="Vendor name (leave empty to list all connected vendors)"
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

      {vendors && vendors.length > 0 && (
        <div className="overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3 text-right">Live menu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border)]">
              {vendors.map((v, i) => {
                const key = v.slug || v.id || String(i);
                const busy = fetching && fetchingKey === (v.slug || v.id);
                return (
                  <tr key={key} className="bg-[var(--admin-surface)] transition hover:bg-[var(--admin-surface-hover)]">
                    <td className="px-4 py-3 font-medium text-[var(--admin-text)]">{v.name}</td>
                    <td className="px-4 py-3 text-[var(--admin-text-muted)]">
                      {v.slug ? <Badge tone="neutral">{v.slug}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="confirm"
                        size="sm"
                        disabled={!v.fetchable || fetching}
                        onClick={() => runFetch(v)}
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
