# greenwaymerch.com catalog

Drop Merch Studio **listing packages** (`greenway-goods-<handle>-<date>.json`) here.

* File order is the "Featured" order - prefix with `01-`, `02-` to choose it.
* Optional block you may add to a package:
  `"merch": { "active": false }` (hide), `"category": "hats"` (override the page),
  `"images": ["/products/my-photo.jpg"]` (explicit photos).
* Print PNGs (from the Proof & Export ZIP) go in `../public/print/` with the same filenames.
* Product photos go in `../public/products/` named `<handle>-1.jpg`, `<handle>-2.webp`, ...

Check everything with `npm run catalog && npm test` inside `merch-site/`.
