# Greenway Marijuana Research Report

Prepared for the Greenway Marijuana website replacement project. This report is based on publicly accessible sources reviewed during the site planning session and is intended to guide replacement of placeholder content with verified Greenway-specific content. It is not legal advice, compliance approval, inventory certification, or final marketing approval.

## Executive summary

Greenway Marijuana is a recreational cannabis dispensary in Port Orchard, Washington, operating publicly as Greenway Marijuana or Green Way Marijuana. The most reliable public source is the current official website at `greenwaymarijuana.com`, which consistently lists the store at 4851 Geiger Rd SE, Port Orchard, WA 98367, with phone number (360) 443-6988, email address contact@greenwaymarijuana.com, and daily hours of 8:00 am to 11:00 pm. Major third-party profiles, especially Leafly, Weedmaps, Yahoo Local, and MapQuest, corroborate the core address, phone, and daily 8am–11pm hours. AllBud contains useful historical positioning language but conflicts with the current address ZIP and hours, so it should be treated as lower-confidence and likely outdated.

The brand identity that appears consistently across the official website and public review ecosystem is approachable, budget-conscious, friendly, and staff-led. Greenway describes itself as a “safe haven” where customers can ask questions, get honest help, stay within budget, and find the best product for the occasion. The official About page uses phrases including “Kitsap’s Finest,” “Daily & Weekly Specials,” “Happy Hour specials,” “ATM On-Site,” “Dog Friendly,” “ADA Accessible,” and “Bringing Class to Smoking Grass.” Public review snippets repeatedly emphasize friendly and knowledgeable staff, good deals, large selection, fair prices, strong customer service, convenient Highway 16 access, and a comfortable local-shop feel.

For the replacement website, the safest professional approach is to create a centralized content layer for verified store facts, brand copy, FAQ answers, vendor/partner lists, locations, specials metadata, compliance disclaimers, and future blog/article data. The current Next.js project already separates route pages from feature components, but many content strings are still embedded directly inside components. Rather than replacing dummy text piecemeal, Greenway should move approved content into typed modules under `src/content` or `src/data`, then have UI components render those records. This reduces breakage risk, makes future edits safer, keeps preview/mock inventory clearly separate from verified content, and prevents accidental publication of unapproved policy, legal, inventory, or promotion claims.

## Source hierarchy and confidence model

The source hierarchy used for this report is straightforward. Official Greenway pages are treated as highest confidence for business identity, contact details, broad brand messaging, current address, hours, social links, and self-described amenities. Leafly and Weedmaps are strong secondary sources for public menu/category presence, third-party review themes, listing metadata, and cannabis marketplace details, but their product counts and update timestamps are time-sensitive and should not be hardcoded as permanent website claims. Yahoo Local and MapQuest are supporting directory sources that corroborate address, phone, hours, and Yelp-fed review snippets. AllBud is a lower-confidence historical directory source because it showed an older ZIP/address presentation and hours that conflict with the official site and other current directories.

Google reviews were requested, but direct Google review scraping was not available through the accessible public extraction flow in this environment. The report therefore does not invent Google review counts or quote unavailable Google review text. Review insights are drawn only from accessible public pages: Leafly, Weedmaps, Yahoo Local/Yelp-fed snippets, MapQuest/Yelp count, and AllBud.

## Confirmed business facts

The official public business name appears as both “Greenway Marijuana” and “Green Way Marijuana.” The current website title and many third-party listings use “Greenway Marijuana,” while the WordPress page title/logo text uses “Green Way Marijuana.” For the new site, the recommended public brand name is “Greenway Marijuana,” with “Green Way Marijuana” treated as legacy/logo spelling unless the ownership team chooses otherwise.

The confirmed public address is 4851 Geiger Rd SE, Port Orchard, WA 98367. This address is listed on the official Contact page, official site footer, Leafly, Weedmaps, Yahoo Local, and MapQuest. The current project header has already been updated to use “4851 Geiger Rd SE” and “Port Orchard, WA 98367,” which aligns with the strongest sources.

