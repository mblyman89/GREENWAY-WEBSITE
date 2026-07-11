"use client";
/**
 * src/app/admin/discovery/ccrs/CcrsZipUploader.tsx
 *
 * Task H (S3): the ZERO-TOUCH monthly-extract uploader. The owner drags the
 * ONE big zip from the WSLCB public-records delivery straight onto this card;
 * the transformer (S1 zip reader + parser, S2 aggregator) runs IN THE BROWSER
 * over the local file — the ~1 GB raw never leaves the machine (Vercel body
 * limits forbid it anyway) — and only the compact rollup JSON (~1 MB) is
 * posted to the server action.
 *
 * Flow: drop zip → read central directory → process inner table zips in
 * dependency order (Licensee → Strains → Product → Inventory → SaleHeader →
 * SalesDetail) → aggregate → POST rollups → dataset flips uploading → ready.
 * Errors are surfaced verbatim, never force-fit (NEVER GUESS).
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  readZipEntries,
  readZipEntryBytes,
  openZipEntryStream,
  bytesAsBlob,
  type ZipEntry,
} from "@/lib/discovery/ccrs-extract/zip";
import {
  decodeStream,
  streamTable,
  tableNameFromZipEntry,
  SKIPPED_TABLES,
  mapLicensee,
  mapProduct,
  mapInventory,
  mapStrain,
  mapSaleHeader,
  mapSaleDetail,
} from "@/lib/discovery/ccrs-extract/parse";
import { CcrsAggregator } from "@/lib/discovery/ccrs-extract/aggregate";
import { saveMonthlyRollupsAction } from "../actions";

type Phase = "idle" | "reading" | "aggregating" | "saving" | "done" | "error";

type Progress = {
  phase: Phase;
  fileLabel: string;
  filesDone: number;
  filesTotal: number;
  rows: number;
  message: string | null;
};

const IDLE: Progress = { phase: "idle", fileLabel: "", filesDone: 0, filesTotal: 0, rows: 0, message: null };

/** Dependency order for the table passes (reference tables before sales). */
const TABLE_ORDER = ["licensee", "strains", "product", "inventory", "saleheader", "salesdetail"];

function orderRank(name: string): number {
  const t = tableNameFromZipEntry(name);
  for (let i = 0; i < TABLE_ORDER.length; i += 1) {
    if (t === TABLE_ORDER[i] || t.startsWith(TABLE_ORDER[i])) return i;
  }
  return TABLE_ORDER.length;
}

