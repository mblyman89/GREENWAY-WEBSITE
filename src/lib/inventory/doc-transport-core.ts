/**
 * src/lib/inventory/doc-transport-core.ts  (R26, PURE)
 *
 * ONE place that turns a single document into a GROUNDED transport donor,
 * used by BOTH the email intake (inbound-store) and "Run AI extract"
 * (reExtractManifestAiAction) so the two can never drift.
 *
 * Owner: "Ideally, I want the delivery details from the 'transportation
 * manifest' to fill the delivery details in the accept lots."
 *
 * For one document we have up to three readings:
 *   - visionText: LlamaParse markdown (primary since #799) or unpdf text when
 *     vision did not run;
 *   - layer: the PDF's own text layer (unpdf) + page-1 positioned items;
 *   - layoutTransport: what a layout parser (LCB / GrowFlow / TransferLog /
 *     OpenTHC) already read from the text, when one matched.
 *
 * Sources, best first (fill-only-when-empty; a later source never overwrites):
 *   1. layout parser transport (verified layouts, unchanged behaviour);
 *   2. Contingency Manifest positional reader (labels are images; values are
 *      read by their measured cell positions — pdf-contingency-manifest-core);
 *   3. Cultivera invoice reader;
 *   4. generic field-label reader over the vision text (markdown-aware);
 *   5. generic field-label reader over the text layer.
 * Then GROUNDING (extraction-grounding-core): when the PDF has a usable text
 * layer, every value must be found in it — a vision hallucination is dropped
 * and reported. Scans (no layer) keep vision values as review drafts.
 *
 * PURE: no I/O. Self-tests: __runDocTransportTests.
 */
import { emptyTransport, transportHasData, type ParsedTransport } from "@/lib/inventory/intake-parser";
import { mergeTransportFillEmpty, type TransportDonor } from "@/lib/inventory/manifest-merge-core";
import { extractCultiveraInvoiceTransport } from "@/lib/inventory/pdf-cultivera-invoice-core";
import { extractGenericPdfTransport } from "@/lib/inventory/pdf-generic-transport-core";
import {
  readContingencyManifestTransport,
  QGT_CONTINGENCY_PAGE1,
  type PageLayer,
} from "@/lib/inventory/pdf-contingency-manifest-core";
import { groundTransport, groundValue, hasUsableLayer } from "@/lib/inventory/extraction-grounding-core";

export type DocReadings = {
  /** Primary text: LlamaParse markdown, or unpdf text when vision didn't run. */
  visionText: string | null;
  /** unpdf text layer (null/"" for a scanned image). */
  layerText: string | null;
  /** unpdf page-1 positioned items (null when unavailable). */
  page1: PageLayer | null;
  /** A layout parser's result, when the text matched a verified layout. */
  layoutManifestNumber?: string | null;
  layoutTransport?: ParsedTransport | null;
};

export type DocTransport = {
  donor: TransportDonor | null;
  /** Which readers contributed, in order (for the audit note). */
  sources: string[];
  groundedBy: "text-layer" | "vision-only";
  /** Vision values removed because the text layer does not contain them. */
  dropped: { field: keyof ParsedTransport; value: string }[];
};

