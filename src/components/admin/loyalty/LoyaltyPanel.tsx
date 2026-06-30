/**
 * src/components/admin/loyalty/LoyaltyPanel.tsx
 *
 * Per-customer loyalty card for the customer detail page. Server component:
 * loads the account, tier, recent ledger, and active codes, and renders the
 * enroll / adjust / redeem forms (gated by the caller passing canManage).
 */
import { Button, Input, Select, Field, Badge } from "@/components/admin/ui";
import {
  getAccountByCustomer,
  recentLedger,
  listRedemptions,
  getConfig,
  listTiers,
} from "@/lib/loyalty/loyalty-store";
import { tierForPoints, formatPoints } from "@/lib/loyalty/engine";
import {
  enrollCustomerAction,
  adjustPointsAction,
  issueRedemptionAction,
} from "@/app/admin/loyalty/actions";

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

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
  redeem: "Redeemed",
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
            <Button type="submit" variant="subtle">
              Enroll in loyalty
            </Button>
          </form>
        )}
      </div>
    );
  }

  const [cfg, tiers, ledger, redemptions] = await Promise.all([
    getConfig(),
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
          <Badge tone="gold">
            {tier.name} · {(tier.discountBps / 100).toFixed(0)}% off
          </Badge>
        ) : (
          <Badge tone="neutral">No tier yet</Badge>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-lg border border-[var(--admin-border)] px-3 py-2">
          <p className="text-xs text-white/40">Balance</p>
          <p className="font-semibold text-white">
            {formatPoints(account.balance_points)}{" "}
            <span className="text-xs font-normal text-white/40">
              ({money(account.balance_points * cfg.pointValueMinor)})
            </span>
          </p>
        </div>
        <div className="rounded-lg border border-[var(--admin-border)] px-3 py-2">
          <p className="text-xs text-white/40">Lifetime</p>
          <p className="font-semibold text-white">{formatPoints(account.lifetime_points)}</p>
        </div>
        <div className="rounded-lg border border-[var(--admin-border)] px-3 py-2">
          <p className="text-xs text-white/40">Active codes</p>
          <p className="font-semibold text-white">{activeCodes.length}</p>
        </div>
      </div>

      {canManage && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {/* Redeem */}
          <form
            action={issueRedemptionAction}
            className="space-y-2 rounded-lg border border-[var(--admin-border)] p-3"
          >
            <h3 className="text-xs font-semibold text-white/70">Redeem points → code</h3>
            <input type="hidden" name="account_id" value={account.id} />
            <input type="hidden" name="customer_id" value={customerId} />
            <Field label="Points to redeem" help={`Min ${cfg.minRedeemPoints}`}>
              <Input name="points" inputMode="numeric" placeholder="100" />
            </Field>
            <Field label="Send via">
              <Select name="channel" defaultValue="both">
                <option value="both">Text &amp; email</option>
                <option value="sms">Text only</option>
                <option value="email">Email only</option>
              </Select>
            </Field>
            <Button type="submit" variant="subtle">
              Issue code
            </Button>
          </form>

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
            <Button type="submit" variant="subtle">
              Apply adjustment
            </Button>
          </form>
        </div>
      )}

      {/* Active codes */}
      {activeCodes.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-semibold text-white/70">Active redemption codes</h3>
          <div className="space-y-1">
            {activeCodes.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-3 py-2 text-sm"
              >
                <span className="font-mono font-semibold text-[var(--admin-gold)]">{c.code}</span>
                <span className="text-xs text-white/60">
                  {formatPoints(c.points)} · {money(c.value_minor)}
                  {c.expires_at ? ` · exp ${fmtTime(c.expires_at)}` : ""}
                </span>
              </div>
            ))}
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
