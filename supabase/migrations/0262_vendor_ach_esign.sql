-- =============================================================================
-- Migration 0262 - R39 S7: vendor ACH form signed electronically, by link
-- =============================================================================
-- Owner request (R39, after S6): "i want the vendor side to also utilize the
-- e-sign feature. i need this process to be as simple and painless as
-- possible, so the participation rate is very high."
--
-- Employees sign in person (owner Q12). Vendors are businesses that are not
-- at the counter, so Greenway emails a one-time secure link. Nothing about
-- the link is trusted on its own; the existing controls still decide whether
-- a payment can ever go out:
--
--   sent          Michael or Stephen sends the link to an email address.
--                 Only a keyed hash of the link token is stored (token_hash).
--   code_sent     The vendor asked for a 6-digit code. It always goes to the
--                 address the invite was sent to (never one typed on the
--                 page). Only a keyed hash of the code is stored.
--   consented     The vendor typed the code back and agreed to sign
--                 electronically (E-SIGN 7001(c) disclosure, RCW 1.80.040(2)
--                 agreement to transact electronically). The browser that did
--                 this gets a cookie; only its hash is stored (browser_digest),
--                 so a forwarded link cannot be used to sign.
--   signed        The vendor filled in Parts 1 and 2, attached bank proof,
--                 and typed name and title under the intent statement.
--                 vendor_esign_complete files everything in ONE transaction:
--                 the record PDF, the certificate PDF, the bank proof, a
--                 vendor ach_authorizations row ('signed', 'esign'), and the
--                 vault banking, which the 0259 trigger puts ON HOLD.
--   countersigned Greenway's acceptance (form Part 6, Terms 1.1: the agreement
--                 takes effect on countersignature). Only allowed after the
--                 vault hold was released AFTER the signing, which under 0259
--                 needs a callback and dual (or reasoned solo) approval.
--   rejected      The callback failed or something is wrong. The
--                 authorization is revoked and the vault stays on hold.
--   cancelled     Before signing, with a reason.
--
-- The vault row is attributed to the person who sent the invite
-- (updated_by), so 0259 treats a release by the OTHER owner as "dual" and a
-- release by the sender as "solo" (20+ character reason). The vendor is not a
-- staff member and is never recorded as a staff actor.
--
-- Contacts the vendor types (Part 1) are stored in the form JSON only. They
-- are NOT added to payee_contacts: a callback must use a number Greenway
-- already has or finds independently, never one supplied in the request
-- (GW-ACH-V Terms 8.1; Nacha 2026 fraud monitoring, "False Pretenses").
--
-- Idempotent: safe to paste and re-run in the Supabase SQL editor. Apply
-- MANUALLY (standing rule), AFTER 0258, 0259, 0260 and 0261.
-- Rollback: supabase/rollbacks/0262_vendor_ach_esign.rollback.sql
-- =============================================================================