export function readDocTransport(r: DocReadings): DocTransport {
  let t: ParsedTransport = emptyTransport();
  // The layout parser read the (vision) text, so its manifest # is grounded
  // like every other value (a scan keeps it vision-only).
  let manifestNumber: string | null = groundValue(r.layoutManifestNumber, r.layerText).value;
  const sources: string[] = [];
  const dropped: DocTransport["dropped"] = [];
  // R26 (mutation-found): ground EACH reader's values BEFORE the fill-only
  // merge. Grounding after the merge let a hallucinated value from an earlier
  // reader occupy a field, block the real value a later reader (e.g. the
  // Contingency Manifest positions) had, and then be dropped - leaving the
  // field blank although the page prints it.
  const take = (label: string, num: string | null | undefined, tr: ParsedTransport | null | undefined) => {
    if (!transportHasData(tr)) return;
    const g = groundTransport(tr, r.layerText);
    for (const d of g.dropped) {
      if (!dropped.some((x) => x.field === d.field && x.value === d.value)) dropped.push(d);
    }
    // A reader whose every value was dropped is a hallucinated read: it is
    // not credited as a source and does not get to name the manifest #.
    if (!transportHasData(g.transport)) return;
    const before = JSON.stringify(t);
    // mergeTransportFillEmpty never copies arrived_at (a human attestation,
    // never document-sourced), so t.arrived_at stays null by construction.
    t = mergeTransportFillEmpty(t, g.transport).transport;
    if (JSON.stringify(t) !== before) sources.push(label);
    // The manifest # is grounded too (on a digital PDF it must be printed in
    // the layer; a scan keeps it as vision-only) - it steers donor matching.
    const n = groundValue(num, r.layerText).value;
    if (!manifestNumber && n) manifestNumber = n;
  };

  take("layout", r.layoutManifestNumber, r.layoutTransport);
  const cont = readContingencyManifestTransport(r.page1);
  if (cont) take("contingency-positions", cont.manifest_number, cont.transport);
  for (const [label, text] of [
    ["vision", r.visionText],
    ["layer", r.layerText],
  ] as const) {
    if (!text) continue;
    const inv = extractCultiveraInvoiceTransport(text);
    if (inv) take(`cultivera-invoice(${label})`, inv.manifest_number, inv.transport);
    const gen = extractGenericPdfTransport(text);
    if (gen) take(`labels(${label})`, gen.manifest_number, gen.transport);
  }
  const donor = transportHasData(t) ? { manifest_number: manifestNumber, transport: t } : null;
  return {
    donor,
    sources,
    groundedBy: hasUsableLayer(r.layerText) ? "text-layer" : "vision-only",
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Self-tests — REAL QGT page/layers + LABELLED SYNTHETIC LlamaParse markdown.
// ---------------------------------------------------------------------------
export function __runDocTransportTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL: doc-transport", msg);
    }
  };
  // REAL QGT Contingency Manifest layer (values only; labels are an image).
  const layer =
    "3/12/25 (360)930-8790 03/13/2025 07:00 am 03/13/2025 04:00 pm Chris Gibilterra Standard Delivery " +
    "QUALITY GREEN TREES 413632 26268 12 TREES LN NW STE 140 POULSBO, WA 983706402 sales@freddysfuego.com " +
    "W1Y40BHY9LT036548 WhiteA3169588 Mercedes Benz Sprinters250 1Manifest ID: 15410217973875889";

  // 1) The owner's real failure: no vision (key unset / outage) -> layer only.
  const a = readDocTransport({ visionText: layer, layerText: layer, page1: QGT_CONTINGENCY_PAGE1 });
  ok(a.donor?.manifest_number === "15410217973875889", "manifest # from the page footer");
  ok(a.donor?.transport?.driver_name === "Chris Gibilterra", "driver");
  ok(a.donor?.transport?.vehicle_vin === "W1Y40BHY9LT036548", "vin");
  ok(a.donor?.transport?.vehicle_plate === "A3169588", "plate");
  ok(a.donor?.transport?.vehicle_description === "White Mercedes Benz Sprinters250", "vehicle");
  ok(a.donor?.transport?.departed_at === "2025-03-13T07:00", "departure");
  ok(a.donor?.transport?.eta_date === "2025-03-13", "eta");
  ok(a.donor?.transport?.arrived_at === null, "arrived_at never doc-sourced");
  ok(a.sources[0] === "contingency-positions", `positions first (got ${a.sources.join(",")})`);
  ok(a.groundedBy === "text-layer" && a.dropped.length === 0, "all grounded");

  // 2) SYNTHETIC LlamaParse markdown with ONE hallucinated value (the wrong
  //    departure day a generic image reader produced on this page) and NO
  //    positional page (e.g. a different render): labels feed, grounding drops
  //    the hallucination.
  const md =
    "## Estimated Departure / Arrival\n" +
    "| Departure Date/Time: | 03/15/2025 07:30 am | Arrival Date/Time: | 03/13/2025 04:00 pm |\n" +
    "|---|---|---|---|\n" +
    "## Driver & Vehicle Information\n" +
    "| Driver Name: | Chris Gibilterra | VIN #: | W1Y40BHY9LT036548 |\n" +
    "| Vehicle License Plate: | A3169588 | Vehicle Color: | White |\n" +
    "| Vehicle Make: | Mercedes Benz | Vehicle Model: | Sprinters250 |\n\nManifest ID: 15410217973875889";
  const b = readDocTransport({ visionText: md, layerText: layer, page1: null });
  ok(b.donor?.transport?.driver_name === "Chris Gibilterra", "md driver");
  ok(b.donor?.transport?.vehicle_plate === "A3169588", "md plate");
  ok(b.donor?.transport?.vehicle_description === "White Mercedes Benz Sprinters250", "md vehicle");
  ok(b.donor?.transport?.eta_date === "2025-03-13", "md eta");
  ok(b.donor?.transport?.departed_at === null, `hallucinated departure dropped (got ${b.donor?.transport?.departed_at})`);
  ok(b.dropped.some((d) => d.field === "departed_at"), "drop reported");
  ok(b.donor?.manifest_number === "15410217973875889", "md manifest #");

  // 3) Scan: no layer -> vision-only drafts kept.
  const c = readDocTransport({ visionText: md, layerText: "", page1: null });
  ok(c.groundedBy === "vision-only" && c.donor?.transport?.departed_at === "03/15/2025 07:30 am", "scan keeps vision draft");

  // 4) Layout transport wins; later readers only fill blanks.
  const d = readDocTransport({
    visionText: layer,
    layerText: layer,
    page1: QGT_CONTINGENCY_PAGE1,
    layoutManifestNumber: "15410217973875889",
    layoutTransport: { ...emptyTransport(), driver_name: "Chris Gibilterra", vehicle_plate: "A3169588" },
  });
  ok(d.sources[0] === "layout" && d.donor?.transport?.vehicle_vin === "W1Y40BHY9LT036548", "layout first, positions fill");

  // 5) Nothing readable -> no donor (never a donor of nulls).
  const e = readDocTransport({ visionText: "hello", layerText: "", page1: null });
  ok(e.donor === null && e.sources.length === 0, "no facts -> null donor");

  // 6) R26 (mutation-found): a hallucinated LAYOUT value must not block the
  //    real positional value. SYNTHETIC layout read with a wrong driver, VIN
  //    and departure day vs the REAL page: the page's values win.
  const f = readDocTransport({
    visionText: null,
    layerText: layer,
    page1: QGT_CONTINGENCY_PAGE1,
    layoutManifestNumber: "15410217973875889",
    layoutTransport: {
      ...emptyTransport(),
      driver_name: "Tyler hart",
      vehicle_vin: "JF1GH63638G828028",
      departed_at: "2025-03-15T09:00",
      arrived_at: "2025-03-13T16:00",
    },
  });
  ok(f.donor?.transport?.driver_name === "Chris Gibilterra", `real driver wins (got ${f.donor?.transport?.driver_name})`);
  ok(f.donor?.transport?.vehicle_vin === "W1Y40BHY9LT036548", "real vin wins over hallucinated layout vin");
  ok(f.donor?.transport?.departed_at === "2025-03-13T07:00", "real departure wins");
  ok(f.donor?.transport?.arrived_at === null, "arrived_at from a layout read is never kept");
  ok(
    f.dropped.length === 3 && ["driver_name", "vehicle_vin", "departed_at"].every((k) => f.dropped.some((d) => d.field === k)),
    `three hallucinations reported once each (got ${JSON.stringify(f.dropped)})`,
  );
  ok(f.sources[0] === "contingency-positions", "a fully-dropped layout read is not credited as a source");

  // 7) The FIRST reader that contributes names the manifest #; a later
  //    reader with a different number never overwrites it.
  const g7 = readDocTransport({
    visionText: null,
    layerText: layer,
    page1: QGT_CONTINGENCY_PAGE1,
    layoutManifestNumber: null,
    layoutTransport: null,
  });
  ok(g7.donor?.manifest_number === "15410217973875889", "positions supply the # when no layout #");
  const h7 = readDocTransport({
    visionText: "Transportation Manifest\nManifest #: 999000111\nDriver Name: Chris Gibilterra",
    layerText: layer + " 999000111",
    page1: QGT_CONTINGENCY_PAGE1,
  });
  ok(h7.donor?.manifest_number === "15410217973875889", `first contributing reader's # kept (got ${h7.donor?.manifest_number})`);

  // 8) R26 (mutation-found): a reader whose EVERY value is a hallucination
  //    must not name the manifest # (it steers donor matching), and the
  //    manifest # itself must be printed on a digital PDF.
  const allFake =
    "# Transportation Manifest\nManifest #: 888777666\nDriver Name: Pat Fake\n" +
    "VIN #: 1HGCM82633A004352\nVehicle License Plate: ZZZ9999";
  const i8 = readDocTransport({ visionText: allFake, layerText: layer, page1: QGT_CONTINGENCY_PAGE1 });
  ok(i8.donor?.manifest_number === "15410217973875889", `hallucinated read never names the # (got ${i8.donor?.manifest_number})`);
  ok(!i8.sources.some((x) => x.startsWith("labels(vision)")), "fully-dropped read not credited");
  const j8 = readDocTransport({
    visionText: "# Transportation Manifest\nManifest #: 888777666\nDriver Name: Chris Gibilterra",
    layerText: layer,
    page1: null,
  });
  ok(j8.donor?.manifest_number === null, `an un-printed manifest # is not taken (got ${j8.donor?.manifest_number})`);
  ok(j8.donor?.transport?.driver_name === "Chris Gibilterra", "the grounded driver still fills");
  const k8 = readDocTransport({ visionText: allFake, layerText: "", page1: null });
  ok(k8.donor?.manifest_number === "888777666" && k8.groundedBy === "vision-only", "scan keeps its # as vision-only");

  // 10) A fully-dropped read BEFORE a contributing one: its manifest # (even
  //     one printed elsewhere on the page - here the vendor LICENSE 413632)
  //     must not be taken. SYNTHETIC layer with labels (labelled).
  const synthLayer =
    "Transportation Manifest\nManifest #: 15410217973875889\nDriver Name: Chris Gibilterra\n" +
    "Vehicle License Plate: A3169588\nLicense: 413632";
  const m10 = readDocTransport({
    visionText: "# Transportation Manifest\nManifest #: 413632\nDriver Name: Pat Fake\nVIN #: 1HGCM82633A004352",
    layerText: synthLayer,
    page1: null,
  });
  ok(m10.donor?.manifest_number === "15410217973875889", `dropped read's # not taken (got ${m10.donor?.manifest_number})`);
  ok(m10.sources.join(",") === "labels(layer)", `only the contributing reader credited (got ${m10.sources.join(",")})`);
  // An un-printed LAYOUT manifest # is not taken either.
  const n10 = readDocTransport({ visionText: null, layerText: layer, page1: null, layoutManifestNumber: "888777666", layoutTransport: null });
  ok(n10.donor === null, "no transport -> no donor");
  const o10 = readDocTransport({
    visionText: null,
    layerText: layer,
    page1: null,
    layoutManifestNumber: "888777666",
    layoutTransport: { ...emptyTransport(), driver_name: "Chris Gibilterra" },
  });
  ok(o10.donor?.manifest_number === null, `un-printed layout # dropped (got ${o10.donor?.manifest_number})`);

  // 9) The same hallucination read by two readers is reported ONCE.
  const l9 = readDocTransport({
    visionText: allFake,
    layerText: layer,
    page1: null,
    layoutManifestNumber: null,
    layoutTransport: { ...emptyTransport(), driver_name: "Pat Fake" },
  });
  ok(
    l9.dropped.filter((d) => d.field === "driver_name" && d.value === "Pat Fake").length === 1,
    `duplicate drop reported once (got ${JSON.stringify(l9.dropped)})`,
  );
  ok(l9.dropped.length === 3, `three distinct drops (got ${l9.dropped.length})`);

  console.log(`doc-transport self-tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
