-- =============================================================================
-- 0052_sage_helper.sql  (Slice 56)
--
-- Sage 50 helper: uploaded-report storage + a grounded Sage 50 Quantum AI chat.
--
-- Adds:
--   1. private storage bucket 'sage-imports' for the reports the owner uploads
--      (Cultivera / POS exports they use to key data into Sage). Staff read/write.
--   2. sage_import_uploads  — metadata + a light AGGREGATE summary extracted from
--      each upload (row count, detected columns, obvious totals) that the AI uses
--      to draft General-Journal mapping suggestions. No PII is stored in summary.
--   3. sage_chat_messages   — the Sage 50 AI helper conversation history (one row
--      per message; role user|assistant). Grounded on docs/sage50-knowledge.md.
--
-- NOTE: .ptb Sage backups are proprietary/compressed and are NOT parsed — this
--       migration stores uploaded CSV/Excel/PDF reports only (enforced in code).
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =============================================================================

-- ── private bucket for uploaded Sage-import reports ─────────────────────────
insert into storage.buckets (id, name, public)
values ('sage-imports', 'sage-imports', false)
on conflict (id) do nothing;

drop policy if exists sage_imports_staff_read on storage.objects;
create policy sage_imports_staff_read on storage.objects
  for select using (bucket_id = 'sage-imports' and public.is_staff());

drop policy if exists sage_imports_staff_write on storage.objects;
create policy sage_imports_staff_write on storage.objects
  for all using (bucket_id = 'sage-imports' and public.is_staff())
  with check (bucket_id = 'sage-imports' and public.is_staff());

-- ── uploaded report metadata + extracted aggregate summary ──────────────────
create table if not exists public.sage_import_uploads (
  id               uuid primary key default gen_random_uuid(),
  file_name        text not null,
  storage_path     text not null,
  content_type     text,
  file_bytes       integer,
  -- report_kind: cultivera_sales | cultivera_inventory | pos_summary | gl_export | trial_balance | other
  report_kind      text not null default 'other',
  -- light aggregate extraction (row count, detected headers, obvious totals). JSON.
  summary          jsonb,
  notes            text,
  uploaded_by      uuid references public.staff_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists sage_import_uploads_created_idx
  on public.sage_import_uploads (created_at desc);

drop trigger if exists sage_import_uploads_set_updated_at on public.sage_import_uploads;
create trigger sage_import_uploads_set_updated_at
  before update on public.sage_import_uploads
  for each row execute function public.set_updated_at();

alter table public.sage_import_uploads enable row level security;

drop policy if exists sage_import_uploads_staff_read on public.sage_import_uploads;
create policy sage_import_uploads_staff_read on public.sage_import_uploads
  for select using (public.is_staff());

drop policy if exists sage_import_uploads_staff_write on public.sage_import_uploads;
create policy sage_import_uploads_staff_write on public.sage_import_uploads
  for all using (public.is_staff()) with check (public.is_staff());

-- ── Sage 50 AI helper conversation history ──────────────────────────────────
create table if not exists public.sage_chat_messages (
  id           uuid primary key default gen_random_uuid(),
  -- role: user | assistant
  role         text not null check (role in ('user','assistant')),
  content      text not null,
  -- optional: which upload the question referenced (for context).
  upload_id    uuid references public.sage_import_uploads(id) on delete set null,
  author_id    uuid references public.staff_profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists sage_chat_messages_created_idx
  on public.sage_chat_messages (created_at);

alter table public.sage_chat_messages enable row level security;

drop policy if exists sage_chat_messages_staff_read on public.sage_chat_messages;
create policy sage_chat_messages_staff_read on public.sage_chat_messages
  for select using (public.is_staff());

drop policy if exists sage_chat_messages_staff_write on public.sage_chat_messages;
create policy sage_chat_messages_staff_write on public.sage_chat_messages
  for all using (public.is_staff()) with check (public.is_staff());
