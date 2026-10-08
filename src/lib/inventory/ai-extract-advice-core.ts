/**
 * src/lib/inventory/ai-extract-advice-core.ts
 *
 * R31: "should I press Run AI extract?" answered BEFORE anyone presses it.
 *
 * The owner: "move the llama parse button to the top of the page and make
 * sure it's helper text and such explain what we have currently and what
 * using the ai button will hopefully grab and from what PDFs and such. So we
 * know if we should push the button or not."
 *
 * Every rule below mirrors what reExtractManifestAiAction (intake/actions.ts)
 * ACTUALLY does, so the advice can never promise more than the button:
 *   - it reads archived PDFs only (content type contains "pdf" or the name
 *     ends in .pdf), in the order manifest, then invoice, then anything else;
 *   - it skips lab certificates (role "coa"), which are never transport or
 *     invoice documents;
 *   - with no PDF on file it stops at once ("Nothing to extract");
 *   - it fills ONLY empty transport fields (backfillManifestTransport,
 *     fill-only-empty) and never fills "Arrived" (arrived_at is a person's
 *     attestation, never document-sourced: doc-transport-core);
 *   - it re-checks the invoice / order # across every document.
 *
 * Pure: no I/O.
 */

export type AdviceDoc = {
  role: string;
  filename: string;
  contentType: string | null;
};

/** The ten transport fields the document readers can fill. Never arrived_at. */
export const AI_FILLABLE_TRANSPORT_FIELDS = [
  "transporter_name",
  "transporter_license",
  "driver_name",
  "driver_license_number",
  "vehicle_description",
  "vehicle_plate",
  "vehicle_vin",
  "departed_at",
  "eta_date",
  "route_notes",
] as const;
export type AiFillableField = (typeof AI_FILLABLE_TRANSPORT_FIELDS)[number];

export const AI_FIELD_LABEL: Record<AiFillableField, string> = {
  transporter_name: "transporter",
  transporter_license: "transporter license #",
  driver_name: "driver name",
  driver_license_number: "driver license #",
  vehicle_description: "vehicle",
  vehicle_plate: "license plate",
  vehicle_vin: "VIN",
  departed_at: "departure time",
  eta_date: "ETA",
  route_notes: "route notes",
};

/**
 * Route notes are optional on most manifests, so a blank one alone is not a
 * reason to press the button. Every other fillable field is.
 */
const OPTIONAL_FIELDS: ReadonlySet<AiFillableField> = new Set(["route_notes"]);

export type AdviceInput = {
  /** Archived documents for this manifest; null = the archive could not be read. */
  docs: AdviceDoc[] | null;
  /** The SAVED transport values on the manifest row (not the form suggestions). */
  saved: Partial<Record<AiFillableField, string | null>>;
  invoiceNumberOverride?: string | null;
  invoiceNumberDetected?: string | null;
  /** Last recorded document-AI outcome for this manifest number. */
  parse: { ok: boolean; engine: "llamaparse" | "unpdf" | "none"; shortReason: string };
};

export type AdviceVerdict = "useful" | "tried" | "not_needed" | "no_docs" | "unknown";

export type AiExtractAdvice = {
  verdict: AdviceVerdict;
  /** Short call to action ("Worth pressing", "Not needed"...). */
  headline: string;
  /** One or two plain sentences. */
  detail: string;
  /** Files the button would read, in the order it reads them. */
  reads: string[];
  /** Files it would skip, with why (e.g. "coa.pdf (lab certificate)"). */
  skips: string[];
  /** What is already on file (plain words). */
  have: string[];
  /** What it would try to find (plain words). */
  missing: string[];
  /** Show the button at all? (false when there is nothing for it to read). */
  showButton: boolean;
  /** Visual weight: "special" (purple AI) when worth pressing, else "neutral". */
  buttonVariant: "special" | "neutral";
};