The confirmed public phone number is (360) 443-6988. The current site displays it as 360.443.6988 and as (360) 443-6988 in different places; Leafly, Weedmaps, Yahoo Local, and MapQuest also list the same phone number. For code and click-to-call links, the recommended canonical machine-readable phone value is `+13604436988`, while the visible display should remain `(360) 443-6988` or `360-443-6988` depending on design context.

The confirmed public email is contact@greenwaymarijuana.com. It appears on the official homepage, footer, Contact page, and FAQ footer/contact block. Third-party pages often expose “send an email” rather than the exact address, so the official website is the source of truth for this field.

The confirmed public hours are Monday through Sunday, 8:00 am to 11:00 pm. The official Contact and FAQ pages list “Mon-Sun: 8:00 am – 11:00 pm.” Leafly lists 8am–11pm for every day. Weedmaps lists open today 8:00 AM–11:00 PM. Yahoo Local lists every day 8:00 AM–11:00 PM. MapQuest lists every day 8 am–11 pm. AllBud lists 9am–10pm on most days and Sunday 10am–9pm, but because this conflicts with the official site and multiple other current sources, AllBud hours should not be used for production content.

The official social links found on the current website are X/Twitter at `https://twitter.com/GWMarijuana?lang=en` and Instagram at `https://www.instagram.com/greenwaymarijuana/`. These should be verified by ownership before being promoted heavily, but they are present on the official website and are therefore usable as source-listed social links.

## Official website content and brand positioning

The official homepage opens with “Welcome To GreenWay Marijuana” and a strong positioning paragraph: “We are a safe haven. Come to us with questions – we will answer them. We are here to make sure that your cannabis-consuming experience is nothing but the best. We aren’t perfect, but we strive to be the standout among the masses. We are anti-nonsense. Our goal is to get you the best product for any occasion. Have a budget? We’ll meet it. Our friendly staff members will walk you through every step of the process and answer any question they can.” This is the clearest official brand voice and should become the backbone for the new About section, homepage hero subcopy, staff-guidance messaging, and first-visit customer support content.

The official About page adds “Kitsap’s Finest” and describes product categories as “Cannabis & Cannabis-Infused Products Glassware, Vaporizers, Accessories.” It highlights “Daily & Weekly Specials,” “Happy Hour specials,” “ATM On-Site,” “Dog Friendly,” and “ADA Accessible.” It also uses the tagline “Bringing Class to Smoking Grass.” The longer About copy repeats the safe-haven positioning and adds that the team is “passionate,” connected to the front-line struggle to legalize and regulate cannabis, committed to quality cannabis for all, and open to product requests from customers.

The official Contact page repeats the safe-haven copy, includes a contact form, and lists contact details: phone, email, daily hours, and address. This should map directly into a new Contact or Locations content module.

The official FAQ page contains a useful compliance-oriented foundation. It explains who can buy cannabis, valid forms of ID, recreational purchase limits, personal possession limits, medical patient differences, public/private consumption guidance, prohibition against taking I-502 products out of state, return limitations, and how to talk to a budtender. Some FAQ content references older dates and return-policy language from 2016, so it should be reviewed and updated before being published verbatim. However, the structure is very valuable: it gives Greenway a legitimate customer education page instead of generic filler.

The official Partners page lists vendor/partner names, including Falcanna, 1-Up Farms/Green Genesis, Heavenly Buds, Mad Mark Farms, Caviar Gold, Phat Panda, Fireline Cannabis, Solstice Cannabis, Oleum Labs, Top Shelf, Millennium Extracts, Optimum Extracts, Emerald Evolution, t.h.sea, Rootworx LLC, Hazy Daze, Buddy Boy Farms, Omshiv, Avitas, Silica Phoenix Company, Northwest Cannabis Solutions, Spot Edibles, Zoots, Ethos, Fairwinds, Mirth, Emerald Peaks, Craft Elixirs, NW Wonderland, Goodship Co., Mary’s Medicinals, Oakor, Prohibitions Brands, and Bellingham Bud Co. This list should be verified against current vendor relationships before production publication, because vendor rosters often change.

