/**
 * src/lib/ai/kb/intake-strain-match-server.ts
 *
 * Server-side glue that runs the PURE intelligent strain matcher
 * (`strain-matcher.ts`) against the LIVE Knowledge Base for a batch of intake
 * lines. Used by the intake review screen to SUGGEST which KB strain each
 * incoming product most likely refers to — handling vendor name variations,
 * added brand words, pack sizes and small typos.
 *
 * DRAFTS-ONLY (standing rule): this only produces suggestions for a human to
 * confirm. It never writes to inventory or the KB.
 */

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { STRAINS_RICH } from "./strains-data";
import {
  matchStrainToKb,
  type MatchableStrain,
  type StrainMatchResult,
} from "./strain-matcher";

/** DB-first load of active strains (name + aliases); falls back to the seed. */
async function loadActiveStrains(): Promise<MatchableStrain[]> {
  const seed: MatchableStrain[] = STRAINS_RICH.map((s) => ({
    slug: s.slug,
    name: s.name,
    aliases: s.aliases ?? [],
    strain_type: s.strain_type ?? null,
  }));
  if (!isSupabaseServiceConfigured) return seed;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_strains")
      .select("slug,name,aliases,strain_type,active")
      .eq("active", true)
      .limit(5000);
    if (error || !data || data.length === 0) return seed;
    return data.map((r) => ({
      slug: r.slug as string,
      name: r.name as string,
      aliases: (r.aliases as string[] | null) ?? [],
      strain_type: (r.strain_type as string | null) ?? null,
    }));
  } catch {
    return seed;
  }
}

export type IntakeLineForMatch = {
  strainName?: string | null;
  productName?: string | null;
};

/**
 * Match a batch of intake lines against the KB in ONE strain load. Returns
 * results in the SAME ORDER as the input lines. Never throws.
 */
export async function matchIntakeLinesToKb(
  lines: IntakeLineForMatch[],
): Promise<StrainMatchResult<MatchableStrain>[]> {
  if (lines.length === 0) return [];
  const strains = await loadActiveStrains();
  return lines.map((l) =>
    matchStrainToKb(
      { strainName: l.strainName ?? null, productName: l.productName ?? null },
      strains,
    ),
  );
}