export function CcrsZipUploader({
  selfLicenseNumber,
  trackedLicenseNumbers,
}: {
  selfLicenseNumber: string;
  trackedLicenseNumbers: string[];
}) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>(IDLE);
  const [dragOver, setDragOver] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (file: File) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        setProgress({ ...IDLE, phase: "reading", fileLabel: file.name, message: "Reading zip directory…" });

        // The browser File natively satisfies the transformer's BlobLike.
        const entries = await readZipEntries(file);
        const innerZips = entries
          .filter((e) => e.name.toLowerCase().endsWith(".zip"))
          .filter((e) => {
            const t = tableNameFromZipEntry(e.name);
            return !SKIPPED_TABLES.has(t) && !t.startsWith("labresult");
          })
          .sort((a, b) => orderRank(a.name) - orderRank(b.name) || a.name.localeCompare(b.name));
        if (innerZips.length === 0) {
          throw new Error(
            "No CCRS table zips found inside this file. Drop the FULL monthly delivery zip (it contains Licensee/Product/Inventory/SaleHeader/SalesDetail zips).",
          );
        }

        const agg = new CcrsAggregator({ selfLicenseNumber, trackedLicenseNumbers });
        // Pre-size the big joins from chunk counts (≤1M rows per chunked file).
        const count = (t: string) =>
          innerZips.filter((e) => tableNameFromZipEntry(e.name) === t).length;
        agg.reserve({
          inventoryRows: count("inventory") * 1_000_000,
          saleHeaderRows: count("saleheader") * 1_000_000,
        });

        let rows = 0;
        let done = 0;
        for (const entry of innerZips) {
          setProgress({
            phase: "aggregating",
            fileLabel: file.name,
            filesDone: done,
            filesTotal: innerZips.length,
            rows,
            message: `Processing ${shortName(entry)}…`,
          });
          const innerBytes = await readZipEntryBytes(file, entry);
          const innerBlob = bytesAsBlob(innerBytes);
          const innerEntries = await readZipEntries(innerBlob);
          for (const csvEntry of innerEntries) {
            if (!csvEntry.name.toLowerCase().endsWith(".csv")) continue;
            const stream = await openZipEntryStream(innerBlob, csvEntry);
            const res = await streamTable(decodeStream(stream), (kind, cells, idx) => {
              if (kind === "licensee") {
                const r = mapLicensee(cells, idx);
                if (r) agg.addLicensee(r);
              } else if (kind === "strain") {
                const r = mapStrain(cells, idx);
                if (r) agg.addStrain(r);
              } else if (kind === "product") {
                const r = mapProduct(cells, idx);
                if (r) agg.addProduct(r);
              } else if (kind === "inventory") {
                const r = mapInventory(cells, idx);
                if (r) agg.addInventory(r);
              } else if (kind === "sale_header") {
                const r = mapSaleHeader(cells, idx);
                if (r) agg.addSaleHeader(r);
              } else if (kind === "sale_detail") {
                const r = mapSaleDetail(cells, idx);
                if (r) agg.addSaleDetail(r);
              }
            });
            rows += res.rowCount;
          }
          done += 1;
          setProgress({
            phase: "aggregating",
            fileLabel: file.name,
            filesDone: done,
            filesTotal: innerZips.length,
            rows,
            message: null,
          });
        }

        const result = agg.result();
        setProgress((p) => ({ ...p, phase: "saving", message: "Saving rollups…" }));
        const saved = await saveMonthlyRollupsAction({
          fileName: file.name,
          result: JSON.parse(JSON.stringify(result)),
        });
        if (!saved.ok) throw new Error(saved.error ?? "Saving the rollups failed.");

        setProgress({
          phase: "done",
          fileLabel: file.name,
          filesDone: done,
          filesTotal: innerZips.length,
          rows,
          message: `Saved ${saved.benchmarks?.toLocaleString()} benchmark rows, ${saved.competitors} competitor profiles and ${saved.signals} market signals for ${result.periodStart ?? "?"} → ${result.periodEnd ?? "?"}.`,
        });
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Processing failed.";
        setProgress((p) => ({ ...p, phase: "error", message }));
      } finally {
        busyRef.current = false;
      }
    },
    [router, selfLicenseNumber, trackedLicenseNumbers],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void run(file);
    },
    [run],
  );

  const busy = progress.phase === "reading" || progress.phase === "aggregating" || progress.phase === "saving";
  const pct =
    progress.filesTotal > 0 ? Math.round((progress.filesDone / progress.filesTotal) * 100) : 0;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop the monthly CCRS zip here or click to choose it"
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!busy && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--admin-radius-lg)] border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]"
            : "border-[var(--admin-border)] bg-[var(--admin-surface-2)] hover:border-[var(--admin-accent)]/60"
        } ${busy ? "pointer-events-none opacity-90" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void run(file);
            e.target.value = "";
          }}
        />
        {progress.phase === "idle" ? (
          <>
            <div className="text-sm font-semibold text-[var(--admin-text)]">
              Drag &amp; drop the monthly CCRS zip here
            </div>
            <div className="text-xs text-[var(--admin-text-muted)]">
              The one big zip from the WSLCB delivery — nested zips and all. It&apos;s processed right
              here in your browser (the raw file never uploads); only the small market rollups are
              saved. Takes a few minutes for a full month.
            </div>
          </>
        ) : null}
        {busy ? (
          <div className="w-full max-w-md space-y-2">
            <div className="text-sm font-semibold text-[var(--admin-text)]">
              {progress.phase === "reading"
                ? "Reading zip…"
                : progress.phase === "saving"
                  ? "Saving rollups…"
                  : `Crunching ${progress.fileLabel}`}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--admin-surface)]">
              <div
                className="h-full rounded-full bg-[var(--admin-accent)] transition-all"
                style={{ width: `${progress.phase === "saving" ? 100 : pct}%` }}
              />
            </div>
            <div className="text-xs text-[var(--admin-text-muted)]">
              {progress.filesTotal > 0
                ? `${progress.filesDone}/${progress.filesTotal} table files · ${progress.rows.toLocaleString()} rows scanned`
                : null}
              {progress.message ? ` · ${progress.message}` : null}
            </div>
            <div className="text-[11px] text-[var(--admin-text-muted)]">
              Keep this tab open — closing it stops the crunch (nothing partial is saved).
            </div>
          </div>
        ) : null}
        {progress.phase === "done" ? (
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[var(--admin-accent)]">Done ✓</div>
            <div className="text-xs text-[var(--admin-text)]">{progress.message}</div>
            <div className="text-[11px] text-[var(--admin-text-muted)]">
              Drop next month&apos;s zip here whenever it arrives.
            </div>
          </div>
        ) : null}
        {progress.phase === "error" ? (
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[var(--admin-danger)]">Something went wrong</div>
            <div className="text-xs text-[var(--admin-text)]">{progress.message}</div>
            <div className="text-[11px] text-[var(--admin-text-muted)]">
              Nothing was saved. Fix the file (it should be the original monthly delivery zip) and
              drop it again.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function shortName(entry: ZipEntry): string {
  const parts = entry.name.split("/");
  return parts[parts.length - 1] || entry.name;
}
