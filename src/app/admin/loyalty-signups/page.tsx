import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { readLoyaltySignups } from "@/lib/loyalty/store";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function LoyaltySignupReviewPage() {
  await requirePermission("loyalty.view");
  const signups = await readLoyaltySignups();

  return (
    <div>
      <AdminPageHeader
        title="Loyalty Signups"
        subtitle="Review new loyalty signups and add customers to the POS."
        action={
          <span className="rounded-full bg-[#ffd700]/15 px-4 py-2 text-sm font-semibold text-[#ffd700]">
            {signups.length} total
          </span>
        }
      />

      <div className="px-5 py-6 sm:px-8">
        <div className="mb-4 rounded-lg border border-[#ff7f00]/30 bg-[#ff7f00]/10 p-3 text-xs text-white/70">
          Reading from <code>storage/loyalty-signups.jsonl</code>. Slice 8 will
          migrate this to a database queue with CSV export, dedupe, and
          mark-as-entered tracking.
        </div>

        {signups.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-[#0a0a0a] p-8 text-sm text-white/50">
            No loyalty signups stored in this environment yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a]">
            <div className="divide-y divide-white/10">
              {signups.map((s) => (
                <article
                  key={s.id}
                  className="grid gap-4 px-5 py-4 sm:grid-cols-[1.1fr_1.2fr_0.8fr]"
                >
                  <div>
                    <p className="font-semibold text-white">
                      {s.firstName} {s.lastName}
                    </p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {formatDate(s.submittedAt)}
                    </p>
                  </div>
                  <div className="text-sm text-white/70">
                    <p>
                      <span className="text-white/40">Email:</span> {s.email}
                    </p>
                    <p>
                      <span className="text-white/40">Phone:</span>{" "}
                      {s.mobilePhone}
                    </p>
                    <p>
                      <span className="text-white/40">Birthday:</span>{" "}
                      {s.birthday}
                    </p>
                  </div>
                  <div className="text-sm text-white/70">
                    <span className="text-white/40">Notify:</span>{" "}
                    {s.notificationStatus}
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
