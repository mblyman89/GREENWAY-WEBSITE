import json, httpx
cks = json.load(open('cookies_all.json'))
app = {c['name']: c['value'] for c in cks if c['domain'] in ('app.leaflink.com', '.leaflink.com')}
hdr_cookie = "; ".join(f"{k}={v}" for k, v in app.items())
url = "https://app.leaflink.com/api/internal/greenway-marijuana/brands/11765"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
variants = {
  "worker-exact (Accept+Cookie only)": {"Accept": "application/json", "Cookie": hdr_cookie},
  "+UA": {"Accept": "application/json", "Cookie": hdr_cookie, "User-Agent": UA},
  "+UA+Referer": {"Accept": "application/json", "Cookie": hdr_cookie, "User-Agent": UA, "Referer": "https://app.leaflink.com/c/greenway-marijuana/shop"},
  "only mp-sessionid": {"Accept": "application/json", "Cookie": f"mp-sessionid={app['mp-sessionid']}"},
  "no cookie": {"Accept": "application/json"},
}
for name, h in variants.items():
    r = httpx.get(url, params={"error_format": "jsonapi"}, headers=h, follow_redirects=True, timeout=30)
    print(f"{name:40} {r.status_code} {r.headers.get('content-type')} final={str(r.url)[:80]} body={r.text[:160]!r}")
