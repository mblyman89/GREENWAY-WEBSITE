-- 0371_noncannabis_types.sql  (OI-ACC S3/S4 - shared Other Inventory type registry + accessory cards)
--
-- Owner (verbatim): "I want to be able to add and remove types from the other
-- inventory page as well as the website editor, so they are linked basically.
-- if one page makes a new type, it shows up on the other page." ... "all types
-- should become cards" ... (remove a type) "archive it please."
--
-- ONE row per Other Inventory type. Both the Other Inventory page and the
-- Website -> Accessory Cards editor read and write these rows, so the two
-- stay linked. noncannabis_products.type stays free text (0076) and holds
-- the row's `value`. Removing a type = archived_at set (never deleted): it
-- leaves the pickers and the website; products keep their type and history.
--
-- Card fields: draft_* are what the editor saves; card_* are what the public
-- shop shows (copied on Publish). Seeded identically so the shop looks the
-- same on day one. menu_group: 'accessories' = a shop card; 'merch' = apparel
-- (its own home, the Greenway Merch adverts; never a card here).
--
-- Idempotent. Service role only (rule 15). Owner applies manually.

create table if not exists public.noncannabis_types (
  value          text primary key,
  label          text not null,
  sku_prefix     text not null,
  menu_group     text not null default 'accessories',
  sort           integer not null default 100,
  archived_at    timestamptz,
  draft_label    text not null default '',
  draft_text     text not null default '',
  draft_image    text not null default '',
  card_label     text not null default '',
  card_text      text not null default '',
  card_image     text not null default '',
  card_published_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.staff_profiles(id) on delete set null,
  constraint noncannabis_types_value_chk check (value ~ '^[a-z0-9][a-z0-9_]{0,39}$'),
  constraint noncannabis_types_label_chk check (length(btrim(label)) between 1 and 40 and label !~ '[[:cntrl:]]'),
  constraint noncannabis_types_prefix_chk check (sku_prefix ~ '^[A-Z0-9]{2,5}$'),
  constraint noncannabis_types_group_chk check (menu_group in ('accessories', 'merch')),
  constraint noncannabis_types_card_len_chk check (
    length(draft_label) <= 40 and length(card_label) <= 40 and
    length(draft_text) <= 400 and length(card_text) <= 400 and
    length(draft_image) <= 500 and length(card_image) <= 500)
);

create index if not exists idx_noncannabis_types_live on public.noncannabis_types (sort, value) where archived_at is null;

alter table public.noncannabis_types enable row level security;
revoke all on table public.noncannabis_types from public, anon, authenticated;
grant select, insert, update on table public.noncannabis_types to service_role;
revoke delete, truncate on table public.noncannabis_types from service_role; -- archive, never delete

comment on table public.noncannabis_types is
  'OI-ACC (0371): Other Inventory type registry shared by Other Inventory + Website > Accessory Cards. Archive (archived_at), never delete. draft_* = editor, card_* = published shop card. Service role only.';

