import { requirePermission } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { ALL_ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/auth/roles";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
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
                      className="rounded-md border border-white/15 bg-black px-2 py-1.5 text-sm text-white outline-none focus:border-[#7ed957]"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:border-[#7ed957] hover:text-white"
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
                      className="rounded-md px-3 py-1.5 text-xs text-[#ff7f00] hover:underline disabled:opacity-40"
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                </div>
              );
            })}
            {users.length === 0 && (
              <p className="px-5 py-8 text-sm text-white/50">
                No staff users yet. Sign in once with a bootstrap email to create
                the first owner, then invite your team here.
              </p>
            )}
          </div>
        </section>

        {/* Role reference */}
        <section className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
          <h2 className="text-sm font-semibold text-white">Role reference</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ALL_ROLES.map((r) => (
              <div key={r} className="rounded-lg border border-white/10 p-3">
                <p className="text-sm font-medium text-[#7ed957]">{ROLE_LABELS[r]}</p>
                <p className="text-xs text-white/50">{ROLE_DESCRIPTIONS[r]}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
