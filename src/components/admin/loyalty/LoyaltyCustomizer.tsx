"use client";

/**
 * LoyaltyCustomizer (Slice 67 — item 2; reworked D137–D139, 2026-11-02)
 *
 * A no-code editor for the loyalty program: how points are earned, the
 * (fixed) rewards, member badge NAMES, and earn promotions — with a live
 * "what a customer earns" preview. All saves are validated + audited
 * server-side.
 *
 * D138: points have NO cash value — the old "each point is worth $" and
 * "minimum to redeem" settings are retired. D137: rewards are fixed at
 * 150 pts = 10% off and 300 pts = 25% off, one per sale (shown read-only).
 * D139: badges (Bronze / Gold) are names only; the owner can rename them.
 */
import { useMemo, useState, useTransition } from "react";
import { Button, Card, CardHeader, Field, Input, Select, Textarea, Badge } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import { previewEarn, BADGE_NAME_MAX, type ConfigDraft } from "@/lib/loyalty/loyalty-config-core";
import {
  LOYALTY_REWARDS,
  rewardButtonLabel,
  rewardPercentLabel,
} from "@/lib/loyalty/loyalty-reward-core";
import {
  saveLoyaltyConfigAction,
  renameLoyaltyTierAction,
  saveLoyaltyPromotionAction,
  toggleLoyaltyPromotionAction,
  type LoyaltyActionResult,
} from "@/app/admin/loyalty/actions";

type TierRow = {
  id: string;
  name: string;
  minPoints: number;
  isActive: boolean;
};
type PromoRow = {
  id: string;
  name: string;
  kind: "signup" | "happy_hour" | "promo" | "custom";
  multiplierBps: number;
  flatBonusPoints: number;
  hourStart?: number | null;
  hourEnd?: number | null;
  isActive: boolean;
  notes: string | null;
};