function filled(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/** The exact PDF test reExtractManifestAiAction uses. */
export function isReadablePdf(d: AdviceDoc): boolean {
  return (d.contentType ?? "").toLowerCase().includes("pdf") || d.filename.toLowerCase().endsWith(".pdf");
}

function rank(role: string): number {
  return role === "manifest" ? 0 : role === "invoice" ? 1 : 2;
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function adviseAiExtract(input: AdviceInput): AiExtractAdvice {
  const haveInvoice = filled(input.invoiceNumberOverride) || filled(input.invoiceNumberDetected);
  const have: string[] = [];
  const missing: string[] = [];
  let missingKey = 0;
  for (const f of AI_FILLABLE_TRANSPORT_FIELDS) {
    if (filled(input.saved[f])) have.push(AI_FIELD_LABEL[f]);
    else {
      missing.push(AI_FIELD_LABEL[f]);
      if (!OPTIONAL_FIELDS.has(f)) missingKey += 1;
    }
  }
  if (haveInvoice) have.unshift("invoice / order #");
  else missing.unshift("invoice / order #");

  if (input.docs === null) {
    return {
      verdict: "unknown",
      headline: "Could not check the documents",
      detail:
        "The document archive could not be read just now, so this page cannot say what the button would find. Pressing it is safe: it only fills empty fields.",
      reads: [],
      skips: [],
      have,
      missing,
      showButton: true,
      buttonVariant: "neutral",
    };
  }

  const pdfs = input.docs.filter(isReadablePdf);
  const readable = pdfs.filter((d) => d.role !== "coa").sort((a, b) => rank(a.role) - rank(b.role));
  const reads = readable.map((d) => `${d.filename} (${d.role === "other" ? "other PDF" : d.role})`);
  const skips = [
    ...pdfs.filter((d) => d.role === "coa").map((d) => `${d.filename} (lab certificate)`),
    ...input.docs.filter((d) => !isReadablePdf(d)).map((d) =>
      `${d.filename} (${d.role === "transfer-json" ? "transfer file, already read when the email arrived" : "not a PDF"})`,
    ),
  ];

  if (pdfs.length === 0) {
    return {
      verdict: "no_docs",
      headline: "Nothing to read — don't press",
      detail:
        "No PDF is archived for this delivery, so the AI has nothing to read. Everything on this page came from the transfer file. Type any missing transport details into the form below.",
      reads,
      skips,
      have,
      missing,
      showButton: false,
      buttonVariant: "neutral",
    };
  }
  if (readable.length === 0) {
    return {
      verdict: "no_docs",
      headline: "Only lab certificates — don't press",
      detail:
        "The only PDFs on file are lab certificates (COAs). The AI extract never reads those for transport or the invoice #; finalize already files and reads them. Type any missing transport details into the form below.",
      reads,
      skips,
      have,
      missing,
      showButton: false,
      buttonVariant: "neutral",
    };
  }

  const fromWhat = `It would read ${list(reads)}.`;
  if (missingKey === 0 && haveInvoice) {
    return {
      verdict: "not_needed",
      headline: "Not needed — you already have it",
      detail: `The invoice # and every transport detail a document can carry are already on file. The button only fills EMPTY fields, so pressing it would change nothing. ${fromWhat}`,
      reads,
      skips,
      have,
      missing,
      showButton: true,
      buttonVariant: "neutral",
    };
  }

  const want = missing.filter((m) => m !== AI_FIELD_LABEL.route_notes);
  const wantText = list(want.length > 0 ? want : missing);
  if (input.parse.ok && input.parse.engine === "llamaparse") {
    return {
      verdict: "tried",
      headline: "Already read by LlamaParse — optional",
      detail: `LlamaParse already read this delivery's PDFs, and these are still blank: ${wantText}. They are most likely not printed on these documents. Press again only if a new document was attached since. ${fromWhat}`,
      reads,
      skips,
      have,
      missing,
      showButton: true,
      buttonVariant: "neutral",
    };
  }

  const caveat =
    input.parse.engine === "none" && input.parse.shortReason === "no AI record"
      ? ""
      : !input.parse.ok
        ? ` Last time LlamaParse did not run (${input.parse.shortReason}); if that is still true it falls back to basic text, which finds less.`
        : "";
  return {
    verdict: "useful",
    headline: "Worth pressing",
    detail: `It would look for: ${wantText}. ${fromWhat} It only fills empty fields and never fills "Arrived".${caveat}`,
    reads,
    skips,
    have,
    missing,
    showButton: true,
    buttonVariant: "special",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runAiExtractAdviceCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`ai-extract-advice-core self-test FAILED: ${what}`);
    }
  };
  const noRecord = { ok: false, engine: "none" as const, shortReason: "no AI record" };
  const llama = { ok: true, engine: "llamaparse" as const, shortReason: "LlamaParse vision" };
  const fullTransport = {
    transporter_name: "Acme",
    transporter_license: "412345",
    driver_name: "Pat",
    driver_license_number: "WDL123",
    vehicle_description: "White van",
    vehicle_plate: "ABC123",
    vehicle_vin: "1FT",
    departed_at: "2026-01-01T10:00:00Z",
    eta_date: "2026-01-01",
  };
  const manifestPdf = { role: "manifest", filename: "manifest.pdf", contentType: "application/pdf" };
  const invoicePdf = { role: "invoice", filename: "inv.pdf", contentType: "application/pdf" };
  const coaPdf = { role: "coa", filename: "coa.pdf", contentType: "application/pdf" };
  const json = { role: "transfer-json", filename: "transfer.json", contentType: "application/json" };

  // 1. Archive unreadable -> unknown, never "no documents".
  const u = adviseAiExtract({ docs: null, saved: {}, parse: noRecord });
  ok(u.verdict === "unknown" && u.showButton, "null docs -> unknown, button still offered");

  // 2. No docs at all.
  const n = adviseAiExtract({ docs: [], saved: {}, parse: noRecord });
  ok(n.verdict === "no_docs" && !n.showButton, "no docs -> no_docs, no button");
  ok(n.headline.includes("don't press"), "no docs says don't press");

  // 3. Only JSON -> no_docs, the JSON listed as skipped (already read).
  const j = adviseAiExtract({ docs: [json], saved: {}, parse: noRecord });
  ok(j.verdict === "no_docs" && j.skips[0].includes("already read"), "json only -> no_docs + skip reason");

  // 4. Only COA PDFs -> no_docs (the action skips coa).
  const c = adviseAiExtract({ docs: [coaPdf], saved: {}, parse: noRecord });
  ok(c.verdict === "no_docs" && c.headline.includes("lab certificates"), "coa only -> no_docs");
  ok(c.skips.includes("coa.pdf (lab certificate)"), "coa listed as skipped");

  // 5. Manifest PDF + empty transport -> useful, purple.
  const w = adviseAiExtract({ docs: [invoicePdf, coaPdf, manifestPdf], saved: {}, parse: noRecord });
  ok(w.verdict === "useful" && w.buttonVariant === "special", "empty transport -> useful");
  ok(w.reads[0] === "manifest.pdf (manifest)" && w.reads[1] === "inv.pdf (invoice)", "reads manifest first, then invoice");
  ok(w.reads.length === 2, "coa never in reads");
  ok(w.detail.includes("never fills \"Arrived\""), "arrived never filled is stated");
  ok(w.missing[0] === "invoice / order #", "missing invoice listed first");
  ok(!w.detail.includes("did not run"), "no caveat when there is no AI record yet");

  // 6. Everything filled + invoice -> not_needed (neutral button).
  const full = adviseAiExtract({
    docs: [manifestPdf],
    saved: fullTransport,
    invoiceNumberDetected: "INV-9",
    parse: noRecord,
  });
  ok(full.verdict === "not_needed" && full.buttonVariant === "neutral", "all filled -> not_needed");
  ok(full.have[0] === "invoice / order #", "invoice listed in have");
  ok(full.missing.length === 1 && full.missing[0] === "route notes", "only route notes missing");

  // 7. Override counts as having the invoice.
  const ov = adviseAiExtract({ docs: [manifestPdf], saved: fullTransport, invoiceNumberOverride: "X1", parse: noRecord });
  ok(ov.verdict === "not_needed", "override counts as invoice");

  // 8. Filled transport but NO invoice -> useful (the invoice # can still be found).
  const ni = adviseAiExtract({ docs: [manifestPdf], saved: fullTransport, parse: noRecord });
  ok(ni.verdict === "useful" && ni.detail.includes("invoice / order #"), "missing invoice -> useful");

  // 9. Whitespace is not a value.
  const ws = adviseAiExtract({
    docs: [manifestPdf],
    saved: { ...fullTransport, driver_name: "   " },
    invoiceNumberDetected: "INV",
    parse: noRecord,
  });
  ok(ws.verdict === "useful" && ws.detail.includes("driver name"), "blank driver -> useful");

  // 10. LlamaParse already succeeded and blanks remain -> tried (optional).
  const t = adviseAiExtract({ docs: [manifestPdf], saved: {}, parse: llama });
  ok(t.verdict === "tried" && t.buttonVariant === "neutral" && t.showButton, "llama ok + blanks -> tried");
  ok(t.detail.includes("new document"), "tried explains when pressing again helps");

  // 11. Last run fell back -> useful with an honest caveat.
  const fb = adviseAiExtract({
    docs: [manifestPdf],
    saved: {},
    parse: { ok: false, engine: "unpdf", shortReason: "basic-text fallback" },
  });
  ok(fb.verdict === "useful" && fb.detail.includes("basic-text fallback"), "fallback caveat");

  // 12. PDF detection by filename when content type is missing.
  const byName = adviseAiExtract({ docs: [{ role: "other", filename: "Scan.PDF", contentType: null }], saved: {}, parse: noRecord });
  ok(byName.verdict === "useful" && byName.reads[0] === "Scan.PDF (other PDF)", ".PDF name counts as pdf");

  // 13. A non-pdf image is skipped as not a PDF.
  const img = adviseAiExtract({ docs: [{ role: "other", filename: "a.png", contentType: "image/png" }, manifestPdf], saved: {}, parse: noRecord });
  ok(img.skips.includes("a.png (not a PDF)"), "image skipped");

  // 14. arrived_at is not one of the fields it promises.
  ok(!(AI_FILLABLE_TRANSPORT_FIELDS as readonly string[]).includes("arrived_at"), "arrived_at never fillable");
  ok(AI_FILLABLE_TRANSPORT_FIELDS.length === 10, "ten fillable fields");

  // 15. Only route notes blank + invoice -> not_needed (optional field).
  const rn = adviseAiExtract({ docs: [manifestPdf], saved: fullTransport, invoiceNumberDetected: "I", parse: noRecord });
  ok(rn.verdict === "not_needed", "route notes alone is not a reason");

  return { passed, failed };
}