create table if not exists public.vendor_esign_invites (
  id                       uuid primary key default gen_random_uuid(),
  vendor_id                uuid not null references public.vendors (id) on delete restrict,
  state                    text not null default 'sent'
                             check (state in ('sent', 'code_sent', 'consented', 'signed', 'countersigned', 'rejected', 'cancelled')),
  token_hash               text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by               uuid not null references public.staff_profiles (id) on delete restrict,
  invited_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  email_enc                text not null check (email_enc like 'encv1:%'),
  email_masked             text not null check (length(email_masked) between 5 and 260),
  email_on_file            boolean not null default false,
  recipient_name           text not null check (length(trim(recipient_name)) between 2 and 120),
  first_opened_at          timestamptz,
  otp_digest               text check (otp_digest is null or otp_digest ~ '^[0-9a-f]{64}$'),
  otp_sent_at              timestamptz,
  otp_sends                smallint not null default 0 check (otp_sends between 0 and 5),
  otp_attempts             smallint not null default 0 check (otp_attempts between 0 and 5),
  code_verified_at         timestamptz,
  browser_digest           text check (browser_digest is null or browser_digest ~ '^[0-9a-f]{64}$'),
  disclosure_version       text,
  disclosure_sha256        text check (disclosure_sha256 is null or disclosure_sha256 ~ '^[0-9a-f]{64}$'),
  consented_at             timestamptz,
  -- Bank proof, uploaded while consented; filed as a document at signing.
  proof_storage_path       text check (proof_storage_path is null or proof_storage_path like 'ach-docs/vendor/%'),
  proof_sha256             text check (proof_sha256 is null or proof_sha256 ~ '^[0-9a-f]{64}$'),
  proof_byte_size          bigint check (proof_byte_size is null or (proof_byte_size > 0 and proof_byte_size <= 26214400)),
  proof_mime               text check (proof_mime is null or proof_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic')),
  proof_kind               text check (proof_kind is null or proof_kind in ('voided_check', 'bank_letter', 'other')),
  proof_filename           text check (proof_filename is null or length(proof_filename) <= 180),
  -- What the vendor typed (Parts 1 and 2), without bank numbers.
  form                     jsonb,
  -- The exact ciphertext written to the vault at signing. Countersigning
  -- checks the vault still holds THESE bytes, so banking edited by anyone
  -- after the vendor signed can never be accepted under this signature.
  bank_routing_enc         text check (bank_routing_enc is null or bank_routing_enc like 'encv1:%'),
  bank_account_enc         text check (bank_account_enc is null or bank_account_enc like 'encv1:%'),
  bank_account_type        text check (bank_account_type is null or bank_account_type in ('checking', 'savings')),
  account_key_hmac         text check (account_key_hmac is null or account_key_hmac ~ '^[0-9a-f]{64}$'),
  account_last4            text check (account_last4 is null or account_last4 ~ '^[0-9]{1,4}$'),
  routing_last4            text check (routing_last4 is null or routing_last4 ~ '^[0-9]{4}$'),
  signed_at                timestamptz,
  signer_name              text,
  signer_title             text,
  signer_ip                text check (signer_ip is null or length(signer_ip) <= 45),
  signer_user_agent        text check (signer_user_agent is null or length(signer_user_agent) <= 400),
  record_document_id       uuid references public.ach_authorization_documents (id) on delete restrict,
  certificate_document_id  uuid references public.ach_authorization_documents (id) on delete restrict,
  proof_document_id        uuid references public.ach_authorization_documents (id) on delete restrict,
  authorization_id         uuid references public.ach_authorizations (id) on delete restrict,
  countersigned_by         uuid references public.staff_profiles (id) on delete restrict,
  countersigned_at         timestamptz,
  countersign_note         text,
  countersign_document_id  uuid references public.ach_authorization_documents (id) on delete restrict,
  rejected_by              uuid references public.staff_profiles (id) on delete restrict,
  rejected_at              timestamptz,
  reject_reason            text,
  cancelled_by             uuid references public.staff_profiles (id) on delete restrict,
  cancelled_at             timestamptz,
  cancel_reason            text,
  constraint vesign_expiry_window check (expires_at > invited_at and expires_at <= invited_at + interval '30 days'),
  constraint vesign_code_sent_shape check (
    state in ('sent', 'cancelled') or (otp_digest is not null and otp_sent_at is not null and otp_sends >= 1)
  ),
  constraint vesign_consented_shape check (
    state not in ('consented', 'signed', 'countersigned', 'rejected')
    or (code_verified_at is not null and consented_at is not null and browser_digest is not null
        and disclosure_version is not null and disclosure_sha256 is not null)
  ),
  constraint vesign_proof_shape check (
    (proof_storage_path is null) = (proof_sha256 is null)
    and (proof_storage_path is null) = (proof_byte_size is null)
    and (proof_storage_path is null) = (proof_mime is null)
    and (proof_storage_path is null) = (proof_kind is null)
  ),
  constraint vesign_signed_shape check (
    state not in ('signed', 'countersigned', 'rejected')
    or (signed_at is not null and coalesce(length(trim(signer_name)), 0) >= 3 and coalesce(length(trim(signer_title)), 0) >= 2
        and form is not null and bank_routing_enc is not null and bank_account_enc is not null and bank_account_type is not null
        and account_key_hmac is not null and account_last4 is not null and routing_last4 is not null
        and record_document_id is not null and certificate_document_id is not null and proof_document_id is not null
        and authorization_id is not null and record_document_id <> certificate_document_id)
  ),
  constraint vesign_countersigned_shape check (
    (state = 'countersigned') = (countersigned_at is not null and countersigned_by is not null and countersign_document_id is not null)
  ),
  constraint vesign_rejected_shape check (
    (state = 'rejected') = (rejected_at is not null and rejected_by is not null)
    and (state <> 'rejected' or coalesce(length(trim(reject_reason)), 0) >= 10)
  ),
  constraint vesign_cancelled_shape check (
    (state = 'cancelled') = (cancelled_at is not null)
    and (state <> 'cancelled' or coalesce(length(trim(cancel_reason)), 0) >= 5)
  )
);

-- One open invite per vendor: a link in flight, or a signed form waiting for
-- Greenway's callback and countersignature.
create unique index if not exists vendor_esign_one_open_per_vendor
  on public.vendor_esign_invites (vendor_id)
  where state in ('sent', 'code_sent', 'consented', 'signed');
create index if not exists vendor_esign_vendor_idx on public.vendor_esign_invites (vendor_id, invited_at desc);
create index if not exists vendor_esign_account_key_idx on public.vendor_esign_invites (account_key_hmac) where account_key_hmac is not null;

create or replace function public.vendor_esign_guard()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  allowed text[];
  frozen  text[] := array['state', 'countersigned_by', 'countersigned_at', 'countersign_note', 'countersign_document_id',
                          'rejected_by', 'rejected_at', 'reject_reason'];
begin
  if tg_op = 'DELETE' then
    if old.state in ('signed', 'countersigned', 'rejected') then
      raise exception 'VENDOR_ESIGN_KEEP: signed invite % is evidence and is kept with the authorization.', old.id;
    end if;
    return old;
  end if;
  if old.state in ('countersigned', 'rejected', 'cancelled') then
    raise exception 'VENDOR_ESIGN_FINAL: invite % is % and cannot change.', old.id, old.state;
  end if;
  if new.vendor_id is distinct from old.vendor_id
     or new.token_hash is distinct from old.token_hash
     or new.invited_by is distinct from old.invited_by
     or new.invited_at is distinct from old.invited_at
     or new.expires_at is distinct from old.expires_at
     or new.email_enc is distinct from old.email_enc
     or new.email_on_file is distinct from old.email_on_file
     or new.recipient_name is distinct from old.recipient_name then
    raise exception 'VENDOR_ESIGN_IMMUTABLE: who, where and when of invite % cannot change.', old.id;
  end if;
  if old.first_opened_at is not null and new.first_opened_at is distinct from old.first_opened_at then
    raise exception 'VENDOR_ESIGN_IMMUTABLE: first opened time of invite % cannot change.', old.id;
  end if;
  if new.otp_attempts < old.otp_attempts or new.otp_sends < old.otp_sends then
    raise exception 'VENDOR_ESIGN_COUNTERS: code counters of invite % only go up.', old.id;
  end if;
  if new.state is distinct from old.state then
    allowed := case old.state
      when 'sent'      then array['code_sent', 'cancelled']
      when 'code_sent' then array['consented', 'cancelled']
      when 'consented' then array['code_sent', 'signed', 'cancelled']
      when 'signed'    then array['countersigned', 'rejected']
      else array[]::text[]
    end;
    if not (new.state = any (allowed)) then
      raise exception 'VENDOR_ESIGN_TRANSITION: % -> % is not allowed.', old.state, new.state;
    end if;
  end if;
  -- A signed form is frozen: only the countersign / reject facts may be added.
  if old.state = 'signed'
     and (to_jsonb(new) - frozen) is distinct from (to_jsonb(old) - frozen) then
    raise exception 'VENDOR_ESIGN_SIGNED: the signed form of invite % cannot change.', old.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_vendor_esign_guard on public.vendor_esign_invites;
create trigger trg_vendor_esign_guard
  before update or delete on public.vendor_esign_invites
  for each row execute function public.vendor_esign_guard();

-- -----------------------------------------------------------------------------
-- vendor_esign_complete: the vendor's signature, all at once.
-- -----------------------------------------------------------------------------
create or replace function public.vendor_esign_complete(
  p_invite_id    uuid,
  p_signed_at    timestamptz,
  p_ip           text,
  p_user_agent   text,
  p_signer_name  text,
  p_signer_title text,
  p_form         jsonb,
  p_bank         jsonb,
  p_record       jsonb,
  p_certificate  jsonb
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  s        public.vendor_esign_invites%rowtype;
  old_auth public.ach_authorizations%rowtype;
  vb       public.vendor_bank_details%rowtype;
  new_id   uuid;
  rec_id   uuid;
  cert_id  uuid;
  proof_id uuid;
  prefix   text;
  signed_d date;
  legal    text;
  hold     text;
begin
  if p_signed_at is null or p_signed_at > now() + interval '1 minute' then
    raise exception 'VENDOR_ESIGN_TIME: the signing time is missing or in the future.' using errcode = 'check_violation';
  end if;
  select * into s from public.vendor_esign_invites where id = p_invite_id for update;
  if not found then
    raise exception 'VENDOR_ESIGN_NOT_FOUND: invite %.', p_invite_id using errcode = 'check_violation';
  end if;
  if s.state <> 'consented' then
    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not ready to sign.', s.id, s.state using errcode = 'check_violation';
  end if;
  if now() > s.expires_at then
    raise exception 'VENDOR_ESIGN_EXPIRED: the link for invite % has expired.', s.id using errcode = 'check_violation';
  end if;
  if s.code_verified_at < now() - interval '24 hours' then
    raise exception 'VENDOR_ESIGN_STALE: the code for invite % was confirmed more than 24 hours ago. Send a new code.', s.id
      using errcode = 'check_violation';
  end if;
  if s.proof_storage_path is null then
    raise exception 'VENDOR_ESIGN_PROOF: attach a voided check, bank letter or statement page first.' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_signer_name)), 0) < 3 or length(trim(p_signer_name)) > 120 or position(' ' in trim(p_signer_name)) = 0 then
    raise exception 'VENDOR_ESIGN_NAME: type the signer''s full name (first and last).' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_signer_title)), 0) < 2 or length(trim(p_signer_title)) > 80 then
    raise exception 'VENDOR_ESIGN_TITLE: type the signer''s title (for example Owner or CFO).' using errcode = 'check_violation';
  end if;
  legal := trim(coalesce(p_form->>'legal_name', ''));
  if p_form is null or jsonb_typeof(p_form) <> 'object' or length(legal) < 2
     or coalesce(p_form->>'request_type', '') not in ('new', 'change') then
    raise exception 'VENDOR_ESIGN_FORM: the vendor information is incomplete.' using errcode = 'check_violation';
  end if;
  if p_bank is null
     or coalesce(p_bank->>'routing_enc', '') not like 'encv1:%'
     or coalesce(p_bank->>'account_enc', '') not like 'encv1:%'
     or coalesce(p_bank->>'account_type', '') not in ('checking', 'savings')
     or coalesce(p_bank->>'account_last4', '') !~ '^[0-9]{1,4}$'
     or coalesce(p_bank->>'routing_last4', '') !~ '^[0-9]{4}$'
     or coalesce(p_bank->>'account_key_hmac', '') !~ '^[0-9a-f]{64}$'
     or length(trim(coalesce(p_bank->>'bank_name', ''))) < 2 then
    raise exception 'VENDOR_ESIGN_BANK: the bank details are incomplete or not encrypted.' using errcode = 'check_violation';
  end if;
  prefix := 'ach-docs/vendor/' || s.vendor_id::text || '/';
  if p_record is null or p_certificate is null
     or left(coalesce(p_record->>'storage_path', ''), length(prefix)) <> prefix
     or left(coalesce(p_certificate->>'storage_path', ''), length(prefix)) <> prefix
     or left(s.proof_storage_path, length(prefix)) <> prefix
     or (p_record->>'sha256') = (p_certificate->>'sha256') then
    raise exception 'VENDOR_ESIGN_FILES: the record and the certificate must be two stored PDFs in this vendor''s folder.' using errcode = 'check_violation';
  end if;
  signed_d := (p_signed_at at time zone 'America/Los_Angeles')::date;

  insert into public.ach_authorization_documents
    (payee_type, vendor_id, kind, storage_path, sha256, byte_size, mime_type, original_filename, intake_status, uploaded_by)
  values
    ('vendor', s.vendor_id, 'signed_form', p_record->>'storage_path', p_record->>'sha256', (p_record->>'byte_size')::bigint,
     'application/pdf', 'GW-ACH-V-esigned.pdf', 'received', null)
  returning id into rec_id;
  insert into public.ach_authorization_documents
    (payee_type, vendor_id, kind, storage_path, sha256, byte_size, mime_type, original_filename, intake_status, uploaded_by)
  values
    ('vendor', s.vendor_id, 'esign_certificate', p_certificate->>'storage_path', p_certificate->>'sha256', (p_certificate->>'byte_size')::bigint,
     'application/pdf', 'GW-ACH-V-esign-certificate.pdf', 'received', null)
  returning id into cert_id;
  -- The same proof file may already be on file for this vendor (ach_doc_sha_per_payee).
  select id into proof_id from public.ach_authorization_documents
   where payee_type = 'vendor' and vendor_id = s.vendor_id and sha256 = s.proof_sha256;
  if found and exists (select 1 from public.ach_authorization_documents where id = proof_id and intake_status = 'rejected') then
    raise exception 'VENDOR_ESIGN_PROOF: this bank proof file was rejected before. Attach a different one.' using errcode = 'check_violation';
  end if;
  if not found then
    insert into public.ach_authorization_documents
      (payee_type, vendor_id, kind, storage_path, sha256, byte_size, mime_type, original_filename, intake_status, uploaded_by)
    values
      ('vendor', s.vendor_id, s.proof_kind, s.proof_storage_path, s.proof_sha256, s.proof_byte_size,
       s.proof_mime, coalesce(s.proof_filename, ''), 'received', null)
    returning id into proof_id;
  end if;

  select * into old_auth from public.ach_authorizations
   where payee_type = 'vendor' and vendor_id = s.vendor_id
     and state not in ('revoked', 'archived')
   for update;
  if found then
    update public.ach_authorizations
       set state = 'archived',
           ended_on = greatest(current_date, coalesce(old_auth.signed_on, current_date)),
           ended_reason = format('Superseded by a vendor e-signed form (invite %s).', s.id)
     where id = old_auth.id;
    insert into public.ach_authorization_events (authorization_id, payee_type, vendor_id, event_kind, actor_id, detail)
    values (old_auth.id, 'vendor', s.vendor_id, 'authorization_superseded', null,
            jsonb_build_object('vendor_esign_invite_id', s.id, 'document_id', rec_id, 'previous_state', old_auth.state));
  end if;

  insert into public.ach_authorizations
    (payee_type, vendor_id, payee_name, state, signature_method, signed_on, created_by, updated_by)
  values
    ('vendor', s.vendor_id, left(legal, 200), 'signed', 'esign', signed_d, null, null)
  returning id into new_id;

  update public.ach_authorization_documents
     set intake_status = 'accepted', authorization_id = new_id,
         intake_note = format('Vendor e-signed by link (invite %s).', s.id)
   where id in (rec_id, cert_id);
  update public.ach_authorization_documents
     set authorization_id = coalesce(authorization_id, new_id),
         intake_status = case when intake_status in ('received', 'extracted') then 'accepted' else intake_status end,
         intake_note = coalesce(intake_note, format('Bank proof attached to vendor e-sign (invite %s).', s.id))
   where id = proof_id;

  -- The vault. 0259 puts new or changed banking ON HOLD and stamps the author.
  hold := format('Vendor e-signed new banking by link (invite %s); call back before release.', s.id);
  select * into vb from public.vendor_bank_details where vendor_id = s.vendor_id for update;
  if found then
    update public.vendor_bank_details
       set vendor_name = left(legal, 200), bank_name = left(trim(p_bank->>'bank_name'), 120),
           bank_routing = p_bank->>'routing_enc', bank_account_number = p_bank->>'account_enc',
           bank_account_type = p_bank->>'account_type', hold_reason = hold, updated_by = s.invited_by,
           status = 'on_hold'
     where id = vb.id;
  else
    insert into public.vendor_bank_details
      (vendor_id, vendor_name, bank_name, bank_routing, bank_account_number, bank_account_type, status, hold_reason, created_by, updated_by)
    values
      (s.vendor_id, left(legal, 200), left(trim(p_bank->>'bank_name'), 120), p_bank->>'routing_enc', p_bank->>'account_enc',
       p_bank->>'account_type', 'on_hold', hold, s.invited_by, s.invited_by);
  end if;

  -- Signing is opting in: clear "needs bank info" and any earlier opt-out.
  update public.vendors
     set ach_needs_bank_info = false, ach_opted_out = false, ach_opted_out_at = null
   where id = s.vendor_id;

  update public.vendor_esign_invites
     set state = 'signed', signed_at = p_signed_at,
         signer_name = left(trim(p_signer_name), 120), signer_title = left(trim(p_signer_title), 80),
         signer_ip = left(p_ip, 45), signer_user_agent = left(p_user_agent, 400),
         form = p_form, account_key_hmac = p_bank->>'account_key_hmac',
         bank_routing_enc = p_bank->>'routing_enc', bank_account_enc = p_bank->>'account_enc',
         bank_account_type = p_bank->>'account_type',
         account_last4 = p_bank->>'account_last4', routing_last4 = p_bank->>'routing_last4',
         record_document_id = rec_id, certificate_document_id = cert_id, proof_document_id = proof_id,
         authorization_id = new_id
   where id = s.id;

  insert into public.ach_authorization_events (authorization_id, payee_type, vendor_id, event_kind, actor_id, detail)
  values
    (new_id, 'vendor', s.vendor_id, 'vendor_esign_signed', null,
     jsonb_build_object('vendor_esign_invite_id', s.id, 'invited_by', s.invited_by, 'document_id', rec_id,
                        'certificate_document_id', cert_id, 'proof_document_id', proof_id,
                        'record_sha256', p_record->>'sha256', 'account_last4', p_bank->>'account_last4',
                        'request_type', p_form->>'request_type',
                        'replaced', case when old_auth.id is null then null else old_auth.id end));
  return new_id;
