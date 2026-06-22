# Greenway Marijuana Content Replacement Roadmap

Prepared for the Greenway Marijuana Next.js website project. This roadmap translates the public research findings into a safe, professional implementation plan for replacing placeholder, dummy, and generic website content with verified Greenway-specific content. It is designed to protect the current project architecture, avoid accidental breakage, and make future content updates easier for the Greenway team.

## Executive implementation summary

The Greenway site should not be updated by hunting through the codebase and replacing every visible sentence directly inside React components. That approach is fast in the short term, but it creates long-term risk because business facts, marketing copy, compliance disclaimers, FAQ answers, menu assumptions, and promotional claims become scattered across unrelated UI files. When a phone number, address, hour, policy, special, or service detail changes later, the team would have to remember every place where the same information was duplicated. That is exactly how websites accumulate stale information.

The professional approach is to create a centralized content layer inside the project, then have pages and components render from that layer. In this project, the best fit is a small typed content system under `src/content` or `src/data`. The site is already organized with route pages under `src/app`, feature components under `src/components`, and menu-related logic under `src/lib/leafly`. That is a good foundation. The roadmap below keeps that structure intact while moving replaceable facts and copy into purpose-built modules such as `src/content/business.ts`, `src/content/home.ts`, `src/content/faq.ts`, `src/content/specials.ts`, `src/content/locations.ts`, `src/content/partners.ts`, and `src/content/compliance.ts`.

The immediate priority should be to centralize confirmed business facts first: public brand name, address, phone number, email, hours, social links, map/directions URLs, age/compliance notices, and core brand positioning. Those values appear across the header, footer, homepage, location page, FAQ, contact-style content, metadata, sitemap-related output, and potentially structured data in the future. Once those canonical facts are in one typed module, the team can safely update each visual component one at a time without changing routing, data fetching, cart behavior, checkout logic, age gate behavior, or the Leafly integration boundary.

## Guiding principles

The first principle is to separate content from presentation. React components should own layout, spacing, responsive behavior, interaction, accessibility, and visual hierarchy. Content modules should own business facts, copy, labels, lists, FAQ entries, and disclaimers. For example, a header component can decide that the phone number appears in a black pill on the green secondary bar, but the actual display number and `tel:` URL should come from a canonical business profile module.

The second principle is to separate verified permanent facts from time-sensitive operational data. The store address, phone number, email, and general hours can live in durable content modules. Live menu inventory, product availability, product prices, product counts, product images, and limited-time deals should either come from the menu provider or from clearly named temporary promotional modules. Marketplace snapshots from Leafly, Weedmaps, or directories should not be hardcoded as permanent claims because they can change daily.

The third principle is to treat compliance-sensitive copy as first-class content. Any cannabis website copy that discusses age restrictions, health claims, medical effects, product effects, delivery, promotions, discounts, price matching, privacy, consumer health data, and purchase requirements should be centralized and reviewed carefully. Components should render approved disclaimers instead of inventing local wording.

The fourth principle is to migrate in small, verifiable passes. The team should not replace every placeholder at once. Each pass should touch a narrow content area, run lint/build checks, and visually inspect the affected pages on mobile and desktop. This protects the existing working infrastructure, especially the global header, age gate, cart provider, checkout pages, dynamic menu product pages, and policy pages.

## Current project structure and content risk map

The project uses the Next.js App Router under `src/app`. Public routes currently include homepage, about, blog, FAQ, locations, loyalty, menu, dynamic menu product pages, price match, privacy policy, specials, terms of use, vendor delivery, checkout, checkout confirmation, consumer health data, and an admin loyalty signups page. This route organization should remain unchanged unless there is a later strategic reason to restructure site navigation.

The most important content-bearing files and directories identified during inspection are:

