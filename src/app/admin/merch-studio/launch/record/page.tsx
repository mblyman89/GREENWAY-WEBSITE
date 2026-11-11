/**
 * /admin/merch-studio/launch/record: form 8.1, Merch setup record, already
 * filled in (D232 slice M-3a, G-78, SOP-11 §8 form 8.1). Printable on white
 * paper (window.print(), "Save as PDF" in every browser). Owner & admin.
 *
 * It reads the LAST SAVED Merch Health run (not a live check) so printing is
 * instant; press Run check now on Setup & Launch first for a fresh one.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { PrintRecordButton } from "@/components/admin/merch-studio/LaunchControls";
import { latestMerchHealthReport, readHealthSettings } from "@/lib/merch/merch-health-server";
import { readLaunchProgress } from "@/lib/merch/merch-launch-server";
import { MERCH_LAUNCH_PAGE, stepNumber, summarizeLaunch } from "@/lib/merch/merch-launch-core";

export const dynamic = "force-dynamic";

const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium" }) : "");

export default async function MerchLaunchRecordPage() {
  await requirePermission("settings.manage");
  const [last, prog, settings] = await Promise.all([latestMerchHealthReport(), readLaunchProgress(), readHealthSettings()]);
  const sum = summarizeLaunch(last.report, prog.progress);
  const n = prog.progress.notes;
  const noteFor: Record<string, string> = {
    "S-2": n.storeName ? `store name: ${n.storeName}` : "store name:",
    "S-3": n.certStatus ? `cert status: ${n.certStatus}` : "cert status:",
    "S-4": settings.printfulTokenExpires ? `expires: ${settings.printfulTokenExpires}` : "expires:",
    T: n.liveDate ? `live on: ${n.liveDate}` : "",
  };

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={MERCH_LAUNCH_PAGE} className="text-sm underline">
          ← Back to Setup & Launch
        </Link>
        <PrintRecordButton />
      </div>
      <h1 className="text-xl font-bold">Form 8.1: Merch setup record</h1>
      <p className="text-sm">Greenway Merchandising LLC (dba Greenway Glass &amp; Goods) · greenwaymerch.com · SOP-11 §4.2 and §4.5</p>
      <p className="mt-1 text-xs">
        Printed {day(new Date().toISOString())}. Health checks as of {last.report ? day(last.report.at) : "never (press Run check now)"}. {sum.done} of {sum.total} steps done.
      </p>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr>
            {["#", "Step (§4.2)", "Done", "Date", "Notes / expiry"].map((h) => (
              <th key={h} className="border border-black px-2 py-1 text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sum.steps.map((s) => {
            const tick = prog.progress.ticks[s.step.id];
            return (
              <tr key={s.step.id}>
                <td className="border border-black px-2 py-1">{s.step.id === "T" ? "4.5" : s.step.id}</td>
                <td className="border border-black px-2 py-1">{stepNumber(s.step.id)}: {s.step.title}</td>
                <td className="border border-black px-2 py-1">{s.status === "done" ? "☑" : s.status === "needs-you" ? "☒" : "☐"}</td>
                <td className="border border-black px-2 py-1">{tick ? day(tick.at) : ""}</td>
                <td className="border border-black px-2 py-1">{noteFor[s.step.id] ?? ""}</td>
              </tr>
            );
          })}
          <tr>
            <td className="border border-black px-2 py-1" />
            <td className="border border-black px-2 py-1">Vercel analytics token expiry</td>
            <td className="border border-black px-2 py-1" />
            <td className="border border-black px-2 py-1" />
            <td className="border border-black px-2 py-1">expires: {n.analyticsTokenExpires ?? ""}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1" />
            <td className="border border-black px-2 py-1">Signed (owner)</td>
            <td className="border border-black px-2 py-1" />
            <td className="border border-black px-2 py-1">{n.signedOn ?? ""}</td>
            <td className="border border-black px-2 py-1">{n.signedBy ?? ""}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-6 text-sm">Signature: ______________________________ Date: ______________</p>
      <p className="mt-2 text-xs">Update on every token change: update both projects, redeploy both, re-run S-10 if Token C or the Printful token changed, and print this again.</p>
    </div>
  );
}
