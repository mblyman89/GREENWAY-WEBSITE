/**
 * src/lib/catalog/onboarding-confidence-server.ts  (R74 S53)
 *
 * Owner (Round 34): "I also want the attach all facts buttons from the vendor
 * confidence screen to be in onboarding, and I want it to actually attach
 * strain types too if it finds them."
 *
 * The confidence screen's three buttons, for ONE delivery on Product
 * Onboarding (any manifest kind - the batch lookup ran on it):
 *   confident - every fact at or above 85% (and the strain type at the bar);
 *   all       - every fact found (and the strain type it found);
 *   selected  - "all" for the ticked products only.
 *
 * Doors: facts through attachProductFacts() as the person's confirmed answer
 * (the person pressed the button); the strain type through
 * setDraftStrainIfEmpty() (never over a pick). NOTHING IS APPROVED - AI only
 * drafts, a person presses Approve on each row (standing rule).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { recordAudit } from "@/lib/auth/audit";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { postProcessLookup } from "@/lib/inventory/product-lookup-core";
import { attachProductFacts } from "@/lib/catalog/attach-facts";
import { attachedFactsOf } from "@/lib/catalog/fact-chips-core";
import { loadStrainTypeSignals } from "@/lib/inventory/catalog-drafts";
import { setDraftStrainIfEmpty } from "@/lib/inventory/onboarding-strain-store";
import { readDrafts, readFacts, rawFor } from "@/lib/catalog/cultivera-confidence-server";
import { CONFIDENCE_BUDGET_MS, scoreProduct, vendorScorecard, type AttachMode, type ProductScore, type VendorScorecard } from "@/lib/catalog/cultivera-confidence-core";
import { ONBOARDING_ATTACH_AUDIT, attachSentence, planOnboardingAttach, type AttachTally } from "@/lib/ai/onboarding-batch-send-core";

const CHUNK = 100;

export type DeliveryConfidence = {
  scorecard: VendorScorecard;
  products: (ProductScore & { chosen: string | null; kb: string | null; manifestStrain: string | null; attached: string[] })[];
  /** Products the strain type would be set on by "Attach every fact". */
  strainsFindable: number;
};

/** Score every Needs-review product of one delivery from its newest finished lookup. */
export async function loadDeliveryConfidence(manifestId: string): Promise<DeliveryConfidence | { error: string }> {
  if (!isUuid(manifestId)) return { error: "That delivery link is not valid." };
  if (!isSupabaseServiceConfigured) return { error: "The database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const drafts = await readDrafts(admin, [manifestId]);
    const facts = await readFacts(admin, drafts.map((d) => d.id));
    const evidence = new Map<string, { kb: string | null; manifest: string | null }>();
    for (let i = 0; i < drafts.length; i += CHUNK) {
      const sig = await loadStrainTypeSignals(drafts.slice(i, i + CHUNK).map((d) => ({ id: d.id, name: d.name, strain_name: d.strain_name, lot_id: d.lot_id })));
      for (const [k, v] of sig.evidence) evidence.set(k, v);
    }
    let strainsFindable = 0;
    const products = drafts.map((d) => {
      const ev = evidence.get(d.id) ?? { kb: null, manifest: null };
      const p = scoreProduct({
        draftId: d.id,
        name: d.name,
        manifestId: d.manifest_id,
        compactFacts: facts.get(d.id.toLowerCase()) ?? null,
        chosenStrain: d.chosen_strain_type,
        kbStrain: ev.kb,
        manifestStrain: ev.manifest,
      });
      if (planOnboardingAttach(p, "all", { chosen: d.chosen_strain_type, kb: ev.kb, manifest: ev.manifest }).strain) strainsFindable += 1;
      return {
        ...p,
        chosen: d.chosen_strain_type,
        kb: ev.kb,
        manifestStrain: ev.manifest,
        attached: Object.keys(attachedFactsOf(d as unknown as Record<string, unknown>) ?? {}),
      };
    });
    products.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
    return { scorecard: vendorScorecard(products), products, strainsFindable };
  } catch (err) {
    return { error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}

/** The button. Resumable; never approves. */
export async function runManifestConfidenceAttach(input: {
  manifestId: string;
  mode: AttachMode;
  draftIds?: readonly string[];
  actor: { userId: string | null; email: string | null };
  now?: () => number;
}): Promise<{ ok: boolean; sentence: string; tally?: AttachTally }> {
  const now = input.now ?? (() => Date.now());
  const t0 = now();
  const dc = await loadDeliveryConfidence(input.manifestId);
  if ("error" in dc) return { ok: false, sentence: dc.error };
  const want = input.mode === "selected" ? new Set((input.draftIds ?? []).filter((x) => isUuid(x)).map((x) => x.toLowerCase())) : null;
  if (want && want.size === 0) return { ok: false, sentence: "Tick at least one product first." };
  const todo = dc.products.filter((p) => p.scored && (!want || want.has(p.draftId.toLowerCase())));
  if (todo.length === 0) return { ok: false, sentence: "No finished lookups on this delivery yet - wait for the batch lookup to finish." };
  const admin = createSupabaseAdminClient();
  const banned = await loadBannedPhrases();
  const t: AttachTally = { products: 0, facts: 0, strains: 0, skipped: 0, left: 0, errors: [] };
  for (let i = 0; i < todo.length; i += 1) {
    if (now() - t0 > CONFIDENCE_BUDGET_MS) {
      t.left = todo.length - i;
      break;
    }
    const p = todo[i];
    const plan = planOnboardingAttach(p, input.mode, { chosen: p.chosen, kb: p.kb, manifest: p.manifestStrain });
    const have = new Set(p.attached);
    const pending = plan.attach.filter((a) => !have.has(a.field));
    if (pending.length === 0 && !plan.strain) {
      t.skipped += 1;
      continue;
    }
    let touched = false;
    try {
      if (pending.length > 0) {
        const res = await attachProductFacts({
          context: { kind: "draft", draftId: p.draftId },
          safe: postProcessLookup(rawFor(pending), banned),
          sources: [],
          factConfidence: {},
          suggestionConfidence: {},
          suggestionSource: "human:onboarding-confidence",
          actor: input.actor,
          confirmedBy: "human",
        });
        if (!res.ok) {
          t.errors.push(`${p.name}: ${res.error}`.slice(0, 160));
        } else if (res.receipt.attached.length > 0) {
          t.facts += res.receipt.attached.length;
          touched = true;
        }
      }
      if (plan.strain) {
        const s = await setDraftStrainIfEmpty(admin, p.draftId, plan.strain, input.actor);
        if (!s.ok) t.errors.push(`${p.name} strain: ${s.error}`.slice(0, 160));
        else if (s.set) {
          t.strains += 1;
          touched = true;
        }
      }
    } catch (err) {
      t.errors.push(`${p.name}: ${String(err instanceof Error ? err.message : err)}`.slice(0, 160));
    }
    if (touched) t.products += 1;
    else t.skipped += 1;
  }
  const sentence = attachSentence(t);
  await recordAudit({
    actorId: input.actor.userId,
    actorEmail: input.actor.email,
    action: ONBOARDING_ATTACH_AUDIT,
    entityType: "inbound_manifest",
    entityId: input.manifestId,
    after: { mode: input.mode, tally: t, picked: want ? want.size : null },
  });
  return { ok: t.errors.length === 0, sentence, tally: t };
}
