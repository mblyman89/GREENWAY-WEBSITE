# 14 — Examiner Email Draft (G3 questions)

**Status:** ready to send. Drafted 2026-09-16, after U-01 closed.
**To:** `examiner@lcb.wa.gov` `[FAQ L0030]`
**Owner action:** send as-is, or trim. Log every answer verbatim in Part 12 against its U-xx.

---

## A. Why this email exists at all

Part 06 §G3 is the short list of things **PREproduction structurally cannot answer**,
because *"These environments are autonomous and do not share administration or
reporting data."* `[FAQ L0096]` — none of Greenway's real, Cultivera-filed history
exists there. Everything answerable by uploading a file was removed from this email
on purpose (Part 06 §G1).

**The single most important discovery while drafting:** U-08 does not have to be asked
as an opinion at all. `[FAQ L0136]` says *"A license can request their data from the
examiner unit for CCRS."* So Q1 below asks for **our own filed data** — a record we are
entitled to — instead of asking the examiner to guess what Cultivera did. A record
settles U-08, U-14 (Areas/Strains as filed, Part 07 R-4/R-5) and the Product-name
question in one reply. This is strictly better than an opinion.

Note also `[FAQ L0142]`: *"Licensees would request CCRS records through a Public Records
request if seeking licensee specific information. There is no direct access to the data
that has already been reported."* The two lines differ, so the email asks the examiner
unit first and explicitly offers to file a Public Records request instead. That way a
"no" still returns the route, not a dead end.

## B. Drafting rules applied

1. One question per numbered paragraph, each answerable in a sentence or by a yes/no.
2. State what we already read and pin it, so the examiner does not re-explain the guide.
   This is the difference between a question that gets answered and one that gets
   "please review the Upload User Guide."
3. Lead with the highest-consequence item (U-08).
4. Never ask anything a probe file answers (Part 06 §G1).
5. No attachment on this one — `[FAQ L0030]` requires the CSV + forwarded error email
   only when asking about a **specific error**. This email is not about an error.

---

## C. The email

**Subject:** `CCRS reporting cutover — Greenway Marijuana, license 413541 — four questions before we begin self-reporting`

> Hello,
>
> I own Greenway Marijuana, an I-502 retailer in Port Orchard, license **413541**.
>
> We currently report to CCRS through our integrator, Cultivera. We are preparing to
> take reporting in-house and upload our own .CSV files. I have a PREproduction
> account and I am working through our file formats there now, so I have kept this to
> the four questions that PREproduction cannot answer for us.
>
> **1. Our previously reported data, so our identifiers line up.**
> Cultivera has been filing our inventory using our product barcode as the
> `InventoryExternalIdentifier`. Before our first upload I want to be certain we
> continue against the same identifiers rather than creating duplicates.
>
> The FAQ says a license can request their data from the examiner unit for CCRS. May
> we request Greenway's reported CCRS data for license 413541 — specifically the
> `InventoryExternalIdentifier`, `Strain`, `Area` and `Product` names currently on
> file? If that request belongs with Public Records instead, please tell me and I will
> file it there.
>
> **2. If that data is not available to us, which approach do you want?**
> When we begin uploading ourselves, should we:
> **(a)** continue to `Update` the existing identifiers Cultivera filed, or
> **(b)** `Insert` new identifiers of our own and report InventoryTransfer rows from
> the old identifiers to the new ones?
>
> I have read the FAQ guidance to keep existing ID structures where possible; my
> question is whether that still holds when the party doing the filing changes from
> the integrator to the licensee. I want to avoid duplicating or orphaning our live
> inventory on day one.
>
> **3. Retention.**
> How long are we required to keep the .CSV files we upload and the error emails CCRS
> returns? I could not find a retention period in the Upload User Guide or the FAQ,
> and I would rather set our retention to your number than pick one ourselves.
>
> **4. Un-assigning our integrator.**
> When we stop using Cultivera, is there anything required beyond un-assigning them
> from our license in CCRS — and would you like to be notified of the date we switch
> over?
>
> One smaller item if it is easy to answer: when a licensee uploads their own files,
> which email address receives the error notifications — the account used to log in,
> or a separate address on the CCRS profile? I ask because today those errors go to
> our integrator and we never see them, and I want them landing in our inbox before we
> cut over, not after.
>
> Thank you very much for your time. I am happy to be told "upload it to
> PREproduction and see" on anything I should be testing myself.
>
> Michael Lyman
> Owner, Greenway Marijuana — license 413541
> Port Orchard, WA

---

## D. Question → register map

| ¶ | U-xx | Why PREprod cannot answer it |
|---|---|---|
| 1 | U-08, U-14, Part 07 R-4/R-5 | Our Cultivera-filed data does not exist in PREprod `[FAQ L0096]`; requesting the record is sanctioned `[FAQ L0136]` |
| 2 | U-08 | Integrator→licensee continuity is not addressed by `[FAQ L0149]` |
| 3 | U-13 | **Verified negative:** no retention text in guide.txt, faq.txt, api.txt or admin-guide.txt |
| 4 | de-provisioning | `[FAQ L0090]` covers assigning, not the exit |
| PS | U-15 | `[FAQ L0102]` says only "the uploader"; a PREprod error email may answer it first |

## E. Deliberately NOT asked

U-03 (T-10/T-11), U-02 (T-12), U-05 (T-30/T-31B/T-33/T-34), U-11 (error inbox),
U-16 (T-31) — all answered by our own probe files, per Part 06 §G1. U-04, U-12 and
U-09 (§G2) are held back until the run produces an ambiguous result; a follow-up about
a specific error must attach the .CSV and forward the error email `[FAQ L0030]`.

U-10 (the October 2026 WA.gov change `[FAQ L0008-L0012]`) was cut from the send list:
it is a roadmap question, not a blocker, and it would dilute four sharp questions.
It is tracked in Part 11 and can be asked in a later, separate email.

## F. After the reply arrives

1. Paste each answer verbatim into Part 12 against its U-xx, dated, with the sender.
2. If ¶1 returns actual data, that is a **source document** — record it in Part 13 with
   its fetch date and checksum, and re-pin Part 07 R-1…R-5 against it.
3. If ¶2 selects option (b), Part 07's cutover sequence needs the InventoryTransfer
   step promoted from optional to required before S-05.
