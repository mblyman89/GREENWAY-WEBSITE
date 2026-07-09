/**
 * tests/compliance/vendor-usual-transport.test.ts
 *
 * Slice H15e — "remember transport per vendor."
 *
 * The stakes: WA WAC 314-55-085 chain-of-custody records must reflect what
 * ACTUALLY happened. These tests pin two safety properties:
 *   1. Only vendor-STABLE identity fields (carrier/driver/vehicle) are ever
 *      remembered or suggested — per-shipment facts (departed_at, arrived_at,
 *      eta_date, route_notes) are structurally excluded so a previous
 *      delivery's timestamps can never be fabricated onto a new manifest.
 *   2. The manifest's own record always beats the vendor memory — a
 *      suggestion can only fill a BLANK field, never overwrite the truth.
 */

import { describe, it, expect } from "vitest";
import {
  USUAL_TRANSPORT_KEYS,
  usualTransportHasData,
  usualTransportFromManifest,
  parseUsualTransport,
  mergeUsualTransport,
  suggestTransportDefaults,
  describeSuggestion,
  type UsualTransport,
} from "@/lib/inventory/vendor-transport-core";

const full: UsualTransport = {
  transporter_name: "TERPENE TRANSIT",
  transporter_license: "412345",
  driver_name: "Colin Venske",
  driver_license_number: "WDL*123",
  vehicle_description: "White Ford Transit van",
  vehicle_plate: "ABC1234",
  vehicle_vin: "1FTBW2CM5HKA12345",
};

describe("H15e — what is rememberable (structural exclusion of per-shipment facts)", () => {
  it("USUAL_TRANSPORT_KEYS holds exactly the 7 identity fields — no timestamps, no route", () => {
    expect([...USUAL_TRANSPORT_KEYS].sort()).toEqual(
      [
        "transporter_name",
        "transporter_license",
        "driver_name",
        "driver_license_number",
        "vehicle_description",
        "vehicle_plate",
        "vehicle_vin",
      ].sort(),
    );
    for (const banned of ["departed_at", "arrived_at", "eta_date", "route_notes"]) {
      expect(USUAL_TRANSPORT_KEYS as readonly string[]).not.toContain(banned);
    }
  });

  it("usualTransportFromManifest picks identity fields and trims blanks to null", () => {
    const got = usualTransportFromManifest({
      transporter_name: "  TERPENE TRANSIT  ",
      transporter_license: "",
      driver_name: "Colin Venske",
      driver_license_number: null,
      vehicle_description: "   ",
      vehicle_plate: "ABC1234",
      vehicle_vin: undefined,
    });
    expect(got).toEqual({
      transporter_name: "TERPENE TRANSIT",
      transporter_license: null,
      driver_name: "Colin Venske",
      driver_license_number: null,
      vehicle_description: null,
      vehicle_plate: "ABC1234",
      vehicle_vin: null,
    });
  });

  it("returns null when the manifest recorded nothing rememberable (nothing to save)", () => {
    expect(usualTransportFromManifest({})).toBeNull();
    expect(
      usualTransportFromManifest({ transporter_name: "  ", driver_name: "" }),
    ).toBeNull();
  });
});

describe("H15e — parseUsualTransport (tolerant jsonb reader)", () => {
  it("round-trips an object and a stored JSON string", () => {
    expect(parseUsualTransport(full)).toEqual(full);
    expect(parseUsualTransport(JSON.stringify(full))).toEqual(full);
  });

  it("drops unknown keys and per-shipment fields smuggled into the blob", () => {
    const got = parseUsualTransport({
      ...full,
      departed_at: "2025-03-13T14:00:00Z", // must NOT survive
      eta_date: "2025-03-13",
      bogus: 42,
    });
    expect(got).toEqual(full);
    expect(got && ("departed_at" in got || "eta_date" in got)).toBe(false);
  });

  it("returns null for garbage: bad JSON, arrays, scalars, empty objects", () => {
    expect(parseUsualTransport("not json {")).toBeNull();
    expect(parseUsualTransport([full])).toBeNull();
    expect(parseUsualTransport(7)).toBeNull();
    expect(parseUsualTransport(null)).toBeNull();
    expect(parseUsualTransport({})).toBeNull();
    expect(parseUsualTransport({ transporter_name: "   " })).toBeNull();
  });
});

