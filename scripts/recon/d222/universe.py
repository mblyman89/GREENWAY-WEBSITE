import json, httpx, time
cks = json.load(open('cookies_all.json'))
ck = "; ".join(f"{c['name']}={c['value']}" for c in cks if c['domain'] in ('app.leaflink.com','.leaflink.com'))
H = {"Accept":"application/json","Cookie":ck}
B = "https://app.leaflink.com/api/internal/greenway-marijuana/shop/products/"
# test bigger limit first
r = httpx.get(B, params={"limit":500,"offset":0,"search":"","sort_by":"","error_format":"jsonapi"}, headers=H, timeout=60)
d = r.json(); print("limit=500 ->", r.status_code, len(d.get("results",[])), "count", d.get("count"))
brands = {}
off = 0; per = len(d.get("results",[])) or 24
rows = d.get("results",[])
while True:
    for p in rows:
        b = p.get("brand") or {}; brands[b.get("id")] = (b.get("name"), (b.get("company") or {}).get("name"))
    off += per
    if off >= d.get("count",0) or not rows: break
    time.sleep(2.5)
    r = httpx.get(B, params={"limit":per,"offset":off,"search":"","sort_by":"","error_format":"jsonapi"}, headers=H, timeout=60)
    rows = r.json().get("results",[])
tok = open('.jwt').read().strip()
L = httpx.get("https://api.leaflink.com/content/brands/listing", params={"company_id":3053,"page":1}, headers={"Authorization":f"Bearer {tok}","Accept":"application/json"}, timeout=30).json()
lst = {c["resource_id"]: c["name"] for c in L["content"]["collection"]}
print("catalog brands:", len(brands), "listing brands:", len(lst), "listing next:", L.get("next"))
print("in catalog not listing:", [(k, brands[k]) for k in brands if k not in lst])
print("in listing not catalog:", [(k, lst[k]) for k in lst if k not in brands])
json.dump({"catalog": {str(k): v for k,v in brands.items()}, "listing": lst}, open("universe.json","w"), indent=1)
