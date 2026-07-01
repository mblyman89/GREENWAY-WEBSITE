import { requireStaff } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { getCockpitSnapshot } from "@/lib/admin/cockpit-data";
import { mobileKpis, mobileAttention, mobileGlances, visibleShortcuts } from "@/lib/admin/mobile-core";
import { MobileHome } from "@/components/admin/mobile/MobileHome";

export const dynamic = "force-dynamic";

/**
 * /admin/mobile — the curated "On the Go" experience.
 *
 * A dedicated, phone-first snapshot for owners/managers away from the computer.
 * Reuses the EXACT verified data source as the desktop cockpit
 * (getCockpitSnapshot) and the pure mobile-core selectors. The desktop back
 * office is intentionally left completely unchanged; this route is additive.
 *
 * Grounded in research (Flowhub Stash + mobile-dashboard best practice): show
 * a fast, actionable snapshot + a short curated set of shortcuts — not the full
 * desktop nav. All shortcuts are permission-filtered by the signed-in role.
 */
export default async function AdminMobilePage() {
  const session = await requireStaff();
  const snap = await getCockpitSnapshot();

  const firstName = (session.profile.full_name ?? session.email).split(/[\s@]/)[0] || "there";
  const roleLabel = ROLE_LABELS[session.profile.role];

  const kpis = mobileKpis(snap);
  const attention = mobileAttention(snap);
  const glances = mobileGlances(snap);
  const shortcuts = visibleShortcuts(session.profile.role);

  const lastImportLabel = snap.lastImportISO ? relativeShort(snap.lastImportISO) : null;

  return (
    <MobileHome
      firstName={firstName}
      roleLabel={roleLabel}
      configured={snap.configured}
      kpis={kpis}
      attention={attention}
      glances={glances}
      shortcuts={shortcuts}
      lastImportLabel={lastImportLabel}
    />
  );
}

/** Short relative time like "just now", "3h ago", "2d ago". Pure + tiny. */
function relativeShort(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
