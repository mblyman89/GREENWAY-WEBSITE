"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { parseVendorJson, type ParsedManifest } from "@/lib/inventory/intake-parser";
import { fetchTransferJson } from "@/lib/inventory/transfer-fetch";
import {
  stageManifest,
  rejectManifest,
  setLotDisposition,
  finalizeManifestDispositions,
  gatherSampleCapNotice,
  logManifestEvent,
  setManifestInvoiceOverride,
} from "@/lib/inventory/intake-store";
import { sendSampleCapVendorNotice } from "@/lib/compliance/sample-cap-notify";
import { normalizeRejection } from "@/lib/inventory/intake-disposition-core";
import {
  parseCcrsManifestCsv,
  ccrsToParsedManifest,
  ccrsTransportToParsed,
} from "@/lib/inventory/ccrs-manifest-csv-core";
import { parsePdfManifest } from "@/lib/inventory/pdf-extract";
import { makeCapturingRecovery } from "@/lib/inbound-email/llamaparse-recovery";
import { recordManifestParseStatus } from "@/lib/inbound-email/llamaparse-status-server";

/** Shared: parse + stage a JSON payload, redirect on each failure mode. */
async function stageJsonText(
  jsonText: string,
  actorId: string,
  sourceUrl: string | null,
) {
  const parsed = parseVendorJson(jsonText);
  if (!parsed.ok) {
    redirect(`/admin/inventory/intake?error=parse`);
  }
  if (parsed.manifest.lines.length === 0) {
    redirect(`/admin/inventory/intake?error=nolines`);
  }

  let rawPayload: unknown = jsonText;
  try {
    rawPayload = JSON.parse(jsonText);
  } catch {
    rawPayload = jsonText;
  }

  const staged = await stageManifest(parsed.manifest, rawPayload, actorId, {
    sourceUrl,
  });
  revalidatePath("/admin/inventory/intake");
  if (!staged.ok) {
    redirect(`/admin/inventory/intake?error=save`);
  }
  redirect(`/admin/inventory/intake/${staged.manifestId}?staged=1`);
}

export async function importManifestAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const jsonText = (formData.get("json_text") as string | null)?.trim() ?? "";
  if (!jsonText) {
    redirect("/admin/inventory/intake?error=empty");
  }
  await stageJsonText(jsonText, session.userId, null);
}

/**
 * Import by pasting the WCIA "Transfer Data Link" URL from the order email.
 * We fetch the JSON server-side (collapsing the doubled-prefix link bug) so the
 * employee never has to open and copy the raw JSON — and never has to click each
 * per-product COA link, since the transfer JSON already embeds them all.
 */
export async function importManifestFromUrlAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const url = (formData.get("transfer_url") as string | null)?.trim() ?? "";
  if (!url) {
    redirect("/admin/inventory/intake?error=emptyurl");
  }

  const fetched = await fetchTransferJson(url);
  if (!fetched.ok) {
    redirect(`/admin/inventory/intake?error=fetch`);
  }

  await stageJsonText(fetched.jsonText, session.userId, fetched.finalUrl);
}

/**
 * Import the OFFICIAL Washington CCRS Transportation Manifest CSV (the file the
 * sending licensee uploads to CCRS, or its downloadable template). Grounded in
 * the LCB spec (see src/lib/inventory/ccrs-manifest-csv-core.ts). CCRS carries
 * only identifiers + quantities + lab-test id — NOT product names/prices/COAs —
 * so the staged lines are sparse DRAFTS that staff enrich during review. We also
 * seed the transport chain-of-custody + ETA from the manifest header.
 */
