import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ALL_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_RANK } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { Button, CHIP_NEUTRAL } from "@/components/admin/ui";
import { PermissionMatrix } from "@/components/admin/users/PermissionMatrix";
import type { StaffProfile, StaffRole } from "@/lib/supabase/types";
import { updateUserRole, setUserActive, inviteUser } from "./actions";

export const dynamic = "force-dynamic";

type AccessLogRow = {
  id: number;
  action: string;
  actor_email: string | null;
  entity_id: string | null;
  after_json: Record<string, unknown> | null;
  created_at: string;
};

async function loadUsers(): Promise<StaffProfile[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("staff_profiles")
    .select("*")
    .order("created_at", { ascending: true });
  return (data as StaffProfile[]) ?? [];
}

/** Last 15 user-management audit entries — every grant, cut-off, and refusal. */
async function loadAccessLog(): Promise<AccessLogRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("audit_logs")
    .select("id, action, actor_email, entity_id, after_json, created_at")
    .like("action", "user.%")
    .order("created_at", { ascending: false })
    .limit(15);
  return (data as AccessLogRow[]) ?? [];
}

const ACCESS_LOG_LABELS: Record<string, { label: string; tone: "green" | "orange" | "red" }> = {
  "user.invite": { label: "Invited", tone: "green" },
  "user.invite.failed": { label: "Invite failed", tone: "red" },
  "user.invite.blocked": { label: "Invite BLOCKED", tone: "red" },
  "user.role.update": { label: "Role changed", tone: "green" },
  "user.role.update.blocked": { label: "Role change BLOCKED", tone: "red" },
  "user.activate": { label: "Reactivated", tone: "green" },
  "user.activate.blocked": { label: "Reactivate BLOCKED", tone: "red" },
  "user.deactivate": { label: "Deactivated", tone: "orange" },
  "user.deactivate.blocked": { label: "Deactivate BLOCKED", tone: "red" },
};

