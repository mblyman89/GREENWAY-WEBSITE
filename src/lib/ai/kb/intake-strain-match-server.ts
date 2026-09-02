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
import { pagedAllChecked } from "@/lib/supabase/chunked-in";

/**
 * SLICE 5C — memory ceiling for the strain scan. NOT a row cap: reaching it is
 * REPORTED as an incomplete read (which falls back to the seed), never
 * silently accepted.
 */
const STRAIN_SCAN_MAX_ROWS = 100_000;
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
    // SLICE 5C — `.limit(5000)` cannot exceed PostgREST's 1,000-row cap
    // (chunked-in.ts:13-14). This list is the matcher's whole universe: a
    // strain absent from it simply never matches, so intake silently failed to
    // recognise strains past row 1,000 and quietly fell back to weaker
    // guesses. Paged completely.
    //
    // The existing fall-back-to-seed contract is PRESERVED: an incomplete read
    // returns the seed rather than a half-populated matcher, because a
    // partial universe produces confidently WRONG matches, not merely fewer.
    type StrainRow = {
      slug: string;
      name: string;
      aliases: string[] | null;
      strain_type: string | null;
    };
    const { rows: data, verdict } = await pagedAllChecked<StrainRow>(
      async (from, to) => {
        const { data: page, error } = await admin
          .from("kb_strains")
          .select("slug,name,aliases,strain_type,active")
          .eq("active", true)
          // Stable UNIQUE ordering — REQUIRED for deterministic paging.
          .order("slug", { ascending: true })
          .range(from, to);
        if (error) return { rows: [], ok: false };
        return { rows: (page as StrainRow[] | null) ?? [], ok: true };
      },
      { maxRows: STRAIN_SCAN_MAX_ROWS },
    );
    if (!verdict.complete || data.length === 0) return seed;
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
