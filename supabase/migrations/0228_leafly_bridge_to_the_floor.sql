-- =============================================================================
-- 0228_leafly_bridge_to_the_floor.sql  (Slice L-10)
--
-- THE PROBLEM THIS MIGRATION EXISTS TO FIX
-- -----------------------------------------------------------------------------
-- Until now a Leafly order lived only in public.leafly_orders. The speakers,
-- the receipt printer and the register pickup queue all read public.orders.
-- So a Leafly order was invisible to every one of them -- not because a
-- setting was switched off, but structurally, because nothing had ever
-- written the row they read. Migration 0225 even created
-- leafly_orders.local_order_id for precisely this purpose, and the slice L-9
-- recon found that no code in the repository had ever populated it.
--
-- THE OWNER'S DECISION, WHICH THE COLUMNS BELOW ENCODE
-- -----------------------------------------------------------------------------
--   "I think the leafly order should become floor visible once the order has
--    been accepted by us. it should however, make noise on the speaker, and
--    print out the receipt immediately so we know to accept the order as soon
--    as possible."
--
-- That is two stages, not one:
--
--   ARRIVAL    (order_submit webhook lands)  -> announce + print
--   ACCEPTANCE (we acknowledge it to Leafly) -> create the local order
--
-- and it is why announced_at/printed_at are SEPARATE from acknowledged_at,
-- which already exists. Acknowledgement is a fact about Leafly. Announcing
-- and printing are facts about our shop floor, they happen minutes earlier,
-- and conflating them would make it impossible to answer the question staff
-- will actually ask: "did this thing ever make a noise?"
--
-- WHY THESE ARE TIMESTAMPS AND NOT BOOLEANS
-- -----------------------------------------------------------------------------
-- A boolean answers "did it print". A timestamp also answers "when", which is
-- the question that matters when an order is missed and the owner wants to
-- know whether the ticket printed at 2:31 and sat there, or never printed at
-- all. A boolean cannot distinguish those, and they have completely different
-- fixes.
--
-- WHY announced_at IS ALSO THE IDEMPOTENCY GUARD
-- -----------------------------------------------------------------------------
-- Leafly retries webhooks. The bridge claims the work with
--
--   update ... set announced_at = now() where announced_at is null
--
-- and only proceeds if that matched a row, so two simultaneous deliveries
-- cannot both print. Printing twice is not a cosmetic bug: two tickets for
-- one order is how one customer's bag gets built twice.
--
-- WHAT THIS MIGRATION ADDS
--   1. leafly_orders.announced_at        -- when the PA announced the arrival
--   2. leafly_orders.printed_at          -- when the arrival ticket was queued
--   3. announcer_settings per-origin sound columns (4), so the owner can give
--      Leafly orders their own sound from the SAME sound library the website
--      orders use, including his own uploads.
--   4. A partial index for the "arrived but never announced" query.
--
-- WHAT IT DELIBERATELY DOES NOT ADD
--   No new settings table for sounds. The announcer already has
--   public.announcer_settings (migration 0222) and the uploads already live in
--   public.announcer_sounds. Adding a second home for "what noise do we make"
--   is how two sources of truth get created, and house rule 11 exists to stop
--   exactly that. The owner's words were "I want the sound to be connected to
--   our sound library" -- connected to, not duplicated beside.
--
-- Reuses: public.leafly_orders (0225), public.announcer_settings (0222),
--         public.announcer_sounds (0222).
-- Idempotent: add-column-if-not-exists and create-index-if-not-exists
-- throughout, so re-running this file is a no-op. Safe to paste into the
-- Supabase SQL editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. THE TWO STAGE-ONE TIMESTAMPS
-- -----------------------------------------------------------------------------
alter table public.leafly_orders
  add column if not exists announced_at timestamptz;

alter table public.leafly_orders
  add column if not exists printed_at timestamptz;

