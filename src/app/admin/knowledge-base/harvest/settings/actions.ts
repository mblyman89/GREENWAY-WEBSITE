"use server";

/**
 * /admin/knowledge-base/harvest/settings — server actions (Slice H7).
 *
 * Save / reset the harvest tuning knobs (kb_harvest_settings singleton).
 * Every submitted value goes through the pure clamp helpers BEFORE the write,
 * so a typo can't push the pipeline outside its safe envelope; the DB CHECK
 * constraints are the backstop, and the crawler worker keeps its own ceilings
 * regardless. Gated by settings.manage (owner/admin). Fully audited.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  HARVEST_DEFAULTS,
  mergeHarvestSettings,
  type HarvestSettings,
} from "@/lib/kb/harvest-settings-core";
import {
  loadHarvestSettings,
  saveHarvestSettings,
  resetHarvestSettings,
} from "@/lib/kb/harvest-settings";

const BASE = "/admin/knowledge-base/harvest/settings";

function back(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(`${BASE}${qs ? `?${qs}` : ""}`);
}

/** Form field name → settings key (numbers only; parsing + clamping is shared). */
const FIELD_KEYS: readonly (keyof HarvestSettings)[] = [
  "fastLaneMinConfidence",
  "fastLaneMinChars",
  "staleAfterDays",
  "refreshBatch",
  "trickleBatch",
  "batchAcceptCap",
  "pendingLimit",
  "tier1MaxPages",
  "tier2MaxPages",
  "tier3MaxPages",
  "tier3DelaySeconds",
];

/** Save every knob from the form (merged over current values, clamped). */
export async function saveHarvestSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");

  const before = await loadHarvestSettings();
  const patch: Partial<Record<keyof HarvestSettings, unknown>> = {};
  for (const key of FIELD_KEYS) {
    const raw = formData.get(key);
    if (raw !== null && String(raw).trim() !== "") patch[key] = Number(String(raw).trim());
  }
  const next = mergeHarvestSettings(
    { ...HARVEST_DEFAULTS, ...before } as HarvestSettings,
    patch,
  );

  const failure = await saveHarvestSettings(next);
  if (failure) back({ error: `Not saved: ${failure}` });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "kb.harvest_settings_saved",
    entityType: "kb_harvest_settings",
    entityId: "1",
    before: { ...toPlain(before) },
    after: { ...toPlain(next) },
  });

  revalidatePath(BASE);
  revalidatePath("/admin/knowledge-base/harvest");
  revalidatePath("/admin/knowledge-base/harvest/review");
  back({ msg: "Settings saved — they apply to the next job, review load, and cadence click." });
}

/** Reset every knob to the vetted defaults. */
export async function resetHarvestSettingsAction(): Promise<void> {
  const session = await requirePermission("settings.manage");

  const before = await loadHarvestSettings();
  const failure = await resetHarvestSettings();
  if (failure) back({ error: `Not reset: ${failure}` });

  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "kb.harvest_settings_reset",
    entityType: "kb_harvest_settings",
    entityId: "1",
    before: { ...toPlain(before) },
    after: { ...HARVEST_DEFAULTS },
  });

  revalidatePath(BASE);
  revalidatePath("/admin/knowledge-base/harvest");
  revalidatePath("/admin/knowledge-base/harvest/review");
  back({ msg: "All knobs reset to the vetted defaults." });
}

/** Strip loader metadata so the audit diff only holds the knobs. */
function toPlain(s: HarvestSettings & { persisted?: boolean; updatedAt?: string | null }) {
  const out: Record<string, number> = {};
  for (const key of FIELD_KEYS) out[key] = s[key];
  return out;
}