export function LoyaltyCustomizer({
  config,
  tiers,
  promotions,
}: {
  config: ConfigDraft;
  tiers: TierRow[];
  promotions: PromoRow[];
}) {
  return (
    <div className="space-y-6">
      <ConfigForm config={config} />
      <RewardsCard />
      <BadgeNamesEditor tiers={tiers} />
      <PromotionsEditor promotions={promotions} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: surface an action result as a toast
// ---------------------------------------------------------------------------
function useActionToast() {
  const { toast } = useToast();
  return (res: LoyaltyActionResult, successMsg: string) => {
    if (res.ok) {
      toast({ tone: "success", message: successMsg });
      return true;
    }
    const msg = res.errors?.length ? res.errors.join(" ") : res.error ?? "Couldn't save.";
    toast({ tone: "error", message: msg });
    return false;
  };
}

// ---------------------------------------------------------------------------
// Program configuration + live preview
// ---------------------------------------------------------------------------
function ConfigForm({ config }: { config: ConfigDraft }) {
  const notify = useActionToast();
  const [pending, startTransition] = useTransition();

  // Local mirror for the live preview.
  const [ppd, setPpd] = useState(String(config.pointsPerDollar));

  const preview = useMemo(() => {
    const cfg: ConfigDraft = {
      pointsPerDollar: Number(ppd) || 0,
      signupBonusPoints: config.signupBonusPoints,
      codeExpiryDays: config.codeExpiryDays,
    };
    const pts = previewEarn({ subtotalMinor: 5000, cfg }).total;
    // How many $50 visits until the first reward (no cash value — D138).
    const perVisit = Math.max(0, pts);
    const first = LOYALTY_REWARDS[0];
    const visitsToFirst = perVisit > 0 ? Math.ceil(first.points / perVisit) : null;
    return { pts, visitsToFirst, firstLabel: rewardPercentLabel(first) };
  }, [ppd, config.signupBonusPoints, config.codeExpiryDays]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveLoyaltyConfigAction(fd);
      notify(res, "Loyalty settings saved.");
    });
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader
          title="Program settings"
          subtitle="How customers earn points. Changes take effect on the next purchase. Points have no cash value."
        />
        <div className="grid gap-4 p-5 pt-0 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Points earned per $1" help="How many points a customer earns for each pretax dollar. 1 = 1 point per $1.">
            <Input
              name="pointsPerDollar"
              type="number"
              step="0.1"
              min="0"
              value={ppd}
              onChange={(e) => setPpd(e.target.value)}
            />
          </Field>
          <Field label="Signup bonus (points)" help="Points granted the moment a customer joins. 0 for none.">
            <Input name="signupBonusPoints" type="number" step="1" min="0" defaultValue={config.signupBonusPoints} />
          </Field>
          <Field label="Reward codes expire after (days)" help="For reward codes handed to a customer to bring in. Leave blank for codes that never expire.">
            <Input
              name="codeExpiryDays"
              type="number"
              step="1"
              min="1"
              defaultValue={config.codeExpiryDays ?? ""}
              placeholder="Never"
            />
          </Field>
          <Field label="Internal note (optional)" help="A short note for your team about this configuration.">
            <Input name="notes" type="text" maxLength={200} placeholder="e.g. Holiday earn rate" />
          </Field>
        </div>

        <div className="mx-5 mb-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/40">Live preview</p>
          <p className="mt-1 text-sm text-white/80">
            A <span className="font-semibold text-white">$50.00</span> pretax purchase earns{" "}
            <span className="font-semibold text-[var(--admin-green)]">{preview.pts.toLocaleString("en-US")} points</span>
            {preview.visitsToFirst != null ? (
              <>
                {" "}— about{" "}
                <span className="font-semibold text-[var(--admin-gold)]">
                  {preview.visitsToFirst} {preview.visitsToFirst === 1 ? "visit" : "visits"}
                </span>{" "}
                like that to reach {preview.firstLabel} off.
              </>
            ) : (
              "."
            )}
          </p>
        </div>

        <div className="flex justify-end border-t border-[var(--admin-border)] px-5 py-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save program settings"}
          </Button>
        </div>
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Rewards (fixed — D137). Read-only so nobody can quietly change the deal.
// ---------------------------------------------------------------------------
function RewardsCard() {
  return (
    <Card>
      <CardHeader
        title="Rewards"
        subtitle="Fixed rewards a member can use at the register or on an order. Points have no cash value."
      />
      <div className="space-y-3 p-5 pt-0">
        <div className="flex flex-wrap gap-2">
          {LOYALTY_REWARDS.map((r) => (
            <Badge key={r.points} tone="gold">
              {rewardButtonLabel(r)}
            </Badge>
          ))}
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-white/70">
          <li>One reward per sale, no dollar cap. Exactly 150 or 300 points come off — never the whole balance.</li>
          <li>The percent comes off the pre-tax price. Each item keeps the better of its deal price or the reward price — never both.</li>
          <li>Never-discount items are skipped, and no price goes below cost or to $0 (WAC 314-55-155, RCW 69.50.357).</li>
          <li>If a sale with a reward is cancelled or voided, the points go back to the customer automatically.</li>
        </ul>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Member badge names (D139 — names only)
// ---------------------------------------------------------------------------
function BadgeNamesEditor({ tiers }: { tiers: TierRow[] }) {
  const active = tiers.filter((t) => t.isActive).sort((a, b) => a.minPoints - b.minPoints);
  return (
    <Card>
      <CardHeader
        title="Member badge names"
        subtitle="Badges are names only — they give no discount. Rename them here; the new name shows everywhere (register, customer pages, website)."
      />
      <div className="space-y-3 p-5 pt-0">
        {active.length === 0 ? (
          <p className="text-sm text-white/50">No member badges are set up.</p>
        ) : (
          active.map((t) => <BadgeNameForm key={t.id} tier={t} />)
        )}
      </div>
    </Card>
  );
}

function BadgeNameForm({ tier }: { tier: TierRow }) {
  const notify = useActionToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(tier.name);
  const changed = name.trim() !== tier.name;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await renameLoyaltyTierAction(fd);
      notify(res, `Badge renamed to "${name.trim()}".`);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3"
    >
      <input type="hidden" name="id" value={tier.id} />
      <div className="w-56">
        <Field label="Badge name">
          <Input
            name="name"
            type="text"
            maxLength={BADGE_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </div>
      <p className="pb-2 text-sm text-white/50">
        Members get it at {tier.minPoints.toLocaleString("en-US")}+ lifetime points
      </p>
      <div className="ml-auto flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !changed || name.trim() === ""}>
          {pending ? "Saving…" : "Rename"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Promotions editor
// ---------------------------------------------------------------------------
const PROMO_KIND_LABELS: Record<PromoRow["kind"], string> = {
  signup: "Signup",
  happy_hour: "Happy hour",
  promo: "Promotion",
  custom: "Custom",
};

function PromotionsEditor({ promotions }: { promotions: PromoRow[] }) {
  return (
    <Card>
      <CardHeader
        title="Promotions"
        subtitle="Bonus-earning events: signup bonuses, happy hours, and limited-time multipliers."
      />
      <div className="space-y-3 p-5 pt-0">
        {promotions.length === 0 ? (
          <p className="text-sm text-white/50">No promotions yet. Add one below.</p>
        ) : (
          promotions.map((p) => <PromotionRow key={p.id} promo={p} />)
        )}
        <div className="rounded-[var(--admin-radius)] border border-dashed border-[var(--admin-border)] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">Add a promotion</p>
          <PromotionForm promo={null} />
        </div>
      </div>
    </Card>
  );
}

function PromotionRow({ promo }: { promo: PromoRow }) {
  const notify = useActionToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  function onToggle() {
    const fd = new FormData();
    fd.set("id", promo.id);
    fd.set("isActive", String(!promo.isActive));
    startTransition(async () => {
      const res = await toggleLoyaltyPromotionAction(fd);
      notify(res, promo.isActive ? "Promotion paused." : "Promotion activated.");
    });
  }

  const detail = [
    promo.multiplierBps !== 10000 ? `${(promo.multiplierBps / 10000).toFixed(2)}x points` : null,
    promo.flatBonusPoints > 0 ? `+${promo.flatBonusPoints} pts` : null,
    promo.kind === "happy_hour" && promo.hourStart != null && promo.hourEnd != null
      ? `${promo.hourStart}:00–${promo.hourEnd}:00 PT`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Badge tone={promo.isActive ? "green" : "neutral"}>{PROMO_KIND_LABELS[promo.kind]}</Badge>
          <span className="text-sm font-semibold text-white">{promo.name}</span>
          {detail && <span className="text-sm text-white/60">{detail}</span>}
          {!promo.isActive && <span className="text-xs text-white/30">paused</span>}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="neutral" disabled={pending} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
          <Button type="button" size="sm" variant="neutral" disabled={pending} onClick={onToggle}>
            {promo.isActive ? "Pause" : "Activate"}
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 border-t border-[var(--admin-border)] pt-3">
          <PromotionForm promo={promo} onSaved={() => setEditing(false)} />
        </div>
      )}
    </div>
  );
}

function PromotionForm({ promo, onSaved }: { promo: PromoRow | null; onSaved?: () => void }) {
  const notify = useActionToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<PromoRow["kind"]>(promo?.kind ?? "promo");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await saveLoyaltyPromotionAction(fd);
      if (notify(res, promo ? "Promotion updated." : "Promotion added.")) {
        onSaved?.();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      {promo && <input type="hidden" name="id" value={promo.id} />}
      <div className="w-48">
        <Field label="Name">
          <Input name="name" type="text" maxLength={60} defaultValue={promo?.name ?? ""} placeholder="Double Tuesday" />
        </Field>
      </div>
      <div className="w-36">
        <Field label="Type">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PromoRow["kind"])}>
            <option value="signup">Signup</option>
            <option value="happy_hour">Happy hour</option>
            <option value="promo">Promotion</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>
      </div>
      <div className="w-32">
        <Field label="Point multiplier" help="2 = double points. 1 = no change.">
          <Input
            name="multiplier"
            type="number"
            step="0.1"
            min="1"
            defaultValue={promo ? (promo.multiplierBps / 10000).toFixed(1) : "1"}
          />
        </Field>
      </div>
      <div className="w-32">
        <Field label="Flat bonus (pts)">
          <Input name="flatBonusPoints" type="number" step="1" min="0" defaultValue={promo?.flatBonusPoints ?? 0} />
        </Field>
      </div>
      {kind === "happy_hour" && (
        <>
          <div className="w-28">
            <Field label="Start hour (0–23)">
              <Input name="hourStart" type="number" step="1" min="0" max="23" defaultValue={promo?.hourStart ?? 16} />
            </Field>
          </div>
          <div className="w-28">
            <Field label="End hour (0–23)">
              <Input name="hourEnd" type="number" step="1" min="0" max="23" defaultValue={promo?.hourEnd ?? 18} />
            </Field>
          </div>
        </>
      )}
      <label className="flex items-center gap-2 pb-2 text-sm text-white/70">
        <input type="checkbox" name="isActive" value="true" defaultChecked={promo ? promo.isActive : true} />
        Active
      </label>
      <div className="w-full sm:w-64">
        <Field label="Note (optional)">
          <Textarea name="notes" rows={1} maxLength={200} defaultValue={promo?.notes ?? ""} />
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {promo ? "Save" : "Add promotion"}
      </Button>
    </form>
  );
}
