"use client";

/**
 * D241 — Budalerts controls on the Vendor Menus page.
 *
 *   - BudalertsRowControls: on each "Still need a menu" / "Done" row — the
 *     linked Budalerts brands (Fetch / View listings / Unlink), exact-slug
 *     suggestions (one click to link), and a box to link a slug by hand.
 *   - FetchAllBudalertsButton: loops the batch action (a few brands per call,
 *     3 s between requests, server-held lease) while brands are still due and
 *     Budalerts has not asked us to slow down.
 *   - RefreshBudalertsSlugsButton: re-reads Budalerts' Washington brand list
 *     (one request) so suggestions stay current.
 *   - SaveBudalertsImageButton / SaveAllBudalertsImagesButton: photos into the
 *     Media Library as drafts (internal use only).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import type { BudalertsLinkedBrand, SlugSuggestion } from "@/lib/purchasing/budalerts-core";
import { linkedBrandStatusLabel } from "@/lib/purchasing/budalerts-core";
import {
  fetchBudalertsBrandAction,
  fetchDueBudalertsAction,
  linkBudalertsBrandAction,
  refreshBudalertsSlugsAction,
  saveAllBudalertsImagesAction,
  saveBudalertsImageAction,
  unlinkBudalertsBrandAction,
} from "./budalerts-actions";

const BASE = "/admin/purchasing/menus";
const FAINT = "text-[0.65rem] leading-snug text-[var(--admin-text-faint)]";
const LINK = "text-[var(--admin-accent)] hover:underline";

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <span role="status" className={`max-w-[18rem] text-[0.65rem] leading-snug ${msg.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"}`}>
      {msg.text}
    </span>
  );
}

export function BudalertsRowControls({
  vendorId,
  vendorName,
  linked,
  suggestions,
}: {
  vendorId: string;
  vendorName: string;
  linked: BudalertsLinkedBrand[];
  suggestions: SlugSuggestion[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [slugInput, setSlugInput] = useState("");

  const call = useCallback(
    async (key: string, fn: () => Promise<{ ok: boolean; message: string }>) => {
      setBusy(key);
      setMsg(null);
      try {
        const r = await fn();
        setMsg({ ok: r.ok, text: r.message });
        router.refresh();
      } catch {
        setMsg({ ok: false, text: "The request failed (network or time limit). Try again." });
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const link = (slug: string, brandName: string | null, thenFetch: boolean) =>
    call(`link:${slug}`, async () => {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("slug", slug);
      if (brandName) fd.set("brand_name", brandName);
      const r = await linkBudalertsBrandAction(fd);
      if (!r.ok || !thenFetch) return r;
      const f = new FormData();
      f.set("slug", slug);
      return fetchBudalertsBrandAction(f);
    });

  const fetchOne = (slug: string) =>
    call(`fetch:${slug}`, () => {
      const fd = new FormData();
      fd.set("slug", slug);
      return fetchBudalertsBrandAction(fd);
    });

  const unlink = (slug: string) => {
    if (!window.confirm(`Unlink Budalerts brand "${slug}" from ${vendorName}? Saved pulls stay on file.`)) return;
    void call(`unlink:${slug}`, () => {
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      fd.set("slug", slug);
      return unlinkBudalertsBrandAction(fd);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {linked.map((b) => (
        <div key={b.slug} className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-[var(--admin-text)]">{b.brandName || b.slug}</span>
            <span className={FAINT}>{linkedBrandStatusLabel(b)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button type="button" variant="neutral" size="sm" disabled={busy !== null} onClick={() => fetchOne(b.slug)} title="Read this brand's Budalerts pages now (about 3 seconds per page)">
              {busy === `fetch:${b.slug}` ? "Fetching…" : b.latestId ? "Refetch" : "Fetch"}
            </Button>
            {b.usableId && (
              <Link href={`${BASE}/budalerts/${b.usableId}?back=${encodeURIComponent(BASE)}`} className={LINK}>
                View listings →
              </Link>
            )}
            <button type="button" className={`${FAINT} hover:underline`} disabled={busy !== null} onClick={() => unlink(b.slug)}>
              unlink
            </button>
          </div>
        </div>
      ))}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {suggestions.slice(0, 3).map((s) => (
            <Button
              key={s.slug}
              type="button"
              variant="confirm"
              size="sm"
              disabled={busy !== null}
              onClick={() => link(s.slug, s.from, true)}
              title={`Budalerts has a brand page "${s.slug}" (exact match on the ${s.how} "${s.from}"). Link it and fetch its listings.`}
            >
              {busy === `link:${s.slug}` ? "Linking…" : `Link + fetch ${s.slug}`}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const slug = slugInput.trim().toLowerCase().replace(/^https?:\/\/budalerts\.com\/brands\//, "").split("/")[0];
          if (slug) void link(slug, null, true);
        }}
      >
        <input
          type="text"
          value={slugInput}
          onChange={(e) => setSlugInput(e.target.value)}
          placeholder="budalerts brand slug"
          aria-label={`Budalerts brand slug for ${vendorName}`}
          className="w-36 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] px-2 py-1 text-[0.7rem] text-[var(--admin-text)] placeholder:text-[var(--admin-text-faint)] focus:border-[var(--admin-accent)] focus:outline-none"
        />
        <Button type="submit" variant="neutral" size="sm" disabled={busy !== null || !slugInput.trim()}>
          Link
        </Button>
      </form>
      <Status msg={msg} />
    </div>
  );
}

export function FetchAllBudalertsButton({ due }: { due: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);
    setMsg(null);
    let total = 0;
    let prevRemaining = Number.POSITIVE_INFINITY;
    try {
      for (let i = 0; i < 200; i += 1) {
        if (cancelled.current) break;
        const r = await fetchDueBudalertsAction();
        total += r.fetched;
        setMsg({ ok: r.ok, text: `${r.message}${total ? ` (${total} brands this run)` : ""}` });
        if (!r.ok || r.stopped || r.remaining <= 0 || r.fetched === 0 || r.remaining >= prevRemaining) break;
        prevRemaining = r.remaining;
      }
    } catch {
      setMsg({ ok: false, text: "The request failed (network or time limit). Click again to continue." });
    } finally {
      setRunning(false);
      router.refresh();
    }
  }, [router]);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button type="button" variant="confirm" size="sm" disabled={running || due === 0} onClick={run}>
          {running ? "Fetching politely…" : `Fetch all due brands (${due})`}
        </Button>
        {running && (
          <Button type="button" variant="neutral" size="sm" onClick={() => (cancelled.current = true)}>
            Stop after this batch
          </Button>
        )}
      </div>
      <Status msg={msg} />
    </div>
  );
}

export function RefreshBudalertsSlugsButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="neutral"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await refreshBudalertsSlugsAction();
            setMsg({ ok: r.ok, text: r.message });
            router.refresh();
          } catch {
            setMsg({ ok: false, text: "The request failed. Try again." });
          } finally {
            setBusy(false);
          }
        }}
        title="One request to Budalerts' Washington brand sitemap; used for exact-name link suggestions"
      >
        {busy ? "Reading brand list…" : count ? `Refresh brand list (${count})` : "Load Budalerts brand list"}
      </Button>
      <Status msg={msg} />
    </div>
  );
}

export function SaveBudalertsImageButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="neutral"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const fd = new FormData();
            fd.set("item_id", itemId);
            const r = await saveBudalertsImageAction(fd);
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) router.refresh();
          } catch {
            setMsg({ ok: false, text: "The request failed. Try again." });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : "Save photo"}
      </Button>
      <Status msg={msg} />
    </div>
  );
}

export function SaveAllBudalertsImagesButton({ snapshotId, remaining }: { snapshotId: string; remaining: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);
    setMsg(null);
    const skip: string[] = [];
    let saved = 0;
    let prev = Number.POSITIVE_INFINITY;
    try {
      for (let i = 0; i < 200; i += 1) {
        if (cancelled.current) break;
        const fd = new FormData();
        fd.set("snapshot_id", snapshotId);
        fd.set("skip_ids", skip.join(","));
        const r = await saveAllBudalertsImagesAction(fd);
        saved += r.saved;
        skip.push(...r.failedIds);
        setMsg({ ok: r.ok, text: `${saved} saved so far. ${r.message}` });
        if (!r.ok || r.remaining <= 0 || r.remaining >= prev) break;
        prev = r.remaining;
      }
    } catch {
      setMsg({ ok: false, text: "The request failed (network or time limit). Click again to continue." });
    } finally {
      setRunning(false);
      router.refresh();
    }
  }, [router, snapshotId]);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="confirm" size="sm" disabled={running || remaining === 0} onClick={run}>
        {running ? "Saving photos…" : remaining ? `Save all photos (${remaining})` : "All photos saved"}
      </Button>
      <Status msg={msg} />
    </div>
  );
}
