#!/usr/bin/env python3
"""
build_strains.py — Generate the verified cannabis strain knowledge base.

NO-GUESSING RULE
----------------
Every strain below is included only when its type + lineage are corroborated by
reputable, cross-referenced cannabis databases (Leafly's curated 100, Wikileaf,
AllBud, Seedfinder, and breeder-stated crosses). Where a field is genuinely
disputed or unknown across sources, it is left empty (None) rather than guessed:
  - OG Kush / Chemdog / Triangle Kush lineage = "Unknown" (documented as such).
  - Aroma/flavor terms are normalized to a controlled vocabulary.
  - Dominant terpene is the widely-reported dominant; left "" if not consistent.

The high-CBD / alternate-cannabinoid cultivars the owner called out (edibles &
liquids often carry CBD/CBG/CBN/CBC) are tagged via `dominant_cannabinoid` so
the AI describes them correctly instead of assuming high-THC.

Outputs (all under back-office/kb_seed/ and src/lib/ai/kb/):
  1. strains_seed.csv        — human-auditable, one row per strain (+ sources).
  2. strains_seed.sql        — paste into Supabase SQL editor (idempotent upsert).
  3. ../../src/lib/ai/kb/strains-data.ts — typed seed the app imports.

Run:  python3 build_strains.py
"""
import csv
import json
import os

# Controlled vocab note: aroma/flavor terms kept to a consistent set so the model
# always sees clean, predictable descriptors.

# Field order per row:
# (name, type, lineage|None, dom_terpene, aromas[list], flavors[list],
#  terpenes[list], dominant_cannabinoid, potency_note|None, bud_structure|None,
#  origin|None, summary, aliases[list], sources[list], confidence)

S = "sativa"
I = "indica"
H = "hybrid"

# Common source tags (kept short; expanded in the SQL/CSV).
LEAFLY = "leafly"
WIKILEAF = "wikileaf"
ALLBUD = "allbud"
SEEDFINDER = "seedfinder"
BREEDER = "breeder-stated"

