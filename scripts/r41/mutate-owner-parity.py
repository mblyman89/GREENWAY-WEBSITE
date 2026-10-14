#!/usr/bin/env python3
"""scripts/r41/mutate-owner-parity.py - R41 S0: test the tests that pin the
owner-only release rules (owner decision D-6 option B, D-5) in BOTH the
database text (0271) and the app cores.

Each mutant weakens ONE rule. The listed vitest files must then FAIL. Every
file is restored after each mutant and checked byte-for-byte at the end.

    python3 scripts/r41/mutate-owner-parity.py   (writes nothing but stdout)
"""
import subprocess
import sys

M71 = "supabase/migrations/0271_ach_owner_authority.sql"
CORE = "src/lib/payments/ach-authorization-core.ts"
VREL = "src/lib/payments/vault-release-core.ts"
OPS = "src/lib/payments/ach-ops-core.ts"
INTAKE = "src/lib/payments/ach-document-intake-core.ts"
TESTS = [
    "tests/compliance/r39-vault-0259-parity.test.ts",
    "tests/compliance/r39-ach-ops-0263-parity.test.ts",
    "tests/compliance/r39-vault-release-core.test.ts",
    "tests/compliance/r39-ach-document-intake.test.ts",
    "tests/compliance/r39-ach-ops-store-behaviour.test.ts",
]

M = [
    # 0271 vendor_bank_guard (live vault rules)
    ("vault-release-anyone", M71, "    if not public.ach_write_by_owner(new.released_by) then", "    if false then"),
    ("vault-mode-solo", M71, "    if new.release_mode is distinct from 'owner' then", "    if new.release_mode is distinct from 'solo' then"),
    ("vault-solo-reason-back", M71,
     "    if new.release_mode is distinct from 'owner' then",
     "    if coalesce(length(trim(new.release_reason)), 0) < 20 then raise exception 'x'; end if;\n    if new.release_mode is distinct from 'owner' then"),
    ("vault-note-9", M71, "    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 10 then",
     "    if new.release_callback_method is null or coalesce(length(trim(new.release_callback_note)), 0) < 9 then"),
    ("vault-history-mode-lost", M71, "release_mode in ('dual', 'solo', 'owner'));", "release_mode in ('owner'));"),
    # 0271 ach_auth_release_hold (live employee hold release)
    ("hold-anyone", M71, "  if not public.ach_write_by_owner(p_actor) then\n    raise exception 'ACH_OWNER_ONLY: only the owner releases an employee", "  if false then\n    raise exception 'ACH_OWNER_ONLY: only the owner releases an employee"),
    ("hold-returns-solo", M71, "  return 'owner';\nend $$;", "  return 'solo';\nend $$;"),
    ("hold-solo-reason-back", M71,
     "  if coalesce(length(trim(p_note)), 0) < 10 then\n    raise exception 'ACH_RELEASE_CALLBACK: write a callback note",
     "  if coalesce(length(trim(p_reason)), 0) < 20 then raise exception 'x'; end if;\n  if coalesce(length(trim(p_note)), 0) < 10 then\n    raise exception 'ACH_RELEASE_CALLBACK: write a callback note"),
    ("hold-method-email", M71, "  if p_method is null or p_method not in ('phone', 'in_person') then",
     "  if p_method is null or p_method not in ('phone', 'in_person', 'email') then"),
    ("hold-owner-check-late", M71,
     "  if not public.ach_write_by_owner(p_actor) then\n    raise exception 'ACH_OWNER_ONLY: only the owner releases an employee banking hold. Send it as a request for owner approval.'\n      using errcode = 'check_violation';\n  end if;\n  select * into a from public.ach_authorizations where id = p_auth_id for update;",
     "  select * into a from public.ach_authorizations where id = p_auth_id for update;\n  if not public.ach_write_by_owner(p_actor) then\n    raise exception 'ACH_OWNER_ONLY: only the owner releases an employee banking hold. Send it as a request for owner approval.'\n      using errcode = 'check_violation';\n  end if;"),
    # 0271 D-5 drop policies
    ("d5-storage-manager", M71, "for insert with check (bucket_id = 'ach-docs' and public.is_admin());",
     "for insert with check (bucket_id = 'ach-docs' and public.is_manager());"),
    ("d5-events-manager", M71, "  for insert with check (public.is_admin());", "  for insert with check (public.is_manager());"),
    # app cores
    ("core-verdict-anyone", CORE, "  if (!input.actorIsOwner) {\n    return { ok: false, refusal: \"Only Michael", "  if (false) {\n    return { ok: false, refusal: \"Only Michael"),
    ("core-verdict-mode", CORE, "  return { ok: true, mode: \"owner\" };\n}", "  return { ok: true, mode: \"owner\", notifyOther: true } as ReleaseVerdict;\n}"),
    ("vrel-owner-forced", VREL, "      actorIsOwner: input.actorIsOwner,", "      actorIsOwner: true,"),
    ("ops-form-anyone", OPS, "  if (!i.actorIsOwner) return { ok: false, error: \"Only Michael", "  if (false) return { ok: false, error: \"Only Michael"),
    ("intake-manager-drops", INTAKE, "export const DROP_ROLES = [\"owner\", \"admin\"] as const;", "export const DROP_ROLES = [\"owner\", \"admin\", \"manager\"] as const;"),
]

files = sorted({m[1] for m in M})
orig = {f: open(f).read() for f in files}
surv = []
for name, f, a, b in M:
    s0 = orig[f]
    if s0.count(a) != 1:
        print(f"ANCHOR {s0.count(a)} {name}", flush=True)
        surv.append(name)
        continue
    open(f, "w").write(s0.replace(a, b, 1))
    try:
        r = subprocess.run(["timeout", "240", "npx", "vitest", "run", *TESTS], capture_output=True, text=True)
    finally:
        open(f, "w").write(s0)
    k = r.returncode != 0
    print(f"{'killed  ' if k else 'SURVIVED'} {name}", flush=True)
    if not k:
        surv.append(name)
for f in files:
    assert open(f).read() == orig[f], f
ctl = subprocess.run(["timeout", "240", "npx", "vitest", "run", *TESTS], capture_output=True, text=True)
print("control", "pass" if ctl.returncode == 0 else "FAILED")
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv or ctl.returncode != 0 else 0)
