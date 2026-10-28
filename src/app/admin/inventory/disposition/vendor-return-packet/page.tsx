/**
 * /admin/inventory/disposition/vendor-return-packet?id=<vendor return id>
 *
 * Fix Phase 1.7b (G-42 req 7): the printable vendor-return packet, form 8.2
 * of SOP-15 filled in from the app. Owner (message 4): "please also build the
 * printable vendor-return packet (G-42)." Print it, staple the RMA email, the
 * LCB success email and the manifest PDF to it, and file it by month for five
 * years (WAC 314-55-087; SOP-15 §4.13 step 3).
 *
 * Every value comes from the stored return, its lot, its vendor, the store's
 * license settings and the staff roster (getVendorReturnPacket). What the app
 * does not hold prints as a blank line to fill by hand; nothing is guessed
 * (vendor-return-packet-core buildVendorReturnPacket). Requires
 * inventory.manage. Times are Pacific (F-15-5).
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { getVendorReturnPacket } from "@/lib/inventory/disposition";
import { buildVendorReturnPacket } from "@/lib/inventory/vendor-return-packet-core";
import { isUuid } from "@/lib/inventory/destruction-evidence-core";
import { PrintButton } from "@/components/admin/orders/PrintButton";

export const dynamic = "force-dynamic";

export default async function VendorReturnPacketPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requirePermission("inventory.manage");
  const sp = await searchParams;
  const id = isUuid(sp.id) ? sp.id : null;
  const data = id ? await getVendorReturnPacket(id) : null;
  if (!data) {
    return (
      <div className="min-h-screen bg-white p-6 text-black">
        <Link href="/admin/inventory/disposition" className="text-xs underline">
          Back to Returns &amp; Destruction
        </Link>
        <p className="mt-4 text-sm" data-testid="vendor-return-packet-missing">
          That vendor return was not found. Open it from Vendor returns &amp; manifests.
        </p>
      </div>
    );
  }
  const sections = buildVendorReturnPacket({ ret: data.ret, lot: data.lot, vendor: data.vendor, origin: data.origin, names: data.names });

  return (
    <div className="min-h-screen bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/admin/inventory/disposition" className="text-xs underline">
          Back to Returns &amp; Destruction
        </Link>
        <PrintButton />
      </div>
      <h1 className="text-lg font-black">Greenway Marijuana: Vendor-return packet</h1>
      <p className="mb-3 text-xs">
        Form 8.2 (SOP-15), filled in from the app; Pacific time. Greenway is the origin of the CCRS manifest. Staple the
        processor&apos;s RMA email, the LCB success email and the printed manifest PDF to this sheet. File by month and keep
        five years (WAC 314-55-087). Blank lines are what the app does not hold: fill them by hand.
      </p>
      <div className="space-y-3" data-testid="vendor-return-packet">
        {sections.map((s) => (
          <section key={s.key} className="break-inside-avoid" data-testid={`packet-section-${s.key}`}>
            <h2 className="border-b-2 border-black text-[12px] font-black">
              {s.title}
              {s.key.startsWith("step") && s.key !== "step6" ? (
                <span className="ml-2 font-normal">{s.done ? "[x] done in the app" : "[ ] not yet"}</span>
              ) : null}
            </h2>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.label} className="border-b border-black/20 align-top">
                    <th className={`${r.value ? "w-72" : ""} p-1 text-left font-semibold`} colSpan={r.value ? 1 : 2}>
                      {r.label}
                    </th>
                    {r.value ? (
                      <td className="p-1" data-testid={r.testid}>
                        {r.value}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-8 text-xs">
        <p>Driver signature: ______________________</p>
        <p>Our signature: ______________________</p>
        <p>Reviewed by (owner): ______________________</p>
        <p>Filed (month): ______________________</p>
      </div>
    </div>
  );
}
