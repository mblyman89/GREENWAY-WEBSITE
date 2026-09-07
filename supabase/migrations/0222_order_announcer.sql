-- ============================================================================
-- 0222_order_announcer.sql  (SLICE 27)
--
-- The online order announcer: when an order lands, speakers in the office, on
-- the sales floor, and in storage all say so.
--
-- WHY THE SHAPE IS WHAT IT IS
-- ---------------------------
-- This site runs on Vercel serverless functions. The longest function timeout
-- anywhere in the repository is 60 seconds (maxDuration in
-- src/app/api/pos/sync/route.ts), and there is not one streaming endpoint in
-- the product -- a grep of src/app for text/event-stream and ReadableStream
-- returns nothing. So a held-open push channel is not available to us, and a
-- Raspberry Pi cannot be pushed to from here.
--
-- The Pi therefore reaches OUT to us on a long-poll, and work waits for it in
-- a table. That choice is what makes this reliable: the connection is always
-- initiated from inside the shop, so it crosses the router exactly the way a
-- browser does. No port forwarding. No static IP. No dependence on what the
-- ISP does to the WAN address overnight.
--
-- Work is handed out with FOR UPDATE SKIP LOCKED under a short LEASE rather
-- than a delete. Two consequences, both deliberate:
--
--   * Multiple speakers are free. One row is written per enabled device, and
--     each Pi claims only its own rows. A fourth speaker is a fourth row and
--     zero code changes.
--   * A Pi that claims a job and then loses power does not swallow the
--     announcement. The lease lapses and the work becomes claimable again.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ── private bucket for uploaded sounds ──────────────────────────────────────
-- Same shape as 0142_intake_docs_archive.sql: public = false, and every policy
-- goes through public.is_staff(). Audio the shop uploads is not something we
-- want served off a guessable public URL.
insert into storage.buckets (id, name, public)
values ('announcer-sounds', 'announcer-sounds', false)
on conflict (id) do nothing;

drop policy if exists announcer_sounds_staff_read on storage.objects;
create policy announcer_sounds_staff_read on storage.objects
  for select using (bucket_id = 'announcer-sounds' and public.is_staff());

drop policy if exists announcer_sounds_staff_write on storage.objects;
create policy announcer_sounds_staff_write on storage.objects
  for all using (bucket_id = 'announcer-sounds' and public.is_staff())
  with check (bucket_id = 'announcer-sounds' and public.is_staff());


