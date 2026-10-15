# OFAC authority mirror (R41 S11)

Fetched 2026-10-15 (UTC) for R41 S11 (OFAC screening). The Timberland ACH
agreement, section 3, makes sanctions screening Greenway's job: "It shall be
the responsibility of Company to obtain information regarding such OFAC
enforced sanctions." (`../ach/timberland-ach-agreement-2026-10-09.redacted.txt`).

Nothing was retyped by hand. The data specifications are OFAC's own plain-text
files with CR LF turned into LF. The FAQ pages are the visible text of the
page's `<main>` element (HTML stripped with BeautifulSoup, blank lines dropped).

Two edits were made, both for this public repo, and both are marked in the text:

- OFAC Licensing's phone number in the SDN spec is replaced with
  `[OFAC Licensing phone omitted from this public repo]`;
- OFAC's technical-support email address in the 2024 notice is replaced with
  `[OFAC contact email omitted from this public repo]`.

The sanctions list data files themselves (SDN.CSV, ALT.CSV, CONS_PRIM.CSV,
CONS_ALT.CSV) are NOT committed: they change often, and the app downloads the
current ones at screening time.

| file | source URL | source sha256 (as fetched) | what it supports |
| --- | --- | --- | --- |
| ofac-dat-spec-2023-09-25.txt | https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/dat_spec.txt | 8fc7ea2019b5430fe63b64da2ff636c4c8185ce57230fb6ae8a7c4bb33508382 | SDN.CSV / ALT.CSV columns (12 and 5), comma delimiter, `"` text quotes, `-0-` null, carriage-return record separator; weak AKAs live in Remarks, and OFAC "does not expect that persons will screen for weak AKAs" |
| ofac-cons-dat-spec.txt | https://www.treasury.gov/ofac/downloads/consolidated/cons_dat_spec.txt | c4c6c58adfdc4ab389fc0b54dfa9ea3f1f88977d86d28ad5e33977a824ac6a65 | CONS_PRIM.CSV / CONS_ALT.CSV (the non-SDN Consolidated list): same columns and conventions as the SDN files |
| ofac-faq-249-score-calculation.txt | https://ofac.treasury.gov/faqs/249 | b95a680b828766f8fb827701a05c0b68a4977507cbec295835809936f1b36eb0 | The match score method: Jaro-Winkler on the full name, and name parts with Jaro-Winkler and Soundex; the higher of the two |
| ofac-faq-250-no-threshold.txt | https://ofac.treasury.gov/faqs/250 | 121ae04fbd40234c102eedf705a73ba8082f37a537a2fff15484210e21512774 | OFAC will not recommend a threshold; users decide on their own risk assessment |
| ofac-faq-247-score.txt | https://ofac.treasury.gov/faqs/247 | 27fc39ec91a3e6425d704aaa9c18c99fbd0a7f600b48a6fec7b3e05632b0e521 | 100 means an exact match; lower scores are potential matches |
| ofac-faq-287-automated-use.txt | https://ofac.treasury.gov/faqs/287 | b576343516c11aa41d2319e0039bac78d79b1baa0449a4b506fa77a065952448 | Automated systems must use the data files, not the search website |
| ofac-faq-5-valid-match.txt | https://ofac.treasury.gov/faqs/5 | 6230db845353f3fe510d72c58fd5fd55263940a7d43c0aa33159336ba8e80106 | How to review a possible match (Steps 1 to 6): "Many potential matches identified through screening are false positives"; "If after you review available information, you can reasonably determine the match is not valid, then you may proceed with the transaction or activity"; keep records of the review |
| ofac-technical-notice-2024-05-16-user-agent.txt | https://ofac.treasury.gov/sdn-list-data-formats-data-schemas/ofac-technical-actions-in-reverse-chronological-order/20240516_44 | 10e37521d28c28ae35c7e23b52c33f484720334d985d2912988546a08603de0e | The files moved to `sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/{FILE}`; requests need a User-Agent header |

What the real files looked like on 2026-10-15 (checked, not assumed): SDN.CSV
had 19,430 records, every one with exactly 12 fields; ALT.CSV 20,184 records of
5 fields; CONS_PRIM.CSV 481 of 12; CONS_ALT.CSV 1,110 of 5. Every record ends
in CR LF, a single 0x1A byte follows the last record, every byte is ASCII, there
is no header row, and the null is written `-0- ` (with a trailing space). SDN
types seen: `-0- ` (an entity, 10,029), `individual` (7,500), `vessel` (1,559),
`aircraft` (342).

How the server answers (checked 2026-10-15 with curl, not assumed):

- GET on `.../exports/SDN.CSV` (and the other three) answers `302 Found` with a
  `Location:` pointing at a pre-signed Amazon S3 address (`X-Amz-Expires=3600`)
  holding today's publication. The S3 answer is `200 OK`, `Content-Type:
  text/csv`, a `Content-Length`, a `Last-Modified` and `x-amz-meta-preview-date`.
- HEAD on `.../exports/SDN.CSV` answers `200 OK` with `Last-Modified` and a
  header written `Digest: sha-256<64 hex>` (no `=` sign). On 2026-10-15 the
  digest equalled the sha256 of the bytes the redirect served
  (`0dee0d2d...0ce71`, 5,741,043 bytes, republished that morning).
- HEAD on ALT.CSV, CONS_PRIM.CSV and CONS_ALT.CSV answers `400 Bad Request`, so
  those three have no published digest; the app checks their structure
  (exact field counts, ASCII, the final 0x1A) and records its own sha256.
