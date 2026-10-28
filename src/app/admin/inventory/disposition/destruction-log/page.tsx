/**
 * /admin/inventory/disposition/destruction-log?month=YYYY-MM
 *
 * Fix Phase 1.6a (G-43 req 6; D64): the printable Destruction log for one
 * Pacific month: what, when, method, mix, destination, facility, witness,
 * camera, who. It is form 8.3 in the app; print it and keep it five years
 * (WAC 314-55-097). Requires inventory.manage. Times are Pacific (F-15-5).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { listCompletedDestructionsForMonth } from "@/lib/inventory/disposition";
import { RENDERING_METHOD_LABELS, type RenderingMethod } from "@/lib/inventory/disposition-core";
import {
  cameraCell,
  formatDestructionPacific,
  parseLogMonth,
} from "@/lib/inventory/destruction-record-core";
import { pacificParts } from "@/lib/reports/timezone";
import { PrintButton } from "@/components/admin/orders/PrintButton";

export const dynamic = "force-dynamic";

function currentMonth(): string {
  const p = pacificParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export default async function DestructionLogPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const month = parseLogMonth(sp.month) ?? currentMonth();
  const rows = await listCompletedDestructionsForMonth(month);

  return (
    <div className="min-h-screen bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/admin/inventory/disposition" className="text-xs underline">
          Back to Returns &amp; Destruction
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <Link href={`?month=${shiftMonth(month, -1)}`} className="underline">
            Previous month
          </Link>
          <Link href={`?month=${shiftMonth(month, 1)}`} className="underline">
            Next month
          </Link>
          <PrintButton />
        </div>
      </div>
      <h1 className="text-lg font-black">Greenway Marijuana: Destruction log, {month}</h1>
      <p className="mb-3 text-xs">
        WSLCB license 413541. Completed destructions in this month (Pacific time). Each was rendered unusable on the
        premises, witnessed by a second person and recorded on camera (owner decision D64; WAC 314-55-097,
        WAC 314-55-083(3)(a)). Keep this log five years.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm" data-testid="destruction-log-empty">
          No completed destructions in {month}.
        </p>
      ) : (
        <table className="w-full border-collapse text-[11px]" data-testid="destruction-log-table">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="p-1">Destroyed (Pacific)</th>
              <th className="p-1">Product / lot</th>
              <th className="p-1">Qty</th>
              <th className="p-1">Reason</th>
              <th className="p-1">Method and mix</th>
              <th className="p-1">Destination / facility</th>
              <th className="p-1">Witness</th>
              <th className="p-1">Camera</th>
              <th className="p-1">Completed by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const method = r.rendering_method
                ? (RENDERING_METHOD_LABELS[r.rendering_method as RenderingMethod] ?? r.rendering_method)
                : (r.method ?? "");
              return (
                <tr key={r.id} className="border-b border-black/30 align-top">
                  <td className="p-1">{formatDestructionPacific(r.completed_at)}</td>
                  <td className="p-1">
                    {r.product_name ?? "\u2014"} <span className="font-mono">{r.lot_code ?? r.lot_id.slice(0, 8)}</span>
                  </td>
                  <td className="p-1">
                    {r.quantity} {r.unit ?? ""}
                  </td>
                  <td className="p-1">{r.reason.replace(/_/g, " ")}</td>
                  <td className="p-1">
                    {method}
                    {r.mix_material ? ` \u00b7 mixed with ${r.mix_material}` : ""}
                    {r.other_method_approval_ref
                      ? ` \u00b7 LCB approval ${r.other_method_approval_ref}${r.other_method_approval_date ? ` (${r.other_method_approval_date})` : ""}`
                      : ""}
                  </td>
                  <td className="p-1">{[r.final_destination, r.disposal_facility].filter(Boolean).join(" / ")}</td>
                  <td className="p-1">{r.witness_name ?? r.witnessed_by ?? "not recorded"}</td>
                  <td className="p-1">{cameraCell(r)}</td>
                  <td className="p-1">{r.completed_by_name ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
        <p>Reviewed by (owner): ______________________</p>
        <p>Date: ______________________</p>
      </div>
    </div>
  );
}
