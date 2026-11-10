import httpx, json, sys
tok = open('.jwt').read().strip()
H = {"Authorization": f"Bearer {tok}", "Accept": "application/json", "leaflink-version": "2022-10-31"}
for q in sys.argv[1:]:
    r = httpx.get("https://api.leaflink.com/content/brands/listing", params={"company_id":3053,"page":1,"search":q}, headers=H, timeout=30)
    d = r.json() if r.headers.get('content-type','').startswith('application/json') else {}
    col = (d.get('content') or {}).get('collection') or []
    print(f"{q!r:24} {r.status_code} count={d.get('count')} next={bool(d.get('next'))} -> {[(c['resource_id'], c['name'], (c.get('owner') or {}).get('name'), bool(c.get('image'))) for c in col][:6]}")
r = httpx.get("https://api.leaflink.com/content/brands/listing", params={"company_id":3053,"page":1}, headers={"Accept":"application/json"}, timeout=30)
print("no-auth:", r.status_code, r.text[:120])
