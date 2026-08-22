# Authority source texts

Searchable text of the accounting authorities this system cites.

Michael obtained these documents on **2026-08-20** and asked that they live in
the repository for reference. His words:

> *"I took the liberty of getting it all for you. I have nearly all of it, which
> is way more than our scope, but I want to have it in my repo for future use
> and reference."*

---

## Why text and not the PDFs

The original PDFs are **104 MB across 27 files**. This repository's entire
history is about 68 MB, so committing them would have made every future clone
roughly two and a half times heavier, permanently — git keeps the objects even
after a file is deleted, and PDFs are already compressed so git cannot shrink
them.

The extracted text is a fraction of that and, far more importantly, it is
**greppable**. That is the whole point. Standing rule 24 requires quoting
authority verbatim, and standing rule 35 requires proving the quote is verbatim
by machine rather than by careful typing. Neither is possible against a binary
PDF. Both are trivial against text:

```bash
grep -n -A6 "^ *330-10-30-1 " docs/authorities/fasb-codification/asc-330.txt
```

That command is how the ASC quotes in
`src/lib/accounting/financial-statement-authorities.ts` were sourced and then
verified.

The PDFs themselves are Michael's and live in his own storage.

---

## Copyright — read this before copying anything out of here

**These are licensed documents, reproduced here for the owner's private
reference in a private repository. They are not ours to redistribute.**

Every FASB file carries this notice, quoted verbatim:

> Copyright © 2026 by Financial Accounting Foundation. All rights reserved.
> Certain portions may include material copyrighted by American Institute of
> Certified Public Accountants. Content copyrighted by Financial Accounting
> Foundation, or any third parties who have not provided specific permission,
> may not be reproduced, stored in a retrieval system, or transmitted, in any
> form or by any means, electronic, mechanical, photocopying, recording, or
> otherwise, without the prior written permission of Financial Accounting
> Foundation or such applicable third party. Financial Accounting Foundation
> claims no copyright in any portion hereof that constitutes a work of the
> United States Government.

The AICPA file carries its own:

> Copyright © 2026 American Institute of CPAs. All rights reserved. For
> information about the procedure for requesting permission to make copies of
> any part of this work, please email copyright-permissions@aicpa-cima.com with
> your request.

The COSO Executive Summary carries its own, and it is the strictest of the
three. Quoted verbatim from page 2 of the PDF:

> ©2013 All Rights Reserved. No part of this publication may be reproduced,
> redistributed, transmitted or displayed in any form or by any means without
> written permission. For information regarding licensing and reprint
> permissions please contact the American Institute of Certified Public
> Accountants, licensing and permissions agent for COSO copyrighted materials.
> Direct all inquiries to copyright@aicpa.org or to AICPA, Attn: Manager, Rights
> and Permissions, 220 Leigh Farm Rd., Durham, NC 27707. Telephone inquiries may
> be directed to 888-777-7077.

**The two Green Book files are the exception: they are not copyrighted at all.**
They are works of the United States Government prepared by the Government
Accountability Office, and under 17 U.S.C. §105 no copyright subsists in them.
They may be quoted and reproduced freely. They are also the reason the internal
control registry is usable: where COSO's own text is licensed and must be
quoted sparingly, the Green Book adapts the same five components and seventeen
principles into public-domain language, so a citation that would be awkward to
quote from COSO can be quoted at length from GAO instead.

**Practical consequences, stated plainly:**

- **This repository must stay private.** Publishing it publishes this material.
- Short quotations inside the authority registry, attributed and cited, are the
  normal professional use of accounting standards. Bulk republication is not.
- If this repository is ever opened up, or any part of it is published,
  **delete this directory first** and go back to citing the ASC by paragraph
  number without quoting it — which is exactly what the codebase did before
  2026-08-20, and it said so out loud at the time.

---

## Layout

```
docs/authorities/
├── fasb-codification/   ASC topics, one file per topic
├── fasb-concepts/       conceptual framework, CON 8 ch.5, SOP 82-1
├── aicpa/               SSARS (AR-C sections)
├── coso/                COSO Internal Control framework, Executive Summary
├── green-book/          GAO Standards for Internal Control (2014 and 2025)
├── federal/             U.S. Code, CFR, IRS publications
├── state-wa/            Revised Code of Washington
└── MANIFEST.tsv         provenance for every PDF-derived file
```

`MANIFEST.tsv` records, for each text file: the PDF it came from, that PDF's
size and SHA-256 prefix, the resulting line and byte counts, and the page count.
The hash is what lets a future reader confirm they are holding the *same*
document, not merely one with the same name.

## What is here

