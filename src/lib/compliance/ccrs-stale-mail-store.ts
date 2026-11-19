/**
 * src/lib/compliance/ccrs-stale-mail-store.ts  (D255)
 *
 * Server side of "Set aside old CCRS emails". Reads every open email and
 * every ledger file each one names (both envs, since a production-ledger file
 * can be answered by a PREprod email, as on 10/20), asks the pure core which
 * are stale, and sets those aside ONE BY ONE with the facts in the note. The
 * update only touches a row still "new" (markCcrsMailHandled), so a click
 * racing an Apply never overwrites it.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { LedgerEnv } from "./ccrs-ledger-core";
import { listOpenCcrsMail, markCcrsMailHandled, OPEN_LIST_MAX, type StoredCcrsMail } from "./ccrs-mail-store";
import { ourNamesOfMail, planStaleSetAside, type LedgerFileFact, type StaleMailInput } from "./ccrs-stale-mail-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export function toStaleInput(m: StoredCcrsMail): StaleMailInput {
  const successes = (m.analysis as { successes?: { fileName?: string }[] } | null)?.successes ?? [];
  return {
    id: m.id,
    kind: m.kind,
    subject: m.subject ?? "",
    env: m.env_verified ? m.env : null,
    bodyText: m.body_text ?? "",
    successNames: successes.map((x) => String(x?.fileName ?? "")).filter(Boolean),
  };
}

export type StaleSetAsideResult = { setAside: number; kept: { id: string; subject: string; why: string }[]; raced: number };

export async function setAsideStaleCcrsMail(admin: Admin, env: LedgerEnv, byProfileId: string): Promise<StaleSetAsideResult> {
  const open = await listOpenCcrsMail(admin, OPEN_LIST_MAX);
  const inputs = open.map(toStaleInput);
  const names = [...new Set(inputs.flatMap((m) => ourNamesOfMail(m)))];
  const files: LedgerFileFact[] = [];
  for (let i = 0; i < names.length; i += 200) {
    const { data, error } = await admin.from("ccrs_files").select("file_name, env, state").in("file_name", names.slice(i, i + 200));
    if (error) throw new Error(`ccrs_files: ${error.message}`);
    for (const r of (data as { file_name: string; env: LedgerEnv; state: string }[] | null) ?? []) files.push({ fileName: r.file_name, env: r.env, state: r.state });
  }
  const plan = planStaleSetAside(inputs, files, env);
  let setAside = 0;
  let raced = 0;
  for (const x of plan.setAside) {
    if (await markCcrsMailHandled(admin, x.id, "dismissed", byProfileId, x.note)) setAside += 1;
    else raced += 1;
  }
  const subj = new Map(open.map((m) => [m.id, m.subject]));
  return { setAside, raced, kept: plan.keep.map((k) => ({ id: k.id, subject: subj.get(k.id) ?? "", why: k.why })) };
}
