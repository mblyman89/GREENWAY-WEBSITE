# Back Office Beautification + Feature Round

> Owner request, recorded verbatim (standing rule: record every request verbatim).

## Verbatim request

> I want to do a round of beautification on the back end now. I have screenshots of the
> problem areas I want addressed. Plus some notes on what I need to add now that I've had a
> chance to inspect more. Please also visually inspect the customer facing website so you can
> gather visual references for adding the same theme and style and colors to the backend. I
> want the same orange the website uses. I want the same green the website uses. I like the
> yellow you are using for the back end. I also like the red. Make the button styles all the
> same. I don't like the transparent type buttons. Please be absolutely certain you don't
> break anything when making these enhancements. Please ground all builds in fact and follow
> the standing rules. Please proceed with caution. I trust your judgement. Here is my list and
> screenshots:
>
> - [ ] Add gpt-4o to blog page to help find fun engaging online news and trends and all things
>   cannabis related news and such. Blog material catering to the cannabis industry as a whole
>   as well as trying to focus on my specific general area and demographic so it's relevant to
>   us more. Also please center the content on the page.
> - [ ] Add a feature to allow me to scan products to an excel spreadsheet that I can then import
>   the excel file to the cycle count that is open and then auto fill the fields. I like the scan
>   feature in the page, but doing in excel then uploading it sounds very efficient. Then have a
>   validation step to approve the import. Also, in the container labeled "start a new count" the
>   two text boxes are not side by side correctly. One is higher than the other. I also need the
>   ability to sort and filter and such to hone in on the areas I want to audit. Please give me a
>   ton of filtering and sorting options, no limits please. Right now it just loads the full
>   inventory list. That way we can export the list we filtered and then do the scanning to excel.
> - [ ] Vendor ach should have a guardrail that requires a payment be married to an invoice that
>   has been accepted, and guardrails to protect us from over/ under paying.
> - [ ] How do I upload the 8 images for flux on the image prompt builder page? Please add.
> - [ ] Receipt printer page is very ugly.

## Verified facts (grounded — do NOT guess)

### Brand palette (from `src/app/globals.css`, verified)
- Green (customer site): `--greenway: #7ed957`
- Orange (customer site): `--orange: #ff7f00`
- Gold/yellow (already used in admin, owner likes): `--gold: #ffd700`
- Red (already used in admin, owner likes): `--admin-danger: #ff5a5a`
- Admin already maps `--admin-accent: var(--greenway)`, `--admin-orange: var(--orange)`,
  `--admin-gold: var(--gold)`. So the palette is ALREADY aligned to the public site.

### Button system (from `src/components/admin/ui/Button.tsx`, verified)
- Canonical `<Button>` has 5 variants: primary(green), save(gold), subtle(bordered neutral),
  ghost(text-only/transparent), danger.
- "Transparent type buttons" the owner dislikes = `subtle` (transparent-ish bordered) and
  `ghost` (fully transparent text-only), PLUS many ad-hoc buttons across pages that don't use
  <Button> at all (e.g. intake export links use raw `border ... bg-*-soft`).

## Slice plan (small, safe, verified — nothing merged until it builds clean)

- [x] B0. Deep-dive current state: read each target page's real code + view every screenshot;
      map screenshots to items; confirm scope. NO guessing.
- [x] B1. Button unification: killed subtle/ghost → confirm(green)/neutral(dark chip); solid
      pill/uppercase/brand-color mapping (orange primary). Added color-scheme:dark +
      native-control styling globally. AiBusyButton de-transparented. Badge outline→solid.
      tsc clean + full build passed (2378 routes).
- [x] B2. New Purchase Order builder-table: fully migrated light→dark tokens (readable product
      names, dark inputs/select/date/textarea, save button). Verified.
- [x] B3. Receipt printer page + PrinterDiagnosticChat: fully migrated light→dark tokens.
      Verified.
- [x] (bonus) Marketing StrategyAssistant + IdeaNotebook white cards → dark tokens. Delete
      button now red (danger). Verified.
- [ ] B4. FLUX image prompt builder: add 8-image upload UI (verify against existing FLUX core).
- [ ] B5. Cycle count: fix "start a new count" field alignment; add heavy filter/sort;
      export filtered list; scan-to-Excel import w/ validation+approval step.
- [ ] B6. Vendor ACH guardrails: payment must marry an ACCEPTED invoice; over/under-pay guard.
- [ ] B7. Blog page: GPT-4o trend/news assistant (cannabis + local demographic); center content.

## OWNER DECISIONS (answered — binding)
1. Match public site EXACTLY: rounded-full pill, UPPERCASE, bold, SOLID fill only. No white
   anywhere in backend except text color + rare one-offs. Background must match public site
   style/colors/theme. There is button-color inconsistency today — define a CLEAR pattern.