## Third-party listing intelligence

Leafly lists Greenway Marijuana as a recreational dispensary in Port Orchard, WA, with a 4.5 rating and 67 shown near the top of the listing at the time of review. The listing showed 476 products and a recent update timestamp, but this should be treated as time-sensitive marketplace data rather than permanent copy. Leafly categories included flower, concentrate, edible, cartridge, pre-roll, topical, and accessory. Leafly’s About section says Greenway is “passionate about making cannabis accessible, enjoyable, and affordable for everyone,” located in Port Orchard, with a wide selection of high-quality products at competitive prices and friendly, knowledgeable staff. Leafly also mentions proximity to Highway 16 and a short drive from Gig Harbor, the Key Peninsula, Bremerton, and Silverdale. It includes a useful inventory-accuracy disclaimer: inventory changes constantly, menus are kept current as best as possible, and customers can call the shop to confirm what is on hand.

Leafly listing details include “Leafly member since 2014,” followers count of 289 at the time of scraping, cash payment, license 413541, and amenities/attributes including ATM, storefront, ADA accessible, veteran discount, and recreational. Leafly hours show 8am–11pm every day. Pickup info showed same-day and cash. Review scoring showed 4.5 overall in the ratings/reviews area, with quality 4.6, service 4.5, and atmosphere 4.5. Review snippets strongly support copy themes around customer service, deals, prices, knowledgeable staff, selection, and a welcoming atmosphere.

Weedmaps lists Greenway Marijuana as a recreational dispensary with in-store purchases only, open 8:00 AM–11:00 PM, 4.3 rating, and 13 reviews. Weedmaps listed the address as 4851 Geiger Rd, Port Orchard, Washington 98367 and phone as (360) 443-6988. It listed categories including Flower, Pre-rolls, Vape pens, Concentrates, Edibles, Drinks, and Wellness, with 117 products updated 6 days ago at the time of scraping. Weedmaps amenities included Accessible, Age minimum, and ATM. Review snippets include praise for a welcoming feel, product knowledge, great people, great prices, strong product quality, favorite dispensary status, and Kitsap County positioning. Weedmaps also includes negative historical reviews, so the new site should not cherry-pick review claims in a way that implies universal satisfaction; instead it should use broader source-backed themes.

Yahoo Local lists Greenway Marijuana as a cannabis dispensary with 4.0 from 16 Yelp-fed reviews. It confirms the phone, address, daily 8:00 AM–11:00 PM hours, and cross streets near Geiger Rd SE and SE Sedgwick Rd. The Yahoo business description says Greenway is an I-502 legal recreational cannabis retailer selling high-quality cannabis products in a variety of strains and quantities, including edible products, plus reasonably priced glassware. It says cannabis products are grown organically by professional producers and tested for quality by licensed facilities. Because this description is sourced through a directory/Yelp context rather than current official copy, its “organically grown” wording should be verified before reuse.

MapQuest confirms Greenway Marijuana at 4851 Geiger Rd SE, Port Orchard, WA 98367, lists daily 8am–11pm hours, links to the official website, and shows a Yelp review count of 16. It lists “Cash” under features. MapQuest is useful corroboration for address/hours but does not provide much brand content.

AllBud lists “Greenway” with a 4.3 score, 28 votes, and 14 reviews. It describes the business as recreational, storefront, and ATM, and includes historical language: “Kitsap's Finest! Lowest prices, friendly and knowledgeable staff, and a huge selection!” It also says Greenway strives to go above and beyond, give back through taxes to help build schools and educate the public, and maintain an ethical, respectable, comfortable shopping environment. This language may be valuable as historical brand sentiment, but AllBud also lists the address as 4851 Geiger Rd SE PO Box 965, Port Orchard, WA 98366 and hours that conflict with official/current sources. Therefore, AllBud should be used only as a low-confidence historical reference unless Greenway manually confirms the details.