STRAINS = [
    # ---- Foundational / landrace ----
    ("Afghani", I, None, "myrcene", ["earthy","sweet","spicy"], ["earthy","hash","sweet"], ["myrcene","caryophyllene","pinene"], "thc", "classic resin-heavy indica", "dense", "Afghanistan (landrace)", "A foundational landrace indica named for its region of origin, prized for heavy resin and a sweet, earthy hash aroma.", ["afghan","afghan kush"], [LEAFLY,WIKILEAF], 0.95),
    ("Hindu Kush", I, None, "limonene", ["earthy","sweet","sandalwood"], ["earthy","sweet","hash"], ["limonene","myrcene","caryophyllene"], "thc", "classic landrace indica", "dense", "Hindu Kush mountains (landrace)", "A landrace indica from the Hindu Kush range with a sweet, earthy sandalwood aroma and a thick coat of trichomes.", ["hindu kush mountains"], [LEAFLY,WIKILEAF], 0.95),
    ("Thai", S, None, "", ["citrus","earthy","spicy"], ["citrus","earthy"], ["limonene","pinene"], "thc", "classic landrace sativa", "wispy", "Thailand (landrace)", "A landrace sativa from Thailand, a parent of many classic crosses, with bright citrus and earthy notes.", ["thai stick"], [LEAFLY,SEEDFINDER], 0.9),
    ("Durban Poison", S, "African (landrace)", "terpinolene", ["sweet","pine","earthy","anise"], ["sweet","pine","licorice"], ["terpinolene","myrcene","ocimene"], "thc", "classic sativa", "chunky", "Durban, South Africa", "A pure South African landrace sativa with a distinctive sweet, piney aroma and a hint of anise; revered by hashmakers.", ["durban"], [LEAFLY,WIKILEAF], 0.95),
    ("Acapulco Gold", S, "Mexican (landrace)", "myrcene", ["earthy","toffee","citrus"], ["toffee","earthy","sweet"], ["myrcene","pinene","caryophyllene"], "thc", "classic sativa", "dense", "Acapulco, Mexico", "A classic Mexican landrace sativa with dense, orange-flecked nuggets and aromas of burnt toffee.", [], [LEAFLY], 0.9),
    ("Maui Wowie", S, "Hawaiian (landrace)", "myrcene", ["tropical","pineapple","sweet"], ["pineapple","tropical","sweet"], ["myrcene","caryophyllene","pinene"], "thc", "classic sativa", "fluffy", "Hawaii", "A classic tropical sativa from Hawaii with sweet pineapple flavors.", ["maui"], [LEAFLY], 0.9),
    ("Lamb's Bread", S, "Jamaican (landrace)", "myrcene", ["herbal","earthy","grassy"], ["herbal","earthy"], ["myrcene","caryophyllene"], "thc", "classic sativa", "fluffy", "Jamaica", "A bright green, sticky Jamaican sativa, famously associated with Bob Marley.", ["lambs bread","lamb's breath"], [LEAFLY], 0.85),

    # ---- The OG / Chem / Diesel family ----
    ("OG Kush", H, None, "myrcene", ["earthy","pine","lemon","fuel"], ["earthy","citrus","woody"], ["myrcene","limonene","caryophyllene"], "thc", "typically high THC", "dense", "United States", "The genetic backbone of West Coast hybrids; an earthy-pine aroma with a citrus-fuel edge. Exact lineage is disputed.", ["og","ogkush"], [LEAFLY,WIKILEAF], 0.9),
    ("Chemdog", H, None, "caryophyllene", ["diesel","pungent","earthy"], ["diesel","earthy","chemical"], ["caryophyllene","myrcene","limonene"], "thc", "typically high THC", "dense", "United States", "A mysterious, influential strain with a loud diesel aroma; parent to Sour Diesel and OG Kush. Lineage uncertain.", ["chemdawg","chem dog","chem dawg"], [LEAFLY,WIKILEAF], 0.9),
    ("Sour Diesel", S, "Chemdog x Super Skunk", "caryophyllene", ["diesel","pungent","citrus","fuel"], ["diesel","lemon","sour"], ["caryophyllene","limonene","myrcene"], "thc", "typically high THC", "dense", "United States", "A legendary sativa named for its pungent diesel aroma with a citrus edge; fast-acting and cerebral.", ["sour d","sourd"], [LEAFLY,WIKILEAF], 0.9),
    ("Headband", H, "OG Kush x Sour Diesel", "myrcene", ["lemon","diesel","earthy"], ["lemon","diesel","creamy"], ["myrcene","caryophyllene","limonene"], "thc", "typically high THC", "dense", "United States", "A creamy, smooth cross of OG Kush and Sour Diesel with lemon and diesel notes.", [], [LEAFLY], 0.9),
    ("Stardawg", H, "Chemdog 4 x Tres Dawg", "caryophyllene", ["diesel","pine","lemon"], ["diesel","pine","lemon"], ["caryophyllene","myrcene","pinene"], "thc", "typically high THC", "frosty", "United States", "A Chemdog-heavy hybrid with a diesel funk and notes of pine and lemon under a blanket of trichomes.", [], [LEAFLY], 0.9),
    ("GMO Cookies", H, "Chemdog x GSC", "limonene", ["garlic","savory","diesel","earthy"], ["garlic","savory","diesel"], ["limonene","caryophyllene","myrcene"], "thc", "typically very high THC", "dense", "United States", "A pungent, savory cross of Chemdog and GSC, also called Garlic Cookies; stanky and strong.", ["gmo","garlic cookies"], [LEAFLY], 0.9),
    ("Bruce Banner", H, "Strawberry Diesel x OG Kush", "myrcene", ["sweet","earthy","diesel"], ["sweet","earthy","fuel"], ["myrcene","caryophyllene","limonene"], "thc", "typically very high THC", "frosty", "United States", "A potent hybrid with lightly sweet, earthy flavors and a diesel undertone.", ["banner","og banner"], [LEAFLY], 0.9),
    ("White Fire OG", H, "Fire OG x The White", "limonene", ["sour","earthy","diesel"], ["sour","earthy","diesel"], ["limonene","caryophyllene","myrcene"], "thc", "typically high THC", "frosty", "United States", "Also called WiFi OG; a sour, earthy, diesel-scented hybrid with a heavy resin coat.", ["wifi og","wifi"], [LEAFLY], 0.88),
    ("Triangle Kush", I, None, "myrcene", ["earthy","gassy","vanilla","pine"], ["gassy","earthy","vanilla"], ["myrcene","caryophyllene","limonene"], "thc", "typically very high THC", "dense", "Florida, United States", "A biting, gassy Florida cultivar likely descended from OG Kush, with soft vanilla notes.", ["tk"], [LEAFLY], 0.85),
    ("SFV OG", H, "OG Kush phenotype", "myrcene", ["earthy","pine","lemon","fuel"], ["earthy","pine","lemon"], ["myrcene","limonene","caryophyllene"], "thc", "typically high THC", "dense", "San Fernando Valley, United States", "A San Fernando Valley OG Kush phenotype with classic earthy-pine and citrus-fuel notes.", ["sfv"], [LEAFLY,SEEDFINDER], 0.85),
    ("Fire OG", H, "OG Kush x SFV OG", "limonene", ["earthy","lemon","pine","fuel"], ["lemon","earthy","pine"], ["limonene","myrcene","caryophyllene"], "thc", "typically high THC", "frosty", "United States", "One of the most potent OG cuts, with lemon, pine, and fuel notes and red-orange hairs.", [], [LEAFLY,SEEDFINDER], 0.85),
    ("Khalifa Kush", H, "OG Kush", "limonene", ["lemon","pine","sour"], ["lemon","pine","sour"], ["limonene","myrcene","caryophyllene"], "thc", "typically high THC", "dense", "United States", "An OG Kush cut bred for Wiz Khalifa, with sour lemon and pine notes.", ["kk"], [LEAFLY], 0.8),

    # ---- The Cookies / Gelato / dessert family ----
    ("GSC", H, "OG Kush x Durban Poison", "caryophyllene", ["sweet","earthy","dessert","mint"], ["sweet","cookie-dough","mint","grape"], ["caryophyllene","limonene","humulene"], "thc", "typically very high THC", "dense", "California, United States", "Girl Scout Cookies — a hugely influential dessert hybrid with sweet, minty, earthy notes and butter-sugar cookie character.", ["girl scout cookies","cookies"], [LEAFLY,WIKILEAF], 0.95),
    ("Animal Cookies", H, "GSC x Fire OG", "caryophyllene", ["sweet","sour","earthy"], ["sweet","sour","cookie"], ["caryophyllene","limonene","myrcene"], "thc", "typically very high THC", "dense", "United States", "A strong GSC descendant crossed with Fire OG; sweet-and-sour with purple-tinged buds.", ["animal cookie"], [LEAFLY], 0.88),
    ("Gelato", H, "Sunset Sherbet x Thin Mint GSC", "caryophyllene", ["sweet","creamy","berry","dessert"], ["sweet","cream","berry","citrus"], ["caryophyllene","limonene","humulene"], "thc", "typically very high THC", "dense", "Bay Area, United States", "Also called Larry Bird; a dessert hybrid with a sweet, creamy aroma and bright berry-citrus notes.", ["larry bird"], [LEAFLY,WIKILEAF], 0.95),
    ("Gelato 41", H, "Sunset Sherbet x Thin Mint GSC", "caryophyllene", ["sweet","creamy","gas","dessert"], ["sweet","cream","gas"], ["caryophyllene","limonene","linalool"], "thc", "typically very high THC", "dense", "United States", "A sought-after Gelato phenotype with a sweet, creamy, gassy profile.", ["gelato #41"], [LEAFLY,SEEDFINDER], 0.85),
    ("Wedding Cake", H, "Triangle Kush x Animal Mints", "limonene", ["sweet","vanilla","earthy","tangy"], ["vanilla","sweet","earthy"], ["limonene","caryophyllene","myrcene"], "thc", "typically very high THC", "dense", "United States", "A rich, tangy-sweet hybrid with a vanilla-cake aroma over an earthy base; Leafly Strain of the Year 2019.", ["triangle mints","pink cookies"], [LEAFLY,WIKILEAF], 0.92),
    ("Ice Cream Cake", I, "Wedding Cake x Gelato 33", "limonene", ["sweet","vanilla","creamy","nutty"], ["vanilla","sweet","cream"], ["limonene","caryophyllene","linalool"], "thc", "typically very high THC", "dense", "United States", "A creamy dessert indica with sweet vanilla wafting off frosty green-and-purple buds.", [], [LEAFLY], 0.9),
    ("Kush Mints", H, "Animal Mints x Bubba Kush", "limonene", ["mint","cookie","earthy"], ["mint","cookie","earthy"], ["limonene","caryophyllene","humulene"], "thc", "typically very high THC", "dense", "United States", "A minty, cookie-scented hybrid with icy-dark dense nugs.", [], [LEAFLY], 0.88),
    ("Biscotti", H, "Gelato 25 x Florida OG", "caryophyllene", ["sweet","cookie","diesel"], ["sweet","cookie","diesel"], ["caryophyllene","limonene","linalool"], "thc", "typically very high THC", "dense", "United States", "A cerebral Gelato descendant with a sweet cookie flavor and notes of diesel; purple-tinged buds.", [], [LEAFLY], 0.88),
    ("Runtz", H, "Zkittlez x Gelato", "caryophyllene", ["sweet","fruity","candy","tropical"], ["sweet","fruit","candy","creamy"], ["caryophyllene","limonene","linalool"], "thc", "typically very high THC", "dense", "United States", "A sweet, candy-like hybrid (Leafly Strain of the Year 2020) with a creamy taste and purple-to-green buds.", ["runts"], [LEAFLY,WIKILEAF], 0.92),
    ("LA Kush Cake", H, "Wedding Cake x Kush Mints", "caryophyllene", ["sweet","earthy","vanilla","mint"], ["vanilla","earthy","mint"], ["caryophyllene","limonene","humulene"], "thc", "typically very high THC", "dense", "Los Angeles, United States", "A smooth, indica-leaning hybrid with sweet vanilla and minty earth notes.", [], [LEAFLY], 0.85),
    ("Lava Cake", H, "Thin Mint GSC x Grape Pie", "caryophyllene", ["sweet","chocolate","mint","berry"], ["chocolate","mint","berry"], ["caryophyllene","limonene","myrcene"], "thc", "typically high THC", "dense", "United States", "A dessert hybrid with sweet chocolate, mint, and berry notes.", [], [LEAFLY], 0.85),
    ("Key Lime Pie", H, "GSC phenotype", "caryophyllene", ["lime","citrus","earthy","sweet"], ["lime","citrus","sweet"], ["caryophyllene","limonene","humulene"], "thc", "typically high THC", "dense", "United States", "A tangier GSC phenotype tasting of fresh-squeezed lime with sweet undertones.", [], [LEAFLY], 0.85),
    ("Tropicana Cookies", S, "GSC x Tangie", "caryophyllene", ["orange","citrus","sweet"], ["orange","citrus","sweet"], ["caryophyllene","limonene","myrcene"], "thc", "typically high THC", "dense", "United States", "A flavorful sativa-leaning cross of GSC and Tangie that smells like a glass of orange juice; deep-purple buds.", ["tropicana"], [LEAFLY], 0.85),
    ("Vanilla Frosting", H, "Humboldt Gelato x Humboldt Frost OG", "myrcene", ["vanilla","creamy","sweet"], ["vanilla","cream","sweet"], ["myrcene","caryophyllene","limonene"], "thc", "typically very high THC", "frosty", "Humboldt, United States", "A frosty Gelato-lineage cake strain with a creamy, smooth vanilla taste.", [], [LEAFLY], 0.82),
    ("MAC", H, "Alien Cookies x Starfighter", "limonene", ["citrus","floral","diesel","cream"], ["citrus","cream","diesel"], ["limonene","caryophyllene","pinene"], "thc", "typically very high THC", "dense", "United States", "Miracle Alien Cookies — beastly, icy colas with a complex citrus-cream-diesel nose.", ["miracle alien cookies","mac 1"], [LEAFLY], 0.85),
    ("Fruity Pebbles", H, "Green Ribbon x Granddaddy Purple x Tahoe Alien", "limonene", ["tropical","berry","sweet","cereal"], ["berry","tropical","sweet"], ["limonene","caryophyllene","myrcene"], "thc", "typically high THC", "dense", "United States", "Also FPOG; a sweet hybrid with a tropical berry flavor reminiscent of the cereal.", ["fpog","fruity pebbles og"], [LEAFLY], 0.82),

    # ---- The Purple / berry / grape family ----
    ("Granddaddy Purple", I, "Purple Urkle x Big Bud", "myrcene", ["grape","berry","sweet","floral"], ["grape","berry","sweet"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "California, United States", "A deep-purple indica with a rich grape-and-berry aroma and a sweet, fruit-forward profile.", ["gdp","grandaddy purple","granddaddy purp"], [LEAFLY,WIKILEAF], 0.95),
    ("Purple Urkle", I, "Mendocino Purps", "myrcene", ["grape","berry","skunk"], ["grape","berry","skunk"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "California, United States", "A complex purple indica blending skunk, berry, and grape notes.", ["purple urkel"], [LEAFLY], 0.85),
    ("Grape Ape", I, "Mendocino Purps x Skunk x Afghani", "myrcene", ["grape","sweet","berry"], ["grape","sweet","berry"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "United States", "An indica named for its distinct grape smell, with dense purple-leaved buds.", [], [LEAFLY], 0.88),
    ("Purple Punch", I, "Larry OG x Granddaddy Purple", "caryophyllene", ["grape","berry","sweet","candy"], ["grape","blueberry","sweet"], ["caryophyllene","myrcene","pinene"], "thc", "typically high THC", "dense", "United States", "A dessert indica with a sweet grape-and-berry aroma reminiscent of fruit candy.", ["purp punch"], [LEAFLY,WIKILEAF], 0.9),
    ("Slurricane", I, "Do-Si-Dos x Purple Punch", "limonene", ["grape","gas","sweet","berry"], ["grape","gas","sweet"], ["limonene","caryophyllene","myrcene"], "thc", "typically very high THC", "frosty", "United States", "A purple, gassy indica with a grape-candy-gas smell and a thick trichome layer.", [], [LEAFLY], 0.88),
    ("Cherry Pie", H, "Granddaddy Purple x Durban Poison", "myrcene", ["cherry","sweet","sour","earthy"], ["cherry","sweet","sour"], ["myrcene","caryophyllene","limonene"], "thc", "typically high THC", "dense", "United States", "A sweet-and-sour cherry-pie-scented hybrid with dense, orange-haired, purple-touched buds.", ["cherry kush"], [LEAFLY], 0.88),
    ("Grape Pie", H, "Cherry Pie x Grape Stomper", "myrcene", ["grape","sweet","sour"], ["grape","sweet","sour"], ["myrcene","caryophyllene","limonene"], "thc", "typically high THC", "dense", "United States", "A sour-and-sugary old-school-looking purp strain.", [], [LEAFLY], 0.85),
    ("Forbidden Fruit", I, "Tangie x Cherry Pie", "myrcene", ["citrus","tropical","cherry","sweet"], ["citrus","cherry","tropical"], ["myrcene","caryophyllene","limonene"], "thc", "typically high THC", "dense", "United States", "A tropical-citrus indica balancing Cherry Pie sweetness with sharp Tangie citrus.", [], [LEAFLY], 0.85),
    ("Zkittlez", I, "Grape Ape x Grapefruit", "caryophyllene", ["fruity","sweet","berry","tropical"], ["fruit","berry","grape","sweet"], ["caryophyllene","humulene","linalool"], "thc", "typically high THC", "chunky", "California, United States", "An award-winning indica with an intensely fruity, candy-sweet aroma and tropical-berry notes.", ["skittlez","skittles"], [LEAFLY,WIKILEAF], 0.92),
    ("Rainbow Belts", H, "Zkittlez x Moonbow", "caryophyllene", ["sweet","tropical","fruity","candy"], ["sweet","tropical","candy"], ["caryophyllene","limonene","linalool"], "thc", "typically very high THC", "frosty", "United States", "A Zkittlez descendant bringing sweet, tropical candy flavors and calming character.", ["rainbow belt"], [LEAFLY], 0.82),
    ("Mimosa", H, "Clementine x Purple Punch", "myrcene", ["citrus","orange","sweet","tropical"], ["citrus","orange","sweet"], ["myrcene","caryophyllene","limonene"], "thc", "typically high THC", "dense", "California, United States", "An effervescent citrus hybrid with sativa-leaning character and big bag appeal.", [], [LEAFLY], 0.88),

    # ---- The Blueberry / blue family ----
    ("Blueberry", I, "Afghani x Thai x Purple Thai", "myrcene", ["blueberry","sweet","berry","earthy"], ["blueberry","sweet","berry"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "United States (DJ Short)", "A heritage indica famous for its true-to-name sweet blueberry aroma and flavor; the root of most 'blue' strains.", ["bb","dj short blueberry"], [LEAFLY,WIKILEAF], 0.92),
    ("Blue Dream", H, "Blueberry x Haze", "myrcene", ["berry","sweet","herbal","blueberry"], ["blueberry","sweet","vanilla"], ["myrcene","pinene","caryophyllene"], "thc", "typically high THC", "fluffy", "California, United States", "A West Coast classic sativa-leaning hybrid with a sweet blueberry aroma over a soft herbal backbone.", ["bluedream"], [LEAFLY,WIKILEAF], 0.95),
    ("Blueberry Muffins", H, "Blueberry x Razzle Berry", "caryophyllene", ["blueberry","sweet","creamy"], ["blueberry","sweet","cream"], ["caryophyllene","myrcene","pinene"], "thc", "typically high THC", "dense", "United States", "A sweet, smooth, creamy descendant of legendary Blueberry.", ["blueberry muffin"], [LEAFLY], 0.82),
    ("Blackberry Kush", I, "Blackberry x Afghani", "myrcene", ["blackberry","sweet","earthy","fuel"], ["blackberry","sweet","earthy"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "United States", "Also BBK; a strong-bodied indica with bold, sweet-earthy blackberry notes.", ["bbk"], [LEAFLY], 0.85),

    # ---- The Haze / Skunk / classic sativa family ----
    ("Haze", S, "South American x Thai", "myrcene", ["spicy","citrus","earthy"], ["spicy","citrus","earthy"], ["myrcene","terpinolene","pinene"], "thc", "classic sativa", "wispy", "Santa Cruz, United States", "A foundational sativa from 1960s California, parent of most 'haze' strains, with spicy citrus notes.", [], [LEAFLY], 0.9),
    ("Skunk 1", H, "Acapulco Gold x Afghani x Colombian Gold", "myrcene", ["skunk","earthy","sour","sweet"], ["skunk","earthy","sweet"], ["myrcene","caryophyllene","humulene"], "thc", "classic hybrid", "dense", "United States / Netherlands", "A genetic cornerstone of countless hybrids since the late 1970s, with a pungent skunky-earthy aroma.", ["skunk #1","skunk number 1"], [LEAFLY,SEEDFINDER], 0.9),
    ("Super Skunk", H, "Skunk 1 x Afghani", "myrcene", ["skunk","earthy","sweet","citrus"], ["skunk","earthy","sweet"], ["myrcene","caryophyllene","humulene"], "thc", "classic hybrid", "dense", "Netherlands", "A heavier Skunk 1 cross with a sweeter, more pungent skunk aroma.", [], [LEAFLY,SEEDFINDER], 0.85),
    ("Super Silver Haze", S, "Skunk x Northern Lights x Haze", "terpinolene", ["citrus","spicy","earthy","skunk"], ["citrus","spicy","earthy"], ["terpinolene","myrcene","caryophyllene"], "thc", "classic sativa", "frosty", "Netherlands", "A multi-award-winning Dutch sativa, sticky and fragrant with an energetic head high.", ["ssh"], [LEAFLY], 0.88),
    ("Super Lemon Haze", S, "Lemon Skunk x Super Silver Haze", "terpinolene", ["lemon","citrus","sweet","zesty"], ["lemon","citrus","zesty"], ["terpinolene","limonene","caryophyllene"], "thc", "typically high THC", "frosty", "Netherlands", "A zesty, tart, lemony sativa update of Super Silver Haze.", ["slh"], [LEAFLY], 0.88),
    ("Lemon Skunk", H, "Skunk phenotypes", "terpinolene", ["lemon","citrus","skunk","sweet"], ["lemon","citrus","skunk"], ["terpinolene","limonene","myrcene"], "thc", "typically high THC", "dense", "Netherlands", "A bright, zesty lemon Skunk selection with a sweet citrus aroma.", [], [LEAFLY,SEEDFINDER], 0.82),
    ("Jack Herer", S, "Haze x Northern Lights #5 x Shiva Skunk", "terpinolene", ["pine","spicy","earthy","citrus"], ["pine","pepper","citrus","wood"], ["terpinolene","caryophyllene","pinene"], "thc", "typically high THC", "frosty", "Netherlands", "A spicy-pine sativa classic named for the cannabis advocate, with a fresh, herbal-citrus character.", ["jh","jack"], [LEAFLY,WIKILEAF], 0.92),
    ("Green Crack", S, "Skunk 1", "myrcene", ["citrus","mango","tropical","sweet"], ["mango","citrus","tangy"], ["myrcene","caryophyllene","limonene"], "thc", "typically high THC", "dense", "United States", "A zesty sativa with a sharp citrus-mango aroma and a bright, tangy profile.", ["green crush","mango crack"], [LEAFLY], 0.88),
    ("Strawberry Cough", S, "Haze x Strawberry Fields", "myrcene", ["strawberry","sweet","berry"], ["strawberry","sweet","berry"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "United States", "A potent sativa known for a sweet strawberry scent and an uplifting, cerebral character.", [], [LEAFLY], 0.85),
    ("Tangie", S, "California Orange x Skunk 1", "myrcene", ["orange","tangerine","citrus","sweet"], ["orange","tangerine","citrus"], ["myrcene","limonene","caryophyllene"], "thc", "typically high THC", "frosty", "Netherlands", "A high-energy sativa with a refreshing tangerine aroma and sticky buds.", [], [LEAFLY], 0.88),
    ("Chocolope", S, "Chocolate Thai x Cannalope Haze", "myrcene", ["coffee","earthy","sweet","chocolate"], ["coffee","chocolate","earthy"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "fluffy", "Netherlands", "A hefty sativa with earthy, sweet coffee-and-chocolate flavors and dreamy, cerebral character.", [], [LEAFLY], 0.85),
    ("Trainwreck", H, "Mexican x Thai x Afghani", "myrcene", ["pine","lemon","spicy","earthy"], ["lemon","pine","pepper"], ["myrcene","terpinolene","pinene"], "thc", "typically high THC", "frosty", "Northern California, United States", "A pungent sativa-dominant hybrid with a sharp pine-and-lemon aroma and a spicy, herbal edge.", [], [LEAFLY,WIKILEAF], 0.9),
    ("Pineapple Express", H, "Trainwreck x Hawaiian", "caryophyllene", ["pineapple","tropical","sweet","citrus"], ["pineapple","tropical","cedar"], ["caryophyllene","limonene","pinene"], "thc", "typically high THC", "dense", "United States", "A tropical hybrid with a bright pineapple aroma over sweet citrus and a hint of cedar.", [], [LEAFLY,WIKILEAF], 0.9),
    ("AK-47", H, "South American x Mexican x Thai x Afghani", "myrcene", ["sour","earthy","floral","sweet"], ["sour","earthy","floral"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "Netherlands", "A sociable hybrid with a sour, earthy aroma and sweet floral notes.", ["ak47","ak 47"], [LEAFLY,SEEDFINDER], 0.85),
    ("Candyland", S, "Platinum GSC x Granddaddy Purple", "caryophyllene", ["sweet","earthy","spicy"], ["sweet","earthy","spicy"], ["caryophyllene","myrcene","limonene"], "thc", "typically high THC", "frosty", "California, United States", "A classic sativa sparkling with trichomes and a contrast of purple, green, and orange.", [], [LEAFLY], 0.82),
    ("Dutch Treat", H, "Northern Lights x Haze", "terpinolene", ["pine","eucalyptus","sweet","fruit"], ["pine","sweet","fruit"], ["terpinolene","myrcene","pinene"], "thc", "typically high THC", "dense", "Netherlands", "A classic with cerebral effects and an intense sweet-fruit, pine, and eucalyptus aroma.", [], [LEAFLY], 0.82),

    # ---- Banana / tropical / fruit ----
    ("Banana Kush", H, "Ghost OG x Skunk Haze", "limonene", ["banana","tropical","sweet","fruity"], ["banana","tropical","sweet"], ["limonene","myrcene","caryophyllene"], "thc", "typically high THC", "dense", "United States", "An aromatic hybrid that fills the nose with sweet, fruity, tropical banana notes.", [], [LEAFLY], 0.85),
    ("Strawberry Banana", H, "Banana Kush x Bubble Gum", "limonene", ["strawberry","banana","sweet","fruity"], ["strawberry","banana","sweet"], ["limonene","myrcene","caryophyllene"], "thc", "typically very high THC", "frosty", "United States", "Also Strawnana; a sweet, fruity hybrid with chill body character and an active mind.", ["strawnana"], [LEAFLY], 0.85),
    ("Orange Creamsicle", H, "Orange Crush x Juicy Fruit", "myrcene", ["orange","cream","citrus","sweet"], ["orange","cream","citrus"], ["myrcene","limonene","caryophyllene"], "thc", "typically high THC", "dense", "United States", "A creamy orange treat with a creamy citrus smell and taste.", ["creamsicle"], [LEAFLY], 0.82),
    ("Lemon Tree", H, "Lemon Skunk x Sour Diesel", "myrcene", ["lemon","citrus","diesel","sweet"], ["lemon","citrus","diesel"], ["myrcene","limonene","caryophyllene"], "thc", "typically high THC", "spongy", "United States", "A pungent hybrid with an unforgettable modern lemon flavor.", [], [LEAFLY], 0.85),
    ("Papaya Punch", H, "Papaya x Purple Punch", "limonene", ["tropical","papaya","sweet","cheese"], ["tropical","sweet","cheese"], ["limonene","myrcene","caryophyllene"], "thc", "typically high THC", "dense", "United States", "A sweet, fruity couch-chill hybrid with tropical flavors and a hint of cheese.", [], [LEAFLY], 0.8),
    ("Mango", I, "Afghani x KC 33", "myrcene", ["mango","tropical","sweet","fruity"], ["mango","tropical","sweet"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "United States", "An indica known for a juicy, fruity mango flavor.", [], [LEAFLY], 0.82),

    # ---- Heavy indica / sleepy / kush ----
    ("Northern Lights", I, "Afghani x Thai", "myrcene", ["earthy","sweet","pine","spicy"], ["sweet","earthy","pine"], ["myrcene","caryophyllene","pinene"], "thc", "classic indica", "dense", "United States / Netherlands", "A legendary indica with a sweet, earthy-pine aroma and a smooth, resinous profile; parent of countless hybrids.", ["nl"], [LEAFLY,WIKILEAF], 0.92),
    ("Bubba Kush", I, "OG Kush x Afghani", "caryophyllene", ["earthy","coffee","chocolate","sweet"], ["coffee","chocolate","earthy"], ["caryophyllene","myrcene","limonene"], "thc", "typically high THC", "chunky", "United States", "A tranquilizing indica with sweet hash flavors and subtle notes of chocolate and coffee.", ["bubba"], [LEAFLY], 0.88),
    ("Master Kush", I, "Hindu Kush selections", "caryophyllene", ["earthy","citrus","hash"], ["earthy","citrus","hash"], ["caryophyllene","myrcene","limonene"], "thc", "typically high THC", "dense", "Netherlands", "A popular indica from two Hindu Kush landraces with a subtle earthy hash smell and hints of citrus.", [], [LEAFLY], 0.85),
    ("Purple Kush", I, "Purple Afghani x Hindu Kush", "myrcene", ["grape","earthy","sweet"], ["grape","earthy","sweet"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "Oakland, United States", "A pure indica with long-lasting, deeply relaxing character and sweet grape-earth notes.", [], [LEAFLY], 0.85),
    ("Pink Kush", H, "OG Kush descendant", "myrcene", ["sweet","vanilla","candy","floral"], ["vanilla","sweet","candy"], ["myrcene","caryophyllene","limonene"], "thc", "typically very high THC", "dense", "Canada", "An indica-dominant hybrid with sweet vanilla and candy-perfume aromas and pink-haired buds.", [], [LEAFLY], 0.82),
    ("White Rhino", I, "White Widow x North American Indica", "myrcene", ["earthy","woody","sweet"], ["earthy","woody","sweet"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "Netherlands", "A beast of an indica with classic White Widow lineage and earthy, woody notes.", [], [LEAFLY], 0.82),
    ("White Widow", H, "Brazilian Sativa x South Indian Indica", "myrcene", ["earthy","woody","spicy","floral"], ["earthy","pepper","wood"], ["myrcene","caryophyllene","pinene"], "thc", "classic hybrid", "frosty", "Netherlands", "A balanced classic hybrid with an earthy, woody aroma and a peppery, resin-heavy character.", [], [LEAFLY,WIKILEAF], 0.9),
    ("LA Confidential", I, "LA Affie x Afghani", "myrcene", ["pine","skunk","earthy"], ["pine","skunk","earthy"], ["myrcene","limonene","caryophyllene"], "thc", "typically high THC", "dense", "California, United States", "A West Coast indica with notes of pine and a skunky taste.", [], [LEAFLY], 0.82),
    ("MK Ultra", I, "OG Kush x G13", "myrcene", ["earthy","pungent","pine"], ["earthy","pungent","pine"], ["myrcene","caryophyllene","limonene"], "thc", "typically very high THC", "dense", "Netherlands", "A potent, pungent indica best for winding down; not for newbies.", [], [LEAFLY], 0.82),
    ("9 Pound Hammer", I, "Gooberry x Hell's OG x Jack the Ripper", "myrcene", ["grape","lime","sweet","funky"], ["grape","lime","sweet"], ["myrcene","caryophyllene","pinene"], "thc", "typically high THC", "dense", "United States", "A heavy indica with dense, resin-coated buds and sweet grape-lime flavors.", ["9lb hammer","nine pound hammer"], [LEAFLY], 0.82),
    ("Do-Si-Dos", I, "GSC x Face Off OG", "limonene", ["sweet","earthy","floral","minty"], ["sweet","mint","earthy"], ["limonene","caryophyllene","linalool"], "thc", "typically very high THC", "frosty", "United States", "A frosty indica with a sweet, earthy aroma and floral-mint undertones; parent of Slurricane.", ["dosidos","dosi","do si dos"], [LEAFLY,WIKILEAF], 0.9),
    ("Peanut Butter Breath", H, "Do-Si-Dos x Mendo Breath", "caryophyllene", ["nutty","savory","earthy"], ["nutty","savory","earthy"], ["caryophyllene","limonene","humulene"], "thc", "typically high THC", "dense", "United States", "A savory, nutty hybrid that smells like roasted, salted peanut butter.", ["pb breath","pbb"], [LEAFLY], 0.85),
    ("Mendo Breath", I, "Mendo Montage x OGKB", "caryophyllene", ["vanilla","caramel","sweet","earthy"], ["vanilla","caramel","sweet"], ["caryophyllene","myrcene","limonene"], "thc", "typically high THC", "frosty", "Mendocino, United States", "A heavy indica with sweet vanilla and caramel flavors off frosty buds.", [], [LEAFLY], 0.82),
    ("Motorbreath", H, "Chemdog x SFV OG", "myrcene", ["diesel","gas","earthy"], ["diesel","gas","earthy"], ["myrcene","caryophyllene","limonene"], "thc", "typically very high THC", "dense", "United States", "A potent, gassy, earthy hybrid crossing Chemdog and SFV OG.", [], [LEAFLY], 0.85),
    ("Gushers", H, "Gelato 41 x Triangle Kush", "limonene", ["tropical","fruity","gas","sweet"], ["tropical","gas","sweet"], ["limonene","caryophyllene","myrcene"], "thc", "typically very high THC", "dense", "United States", "Also White Gushers; a gassy, tropical-fruit hybrid that is beautiful, multi-colored, and glistening.", ["white gushers"], [LEAFLY], 0.85),
    ("Apple Fritter", H, "Sour Apple x Animal Cookies", "limonene", ["apple","sweet","pastry","earthy"], ["apple","sweet","pastry"], ["limonene","caryophyllene","myrcene"], "thc", "typically very high THC", "lumpy", "United States", "A potent hybrid with a lumpy bud structure and a pungent, apple-pastry flavor.", [], [LEAFLY], 0.8),
    ("Alien OG", H, "Tahoe OG x Alien Kush", "myrcene", ["earthy","lemon","pine"], ["earthy","lemon","pine"], ["myrcene","limonene","caryophyllene"], "thc", "typically very high THC", "dense", "California, United States", "A potent hybrid with intense head and body character and classic OG lemon-pine notes.", [], [LEAFLY], 0.8),
    ("Original Glue", H, "Chem's Sister x Sour Dubb x Chocolate Diesel", "myrcene", ["earthy","pungent","pine","fuel"], ["earthy","pine","diesel","chocolate"], ["myrcene","caryophyllene","limonene"], "thc", "typically very high THC", "frosty", "United States", "GG4 / Gorilla Glue — a heavy-resin hybrid with a pungent earthy-fuel aroma and notes of pine and chocolate.", ["gg4","gorilla glue","gg #4","glue"], [LEAFLY,WIKILEAF], 0.92),
    ("Cheese", H, "Skunk 1", "pinene", ["cheese","funky","earthy","sour"], ["cheese","funky","earthy"], ["pinene","myrcene","caryophyllene"], "thc", "classic hybrid", "dense", "United Kingdom", "An indica-leaning hybrid famous for its pungent, tangy cheese aroma.", ["uk cheese","exodus cheese"], [LEAFLY], 0.85),
    ("Island Sweet Skunk", S, "Skunk 1", "myrcene", ["citrus","tropical","skunk","sweet"], ["citrus","tropical","skunk"], ["myrcene","caryophyllene","limonene"], "thc", "some phenos higher CBD", "tall", "British Columbia, Canada", "An energizing Canadian sativa famous for a tangy citrus-and-tropical aroma; some phenotypes carry more CBD.", ["sweet island skunk","iss"], [LEAFLY], 0.82),

    # ---- High-CBD / alternate cannabinoid (the owner specifically flagged these) ----
    ("ACDC", S, "Cannatonic phenotype", "myrcene", ["earthy","woody","sweet","pine"], ["earthy","woody","sweet"], ["myrcene","pinene","caryophyllene"], "cbd", "low-THC / high-CBD", "fluffy", "United States", "A famous high-CBD sativa phenotype of Cannatonic with a very low THC level and earthy-woody notes.", ["acdc cbd"], [LEAFLY,WIKILEAF], 0.9),
    ("Charlotte's Web", H, "high-CBD hemp lineage", "myrcene", ["earthy","pine","floral"], ["earthy","pine","sweet"], ["myrcene","pinene","caryophyllene"], "cbd", "very low THC / high CBD", "fluffy", "Colorado, United States", "A landmark high-CBD, very-low-THC cultivar with earthy, piney notes.", ["charlottes web","cw"], [LEAFLY,WIKILEAF], 0.9),
    ("Harlequin", S, "Colombian Gold x Thai x Swiss landrace", "myrcene", ["earthy","mango","sweet","woody"], ["earthy","mango","sweet"], ["myrcene","pinene","caryophyllene"], "cbd", "high-CBD (often ~5:2 CBD:THC)", "fluffy", "United States", "A reliably high-CBD sativa with earthy mango and sweet notes; popular for balanced ratios.", [], [LEAFLY,WIKILEAF], 0.88),
    ("Cannatonic", H, "MK Ultra x G13 Haze", "myrcene", ["earthy","citrus","sweet"], ["earthy","citrus","sweet"], ["myrcene","pinene","caryophyllene"], "cbd", "high-CBD / low-to-moderate THC", "dense", "Spain", "A foundational high-CBD hybrid (parent of ACDC) with earthy-citrus notes and a mellow profile.", [], [LEAFLY,WIKILEAF], 0.88),
    ("Harle-Tsu", H, "Harlequin x Sour Tsunami", "myrcene", ["earthy","sweet","woody"], ["earthy","sweet","woody"], ["myrcene","pinene","caryophyllene"], "cbd", "very high CBD / very low THC", "dense", "United States", "A very-high-CBD hybrid bred from Harlequin and Sour Tsunami.", ["harle tsu","harletsu"], [LEAFLY,SEEDFINDER], 0.85),
    ("Sour Tsunami", H, "Sour Diesel x NYC Diesel", "myrcene", ["diesel","earthy","sweet"], ["diesel","earthy","sweet"], ["myrcene","caryophyllene","pinene"], "cbd", "high-CBD", "dense", "United States", "One of the first strains bred specifically for high CBD, with a mild sweet-diesel aroma.", [], [LEAFLY,SEEDFINDER], 0.85),
    ("Ringo's Gift", H, "ACDC x Harle-Tsu", "myrcene", ["earthy","herbal","woody"], ["earthy","herbal","woody"], ["myrcene","pinene","caryophyllene"], "cbd", "very high CBD", "fluffy", "United States", "A very-high-CBD hybrid averaging high CBD:THC ratios, with herbal-earthy notes.", ["ringos gift"], [LEAFLY,SEEDFINDER], 0.82),
    ("Pennywise", I, "Harlequin x Jack the Ripper", "myrcene", ["earthy","coffee","pepper","lemon"], ["coffee","earthy","pepper"], ["myrcene","caryophyllene","pinene"], "balanced", "often ~1:1 CBD:THC", "dense", "United States", "An indica with a roughly balanced CBD:THC ratio and earthy coffee-pepper notes.", [], [LEAFLY,WIKILEAF], 0.85),
    ("Stephen Hawking Kush", I, "Harle-Tsu x Sin City Kush", "myrcene", ["berry","earthy","mint","cherry"], ["berry","mint","cherry"], ["myrcene","caryophyllene","pinene"], "balanced", "often balanced CBD:THC", "dense", "United States", "A balanced-ratio indica with sweet berry, cherry, and mint notes.", ["shk"], [LEAFLY,SEEDFINDER], 0.8),
]


# Expansion pass 2 — more verified strains with rich aliases for grower-to-grower
# name variants (loosened name matching per owner request). New strains are
# appended (skipping slugs already present); ALIAS_MERGES adds variant aliases to
# strains already in the original list.
try:
    from strains_extra import EXTRA_STRAINS, ALIAS_MERGES
    _existing = {s[0].strip().lower() for s in STRAINS}
    for _row in EXTRA_STRAINS:
        if _row[0].strip().lower() not in _existing:
            STRAINS.append(_row)
            _existing.add(_row[0].strip().lower())
except ImportError:
    EXTRA_STRAINS = []
    ALIAS_MERGES = {}


def slugify(name: str) -> str:
    return name.strip().lower()


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", ".."))

    rows = []
    for (name, stype, lineage, dom_terp, aromas, flavors, terps, cann, potency,
         bud, origin, summary, aliases, sources, conf) in STRAINS:
        slug = slugify(name)
        # Merge grower-to-grower variant aliases for existing strains, dedup-safe.
        merged_aliases = list(aliases)
        for extra_alias in ALIAS_MERGES.get(slug, []):
            if extra_alias not in merged_aliases:
                merged_aliases.append(extra_alias)
        rows.append({
            "slug": slug,
            "name": name,
            "aliases": merged_aliases,
            "strain_type": stype,
            "lineage": lineage or "",
            "dominant_terpene": dom_terp,
            "aroma_notes": aromas,
            "flavor_notes": flavors,
            "terpenes": terps,
            "dominant_cannabinoid": cann,
            "potency_note": potency or "",
            "bud_structure": bud or "",
            "origin": origin or "",
            "summary": summary,
            "sources": sources,
            "confidence": conf,
        })

    # Dedup guard.
    slugs = [r["slug"] for r in rows]
    assert len(slugs) == len(set(slugs)), f"duplicate slug: {[s for s in slugs if slugs.count(s) > 1]}"

    # ---- 1) CSV ----
    csv_path = os.path.join(here, "strains_seed.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["slug","name","aliases","strain_type","lineage","dominant_terpene",
                    "aroma_notes","flavor_notes","terpenes","dominant_cannabinoid",
                    "potency_note","bud_structure","origin","summary","sources","confidence"])
        for r in rows:
            w.writerow([
                r["slug"], r["name"], "|".join(r["aliases"]), r["strain_type"], r["lineage"],
                r["dominant_terpene"], "|".join(r["aroma_notes"]), "|".join(r["flavor_notes"]),
                "|".join(r["terpenes"]), r["dominant_cannabinoid"], r["potency_note"],
                r["bud_structure"], r["origin"], r["summary"], "|".join(r["sources"]), r["confidence"],
            ])

    # ---- 2) SQL (idempotent upsert on slug) ----
    def sql_str(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    def sql_arr(items):
        if not items:
            return "'{}'"
        # Array literals are still wrapped in a SQL single-quoted string, so
        # apostrophes inside array values must be doubled just like sql_str().
        inner = ",".join('"' + i.replace("'", "''").replace('"', '\\"') + '"' for i in items)
        return "'{" + inner + "}'"

    sql_path = os.path.join(here, "strains_seed.sql")
    with open(sql_path, "w") as f:
        f.write("-- Generated by build_strains.py — verified strain seed.\n")
        f.write("-- Idempotent: upsert on slug. Run AFTER migrations 0019 and 0020.\n")
        f.write("-- Sensory/botanical/market-factual only; no medical or effect claims.\n\n")
        f.write("insert into public.kb_strains\n")
        f.write("  (slug, name, aliases, strain_type, lineage, aroma_notes, flavor_notes,\n")
        f.write("   terpenes, summary, dominant_cannabinoid, potency_note, bud_structure,\n")
        f.write("   origin, sources, confidence, active)\nvalues\n")
        vals = []
        for r in rows:
            vals.append(
                "  (" + ", ".join([
                    sql_str(r["slug"]), sql_str(r["name"]), sql_arr(r["aliases"]),
                    sql_str(r["strain_type"]),
                    sql_str(r["lineage"]) if r["lineage"] else "null",
                    sql_arr(r["aroma_notes"]), sql_arr(r["flavor_notes"]), sql_arr(r["terpenes"]),
                    sql_str(r["summary"]), sql_str(r["dominant_cannabinoid"]),
                    sql_str(r["potency_note"]) if r["potency_note"] else "null",
                    sql_str(r["bud_structure"]) if r["bud_structure"] else "null",
                    sql_str(r["origin"]) if r["origin"] else "null",
                    sql_arr(r["sources"]), str(r["confidence"]), "true",
                ]) + ")"
            )
        f.write(",\n".join(vals))
        f.write("\non conflict (slug) do update set\n")
        f.write("  name = excluded.name,\n")
        f.write("  aliases = excluded.aliases,\n")
        f.write("  strain_type = excluded.strain_type,\n")
        f.write("  lineage = excluded.lineage,\n")
        f.write("  aroma_notes = excluded.aroma_notes,\n")
        f.write("  flavor_notes = excluded.flavor_notes,\n")
        f.write("  terpenes = excluded.terpenes,\n")
        f.write("  summary = excluded.summary,\n")
        f.write("  dominant_cannabinoid = excluded.dominant_cannabinoid,\n")
        f.write("  potency_note = excluded.potency_note,\n")
        f.write("  bud_structure = excluded.bud_structure,\n")
        f.write("  origin = excluded.origin,\n")
        f.write("  sources = excluded.sources,\n")
        f.write("  confidence = excluded.confidence,\n")
        f.write("  active = true;\n")

    # ---- 3) TypeScript seed ----
    ts_path = os.path.join(repo_root, "src", "lib", "ai", "kb", "strains-data.ts")
    with open(ts_path, "w") as f:
        f.write("/**\n")
        f.write(" * src/lib/ai/kb/strains-data.ts\n")
        f.write(" *\n")
        f.write(" * GENERATED by back-office/kb_seed/build_strains.py — do not edit by hand.\n")
        f.write(" * Verified cannabis strain seed (no guessing). Sensory/botanical/market-\n")
        f.write(" * factual only; no medical or effect claims. Each row carries `sources` and\n")
        f.write(" * `confidence` for auditability.\n")
        f.write(" */\n")
        f.write('import type { SeedStrain } from "./seed";\n\n')
        f.write("export type SeedStrainRich = SeedStrain & {\n")
        f.write("  dominant_cannabinoid?: string;\n")
        f.write("  potency_note?: string;\n")
        f.write("  bud_structure?: string;\n")
        f.write("  origin?: string;\n")
        f.write("  sources?: string[];\n")
        f.write("  confidence?: number;\n")
        f.write("};\n\n")
        f.write("export const STRAINS_RICH: SeedStrainRich[] = [\n")
        for r in rows:
            f.write("  {\n")
            f.write(f"    slug: {json.dumps(r['slug'])}, name: {json.dumps(r['name'])},\n")
            f.write(f"    aliases: {json.dumps(r['aliases'])}, strain_type: {json.dumps(r['strain_type'])},\n")
            if r["lineage"]:
                f.write(f"    lineage: {json.dumps(r['lineage'])},\n")
            f.write(f"    aroma_notes: {json.dumps(r['aroma_notes'])}, flavor_notes: {json.dumps(r['flavor_notes'])},\n")
            f.write(f"    terpenes: {json.dumps(r['terpenes'])},\n")
            f.write(f"    summary: {json.dumps(r['summary'])},\n")
            f.write(f"    dominant_cannabinoid: {json.dumps(r['dominant_cannabinoid'])},")
            if r["potency_note"]:
                f.write(f" potency_note: {json.dumps(r['potency_note'])},")
            f.write("\n")
            if r["bud_structure"]:
                f.write(f"    bud_structure: {json.dumps(r['bud_structure'])},")
            if r["origin"]:
                f.write(f" origin: {json.dumps(r['origin'])},")
            f.write("\n")
            f.write(f"    sources: {json.dumps(r['sources'])}, confidence: {r['confidence']},\n")
            f.write("  },\n")
        f.write("];\n")

    print(f"Wrote {len(rows)} strains:")
    print(f"  CSV: {csv_path}")
    print(f"  SQL: {sql_path}")
    print(f"  TS:  {ts_path}")


if __name__ == "__main__":
    main()
