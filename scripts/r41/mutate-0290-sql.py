#!/usr/bin/env python3
"""scripts/r41/mutate-0290-sql.py - test the 0290 scenario check (R41 S17, the
notice-email table ach_notice_mail).

Each mutant weakens ONE rule in 0290. For each one:
  1. roll 0290 back (the rollback refuses if a notice-email row exists; the
     pg-check always rolls its own rows back, so the test database has none);
  2. apply the mutated migration text (from a temp file; the repo file is
     never written);
  3. run scripts/recon/ach-notice-mail-0290-pg-check.sql;
  4. expect it to FAIL (or the mutated migration not to apply).
The real 0290 is re-applied first (control) and last (control); the 0290 AND
the 0289 checks must print their PASSED line both times.

Two more probes, outside the mutant list:
  - "rolled back": with 0290 rolled back (no table), the 0290 check must FAIL;
  - "rollback refuses": with a notice-email row present (inside a transaction that
    is rolled back), the rollback must raise ROLLBACK REFUSED.

    PGURL='postgres://postgres:postgres@localhost:5432/greenway' python3 scripts/r41/mutate-0290-sql.py
"""
import os
import subprocess
import sys

PGURL = os.environ.get("PGURL") or sys.exit("set PGURL to a database with every migration applied")
MIG = "supabase/migrations/0290_ach_notice_mail.sql"
RB = "supabase/rollbacks/0290_ach_notice_mail.rollback.sql"
CHECK = "scripts/recon/ach-notice-mail-0290-pg-check.sql"
CHECK_PREV = "scripts/recon/ach-bank-watch-0289-pg-check.sql"
TMP = "/tmp/mut0290.sql"
TMP_RB = "/tmp/mut0290-rb.sql"


def psql_cmd(sql):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True)