export async function importManifestCsvAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const csvText = (formData.get("csv_text") as string | null)?.trim() ?? "";
  if (!csvText) {
    redirect("/admin/inventory/intake?error=emptycsv");
  }

  const parsed = parseCcrsManifestCsv(csvText);
  if (!parsed.ok) {
    redirect("/admin/inventory/intake?error=csvparse");
  }
  const mapped = ccrsToParsedManifest(parsed);
  if (mapped.lines.length === 0) {
    redirect("/admin/inventory/intake?error=nolines");
  }

  // Adapt to the shared ParsedManifest shape stageManifest expects. The CCRS
  // header's transport block rides along on the H15a `transport` channel, so
  // stageManifest seeds chain-of-custody + ETA the same way it does for WCIA
  // JSON and PDF manifests (one path, one audit-trail note).
  const manifest: ParsedManifest = {
    manifest_number: mapped.manifest_number,
    vendor_label: mapped.vendor_label,
    vendor_license: mapped.vendor_license,
    transfer_date: mapped.transfer_date,
    source_format: "ccrs-csv",
    lines: mapped.lines,
    warnings: mapped.warnings,
    transport: ccrsTransportToParsed(mapped.transport),
  };

  const staged = await stageManifest(manifest, csvText, session.userId, {
    sourceUrl: null,
  });
  revalidatePath("/admin/inventory/intake");
  if (!staged.ok) {
    redirect("/admin/inventory/intake?error=save");
  }

  redirect(`/admin/inventory/intake/${staged.manifestId}?staged=1&csv=1`);
}

/**
 * Import a WA LCB "Internal Shipping Document (Third Party)" PDF (the manifest a
 * vendor emails as a PDF instead of, or alongside, the JSON). Text is extracted
 * with unpdf (serverless-safe) and parsed by pdf-manifest-core. The PDF carries
 * NO price/COA, so the staged lines are SPARSE DRAFTS (lot id, product name,
 * type, shipped qty) that staff enrich during review — same drafts-only rule as
 * the CSV path. Prefer the JSON when available; this is for PDF-only manifests.
 */
export async function importManifestPdfAction(formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const file = formData.get("pdf_file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/admin/inventory/intake?error=emptypdf");
  }
  const f = file as File;
  const name = (f.name ?? "").toLowerCase();
  const type = (f.type ?? "").toLowerCase();
  if (!name.endsWith(".pdf") && !type.includes("pdf")) {
    redirect("/admin/inventory/intake?error=notpdf");
  }

  const bytes = new Uint8Array(await f.arrayBuffer());
  // LlamaParse-primary (vision) for manual uploads too — a scanned or
  // partial-text PDF uploaded by hand gets the same full read as the intake.
  // PR-A: a capturing recovery remembers which engine won so we can record an
  // authoritative, manifest-tagged parse-status row after staging.
  const cap = makeCapturingRecovery();
  const parsed = await parsePdfManifest(bytes, cap.recover);
  if (!parsed.ok) {
    // Distinguish "not a manifest" from "unreadable/scanned" for the reviewer.
    const code = parsed.text == null ? "pdfscanned" : "pdfparse";
    redirect(`/admin/inventory/intake?error=${code}`);
  }

  const staged = await stageManifest(parsed.manifest, parsed.text, session.userId, {
    sourceUrl: null,
  });
  // PR-A: record the parse status against the staged manifest (best-effort).
  await recordManifestParseStatus(parsed.manifest.manifest_number, cap.lastOutcome(), {
    actorId: session.userId,
  });
  revalidatePath("/admin/inventory/intake");
  if (!staged.ok) {
    redirect("/admin/inventory/intake?error=save");
  }
  redirect(`/admin/inventory/intake/${staged.manifestId}?staged=1&pdf=1`);
}

// S-11 (GAP M-8): the legacy acceptManifestAction was RETIRED. It flipped every
// quarantined lot to active WITHOUT the lot-activation compliance gate (CCRS id,
// COA on record, passing lab result). All manifest acceptance now goes through
// finalizeManifestAction → finalizeManifestDispositions, which evaluates every
// accepted lot against evaluateLotBatchActivation and HOLDS dirty lots.
// A grep-guard (scripts/compliance/check-activation-gate.ts) fails the checks
// if an ungated activation path ever reappears.

