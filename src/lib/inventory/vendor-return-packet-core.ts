/**
 * src/lib/inventory/vendor-return-packet-core.ts  (Fix Phase 1.7b · G-42 req 7)
 *
 * PURE layout of the printable vendor-return packet (form 8.2 in the app).
 * No I/O: the print page, the self-test and the tests share one source.
 *
 * Owner basis (verbatim, owner message 4): "please also build the printable
 * vendor-return packet (G-42)." G-42 requirement 7 had said "the printable
 * packet stays paper form 8.2 (not built)". The packet is filed by month for
 * five years with the RMA email and the LCB success email and PDF
 * (WAC 314-55-087; SOP-15 §4.13 step 3).
 *
 * What it decides
 *   1. The sections follow paper form 8.2 (SOP-15 §8.2) step by step: the
 *      header (processor, license, contact, reason), STEP 1 RMA, STEP 2 units
 *      reserved, STEP 3 Manifest.CSV uploaded and transport, STEP 4 LCB
 *      success email, STEP 5 departure, and a cancel section when cancelled.
 *   2. Every value comes from the stored return, its lot, its vendor, the
 *      store's license settings and the staff roster. Nothing is guessed: a
 *      value the app does not hold prints as a blank line to fill by hand
 *      ("not recorded" for a step that is done but lacks the detail).
 *   3. What only paper can hold stays a line or a box on the print: the
 *      second count, the ID check, sealed and locked, the units counted out
 *      with the driver, both signatures, and STEP 6 the credit memo.
 *   4. Times are Pacific (F-15-5), using formatPacific of vendor-return-core.
 */
import { VENDOR_RETURN_REASON_LABELS } from "@/lib/inventory/disposition-reasons";
import {
  TRANSPORTATION_TYPE_LABELS,
  VENDOR_RETURN_STATUS_LABELS,
  formatPacific,
  isLegacyReducedReturn,
  vendorReturnManifestId,
  type TransportationType,
  type VendorReturnStatus,
} from "@/lib/inventory/vendor-return-core";

/** A blank to fill by hand on the printed packet. */
export const PACKET_BLANK = "________________";
/** A step that is done in the app but the detail was not stored. */
export const PACKET_NOT_RECORDED = "not recorded";

export type PacketReturn = {
  id: string;
  quantity: number;
  reason: string;
  detail?: string | null;
  rma_number?: string | null;
  processor_license?: string | null;
  manifest_number?: string | null;
  manifest_status?: string | null;
  pickup_at?: string | null;
  reserved_qty?: number | null;
  adjustment_id?: string | null;
  recall_officer?: string | null;
  recall_contact_date?: string | null;
  created_at: string;
  requested_at?: string | null;
  transportation_type?: string | null;
  transporter_license?: string | null;
  driver_name?: string | null;
  vehicle_vin?: string | null;
  vehicle_plate?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  est_departure_at?: string | null;
  est_arrival_at?: string | null;
  submitted_at?: string | null;
  lcb_email_date?: string | null;
  confirmed_at?: string | null;
  departed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
};

export type PacketInput = {
  ret: PacketReturn;
  lot: { lot_code?: string | null; product_name?: string | null; unit?: string | null } | null;
  vendor: { display_name?: string | null; legal_name?: string | null; phone?: string | null; email?: string | null } | null;
  origin: { license_number?: string | null; trade_name?: string | null; location_address?: string | null; city?: string | null; contact_phone?: string | null; contact_email?: string | null } | null;
  /** Names from staff_profiles (full name, else email), or null when not stamped. */
  names: {
    created_by?: string | null;
    requested_by?: string | null;
    submitted_by?: string | null;
    confirmed_by?: string | null;
    departed_by?: string | null;
    cancelled_by?: string | null;
  };
};

export type PacketRow = { label: string; value: string; testid?: string };
export type PacketSection = { key: string; title: string; rows: PacketRow[]; done: boolean };