2. Buttons use ONLY green / orange / gold(yellow) / red. Find a logical mapping.
3. Scan-to-Excel round trip confirmed exactly (filter→export xlsx→scan in excel→upload→
   validate/preview→approve→fills OPEN count). Give a TON of sort/filter options (reasonable,
   not literally infinite).
4. Vendor ACH underpay/partial = allow with WARNING (not blocked). Overpay = blocked.
5. Blog GPT-4o: do BOTH — suggest ideas/headlines/trends AND full drafts (draft-only).
   Local focus = Kitsap County + surrounding area, Seattle included.

## BINDING THEME RULES (from decisions)
- NO white surfaces/inputs in the back office. White only for text (and rare one-offs).
- All buttons: SOLID fill, rounded-full pill, UPPERCASE, bold (mirror public site DNA:
  `rounded-full ... font-black uppercase tracking-[0.14em] text-black`).
- Button color mapping (FINAL):
  - ORANGE  = primary / main CTA (the signature public-site action button)
  - GREEN   = positive / confirm / publish / go / approve / start
  - GOLD    = save draft / save settings (persist-without-publish)
  - RED     = destructive / danger (delete, reject)
  - NEUTRAL secondary (Cancel/Back nav) = SOLID dark surface chip (--admin-surface-2),
    no white, no transparency. (Owner wants only brand colors for real buttons; plain
    nav gets a solid dark chip so it reads as secondary.)
- Inputs/selects/textareas: solid dark surface (--admin-surface-2) w/ subtle border,
  never white. Fix any raw <input>/<select>/<textarea> that render white.
- Background: admin canvas already dark; add the public-site brand glow feel (green+orange
  radial) consistently. Public body uses green+orange radial over #000.

## MAJOR FINDING (B0)
- The "white cards" seen on Marketing/PO/Receipt pages = ad-hoc light panels + raw white
  form controls. This is the #1 offender for the "no white" rule. Sweep the shared
  Field/Input/Card primitives + ad-hoc controls to solid dark surfaces.

## Open questions for owner (blockers — asked before building)

### More verified facts found in B0
- Customer-site button DNA (verified from source, e.g. LocationsContent/CheckoutFlow):
  `rounded-full bg-[var(--orange)] text-black font-black uppercase tracking-[0.14em]
  transition hover:bg-white` (or `hover:bg-[var(--greenway)]`). Green is the secondary
  solid fill. NO transparent buttons anywhere on the public site.
- Admin `<Button>` currently uses softer `rounded-[var(--admin-radius)]` and HAS transparent
  variants (`subtle`, `ghost`). Mismatch to reconcile.
- Cycle-count "Start a new count" bug CONFIRMED: 2nd Field has a `help` line, 1st doesn't,
  and the row uses `sm:items-end` → inputs sit at different heights. Simple fix.
- FLUX builder = `MidjourneyBuilder` at `src/app/admin/marketing/midjourney/`. It currently
  sources reference images from the PUBLISHED MEDIA LIBRARY only — there is no direct
  8-image upload on the builder page. That is the gap for B4.

### Blocking questions (answered before building)
1. BUTTON STYLE — do you want the admin buttons to EXACTLY match the public site
   (rounded-FULL pill, UPPERCASE, bold, orange primary / green secondary), or keep the
   admin's slightly-rounded corners + normal case but just make them all SOLID (no
   transparency)? (I lean toward: solid fills everywhere, keep admin's rounded corners &
   sentence case for readability of a data-dense back office, orange/green/gold/red intents.)
2. SECONDARY buttons — today `subtle` (Cancel etc.) is a bordered neutral. You dislike
   transparent. Should secondary become a SOLID dark-gray fill (still clearly secondary),
   with orange=primary, green=confirm/publish, gold=save, red=danger?
3. SCAN-TO-EXCEL — confirm the round trip: (a) filter inventory list → (b) export to .xlsx
   with a "Counted Qty" column → (c) you scan/type counts in Excel → (d) upload the .xlsx →
   (e) preview/validation table → (f) approve → it fills the OPEN cycle count. Correct?
4. VENDOR ACH guardrail — confirm exact rule: a payment MUST be linked to an invoice whose
   status = accepted, AND payment amount cannot exceed invoice balance (overpay block) and
   should warn/require confirmation on underpay (partial). Is partial payment ALLOWED
   (with confirmation) or BLOCKED?
5. BLOG GPT-4o — should the AI SUGGEST topic ideas/headlines/trends (drafts you then write),
   or also DRAFT full posts? (Standing rule: AI output = drafts only. I'll gate it as
   draft-only regardless.) Any specific local demographic notes beyond "Port Orchard / Kitsap
   County, WA"?