## Review themes and reputation signals

Accessible review ecosystems show several positive themes. Customers repeatedly mention friendly staff, knowledgeable budtenders, helpful recommendations, strong selection, good prices, daily deals, senior or military discounts, convenient location, clean or modern shop feel, and a comfortable atmosphere. Leafly’s 2025 and 2024 snippets include “Outstanding staff and excellent customer service,” “awesome deals,” “special discounts for seniors and military,” “Greenway is always awesome,” “Awesome prices, and great customer service,” and “Prices and quality are on point.” Older Leafly snippets describe Greenway as “best little weed store in Port Orchard,” “great staff, modern layout and a product for every budget,” “friendly staff who care,” “great deals everyday,” “lots of inventory,” “clean shop,” “friendly staff,” and “easy transaction.”

Weedmaps review snippets reinforce similar themes: “welcomed,” “knowledge on all the product was on point,” “great people,” “great prices,” “great product,” “favorite dispensary in Kitsap County,” “awesome environment,” “incredible management,” “low pricing,” “great location right off HWY 16,” and “daily 420 happy hr.” Yahoo/Yelp-fed snippets mention large selection, friendly and knowledgeable budtenders, weekend discounts, value for money, and strong ownership.

The review ecosystem also contains critical reviews, mostly older, related to returns, product issues, inconsistent pricing perceptions, pickup processing, and customer-service breakdowns. These should not be ignored internally. For public site copy, the lesson is to avoid overpromising return policies, live ordering guarantees, inventory accuracy, or price-match behavior unless operational workflows are confirmed. The website should include clear, accurate disclaimers: inventory may change, final eligibility and pricing are confirmed in store/POS, cannabis purchase limits apply, and returns/exchanges follow store policy and Washington rules.

## Product, menu, and category intelligence

Public marketplaces show Greenway carries or has carried a broad recreational cannabis catalog. The most consistently supported categories are flower, pre-rolls, vape cartridges/pens, concentrates, edibles, topicals/wellness, drinks, and accessories/glassware. The official About page explicitly mentions cannabis and cannabis-infused products, glassware, vaporizers, and accessories. Leafly’s current categories include flower, concentrate, edible, cartridge, pre-roll, topical, and accessory. Weedmaps includes flower, pre-rolls, vape pens, concentrates, edibles, drinks, and wellness. Yahoo mentions strains, quantities, edible products, and glassware.

The new site should not hardcode live product counts, specific prices, THC values, product availability, or product names unless those come from a live Leafly/POS integration or a verified static promotion approved by Greenway. Public sources show that product data changes frequently, and Leafly itself includes an inventory-accuracy caveat. The current project already uses mock Leafly-style data; that should remain clearly marked until production integration is certified.

## Amenities, services, and customer experience

Supported amenities and service details include recreational adult-use cannabis, storefront/in-store shopping, cash payment, ATM, ADA accessibility, dog friendly from the official About page, veteran discount from Leafly, and same-day pickup/cash from Leafly. Weedmaps lists in-store purchases only and amenities including accessible, age minimum, and ATM. The official site and directories support daily long operating hours and Highway 16 convenience. Any pickup, online ordering, loyalty, price-match, delivery/vendor, or app-download claims should remain preview-safe until Greenway verifies the production process.

## Compliance and customer education notes

The official FAQ is especially important because cannabis websites must avoid vague or risky customer guidance. Confirmed official FAQ topics include age/ID requirements, recreational purchase limits, carry limits, medical patient differences, consumption restrictions, out-of-state transport prohibition, returns, and budtender interaction. Before replacing the preview FAQ, Greenway should review the FAQ against current Washington rules and current store policies. Several items on the existing FAQ appear dated, especially return policy language referencing a 2016 effective date. The new FAQ should state only current, approved policy.

