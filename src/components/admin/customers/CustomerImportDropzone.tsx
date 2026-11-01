"use client";
/**
 * G-73 (owner message 15): "I would much rather just drag and drop the file
 * in then paste the spreadsheet into the box."
 *
 * Drop (or choose) the Cultivera customer export, .xlsx or .csv. The file is
 * read here in the browser, cleaned by customer-import-core, shown as a
 * plain-English preview, and only imported when the person presses Import.
 * Customers go to the server in batches with a progress bar; a failed batch
 * can be retried and re-sending never duplicates (matching is by Customer ID).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IMPORT_BATCH_SIZE,
  chunk,
  describeReport,
  mapCustomerGrid,
  parseCsv,
  type Grid,
  type MappedImport,
} from "@/lib/customers/customer-import-core";
import { finishCustomerImportAction, importCustomerBatchAction } from "@/app/admin/customers/import/actions";

const MAX_BYTES = 25 * 1024 * 1024;
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function readGrid(file: File): Promise<Grid> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") return parseCsv(await file.text());
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return [];
  return XLSX.utils.sheet_to_json<Grid[number]>(wb.Sheets[first], { header: 1, raw: true, defval: null });
}

type Totals = { inserted: number; updated: number; rejected: number };

export function CustomerImportDropzone({ today }: { today: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mapped, setMapped] = useState<MappedImport | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(0);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function pick(files: FileList | null) {
    const f = files?.[0];
    if (!f || running) return;
    setError(null);
    setMapped(null);
    setTotals(null);
    setSent(0);
    setDone(false);
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      setError(`"${f.name}" is not a spreadsheet. Drop the .xlsx or .csv file you exported from Cultivera.`);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`"${f.name}" is ${size(f.size)}. The largest file this page reads is 25 MB.`);
      return;
    }
    setFile(f);
    setReading(true);
    try {
      const m = mapCustomerGrid(await readGrid(f), today);
      if (m.error) setError(m.error);
      else setMapped(m);
    } catch {
      setError(`We could not read "${f.name}". Open it in Excel, check it shows the customer list, save it, and drop it again.`);
    } finally {
      setReading(false);
    }
  }

  async function run(fromBatch: number) {
    if (!mapped || running) return;
    setRunning(true);
    setError(null);
    const batches = chunk(mapped.rows, IMPORT_BATCH_SIZE);
    const t: Totals = fromBatch === 0 ? { inserted: 0, updated: 0, rejected: 0 } : { ...(totals ?? { inserted: 0, updated: 0, rejected: 0 }) };
    try {
      for (let i = fromBatch; i < batches.length; i++) {
        let res;
        try {
          res = await importCustomerBatchAction(batches[i]);
        } catch {
          res = { ok: false, inserted: 0, updated: 0, rejected: 0, error: "the connection dropped" };
        }
        if (!res.ok) {
          setError(
            `Stopped after ${(i * IMPORT_BATCH_SIZE).toLocaleString("en-US")} of ${mapped.rows.length.toLocaleString("en-US")} customers: ${res.error ?? "the save failed"}. Press "Continue" to pick up where it stopped. Nothing is duplicated.`,
          );
          setTotals({ ...t });
          return;
        }
        t.inserted += res.inserted;
        t.updated += res.updated;
        t.rejected += res.rejected;
        setTotals({ ...t });
        setSent(i + 1);
      }
      await finishCustomerImportAction();
      setDone(true);
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  const batches = mapped ? Math.ceil(mapped.rows.length / IMPORT_BATCH_SIZE) : 0;
  const pct = batches ? Math.round((sent / batches) * 100) : 0;
  const n = (x: number) => x.toLocaleString("en-US");

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop the Cultivera customer export here, or press to choose the file"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void pick(e.dataTransfer.files);
        }}
        onClick={() => !running && input.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !running) input.current?.click();
        }}
        className={`cursor-pointer rounded-[var(--admin-radius-lg)] border-2 border-dashed px-6 py-10 text-center transition ${
          drag
            ? "border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]"
            : "border-[var(--admin-border)] bg-[var(--admin-surface)] hover:border-[var(--admin-accent)]/60"
        }`}
      >
        <div className="text-3xl" aria-hidden>
          📥
        </div>
        <div className="mt-2 text-sm font-bold text-[var(--admin-text)]">
          Drop the Cultivera customer export here, or click to choose it
        </div>
        <div className="mt-1 text-xs text-[var(--admin-text-muted)]">
          The .xlsx file exactly as Cultivera gives it (a .csv works too). Nothing is saved until you press Import.
        </div>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          hidden
          onChange={(e) => {
            void pick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {reading ? <div className="text-sm text-[var(--admin-text-muted)]">Reading {file?.name}…</div> : null}

      {error ? (
        <div className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-3 text-sm text-[var(--admin-danger)]">
          {error}
        </div>
      ) : null}

      {mapped ? (
        <div className="space-y-4 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <div className="text-xs text-[var(--admin-text-muted)]">
            {file?.name} · {file ? size(file.size) : ""}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--admin-text)]">
            {describeReport(mapped.report).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            {[
              ["With a phone", mapped.report.withPhone],
              ["With an email", mapped.report.withEmail],
              ["With a birthday", mapped.report.withBirthday],
              ["Medical", mapped.report.medical],
              ["With Total Spent", mapped.report.withSpend],
              ["With Last Purchase", mapped.report.withLastPurchase],
              ["With Date Created", mapped.report.withCreatedDate],
              ["Veteran", mapped.report.veterans],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2">
                <div className="text-[var(--admin-text-muted)]">{label}</div>
                <div className="text-base font-bold text-[var(--admin-text)]">{n(v as number)}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--admin-text-muted)]">
                <tr>
                  {["Customer ID", "Name", "Phone", "Email", "Birthday", "Total spent", "Last purchase", "Customer since", "Tax"].map((h) => (
                    <th key={h} className="px-2 py-1 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[var(--admin-text)]">
                {mapped.rows.slice(0, 5).map((r) => (
                  <tr key={r.external_id} className="border-t border-[var(--admin-border)]">
                    <td className="px-2 py-1">{r.external_id}</td>
                    <td className="px-2 py-1">{[r.first_name, r.last_name].filter(Boolean).join(" ")}</td>
                    <td className="px-2 py-1">{r.phone ?? "—"}</td>
                    <td className="px-2 py-1">{r.email ?? "—"}</td>
                    <td className="px-2 py-1">{r.birthdate ?? "—"}</td>
                    <td className="px-2 py-1">${(r.imported_spend_minor_units / 100).toFixed(2)}</td>
                    <td className="px-2 py-1">{r.last_purchase_at ? r.last_purchase_at.slice(0, 10) : "—"}</td>
                    <td className="px-2 py-1">{r.imported_created_at ? r.imported_created_at.slice(0, 10) : "—"}</td>
                    <td className="px-2 py-1">{r.tax_designations ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1 text-[11px] text-[var(--admin-text-muted)]">First 5 customers, as they will be saved.</div>
          </div>

          {sent > 0 || running ? (
            <div>
              <div className="h-2 overflow-hidden rounded bg-[var(--admin-border)]">
                <div className="h-full bg-[var(--admin-accent)] transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-xs text-[var(--admin-text-muted)]">
                {n(Math.min(sent * IMPORT_BATCH_SIZE, mapped.rows.length))} of {n(mapped.rows.length)} customers saved ({pct}%)
                {totals ? ` · ${n(totals.inserted)} new, ${n(totals.updated)} updated` : ""}
              </div>
            </div>
          ) : null}

          {done && totals ? (
            <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-3 text-sm text-[var(--admin-accent)]">
              Done. {n(totals.inserted)} new customers added and {n(totals.updated)} existing customers updated
              {totals.rejected ? `; ${n(totals.rejected)} rows were refused as incomplete` : ""}. You can import the file again any time; it updates, never duplicates.
            </div>
          ) : (
            <button
              type="button"
              disabled={running}
              onClick={() => void run(sent > 0 && sent < batches ? sent : 0)}
              className="rounded-[var(--admin-radius)] bg-[var(--admin-accent)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
            >
              {running ? "Importing… keep this page open" : sent > 0 && sent < batches ? "Continue" : `Import ${n(mapped.rows.length)} customers`}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