-- Seed: the 22 built-in types (src/lib/naming/noncannabis-core.ts NONCANNABIS_TYPES,
-- same prefixes so no SKU changes) + the three placeholder cards that had no
-- type (sherlock, chillum, dab_tool). Card words/pictures carried from the
-- 14 placeholder cards (InteractiveMenuBrowser accessorySectionCards).
insert into public.noncannabis_types (value, label, sku_prefix, menu_group, sort, draft_label, draft_text, draft_image, card_label, card_text, card_image, card_published_at)
select v.value, v.label, v.prefix, v.grp, v.sort, v.cl, v.ct, v.ci, v.cl, v.ct, v.ci, now()
from (values
  ('bong','Bong','BONG','accessories',10,'Bongs','Big, smooth, water-cooled hits without the harshness. Premium borosilicate beakers and straight tubes with built-in percs filter every pull so your flower tastes cleaner and hits easier — the centerpiece your sessions deserve.','/accessories/bongs.webp'),
  ('pipe','Pipe','PIPE','accessories',20,'Pipes','Grab, pack, and go. Hand-blown glass spoons in bold colors that fit perfectly in your palm and your pocket — the everyday classic that''s ready whenever you are, no water or setup required.','/accessories/pipes.webp'),
  ('papers','Rolling Papers','PAPR','accessories',30,'Papers','Roll the perfect joint every time. Slow-burning papers, ready-to-fill cones, and tips that keep ash even and flavor pure. Stock up — the difference between a good roll and a great one starts here.','/accessories/papers.webp'),
  ('bowl','Bowl / Slide','BOWL','accessories',40,'Bowl Pieces','Upgrade your rip or replace a lost slide in seconds. Thick glass bowls in standard joint sizes with easy-grip handles and built-in screens — pack bigger, pull cleaner, and breathe new life into the piece you already love.','/accessories/bowl-pieces.webp'),
  ('tray','Rolling Tray','TRAY','accessories',50,'Rolling Trays','Keep every session tidy and stash-free. Sleek metal trays with raised edges corral your flower, papers, and grinder so nothing spills and nothing''s lost — the clean, organized home base every roller wants on the table.','/accessories/rolling-trays.webp'),
  ('grinder','Grinder','GRND','accessories',60,'Grinders','Fluffy, even grind and zero waste. Precision-milled aluminum teeth break down flower effortlessly while the mesh screen collects every speck of potent kief in the bottom chamber — more flavor, easier packing, nothing left behind.','/accessories/grinders.webp'),
  ('battery','Battery','BATT','accessories',70,'Vape Batteries','Power any 510-thread cart with one reliable click. Long-lasting batteries with draw-activated ease or adjustable voltage to dial in your hit, plus fast USB charging — consistent clouds, pocket-ready, all day long.','/accessories/vape-batteries.webp'),
  ('dab_tool','Dab Tool','DTOL','accessories',80,'Dab Tools','Handle your concentrates like a pro. Rust-proof stainless steel tools, precision carb caps, and a non-stick silicone container keep every dab clean, mess-free, and exactly where it belongs — no sticky fingers, no wasted wax.','/accessories/dab-tools.webp'),
  ('dab_rig','Dab Rig','RIG','accessories',90,'Dab Rigs','Flavor-first dabs with maximum vapor. Compact glass rigs paired with quartz bangers and water percolation deliver smooth, terpene-rich hits that hit hard and taste incredible — built for concentrate lovers who want every drop to count.','/accessories/dab-rigs.webp'),
  ('downstem','Downstem','DSTM','accessories',100,'Down Stems','The perfect-fit upgrade your bong''s been missing. Diffused glass down stems in multiple lengths break smoke into tiny bubbles for cooler, smoother pulls — match your joint size and instantly level up filtration.','/accessories/down-stems.webp'),
  ('bubbler','Bubbler','BUBL','accessories',110,'Bubblers','Bong-smooth hits in a piece that fits your hand. Hand-held glass bubblers add water filtration and a built-in perc to a portable frame — the best of both worlds for sessions that travel without sacrificing a single smooth pull.','/accessories/bubblers.webp'),
  ('sherlock','Sherlock','SHRL','accessories',120,'Sherlocks','Timeless style meets a cooler hit. The signature gooseneck curve on these striped glass Sherlocks keeps smoke away from your hand and the flame at a comfortable distance — a collector-worthy classic that feels as good as it looks.','/accessories/sherlocks.webp'),
  ('chillum','Chillum','CHLM','accessories',130,'Chillums','One-hit, one-and-done discretion. Slim swirl-glass chillums load a quick bowl and stash anywhere — the low-profile, easy-to-clean pick for a fast, flavorful pull on the move with zero fuss.','/accessories/chillums.webp'),
  ('lighter','Lighter','LTR','accessories',140,'Lighters','Never get caught without a flame. Refillable torches that fire up dabs and bowls, classic flip lighters for everyday carry, and natural hemp wick for a cleaner-tasting light — the dependable essentials no session should start without.','/accessories/lighters.webp'),
  ('banger','Banger / Nail','BANG','accessories',150,'Bangers & Nails','','/accessories/dab-rigs.webp'),
  ('carb_cap','Carb Cap','CARB','accessories',160,'Carb Caps','','/accessories/dab-tools.webp'),
  ('torch','Torch','TRCH','accessories',170,'Torches','','/accessories/lighters.webp'),
  ('wraps','Wraps / Cones','WRAP','accessories',180,'Wraps & Cones','','/accessories/papers.webp'),
  ('charger','Charger','CHRG','accessories',190,'Chargers','','/accessories/vape-batteries.webp'),
  ('coil','Coil / Atomizer','COIL','accessories',200,'Coils & Atomizers','','/accessories/vape-batteries.webp'),
  ('storage','Storage / Jar','STOR','accessories',210,'Storage & Jars','',''),
  ('ashtray','Ashtray','ASHT','accessories',220,'Ashtrays','',''),
  ('cleaning','Cleaning Supply','CLEN','accessories',230,'Cleaning Supplies','',''),
  ('other','Other','MISC','accessories',900,'Other Accessories','',''),
  ('apparel','Apparel / Merch','APRL','merch',950,'Apparel','','')
) as v(value, label, prefix, grp, sort, cl, ct, ci)
on conflict (value) do nothing;

notify pgrst, 'reload schema';
