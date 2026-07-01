# Medical authorization intake — how it works (Slice 85)

This documents the streamlined workflow at **Admin → Operations → Authorization
Intake** (`/admin/medical/intake`) that a Certified Medical Cannabis Consultant
uses to take in a new medical authorization efficiently, using the equipment the
owner purchased:

- **Canon PIXMA TS3522** flatbed scanner (600×1200 dpi optical, AirPrint/Mopria,
  Wi-Fi 2.4 GHz + USB) — used to **scan** the paper authorization form.
- **Scotch Thermal Laminator** — used to **laminate** the printed recognition card
  so it survives repeated handling at the register.

It is a companion to `docs/medical-doh-requirements.md`, which holds the full
regulatory research and source citations. Read that first for the "why."

---

## Grounding in fact — no retailer API to the DOH database

The Washington DOH database for medical cannabis is the **Medical Cannabis
Registry (MCR)**, which replaced the old "Airlift" system on **June 30, 2025**.
There is **no public retailer API** to push authorizations into the MCR: the
consultant enters/validates the patient in the MCR through the SAW/MCR login by
hand. This back office therefore **records what the consultant validated** — it
does not call the DOH database directly. Every UI element on the intake page is
built around that reality (best-judgment, "do it the right way even if harder").

Likewise, the Canon scanner has **no retailer scan API**: you scan to a file with
the Canon PRINT app or the OS scan utility, then **upload that file** on the
intake page. The scan is stored privately (staff-only) as part of the retained
record.

---

## The four-step flow

1. **Scan the paper authorization.** Place the signed authorization face-down on
   the Canon PIXMA TS3522 flatbed and scan to **PDF** (or JPG/PNG/TIFF). Save it
   somewhere you can reach from this browser.

2. **Pick the patient and attach the scan.** Search for the patient by name,
   email, or phone. If they aren't in the system yet, add them from the Customers
   page first, then return here. Attach the scan file in the form.

3. **Walk the DOH 608-048 checklist — all four must pass to issue:**
   - Form complete & signed by a health care practitioner.
   - Printed on **tamper-resistant paper** with a security feature.
   - Identity verified (full legal name, physical address).
   - **Embossed RCW 69.51A.030 seal** visible.

   Enter the **unique patient identifier (UPID)**, holder type
   (Patient / Designated Provider), and effective/expiration dates. Confirm the
   patient is entered/active in the MCR (a consultant does this in the MCR — there
   is no API). The card **cannot be issued** unless all four checks are ticked;
   this is enforced server-side in `createAuthorization` via `canIssueCard`.

4. **Issue, print, and laminate.** Issuing creates the recognition card record and
   (if a scan was attached) stores the scan. Click **Print card** to open the
   3.5×2.25 in printable card (`/admin/medical/card/[id]`), print it, then run it
   through the **Scotch Thermal Laminator**. Use **mark printed** to stamp that the
   physical card was produced.

---

## Records retention

Excise-exempt medical records — including the scanned authorization form — are
retained **five years** per **WAC 314-55-090(2)**. The scan lives in the private
`medical-forms` Supabase Storage bucket, readable/writable only by staff (RLS on
`storage.objects` via `public.is_staff()`), and each `patient_authorizations` row
records the scan path, original filename, byte size, and who/when uploaded it.

---

## What the code does (for maintainers)

- **Migration** `0060_medical_form_scans.sql` — private `medical-forms` bucket +
  staff RLS; adds `form_scan_path/_filename/_bytes/_uploaded_at/_uploaded_by` and
  `card_printed_at` to `patient_authorizations`. Idempotent.
- **Store** `src/lib/medical/store.ts` — `listRecentAuthorizations()` (queue),
  `attachFormScan()` (upload + row update), `signedFormScanUrl()` (short-lived
  staff view link), `markCardPrinted()`.
- **Actions** `src/app/admin/medical/actions.ts` — `intakeAuthorizationAction`
  (issue + optional scan in one step, redirects with a status flag),
  `attachScanAction`, `markCardPrintedAction`.
- **Page** `src/app/admin/medical/intake/page.tsx` with client components
  `AuthorizationIntakeForm` and `CustomerPicker` under
  `src/components/admin/medical/`.

Everything the AI produces here is a **draft for a human consultant to validate**;
the consultant is the source of truth for the MCR entry and the 608-048 checks.
