/**
 * R41 S10: every banking page (vault tabs, documents, approvals, operations,
 * guide, calendar, library, file checker) shows the STOP card at the top,
 * and a red "pay by check" banner while a Timberland termination notice is
 * open in the log (section 30).
 *
 * The pages still check their own permission; this layout shows nothing to
 * a person who is not signed in (the pages redirect them). A failed read of
 * the log never hides the STOP card: the card needs nothing from the
 * database except the time of a logged compromise call, which is optional.
 */
import { getStaffSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { pacificToday } from "@/lib/reports/timezone";
import { readTimberlandCommsCached } from "@/lib/payments/timberland-comms-store";
import { latestOpenCompromiseCall, terminationBannerText, terminationInEffect } from "@/lib/payments/timberland-obligations-core";
import { StopCard } from "./StopCard";

export default async function BankingLayout({ children }: { children: React.ReactNode }) {
  const session = await getStaffSession();
  if (!session || !can(session.profile.role, "ach.request")) return <>{children}</>;
  const today = pacificToday();
  const comms = await readTimberlandCommsCached();
  const rows = comms.ok ? comms.rows : [];
  const ending = terminationInEffect(rows);
  return (
    <>
      <div className="space-y-2 px-5 pt-4 sm:px-8">
        {ending ? (
          <p id="termination-banner" role="alert" className="rounded-[var(--admin-radius)] border border-red-500/50 bg-red-500/[0.12] px-4 py-3 text-sm font-semibold text-red-200">
            {terminationBannerText(ending.endsOn, today)}
          </p>
        ) : null}
        <StopCard todayIso={today} calledAtUtc={latestOpenCompromiseCall(rows)} />
      </div>
      {children}
    </>
  );
}
