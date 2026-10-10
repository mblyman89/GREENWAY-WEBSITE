import subprocess,shutil
F="src/lib/payments/ach-document-store.ts"
M=[
('.eq("sha256", sha256)','.eq("sha256", "x")'),
('if (dup.data) return','if (false) return'),
('upsert: false','upsert: true'),
('    await admin.storage.from(BUCKET).remove([path.objectKey]);\n',''),
('!== doc.sha256','=== "never"'),
('.eq("detail->>document_id", doc.id)','.eq("detail->>document_id", "nope")'),
('if (local.draft.source === "none" && input.useLlamaParse)','if (input.useLlamaParse)'),
('routing_fingerprints: ocrRoutingFingerprints(candidates, hm)','routing_fingerprints: candidates'),
('const { error } = await admin.from("ach_authorization_documents").update({ intake_status: "extracted" })','const { error } = await admin.from("ach_authorization_documents").update({ intake_status: "received" })'),
('  if (!fp || !ak) return { ok: false, error: NO_KEY };\n',''),
('if (!canAcceptKind(doc.kind)) return','if (false) return'),
('if (pre.length) return','if (false) return'),
('if (!signed.ok) return { ok: false, error: signed.error };','if (!signed.ok && false) return { ok: false, error: "" };'),
('const pending = pendingFromEvents(events, doc.id);','const pending = null;'),
('fingerprint: "keepPending" in step ? step.keepPending : null','fingerprint: "keepPending" in step ? step.keepPending : pending'),
('p_basis: step.basis','p_basis: "matches_form"'),
('p_replace_open: input.replaceOpen','p_replace_open: true'),
('hmacKey: (r, a, t) => ak(normalizeAccountKey(r, a, t))','hmacKey: (r, a, t) => ak(`${r}:${a}:${t}`)'),
('if (!saved.ok) return { ok: false, error: saved.error };',''),
('p_outcome: "rejected"','p_outcome: "accepted"'),
('if (error) return { ok: false, error: intakeDbErrorMessage(error.message) };\n    return { ok: true, done: true','if (error) return { ok: false, error: error.message };\n    return { ok: true, done: true'),
('vendorName = String((vendor.data as { display_name?: string } | null)?.display_name ?? input.payeeName','vendorName = String(input.payeeName'),
('account_last4: [rows.rows[0].account_last4]','account_last4: [a.account]'),
('if (doc.archived_at || (doc.intake_status !== "received" && doc.intake_status !== "extracted")) {\n    return { ok: false, error: intakeDbErrorMessage("ACH_INTAKE_STATE") };\n  }\n  if (!canAcceptKind','if (doc.archived_at) {\n    return { ok: false, error: intakeDbErrorMessage("ACH_INTAKE_STATE") };\n  }\n  if (!canAcceptKind'),
]
T="tests/compliance/r39-ach-document-store-behaviour.test.ts"
s0=open(F).read(); shutil.copy(F,"/tmp/mb.bak"); surv=[]
for i,(a,b) in enumerate(M):
    if s0.count(a)<1: print(i,"ANCHOR MISSING",a[:40]); surv.append(i); continue
    open(F,"w").write(s0.replace(a,b,1))
    r=subprocess.run(["timeout","120","npx","vitest","run",T],capture_output=True,text=True)
    open(F,"w").write(s0)
    k=r.returncode!=0
    print(i,"killed" if k else "SURVIVED",a[:60].replace("\n"," "),flush=True)
    if not k: surv.append(i)
assert open(F).read()==s0
print("survivors",surv)
