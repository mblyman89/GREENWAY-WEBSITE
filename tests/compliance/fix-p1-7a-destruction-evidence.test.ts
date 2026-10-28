/**
 * Fix Phase 1.7a (G-43 req 7; owner message 4: "please build the photo
 * upload (G-43), as well as a video upload just in case.").
 *
 * Optional photo and video evidence of a destruction, kept privately with
 * the five-year destruction record (WAC 314-55-097):
 *   - a PRIVATE bucket (never the public media bucket), append-only rows;
 *   - the file's stored size, type and first bytes are checked before a row
 *     is written; a refused file is removed and the refusal audited;
 *   - a per-event printable record with the evidence (G-43 req 6 per event).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_MAX_BYTES,
  buildEvidenceKey,
  evaluateEvidenceStart,
  evaluateStoredEvidence,
  isEvidenceKeyFor,
  __runDestructionEvidenceCoreTests,
} from "@/lib/inventory/destruction-evidence-core";
import { TABLE_RULES } from "@/lib/accounting/factory-reset-core";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const MIG = read("supabase/migrations/0312_destruction_evidence.sql");
const ACT = read("src/app/admin/inventory/disposition/evidence-actions.ts");
const STORE = read("src/lib/inventory/destruction-evidence-store.ts");
const PAGE = read("src/app/admin/inventory/disposition/page.tsx");
const LOG = read("src/app/admin/inventory/disposition/destruction-log/page.tsx");
const REC = read("src/app/admin/inventory/disposition/destruction-record/page.tsx");
const UP = read("src/components/admin/inventory/DestructionEvidenceUploader.tsx");
const CLIENT = read("src/lib/media/direct-upload-client.ts");
const EV = "0b5a3c1e-1111-4222-8333-444455556666";

describe("Phase 1.7a G-43 req 7 core", () => {
  it("self-test passes", () => {
    const r = __runDestructionEvidenceCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(36);
  });
  it("accepts photos and videos, including the phone's own formats", () => {
    for (const [name, mime] of [
      ["a.jpg", "image/jpeg"],
      ["a.png", "image/png"],
      ["a.webp", "image/webp"],
      ["IMG.HEIC", ""],
      ["v.mp4", "video/mp4"],
      ["v.webm", "video/webm"],
      ["IMG.MOV", ""],
    ]) {
      expect(evaluateEvidenceStart({ filename: name, mime, size: 1000, note: "", eventStatus: "completed" }).ok).toBe(true);
    }
    expect(evaluateEvidenceStart({ filename: "x.exe", mime: "application/x-msdownload", size: 10, note: "", eventStatus: "completed" }).ok).toBe(false);
  });
  it("keeps the Media Library's per-kind limits (50 MB photo, 200 MB video)", () => {
    expect(EVIDENCE_MAX_BYTES.photo).toBe(50 * 1024 * 1024);
    expect(EVIDENCE_MAX_BYTES.video).toBe(200 * 1024 * 1024);
    expect(MIG).toContain("file_size_limit = 209715200");
  });
  it("refuses a cancelled event (nothing was destroyed)", () => {
    const r = evaluateEvidenceStart({ filename: "a.jpg", mime: "image/jpeg", size: 10, note: "", eventStatus: "cancelled" });
    expect(r.ok).toBe(false);
  });
  it("keys are fresh, under the event, and checked on finish", () => {
    const k = buildEvidenceKey({ eventId: EV, nonce: "00112233aabbccdd", filename: "x.jpg", mime: "image/jpeg" })!;
    expect(k.startsWith(`events/${EV}/`)).toBe(true);
    expect(isEvidenceKeyFor(k, EV)).toBe(true);
    expect(isEvidenceKeyFor(k, "0b5a3c1e-1111-4222-8333-000000000000")).toBe(false);
  });
  it("proves the type from the bytes", () => {
    const k = buildEvidenceKey({ eventId: EV, nonce: "00112233aabbccdd", filename: "x.jpg", mime: "image/jpeg" })!;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const r = evaluateStoredEvidence({ key: k, declaredSize: 8, storedSize: 8, storedMime: "image/jpeg", head: png, filename: "x.jpg" });
    expect(r.ok).toBe(false);
  });
});

describe("Phase 1.7a migration 0312", () => {
  it("creates a PRIVATE bucket", () => {
    expect(EVIDENCE_BUCKET).toBe("destruction-evidence");
    expect(MIG).toMatch(/values \('destruction-evidence', 'destruction-evidence', false\)/);
    expect(MIG).not.toMatch(/on storage\.objects/);
  });
  it("is append-only with no FK to the WIPE destruction_events", () => {
    expect(MIG).toMatch(/before update or delete on public\.destruction_evidence/);
    expect(MIG).toMatch(/destruction_event_id uuid not null,/);
    expect(MIG).not.toMatch(/references public\.destruction_events/);
    expect(MIG).toMatch(/enable row level security/);
  });
  it("is KEEP in the factory reset", () => {
    expect(TABLE_RULES.find((r) => r.table === "destruction_evidence")?.disposition).toBe("KEEP");
  });
});

describe("Phase 1.7a server and screens", () => {
  it("signs uploads for the private bucket and verifies before recording", () => {
    expect(ACT).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(ACT).toMatch(/storage\.from\(EVIDENCE_BUCKET\)\.createSignedUploadUrl\(key\)/);
    expect(ACT).toMatch(/bucket\.info\(key\)/);
    expect(ACT).toMatch(/readObjectHead\(EVIDENCE_BUCKET, key, SIGNATURE_READ_BYTES\)/);
    const verify = ACT.indexOf("evaluateStoredEvidence({");
    const insert = ACT.indexOf("insertEvidence({");
    expect(verify).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(verify);
    expect(ACT).toContain("EVIDENCE_UPLOAD_AUDIT_ACTION");
    expect(ACT).toContain("EVIDENCE_REFUSED_AUDIT_ACTION");
    expect(ACT).toMatch(/removeQuietly\(key\)/);
    expect(ACT).not.toMatch(/"media"/);
  });
  it("shows files only through short-lived signed links", () => {
    expect(STORE).toMatch(/createSignedUrl\(key, EVIDENCE_VIEW_SECONDS/);
    expect(STORE).not.toMatch(/getPublicUrl/);
    expect(STORE).toMatch(/chunkedIn\(/);
  });
  it("the shared upload client keeps the media bucket by default", () => {
    expect(CLIENT).toMatch(/bucket: string = BUCKET/);
    expect(CLIENT).toMatch(/bucketName: opts\.bucket \?\? BUCKET/);
    expect(UP).toMatch(/bucket: start\.bucket/);
  });
  it("the event list, the monthly log and the one-event record show the evidence", () => {
    expect(PAGE).toContain("DestructionEvidenceUploader");
    expect(PAGE).toContain('data-testid="destruction-record-link"');
    expect(LOG).toContain("Photo / video");
    expect(REC).toContain('data-testid="destruction-record-evidence"');
    expect(REC).toMatch(/requirePermission\("inventory\.manage"\)/);
  });
});
