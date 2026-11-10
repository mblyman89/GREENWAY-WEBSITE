import asyncio, time, re
from playwright.async_api import async_playwright
PW = open('./.pw').read().strip()
async def main():
    t=time.time()
    async with async_playwright() as pw:
        b = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = await b.new_context(); page = await ctx.new_page()
        cap = {}
        def on_req(r):
            if r.url.startswith("https://api.leaflink.com/") and (r.headers.get("authorization") or "").startswith("Bearer "):
                cap.setdefault("tok", r.headers["authorization"][7:]); m = re.search(r"company_id=(\d+)", r.url)
                if m: cap.setdefault("cid", m.group(1))
        page.on("request", on_req)
        await page.goto("https://www.leaflink.com/accounts/login/", wait_until="domcontentloaded"); await page.wait_for_timeout(2500)
        await page.locator("input[type=text]").first.fill("stephen@greenwaymarijuana.com")
        await page.locator("input[type=password]").first.fill(PW)
        await page.locator("button[type=submit]").first.click()
        await page.wait_for_url(re.compile(r"app\.leaflink\.com/c/"), timeout=30000)
        print("logged in at %.1fs" % (time.time()-t), page.url)
        await page.goto("https://app.leaflink.com/c/greenway-marijuana/shop/brands", wait_until="domcontentloaded")
        for _ in range(30):
            if cap.get("tok"): break
            await page.wait_for_timeout(500)
        print("token captured:", bool(cap.get("tok")), "company_id:", cap.get("cid"), "at %.1fs" % (time.time()-t))
        await b.close()
asyncio.run(main())