| Area | Topics |
|---|---|
| Presentation | ASC 205 (presentation), 210 (balance sheet), 225 (income statement), 230 (cash flows), 250 (changes and error corrections) |
| Assets | ASC 305 (cash), 330 (inventory), 350 (intangibles), 360 (property, plant and equipment) |
| Liabilities | ASC 405 (liabilities), 450 (contingencies) |
| Equity | ASC 505 (equity) |
| Revenue | ASC 605 (legacy revenue), 606 (revenue from contracts), 610 (other income) |
| Expenses | ASC 705 (cost of sales), 710 (compensation), 715 (retirement benefits), 720 (other expenses) |
| Income taxes | ASC 740 |
| Other | ASC 274 (personal financial statements), 842 (leases), 850 (related parties) |
| Concepts | conceptual framework, CON 8 ch.5 recognition and derecognition, SOP 82-1 |
| Attestation | AICPA SSARS, AR-C sections |
| Internal control | COSO *Internal Control — Integrated Framework* Executive Summary (2013); GAO *Standards for Internal Control in the Federal Government* — the "Green Book" — both the 2014 (GAO-14-704G) and 2025 (GAO-25-107721) editions |

Both Green Book editions are kept deliberately, not by accident. Several
principles were reworded between 2014 and 2025, so an authority record has to
say which edition it is quoting and be checked against *that* edition's file.
A test in `tests/compliance/internal-control-authorities.test.ts` proves this is
load-bearing by confirming the 2014 wording of Principle 8 does not appear in
the 2025 text, and the reverse.

Several of these are well beyond current scope — ASC 842 leases, ASC 715
retirement benefits — and are here because Michael gathered broadly for future
reference. That is deliberate and useful: when a slice eventually needs them,
the authority is already on disk and quotable.

## Reproducing the extraction

For the FASB and AICPA files:

```bash
pdftotext -layout <source>.pdf <name>.txt
```

`-layout` preserves column structure, which matters because the Codification
puts paragraph numbers in a left-hand gutter. Without it the numbers detach from
their text and the files stop being searchable by paragraph.

For the COSO and Green Book files, `-layout` is **wrong** and `-raw` is required:

```bash
pdftotext -raw <source>.pdf <name>.txt
```

These documents set their principle headings as wide, centred display type.
`-layout` tries to preserve that visual arrangement and in doing so splits a
single sentence across margin columns, which corrupts the sentence and makes it
impossible to quote verbatim. `-raw` emits text in reading order and leaves the
sentences intact. This was found the hard way, by a quote failing verification.

Downloading them needs one extra step, because gao.gov and coso.org sit behind
Akamai and return HTTP 403 with a ~400-byte HTML stub to a plain `curl`. Sending
browser-shaped headers gets the real PDF:

```bash
curl -A '<a current Safari user-agent>' \
     -H 'Referer: https://www.gao.gov/products/gao-25-107721' \
     -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' \
     -H 'Sec-Fetch-Site: same-origin' --compressed -L \
     -o gao-25-107721.pdf https://www.gao.gov/assets/gao-25-107721.pdf
```

**Always run `file` on the result.** A 403 stub is still written to disk with a
`.pdf` name and will silently produce an empty text file.

### The one transformation applied to a source text

The COSO file is the only text in this directory that has been altered after
extraction, and the alteration is recorded here because an unrecorded edit to a
source document would make every quote drawn from it untrustworthy.

The COSO PDF is justified, so it hyphenates words at line ends: the extracted
text contained `manage-\nment` rather than `management`. That broke the quote of
COSO's own definition of internal control. All 64 occurrences of the
`word-\nword` pattern in the file were listed and inspected individually; every
one was typesetting hyphenation and not one was a real compound word broken at
its own hyphen. They were rejoined, with the count asserted at 64 before and 0
after, so the transformation cannot silently do more or less than intended.

The Green Book files were deliberately **not** treated this way. Their hyphen
breaks are the opposite case — real compounds like `third-party` and
`quasi-governmental` — and rejoining them would corrupt the text rather than
repair it. A test asserts those compounds survive intact, which is what keeps
the COSO fix from ever being generalised into a rule that damages other files.

## A note on what these texts are and are not

The Codification's own provenance brackets survive extraction, so a paragraph
looks like this:

```
330-10-30-1  [ The primary basis of accounting for inventories is cost...
             [ ARB 43 Ch. 4 Statement 3 169 ] ]
```

The `[ ARB 43 ... ]` markers are the FASB's record of which pre-Codification
standard the sentence came from. They are **not part of the quoted rule** and
are stripped before a quote is stored in the authority registry. The verifier
that proves a quote is verbatim strips them the same way on both sides, so the
comparison stays honest.
