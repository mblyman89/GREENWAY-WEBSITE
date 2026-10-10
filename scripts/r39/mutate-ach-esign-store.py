"""R39 S6 - mutation run on src/lib/payments/ach-esign-store.ts.
Each mutant must make tests/compliance/r39-ach-esign-store-behaviour.test.ts fail.
The source is restored after every mutant and checked byte-for-byte at the end."""
import subprocess, shutil, sys
F = "src/lib/payments/ach-esign-store.ts"
T = "tests/compliance/r39-ach-esign-store-behaviour.test.ts"
M = [
    # start
    ('if (!id.ok) return { ok: false, error: id.error };', ''),
    ('if (!emp.data) return { ok: false, error: "That employee no longer exists." };', ''),
    ('.in("state", ["started", "code_sent", "consented"])\n    .maybeSingle();', '.maybeSingle();'),
    # send
    ('if (s.state !== "started" && s.state !== "code_sent") return', 'if (false) return'),
    ('if (sessionExpired(s.started_at, input.nowMs)) return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_EXPIRED") };\n  const em', 'const em'),
    ('if (!em.ok) return { ok: false, error: em.error };', ''),
    ('if (!can.ok) return { ok: false, error: can.error };', ''),
    # EQUIVALENT (not run): removing `if (!h) return NO_KEY` in sendEsignCode. keyedHasher is
    # null only when DATA_ENCRYPTION_KEY is unset, and then encryptSecret returns plain text, so
    # the very next guard returns the same NO_KEY. The behaviour test pins that outcome.
    ('email_enc: emailEnc,', 'email_enc: em.email,'),
    ('otp_digest: otpDigest(h, s.id, code),', 'otp_digest: code,'),
    ('otp_sends: s.otp_sends + 1,', 'otp_sends: s.otp_sends,'),
    ('.eq("otp_sends", s.otp_sends)', ''),
    ('const sent = await input.mail(em.email, { subject: msg.subject, html: msg.html });\n  if (!sent.ok)', 'const sent = { ok: true as const, detail: "" };\n  if (!sent.ok)'),
    # verify
    ('if (s.state !== "code_sent") return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_STATE") };\n  if (sessionExpired(s.started_at, input.nowMs)) return { ok: false, error: esignDbErrorMessage("ACH_ESIGN_EXPIRED") };\n  if (!input.agreed)', 'if (!input.agreed)'),
    ('if (!input.agreed) return', 'if (false) return'),
    ('if (input.disclosureSha256Shown !== shown) return', 'if (false) return'),
    ('if (v.countAttempt) {', 'if (false) {'),
    ('otp_attempts: Math.min(OTP_MAX_ATTEMPTS, s.otp_attempts + 1)', 'otp_attempts: s.otp_attempts'),
    ('.eq("otp_attempts", s.otp_attempts)\n        .select("id");', '.select("id");'),
    ('disclosure_sha256: shown,', 'disclosure_sha256: input.disclosureSha256Shown.slice(0, 63) + "0",'),
    ('disclosure_version: ESIGN_DISCLOSURE_VERSION,', 'disclosure_version: "v0",'),
    ('.eq("otp_digest", s.otp_digest as string)', ''),
    # sign
    ('if (s.state !== "consented") return', 'if (false) return'),
    ('if (!input.intentChecked) return', 'if (false) return'),
    ('if (!signatureMatches(input.typedName, s.legal_name)) return', 'if (false) return'),
    ('if (open.data && !input.replaceOpen) return', 'if (false) return'),
    ('.not("state", "in", "(revoked,archived)")', ''),
    ('upsert: false });\n  if (up1.error)', 'upsert: true });\n  if (up1.error)'),
    ('    await bucket.remove([recPath.objectKey]);\n', ''),
    ('    await bucket.remove([recPath.objectKey, certPath.objectKey]);\n', ''),
    ('p_replace_open: input.replaceOpen,', 'p_replace_open: false,'),
    ('p_record: { storage_path: recPath.storagePath, sha256: recordSha,', 'p_record: { storage_path: recPath.storagePath, sha256: certSha,'),
    ('p_ip: input.ip ?? "",', 'p_ip: "",'),
    ('replacedPrevious: Boolean(open.data)', 'replacedPrevious: false'),
    ('emailTo = checkEmail(plain).ok ? plain : null;', 'emailTo = null;'),
    ('hmacKey: (r, a, t) => ak(normalizeAccountKey(r, a, t))', 'hmacKey: (r, a, t) => `${r}:${a}:${t}`'),
    ('const tails = input.accounts.map((a) => last4(a.account));', 'const tails = input.accounts.map((a) => a.account);'),
    # cancel
    ('if (reason.length < 5) return', 'if (false) return'),
    ('.in("state", ["started", "code_sent", "consented"])\n    .select("id");', '.select("id");'),
    ('cancel_reason: reason', 'cancel_reason: input.reason'),
    # signer copy
    ('if (got !== row.sha256) return', 'if (false) return'),
    ('if (session.state !== "signed" || !session.record_document_id) return', 'if (!session.record_document_id) return'),
]
s0 = open(F).read()
shutil.copy(F, "/tmp/mes.bak")
surv = []
for i, (a, b) in enumerate(M):
    if s0.count(a) < 1:
        print(i, "ANCHOR MISSING", a[:50].replace("\n", " "), flush=True)
        surv.append(i)
        continue
    open(F, "w").write(s0.replace(a, b, 1))
    r = subprocess.run(["timeout", "120", "npx", "vitest", "run", T], capture_output=True, text=True)
    open(F, "w").write(s0)
    k = r.returncode != 0
    print(i, "killed" if k else "SURVIVED", a[:70].replace("\n", " "), flush=True)
    if not k:
        surv.append(i)
assert open(F).read() == s0
print(f"total {len(M)} killed {len(M) - len(surv)} survivors {surv}")
sys.exit(1 if surv else 0)