export async function setManifestLifecycleAction(manifestId: string, status: "in_transit" | "received") {
  const session = await requirePermission("inventory.manage");
  const { setManifestLifecycle } = await import("@/lib/inventory/intake-store");
  const result = await setManifestLifecycle(manifestId, status, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=lifecycle`);
  }

  // ── books-81: THE RECEIVING WIRE ──────────────────────────────────────
  // Marking a delivery "received" is the moment its cost becomes inventory,
  // so this is where the goods-receipt journal is raised. Until now the
  // builder existed and nothing called it, which is why the census scored
  // vendor_cycle.goods_received as reachable=MISSING (D-61 / D-34).
  //
  // The physical fact and the accounting fact are recorded SEPARATELY and in
  // that order, deliberately. The goods really did arrive; refusing to record
  // that because the books had a question would put the warehouse out of step
  // with reality and encourage people to work around the system. So the
  // status flip above always stands, and a refusal here is surfaced as a
  // banner on the same page rather than by rolling back the receipt.
  //
  // The refusal is NOT swallowed: `booksError` carries the reason to the
  // screen. A silent catch would recreate the exact defect this slice closes
  // — a wire that looks connected and posts nothing.
  let booksNote = "";
  if (status === "received") {
    try {
      const { postManifestReceipt } = await import("@/lib/accounting/receipt-service");
      // The Pacific business date the goods physically arrived. Built from
      // the repo's existing `pacificParts` helper rather than `toISOString()`,
      // which would roll a late-afternoon Pacific delivery onto TOMORROW's
      // date in UTC and land it in the wrong accounting period. Passed
      // explicitly so the caller owns the business-date decision.
      const { pacificParts } = await import("@/lib/reports/timezone");
      const p = pacificParts(new Date());
      const receivedDate = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
      const booked = await postManifestReceipt(manifestId, receivedDate);
      booksNote = booked.ok
        ? `&books=${encodeURIComponent(booked.code)}`
        : `&booksError=${encodeURIComponent(booked.message.slice(0, 300))}`;
    } catch (err) {
      booksNote = `&booksError=${encodeURIComponent(
        `The delivery was marked received, but the books could not be updated: ${
          err instanceof Error ? err.message : String(err)
        }`.slice(0, 300),
      )}`;
    }
  }

  redirect(`/admin/inventory/intake/${manifestId}?lifecycle=${status}${booksNote}`);
}

/**
 * W5 — human-confirmed manifest ↔ PO link (suggest-and-confirm; never auto).
 * `po_id` empty/absent = unlink. No-op-safe pre-migration-0102 (store returns
 * a plain error the page shows in its banner).
 */
export async function linkManifestPoAction(manifestId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const poId = ((formData.get("po_id") as string | null) ?? "").trim() || null;
  const { setManifestPoLink } = await import("@/lib/inventory/po-link-store");
  const result = await setManifestPoLink(manifestId, poId, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  if (!result.ok) {
    redirect(
      `/admin/inventory/intake/${manifestId}?error=polink&capmsg=${encodeURIComponent(result.error)}`,
    );
  }
  redirect(`/admin/inventory/intake/${manifestId}?polink=${poId ? "linked" : "unlinked"}`);
}

export async function archiveCoasAction(manifestId: string) {
  await requirePermission("inventory.manage");
  const { archiveCoasForManifest } = await import("@/lib/inventory/coa-archive");
  const count = await archiveCoasForManifest(manifestId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  redirect(`/admin/inventory/intake/${manifestId}?archived=${count}`);
}

export async function updateManifestTransportAction(
  manifestId: string,
  formData: FormData,
) {
  const session = await requirePermission("inventory.manage");
  const { updateManifestTransport } = await import("@/lib/inventory/intake-store");
  const str = (k: string) => ((formData.get(k) as string | null) ?? "").trim() || null;
  const result = await updateManifestTransport(
    manifestId,
    {
      transporter_name: str("transporter_name"),
      transporter_license: str("transporter_license"),
      driver_name: str("driver_name"),
      driver_license_number: str("driver_license_number"),
      vehicle_description: str("vehicle_description"),
      vehicle_plate: str("vehicle_plate"),
      vehicle_vin: str("vehicle_vin"),
      departed_at: str("departed_at"),
      arrived_at: str("arrived_at"),
      route_notes: str("route_notes"),
      eta_date: str("eta_date"),
    },
    session.userId,
  );
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=transport`);
  }
  redirect(`/admin/inventory/intake/${manifestId}?transport=1`);
}

/**
 * "Run AI extract" — the owner-requested on-demand button (hybrid pattern).
 *
 * SCOPED TO ONE MANIFEST by design: it takes a single `manifestId`, re-reads
 * ONLY that manifest's ARCHIVED documents (never a table-wide loop, so it can
 * never touch another vendor's order), re-runs the LlamaParse-primary parse,
 * records an HONEST AI status (so the table badge is never blank), and
 * backfills any transport field that is still empty (fill-only-empty — it never
 * overwrites a value staff already verified). It NEVER re-classifies, never
 * changes line items, and never touches the accept/activate path — so it cannot
 * endanger the CCRS-critical intake. Idempotent: safe to click repeatedly.
 *
 * Why re-read the ARCHIVE (not the live email): the email webhook can race its
 * own attachments (docs settle a few seconds later), which is exactly why an
 * auto-run right at arrival sometimes saw an incomplete set. The archive is the
 * settled, complete copy — so the button always reads the real documents.
 */
