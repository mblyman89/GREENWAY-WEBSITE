import asyncio, json, sys
from playwright.async_api import async_playwright
URL = sys.argv[1]; OUT = sys.argv[2]; WAIT = int(sys.argv[3]) if len(sys.argv) > 3 else 8000
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.connect_over_cdp("http://127.0.0.1:9222")
        ctx = b.contexts[0]
        page = await ctx.new_page()
        log = []
        async def on_resp(r):
            u = r.url
            if any(x in u for x in ('/api/', 'api.leaflink.com', 'graphql')) and r.request.resource_type in ('fetch','xhr'):
                e = {"m": r.request.method, "u": u, "s": r.status, "auth": bool(r.request.headers.get('authorization'))}
                try:
                    t = await r.text(); e["len"] = len(t); e["body"] = t[:4000]
                except Exception as ex: e["err"] = str(ex)
                log.append(e)
        page.on("response", lambda r: asyncio.ensure_future(on_resp(r)))
        await page.goto(URL, wait_until="domcontentloaded")
        await page.wait_for_timeout(WAIT)
        if len(sys.argv) > 4:
            exec(open(sys.argv[4]).read())  # optional interaction snippet uses `page`
            await page.wait_for_timeout(WAIT)
        json.dump(log, open(OUT, 'w'), indent=1)
        for e in log: print(e["m"], e["s"], "AUTH" if e["auth"] else "    ", e["u"][:170])
        await page.close()
asyncio.run(main())