The website should preserve an adult-use age gate, 21+ language, purchase-limit disclaimers, no public consumption guidance, no out-of-state transport guidance, and no medical claims. Product pages should avoid health-treatment language unless it comes directly from a compliant data source and is legally approved. Blog content should be educational, factual, and reviewed before publication.

## Inconsistent or outdated details to avoid

AllBud’s ZIP code and PO Box wording conflict with official/current address sources. AllBud’s hours conflict with official, Leafly, Weedmaps, Yahoo, and MapQuest. Some Yahoo description language says all cannabis products are organically grown; this should not be reused unless Greenway can prove and approve it for current inventory. Product counts from Leafly and Weedmaps are snapshots and should not be treated as stable. Review counts and ratings are snapshots and should be updated dynamically or cited with dates if used publicly. Existing official FAQ return-policy wording appears outdated and should be reviewed before reuse. Any “happy hour,” senior discount, military discount, veteran discount, loyalty reward, price-match, or app claim should be operationally confirmed before it becomes final website copy.

## Recommended source-backed messaging pillars

The strongest messaging pillar is friendly expert guidance: Greenway is a safe place to ask cannabis questions, get budtender help, and find the right product for the occasion. The second pillar is value and budget fit: public sources repeatedly mention fair prices, low prices, daily/weekly specials, happy hour, discounts, and product-for-every-budget language. The third pillar is Port Orchard/Kitsap local identity: Greenway can credibly reference Port Orchard, Kitsap, Highway 16 convenience, and nearby communities such as Gig Harbor, Key Peninsula, Bremerton, and Silverdale if that targeting is desired. The fourth pillar is broad selection: sources support flower, pre-rolls, vapes/cartridges, concentrates, edibles, topicals/wellness, drinks, accessories, glassware, and vaporizers. The fifth pillar is accessibility and ease: long daily hours, ADA accessibility, ATM/cash, clear location info, and approachable staff.

## Suggested copy direction for the new site

The homepage hero should lead with Greenway Marijuana as Port Orchard’s friendly, budget-conscious cannabis shop, emphasizing knowledgeable staff, strong selection, and daily 8am–11pm convenience. The About page should evolve the safe-haven copy into cleaner modern language without losing the original tone. The Locations page should use the verified address, hours, phone, email, map link, Highway 16 proximity, ADA accessibility, ATM, and storefront context. The Menu page should explain that live menu accuracy depends on Leafly/POS integration and should encourage customers to call when availability matters. The Specials page should promote daily/weekly specials only after exact rules are approved; until then, it should use a “check today’s deals” path tied to Leafly or staff-managed content. The FAQ page should preserve the official topics but modernize and compliance-review all answers. The Blog page should become a Greenway education hub only after approved posts are ready.

## Source list

Official website homepage: https://greenwaymarijuana.com

Official About page: https://greenwaymarijuana.com/about-us

Official Contact page: https://greenwaymarijuana.com/contact-us

Official FAQ page: https://greenwaymarijuana.com/faq

Official Partners page: https://greenwaymarijuana.com/partners

Official Menu page: https://greenwaymarijuana.com/menu

Leafly listing: https://www.leafly.com/dispensary-info/greenway-marijuana

Leafly reviews: https://www.leafly.com/dispensary-info/greenway-marijuana/reviews

Weedmaps listing: https://weedmaps.com/dispensaries/greenway-marijuana

Yahoo Local listing: https://local.yahoo.com/info-191556735-greenway-marijuana-port-orchard

MapQuest listing: https://www.mapquest.com/us/washington/greenway-marijuana-358882284

AllBud listing: https://www.allbud.com/dispensaries/washington/port-orchard/greenway
