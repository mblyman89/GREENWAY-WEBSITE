# Washington cannabis testing labs (R36 research)

Researched for R36. Everything below was checked against a primary source, and the files were downloaded and read, not copied from memory.

## Sources

1. **WSLCB "Frequently Requested Lists" → Lab List (current)**, `Lab-List-8-4-2026.xlsx`.
   https://lcb.wa.gov/sites/default/files/2026-08/Lab-List-8-4-2026.xlsx
   (linked from https://lcb.wa.gov/records/frequently-requested-lists)
2. **WSDA Cannabis Lab Analysis Program / accreditation table** (page updated June 3, 2026).
   https://agr.wa.gov/departments/cannabis
   Accreditation moved from LCB to WSDA (2SHB 2151 / HB 1859). The current WSDA table lists the same four labs as accredited and approved for cannabinoids, heavy metals, pesticides and residual solvents.
3. **WSLCB historical Lab List**, `Lab-List-8-2-2021.xlsx`. Used for labs that have since left the list, so that an older COA still on a product is recognised as a real Washington lab.

## Active (certified, on the 2026-08-04 LCB list)

| Lab # | Lab | Address | Phone | Cert start | Current cert | Valid through |
|---|---|---|---|---|---|---|
| 3 | Confidence Analytics | 14797 NE 95th St, Redmond 98052 | 206-743-8843 | June 18, 2014 | July 23, 2026 | July 2027 |
| 9 | Integrity Labs, LLC | 2747 Pacific Ave SE Ste B21, Olympia 98501 | 360-951-3220 | Aug 19, 2014 | Oct 29, 2025 | Oct 2026 |
| 12 | Green Grower Labs | 124 E. Rowan Ave Ste B, Spokane 99207 | 509-981-2266 | Sept 23, 2014 | Nov 21, 2025 | Nov 2026 |
| 18 | Medicine Creek Analytics | 3700 Pacific Hwy E Ste 400, Fife 98424 | 253-382-6900 | May 25, 2016 | July 21, 2026 | July 2027 |

## Historical (on the 2021 list, absent from the 2026 list)

| Lab # | Lab | City | Phone |
|---|---|---|---|
| 4 | Analytical 360, LLC | Yakima (31 N 1st Avenue 98902) | 509-571-1102 |
| 6 | True Northwest, Inc. | Olympia (4139 Libby Rd NE 98506) | 360-352-8688 |
| 7 | Testing Technologies, Inc. | Poulsbo (19834 Viking Ave NW Ste B 98370) | 360-340-1251 |
| 8 | G.O.A.T. Labs | Vancouver (5501 NE 109th Ct Ste N 98662) | 360-513-9377 |
| 21 | Treeline Analytics, LLC | Bellingham (5373 Guide Meridian Ste F-201 98226) | 360-306-3601 |
| 22 | Capitol Analysis | Olympia (3011 Pacific Ave SE 98501) | 360-918-8795 |
| 25 | Pacific Botanicals Laboratory | Seattle (3927 Aurora Ave N 98103) | 206-566-3526 |

## COA hosts (the "known list" the certificate reader checks)

The error "X is not a known lab host" comes from `safeCoaUrl` (coa-extract-core.ts). It is a **host** check, not a lab-name check, and it exists so the server never fetches an arbitrary link from an email (SSRF protection). We only add a host after seeing evidence that certificates are really served from it.

| Host | Who | Evidence |
|---|---|---|
| certs.conflabs.com | Confidence Analytics | 16 real COA links on the owner's transfer (R26/R28 samples), fetched and read |
| gglabs-j.github.io | Green Grower Labs | real COA links on the owner's transfer, fetched and read |
| files.cultivera.com | Cultivera, the vendor's seed-to-sale platform (not a lab) | The owner's real Transfer Data Links are served from this host (`files.cultivera.com/<id>/import/...json`, owner-verified in R12/R27). Cultivera's support article "Uploading Lab Test Results (COAs)" (https://support.cultivera.com/article/lp8ms1pvxk-uploading-coas) shows that vendors upload the lab's COA PDF into Cultivera. The owner reported that the reader refused a Cultivera link with "not a known lab host". **This is the host behind that error.** The same https / exact-host / redirect / size / content-type / PDF-magic guards still apply. |

Lab portals that were found but are **not** on the fetch list, because they are client log-in portals and not public certificate links:

- results.conflabs.com, the Confidence Analytics portal, linked from conflabs.com.
- mca.qbench.net, the Medicine Creek Analytics QBench portal, linked from medicinecreekanalytics.com/client-login/.

Not added, because nothing could be verified:

- **Integrity Labs** (integritylabsolympia.com) sits behind a bot captcha, and no public COA host could be confirmed.
- **Treeline Analytics** (results.treelineanalytics.com) answers 200, but the lab is not on the current list.

The owner can add any host from the new **Testing labs** page (Inventory → Testing labs) once a real COA link shows it. The page refuses IP addresses, ports, credentials and non-https links, so the safety guard stays in place.

## A separate limit: the certificate *layout* reader

Fetching is one step. Reading the numbers is another. `detectCoaTemplate` (coa-pdf-text-core.ts) currently knows two verified layouts: Confident Cannabis (used by Confidence Analytics) and Green Grower Labs. A certificate from another lab will now be **fetched and archived**, but its potency table may still be reported as "a layout the reader does not know yet" until a real sample of that lab's PDF is used to teach the reader. Nothing is guessed in the meantime.
