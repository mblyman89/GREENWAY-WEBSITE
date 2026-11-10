import json, httpx, time, sys
cks = json.load(open('cookies_all.json'))
ck = "; ".join(f"{c['name']}={c['value']}" for c in cks if c['domain'] in ('app.leaflink.com','.leaflink.com'))
H = {"Accept":"application/json","Cookie":ck}
B = "https://app.leaflink.com/api/internal/greenway-marijuana/"
for q in sys.argv[1:]:
    t=time.time()
    r = httpx.get(B+"shop/products/", params={"limit":24,"offset":0,"search":q,"sort_by":"","error_format":"jsonapi"}, headers=H, timeout=30)
    d = r.json()
    brands = {}
    for p in d.get("results",[]):
        b=p.get("brand") or {}; brands[(b.get("id"), b.get("name"), (b.get("company") or {}).get("name"))]=1
    print(f"{q!r:28} {r.status_code} count={d.get('count')} {time.time()-t:.1f}s brands(p1)={list(brands)[:6]}")