comment on column public.leafly_orders.announced_at is
  'When the PA announced this order''s ARRIVAL. Set at the order_submit '
  'webhook, NOT at acknowledgement -- the owner asked for the noise to be '
  'immediate so staff know to accept inside Leafly''s fifteen minute window. '
  'Also the idempotency guard: the bridge claims work with "where '
  'announced_at is null", so a retried webhook cannot print a second ticket.';

comment on column public.leafly_orders.printed_at is
  'When the arrival ticket was queued on the online-orders printer. Separate '
  'from announced_at because a shop can have working speakers and a jammed '
  'printer, and the difference decides which one you go and fix.';

-- The operational query: orders that arrived but never made a noise. Partial,
-- because once an order has announced it is of no further interest here, and
-- the vast majority of rows will have announced.
create index if not exists leafly_orders_unannounced_idx
  on public.leafly_orders (first_seen_at)
  where announced_at is null;

-- -----------------------------------------------------------------------------
-- 2. PER-ORIGIN SOUNDS, CONNECTED TO THE EXISTING SOUND LIBRARY
-- -----------------------------------------------------------------------------
-- The owner's requirement, verbatim:
--
--   "I want the sound to be connected to our sound library, so we can upload
--    custom sounds to play for each type. there are already several preloaded
--    sounds, you can set it to fall back to one of the other sounds that is
--    not the same as the fallback one for our online orders noise."
--
-- Two columns per origin, mirroring the pattern announcer_devices already uses
-- (sound_id for a built-in, custom_sound_path for an upload). Reusing the
-- established shape means resolveSound() in announcer-core.ts applies the same
-- precedence and the same never-resolve-to-silence guarantee to both.
--
-- NULL means "no choice made", and the code falls back to the per-origin
-- default in src/lib/orders/order-origin-core.ts -- chime for the website,
-- bell for Leafly. Those two differ, which is the owner's explicit
-- requirement, and a self-test asserts they differ so the pair cannot
-- silently converge later.
--
-- NO FOREIGN KEY to announcer_sounds on the custom paths, deliberately, and
-- for the same reason announcer_devices has none: deleting a sound file must
-- not be blocked by, or cascade into, a settings row. The resolver already
-- checks whether the path still exists and falls back to a built-in when it
-- does not, so a dangling path degrades to a chime instead of to silence or
-- to a failed delete.
alter table public.announcer_settings
  add column if not exists leafly_sound_id text;

alter table public.announcer_settings
  add column if not exists leafly_custom_sound_path text;

alter table public.announcer_settings
  add column if not exists greenway_sound_id text;

alter table public.announcer_settings
  add column if not exists greenway_custom_sound_path text;

comment on column public.announcer_settings.leafly_sound_id is
  'Built-in sound id played for Leafly orders. NULL = use the origin default '
  '(bell), which is deliberately NOT the website''s default (chime) so the '
  'two are tellable apart from across the shop.';

comment on column public.announcer_settings.leafly_custom_sound_path is
  'Storage path of an uploaded sound from public.announcer_sounds, played for '
  'Leafly orders. Outranks leafly_sound_id. No FK on purpose: a deleted '
  'upload must degrade to a built-in, never block the delete.';

comment on column public.announcer_settings.greenway_sound_id is
  'Built-in sound id played for website orders. NULL falls back to the '
  'long-standing shop-wide default_sound_id, so shops that configured that '
  'column before slice L-10 keep the sound they chose.';

comment on column public.announcer_settings.greenway_custom_sound_path is
  'Storage path of an uploaded sound played for website orders. Outranks '
  'greenway_sound_id.';

-- -----------------------------------------------------------------------------
-- 3. WHAT IS NOT HERE
-- -----------------------------------------------------------------------------
-- No change to public.orders. It already has the `origin` column and its CHECK
-- constraint from migration 0226, and 'leafly' is already an accepted value
-- there. The bridge simply becomes the first writer ever to pass it.
--
-- No RLS changes. Both tables already carry their policies from 0225 and 0222,
-- and every write in this slice goes through the service-role admin client on
-- the server, which those policies already contemplate.
