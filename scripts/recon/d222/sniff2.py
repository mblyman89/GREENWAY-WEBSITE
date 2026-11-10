import asyncio, json, sys
from playwright.async_api import async_playwright
OUT = sys.argv[1]; TERM = sys.argv[2]
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.connect_over_cdp("http://127.0.0.1:9222")
        page = await b.contexts[0].new_page()
        log = []
        async def on_resp(r):
            u = r.url
            if r.request.resource_type in ('fetch','xhr') and 'datadog' not in u and 'seg-api' not in u:
                e = {"m": r.request.method, "u": u, "s": r.status, "auth": bool(r.request.headers.get('authorization')), "post": r.request.post_data}
                try: t = await r.text(); e["len"]=len(t); e["body"]=t[:6000]
                except Exception as ex: e["err"]=str(ex)
                log.append(e)
        page.on("response", lambda r: asyncio.ensure_future(on_resp(r)))
        await page.goto("https://app.leaflink.com/c/greenway-marijuana/shop/", wait_until="domcontentloaded")
        await page.wait_for_timeout(7000)
        mark = len(log)
        inputs = page.locator("input[type=search], input[placeholder*='earch']")
        print("search inputs:", await inputs.count())
        for i in range(await inputs.count()):
            print(" ", i, await inputs.nth(i).get_attribute("placeholder"))
        inp = inputs.first
        await inp.click(); await inp.type(TERM, delay=80)
        await page.wait_for_timeout(4000)
        print("--- after typing (typeahead) ---")
        for e in log[mark:]: print(e["m"], e["s"], "AUTH" if e["auth"] else "    ", e["u"][:220])
        mark = len(log)
        await page.keyboard.press("Enter"); await page.wait_for_timeout(7000)
        print("--- after Enter --- url:", page.url)
        for e in log[mark:]: print(e["m"], e["s"], "AUTH" if e["auth"] else "    ", e["u"][:220])
        json.dump(log, open(OUT,'w'), indent=1)
        await page.screenshot(path=OUT.replace('.json','.png'))
        await page.close()
asyncio.run(main())
