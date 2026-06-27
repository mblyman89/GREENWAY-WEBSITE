# Round 4 — Final-Mile Customer-Facing Polish (HANDOFF-READY)

Branch: `feature/round4-finalmile`  |  Repo: mblyman89/GREENWAY-WEBSITE  |  Base: main @ 8af87b9
Live prod: https://greenwaywebsite1.vercel.app  (Vercel project auto-deploys on push to main)

## CONTEXT / KEY FACTS
- Legal entity = **LYMAN'S MARIJUANA, Inc., doing business as Greenway Marijuana** (Port Orchard, WA, est. 2014).
  This is the user's OWN legal entity (confirmed in terms-of-use §1) → KEEP IT. NOT a borrowed third party.
- The "three word documents" the user refers to = the three legal content files in the repo:
  - `src/content/privacy-policy.ts`
  - `src/content/terms-of-use.ts`
  - `src/content/consumer-health-data.ts`
- Rendered by: `src/app/privacy-policy/page.tsx`, `src/app/terms-of-use/page.tsx`, `src/app/consumer-health-data/page.tsx`
  (each maps a `string[]` of paragraphs; headings detected by `isPolicyHeading`).
- Desktop nav = `src/components/site/navigation-data.ts` + `DesktopMenu.tsx` (renders `primaryNavigationItems`).
- Mobile nav (hamburger) = `src/components/site/MobileNavigation.tsx` (already has "Vendors & Partners" → /vendor-delivery).
- Footer = `src/components/site/Footer.tsx` (MobileFooter + DesktopFooter). Currently NO copyright text anywhere.
- Vendor page route = `/vendor-delivery` (title "Vendors & Partners").

## TASKS

### 1. Desktop nav: Vendors tab [DONE-VERIFIED]
- [ ] Add a top-level item to `primaryNavigationItems` in navigation-data.ts → label "Vendors", href "/vendor-delivery"
      (keep desktop tab labels short/consistent; full label "Vendors & Partners" stays in dropdowns/mobile).
- [ ] DECISION: place it after "FAQ" so it reads Home/Shop/Specials/About/Location/Loyalty/Blog/FAQ/Vendors.
- [ ] Verify it renders in the desktop top tab bar AND still accessible via hamburger.

### 2. Audit 3 legal docs — REVISED PER USER  [DONE]
AUDIT RESULT (scraped ikes.com privacy/terms/CHD via browser, diffed vs our content):
- Ike's entity = "Jet City Retail, Inc." → ours correctly = "LYMAN'S MARIJUANA, Inc." ✓
- Ike's app/brand = "Uncle Ike's" → ours correctly = "Greenway Marijuana" ✓
- Ike's contact = privacy@ikes.com / 1-800-GET-DRUGS / 5 Seattle stores → ours = Greenway's correct info ✓
- App / Apple / Google references KEPT per user (future app). ✓
- ONE RESIDUAL LEAK FOUND & FIXED: Terms §15.8 venue said "King County, Washington" (Ike's Seattle county).
  Greenway/Port Orchard is in KITSAP County → changed "King County" → "Kitsap County". ✓
- docx uploads == repo content (same source), so website already carries the cleaned text + this fix.
SOURCE: User adapted these from Uncle Ike's (ikes.com). Goal = make sure NO Uncle Ike's-specific
content leaked through (their name, addresses, emails, URLs, store list, entity name, etc.).
USER DECISIONS (updated):
- [ ] KEEP "LYMAN'S MARIJUANA d.b.a Greenway Marijuana" (correct parent/DBA). Do NOT remove.
- [ ] KEEP all App / Apple / Google / Google Play / App Store content — user WILL have an app later.
      The Apple/Google references are normal app-store legal boilerplate tied to HIS future app. Keep.
- [ ] Scrape Uncle Ike's live docs (ikes.com privacy / terms / consumer health) and DIFF against ours
      to catch any residual Uncle Ike's identifiers, store names, addresses, emails, phone, URLs.
- [ ] "Lawyer cap": lightly modify wording so everything reads as Greenway's own brand/company; replace
      any Ike's-specific facts with Greenway facts (Port Orchard address, contact@greenwaymarijuana.com,
      greenwaymarijuana.com, 360-443-6988). Keep standard legal boilerplate (merger/acquisition etc.).
- [ ] Confirm final docs contain ONLY Greenway / LYMAN'S MARIJUANA identifiers.

### 3. Hyperlink all inline doc cross-references  [DONE]
Inside the 3 docs, references to "Privacy Policy", "Terms of Use", "Consumer Health Data Privacy Policy"
currently render as plain text. Make them real links to the right page.
- [ ] DECISION: add a small inline-linkifier in each policy page renderer (regex replace on known phrases →
      Next <Link>). Map: "Privacy Policy" → /privacy-policy, "Terms of Use" → /terms-of-use,
      "Consumer Health Data Privacy Policy"/"Consumer Health Data Policy" → /consumer-health-data.
      Do NOT self-link a doc to itself (e.g. don't linkify "Privacy Policy" on the privacy page) to avoid
      circular/odd UX — link only the OTHER docs. Also linkify the contact email → mailto, and
      the atg.wa.gov complaint URL + greenwaymarijuana.com URLs → external links.
- [ ] Build a shared `renderPolicyParagraph` util so all 3 pages share identical linking logic.

### 4. Consumer Health Data title font size → fit on 2 lines  [DONE]
- [ ] In consumer-health-data/page.tsx the h1 is two <span block> lines but at lg:text-8xl the first line
      ("Washington Consumer Health Data") wraps to a 3rd line. Reduce the h1 size (e.g. md:text-6xl lg:text-7xl
      or tighter) so each span stays on ONE line = 2 lines total. Verify desktop + mobile.

### 5. MOBILE footer reorder  [DONE]
On mobile (MobileFooter) currently order is: logo → tagline → address card → hours card → PolicyLinks →
app downloads → social → Washington Cannabis Warning.
User wants:
- [ ] Move PolicyLinks (Privacy / Terms / Consumer Health) to be UNDER the Washington Cannabis Warning.
- [ ] Copyright line goes DIRECTLY under the PolicyLinks (i.e. warning → policy links → copyright).
- [ ] Keep copyright on 2 lines (user likes it on two lines).

### 6. Desktop footer copyright  [DONE]
- [ ] Add a copyright line BELOW the logo in the DesktopFooter left column.
- [ ] Copyright text: "© {year} LYMAN'S MARIJUANA, Inc., dba Greenway Marijuana." + "All rights reserved."
      (2 lines). Year computed dynamically.

### 7. Validate + visually verify (local)  [DONE]
- [ ] npx tsc --noEmit (exit 0)
- [ ] npx eslint src (exit 0)
- [ ] clean build (rm -rf .next; npm run build) → compiles, no errors
- [ ] Screenshot desktop: top nav shows Vendors tab; footer shows copyright under logo.
- [ ] Screenshot desktop: consumer-health title on 2 lines.
- [ ] Screenshot mobile: footer order warning → policy links → copyright.
- [ ] Screenshot desktop: a policy page showing working cross-links.

### 8. Ship  [DONE]
- [ ] commit, push branch, open PR, wait for Vercel preview check, merge to main.
- [ ] confirm production deployment success (gh deployments API, state=success, new SHA).
- [ ] verify live prod.

### 9. Deep-dive readiness report  [DONE]
- [ ] Full comprehensive report + TLDR: is the front end ready for the back-office project, or what
      polishing remains to be top-of-line vs competitors.