def psql_file(path):
    return subprocess.run(["psql", PGURL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", path], capture_output=True, text=True)


def control(label):
    r = psql_file(RB)
    ap = psql_file(MIG)
    ck = psql_file(CHECK)
    cprev = psql_file(CHECK_PREV)
    ok = (
        r.returncode == 0 and ap.returncode == 0 and ck.returncode == 0 and cprev.returncode == 0
        and "ACH 0290 CHECK PASSED" in (ck.stdout + ck.stderr)
        and "ACH 0289 CHECK PASSED" in (cprev.stdout + cprev.stderr)
    )
    print(f"control ({label})", "pass" if ok else f"FAILED rb={r.returncode} apply={ap.returncode} check={ck.returncode} cprev={cprev.returncode} {(ck.stderr or cprev.stderr or ap.stderr or r.stderr)[-300:]}", flush=True)
    return ok


M = [
    # --- table checks ---
    ("mailbox-any", "mailbox           text not null check (mailbox ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,24}$'),", "mailbox           text not null,"),
    ("gmail-id-any", "gmail_id          text not null check (gmail_id ~ '^[0-9A-Za-z_-]{6,64}$'),", "gmail_id          text not null,"),
    ("from-domain-any", "from_domain       text check (from_domain is null or from_domain ~ '^[a-z0-9.-]{4,253}$'),", "from_domain       text,"),
    ("auth-any", "auth              text not null check (auth in ('pass', 'fail', 'unknown')),", "auth              text not null,"),
    ("link-verdict-any", "link_verdict      text not null check (link_verdict in ('none', 'portal_only', 'other_hosts')),", "link_verdict      text not null,"),
    ("note-short-ok", "handled_note      text check (handled_note is null or (length(trim(handled_note)) between 10 and 500 and", "handled_note      text check (handled_note is null or (length(trim(handled_note)) between 1 and 500 and"),
    ("note-digits-ok", "and replace(handled_note, '1-800-562-8761', '') !~ '[0-9]{7,}')),", "and true)),"),
    ("unique-dropped", "  constraint anm_unique_message unique (mailbox, gmail_id),\n", ""),
    ("shape-note-optional", "    or (state <> 'new' and handled_by is not null and handled_at is not null and handled_note is not null)", "    or (state <> 'new' and handled_by is not null and handled_at is not null)"),
    # --- guard ---
    ("delete-allowed", "  if tg_op = 'DELETE' then\n    raise exception 'NOTICE_MAIL_APPEND_ONLY: a notice email is never deleted.';", "  if false then\n    raise exception 'NOTICE_MAIL_APPEND_ONLY: a notice email is never deleted.';"),
    ("subject-plain-ok", "  if new.subject_enc not like 'encv1:%' or new.body_enc not like 'encv1:%' then", "  if new.body_enc not like 'encv1:%' then"),
    ("body-plain-ok", "  if new.subject_enc not like 'encv1:%' or new.body_enc not like 'encv1:%' then", "  if new.subject_enc not like 'encv1:%' then"),
    ("insert-marked-ok", "    if new.state <> 'new' then\n      raise exception 'NOTICE_MAIL_ONCE: a notice email is stored as new;", "    if false then\n      raise exception 'NOTICE_MAIL_ONCE: a notice email is stored as new;"),
    ("re-mark-ok", "  if old.state <> 'new' then", "  if false then"),
    ("fact-edit-ok", "  if new.state = 'new' then\n    raise exception 'NOTICE_MAIL_ONCE: the only change allowed", "  if false then\n    raise exception 'NOTICE_MAIL_ONCE: the only change allowed"),
    ("body-swap-ok", "     or new.subject_enc <> old.subject_enc or new.body_enc <> old.body_enc then", "     or new.subject_enc <> old.subject_enc then"),
    ("verdict-swap-ok", "     or new.auth <> old.auth or new.in_spam <> old.in_spam or new.link_verdict <> old.link_verdict", "     or new.auth <> old.auth or new.in_spam <> old.in_spam"),
    ("anyone-marks", "  if not (\n    public.ach_write_by_owner(new.handled_by)", "  if false and not (\n    public.ach_write_by_owner(new.handled_by)"),
    ("manager-marks", "where id = new.handled_by and active = true and role = 'admin')", "where id = new.handled_by and active = true and role in ('admin', 'manager'))"),
    ("inactive-marks", "where id = new.handled_by and active = true and role = 'admin')", "where id = new.handled_by and role = 'admin')"),
    ("jwt-ignored", "      and (auth.uid() is null or auth.uid() = new.handled_by)", "      and true"),
    ("backdate-ok", "  if new.handled_at > now() + interval '5 minutes' or new.handled_at < now() - interval '1 day' then", "  if new.handled_at > now() + interval '5 minutes' then"),
    ("guard-security-definer", "returns trigger\nlanguage plpgsql\nset search_path = public, pg_temp\nas $$\nbegin\n  if tg_op = 'DELETE'", "returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\nbegin\n  if tg_op = 'DELETE'"),
    ("truncate-allowed", "create trigger trg_ach_notice_mail_no_truncate\n  before truncate on public.ach_notice_mail\n  for each statement execute function public.ach_notice_mail_no_truncate();", "-- no truncate trigger"),
    # --- grants and RLS ---
    ("service-delete", "revoke delete, truncate on table public.ach_notice_mail from service_role;", "grant delete on table public.ach_notice_mail to service_role;"),
    ("authenticated-insert", "grant select on table public.ach_notice_mail to authenticated;", "grant select, insert on table public.ach_notice_mail to authenticated;"),
    ("authenticated-update", "grant select on table public.ach_notice_mail to authenticated;", "grant select, update on table public.ach_notice_mail to authenticated;"),
    ("anon-read", "revoke all on table public.ach_notice_mail from anon;", "grant select on table public.ach_notice_mail to anon;"),
    ("rls-open", "create policy ach_notice_mail_admin_read on public.ach_notice_mail\n  for select using (public.is_admin());", "create policy ach_notice_mail_admin_read on public.ach_notice_mail\n  for select using (true);"),
]


def probe_rolled_back():
    r = psql_file(RB)
    ck = psql_file(CHECK)
    ok = r.returncode == 0 and ck.returncode != 0
    print(f"{'killed  ' if ok else 'SURVIVED'} rolled-back  (the 0290 check {'fails' if ck.returncode else 'PASSED'} with no table)", flush=True)
    ap = psql_file(MIG)
    return ok and ap.returncode == 0


def probe_rollback_refuses():
    rb = open(RB).read()
    sql = (
        "begin;\n"
        "insert into public.ach_notice_mail (mailbox, gmail_id, sender_ok, auth, link_verdict, subject_enc, body_enc) values"
        " ('rb0290@x.test', 'gmailRB0290', true, 'pass', 'none', 'encv1:a', 'encv1:b');\n"
        + rb + "\nrollback;\n"
    )
    open(TMP_RB, "w").write(sql)
    r = psql_file(TMP_RB)
    psql_cmd("rollback;")
    ok = r.returncode != 0 and "ROLLBACK REFUSED" in r.stderr
    print(f"{'killed  ' if ok else 'SURVIVED'} rollback-refuses  ({'raised ROLLBACK REFUSED' if ok else (r.stderr or 'accepted')[-140:]})", flush=True)
    return ok


def main(src):
    if not control("before"):
        return 2
    surv = []
    for name, a, b in M:
        if src.count(a) != 1:
            print(f"ANCHOR count={src.count(a)} {name}", flush=True)
            surv.append(name)
            continue
        r = psql_file(RB)
        if r.returncode:
            print(f"rollback failed before {name}: {r.stderr}", flush=True)
            return 3
        open(TMP, "w").write(src.replace(a, b, 1))
        ap = psql_file(TMP)
        if ap.returncode:
            print(f"killed   {name}  (mutated migration did not apply: {ap.stderr.strip().splitlines()[-1][:120]})", flush=True)
            continue
        ck = psql_file(CHECK)
        k = ck.returncode != 0
        why = (ck.stderr.strip().splitlines() or ["-"])[-1][:140]
        print(f"{'killed  ' if k else 'SURVIVED'} {name}  ({why if k else 'check passed'})", flush=True)
        if not k:
            surv.append(name)

    if not control("mid"):
        return 2
    if not probe_rolled_back():
        surv.append("rolled-back")
    if not probe_rollback_refuses():
        surv.append("rollback-refuses")

    assert open(MIG).read() == src
    ctl = control("after")
    print(f"total {len(M)} killed {len(M) - len([s for s in surv if s in dict((n, 1) for n, _, _ in M)])} survivors {surv}")
    return 1 if surv or not ctl else 0


sys.exit(main(open(MIG).read()))