- `src/app/layout.tsx`, which controls global metadata and mounts global providers and site-wide UI.
- `src/app/page.tsx`, `src/app/about/page.tsx`, `src/app/faq/page.tsx`, `src/app/locations/page.tsx`, `src/app/specials/page.tsx`, `src/app/loyalty/page.tsx`, `src/app/price-match/page.tsx`, `src/app/vendor-delivery/page.tsx`, `src/app/blog/page.tsx`, and policy route files.
- `src/components/site/SecondaryBar.tsx`, which currently contains visible address, hours, and phone content.
- `src/components/site/navigation-data.ts`, which controls shared navigation labels and routes.
- `src/components/home/Hero.tsx`, `src/components/home/PromoGrid.tsx`, and `src/components/home/StoreVisit.tsx`, which likely contain homepage-specific marketing and visit-planning content.
- `src/components/about/AboutPreview.tsx`, which likely contains preview copy for the About page or homepage About section.
- `src/components/faq/FaqPreview.tsx`, which likely contains FAQ preview content.
- `src/components/specials/SpecialsPreview.tsx`, which likely contains placeholder specials/promotional content.
- `src/components/location/location-preview-data.ts`, which likely contains location preview data.
- `src/components/blog/blog-preview-data.ts`, which likely contains placeholder blog/article cards.
- `src/components/policies/policy-preview-data.ts`, which likely contains policy preview data.
- `src/lib/leafly/mock-menu.ts`, `src/lib/leafly/client.ts`, and `src/lib/leafly/types.ts`, which define the current menu integration boundary and fallback/mock product data.

The highest risk areas are policy pages, checkout, cart/menu logic, dynamic product pages, and any provider/integration code. These should not be casually rewritten during content replacement. The safest first wave is business facts, homepage marketing copy, about copy, location copy, FAQ content, and global navigation labels. Menu and checkout content should be updated only after the business content layer is stable.

## Recommended content architecture

Create a new `src/content` directory to hold approved Greenway content. This keeps content distinct from visual components and avoids mixing verified business copy into low-level UI files. If the team prefers `src/data`, that is also acceptable, but `src/content` is more descriptive for copy-heavy site material.

Recommended initial files:

```text
src/content/
  business.ts
  brand.ts
  home.ts
  about.ts
  locations.ts
  faq.ts
  specials.ts
  loyalty.ts
  partners.ts
  compliance.ts
  policies.ts
  blog.ts
  index.ts
```

`src/content/business.ts` should be the canonical source for durable business facts. It should export a typed object such as `greenwayBusiness` containing the public brand name, legal or legacy display variants if needed, street address, city, state, ZIP, formatted full address, phone display value, `tel:` value, email, public hours, social links, and map/directions URLs. The current verified values from the research report are: Greenway Marijuana as the recommended public brand name, 4851 Geiger Rd SE, Port Orchard, WA 98367, phone `(360) 443-6988` or `360-443-6988` for display depending on context, `+13604436988` for machine-readable telephone links, `contact@greenwaymarijuana.com`, and daily hours of 8:00 am to 11:00 pm.

`src/content/brand.ts` should hold the core voice and messaging pillars. This can include the safe-haven concept from the official site, the anti-nonsense positioning, the budget-friendly customer guidance message, the staff-led education promise, and approved tagline options such as “Kitsap’s Finest” and “Bringing Class to Smoking Grass.” Because some taglines can feel casual or legacy, this file should allow the team to decide which phrases are approved for the new site before they are used in prominent hero placements.

`src/content/home.ts` should hold homepage sections such as hero eyebrow, headline, subheadline, primary calls to action, promotional cards, store visit highlights, and trust/support statements. It should import canonical facts from `business.ts` where needed instead of repeating phone, address, or hours.

`src/content/about.ts` should hold the long-form About page narrative, short about preview, staff/service values, accessibility and amenity highlights, and the verified origin-style language from the current official website. This is where the site can preserve the approachable local personality while cleaning up the grammar and structure.

`src/content/locations.ts` should hold location page content. Even if Greenway currently has one public Port Orchard location, the data should be shaped as an array of locations. That future-proofs the site and avoids naming files or components in a way that assumes only one store forever. A single-location array is also useful for structured data and map components.

`src/content/faq.ts` should hold approved FAQ entries. Each FAQ item should have an `id`, `question`, `answer`, and optional `category`. Categories might include “Shopping at Greenway,” “Ordering and pickup,” “Payment and pricing,” “Cannabis basics,” “Accessibility,” and “Policies.” FAQ answers should be reviewed for compliance and should avoid making medical claims.