export async function reExtractManifestAiAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");

  const { getManifestById } = await import("@/lib/inventory/store");
  const manifest = await getManifestById(manifestId);
  if (!manifest) {
    redirect(`/admin/inventory/intake/${manifestId}?error=aiextract`);
  }

  const { downloadManifestDocs } = await import("@/lib/inventory/manifest-docs");
  const docs = await downloadManifestDocs(manifestId);
  const pdfDocs = docs.filter(
    (d) =>
      (d.contentType ?? "").toLowerCase().includes("pdf") ||
      d.filename.toLowerCase().endsWith(".pdf"),
  );
  if (pdfDocs.length === 0) {
    // Honest, non-blank status even when there's nothing to read.
    await recordManifestParseStatus(manifest.manifest_number, {
      engine: "none",
      ok: false,
      error: "No archived PDF documents to read for this manifest",
      note: "no pdf on file",
    });
    revalidatePath(`/admin/inventory/intake/${manifestId}`);
    redirect(`/admin/inventory/intake/${manifestId}?ai=nodocs`);
  }

  // Prefer the manifest-role PDF, else fall back to the first PDF (an invoice).
  const ordered = [...pdfDocs].sort((a, b) => {
    const rank = (r: string) => (r === "manifest" ? 0 : r === "invoice" ? 1 : 2);
    return rank(a.role) - rank(b.role);
  });

  const cap = makeCapturingRecovery();
  let filledFields = 0;
  let readInvoice: string | null = manifest.manifest_number ?? null;
  let usedRole = "";
  let parsedOk = false;

  for (const doc of ordered) {
    const res = await parsePdfManifest(doc.bytes, cap.recover);
    if (!res.ok) continue;
    parsedOk = true;
    usedRole = doc.role;
    // Backfill transport fill-only-empty (single-manifest, audited). Includes
    // the newly-captured driver license number where present.
    const { backfillManifestTransport } = await import("@/lib/inventory/intake-store");
    filledFields = await backfillManifestTransport(
      manifestId,
      res.manifest.transport,
      session.userId,
      `Run AI extract (${doc.role || "document"})`,
    );
    // Re-scan the invoice/order number from the freshly parsed text (read-only
    // convenience for the summary; the stored raw_payload is unchanged here).
    try {
      const { extractInvoiceNumberFromText } = await import(
        "@/lib/inventory/manifest-table-core"
      );
      readInvoice = extractInvoiceNumberFromText(res.text) ?? readInvoice;
    } catch {
      /* summary-only; ignore */
    }
    break; // the first PDF that parses is the primary; done.
  }

  // Record the honest AI status against the manifest number (never blank).
  await recordManifestParseStatus(
    manifest.manifest_number,
    cap.lastOutcome() ?? {
      engine: "none",
      ok: false,
      error: parsedOk
        ? "Parsed via basic text (AI recovery did not run)"
        : "Could not read the archived PDF",
      note: parsedOk ? "text fallback" : "unreadable",
    },
    { actorId: session.userId },
  );

  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  const params = new URLSearchParams({
    ai: "1",
    filled: String(filledFields),
    role: usedRole || "document",
  });
  if (readInvoice) params.set("inv", readInvoice);
  redirect(`/admin/inventory/intake/${manifestId}?${params.toString()}`);
}

/**
 * Correct the Invoice/Order # for one manifest (migration 0151). The value the
 * intake table shows is derived from the vendor payload; this lets the owner
 * override it when it's wrong (or clear the override with a blank value).
 * Additive-only — touches ONLY the invoice_number_override column. Scoped to a
 * single manifestId; never loops the table.
 */
