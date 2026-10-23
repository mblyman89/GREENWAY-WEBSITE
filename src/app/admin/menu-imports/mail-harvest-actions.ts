"use server";

/**
 * R74 S5 — "Test the vendor mailbox" (read-only).
 *
 * Proves the Google set-up for the Cultivera mail harvest before any harvesting is built on it:
 * signs in exactly like the CCRS monitor (keyless by default), as CULTIVERA_HARVEST_MAILBOX
 * (default stephen@greenwaymarijuana.com), and asks Gmail for ONE page of the harvest search.
 * It reads ids only: no email is opened, nothing is stored, nothing in Gmail changes
 * (gmail.readonly). Audited. Any refusal is printed with its fix (the same decoders as the
 * CCRS panel).
 *
 * R74 S7 adds "Harvest the next batch" below (harvestMailboxBatchAction).
 * R74 S9 adds "Read the kept PDFs and spreadsheets" (readKeptDocumentsAction).
 */
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getAttachmentBytes, getGmailAccessToken, getMessage, listMessageIdsPage } from "@/lib/compliance/ccrs-mail-fetch";
import { buildHarvestQuery, harvestConfigLine, harvestMailConfigFromEnv, probeResultLine } from "@/lib/pos/cultivera-mail-harvest-core";
import { harvestBatchLine } from "@/lib/pos/cultivera-mail-harvest-run-core";
import { HarvestTableMissing, runHarvestBatch, supabaseHarvestIo } from "@/lib/pos/cultivera-mail-harvest-store";
import { fetchTransferJson } from "@/lib/inventory/transfer-fetch";
import { readPdfLayer } from "@/lib/inventory/pdf-extract";
import { parsePdfWithFallback } from "@/lib/inbound-email/llamaparse-provider";
import { readBatchLine } from "@/lib/pos/cultivera-mail-read-core";
import { loadXlsxWorkbook, runReadBatch, supabaseReadIo } from "@/lib/pos/cultivera-mail-read-store";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

const back = (q: string): never => redirect(`/admin/menu-imports?${q}#mail-harvest`);

export async function probeHarvestMailboxAction(): Promise<void> {
  const session = await requirePermission("menu.import");
  const cfg = harvestMailConfigFromEnv(process.env);
  if (!cfg.configured) back(`error=${encodeURIComponent(`Vendor mailbox test: ${harvestConfigLine(cfg).text}`)}`);
  const configured = cfg as Extract<typeof cfg, { configured: true }>;
  let line: string;
  let ok = false;
  try {
    const token = await getGmailAccessToken(configured);
    const page = await listMessageIdsPage(token, configured.mailbox, buildHarvestQuery(), null, 1);
    line = probeResultLine(configured.mailbox, page);
    ok = true;
  } catch (e) {
    line = `Vendor mailbox test for ${configured.mailbox} failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera_mail.probe",
    entityType: "mailbox",
    entityId: configured.mailbox,
    after: { ok, mode: configured.mode },
  });
  back(ok ? `notice=${encodeURIComponent(line)}` : `error=${encodeURIComponent(line)}`);
}

/**
 * R74 S7 — "Harvest the next batch". Reads up to 47 new emails of the vendor mailbox (oldest page
 * first, resumable), keeps every vendor document privately in pos-raw and one row per document in
 * cultivera_mail_docs (0293). Gmail is read-only; nothing in Gmail changes. Audited. A doubled click
 * stores each document once (the insert is the claim).
 */
export async function harvestMailboxBatchAction(): Promise<void> {
  const session = await requirePermission("menu.import");
  if (!isSupabaseServiceConfigured) back(`error=${encodeURIComponent("Email harvest: Supabase is not configured.")}`);
  const cfg = harvestMailConfigFromEnv(process.env);
  if (!cfg.configured) back(`error=${encodeURIComponent(`Email harvest: ${harvestConfigLine(cfg).text}`)}`);
  const configured = cfg as Extract<typeof cfg, { configured: true }>;
  let line: string;
  let ok = false;
  let result: Awaited<ReturnType<typeof runHarvestBatch>> | null = null;
  try {
    const io = supabaseHarvestIo(
      createSupabaseAdminClient(),
      configured,
      { getGmailAccessToken, listMessageIdsPage: (t, mb, q, p) => listMessageIdsPage(t, mb, q, p), getMessage, getAttachmentBytes },
      fetchTransferJson,
    );
    result = await runHarvestBatch(io, configured);
    line = harvestBatchLine(result);
    ok = result.ok;
  } catch (e) {
    line = e instanceof HarvestTableMissing ? `Email harvest: ${e.message}` : `Email harvest of ${configured.mailbox} failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera_mail.harvest",
    entityType: "mailbox",
    entityId: configured.mailbox,
    after: result
      ? { ok: result.ok, opened: result.opened, stored: result.stored, documents: result.documents, parsed: result.parsed, failedEmails: result.failedEmails, deferred: result.deferred, pageComplete: result.pageComplete, stoppedBecause: result.stoppedBecause }
      : { ok: false, error: line.slice(0, 300) },
  });
  back(ok ? `notice=${encodeURIComponent(line)}` : `error=${encodeURIComponent(line)}`);
}

/**
 * R74 S9 — "Read the kept PDFs and spreadsheets". R74 S19: reads five at a time, newest email
 * first, for up to 180 s (READ_BATCH_TIME_BUDGET_MS; at most 100 per press) the documents the harvest kept as
 * "stored": PDFs through LlamaParse (the intake's primary reader; unpdf on an outage), grounded by
 * the PDF's own text layer; spreadsheets through exceljs. Writes only the row's read fields (0293
 * allows stored -> parsed | unreadable). Audited. A doubled click reads each document once.
 */
export async function readKeptDocumentsAction(): Promise<void> {
  const session = await requirePermission("menu.import");
  if (!isSupabaseServiceConfigured) back(`error=${encodeURIComponent("Reading kept documents: Supabase is not configured.")}`);
  const cfg = harvestMailConfigFromEnv(process.env);
  let line: string;
  let ok = false;
  let result: Awaited<ReturnType<typeof runReadBatch>> | null = null;
  try {
    const io = supabaseReadIo(createSupabaseAdminClient(), cfg.mailbox, {
      readPdfLayer,
      parsePdfWithFallback,
      loadWorkbook: loadXlsxWorkbook,
      actor: { id: session.userId, email: session.email },
    });
    result = await runReadBatch(io);
    line = readBatchLine(result);
    ok = result.ok;
  } catch (e) {
    line = e instanceof HarvestTableMissing ? `Reading kept documents: ${e.message}` : `Reading kept documents failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  await recordAudit({
    actorId: session.userId,
    actorEmail: session.email,
    action: "cultivera_mail.read",
    entityType: "mailbox",
    entityId: cfg.mailbox,
    after: result
      ? { ok: result.ok, waiting: result.waiting, read: result.read, parsed: result.parsed, unreadable: result.unreadable, failed: result.failed, llamaparse: result.llamaparse, unpdf: result.unpdf, left: result.left, stoppedBecause: result.stoppedBecause }
      : { ok: false, error: line.slice(0, 300) },
  });
  back(ok ? `notice=${encodeURIComponent(line)}` : `error=${encodeURIComponent(line)}`);
}
