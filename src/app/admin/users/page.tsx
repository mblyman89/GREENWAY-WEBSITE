import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ALL_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_RANK } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { PermissionMatrix } from "@/components/admin/users/PermissionMatrix";
import type { StaffProfile } from "@/lib/supabase/types";
import { updateUserRole, setUserActive, inviteUser } from "./actions";

export const dynamic = "force-dynamic";

async function loadUsers(): Promise<StaffProfile[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("staff_profiles")
    .select("*")
    .order("created_at", { ascending: true });
  return (data as StaffProfile[]) ?? [];
}

export default async function UsersPage() {
  const session = await requirePermission("users.manage");
  const users = await loadUsers();

  return (
    <div>
      <AdminPageHeader
        title="Staff Users"
        subtitle="Invite employees and control their roles. The last owner is protected from lockout."
        breadcrumbs={<Breadcrumbs items={[{ label: "Users" }]} />}
        help={
          <HelpPanel
            id="users"
            title="How team access works"
            steps={[
              "Enter a teammate's email and choose their role.",
              "Send the invite — they get an email to set a password.",
              "Roles control what each person can see and change.",
              "Change or remove access any time from this page.",
            ]}
          >
            <p>
              Give people the lowest role that still lets them do their job. The
              last owner account is protected so you can never lock yourself out.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-8 px-5 py-6 sm:px-8">
        {/* Invite */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Invite a staff member</h2>
          <p className="mt-1 text-xs text-white/40">
            They receive a secure email invite to set their password.
          </p>
          <form action={inviteUser} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              name="email"
              type="email"
              required
              placeholder="employee@greenwaymarijuana.com"
              className="flex-1 rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[#7ed957]"
            />
            <select
              name="role"
              defaultValue="staff"
              className="rounded-lg border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-[#7ed957]"
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-full bg-[#ff7f00] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
            >
              Send invite
            </button>
          </form>
        </section>

        {/* Users table */}
        <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
          <div className="border-b border-white/10 px-5 py-3 text-sm font-semibold text-white">
            {users.length} staff member{users.length === 1 ? "" : "s"}
          </div>
          <div className="divide-y divide-white/10">
            {users.map((u) => {
              const isSelf = u.id === session.userId;
              return (
                <div
                  key={u.id}
                  className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1.4fr_1.2fr_auto]"
                >
                  <div>
                    <p className="font-medium text-white">
                      {u.full_name || u.email}
                      {isSelf && (
                        <span className="ml-2 text-xs text-[#7ed957]">(you)</span>
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
                      className="admin-focus rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2 py-1.5 text-sm text-[var(--admin-text)] outline-none transition focus:border-[var(--admin-accent)]"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="admin-focus rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-xs text-[var(--admin-text-muted)] transition hover:border-[var(--admin-accent)] hover:text-[var(--admin-text)]"
                    >
                      Save
                    </button>
                  </form>

                  <form action={setUserActive} className="justify-self-end">
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="active" value={(!u.active).toString()} />
                    <button
                      type="submit"
                      disabled={isSelf}
                      className="rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-xs text-[var(--admin-orange)] hover:underline disabled:opacity-40"
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
                  <span className="mt-0.5 inline-flex h-6 shrink-0 items-center rounded-full bg-[#7ed957]/10 px-2 text-[10px] font-bold uppercase tracking-wide text-[#7ed957]">
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