describe("H15e — mergeUsualTransport (smarter, never dumber)", () => {
  it("a field the new manifest recorded wins; a blank keeps the known value", () => {
    const existing: UsualTransport = { ...full };
    const incoming = usualTransportFromManifest({
      transporter_name: "NEW CARRIER LLC", // changed carrier
      driver_name: null, // this delivery didn't record the driver
      vehicle_plate: "XYZ9876",
    })!;
    const merged = mergeUsualTransport(existing, incoming);
    expect(merged.transporter_name).toBe("NEW CARRIER LLC"); // latest truth wins
    expect(merged.driver_name).toBe("Colin Venske"); // memory retained
    expect(merged.vehicle_plate).toBe("XYZ9876");
    expect(merged.vehicle_vin).toBe(full.vehicle_vin); // retained
  });

  it("works with no prior memory", () => {
    const incoming = usualTransportFromManifest({ driver_name: "Colin Venske" })!;
    expect(mergeUsualTransport(null, incoming).driver_name).toBe("Colin Venske");
    expect(usualTransportHasData(mergeUsualTransport(null, incoming))).toBe(true);
  });
});

describe("H15e — suggestTransportDefaults (manifest record beats suggestion)", () => {
  it("fills only the fields the manifest left blank and flags them as suggested", () => {
    const { defaults, suggestedFields, usedUsual } = suggestTransportDefaults(
      {
        transporter_name: "QGT LOGISTICS", // manifest's own record — must win
        driver_name: null,
        vehicle_plate: "  ", // blank-ish — eligible for suggestion
      },
      full,
    );
    expect(defaults.transporter_name).toBe("QGT LOGISTICS");
    expect(suggestedFields).not.toContain("transporter_name");
    expect(defaults.driver_name).toBe("Colin Venske");
    expect(suggestedFields).toContain("driver_name");
    expect(defaults.vehicle_plate).toBe("ABC1234");
    expect(suggestedFields).toContain("vehicle_plate");
    expect(usedUsual).toBe(true);
  });

  it("no vendor memory → no suggestions, manifest values pass through", () => {
    const { defaults, suggestedFields, usedUsual } = suggestTransportDefaults(
      { transporter_name: "QGT LOGISTICS" },
      null,
    );
    expect(defaults.transporter_name).toBe("QGT LOGISTICS");
    expect(suggestedFields).toEqual([]);
    expect(usedUsual).toBe(false);
  });

  it("manifest fully recorded → memory never overrides anything", () => {
    const manifest = { ...full, transporter_name: "DIFFERENT CO" };
    const { defaults, usedUsual } = suggestTransportDefaults(manifest, full);
    expect(defaults.transporter_name).toBe("DIFFERENT CO");
    expect(usedUsual).toBe(false);
  });
});

describe("H15e — describeSuggestion (the concierge line)", () => {
  it("names carrier / driver / vehicle groups that were suggested", () => {
    expect(describeSuggestion("QGT", ["transporter_name"])).toBe(
      "Using QGT's usual carrier — confirm or change before saving.",
    );
    expect(describeSuggestion("QGT", ["driver_name", "vehicle_plate"])).toBe(
      "Using QGT's usual driver + usual vehicle — confirm or change before saving.",
    );
    expect(
      describeSuggestion("QGT", ["transporter_license", "driver_license_number", "vehicle_vin"]),
    ).toBe("Using QGT's usual carrier + usual driver + usual vehicle — confirm or change before saving.");
  });
});
