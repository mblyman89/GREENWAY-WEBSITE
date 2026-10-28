/**
 * Fix Phase 1.7b (G-42 req 7; owner message 4: "please also build the
 * printable vendor-return packet (G-42).").
 *
 * The printable vendor-return packet is SOP-15 form 8.2 filled in from the
 * app: processor, license, contact, reason, RMA, lot and quantity, every
 * step's who and when (Pacific), the manifest, transport, LCB email,
 * departure or cancel. What the app does not hold prints as a blank line;
 * nothing is guessed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PACKET_BLANK,
  PACKET_NOT_RECORDED,
  buildVendorReturnPacket,
  packetNumber,
  stampCell,
  __runVendorReturnPacketCoreTests,
  type PacketInput,
} from "@/lib/inventory/vendor-return-packet-core";
import { vendorReturnManifestId } from "@/lib/inventory/vendor-return-core";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const PAGE = read("src/app/admin/inventory/disposition/vendor-return-packet/page.tsx");
const DISP = read("src/app/admin/inventory/disposition/page.tsx");
const STORE = read("src/lib/inventory/disposition.ts");
const SOP = read("docs/sop/SOP-15-returns-vendor-destruction.md");
const ID = "0b5a3c1e-1111-4222-8333-444455556666";

const base: PacketInput = {
  ret: { id: ID, quantity: 6, reason: "overstock", rma_number: "RMA-1", processor_license: "412000", manifest_status: "requested", reserved_qty: 6, created_at: "2026-10-01T17:00:00Z" },
  lot: { lot_code: "LOT-9", product_name: "Gummies", unit: "each" },
  vendor: { display_name: "Proc", legal_name: null, phone: null, email: null },
  origin: { license_number: "413541" },
  names: { created_by: "Mia" },
};
const val = (s: ReturnType<typeof buildVendorReturnPacket>, key: string, label: string) =>
  s.find((x) => x.key === key)?.rows.find((r) => r.label === label)?.value;

describe("Phase 1.7b G-42 req 7 packet core", () => {
  it("self-test passes", () => {
    const r = __runVendorReturnPacketCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(37);
  });
  it("follows form 8.2 step by step", () => {
    const s = buildVendorReturnPacket(base);
    expect(s.map((x) => x.key)).toEqual(["header", "step1", "step2", "step3", "step4", "step5", "step6"]);
    expect(s.find((x) => x.key === "step3")!.title).toContain("origin 413541");
  });
  it("never guesses: missing vendor contact, transport and later steps print as blanks", () => {
    const s = buildVendorReturnPacket(base);
    expect(val(s, "header", "Processor contact")).toBe(PACKET_BLANK);
    expect(val(s, "step3", "Driver (21+)")).toBe(PACKET_BLANK);
    expect(val(s, "step4", "Date of the LCB success email")).toBe(PACKET_BLANK);
    expect(val(s, "step5", "Pickup time (Pacific)")).toBe(PACKET_BLANK);
  });
  it("a step done without its stamp says 'not recorded', not a blank", () => {
    expect(stampCell(null, null, true)).toBe(PACKET_NOT_RECORDED);
    const s = buildVendorReturnPacket({ ...base, ret: { ...base.ret, manifest_status: "picked_up", pickup_at: null } });
    expect(val(s, "step5", "Pickup time (Pacific)")).toBe(PACKET_NOT_RECORDED);
  });
  it("logged falls back to created_at / created_by for returns before 0309", () => {
    const s = buildVendorReturnPacket(base);
    expect(val(s, "step2", "Logged")).toMatch(/Pacific by Mia$/);
  });
  it("the number is the manifest identifier (entered, else the one the app assigned)", () => {
    expect(packetNumber({ id: ID, manifest_number: null })).toBe(vendorReturnManifestId(ID));
    expect(packetNumber({ id: ID, manifest_number: " M-5 " })).toBe("M-5");
  });
  it("a cancelled return shows who cancelled and why", () => {
    const s = buildVendorReturnPacket({ ...base, ret: { ...base.ret, manifest_status: "cancelled", cancelled_at: "2026-10-02T17:00:00Z", cancel_reason: "processor withdrew" }, names: { cancelled_by: "Owner" } });
    expect(val(s, "cancel", "Cancelled")).toMatch(/by Owner$/);
    expect(val(s, "cancel", "Why")).toBe("processor withdrew");
  });
});

describe("Phase 1.7b wiring", () => {
  it("the page requires inventory.manage, validates the id and prints", () => {
    expect(PAGE).toContain('requirePermission("inventory.manage")');
    expect(PAGE).toContain("isUuid(sp.id)");
    expect(PAGE).toContain("getVendorReturnPacket(id)");
    expect(PAGE).toContain("buildVendorReturnPacket(");
    expect(PAGE).toContain("<PrintButton />");
    expect(PAGE).toContain('data-testid="vendor-return-packet-missing"');
    expect(PAGE).toContain("Driver signature");
  });
  it("every vendor-return row links to the packet (not only open ones)", () => {
    const i = DISP.indexOf('data-testid="vendor-return-packet-link"');
    expect(i).toBeGreaterThan(0);
    expect(DISP).toContain("/admin/inventory/disposition/vendor-return-packet?id=${encodeURIComponent(r.id)}");
    const before = DISP.slice(DISP.lastIndexOf('data-testid="vendor-return-row"', i), i);
    expect(before).not.toMatch(/\{open \&\& [^}]*vendor-return-packet/);
  });
  it("the loader reads names from staff_profiles and the origin from license_settings", () => {
    const fn = STORE.slice(STORE.indexOf("export async function getVendorReturnPacket"), STORE.indexOf("export async function getVendorReturn("));
    expect(fn).toContain('from("staff_profiles").select("id, full_name, email")');
    expect(fn).toContain('from("license_settings").select("license_number, trade_name, location_address, city, contact_phone, contact_email").eq("id", true)');
    expect(fn).toContain('from("vendors").select("display_name, legal_name, phone, email")');
  });
  it("SOP-15 documents the packet", () => {
    expect(SOP).toContain("Print packet (form 8.2)");
  });
});