const TONE_CLASS: Record<"green" | "orange" | "red", string> = {
  green: "bg-[var(--admin-accent)]/10 text-[var(--admin-accent)]",
  orange: "bg-[var(--admin-orange)]/10 text-[var(--admin-orange)]",
  red: "bg-red-500/10 text-red-300",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requirePermission("users.manage");
  const sp = await searchParams;
  const [users, accessLog] = await Promise.all([loadUsers(), loadAccessLog()]);

  const myRank = ROLE_RANK[session.profile.role];
  const activeOwnerCount = users.filter((u) => u.role === "owner" && u.active).length;
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  return (
    <div>
      <AdminPageHeader
        title="Staff Users"
        subtitle="Invite employees and control their roles. Guard rails stop lockouts and privilege grabs — every change lands in the audit log."
        breadcrumbs={<Breadcrumbs items={[{ label: "Users" }]} />}
        help={
          <HelpPanel
            id="users"
            title="How team access works"
            steps={[
              "Enter a teammate's email and choose their role.",
              "Send the invite — they get an email to set a password.",
              "Roles control what each person can see and change.",
              "Letting someone go? Hit Deactivate — access is cut off and their sign-in is banned immediately — then run the offboarding checklist on their employee file.",
            ]}
          >
            <p>
              Give people the lowest role that still lets them do their job. Four guard rails run
              on every change: you can&apos;t edit your own access, you can&apos;t touch anyone
              ranked above you, you can&apos;t grant a role above your own, and the last active
              owner can never be demoted or locked out. Blocked attempts are recorded too.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {sp.error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {decodeURIComponent(sp.error)}
          </div>
        )}
        {sp.ok && (
          <div className="rounded-lg border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-4 py-3 text-sm text-[var(--admin-accent)]">
            {decodeURIComponent(sp.ok)}
          </div>
        )}

        {/* Invite */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Invite a staff member</h2>
          <p className="mt-1 text-xs text-white/40">
            They receive a secure email invite to set their password. You can only grant roles at
            or below your own.
          </p>
          <form action={inviteUser} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              name="email"
              type="email"
              required
              placeholder="employee@greenwaymarijuana.com"
              className="flex-1 rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            />
            <select
              name="role"
              defaultValue="staff"
              className="rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
            >
              {ALL_ROLES.filter((r) => ROLE_RANK[r] <= myRank).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary">
              Send invite
            </Button>
          </form>
        </section>

        {/* Users table */}
        <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
          <div className="border-b border-white/10 px-5 py-3 text-sm font-semibold text-white">
            {users.length} staff member{users.length === 1 ? "" : "s"}
            <span className="ml-2 text-xs font-normal text-white/40">
              {activeOwnerCount} active owner{activeOwnerCount === 1 ? " — protected from lockout" : "s"}
            </span>
          </div>
          <div className="divide-y divide-white/10">
            {users.map((u) => {
              const isSelf = u.id === session.userId;
              const outranksMe = ROLE_RANK[u.role as StaffRole] > myRank;
              const isLastOwner = u.role === "owner" && u.active && activeOwnerCount <= 1;
              const roleLocked = isSelf || outranksMe || isLastOwner;
              const activeLocked = (isSelf && u.active) || outranksMe || isLastOwner;
              const lockReason = isSelf
                ? "You can't change your own access — ask another owner or admin."
                : outranksMe
                  ? "Ranked above you — you can't change their access."
                  : isLastOwner
                    ? "Last active owner — protected from lockout."
                    : "";
              return (
                <div
                  key={u.id}
                  className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1.4fr_1.2fr_auto]"
                >
                  <div>
                    <p className="font-medium text-white">
                      {u.full_name || u.email}
                      {isSelf && (
                        <span className="ml-2 text-xs text-[var(--admin-accent)]">(you)</span>
                      )}
                      {isLastOwner && (
                        <span
                          className="ml-2 rounded bg-[var(--admin-accent)]/10 px-1.5 py-0.5 text-[10px] uppercase text-[var(--admin-accent)]"
                          title="The last active owner can never be demoted or deactivated."
                        >
                          Protected
                        </span>
                      )}
                      {!u.active && (
                        <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/50">
                          Inactive
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-white/40">{u.email}</p>
                  </div>

                  <form action={updateUserRole} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <select
                      name="role"
                      defaultValue={u.role}
                      disabled={roleLocked}
                      title={roleLocked ? lockReason : undefined}
                      className="admin-focus rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-sm text-[var(--admin-text)] outline-none transition focus:border-[var(--admin-accent)] disabled:opacity-40"
                    >
                      {ALL_ROLES.filter(
                        (r) => ROLE_RANK[r] <= myRank || r === u.role,
                      ).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={roleLocked}
                      title={roleLocked ? lockReason : undefined}
                      className={`${CHIP_NEUTRAL} disabled:opacity-40`}
                    >
                      Save
                    </button>
                  </form>

                  <form action={setUserActive} className="justify-self-end">
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="active" value={(!u.active).toString()} />
                    <button
                      type="submit"
                      disabled={activeLocked}
                      title={activeLocked ? lockReason : undefined}
                      className={`${CHIP_NEUTRAL} disabled:opacity-40`}
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </div>
              );
            })}
            {users.length === 0 && (
              <p className="px-5 py-8 text-sm text-[var(--admin-text-faint)]">
                No staff users yet. Sign in once with a bootstrap email to create
                the first owner, then invite your team here.
              </p>
            )}
          </div>
        </section>

        {/* Letting someone go */}
        <section className="rounded-xl border border-[var(--admin-orange)]/25 bg-[var(--admin-orange)]/5 p-5">
          <h2 className="text-sm font-semibold text-white">Letting someone go? Do both halves.</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-white/55">
            <li>
              <strong className="text-white/80">Cut off access here:</strong> hit Deactivate on
              their row above. Their back-office access ends on their very next request and their
              sign-in is banned at the auth layer — no waiting for a session to expire.
            </li>
            <li>
              <strong className="text-white/80">Close out employment there:</strong> open{" "}
              <Link href="/admin/staffing/employees" className="text-[var(--admin-accent)] underline">
                their employee file
              </Link>{" "}
              and run the termination + offboarding checklist — it clears their time-clock PIN,
              records the last day and reason, and keeps the file for the 5-year record
              requirement (WAC 314-55-087).
            </li>
          </ol>
        </section>

        {/* Access change log */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Recent access changes</h2>
            <Link href="/admin/audit" className="text-xs text-[var(--admin-accent)] underline">
              Full audit log →
            </Link>
          </div>
          <p className="mt-1 text-xs text-white/40">
            Every invite, role change, and deactivation — including <strong>blocked</strong>{" "}
            attempts the guard rails refused. If you see blocked entries you didn&apos;t expect,
            someone is poking at access they shouldn&apos;t have.
          </p>
          {accessLog.length === 0 ? (
            <p className="mt-4 text-xs text-white/40">No access changes recorded yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-white/5">
              {accessLog.map((row) => {
                const meta = ACCESS_LOG_LABELS[row.action] ?? {
                  label: row.action,
                  tone: "orange" as const,
                };
                const target =
                  (row.entity_id && emailById.get(row.entity_id)) || row.entity_id || "—";
                const detail =
                  (row.after_json &&
                    ((row.after_json.reason as string | undefined) ??
                      (row.after_json.role ? `→ ${String(row.after_json.role)}` : undefined))) ||
                  null;
                return (
                  <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-semibold ${TONE_CLASS[meta.tone]}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-white/80">{target}</span>
                    {detail && <span className="text-white/40">{detail}</span>}
                    <span className="ml-auto text-white/30">
                      by {row.actor_email ?? "system"} ·{" "}
                      {new Date(row.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Role reference — plain-language explainer, ordered by privilege */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">What each role means</h2>
          <p className="mt-1 text-xs text-white/40">
            Ordered from most access (top) to least. Give people the lowest role that still lets them do their job.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[...ALL_ROLES]
              .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])
              .map((r) => (
                <div key={r} className="flex items-start gap-3 rounded-lg border border-white/10 p-3">
                  <span className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full bg-[var(--admin-accent)]/10 px-2 text-[10px] font-bold uppercase tracking-wide text-[var(--admin-accent)]">
                    {ROLE_LABELS[r]}
                  </span>
                  <p className="text-xs leading-relaxed text-white/55">{ROLE_DESCRIPTIONS[r]}</p>
                </div>
              ))}
          </div>
        </section>

        {/* Visual permission matrix */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Who can do what</h2>
          <p className="mt-1 mb-3 text-xs text-white/40">
            The exact permissions behind each role. This is the live source of truth the system enforces on every page.
          </p>
          <PermissionMatrix />
        </section>
      </div>
    </div>
  );
}
