import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { onTheClock } from "@/lib/staffing/store";
import { formatMinutes, punchMinutes } from "@/lib/staffing/time";
import { pacificParts } from "@/lib/reports/timezone";
import { PhonePinPad } from "@/components/admin/staffing/PhonePinPad";
import { clockByPinPhoneAction } from "../actions";

export const dynamic = "force-dynamic";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const p = pacificParts(iso);
  const h12 = ((p.hour + 11) % 12) + 1;
  const ampm = p.hour < 12 ? "AM" : "PM";
  return `${h12}:${String(p.minute).padStart(2, "0")} ${ampm}`;
}

/**
 * Phone clock-in — Slice 70 [item 8].
 *
 * A mobile-first, bookmarkable page employees open on their phones to clock in
 * and out with their PIN (source="phone"). Kept intentionally minimal: a big
 * keypad, a confirmation banner, and a small "who's on the clock" list.
 */
export default async function PhoneClockPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; clocked?: string; who?: string }>;
}) {
  // Any active staff session may reach this page; the PIN identifies the person.
  await requirePermission("loyalty.view");
  const sp = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-center text-white/60">
        Time clock is unavailable — the database is not configured.
      </div>
    );
  }

  const clockedIn = await onTheClock();
  const nowISO = new Date().toISOString();

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col px-5 py-8">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-white">Clock In / Out</h1>
        <p className="mt-1 text-sm text-white/50">Now (Pacific): {fmtTime(nowISO)}</p>
      </header>

      {sp.error && (
        <div className="mb-5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
          {decodeURIComponent(sp.error)}
        </div>
      )}
      {sp.clocked && (
        <div className="mb-5 rounded-xl border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-4 text-center text-base font-semibold text-[#7ed957]">
          {sp.who ? `${decodeURIComponent(sp.who)} — ` : ""}Clocked {sp.clocked === "in" ? "IN" : "OUT"} ✓
        </div>
      )}

      <PhonePinPad action={clockByPinPhoneAction} />

      {clockedIn.length > 0 && (
        <div className="mt-8 rounded-xl border border-[#7ed957]/25 bg-[#7ed957]/5 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#7ed957]">On the clock now</h2>
          <ul className="space-y-1.5">
            {clockedIn.map(({ employee, punch }) => (
              <li key={punch.id} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-white">{employee.full_name}</span>
                <span className="text-white/50">
                  {fmtTime(punch.clock_in_at)} · {formatMinutes(punchMinutes(punch.clock_in_at, nowISO))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-8 text-center">
        <Link href="/admin/staffing" className="text-xs text-white/40 underline">
          Back to the full time clock
        </Link>
      </div>
    </div>
  );
}
