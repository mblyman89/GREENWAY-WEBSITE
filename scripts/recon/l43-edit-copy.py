#!/usr/bin/env python3
"""SLICE L-43 -- owner-facing copy that still described the pre-Ben world."""
import sys

def edit(path, pairs):
    s = open(path, encoding="utf8").read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print(f"{path}: ANCHOR COUNT {n}:\n{old[:200]}"); sys.exit(3)
        s = s.replace(old, new, 1)
    open(path, "w", encoding="utf8").write(s)
    print("edited", path)

edit("src/lib/leafly/evidence-core.ts", [
("""        "Re-copy the HMAC key from Leafly and save it again, watching for a truncated paste or a " +
        "trailing space. If it still fails on every delivery, ask Leafly to confirm the key and " +
        "whether the signature is hex or base64 encoded.",""",
"""        "Re-copy the HMAC key from Leafly and save it again, watching for a truncated paste or a " +
        "trailing space. If it still fails on every delivery, ask Leafly to confirm which HMAC key " +
        "they are signing with. (The encoding is settled: Leafly confirmed lowercase hex.)","""),
("""  ok(
    (allRejected.nextStep ?? "").toLowerCase().includes("base64"),
    "all_rejected raises the hex/base64 question",
  );""",
"""  // L-43: the encoding question is closed (Ben, item 1). The advice must no
  // longer send the owner to ask it, and must still name the key.
  ok(
    !(allRejected.nextStep ?? "").toLowerCase().includes("base64"),
    "all_rejected no longer raises the settled hex/base64 question",
  );
  ok(
    (allRejected.nextStep ?? "").toLowerCase().includes("lowercase hex"),
    "all_rejected says the encoding is settled as lowercase hex",
  );"""),
("""        "This request arrived with no signature at all, so we turned it away. Leafly always " +
        "signs, which means this did not come from Leafly \u2014 it is almost always an automated " +""",
"""        "This request had a body but no signature, so we turned it away. Leafly signs every " +
        "delivery that has a body, which means this did not come from Leafly \u2014 it is almost always an automated " +"""),
])

edit("src/lib/leafly/refusal-diagnosis-core.ts", [
(""" *   missing_header     \u2192 the caller sent no X-Leafly-Signature at all.
 *                        A genuine Leafly webhook ALWAYS carries one, so this
 *                        is almost never Leafly. It is a probe, a scanner, a
 *                        health check \u2014 or an engineer testing with curl.""",
""" *   missing_header     \u2192 a request WITH A BODY carried no X-Leafly-Signature.
 *                        Leafly signs every delivery that has a body, so this
 *                        is almost never Leafly. It is a probe, a scanner, a
 *                        health check \u2014 or an engineer testing with curl.
 *                        (SLICE L-43: an EMPTY body with no header is Leafly's
 *                        expected unsigned delivery. It is answered 2xx and is
 *                        never recorded, so it never reaches this module.)"""),
(""" *   empty_body         \u2192 not a Leafly delivery; all six webhooks require one.""",
""" *   empty_body         \u2192 written only by builds before L-43, which refused a
 *                        signed empty body unread. Kept so those rows classify."""),
("""        "The caller sent no signature header at all. Genuine Leafly deliveries " +
        "always carry one, so this was almost certainly not Leafly \u2014 a scanner, a " +
        "health check, or someone testing the address by hand.\"""",
"""        "The caller sent a body with no signature header. Leafly signs every " +
        "delivery that has a body, so this was almost certainly not Leafly \u2014 a scanner, a " +
        "health check, or someone testing the address by hand.\""""),
("""        "The request had no body. All six Leafly webhooks always send one, so this " +
        "was not a real delivery.\"""",
"""        "An older build refused this because the body was empty. Since the " +
        "signature-rules update, an empty unsigned delivery is accepted quietly " +
        "(Leafly says it is expected) and a signed one is checked like any other, " +
        "so no new refusal will ever carry this reason.\""""),
])
