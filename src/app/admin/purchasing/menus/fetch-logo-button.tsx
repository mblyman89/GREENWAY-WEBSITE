"use client";

/**
 * D212 — "Fetch logo" / "Replace logo" for one vendor, and "Fetch all missing
 * logos" for the whole list. One click finds the vendor's profile on GrowFlow,
 * Cultivera or LeafLink, saves the logo to the Media Library, publishes it, and
 * attaches it to the vendor AND its brands so it shows on the website — no
 * second trip to the vendor profile.
 *
 * The bulk button loops: each server call works through a few vendors (so one
 * request can't time out) and the island keeps calling while there are more
 * left AND the last batch tried someone. Vendors already tried in this run are
 * passed back as `skip_ids`, so a vendor with no findable logo is never
 * retried in a loop.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import { logoPlatformLabel } from "@/lib/purchasing/vendor-logo-core";
import { fetchVendorLogoAction, fetchMissingLogosAction } from "./actions";

export function FetchLogoButton({
  vendorId,
  vendorName,
  logoUrl,
}: {
  vendorId: string;
  vendorName: string;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const has = Boolean(logoUrl);

  const run = useCallback(
    async (replace: boolean) => {
      if (replace && !window.confirm(`Replace ${vendorName}'s current logo with the one on its marketplace profile?`)) return;
      setBusy(true);
      setMsg(null);
      const fd = new FormData();
      fd.set("vendor_id", vendorId);
      if (replace) fd.set("replace", "1");
      try {
        const res = await fetchVendorLogoAction(fd);
        setMsg({ ok: res.ok, text: res.message });
        if (res.results.some((r) => r.outcome === "attached")) router.refresh();
      } catch {
        setMsg({ ok: false, text: "The request failed (network or time limit). Try again." });
      } finally {
        setBusy(false);
      }
    },
    [vendorId, vendorName, router],
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- tiny admin thumbnail from our own public bucket
          <img
            src={logoUrl}
            alt={`${vendorName} logo`}
            className="h-8 w-8 shrink-0 rounded border border-[var(--admin-border)] bg-white object-contain"
          />
        ) : null}
        <Button
          type="button"
          variant="neutral"
          size="sm"
          disabled={busy}
          onClick={() => run(has)}
          title={
            has
              ? "Find this vendor's logo on GrowFlow, Cultivera or LeafLink and replace the current one (vendor + brands)"
              : "Find this vendor's logo on GrowFlow, Cultivera or LeafLink, attach it to the vendor and its brands, and publish it to the website"
          }
        >
          {busy ? "Finding logo…" : has ? "Replace logo" : "Fetch logo"}
        </Button>
      </div>
      {msg && (
        <span
          role="status"
          className={`max-w-[16rem] text-[0.65rem] leading-snug ${
            msg.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"
          }`}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}

export function FetchAllLogosButton({ missing }: { missing: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lines, setLines] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = useCallback(async () => {
    cancelled.current = false;
    setRunning(true);
    setLines([]);
    const tried: string[] = [];
    let attached = 0;
    for (let i = 0; i < 200; i += 1) {
      if (cancelled.current) break;
      const fd = new FormData();
      fd.set("skip_ids", tried.join(","));
      let res: Awaited<ReturnType<typeof fetchMissingLogosAction>>;
      try {
        res = await fetchMissingLogosAction(fd);
      } catch {
        setStatus("Stopped on a network error or time limit. Click again to continue where it left off.");
        break;
      }
      if (!res.ok) {
        setStatus(res.message);
        break;
      }
      for (const r of res.results) {
        tried.push(r.vendorId);
        if (r.outcome === "attached") attached += 1;
      }
      setLines((prev) => [
        ...prev,
        ...res.results.map((r) => ({
          name: r.vendorName,
          ok: r.outcome === "attached",
          text: r.outcome === "attached" ? `attached from ${r.platform ? logoPlatformLabel(r.platform) : "a marketplace"}` : `${r.outcome.replace(/_/g, " ")}${r.notes[0] ? ` — ${r.notes[0]}` : ""}`,
        })),
      ]);
      setStatus(`${attached} attached · ${tried.length} tried · ${res.remaining} left`);
      // Stop when nothing is left, or when a batch made no progress (never spin).
      if (res.remaining <= 0 || res.results.length === 0) break;
    }
    setStatus((s) => (s ? `Done. ${s}` : "Done."));
    setRunning(false);
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button type="button" variant="save" size="sm" disabled={running || missing === 0} onClick={run}>
        {running ? "Fetching logos…" : missing === 0 ? "Every vendor we carry has a logo" : `Fetch all missing logos (${missing})`}
      </Button>
      {status && <span className="max-w-sm text-right text-[0.65rem] leading-snug text-[var(--admin-text-muted)]">{status}</span>}
      {lines.length > 0 && (
        <details className="max-w-md text-right text-[0.65rem]">
          <summary className="cursor-pointer text-[var(--admin-text-faint)]">Per-vendor report ({lines.length})</summary>
          <ul className="mt-1 space-y-0.5 text-left">
            {lines.map((l, i) => (
              <li key={`${l.name}-${i}`} className={l.ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"}>
                <span className="font-medium">{l.name}</span>: {l.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
