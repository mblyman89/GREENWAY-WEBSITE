import { AdminTopNav } from "@/components/admin/AdminTopNav";
import type { StaffRole } from "@/lib/supabase/types";
import { loadAdminBadges } from "@/components/admin/perf/admin-badges-server";

type NavProps = { role: StaffRole; fullName: string; email: string };

/** PERF-S3: streamed in behind <Suspense>; the fallback is the same nav without badges. */
export async function AdminNavWithBadges(props: NavProps & { exceptions: boolean; owner: boolean }) {
  const badges = await loadAdminBadges({ exceptions: props.exceptions, owner: props.owner });
  return <AdminTopNav role={props.role} fullName={props.fullName} email={props.email} badges={badges} />;
}