export async function setInvoiceNumberAction(manifestId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const value = ((formData.get("invoice_number") as string | null) ?? "").trim();

  const res = await setManifestInvoiceOverride(manifestId, value, session.userId);

  // Revalidate both the list (Invoice # column) and the detail page.
  revalidatePath("/admin/inventory/intake");
  revalidatePath(`/admin/inventory/intake/${manifestId}`);

  if (!res.ok) {
    // NOTE: use the `invoice=` param (not `error=`) so the failure banner stays
    // on the email hero table where the edit happens. Routing it through the
    // shared `error=` param would force it into MANUAL_ERROR_CODES and wrongly
    // auto-open the Manual tools tab (see receiving-tabs-core.ts).
    redirect("/admin/inventory/intake?invoice=error");
  }
  redirect(`/admin/inventory/intake?invoice=${res.cleared ? "cleared" : "saved"}`);
}

/**
 * Reject the WHOLE manifest at the dock. Requires a reason (guard rail).
 * Refused product never enters inventory and is NEVER destroyed; we file
 * nothing with CCRS (the vendor corrects their own manifest).
 */
export async function rejectManifestAction(manifestId: string, formData: FormData) {
  const session = await requirePermission("inventory.manage");
  const norm = normalizeRejection(
    formData.get("reason_code") as string | null,
    formData.get("reason_text") as string | null,
  );
  if (!norm.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=reason`);
  }
  const result = await rejectManifest(manifestId, session.userId, {
    reasonCode: norm.value.reasonCode,
    reasonText: norm.value.reasonText,
  });
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=reject`);
  }
  redirect(`/admin/inventory/intake/${manifestId}?rejected=1`);
}

/**
 * Set a single lot's disposition. Reject requires a reason. Used by the
 * per-line accept/reject controls on the manifest review screen.
 */
export async function setLotDispositionAction(
  manifestId: string,
  lotId: string,
  disposition: "accepted" | "rejected_at_dock",
  formData: FormData,
) {
  const session = await requirePermission("inventory.manage");
  if (disposition === "rejected_at_dock") {
    const norm = normalizeRejection(
      formData.get("reason_code") as string | null,
      formData.get("reason_text") as string | null,
    );
    if (!norm.ok) {
      redirect(`/admin/inventory/intake/${manifestId}?error=reason`);
    }
    await setLotDisposition(lotId, "rejected_at_dock", session.userId, {
      reasonCode: norm.value.reasonCode,
      reasonText: norm.value.reasonText,
    });
  } else {
    await setLotDisposition(lotId, "accepted", session.userId);
  }
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  redirect(`/admin/inventory/intake/${manifestId}?lot=${disposition}`);
}

/**
 * Finalize the manifest after per-lot decisions: activate accepted lots, leave
 * refused ones out of inventory, and stamp the derived status
 * (accepted | rejected | partially_accepted).
 */
/**
 * Slice H11b — batch Transfer-Link importer. Fetches + stages a CHUNK of
 * transfer URLs (the client panel slices the pasted list into small chunks so
 * hundreds of links never hit one serverless timeout). Returns structured
 * per-URL results instead of redirecting.
 *
 * DRAFTS-ONLY: every staged manifest lands status='pending' with quarantine
 * lots, exactly like the single-URL importer — a human still reviews and
 * finalizes each one. Duplicate detection: a URL whose source_url was already
 * imported, or whose parsed manifest_number already exists, is skipped so
 * re-pasting an overlapping list never double-stages.
 */
