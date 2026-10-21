/**
 * GET /admin/settings/banking/yearly-review/packet?year=YYYY
 *
 * R41 S14: the printable yearly ACH fraud-procedure review packet (plain
 * text): the Nacha Phase 2 text, the written procedure, the risk assessment,
 * the review record for the year, and (owner only, because it reads the
 * Security Log, as /admin/audit does) the segregation-of-duties report.
 * WRITES NOTHING but the audit line. Owner/admin (settings.manage); never
 * cached. No account numbers are in the packet.
 */
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { pacificToday } from "@/lib/reports/timezone";
import { buildSodReport, FIRST_REVIEW_YEAR, yearlyReviewPacket } from "@/lib/payments/ach-yearly-review-core";
import { readAnnualReviews, readSodInputs, readStaff } from "@/lib/payments/ach-yearly-review-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function refuse(msg: string): Response {
  return new Response(`Could not make the yearly review packet: ${msg}`, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(req: Request) {
  const session = await requirePermission("settings.manage");
  const thisYear = Number(pacificToday().slice(0, 4));
  const raw = new URL(req.url).searchParams.get("year") ?? String(thisYear);
  if (!/^\d{4}$/.test(raw)) return refuse("the year must be four digits.");
  const year = Number(raw);
  if (year < FIRST_REVIEW_YEAR || year > thisYear) return refuse(`the year must be between ${FIRST_REVIEW_YEAR} and ${thisYear}.`);

  const seesLog = can(session.profile.role, "audit.view");
  const [reviews, staff, sodIn] = await Promise.all([readAnnualReviews(), readStaff(), seesLog ? readSodInputs(year) : Promise.resolve(null)]);
  if (!reviews.ok) return refuse(reviews.error);
  if (!staff.ok) return refuse(staff.error);
  // Owner asked for the full packet and the Security Log read failed: say so,
  // never hand out a packet whose who-did-what section silently vanished.
  if (sodIn && !sodIn.ok) return refuse(sodIn.error);

  const nameOf = (id: string) => {
    const s = staff.rows.find((x) => x.id === id);
    return (s?.full_name ?? "").trim() || s?.email || "Unknown staff";
  };
  const text = yearlyReviewPacket({
    year,
    generatedAt: new Date(),
    generatedBy: (session.profile.full_name ?? "").trim() || session.email || "Unknown staff",
    reviews: reviews.rows,
    reviewerName: nameOf,
    sod: sodIn && sodIn.ok ? buildSodReport({ year, ...sodIn }) : null,
  });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.yearly_review.packet",
    entityType: "ach_annual_reviews",
    entityId: String(year),
    after: { year, withDuties: Boolean(sodIn && sodIn.ok) },
  }).catch(() => {});

  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename="ach-yearly-review-${year}.txt"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
