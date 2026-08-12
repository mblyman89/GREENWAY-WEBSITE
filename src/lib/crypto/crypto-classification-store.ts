import "server-only";

/**
 * src/lib/crypto/crypto-classification-store.ts — R1-B classification layer
 * (server-only).
 *
 * Read/write accessors over the two tables from migration 0163:
 *   crypto_tx_classifications / crypto_classification_rules.
 *
 * The PURE shape + logic (record types, row shapes, mappers, the validated
 * upsert-row builder, and the rules-engine matcher) live in
 * ./crypto-classification-store-core so the pure self-test battery (which runs
 * under tsx, where `server-only` throws) exercises them. This module adds only
 * the async Supabase calls and re-exports the public types.
 *
 * Graceful, mirroring crypto-store.ts:
 *   - isSupabaseServiceConfigured guard → "not configured" (reads return [] /
 *     null, writes no-op success) so pages render BEFORE the DB is wired;
 *   - try/catch around every query; a MISSING table (pre-0163) is treated like
 *     "not configured", never a crash;
 *   - writes never delete; re-classifying UPSERTS the single row per tx;
 *   - an owner classification always wins over a rule suggestion (the store
 *     never overwrites an existing owner/manual row with a rule result).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  toClassificationRecord,
  toRuleRecord,
  buildClassificationUpsertRow,
  type ClassificationRow,
  type RuleRow,
  type BuildClassificationInput,
  type CryptoTxClassificationRecord,
  type CryptoClassificationRuleRecord,
} from "./crypto-classification-store-core";

export type {
  CryptoTxClassificationRecord,
  CryptoClassificationRuleRecord,
  ClassificationSource,
} from "./crypto-classification-store-core";

export type WriteResult = { ok: true; count: number } | { ok: false; error: string };

const CLASSIFICATION_COLS =
  "id, transaction_id, primitive, tag_key, note, auto_suggested, source, rule_id, classified_by, classified_at";
const RULE_COLS =
  "id, name, tag_key, match_chain, match_direction, match_tx_type, match_asset_id, match_counterparty, priority, active";

const READ_LIMIT = 5000;

function cleanId(v: string | null | undefined): string {
  return v == null ? "" : String(v).trim();
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/** All transaction classifications (optionally for one transaction). */
export async function listCryptoClassifications(
  transactionId?: string,
): Promise<CryptoTxClassificationRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    let q = admin.from("crypto_tx_classifications").select(CLASSIFICATION_COLS).limit(READ_LIMIT);
    const tid = cleanId(transactionId);
    if (tid !== "") q = q.eq("transaction_id", tid);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as unknown as ClassificationRow[]).map(toClassificationRecord);
  } catch {
    return [];
  }
}

/** The single current classification for one transaction, or null. */
export async function getCryptoClassification(
  transactionId: string,
): Promise<CryptoTxClassificationRecord | null> {
  const tid = cleanId(transactionId);
  if (tid === "") return null;
  const rows = await listCryptoClassifications(tid);
  return rows.length > 0 ? rows[0] : null;
}

/** Active rules ascending by priority (first match wins), then all if asked. */
export async function listCryptoClassificationRules(
  onlyActive = true,
): Promise<CryptoClassificationRuleRecord[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    let q = admin
      .from("crypto_classification_rules")
      .select(RULE_COLS)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(READ_LIMIT);
    if (onlyActive) q = q.eq("active", true);
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as unknown as RuleRow[]).map(toRuleRecord);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

/**
 * Classify one transaction (upsert the single row per transaction_id). Validates
 * the tag against the R1-A vocabulary + its validity on the primitive via
 * buildClassificationUpsertRow; refuses to write a nonsense classification.
 * Graceful: no DB / missing table => no-op success; never throws.
 */
export async function upsertCryptoClassification(
  input: BuildClassificationInput,
): Promise<WriteResult> {
  const row = buildClassificationUpsertRow(input);
  if (row === null) {
    return { ok: false, error: "Invalid classification (unknown tag or wrong primitive)." };
  }
  if (!isSupabaseServiceConfigured) return { ok: true, count: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("crypto_tx_classifications")
      .upsert(row, { onConflict: "transaction_id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: 1 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Classification write failed." };
  }
}

/**
 * Create or update a classification rule. Only builds/writes a row; matching is
 * pure (crypto-classification-store-core). Graceful no-op when unconfigured.
 */
export async function upsertCryptoClassificationRule(rule: {
  id?: string;
  name: string;
  tagKey: string;
  matchChain?: string | null;
  matchDirection?: string | null;
  matchTxType?: string | null;
  matchAssetId?: string | null;
  matchCounterparty?: string | null;
  priority?: number;
  active?: boolean;
  createdBy?: string | null;
}): Promise<WriteResult> {
  const name = cleanId(rule.name);
  const tagKey = cleanId(rule.tagKey);
  if (name === "" || tagKey === "") {
    return { ok: false, error: "Rule needs a name and a tag." };
  }
  if (!isSupabaseServiceConfigured) return { ok: true, count: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const payload: Record<string, unknown> = {
      name,
      tag_key: tagKey,
      match_chain: rule.matchChain ?? null,
      match_direction: rule.matchDirection ?? null,
      match_tx_type: rule.matchTxType ?? null,
      match_asset_id: rule.matchAssetId ?? null,
      match_counterparty: rule.matchCounterparty ?? null,
      priority: typeof rule.priority === "number" ? rule.priority : 100,
      active: rule.active !== false,
      created_by: rule.createdBy ?? null,
    };
    const id = cleanId(rule.id);
    if (id !== "") payload.id = id;
    const { error } = await admin
      .from("crypto_classification_rules")
      .upsert(payload, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: 1 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rule write failed." };
  }
}

/** Turn a rule on/off without deleting it (keep-history). */
export async function setCryptoClassificationRuleActive(
  ruleId: string,
  active: boolean,
): Promise<WriteResult> {
  const id = cleanId(ruleId);
  if (id === "") return { ok: false, error: "Missing rule id." };
  if (!isSupabaseServiceConfigured) return { ok: true, count: 0 };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("crypto_classification_rules")
      .update({ active })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, count: 1 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Rule toggle failed." };
  }
}