`src/content/specials.ts` should distinguish between evergreen promotional concepts and active limited-time offers. For example, “Daily & Weekly Specials” and “Happy Hour specials” are supported by the official site, but exact discount amounts, times, or product-specific offers should not be hardcoded unless ownership approves them and there is a maintenance process. If specials are operationally volatile, this file should provide general landing-page copy and CTA labels rather than pretending to be a live deals engine.

`src/content/partners.ts` should hold verified partner/vendor names only after the current partner list is approved. The official site has a Partners page, but any vendor roster can become outdated. The roadmap recommends creating a structured partner list only after Greenway confirms which brands should be promoted.

`src/content/compliance.ts` should hold age-gate text, cannabis purchase disclaimers, responsible-use notices, Washington-state compliance notes, health-claim guardrails, and standard footer disclaimers. This file should be reviewed before launch. The site should not scatter compliance text across hero components, product pages, checkout pages, and policy pages.

`src/content/policies.ts` should hold links and summaries for privacy policy, terms of use, consumer health data, vendor delivery, price match, and other policy-like pages. Full legal policies may remain in route files or separate Markdown/MDX files if they are long, but route metadata, summaries, and navigation cards should be centralized.

`src/content/blog.ts` should replace generic blog preview data. The first release can use a small set of planned article ideas rather than publishing unapproved blog posts. Example topic categories could include first-time shopping guidance, how to read a cannabis menu, staff picks if legally acceptable, product category education, Washington purchase rules, and Greenway community updates. Articles should not be published as factual medical advice.

`src/content/index.ts` should re-export the approved modules so components can import from a consistent path. This keeps imports clean and makes content discoverability easier for future developers.

## TypeScript standards for safe content

Use TypeScript types or `as const` objects to make content predictable. The team does not need a heavy CMS to do this correctly. A simple typed content layer is enough for the current project.

A recommended `business.ts` shape is:

```ts
export const greenwayBusiness = {
  name: "Greenway Marijuana",
  legacyName: "Green Way Marijuana",
  taglineOptions: ["Kitsap's Finest", "Bringing Class to Smoking Grass"],
  phone: {
    display: "360-443-6988",
    formatted: "(360) 443-6988",
    tel: "+13604436988",
  },
  email: "contact@greenwaymarijuana.com",
  address: {
    line1: "4851 Geiger Rd SE",
    city: "Port Orchard",
    state: "WA",
    postalCode: "98367",
    country: "US",
  },
  hours: {
    short: "Mon-Sun 8am-11pm",
    display: "Open daily, 8:00 am to 11:00 pm",
    weekly: [
      { day: "Monday", opens: "8:00 AM", closes: "11:00 PM" },
      { day: "Tuesday", opens: "8:00 AM", closes: "11:00 PM" },
      { day: "Wednesday", opens: "8:00 AM", closes: "11:00 PM" },
      { day: "Thursday", opens: "8:00 AM", closes: "11:00 PM" },
      { day: "Friday", opens: "8:00 AM", closes: "11:00 PM" },
      { day: "Saturday", opens: "8:00 AM", closes: "11:00 PM" },
      { day: "Sunday", opens: "8:00 AM", closes: "11:00 PM" },
    ],
  },
  social: {
    instagram: "https://www.instagram.com/greenwaymarijuana/",
    twitter: "https://twitter.com/GWMarijuana?lang=en",
  },
} as const;
```

The exact implementation can vary, but the principle is important: one canonical source should feed the header, footer, locations page, metadata, structured data, and contact CTAs. If the address or phone changes, one file should be updated.

## Recommended staged migration plan

### Phase 1: Prepare the content foundation

Create `src/content` and add `business.ts`, `brand.ts`, `compliance.ts`, and `index.ts`. Do not change many UI components during this first commit. The goal is simply to establish the pattern and make sure the project compiles.

Populate `business.ts` with only high-confidence facts confirmed in the research report. Add source comments above fields that are likely to be questioned later, but avoid turning the file into a research document. The full source explanation already belongs in `docs/greenway-marijuana-research-report.md`.

Populate `brand.ts` with approved messaging pillars, but mark any uncertain tagline or campaign line as pending approval. For example, “Kitsap’s Finest” and “Bringing Class to Smoking Grass” are sourced from the current official website, but the ownership team should decide if both still fit the new brand tone.

