"""R39 S7 - mutation run on src/lib/payments/ach-ops-store.ts.
Each mutant must make tests/compliance/r39-ach-ops-store-behaviour.test.ts
fail. The source is restored after every mutant and checked byte-for-byte at
the end."""
import subprocess, shutil, sys
F = "src/lib/payments/ach-ops-store.ts"
T = "tests/compliance/r39-ach-ops-store-behaviour.test.ts"
M = [
    # notify
    ('const emails = [...new Set(to.map((c) => c.email).filter(Boolean))];', 'const emails = to.slice(1).map((c) => c.email);'),
    ('emailed = r.ok;', 'emailed = true;'),
    ('detail = e instanceof Error ? e.message.slice(0, 200) : "email failed";', 'throw e;'),
    ('return { emailed, detail, call: pr.call, missingPhones: pr.missing };', 'return { emailed, detail, call: [], missingPhones: pr.missing };'),
    # logNotice
    ('if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors).join(" ") };', 'if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "" };'),
    ('if (verRaw && !UUID.test(verRaw)) return', 'if (false) return'),
    ('correctedEnc = encryptSecret(n.correctedData);', 'correctedEnc = n.correctedData;'),
    ('if (!correctedEnc.startsWith("encv1:")) return { ok: false, error: OPS_NO_KEY };', ''),
    ('correctedLast4 = n.correctedData.replace(/\\D/g, "").slice(-4) || null;', 'correctedLast4 = n.correctedData.slice(0, 4);'),
    ('p_hold_reason: noticeHoldReason(n),', 'p_hold_reason: "",'),
    ('p_verification_id: verRaw || null,', 'p_verification_id: null,'),
    ('p_amount_cents: n.amountCents,', 'p_amount_cents: null,'),
    ('p_settlement_date: n.settlementDate,', 'p_settlement_date: null,'),
    ('p_apply_by: n.applyBy,', 'p_apply_by: null,'),
    ('if (!res.notice_id || !res.hold) return', 'if (false) return'),
    ('const held = res.hold !== "none";', 'const held = true;'),
    ('res.hold === "vault"\n', 'res.hold === "authorization"\n'),
    ('const owner = await notify(input.mail, [book.stephen, book.michael, book.store],', 'const owner = await notify(input.mail, [book.stephen, book.store],'),
    ('const book = resolveNotifyContacts(input.env ?? process.env).contacts;\n  const owner', 'const book = resolveNotifyContacts({}).contacts;\n  const owner'),
    # resolve
    ('const c = checkResolutionNote(input.note);\n  if (!c.ok) return c;', 'const c = { ok: true as const, note: String(input.note) };'),
    ('if (!UUID.test(input.noticeId)) return', 'if (false) return'),
    # release
    ('if (a.payee_type !== "employee") return', 'if (false) return'),
    ('if (a.state !== "on_hold") return', 'if (false) return'),
    # R41 S0 (D-6): owner only; 'owner' is the only success reply
    ('actorIsOwner: input.actorIsOwner, method: input.method', 'actorIsOwner: true, method: input.method'),
    ('p_reason: f.reason || null,', 'p_reason: f.reason,'),
    ('if (data !== "owner") return', 'if (!data) return'),
    ('if (data !== "owner") return', 'if (data !== "owner" && data !== "solo") return'),
    ('return { ok: true, mode: "owner", before: a };', 'return { ok: true, mode: "owner", before: { ...a, state: "active" } };'),
    ('p_actor: input.actorId,\n    p_method: f.method,', 'p_actor: input.actorId,\n    p_method: "phone",'),
    ('if (!data) return { ok: false, error: opsDbErrorMessage("ACH_RELEASE_NOT_FOUND") };', ''),
    # checks
    ('const cents = method === "micro_entry" ? pickMicroCents(', 'const cents = method !== "prenote" ? pickMicroCents('),
    ('(input.randomBelow ?? ((n) => randomInt(n)))', '(input.randomBelow ?? (() => 5))'),
    ('if (typeof data !== "string" || !UUID.test(data)) return { ok: false, error: "The database did not confirm the check.', 'if (false) return { ok: false, error: "The database did not confirm the check.'),
    ('if (input.method !== "prenote" && input.method !== "micro_entry" && input.method !== "voided_check_callback") {', 'if (false) {'),
    ('if (row.status !== "planned" && row.status !== "sent") return', 'if (false) return'),
    ('if (!v) return { ok: false, error: opsDbErrorMessage("ACH_VERIFICATION_NOT_FOUND") };', ''),
    ('p_confirmed_cents: f.cents,', 'p_confirmed_cents: null,'),
    ('p_note: f.note || null,', 'p_note: f.note,'),
    # fingerprint / file
    ('createHash("sha256").update([...ids].sort().join(","), "utf8")', 'createHash("sha256").update(ids.join(","), "utf8")'),
    ('if (input.expect && input.expect !== fp) return', 'if (false) return'),
    ('.filter(([, v]) => !String(v ?? "").trim())', '.filter(([, v]) => !String(v ?? ""))'),
    ('if (missing.length) return', 'if (false) return'),
    ('.eq("method", method).eq("status", "planned");', '.eq("method", method);'),
    ('if (acct.archived_at) {\n      skipped.push', 'if (false) {\n      skipped.push'),
    ('if (a.state !== "verifying") {\n      skipped.push', 'if (false) {\n      skipped.push'),
    ('if (!routing || !accountNumber) return { ok: false, error: OPS_NO_KEY };', ''),
    ('if (!plan.ok) return loaded.skipped.length ?', 'if (!plan.ok) return false ?'),
    ('if (!/^[0-9a-f]{16}$/.test(input.fingerprint)) return', 'if (false) return'),
    ('p_eligible: p.eligible,', 'p_eligible: p.settlement,'),
    ('p_ids: [...p.ids],', 'p_ids: [...p.ids].slice(0, 1),'),
    ('if (data !== p.ids.length) return', 'if (false) return'),
    # records
    ('const c = checkLegalHoldReason(input.reason);\n  if (!c.ok) return c;', 'const c = { ok: true as const, reason: String(input.reason) };'),
    ('p_on: input.on,', 'p_on: true,'),
    ('if (typeof data !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(data)) return', 'if (false) return'),
    # view
    ('if (isMissing(r.error)) return emptyView(false,', 'if (false) return emptyView(false,'),
    ('.is("resolved_at", null)', '.neq("code", "")'),
    ('holds: authRows.filter((a) => a.payee_type === "employee" && a.state === "on_hold"),', 'holds: authRows.filter((a) => a.state === "on_hold" || a.state === "verifying"),'),
    ('if (!open && acct.verification_status === "verified") continue;', ''),
    ('if (acct.archived_at) continue;', ''),
    ('on: v.effective_date ?? pacificDay(v.created_at),', 'on: pacificDay(v.created_at).slice(0, 4) + "-01-01",'),
    ('account_key: acct.account_key_hmac,', 'account_key: acct.id,'),
    ('payee: payeeOf(authById.get(acct.authorization_id)),', 'payee: "x",'),
    ('verRows.filter((v) => v.method === m && v.status === "planned")', 'verRows.filter((v) => v.method === m)'),
    ('payee: names.get(`${n.payee_type}:${n.employee_id ?? n.vendor_id}`)', 'payee: names.get(`employee:${n.employee_id ?? n.vendor_id}`)'),
]
s0 = open(F).read()
shutil.copy(F, "/tmp/mopst.bak")
surv = []
for i, (a, b) in enumerate(M):
    if s0.count(a) < 1:
        print(i, "ANCHOR MISSING", a[:60].replace("\n", " "), flush=True)
        surv.append(i)
        continue
    open(F, "w").write(s0.replace(a, b, 1))
    r = subprocess.run(["timeout", "150", "npx", "vitest", "run", T], capture_output=True, text=True)
    open(F, "w").write(s0)
    k = r.returncode != 0
    print(i, "killed" if k else "SURVIVED", a[:70].replace("\n", " "), flush=True)
    if not k:
        surv.append(i)
assert open(F).read() == s0
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv else 0)
