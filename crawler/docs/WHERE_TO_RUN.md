# Where to run the crawler — your shop server vs. a cloud VM

Short answer: **your shop's VM host is a good, professional choice** for this, and
in some ways the *best* one for your situation. Here's the honest trade-off so you
can decide deliberately.

If you are not ready to build the permanent VM/tunnel yet and just want to test on
your work VM / desktop, use [`LOCAL_TESTING_GUIDE.md`](LOCAL_TESTING_GUIDE.md)
first. PyCharm/local testing is feasible and does **not** require Cloudflare
Tunnel.

## What the worker needs
- Python 3.11+, ~1–2 GB RAM free (Chromium via Playwright is the heavy part),
  a couple GB disk for the browser + page cache.
- Outbound internet (to fetch brand pages + call Meta's Graph API + your AI
  provider + Supabase). **No inbound public traffic is required** if the Vercel
  site reaches it over a private tunnel/VPN — see below.
- It is **not** latency-sensitive or high-traffic. It runs on demand when an
  employee clicks "Research." One small always-on box is plenty.

## Option 1 — Your shop's VM host (recommended for you)
You already run a hypervisor at the shop for employee desktops, with strong
perimeter security. Spin up **one small dedicated VM** (2 vCPU / 4 GB RAM /
20 GB disk, Debian/Ubuntu) just for the crawler.

**Pros**
- Data path stays **inside your secured network**; your existing firewall, IDS,
  backups, and patching apply automatically.
- No new monthly cloud bill; you already own the hardware.
- Easy to give it a static internal IP and lock it down.

**Cons / things to handle**
- It needs **outbound** internet (fetching pages). That's normal egress — your
  firewall already allows your desktops out; give this VM the same.
- Your Vercel-hosted site has to reach it. **Do not** port-forward it raw to the
  public internet. Instead use one of:
  - **Cloudflare Tunnel** (free, recommended): runs on the VM, gives you a
    private HTTPS hostname like `crawler.greenwaymarijuana.com` with **no inbound
    firewall holes**. Set `CRAWLER_BASE_URL` to that hostname.
  - **Tailscale / WireGuard VPN** between the VM and... (Vercel can't join a VPN,
    so Cloudflare Tunnel is the cleaner fit for a Vercel front end.)
- Keep the VM patched (it's a network-exposed service, even if only via tunnel).
  The `X-Crawler-Secret` auth + tunnel access controls are your two locks.

**This is what I'd pick for you:** a dedicated VM on your host + Cloudflare Tunnel.
It keeps everything under your roof and your security umbrella, costs nothing
extra, and never opens an inbound port.

## Option 2 — A small cloud VM (e.g. a $6–12/mo box)
A tiny DigitalOcean/Hetzner/Fly.io/Render instance running the Docker image.

**Pros**
- Zero load on your shop hardware; isolated blast radius.
- Public HTTPS endpoint is trivial (set `CRAWLER_BASE_URL` to it + the shared
  secret). Easy for Vercel to reach.
- Trivial to destroy/recreate.

**Cons**
- A small recurring bill.
- The data path leaves your network (still fine — it's drafts + public data, and
  the secret-gated endpoint is the only surface), but it's outside your security
  stack, so *its* hardening is on you/the provider.

## Option 3 — Don't: run it on Vercel
Vercel (and most serverless) **can't run a headless browser** reliably and caps
execution time — which is exactly why the crawler is a separate worker. Skip.

---

## My recommendation for Greenway
1. **Dedicated VM on your shop host** (2 vCPU / 4 GB / 20 GB), Ubuntu/Debian.
2. Run the worker via the **Docker image** (`crawler/Dockerfile`) or the
   **systemd unit** (`crawler/docs/greenway-crawler.service`).
3. Expose it to Vercel with a **Cloudflare Tunnel** (no inbound ports).
4. Set `CRAWLER_BASE_URL` (the tunnel hostname) + `CRAWLER_SHARED_SECRET` in
   Vercel; set the worker's `.env` on the VM.
5. Lock the VM's outbound to what it needs if your policy is strict; keep it
   patched; the secret + tunnel are your access controls.

That gives you a pro-grade, in-house, no-inbound-port deployment that rides on the
security you already trust — and you can move it to a cloud box later by just
changing `CRAWLER_BASE_URL` if you ever want to.