export async function importManifestBatchAction(
  urls: string[],
): Promise<import("@/lib/inventory/batch-import-core").BatchUrlResult[]> {
  const session = await requirePermission("inventory.manage");
  const { parseUrlList, MAX_BATCH_URLS } = await import("@/lib/inventory/batch-import-core");
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const { isSupabaseServiceConfigured } = await import("@/lib/supabase/env");

  type BatchUrlResult = import("@/lib/inventory/batch-import-core").BatchUrlResult;
  const results: BatchUrlResult[] = [];
  if (!isSupabaseServiceConfigured) {
    return (Array.isArray(urls) ? urls : []).map((url) => ({
      url: String(url),
      status: "save_failed" as const,
      detail: "Supabase service role not configured.",
      manifestId: null,
    }));
  }

  // Re-validate server-side (never trust the client list): clean, http(s),
  // de-duplicated, capped.
  const cleaned = parseUrlList((Array.isArray(urls) ? urls : []).join("\n"));
  const admin = createSupabaseAdminClient();

  for (const url of cleaned.urls.slice(0, MAX_BATCH_URLS)) {
    // 1) Duplicate by source_url (exact match on the cleaned URL).
    const { data: byUrl } = await admin
      .from("inbound_manifests")
      .select("id, manifest_number")
      .eq("source_url", url)
      .limit(1);
    const urlHit = (byUrl as { id: string; manifest_number: string | null }[] | null)?.[0];
    if (urlHit) {
      results.push({
        url,
        status: "duplicate",
        detail: urlHit.manifest_number
          ? `Already imported as ${urlHit.manifest_number}.`
          : "This link was already imported.",
        manifestId: urlHit.id,
      });
      continue;
    }

    // 2) Fetch the transfer JSON (collapses the doubled-prefix bug, 15s cap).
    const fetched = await fetchTransferJson(url);
    if (!fetched.ok) {
      results.push({ url, status: "fetch_failed", detail: fetched.error, manifestId: null });
      continue;
    }

    // 3) Parse.
    const parsed = parseVendorJson(fetched.jsonText);
    if (!parsed.ok) {
      results.push({
        url,
        status: "parse_failed",
        detail: "The JSON didn't parse as a vendor manifest.",
        manifestId: null,
      });
      continue;
    }
    if (parsed.manifest.lines.length === 0) {
      results.push({
        url,
        status: "no_lines",
        detail: "No line items were found in that transfer.",
        manifestId: null,
      });
      continue;
    }

    // 4) Duplicate by manifest number (same transfer re-shared under a new URL).
    if (parsed.manifest.manifest_number) {
      const { data: byNum } = await admin
        .from("inbound_manifests")
        .select("id")
        .eq("manifest_number", parsed.manifest.manifest_number)
        .limit(1);
      const numHit = (byNum as { id: string }[] | null)?.[0];
      if (numHit) {
        results.push({
          url,
          status: "duplicate",
          detail: `Manifest ${parsed.manifest.manifest_number} was already imported.`,
          manifestId: numHit.id,
        });
        continue;
      }
    }

    // 5) Stage as a pending draft (same path as the single-URL importer).
    let rawPayload: unknown = fetched.jsonText;
    try {
      rawPayload = JSON.parse(fetched.jsonText);
    } catch {
      rawPayload = fetched.jsonText;
    }
    const staged = await stageManifest(parsed.manifest, rawPayload, session.userId, {
      sourceUrl: fetched.finalUrl,
    });
    if (!staged.ok) {
      results.push({ url, status: "save_failed", detail: staged.error, manifestId: null });
      continue;
    }
    results.push({
      url,
      status: "staged",
      detail: parsed.manifest.manifest_number
        ? `Staged ${parsed.manifest.manifest_number} (${parsed.manifest.lines.length} lines).`
        : `Staged (${parsed.manifest.lines.length} lines).`,
      manifestId: staged.manifestId,
    });
  }

  // Surface anything the server-side re-validation dropped so counts add up.
  for (const bad of cleaned.invalid) {
    results.push({
      url: bad,
      status: "fetch_failed",
      detail: "Not a valid http(s) URL.",
      manifestId: null,
    });
  }

  revalidatePath("/admin/inventory/intake");
  return results;
}

/**
 * Slice H11a — promote ONE manifest's product facts into KB drafts on demand.
 * Useful for manifests staged before this bridge existed, or a re-run after a
 * vendor/brand link was fixed. Drafts-only + idempotent (safe to repeat).
 */
export async function promoteManifestToKbAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");
  const { promoteManifestToKb } = await import("@/lib/inventory/manifest-kb-bridge");
  const result = await promoteManifestToKb(manifestId, session.userId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  if (!result.ok) {
    redirect(`/admin/inventory/intake/${manifestId}?error=kbpromote`);
  }
  redirect(
    `/admin/inventory/intake/${manifestId}?kb=${result.outcome.promoted}&kbstrains=${result.outcome.strainsEnriched}&kblicense=${result.outcome.vendorLicenseFilled ? 1 : 0}`,
  );
}

/**
 * Slice H11a — BACKFILL: promote every staged manifest (except whole-manifest
 * rejections) into KB drafts. Built for the owner's historical upload of
 * hundreds of transfer JSONs: upload/stage them all, click once. Idempotent.
 *
 * H12g: kept for API compatibility, but the intake page now uses the CHUNKED
 * client panel below (listKbBackfillManifestIdsAction +
 * promoteManifestChunkToKbAction) — one giant serverless sweep could outlive
 * the function timeout, which is why the owner never saw a confirmation.
 */
