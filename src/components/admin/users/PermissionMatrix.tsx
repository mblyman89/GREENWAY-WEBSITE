/**
 * src/components/admin/users/PermissionMatrix.tsx
 *
 * A friendly, at-a-glance grid of exactly what each role can do. Rows are
 * plain-language permissions; columns are roles. A green ✓ means "yes, this
 * role can do this"; a dim dot means "no". This makes the (otherwise abstract)
 * permission system obvious to a non-technical owner choosing who gets what.
 *
 * Server component — reads the single source of truth in @/lib/auth/roles via
 * the read-only accessors (no matrix mutation possible).
 */
import {
  ALL_ROLES,
  ROLE_LABELS,
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  rolesForPermission,
} from "@/lib/auth/roles";

export function PermissionMatrix() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-[#0a0a0a] px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-white/40">
              What they can do
            </th>
            {ALL_ROLES.map((r) => (
              <th key={r} className="px-2 py-2 text-center text-[11px] font-bold text-white/70">
                {ROLE_LABELS[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_PERMISSIONS.map((perm, idx) => {
            const granted = new Set(rolesForPermission(perm));
            return (
              <tr key={perm} className={idx % 2 === 0 ? "bg-white/[0.02]" : ""}>
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2 text-xs text-white/70">
                  {PERMISSION_LABELS[perm]}
                </td>
                {ALL_ROLES.map((r) => (
                  <td key={r} className="px-2 py-2 text-center">
                    {granted.has(r) ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#7ed957]/20 text-xs text-[#7ed957]">
                        ✓
                      </span>
                    ) : (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/15" />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-white/40">
        <span className="text-[#7ed957]">✓</span> = this role can do it. A dim dot means it can&apos;t.
        Pick the lowest role that still lets someone do their job.
      </p>
    </div>
  );
}