end $$;

-- -----------------------------------------------------------------------------
-- vendor_esign_countersign: Greenway's acceptance (form Part 6).
-- -----------------------------------------------------------------------------
create or replace function public.vendor_esign_countersign(
  p_invite_id uuid,
  p_actor     uuid,
  p_note      text,
  p_document  jsonb
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  s      public.vendor_esign_invites%rowtype;
  vb     public.vendor_bank_details%rowtype;
  a      public.ach_authorizations%rowtype;
  doc_id uuid;
  prefix text;
  today  date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if p_actor is null then
    raise exception 'VENDOR_ESIGN_ACTOR: the Greenway signer must be recorded.' using errcode = 'check_violation';
  end if;
  select * into s from public.vendor_esign_invites where id = p_invite_id for update;
  if not found then
    raise exception 'VENDOR_ESIGN_NOT_FOUND: invite %.', p_invite_id using errcode = 'check_violation';
  end if;
  if s.state <> 'signed' then
    raise exception 'VENDOR_ESIGN_STATE: invite % is %, not waiting for a countersignature.', s.id, s.state using errcode = 'check_violation';
  end if;
  select * into vb from public.vendor_bank_details where vendor_id = s.vendor_id;
  if not found or vb.status <> 'active' or vb.released_at is null or vb.released_at <= s.signed_at
     or vb.bank_routing is distinct from s.bank_routing_enc
     or vb.bank_account_number is distinct from s.bank_account_enc
     or vb.bank_account_type is distinct from s.bank_account_type then
    raise exception 'VENDOR_ESIGN_NOT_RELEASED: call the vendor back and release the vault hold for the banking this vendor signed (unchanged since) before countersigning.'
      using errcode = 'check_violation';
  end if;
  prefix := 'ach-docs/vendor/' || s.vendor_id::text || '/';
  if p_document is null or left(coalesce(p_document->>'storage_path', ''), length(prefix)) <> prefix then
    raise exception 'VENDOR_ESIGN_FILES: the acceptance must be a stored PDF in this vendor''s folder.' using errcode = 'check_violation';
  end if;
  select * into a from public.ach_authorizations where id = s.authorization_id for update;
  if not found or a.state not in ('signed', 'verifying') then
    raise exception 'VENDOR_ESIGN_AUTH: the authorization for invite % is not waiting for acceptance.', s.id using errcode = 'check_violation';
  end if;

  insert into public.ach_authorization_documents
    (authorization_id, payee_type, vendor_id, kind, storage_path, sha256, byte_size, mime_type, original_filename, intake_status, intake_note, uploaded_by)
  values
    (a.id, 'vendor', s.vendor_id, 'other', p_document->>'storage_path', p_document->>'sha256', (p_document->>'byte_size')::bigint,
     'application/pdf', 'GW-ACH-V-greenway-acceptance.pdf', 'accepted', format('Greenway countersignature (invite %s).', s.id), p_actor)
  returning id into doc_id;

  update public.ach_authorizations
     set state = 'active', annual_review_due_on = (today + interval '1 year')::date, updated_by = p_actor
   where id = a.id;

  update public.vendor_esign_invites
     set state = 'countersigned', countersigned_by = p_actor, countersigned_at = now(),
         countersign_note = nullif(left(trim(coalesce(p_note, '')), 500), ''), countersign_document_id = doc_id
   where id = s.id;

  insert into public.ach_authorization_events (authorization_id, payee_type, vendor_id, event_kind, actor_id, detail)
  values (a.id, 'vendor', s.vendor_id, 'vendor_esign_countersigned', p_actor,
          jsonb_build_object('vendor_esign_invite_id', s.id, 'document_id', doc_id, 'vault_released_by', vb.released_by,
                             'vault_release_mode', vb.release_mode, 'effective_on', today));
end $$;

-- -----------------------------------------------------------------------------
-- vendor_esign_reject: the callback failed or the form is wrong.
-- -----------------------------------------------------------------------------
create or replace function public.vendor_esign_reject(
  p_invite_id uuid,
  p_actor     uuid,
  p_reason    text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  s public.vendor_esign_invites%rowtype;
  a public.ach_authorizations%rowtype;
begin
  if p_actor is null then
    raise exception 'VENDOR_ESIGN_ACTOR: the Greenway signer must be recorded.' using errcode = 'check_violation';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'VENDOR_ESIGN_REASON: say why the form is rejected (10+ characters).' using errcode = 'check_violation';
  end if;
  select * into s from public.vendor_esign_invites where id = p_invite_id for update;
  if not found then
    raise exception 'VENDOR_ESIGN_NOT_FOUND: invite %.', p_invite_id using errcode = 'check_violation';
  end if;
  if s.state <> 'signed' then
    raise exception 'VENDOR_ESIGN_STATE: invite % is %, only a signed form waiting for acceptance can be rejected.', s.id, s.state
      using errcode = 'check_violation';
  end if;
  select * into a from public.ach_authorizations where id = s.authorization_id for update;
  if found and a.state in ('signed', 'verifying', 'on_hold') then
    update public.ach_authorizations
       set state = 'revoked', ended_on = greatest(current_date, coalesce(a.signed_on, current_date)),
           ended_reason = left(format('Vendor e-signed form rejected: %s', trim(p_reason)), 500), updated_by = p_actor
     where id = a.id;
  end if;
  -- Banking that was released after this signing goes back on hold.
  update public.vendor_bank_details
     set status = 'on_hold', hold_reason = left(format('Vendor e-signed form rejected (invite %s): %s', s.id, trim(p_reason)), 500),
         updated_by = p_actor
   where vendor_id = s.vendor_id and status = 'active';

  update public.vendor_esign_invites
     set state = 'rejected', rejected_by = p_actor, rejected_at = now(), reject_reason = left(trim(p_reason), 500)
   where id = s.id;

  insert into public.ach_authorization_events (authorization_id, payee_type, vendor_id, event_kind, actor_id, detail)
  values (s.authorization_id, 'vendor', s.vendor_id, 'vendor_esign_rejected', p_actor,
          jsonb_build_object('vendor_esign_invite_id', s.id, 'reason', left(trim(p_reason), 500)));
end $$;

-- -----------------------------------------------------------------------------
-- RLS + grants (same least-privilege pattern as 0258 / 0260 / 0261)
-- -----------------------------------------------------------------------------
alter table public.vendor_esign_invites enable row level security;
drop policy if exists vendor_esign_invites_admin on public.vendor_esign_invites;
create policy vendor_esign_invites_admin on public.vendor_esign_invites
  for all using (public.is_admin()) with check (public.is_admin());

revoke all on table public.vendor_esign_invites from anon;
revoke delete on table public.vendor_esign_invites from authenticated;
grant select, insert, update on table public.vendor_esign_invites to authenticated;
grant select, insert, update, delete on table public.vendor_esign_invites to service_role;

revoke all on function public.vendor_esign_complete(uuid, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.vendor_esign_complete(uuid, timestamptz, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.vendor_esign_countersign(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.vendor_esign_countersign(uuid, uuid, text, jsonb) to service_role;
revoke all on function public.vendor_esign_reject(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.vendor_esign_reject(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