export async function backfillKbFromManifestsAction() {
  const session = await requirePermission("inventory.manage");
  const { backfillKbFromManifests } = await import("@/lib/inventory/manifest-kb-bridge");
  const result = await backfillKbFromManifests(session.userId);
  revalidatePath("/admin/inventory/intake");
  if (!result.ok) {
    redirect(`/admin/inventory/intake?error=kbbackfill`);
  }
  redirect(
    `/admin/inventory/intake?kbdone=${result.result.manifestsProcessed}&kbnew=${result.result.promoted}&kberr=${result.result.errors}`,
  );
}

/**
 * SLICE 67 — re-run the intelligence engines (word-by-word fact
 * extraction, house-type labeler, display-name builder) over the lots and
 * published menu items that were received BEFORE those engines shipped.
 * Fill-only and idempotent: the pure planner (reprocess-core.ts) writes a
 * fact only when the column is NULL, the value is arithmetic-VERIFIED, and
 * no reviewer has touched it — so re-running is always safe.
 */
export async function reprocessIntelligenceAction() {
  await requirePermission("inventory.manage");
  const { reprocessIntelligence } = await import("@/lib/inventory/reprocess-store");
  const result = await reprocessIntelligence();
  revalidatePath("/admin/inventory/intake");
  if (!result.ok) {
    console.error("[reprocess] pass failed:", result.message);
    redirect(`/admin/inventory/intake?error=reprocess`);
  }
  // The published menu's rows may have changed — refresh the website.
  revalidatePath("/menu");
  revalidatePath("/", "layout");
  redirect(
    `/admin/inventory/intake?repdone=1&replots=${result.lotsPatched}&repitems=${result.itemsPatched}&reperr=${result.errors}`,
  );
}

/**
 * Slice H12g — list the manifests the KB backfill would process (every
 * staged manifest except whole-manifest rejections, oldest first). The
 * client panel chunks these ids and promotes them a few at a time so every
 * server call finishes fast and progress is visible.
 */
export async function listKbBackfillManifestIdsAction(): Promise<
  { ok: true; ids: string[] } | { ok: false; error: string }
> {
  await requirePermission("inventory.manage");
  const { isSupabaseServiceConfigured } = await import("@/lib/supabase/env");
  if (!isSupabaseServiceConfigured) {
    return { ok: false, error: "Supabase service role not configured." };
  }
  const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("inbound_manifests")
    .select("id")
    .neq("status", "rejected")
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) return { ok: false, error: error.message };
  return { ok: true, ids: ((data as { id: string }[] | null) ?? []).map((r) => r.id) };
}

/**
 * Slice H12g — promote a small CHUNK of manifests into KB drafts and return
 * structured per-manifest outcomes (no redirect — the client panel renders
 * live progress and the final confirmation). Drafts-only + idempotent,
 * exactly like the single-manifest promote.
 */
export async function promoteManifestChunkToKbAction(
  manifestIds: string[],
): Promise<import("@/lib/inventory/kb-backfill-core").KbChunkOutcome[]> {
  const session = await requirePermission("inventory.manage");
  const { KB_BACKFILL_CHUNK_SIZE } = await import("@/lib/inventory/kb-backfill-core");
  const { promoteManifestToKb } = await import("@/lib/inventory/manifest-kb-bridge");

  // Server-side re-validation: never trust the client's chunking.
  const ids = [...new Set((manifestIds ?? []).map((s) => String(s).trim()).filter(Boolean))].slice(
    0,
    KB_BACKFILL_CHUNK_SIZE,
  );

  const outcomes: import("@/lib/inventory/kb-backfill-core").KbChunkOutcome[] = [];
  for (const manifestId of ids) {
    const res = await promoteManifestToKb(manifestId, session.userId);
    if (res.ok) {
      outcomes.push({
        manifestId,
        ok: true,
        promoted: res.outcome.promoted,
        strainsEnriched: res.outcome.strainsEnriched,
        vendorLicenseFilled: res.outcome.vendorLicenseFilled,
        error: null,
      });
    } else {
      outcomes.push({
        manifestId,
        ok: false,
        promoted: 0,
        strainsEnriched: 0,
        vendorLicenseFilled: false,
        error: res.error,
      });
    }
  }
  revalidatePath("/admin/inventory/intake");
  return outcomes;
}