Populate `compliance.ts` with conservative, reusable cannabis disclaimers and age-gate support copy. Keep this copy simple until legal/compliance review is complete.

Run `npm run lint` and `npm run build` after adding the modules. This phase should not alter the visual site yet.

### Phase 2: Connect global business facts

Update `src/components/site/SecondaryBar.tsx` to import phone, `tel:`, address, and hours from `src/content/business.ts`. The current header layout and responsive sizing should remain unchanged because the user already approved the current mobile balance. Only replace hardcoded strings with imported values.

Update footer or global contact components if present. If the footer has address, phone, email, hours, social links, or navigation descriptions, wire them to `business.ts` as well.

Update `src/app/layout.tsx` metadata to use canonical brand metadata from content where appropriate, or at minimum align it with the approved name and description. Because Next.js metadata is server-side and can import plain TypeScript constants, this is safe as long as the content module has no browser-only logic.

After these changes, run lint/build and inspect the header/footer on mobile and desktop. The acceptance criteria for this phase are that the address pill still links to `/locations`, the phone pill still uses `tel:+13604436988`, the visual pill sizing is unchanged, and all visible business facts match the research report.

### Phase 3: Replace homepage placeholder content

Update homepage content in `src/components/home/Hero.tsx`, `src/components/home/PromoGrid.tsx`, `src/components/home/StoreVisit.tsx`, and any related homepage section components. These should render from `src/content/home.ts` and `src/content/brand.ts`.

Recommended homepage message hierarchy:

The hero should position Greenway as a Port Orchard recreational cannabis dispensary with friendly staff, daily 8am-11pm hours, online menu access, and budget-conscious help. The hero should avoid overclaiming “best,” “cheapest,” or product-specific effects unless legally reviewed. A safe headline direction would be something like “Port Orchard cannabis, friendly guidance, and deals every day.” Supporting copy can draw from the official safe-haven language while sounding more polished.

Promotional cards should use verified themes: daily and weekly specials, happy hour specials, online menu/browse inventory, staff guidance, convenient Port Orchard location, ATM on-site, dog friendly, and ADA accessible. Exact discount amounts should remain absent unless approved.

Store visit content should include address, hours, directions CTA, call CTA, and first-time-customer reassurance. If the current site has map embeds or directions buttons, use the canonical address from `business.ts`.

Acceptance criteria for this phase are that the homepage no longer reads like a generic dispensary template, all claims are grounded in the research report, and no menu/product availability is hardcoded into homepage copy.

### Phase 4: Replace About and brand story content

Update `src/app/about/page.tsx` and `src/components/about/AboutPreview.tsx` to render from `src/content/about.ts`. The About page should preserve the authentic Greenway tone from the official site while improving readability and professionalism.

The recommended About page structure is: introduction, Greenway’s customer promise, staff guidance, budget-friendly shopping, product selection overview, accessibility/amenity highlights, community/local positioning, and calls to browse the menu or visit the Port Orchard store.

Avoid claiming specific founding dates, ownership details, awards, exact staff credentials, or community programs unless Greenway provides them. The public research found strong language about the team’s passion and legal-cannabis background, but it did not verify a detailed company history. Treat any deeper company story as owner-supplied content to be added later.

### Phase 5: Replace Locations content

Update `src/app/locations/page.tsx` and `src/components/location/location-preview-data.ts` to render from `src/content/locations.ts`. Even with one store, model the content as a list of locations.

Location content should include the official address, daily hours, phone, email, directions CTA, call CTA, amenities, and brief visit-planning copy. Include accessibility and dog-friendly notes only if ownership confirms they remain accurate; they are present on the official About page, so they are valid candidates but should still be confirmed before prominent display.

If adding structured data later, use the location content module as the source of truth. Do not duplicate address and hours inside JSON-LD by hand without importing the same constants.

### Phase 6: Replace FAQ content

Update `src/app/faq/page.tsx` and `src/components/faq/FaqPreview.tsx` to render from `src/content/faq.ts`. The current official FAQ page contains contact/location/hours blocks and likely general site sections, but the new FAQ should be expanded strategically.

Recommended FAQ categories include: shopping basics, first-time visitors, online ordering, pickup, payment, deals and specials, accessibility, age requirements, product questions, and account/loyalty if relevant. Any answer about legal purchase limits, accepted IDs, medical use, returns, product effects, or delivery should be reviewed before launch.

