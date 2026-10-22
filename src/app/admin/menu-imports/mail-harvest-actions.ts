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
 */
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getGmailAccessToken, listMessageIdsPage } from "@/lib/compliance/ccrs-mail-fetch";
import { buildHarvestQuery, harvestConfigLine, harvestMailConfigFromEnv, probeResultLine } from "@/lib/pos/cultivera-mail-harvest-core";

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
