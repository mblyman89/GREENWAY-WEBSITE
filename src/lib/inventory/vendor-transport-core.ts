/**
 * src/lib/inventory/vendor-transport-core.ts
 *
 * Slice H15e — "remember transport per vendor."
 *
 * Once a manifest is ACCEPTED with transport recorded, the vendor-stable part
 * of that record (carrier / driver / vehicle) is written back to the vendor's
 * profile as their "usual transport" (vendors.usual_transport jsonb, migration
 * 0100). On the NEXT delivery from that vendor, the intake review screen
 * pre-suggests those values — clearly labelled as suggestions to confirm.
 *
 * Deliberately NOT remembered: departed_at / arrived_at / eta_date /
 * route_notes — those are per-shipment facts, not "usual" anything, and
 * pre-filling a timestamp from a previous delivery would fabricate a
 * chain-of-custody record. Only identity fields are remembered.
 *
 * Pure module: no I/O, no supabase — unit-testable under vitest. The store
 * (intake-store.rememberVendorUsualTransport) and the review page consume it.
 */

/** The vendor-stable transport identity we remember. All nullable. */
export type UsualTransport = {
  transporter_name: string | null;
  transporter_license: string | null;
  driver_name: string | null;
  driver_license_number: string | null;
  vehicle_description: string | null;
  vehicle_plate: string | null;
  vehicle_vin: string | null;
};

export const USUAL_TRANSPORT_KEYS = [
  "transporter_name",
  "transporter_license",
  "driver_name",
  "driver_license_number",
  "vehicle_description",
  "vehicle_plate",
  "vehicle_vin",
] as const satisfies readonly (keyof UsualTransport)[];

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** True when at least one identity field is present. */
export function usualTransportHasData(t: UsualTransport | null): t is UsualTransport {
  if (!t) return false;
  return USUAL_TRANSPORT_KEYS.some((k) => t[k] != null);
}

/**
 * Extract the rememberable identity fields from a manifest row (or anything
 * shaped like one). Per-shipment fields on the source are ignored by design.
 * Returns null when nothing rememberable was recorded.
 */
export function usualTransportFromManifest(
  m: Partial<Record<(typeof USUAL_TRANSPORT_KEYS)[number], string | null>>,
): UsualTransport | null {
  const out: UsualTransport = {
    transporter_name: clean(m.transporter_name),
    transporter_license: clean(m.transporter_license),
    driver_name: clean(m.driver_name),
    driver_license_number: clean(m.driver_license_number),
    vehicle_description: clean(m.vehicle_description),
    vehicle_plate: clean(m.vehicle_plate),
    vehicle_vin: clean(m.vehicle_vin),
  };
  return usualTransportHasData(out) ? out : null;
}

/**
 * Tolerant parser for the stored vendors.usual_transport jsonb (which may be
 * an object, a stored JSON string, or garbage from a hand edit). Unknown keys
 * are dropped; missing/blank keys become null. Returns null when nothing
 * usable is present.
 */
export function parseUsualTransport(raw: unknown): UsualTransport | null {
  let obj: unknown = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const out: UsualTransport = {
    transporter_name: clean(rec.transporter_name),
    transporter_license: clean(rec.transporter_license),
    driver_name: clean(rec.driver_name),
    driver_license_number: clean(rec.driver_license_number),
    vehicle_description: clean(rec.vehicle_description),
    vehicle_plate: clean(rec.vehicle_plate),
    vehicle_vin: clean(rec.vehicle_vin),
  };
  return usualTransportHasData(out) ? out : null;
}

/**
 * Merge a freshly-accepted manifest's transport into the vendor's existing
 * memory. A field the new manifest RECORDED wins (it is the latest truth);
 * a field the new manifest left blank keeps the previously-known value —
 * "the more you receive, the smarter it gets," never dumber.
 */
export function mergeUsualTransport(
  existing: UsualTransport | null,
  incoming: UsualTransport,
): UsualTransport {
  const out = { ...incoming };
  if (existing) {
    for (const k of USUAL_TRANSPORT_KEYS) {
      if (out[k] == null && existing[k] != null) out[k] = existing[k];
    }
  }
  return out;
}

export type TransportSuggestion = {
  /** Per-field default values for the transport form. */
  defaults: UsualTransport;
  /** Which fields were filled FROM the vendor memory (vs the manifest itself). */
  suggestedFields: (keyof UsualTransport)[];
  /** True when at least one field is a vendor-memory suggestion. */
  usedUsual: boolean;
};

/**
 * Compute the transport form's default values for a manifest under review.
 *
 * Precedence per field: the manifest's own saved/auto-filled value ALWAYS
 * wins (H15a seeding + manual overrides are the record); the vendor's usual
 * transport only fills fields the manifest left blank. The returned
 * suggestedFields powers the "Using {vendor}'s usual carrier — confirm or
 * change" concierge hint so a staffer can tell record from suggestion.
 */
export function suggestTransportDefaults(
  manifest: Partial<Record<(typeof USUAL_TRANSPORT_KEYS)[number], string | null>>,
  usual: UsualTransport | null,
): TransportSuggestion {
  const defaults: UsualTransport = {
    transporter_name: clean(manifest.transporter_name),
    transporter_license: clean(manifest.transporter_license),
    driver_name: clean(manifest.driver_name),
    driver_license_number: clean(manifest.driver_license_number),
    vehicle_description: clean(manifest.vehicle_description),
    vehicle_plate: clean(manifest.vehicle_plate),
    vehicle_vin: clean(manifest.vehicle_vin),
  };
  const suggestedFields: (keyof UsualTransport)[] = [];
  if (usual) {
    for (const k of USUAL_TRANSPORT_KEYS) {
      if (defaults[k] == null && usual[k] != null) {
        defaults[k] = usual[k];
        suggestedFields.push(k);
      }
    }
  }
  return { defaults, suggestedFields, usedUsual: suggestedFields.length > 0 };
}

/** Human-readable summary of what got suggested, for the concierge hint. */
export function describeSuggestion(
  vendorName: string,
  suggestedFields: (keyof UsualTransport)[],
): string {
  const parts: string[] = [];
  if (suggestedFields.some((f) => f === "transporter_name" || f === "transporter_license")) {
    parts.push("usual carrier");
  }
  if (suggestedFields.some((f) => f === "driver_name" || f === "driver_license_number")) {
    parts.push("usual driver");
  }
  if (
    suggestedFields.some(
      (f) => f === "vehicle_description" || f === "vehicle_plate" || f === "vehicle_vin",
    )
  ) {
    parts.push("usual vehicle");
  }
  const what = parts.length > 0 ? parts.join(" + ") : "usual transport";
  return `Using ${vendorName}'s ${what} — confirm or change before saving.`;
}
