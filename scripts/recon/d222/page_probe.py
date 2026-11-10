import json, httpx, sys
cks = json.load(open('cookies_all.json'))
ck = "; ".join(f"{c['name']}={c['value']}" for c in cks if c['domain'] in ('app.leaflink.com','.leaflink.com'))
H = {"Accept":"application/json","Cookie":ck}
B = "https://app.leaflink.com/api/internal/greenway-marijuana/"
q = sys.argv[1]
for off in (0, 24, 48, 240):
    r = httpx.get(B+"shop/products/", params={"limit":24,"offset":off,"search":q,"sort_by":"","error_format":"jsonapi"}, headers=H, timeout=30)
    d = r.json(); res = d.get("results",[])
    print(off, r.status_code, "count", d.get("count"), "n", len(res), "next", bool(d.get("next")), sorted({(p.get('brand') or {}).get('name') for p in res})[:8])