const STEP_ORDER: Record<string, number> = { none: 0, requested: 1, submitted: 2, confirmed: 3, picked_up: 4, cancelled: -1 };

function clean(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A value, or a blank to fill by hand. */
function orBlank(v: string | null | undefined): string {
  const s = clean(v);
  return s || PACKET_BLANK;
}

/** "when by who" for a stamped step; "not recorded" when the step is done without a stamp; a blank otherwise. */
export function stampCell(at: string | null | undefined, by: string | null | undefined, done: boolean): string {
  const when = formatPacific(at ?? null);
  const who = clean(by);
  if (when && who) return `${when} by ${who}`;
  if (when) return `${when} (who: ${PACKET_NOT_RECORDED})`;
  if (who) return `by ${who} (when: ${PACKET_NOT_RECORDED})`;
  return done ? PACKET_NOT_RECORDED : PACKET_BLANK;
}

/** The packet's number: the manifest identifier the app assigned (or the one entered). */
export function packetNumber(ret: Pick<PacketReturn, "id" | "manifest_number">): string {
  return clean(ret.manifest_number) || vendorReturnManifestId(ret.id);
}

export function packetStatusLabel(status: string | null | undefined): string {
  const s = (status ?? "none") as VendorReturnStatus;
  return VENDOR_RETURN_STATUS_LABELS[s] ?? String(status);
}

export function reasonLabel(reason: string): string {
  return (VENDOR_RETURN_REASON_LABELS as Record<string, string>)[reason] ?? reason.replace(/_/g, " ");
}

export function transportLabel(t: string | null | undefined): string {
  const s = clean(t);
  if (!s) return PACKET_BLANK;
  return TRANSPORTATION_TYPE_LABELS[s as TransportationType] ?? s;
}

function vehicleCell(r: PacketReturn): string {
  const mmc = [clean(r.vehicle_make), clean(r.vehicle_model), clean(r.vehicle_color)].filter(Boolean).join(" / ");
  return mmc || PACKET_BLANK;
}

/** The form 8.2 sections for one return, in order. */
export function buildVendorReturnPacket(i: PacketInput): PacketSection[] {
  const r = i.ret;
  const status = r.manifest_status ?? "none";
  const step = STEP_ORDER[status] ?? 0;
  const cancelled = status === "cancelled";
  const unit = clean(i.lot?.unit);
  const qty = `${r.quantity}${unit ? ` ${unit}` : ""}`;
  const processor = clean(i.vendor?.display_name) || clean(i.vendor?.legal_name);
  const legal = clean(i.vendor?.legal_name);
  const contact = [clean(i.vendor?.phone), clean(i.vendor?.email)].filter(Boolean).join(" · ");
  const originLicense = clean(i.origin?.license_number);
  const sections: PacketSection[] = [];

  sections.push({
    key: "header",
    title: "Return",
    done: true,
    rows: [
      { label: "Return # (manifest identifier)", value: packetNumber(r), testid: "packet-number" },
      { label: "Status in the app", value: packetStatusLabel(status), testid: "packet-status" },
      {
        label: "Origin (Greenway)",
        value: [originLicense ? `License ${originLicense}` : `License ${PACKET_BLANK}`, clean(i.origin?.trade_name), [clean(i.origin?.location_address), clean(i.origin?.city)].filter(Boolean).join(", "), clean(i.origin?.contact_phone), clean(i.origin?.contact_email)]
          .filter(Boolean)
          .join(" · "),
      },
      { label: "Processor name", value: processor ? (legal && legal !== processor ? `${processor} (${legal})` : processor) : PACKET_BLANK, testid: "packet-processor" },
      { label: "Processor license #", value: orBlank(r.processor_license) },
      { label: "Processor contact", value: contact || PACKET_BLANK },
      { label: "Reason", value: `${reasonLabel(r.reason)}${clean(r.detail) ? ` · ${clean(r.detail)}` : ""}` },
      ...(r.reason === "recall"
        ? [
            {
              label: "Recall: LCB officer and contact date",
              value: `${orBlank(r.recall_officer)} · ${orBlank(r.recall_contact_date)}`,
            },
          ]
        : []),
      { label: "Owner approval (initials / date)", value: PACKET_BLANK },
    ],
  });

  sections.push({
    key: "step1",
    title: "STEP 1 · Processor's written acceptance",
    done: true,
    rows: [
      { label: "RMA #", value: orBlank(r.rma_number) },
      { label: "Date received (RMA email)", value: PACKET_BLANK },
    ],
  });

  sections.push({
    key: "step2",
    title: "STEP 2 · Units pulled to the vendor-return tote; logged in the app (units reserved, §4.11)",
    done: true,
    rows: [
      { label: "Product / lot", value: `${clean(i.lot?.product_name) || PACKET_BLANK} · ${clean(i.lot?.lot_code) || PACKET_BLANK}` },
      { label: "Quantity logged", value: qty, testid: "packet-qty" },
      {
        label: "Reserved now",
        value: isLegacyReducedReturn(r)
          ? "Logged before Phase 1.5: on-hand already came off at logging."
          : cancelled
            ? "Released (cancelled)"
            : step >= 4
              ? "Released at departure (on-hand reduced)"
              : `${Number(r.reserved_qty ?? 0)}${unit ? ` ${unit}` : ""} (out of sale, still on hand and in CCRS)`,
      },
      { label: "Logged", value: stampCell(r.requested_at ?? r.created_at, i.names.requested_by ?? i.names.created_by, true), testid: "packet-logged" },
      { label: "Qty counted / recount", value: `${PACKET_BLANK} / ${PACKET_BLANK}` },
      { label: "Pulled by / second count by", value: `${PACKET_BLANK} / ${PACKET_BLANK}` },
    ],
  });

  sections.push({
    key: "step3",
    title: `STEP 3 · Manifest.CSV uploaded to CCRS by Greenway (origin ${originLicense || PACKET_BLANK})`,
    done: step >= 2,
    rows: [
      { label: "Manifest # uploaded", value: step >= 2 ? orBlank(r.manifest_number) : PACKET_BLANK },
      { label: "Uploaded (recorded in the app)", value: stampCell(r.submitted_at, i.names.submitted_by, step >= 2), testid: "packet-submitted" },
      { label: "Departure (est.) / arrival (est.)", value: `${formatPacific(r.est_departure_at ?? null) || PACKET_BLANK} / ${formatPacific(r.est_arrival_at ?? null) || PACKET_BLANK}` },
      { label: "Transport", value: transportLabel(r.transportation_type) },
      ...(clean(r.transportation_type) === "Transporter Licensee" ? [{ label: "Transporter license #", value: orBlank(r.transporter_license) }] : []),
      { label: "Driver (21+)", value: orBlank(r.driver_name) },
      { label: "Plate / VIN", value: `${orBlank(r.vehicle_plate)} / ${orBlank(r.vehicle_vin)}` },
      { label: "Make / model / colour", value: vehicleCell(r) },
    ],
  });

  sections.push({
    key: "step4",
    title: "STEP 4 · LCB SUCCESS email with manifest PDF received",
    done: step >= 3,
    rows: [
      { label: "Date of the LCB success email", value: step >= 3 ? orBlank(r.lcb_email_date) : PACKET_BLANK, testid: "packet-lcb" },
      { label: "Recorded in the app", value: stampCell(r.confirmed_at, i.names.confirmed_by, step >= 3) },
      { label: "PDF printed [ ]  filed [ ]", value: "No success email = no release." },
    ],
  });

  sections.push({
    key: "step5",
    title: "STEP 5 · Departure (Record departure at the moment it leaves, §4.12)",
    done: step >= 4,
    rows: [
      { label: "Pickup time (Pacific)", value: step >= 4 ? formatPacific(r.pickup_at ?? null) || PACKET_NOT_RECORDED : PACKET_BLANK, testid: "packet-departed" },
      { label: "Departure recorded in the app", value: stampCell(r.departed_at, i.names.departed_by, step >= 4) },
      { label: "Driver matches manifest [ ]  Vehicle matches [ ]  ID checked (21+) [ ]  Sealed + locked [ ]", value: "" },
      { label: "Printed manifest PDF handed to driver [ ]", value: "" },
      { label: "Units counted out with driver", value: PACKET_BLANK },
    ],
  });

  if (cancelled) {
    sections.push({
      key: "cancel",
      title: "CANCELLED (owner only; units released)",
      done: true,
      rows: [
        { label: "Cancelled", value: stampCell(r.cancelled_at, i.names.cancelled_by, true), testid: "packet-cancelled" },
        { label: "Why", value: orBlank(r.cancel_reason) },
      ],
    });
  }

  sections.push({
    key: "step6",
    title: "STEP 6 · Credit memo from the processor",
    done: false,
    rows: [{ label: "Received (date / amount) → owner [ ]", value: PACKET_BLANK }],
  });

  return sections;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runVendorReturnPacketCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`vendor-return-packet-core FAIL: ${m}`);
    }
  };
  const id = "11111111-2222-4333-8444-555555555555";
  const base: PacketInput = {
    ret: { id, quantity: 4, reason: "defective", detail: "leaking carts", rma_number: "RMA-9", processor_license: "412345", manifest_status: "requested", reserved_qty: 4, created_at: "2026-10-01T17:00:00Z", requested_at: "2026-10-01T17:00:00Z" },
    lot: { lot_code: "L1", product_name: "Cart", unit: "each" },
    vendor: { display_name: "Proc Co", legal_name: "Proc Co LLC", phone: "360-555-0100", email: "p@x.com" },
    origin: { license_number: "413541", trade_name: "Greenway Marijuana", location_address: "1 Main St", city: "Port Orchard", contact_phone: "360-555-0199", contact_email: "g@x.com" },
    names: { requested_by: "Mia" },
  };
  const find = (s: PacketSection[], key: string) => s.find((x) => x.key === key)!;
  const row = (s: PacketSection[], key: string, label: string) => find(s, key).rows.find((r) => r.label === label)?.value;

  const a = buildVendorReturnPacket(base);
  ok(a.map((s) => s.key).join() === "header,step1,step2,step3,step4,step5,step6", "order without cancel");
  ok(row(a, "header", "Return # (manifest identifier)") === vendorReturnManifestId(id), "number from id");
  ok(row(a, "header", "Processor name") === "Proc Co (Proc Co LLC)", "processor with legal");
  ok(row(a, "header", "Processor contact") === "360-555-0100 · p@x.com", "contact");
  ok(row(a, "header", "Reason") === "Defective product · leaking carts", "reason label + detail");
  ok(!find(a, "header").rows.some((r) => r.label.startsWith("Recall")), "no recall row for defective");
  ok(row(a, "header", "Origin (Greenway)")!.startsWith("License 413541") && row(a, "header", "Origin (Greenway)")!.includes("1 Main St, Port Orchard"), "origin license + address");
  ok(row(a, "step1", "RMA #") === "RMA-9", "rma");
  ok(row(a, "step2", "Quantity logged") === "4 each", "qty");
  ok(row(a, "step2", "Reserved now")!.startsWith("4 each"), "reserved");
  ok(row(a, "step2", "Logged")!.endsWith("by Mia") && row(a, "step2", "Logged")!.includes("Pacific"), "logged stamp");
  ok(row(a, "step3", "Manifest # uploaded") === PACKET_BLANK, "manifest blank before step");
  ok(row(a, "step3", "Uploaded (recorded in the app)") === PACKET_BLANK, "upload stamp blank before step");
  ok(find(a, "step3").done === false && find(a, "step5").done === false, "not done yet");
  ok(row(a, "step3", "Transport") === PACKET_BLANK, "transport blank");
  ok(row(a, "step3", "Make / model / colour") === PACKET_BLANK, "vehicle blank");

  const b = buildVendorReturnPacket({
    ...base,
    ret: { ...base.ret, manifest_status: "picked_up", manifest_number: "M-77", submitted_at: "2026-10-02T17:00:00Z", lcb_email_date: "2026-10-03", confirmed_at: "2026-10-03T18:00:00Z", pickup_at: "2026-10-04T19:00:00Z", departed_at: "2026-10-04T19:01:00Z", transportation_type: "Transporter Licensee", transporter_license: "999", driver_name: "Dan", vehicle_make: "Ford", vehicle_model: "Transit", vehicle_color: "White" },
    names: { requested_by: "Mia", submitted_by: "Owner", departed_by: "Mgr" },
  });
  ok(row(b, "header", "Return # (manifest identifier)") === "M-77", "entered manifest number");
  ok(row(b, "step3", "Manifest # uploaded") === "M-77", "manifest shown when done");
  ok(row(b, "step3", "Uploaded (recorded in the app)")!.endsWith("by Owner"), "submitted stamp");
  ok(row(b, "step3", "Transporter license #") === "999", "transporter row only for licensee");
  ok(row(b, "step3", "Make / model / colour") === "Ford / Transit / White", "vehicle");
  ok(row(b, "step4", "Date of the LCB success email") === "2026-10-03", "lcb date");
  ok(row(b, "step4", "Recorded in the app")!.includes(PACKET_NOT_RECORDED), "confirmed by missing -> not recorded");
  ok(row(b, "step5", "Departure recorded in the app")!.endsWith("by Mgr"), "departed stamp");
  ok(row(b, "step5", "Pickup time (Pacific)")!.includes("Pacific"), "pickup pacific");
  ok(row(b, "step2", "Reserved now") === "Released at departure (on-hand reduced)", "released at departure");
  ok(find(b, "step5").done, "step5 done");

  const c = buildVendorReturnPacket({ ...base, ret: { ...base.ret, manifest_status: "cancelled", cancelled_at: "2026-10-02T17:00:00Z", cancel_reason: "withdrawn" }, names: { cancelled_by: "Owner" } });
  ok(c.some((s) => s.key === "cancel"), "cancel section");
  ok(row(c, "cancel", "Why") === "withdrawn", "cancel reason");
  ok(row(c, "step2", "Reserved now") === "Released (cancelled)", "released cancelled");
  ok(row(c, "step2", "Logged")!.includes(PACKET_NOT_RECORDED), "logged who missing -> not recorded");

  const d = buildVendorReturnPacket({ ...base, ret: { ...base.ret, reason: "recall", recall_officer: "Off. Lee", recall_contact_date: "2026-09-30" } });
  ok(row(d, "header", "Recall: LCB officer and contact date") === "Off. Lee · 2026-09-30", "recall row");
  const e = buildVendorReturnPacket({ ...base, ret: { ...base.ret, reserved_qty: null, adjustment_id: "x" } });
  ok(row(e, "step2", "Reserved now")!.startsWith("Logged before Phase 1.5"), "legacy");
  const f = buildVendorReturnPacket({ ...base, vendor: null, origin: null, lot: null });
  ok(row(f, "header", "Processor name") === PACKET_BLANK && row(f, "header", "Processor contact") === PACKET_BLANK, "no vendor -> blanks, never guessed");
  ok(row(f, "header", "Origin (Greenway)") === `License ${PACKET_BLANK}`, "no origin -> blank");
  ok(stampCell(null, null, false) === PACKET_BLANK && stampCell(null, null, true) === PACKET_NOT_RECORDED, "stampCell blank vs not recorded");
  ok(reasonLabel("weird_thing") === "weird thing" && transportLabel("Pick-up").startsWith("Pick-up (the processor"), "labels");
  return { passed, failed };
}
