/**
 * src/components/admin/loyalty/LoyaltyPanel.tsx
 *
 * Per-customer loyalty card for the customer detail page. Server component:
 * loads the account, tier, recent ledger, and active codes, and renders the
 * enroll / adjust / reward-code forms (gated by the caller passing canManage).
 *
 * D137–D141 (2026-11-02): points have NO cash value (no "$" next to the
 * balance); a reward code is one of the two fixed rewards (150 pts = 10% off,
 * 300 pts = 25% off); badges are names only; an open code can be cancelled
 * here and its points come straight back.
 */
import { Button, Input, Field, Badge } from "@/components/admin/ui";
import {
  getAccountByCustomer,
  recentLedger,
  listRedemptions,
  listTiers,
} from "@/lib/loyalty/loyalty-store";
import { tierForPoints, formatPoints } from "@/lib/loyalty/engine";
import {
  enrollCustomerAction,
  adjustPointsAction,
  issueRedemptionAction,
  cancelRedemptionAction,
} from "@/app/admin/loyalty/actions";
import {
  LOYALTY_REWARDS,
  rewardButtonLabel,
  rewardForPoints,
  rewardShortLabel,
  rewardStatusLine,
} from "@/lib/loyalty/loyalty-reward-core";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const LEDGER_LABEL: Record<string, string> = {
  earn: "Earned",
  redeem: "Reward used",
  adjust: "Adjustment",
  signup_bonus: "Signup bonus",
  promo_bonus: "Promo bonus",
  expire: "Expired",
};

export async function LoyaltyPanel({
  customerId,
  canManage,
}: {
  customerId: string;
  canManage: boolean;
}) {
  const account = await getAccountByCustomer(customerId);

  if (!account) {
    return (
      <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="mb-3 text-sm font-bold text-[var(--admin-text)]">Loyalty</h2>
        <p className="mb-3 text-sm text-[var(--admin-text-faint)]">
          This customer is not enrolled in the loyalty program.
        </p>
        {canManage && (
          <form action={enrollCustomerAction}>
            <input type="hidden" name="customer_id" value={customerId} />
            <Button type="submit" variant="neutral">
              Enroll in loyalty
            </Button>
          </form>
        )}
      </div>
    );
  }

  const [tiers, ledger, redemptions] = await Promise.all([
    listTiers(),
    recentLedger(account.id, 20),
    listRedemptions(account.id),
  ]);

  const tier = tierForPoints(account.lifetime_points, tiers);
  const activeCodes = redemptions.filter((r) => r.status === "issued");

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">Loyalty</h2>
        {tier ? (
          <Badge tone="gold">{tier.name}</Badge>
        ) : (
          <Badge tone="neutral">No badge yet</Badge>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg border border-[var(--admin-border)] px-3 py-2">
          <p className="text-xs text-white/40">Balance</p>
          <p className="font-semibold text-white">
            {formatPoints(account.balance_points)}
          </p>
          <p className="text-xs text-white/40">{rewardStatusLine(account.balance_points)}</p>
        </div>
        <div className="rounded-lg border border-[var(--admin-border)] px-3 py-2">
          <p className="text-xs text-white/40">Lifetime</p>
          <p className="font-semibold text-white">{formatPoints(account.lifetime_points)}</p>
        </div>
        <div className="rounded-lg border border-[var(--admin-border)] px-3 py-2">
          <p className="text-xs text-white/40">Open reward codes</p>
          <p className="font-semibold text-white">{activeCodes.length}</p>
        </div>
      </div>

      {canManage && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {/* Reward code (D137) */}
          <div className="space-y-2 rounded-lg border border-[var(--admin-border)] p-3">
            <h3 className="text-xs font-semibold text-white/70">Give a reward code</h3>
            <p className="text-xs text-white/40">
              For a customer to bring in. The points come off now and come back if you cancel the code. To use a
              reward on a sale right away, use the register or the order&apos;s Loyalty panel instead.
            </p>
            <div className="flex flex-wrap gap-2">
              {LOYALTY_REWARDS.map((rw) => {
                const enough = account.balance_points >= rw.points;
                return (
                  <form key={rw.points} action={issueRedemptionAction}>
                    <input type="hidden" name="account_id" value={account.id} />
                    <input type="hidden" name="customer_id" value={customerId} />
                    <input type="hidden" name="rewardPoints" value={rw.points} />
                    <Button type="submit" variant="neutral" disabled={!enough}>
                      {rewardButtonLabel(rw)}
                    </Button>
                  </form>
                );
              })}
            </div>
            <p className="text-xs text-white/40">Give the code to the customer (it is shown below once issued).</p>
          </div>

          {/* Adjust */}
          <form
            action={adjustPointsAction}
            className="space-y-2 rounded-lg border border-[var(--admin-border)] p-3"
          >
            <h3 className="text-xs font-semibold text-white/70">Manual adjustment</h3>
            <input type="hidden" name="account_id" value={account.id} />
            <input type="hidden" name="customer_id" value={customerId} />
            <Field label="Points (+/-)" help="Positive to add, negative to remove">
              <Input name="points" inputMode="numeric" placeholder="25 or -25" />
            </Field>
            <Field label="Reason">
              <Input name="note" placeholder="e.g. service recovery" />
            </Field>
            <Button type="submit" variant="neutral">
              Apply adjustment
            </Button>
          </form>
        </div>
      )}

      {/* Active codes */}
      {activeCodes.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-semibold text-white/70">Open reward codes</h3>
          <div className="space-y-1">
            {activeCodes.map((c) => {
              const rw = rewardForPoints(c.points);
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-3 py-2 text-sm"
                >
                  <span className="font-mono font-semibold text-[var(--admin-gold)]">{c.code}</span>
                  <span className="text-xs text-white/60">
                    {rw ? rewardShortLabel(rw) : `${formatPoints(c.points)} (old code — can't be used; cancel to return the points)`}
                    {c.expires_at ? ` · exp ${fmtTime(c.expires_at)}` : ""}
                  </span>
                  {canManage && (
                    <form action={cancelRedemptionAction}>
                      <input type="hidden" name="redemption_id" value={c.id} />
                      <input type="hidden" name="customer_id" value={customerId} />
                      <Button type="submit" size="sm" variant="danger">
                        Cancel & return points
                      </Button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ledger */}
      <div>
        <h3 className="mb-2 text-xs font-semibold text-white/70">Recent activity</h3>
        {ledger.length === 0 ? (
          <p className="text-sm text-white/40">No activity yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {ledger.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between rounded-lg border border-[var(--admin-border)] px-3 py-2"
              >
                <span className="text-white/70">
                  {LEDGER_LABEL[row.kind] ?? row.kind}
                  {row.note ? <span className="text-white/40"> · {row.note}</span> : null}
                </span>
                <span
                  className={`tabular-nums font-semibold ${
                    row.points >= 0 ? "text-[var(--admin-green)]" : "text-orange-400"
                  }`}
                >
                  {row.points >= 0 ? "+" : ""}
                  {row.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
