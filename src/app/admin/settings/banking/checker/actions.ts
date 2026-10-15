"use server";

/**
 * R41 S9: the pre-upload file checker (plan point 3) and the practice run
 * (point 5).
 *
 * The file is read in memory, checked by the pure core and dropped. It is
 * never stored, logged, emailed or echoed back: the result carries only rule
 * names, plain messages (which never repeat an account number or a receiver
 * name), counts, totals and the ledger file's name. The audit row records who
 * checked which fingerprint and whether it passed, nothing from inside it.
 *
 * Owner or admin (settings.manage). Checking changes nothing, so it is not an
 * achGate action: a check is never a request.
 */
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { MAX_CHECK_CHARS, checkAchFileForUpload, fingerprints, type CheckResult } from "@/lib/payments/timberland-file-checker-core";
import { buildPracticeFile, loadCheckContext } from "@/lib/payments/timberland-file-checker-store";

export type CheckerState = null | { ok: false; error: string } | { ok: true; practice: boolean; source: string; result: CheckResult };

/** The largest upload accepted, in bytes (the core refuses more characters anyway). */
const MAX_UPLOAD_BYTES = MAX_CHECK_CHARS;

async function textFrom(fd: FormData): Promise<{ ok: true; raw: string; source: string } | { ok: false; error: string }> {
  const file = fd.get("file");
  if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
    const f = file as File;
    if (f.size > MAX_UPLOAD_BYTES) return { ok: false, error: `That file is ${f.size.toLocaleString("en-US")} bytes, far bigger than any Greenway ACH file. It was not read.` };
    const bytes = new Uint8Array(await f.arrayBuffer());
    // latin1 keeps every byte as one character, so a UTF-8 BOM or an accent is
    // seen (and refused) by the core instead of being silently decoded.
    const raw = Buffer.from(bytes).toString("latin1");
    return { ok: true, raw: raw.startsWith("\u00ef\u00bb\u00bf") ? `\uFEFF${raw.slice(3)}` : raw, source: "the file you picked" };
  }
  const pasted = String(fd.get("text") ?? "");
  if (pasted.length > MAX_CHECK_CHARS) return { ok: false, error: "That text is far bigger than any Greenway ACH file. It was not read." };
  if (!pasted.trim()) return { ok: false, error: "Pick the downloaded .ach file, or paste its text." };
  return { ok: true, raw: pasted, source: "the pasted text (a browser may change line ends: picking the file is more exact)" };
}

export async function checkFileAction(_prev: CheckerState, fd: FormData): Promise<CheckerState> {
  const session = await requirePermission("settings.manage");
  const t = await textFrom(fd);
  if (!t.ok) return t;
  const now = new Date();
  const result = checkAchFileForUpload(t.raw, await loadCheckContext(t.raw, now));
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.file.checked",
    entityType: "ach_files",
    entityId: result.facts.ledgerFile?.id ?? null,
    after: { sha256: fingerprints(t.raw).exact, ok: result.ok, problems: result.problems.map((p) => p.rule), warnings: result.warnings.map((w) => w.rule) },
  }).catch(() => {});
  return { ok: true, practice: false, source: t.source, result };
}

export async function practiceRunAction(prev: CheckerState): Promise<CheckerState> {
  void prev; // useActionState passes the last result; a practice run always starts fresh.
  await requirePermission("settings.manage");
  const now = new Date();
  const built = await buildPracticeFile(now);
  if (!built.ok) return { ok: false, error: built.error };
  const result = checkAchFileForUpload(built.file, await loadCheckContext(built.file, now, true));
  return { ok: true, practice: true, source: "a practice file built just now from your real company settings ($0 prenotes, never saved)", result };
}