Do not fabricate policies. If the team does not know whether debit cards, cashless ATM, Dutchie Pay, returns, exchanges, curbside pickup, or delivery are supported, leave those out or mark them as pending business confirmation.

### Phase 7: Replace Specials, Loyalty, and Price Match content

Update `src/app/specials/page.tsx`, `src/components/specials/SpecialsPreview.tsx`, `src/app/loyalty/page.tsx`, and `src/app/price-match/page.tsx` after core business pages are stable.

Specials should use broad verified language unless the team has a live promotion-management process. The official site supports the existence of daily and weekly specials and happy hour specials, but it does not provide enough stable detail in the research extract to hardcode exact discount schedules.

Loyalty and price-match pages are operationally sensitive. They should contain only approved program rules. If the current placeholders describe generic rewards or price-match promises, replace them with “program details coming soon” style copy or owner-approved rules rather than publishing assumptions.

### Phase 8: Replace Blog preview and educational content

Update `src/components/blog/blog-preview-data.ts` and `src/app/blog/page.tsx` to remove generic placeholder posts. The safer professional approach is to create planned article cards or draft-status content until real articles are written.

Suggested article directions include first-time dispensary visit guidance, how to browse a cannabis menu, understanding flower/pre-roll/edible/concentrate categories, what to bring to a Washington dispensary, how Greenway staff can help customers shop by budget, and how to find current deals. Avoid publishing product-effect claims as medical advice.

If the site will eventually have full blog posts, consider using MDX or a small content collection pattern later. For now, typed preview data is enough.

### Phase 9: Review menu and mock inventory boundaries

Do not treat `src/lib/leafly/mock-menu.ts` as marketing content. It appears to be a fallback or mock data source for menu/product functionality. Changing it casually could affect product listing pages, product detail pages, cart assumptions, checkout UI, or development behavior.

If Greenway wants live menu content, the proper path is to finish or validate the Leafly integration using `src/lib/leafly/client.ts` and `src/lib/leafly/types.ts`, then limit mock data to development fallback states. The existing `docs/LEAFLY_INTEGRATION_PLAN.md` should be reviewed before making menu architecture changes.

Any mock product data that appears publicly should be clearly replaced with either live provider data or approved sample-disabled states. Product names, potencies, prices, images, and availability should not be invented.

### Phase 10: Replace policy preview content carefully

Update `src/components/policies/policy-preview-data.ts` only after reviewing the actual policy pages: privacy policy, terms of use, consumer health data, vendor delivery, and any other compliance or legal route. Policy summaries should not conflict with full policy text.

If legal policy text is placeholder or generic, the team should obtain approved policy language rather than relying on generated copy. The website can still centralize policy titles, descriptions, and navigation cards, but full legal content should be reviewed by the appropriate responsible party.

## Page-by-page content replacement checklist

Homepage should use Greenway-specific hero copy, verified CTAs, current hours, Port Orchard location language, staff-guidance messaging, and real specials/visit-planning themes.

About should use the official safe-haven positioning, anti-nonsense phrasing if approved, staff education/helpfulness, budget support, product category overview, and local Port Orchard/Kitsap identity.

Locations should use the verified address, phone, email, hours, amenity list, map/directions CTA, and concise visit instructions.

FAQ should use only approved operational answers and avoid unsupported assumptions about payment, delivery, returns, medical claims, or product effects.

Menu should clearly separate live provider data from mock/fallback data. It should not contain invented Greenway inventory.

Specials should promote daily/weekly specials and happy hour only at a level the team can maintain accurately.

Loyalty should publish only confirmed program mechanics. If not ready, use a lead-capture or “ask staff” style message.

Price Match should publish only confirmed price-match rules, exclusions, required proof, and staff discretion language.

Vendor Delivery should be treated as operational/policy content and verified with the business before publication.

Blog should use approved educational or community topics and avoid medical claims.

Privacy, terms, and consumer health data pages should be reviewed as policy/legal documents, not marketing pages.

Navigation should remain simple and should point to real, useful pages. Avoid adding menu items for incomplete content unless the page has a clear purpose.

## Source-to-content mapping