export async function finalizeManifestAction(manifestId: string, formData?: FormData) {
  const session = await requirePermission("inventory.manage");
  // SLICE 101 — the owner's rule: a PARTIAL finalize must carry a why-partial
  // note (audit trail). The store validates BEFORE touching any lot; a missing
  // note on a partial redirects back with a specific, fixable error.
  const partialNote = (formData?.get("partial_note") as string | null) ?? null;
  const result = await finalizeManifestDispositions(manifestId, session.userId, { partialNote });
  revalidatePath(`/admin/inventory/intake/${manifestId}`);
  revalidatePath("/admin/inventory/intake");
  revalidatePath("/admin/inventory");
  if (!result.ok) {
    // H16b Samples Slice B: a sample-cap hard block is a DISTINCT, explainable
    // refusal (WAC 314-55-096 quarterly cap) — surface the specific reason so the
    // reviewer knows the manifest cannot be accepted (not a generic error).
    const isCapBlock = /quarterly\s+.*cap|314-55-096/i.test(result.error);
    if (isCapBlock) {
      redirect(
        `/admin/inventory/intake/${manifestId}?error=sample_cap&capmsg=${encodeURIComponent(result.error)}`,
      );
    }
    // SLICE 101 — missing why-partial note: a specific, fixable banner (the
    // reviewer types the note and finalizes again; nothing was touched).
    if (/note explaining why is required/i.test(result.error)) {
      redirect(`/admin/inventory/intake/${manifestId}?error=partial_note`);
    }
    redirect(`/admin/inventory/intake/${manifestId}?error=finalize`);
  }
  redirect(
    `/admin/inventory/intake/${manifestId}?finalized=${result.derivedStatus}&accepted=${result.activated}&rejected=${result.rejected}&drafts=${result.draftsCreated}&held=${result.blocked.length}`,
  );
}

/**
 * H16b Samples vendor-notice: email the supplying processor that their sample
 * delivery is on hold because accepting it would exceed the WAC 314-55-096
 * quarterly incoming cap (the Slice B block). Manual, owner-approved: the
 * reviewer clicks "Notify vendor" on the blocked banner. Sends TO the vendor
 * (when an email is on file) + an internal copy to ORDER_STAFF_EMAILS, logs a
 * `sample_cap_vendor_notified` manifest event, and redirects with a result
 * flag. Never sends for a manifest that is not actually over cap.
 */
export async function notifyVendorSampleCapAction(manifestId: string) {
  const session = await requirePermission("inventory.manage");
  const gathered = await gatherSampleCapNotice(manifestId);
  revalidatePath(`/admin/inventory/intake/${manifestId}`);

  // Nothing to notify: not configured, or the manifest is not (or no longer)
  // over cap. Refuse rather than send a misleading notice.
  if (!gathered) {
    redirect(`/admin/inventory/intake/${manifestId}?error=notify_unavailable`);
  }
  if (!gathered.blocked) {
    redirect(`/admin/inventory/intake/${manifestId}?error=notify_notblocked`);
  }

  const sent = await sendSampleCapVendorNotice({
    vendorEmail: gathered.vendorEmail,
    notice: gathered.notice,
  });

  // Audit trail: record what actually went out (or why it did not).
  const note = !sent.configured
    ? "Sample-cap vendor notice NOT sent: email is not configured (RESEND_API_KEY / ORDER_EMAIL_FROM)."
    : sent.missingVendorEmail
      ? `Sample-cap vendor notice: no vendor email on file — internal copy ${
          sent.sentToStaff ? "sent to staff" : "NOT sent"
        }.`
      : `Sample-cap vendor notice sent to ${gathered.vendorEmail}${
          sent.sentToStaff ? " (internal copy sent)" : ""
        }.`;
  await logManifestEvent(manifestId, "sample_cap_vendor_notified", note, session.userId);

  const flag = !sent.configured
    ? "unconfigured"
    : sent.missingVendorEmail
      ? "noemail"
      : sent.sentToVendor
        ? "sent"
        : "failed";
  redirect(`/admin/inventory/intake/${manifestId}?notified=${flag}`);
}