-- ── announcer_devices: one row per speaker ──────────────────────────────────
-- Authentication mirrors what the registers already do. pos_devices stores a
-- scrypt hash in provision_hash and src/lib/pos/sync-store.ts checks the
-- presented key against it. A Pi is the same kind of thing as a register -- a
-- box in the building holding a long-lived secret -- so it gets the same
-- treatment rather than a second invention.
create table if not exists public.announcer_devices (
  id                uuid primary key default gen_random_uuid(),
  -- What the room is called. "Office", "Sales Floor", "Storage".
  name              text not null,
  -- scrypt hash of the device key. The plaintext key exists exactly once, on
  -- the Pi, written there by the installer. It is never stored here.
  device_key_hash   text not null,
  -- Turned off from the back office without unpairing or unplugging anything.
  enabled           boolean not null default true,
  -- 0..100. The core clamps and defaults this; see normalizeVolume().
  volume            integer not null default 70 check (volume between 0 and 100),
  -- A built-in sound id ('chime', 'bell', ...). See BUILT_IN_SOUNDS.
  sound_id          text,
  -- Storage path inside the announcer-sounds bucket, when the shop has
  -- uploaded its own audio for this speaker. Null means use sound_id.
  custom_sound_path text,
  -- Updated on every heartbeat and every poll. This single column is what
  -- drives the green/amber/red dot; see deviceHealth() in announcer-core.ts.
  last_seen_at      timestamptz,
  -- Free text the Pi reports about itself (OS build, agent version, audio
  -- output device). Purely diagnostic, so a support conversation can start
  -- from fact instead of from questions.
  agent_info        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists announcer_devices_enabled_idx
  on public.announcer_devices (enabled) where enabled;
create index if not exists announcer_devices_last_seen_idx
  on public.announcer_devices (last_seen_at desc nulls last);

drop trigger if exists announcer_devices_updated_at on public.announcer_devices;
create trigger announcer_devices_updated_at
  before update on public.announcer_devices
  for each row execute function public.set_updated_at();


-- ── announcer_pairings: short-lived setup codes ─────────────────────────────
-- The code is read off a laptop screen in one room and typed into a Pi in
-- another, so it uses an alphabet with 0, O, 1, I and L removed and it dies
-- after an hour. Single use: consumed_at is stamped the moment it works.
create table if not exists public.announcer_pairings (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  -- Pre-filled name so the device names itself the moment it pairs and nobody
  -- ends up with three cards all called "New Speaker".
  device_name  text not null,
  consumed_at  timestamptz,
  -- Which device this code created, once it has been used. Kept for the audit
  -- trail: "where did this speaker come from" should always have an answer.
  device_id    uuid references public.announcer_devices(id) on delete set null,
  created_by   uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists announcer_pairings_open_idx
  on public.announcer_pairings (created_at desc) where consumed_at is null;


-- ── announcer_queue: the work ───────────────────────────────────────────────
-- One row per (event, device). Fan-out happens at write time rather than at
-- read time so that each Pi's poll is a trivial indexed lookup on its own id
-- and two Pis can never contend over the same row.
create table if not exists public.announcer_queue (
  id           bigserial primary key,
  device_id    uuid not null references public.announcer_devices(id) on delete cascade,
  -- 'order' for a real online order, 'test' for a back-office Test press.
  kind         text not null default 'order' check (kind in ('order','test')),
  -- The order that caused this, when there was one. Nullable because a Test
  -- press has no order behind it.
  order_id     uuid,
  -- What the speaker says out loud, already resolved by announcementText().
  -- Stored rather than recomputed so the activity log shows exactly what was
  -- said, not what we would say if we recomputed it today.
  message      text not null,
  -- Resolved at enqueue time by resolveSound(): a built-in id or a bucket
  -- path. Stored for the same reason as message.
  sound        text not null,
  volume       integer not null default 70 check (volume between 0 and 100),
  -- Lease, not a delete. Set when a Pi takes the job; cleared implicitly by
  -- lapsing, so a Pi that dies mid-play cannot swallow the announcement.
  claimed_at   timestamptz,
  -- Set when the Pi confirms it actually played. This is the only proof of
  -- delivery we have, so it is the only thing that retires a row.
  delivered_at timestamptz,
  attempts     integer not null default 0,
  created_at   timestamptz not null default now()
);

-- The hot path: "what work is waiting for MY device". Partial on
-- delivered_at is null so the index stays small forever no matter how much
-- history accumulates.
create index if not exists announcer_queue_pending_idx
  on public.announcer_queue (device_id, created_at)
  where delivered_at is null;

-- The activity log on the back-office page reads newest-first across all
-- devices.
create index if not exists announcer_queue_recent_idx
  on public.announcer_queue (created_at desc);


-- ── announcer_sounds: the shop's own uploads ────────────────────────────────
-- The bytes live in the private bucket. This table is the catalogue, so the
-- back office can list, label and delete without ever enumerating storage.
create table if not exists public.announcer_sounds (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  -- Path inside the announcer-sounds bucket. Unique because two rows pointing
  -- at one object makes deletion ambiguous.
  storage_path text not null unique,
  mime_type    text,
  bytes        bigint,
  duration_ms  integer,
  uploaded_by  uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);


-- ── announcer_settings: one row, shop-wide ──────────────────────────────────
-- Single row enforced by a primary key check rather than by convention,
-- because "there should only be one" enforced by hope is how you get two.
create table if not exists public.announcer_settings (
  id                  integer primary key default 1 check (id = 1),
  -- The master switch. One place to silence everything during an inspection
  -- or an event, without touching individual speakers.
  enabled             boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_start         text not null default '21:00',
  quiet_end           text not null default '08:00',
  -- Fallback when a device has no sound of its own, or when its custom upload
  -- has been deleted. resolveSound() guarantees this path can never end in
  -- silence.
  default_sound_id    text not null default 'chime',
  default_volume      integer not null default 70 check (default_volume between 0 and 100),
  updated_at          timestamptz not null default now()
);

insert into public.announcer_settings (id) values (1)
on conflict (id) do nothing;

drop trigger if exists announcer_settings_updated_at on public.announcer_settings;
create trigger announcer_settings_updated_at
  before update on public.announcer_settings
  for each row execute function public.set_updated_at();


-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Staff may READ everything, so the back-office page works for anyone with
-- orders.view. Nothing here grants insert, update or delete to a browser
-- session: every write goes through a server route holding the service key,
-- which is where permission is actually enforced (see src/lib/auth/roles.ts --
-- orders.view for looking, settings.manage for changing). Note especially that
-- announcer_devices is readable but device_key_hash is a hash, and the Pi's
-- plaintext key never exists in this database at all.
alter table public.announcer_devices  enable row level security;
alter table public.announcer_pairings enable row level security;
alter table public.announcer_queue    enable row level security;
alter table public.announcer_sounds   enable row level security;
alter table public.announcer_settings enable row level security;

drop policy if exists announcer_devices_staff_read on public.announcer_devices;
create policy announcer_devices_staff_read on public.announcer_devices
  for select using (public.is_staff());

drop policy if exists announcer_pairings_staff_read on public.announcer_pairings;
create policy announcer_pairings_staff_read on public.announcer_pairings
  for select using (public.is_staff());

drop policy if exists announcer_queue_staff_read on public.announcer_queue;
create policy announcer_queue_staff_read on public.announcer_queue
  for select using (public.is_staff());

drop policy if exists announcer_sounds_catalog_staff_read on public.announcer_sounds;
create policy announcer_sounds_catalog_staff_read on public.announcer_sounds
  for select using (public.is_staff());

drop policy if exists announcer_settings_staff_read on public.announcer_settings;
create policy announcer_settings_staff_read on public.announcer_settings
  for select using (public.is_staff());


-- ── announcer_claim_work: hand a device its jobs, atomically ────────────────
--
-- FOR UPDATE SKIP LOCKED is the whole trick. Two polls arriving in the same
-- millisecond cannot hand out the same row: the second one skips what the
-- first has locked instead of blocking behind it. That is what lets the Pi
-- poll aggressively without ever double-playing an announcement.
--
-- The WHERE clause encodes the three rules the pure core proves:
--
--   * delivered_at is null       -- not already played
--   * created_at > now() - ttl   -- not stale. A speaker unplugged over lunch
--                                   must NOT come back and shout eleven old
--                                   orders at the sales floor; stale news
--                                   teaches everyone to ignore the speaker.
--   * claimed_at is null OR the lease has lapsed -- nobody else is on it, or
--                                   whoever was has clearly died.
--
-- These duplicate isClaimable() in announcer-core.ts on purpose. The core is
-- what CI proves and what the UI reasons with; this is the enforcement point
-- that no race can slip past. Both must agree, and the constants are passed in
-- from the core rather than hard-coded here so they cannot drift apart.
create or replace function public.announcer_claim_work(
  p_device_id     uuid,
  p_limit         integer default 5,
  p_ttl_seconds   integer default 900,
  p_lease_seconds integer default 60
)
returns table (
  id         bigint,
  kind       text,
  message    text,
  sound      text,
  volume     integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select q.id
    from public.announcer_queue q
    where q.device_id = p_device_id
      and q.delivered_at is null
      and q.created_at > now() - make_interval(secs => p_ttl_seconds)
      and (
        q.claimed_at is null
        or q.claimed_at < now() - make_interval(secs => p_lease_seconds)
      )
    order by q.created_at asc
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update public.announcer_queue q
     set claimed_at = now(),
         attempts   = q.attempts + 1
    from claimed c
   where q.id = c.id
  returning q.id, q.kind, q.message, q.sound, q.volume, q.created_at;
end;
$$;

revoke all on function public.announcer_claim_work(uuid, integer, integer, integer) from public;


-- ── announcer_expire_stale: housekeeping ────────────────────────────────────
-- Marks anything past its TTL as delivered so it stops being considered and
-- the partial index stays small. Returns how many it retired, so the caller
-- can log a real number instead of "done".
create or replace function public.announcer_expire_stale(
  p_ttl_seconds integer default 900
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.announcer_queue
     set delivered_at = now()
   where delivered_at is null
     and created_at <= now() - make_interval(secs => p_ttl_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.announcer_expire_stale(integer) from public;
