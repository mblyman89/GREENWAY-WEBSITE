# Evidence: owner request of 2026-10-19 + LCB pages fetched 2026-10-19

Cited from Part 17 and later parts. `scripts/ccrs-bible/check_pins.py` verifies every pin against these files (`REPO_SRC`).

## Files

| Pin prefix | File | What it is | Lines | md5 |
|---|---|---|---|---|
| `[EXAM L####]` | `owner-request-verbatim.txt` | The owner's entire 2026-10-19 message, verbatim, with CR characters stripped. It holds the hub's blocking validation text, the PREprod success emails of 10/07, the full Cannabis Examiner Unit thread (Brian McQuay, 9/17 → 10/5) including the owner's own emails, and the closing request | 852 | `6da5d9498997fc140402d58a924c78f7` |
| `[FAQ19 L####]` | `lcb-2026-10-19/faq.txt` | `https://lcb.wa.gov/ccrs/faq`, fetched 2026-10-19. Text extraction. **Not** the same file as `[FAQ]` (fetched 2026-09-15, Part 02 §2). The page grew from 183 lines to 781 lines | 781 | `9e0c507b1a2f309d5f23eccc5d85bc68` |
| `[SIGNIN L####]` | `lcb-2026-10-19/signin.txt` | "CCRS User Sign-In Guide", CIB154 8/26, `https://lcb.wa.gov/sites/default/files/2026-08/CCRS_User_SignIn_Guide.pdf` (PDF md5 `0a0ad5a5ba868ff227708fcc4079603d`, not committed), pdftotext | 74 | `85309bc9fa53207182c899898101a014` |
| `[BUL1006 L####]` | `lcb-2026-10-19/bulletin-42e03cc.txt` | LCB GovDelivery bulletin of 2026-10-06, "Oct. 12: CCRS Transition to WA.gov Login", `https://content.govdelivery.com/accounts/WALCB/bulletins/42e03cc`. Tags stripped, blank lines removed | 21 | `67bee0924c49dec1d23d67d3540be2c4` |
| — | `lcb-2026-10-19/bulletin-42e03cc.html` | The raw HTML of that bulletin | — | `b2d8e3f0ee5d596045f16fa03286df07` |

## Re-checked unchanged on 2026-10-19

Compared by md5 with Part 13 §A/§B. **No change.** No Part 02 pin moved.

- The Upload User Guide PDF (Feb 2026) is `cbfc4dd29b49c42639f1207f8078a6b4`, the same as before.
- All seven CSV templates are byte-identical to `docs/ccrs-templates/*.csv`.

## EXAM line map (where things are)

| Lines | Content |
|---|---|
| L0001–L0016 | Hub validation text: 2 errors (L0002 Product, L0003 Inventory) and 12 warnings (L0005–L0016) |
| L0024–L0052 | PREprod success emails of 2026-10-07 (run P20261007A, 7 files) |
| L0088–L0099 | Brian 9/17: data offer (L0095), "use the update path" (L0096), retention (L0097), unassigning Cultivera (L0098) |
| L0130–L0140 | Brian 9/21: data delivery; "click do not convert" (L0139) |
| L0175–L0294 | Owner 9/21: measured findings and questions (L0184 counts, L0202–L0204 stale lots, L0221 areas, L0233 TotalCost 0, L0235 QoH > Initial) |
| L0306–L0330 | Brian 9/25: ids and patterns (L0320, L0323, L0326, L0329) |
| L0411–L0431 | Brian 10/2: data ownership (L0426); zero-then-Reconciliation (L0430) |
| L0456–L0569 | Brian 10/5: answers to the long question list (L0467 … L0568) |
| L0843 | The owner's closing request |

The P20261007A files that produced those success emails are at `../P20261007A/files/` (see that folder's README).