Use the official Greenway website as the source of truth for identity, contact facts, broad brand language, amenities, and social links. Use Leafly and Weedmaps as supporting sources for marketplace presence, public category expectations, and review themes. Use Yahoo Local and MapQuest as corroboration for address, phone, hours, and customer-service themes. Use AllBud only as historical/lower-confidence background because its hours and ZIP/address presentation conflict with the stronger sources.

The current official safe-haven copy should map to homepage hero subcopy, About introduction, first-time visitor reassurance, and staff-guidance cards. The official daily/weekly specials and happy-hour references should map to Specials overview copy and homepage promo cards. The official ATM, dog-friendly, and ADA-accessible claims should map to location amenities after owner confirmation. The third-party review themes about friendly staff, knowledgeable help, good deals, large selection, fair prices, and convenient access should map to testimonial-style positioning, but direct review quotes should not be published unless permission and source formatting are handled properly.

## Quality assurance workflow

Each migration phase should follow the same QA process. First, make a narrow content change. Second, run TypeScript/lint checks. Third, run a production build. Fourth, visually inspect the affected pages on mobile and desktop. Fifth, check the main CTAs: phone links, directions links, menu links, location links, specials links, and age-gate behavior. Sixth, review the page text for unsupported claims and stale facts.

Recommended commands from the project directory are:

```bash
npm run lint
npm run build
```

If the project has additional formatting or test commands later, add them to this QA sequence. If a command fails, fix the failure before moving to the next content area. Do not keep replacing content on top of a failing build because that makes debugging harder.

## Approval workflow

Before implementation, Greenway should approve a canonical content packet. That packet should include the business name spelling, tagline selection, official address, phone display style, email, hours, social links, amenity list, accepted payment methods, loyalty rules, price-match rules, specials rules, FAQ answers, and any compliance disclaimers.

During implementation, developers should avoid deciding business rules from memory. If something is not in the approved packet or the research report, it should be marked `TODO: confirm with Greenway` in the content module or omitted from the public page.

After implementation, the team should perform a final editorial pass in the browser rather than only reading source files. Website copy often feels different once it appears in real layout, especially on mobile. The prior header work showed that mobile visual review is essential for this project.

## Recommended first implementation commit

The first implementation commit after this roadmap should be intentionally small. It should add the content directory, create `business.ts`, export it through `index.ts`, and update `SecondaryBar.tsx` to consume the business constants without changing the approved visual design. That commit proves the content architecture works while touching only one already-reviewed global component.

The second commit should update footer/global metadata. The third should update homepage content. The fourth should update About and Locations. Later commits should handle FAQ, Specials, Loyalty, Blog, and policy previews.

This order matters because the business facts are the most reused content, and the header/footer are visible everywhere. Once those are stable, the team can safely improve page-by-page storytelling.

## Final architecture target

At the end of the content replacement project, the site should have a clear separation between routes, components, content, integrations, and policy/legal text. Route files in `src/app` should assemble pages and metadata. Components in `src/components` should render reusable UI. Content modules in `src/content` should provide verified Greenway facts, copy, lists, FAQs, and page sections. Integration code in `src/lib/leafly` should handle menu data and should remain separate from static brand copy. Documentation in `docs` should preserve research, source notes, and implementation plans.

This architecture will let Greenway update content professionally without damaging infrastructure. It also creates a cleaner path for future improvements such as live menu integration, structured local-business SEO data, richer FAQ pages, landing pages for specials, improved blog content, analytics event tracking, and eventual CMS migration if the business wants non-developers to edit content directly.

## Launch readiness checklist

Before replacing the old site or publishing the new content broadly, confirm that every public page has Greenway-specific copy, every visible business fact matches the approved canonical content module, every phone link uses `tel:+13604436988`, every address/directions link points to the correct Port Orchard location, every compliance-sensitive statement has been reviewed, no placeholder product inventory is presented as real inventory, no unapproved promotion rules are published, metadata titles and descriptions are Greenway-specific, mobile header/footer layouts remain balanced, and `npm run lint && npm run build` passes.

The final result should feel like Greenway: local, friendly, knowledgeable, approachable, budget-aware, and convenient, while still being built like a professional modern web application with maintainable content boundaries and safe implementation practices.
