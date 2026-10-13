#!/usr/bin/env python3
"""R50 S2c real-DB seed (local PG15 + PostgREST harness only; never production).

Builds, from normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json (rehearsal #2a, real Cultivera data):
  - one import (pos_imports, published) + its POS-IMPORT-<id8> manifest (kind pos-import-migration);
  - one vendor per distinct vendor label (vendor_id on each lot, like createImportLots' resolver);
  - one lot per distinct barcode with units > 0 (planImportLots: first row's vendor), all on POS-IMPORT;
  - one native WCIA delivery with one lot (must never be touched).
Costs are SYNTHETIC (the fixture carries no prices): cost = 100 + (sha256(barcode) mod 4900) cents.
Output: SQL on stdout.
"""
import hashlib, json, sys, uuid

FX = json.load(open("normalized_cultivera/R2A_MANIFEST_PLAN_FIXTURE.json"))
IMPORT = "5c2c0000-0000-4000-8000-00000000000a"
SRC = "5c2c1000-0000-4000-8000-000000000001"
NATIVE = "5c2c1000-0000-4000-8000-000000000002"
NS = uuid.UUID("5c2c0000-0000-4000-8000-000000000000")

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

def norm(v):
    return " ".join((v or "").split())

lots = {}
order = []
for bc, vendor, rd, units in FX["rows"]:
    if units is not None and int(max(0, float(units or 0))) <= 0:
        continue
    b = (bc or "").strip()
    if not b:
        continue
    if b not in lots:
        lots[b] = {"vendor": norm(vendor), "units": 0}
        order.append(b)
    lots[b]["units"] += int(float(units or 0))

vendors = sorted({l["vendor"] for l in lots.values() if l["vendor"]})
vid = {v: str(uuid.uuid5(NS, "vendor|" + v)) for v in vendors}

out = ["begin;",
       "delete from public.manifest_events where manifest_id in (select id from public.inbound_manifests where raw_payload->>'import_id' = %s or id in (%s,%s));" % (q(IMPORT), q(SRC), q(NATIVE)),
       "delete from public.inventory_lots where id::text like '5c2c2000-%' or id::text like '5c2c3000-%';",
       "delete from public.inbound_manifests where raw_payload->>'import_id' = %s or id in (%s,%s);" % (q(IMPORT), q(SRC), q(NATIVE)),
       "delete from public.vendors where slug like 's2c-%';",
       "delete from public.pos_imports where id = %s;" % q(IMPORT),
       "insert into public.pos_imports (id, status) values (%s, 'published');" % q(IMPORT),
       "insert into public.inbound_manifests (id, manifest_number, vendor_label, status, accepted_at, transfer_date, raw_payload) values"
       " (%s, 'POS-IMPORT-%s', 'Cultivera POS migration (multi-vendor import)', 'accepted', '2026-11-01T13:30:00Z', '2026-11-01',"
       " jsonb_build_object('kind','pos-import-migration','import_id',%s)),"
       " (%s, 'WCIA-NATIVE-1', 'Acme', 'accepted', '2026-10-20T18:00:00Z', '2026-10-20', '{\"kind\":\"wcia\"}');" % (q(SRC), IMPORT[:8], q(IMPORT), q(NATIVE))]
for i in range(0, len(vendors), 200):
    vals = ",".join("(%s,%s,%s)" % (q(vid[v]), q(v), q("s2c-" + hashlib.sha256(v.encode()).hexdigest()[:12])) for v in vendors[i:i + 200])
    out.append("insert into public.vendors (id, display_name, slug) values %s;" % vals)
rows = []
for n, b in enumerate(order):
    l = lots[b]
    cost = 100 + int(hashlib.sha256(b.encode()).hexdigest(), 16) % 4900
    lid = "5c2c2000-0000-4000-8000-%012d" % n
    rows.append("(%s,%s,%s,%s,%s,%d,%d,%d,'active')" % (q(lid), q(SRC), q(b), q(b), q(vid[l["vendor"]]) if l["vendor"] else "null", l["units"], l["units"], cost))
for i in range(0, len(rows), 500):
    out.append("insert into public.inventory_lots (id, manifest_id, lot_code, ccrs_inventory_external_id, vendor_id, on_hand_qty, received_qty, unit_cost_minor_units, status) values %s;" % ",".join(rows[i:i + 500]))
out.append("insert into public.inventory_lots (id, manifest_id, lot_code, ccrs_inventory_external_id, on_hand_qty, received_qty, unit_cost_minor_units, status) values ('5c2c3000-0000-4000-8000-000000000001', %s, 'NATIVE-1', 'NATIVE-1', 7, 7, 1234, 'active');" % q(NATIVE))
out.append("commit;")
print("\n".join(out))
print("-- lots=%d vendors=%d" % (len(order), len(vendors)), file=sys.stderr)
