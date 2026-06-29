# Greenway Crawler — IT Deployment Guide (production, on a business VM)

**Audience:** the IT/sysadmin setting this up. Assumes Linux, Docker/systemd, networking, and DNS familiarity.
**Goal:** run the Greenway crawler worker as a hardened, always-on service on a business VM, exposed to the Vercel-hosted site with **no inbound firewall ports** via Cloudflare Tunnel, with secrets handled correctly.

The crawler is a small FastAPI service. It fetches public vendor/brand pages (and, when configured, reads public Instagram business profiles via the Meta Graph API), extracts data, verifies it against the source, runs WA I-502 compliance checks, and writes **draft** rows into Supabase `ai_suggestions`. It never auto-publishes. The Next.js site (Vercel) calls it on demand over an authenticated HTTP endpoint.

---

## 0. Architecture at a glance

```text
Employee clicks "Research" in back office
        │
        ▼
Vercel (Next.js site)  ──HTTPS──►  Cloudflare Edge  ──Tunnel──►  Crawler VM (Docker, 127.0.0.1:8200)
        │                                                              │
        │                                                              ├─► fetches public brand pages
        │                                                              ├─► Meta Graph API (optional)
        │                                                              ├─► AI provider (optional)
        └──────────────────────── reviews drafts ◄── Supabase ◄────────┘ writes pending ai_suggestions
```

Key properties:
- The VM opens **no inbound ports**. `cloudflared` makes an **outbound** connection to Cloudflare; traffic arrives via the tunnel only.
- The site authenticates every request with a shared secret header `X-Crawler-Secret`.
- The worker holds the Supabase **service-role** key and writes drafts server-side only.

---

## 1. Provision the VM

Recommended spec (light, on-demand workload; Chromium is the heavy part):

| Resource | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 22.04/24.04 LTS or Debian 12 | Ubuntu 24.04 LTS |
| vCPU | 1 | 2 |
| RAM | 2 GB | 4 GB |
| Disk | 15 GB | 25–30 GB SSD |
| Network | Outbound internet | Outbound internet |

Notes:
- Give it a **static internal IP** on your network.
- It needs **outbound** access to: target brand websites (80/443), `api.cloudflare.com` + the tunnel edge, Supabase (443), the AI provider (443, if used), and `graph.facebook.com` (443, if social used).
- No inbound public exposure is required.

---

## 2. Base OS hardening (do this first)

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y git curl ufw fail2ban unattended-upgrades

# Automatic security updates
sudo dpkg-reconfigure -plow unattended-upgrades

# Firewall: deny inbound by default, allow SSH only from your admin network.
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <YOUR_ADMIN_SUBNET> to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

- Do **not** open 8200 to the network. The service binds to localhost and is reached only via the tunnel.
- Use SSH keys, disable password auth in `/etc/ssh/sshd_config` (`PasswordAuthentication no`), then `sudo systemctl restart ssh`.
- Create a dedicated unprivileged service account (used below): `greenway`.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin greenway
```

---

## 3. Choose ONE runtime: Docker (recommended) or systemd

Both are supported and shipped in the repo. **Docker is recommended** because the official Playwright image bundles Chromium and all system libraries, eliminating the most common failure mode (missing browser deps).

---

## 3A. Runtime option 1 — Docker (recommended)

### 3A.1 Install Docker Engine

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker greenway   # optional; or run via sudo/systemd
```

### 3A.2 Get the code

```bash
sudo mkdir -p /opt/greenway
sudo chown greenway:greenway /opt/greenway
sudo -u greenway git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git /opt/greenway/app
cd /opt/greenway/app/crawler
```

### 3A.3 Build the image

The `Dockerfile` is based on `mcr.microsoft.com/playwright/python` (Chromium preinstalled), runs as a non-root user, and listens on `CRAWLER_PORT` (default 8200).

```bash
sudo docker build -t greenway-crawler:latest /opt/greenway/app/crawler
```

### 3A.4 Create the secrets file

Create `/opt/greenway/app/crawler/.env` from the template, then fill it per **Section 5**.

```bash
sudo -u greenway cp /opt/greenway/app/crawler/.env.example /opt/greenway/app/crawler/.env
sudo chmod 600 /opt/greenway/app/crawler/.env
sudo chown greenway:greenway /opt/greenway/app/crawler/.env
sudo -u greenway nano /opt/greenway/app/crawler/.env
```

### 3A.5 Run as a managed container (auto-restart, localhost-only)

Bind to `127.0.0.1` so it is never directly reachable on the network — only the tunnel reaches it.

```bash
sudo docker run -d \
  --name greenway-crawler \
  --restart unless-stopped \
  --env-file /opt/greenway/app/crawler/.env \
  -p 127.0.0.1:8200:8200 \
  greenway-crawler:latest
```

### 3A.6 Verify

```bash
curl -s http://127.0.0.1:8200/health
```

Expected JSON (values depend on what you configured):

```json
{"ok":true,"ai_enabled":false,"supabase_configured":true,"social_configured":false,"proxy_enabled":false,"allow_domains":[]}
```

### 3A.7 Updating later

```bash
cd /opt/greenway/app && sudo -u greenway git pull
sudo docker build -t greenway-crawler:latest /opt/greenway/app/crawler
sudo docker rm -f greenway-crawler
# re-run the docker run command from 3A.5
```

---

## 3B. Runtime option 2 — systemd + venv (no Docker)

Use this only if Docker is not allowed on the VM. You must install the browser system deps yourself.

```bash
sudo apt-get install -y python3 python3-venv python3-pip
sudo mkdir -p /opt/greenway/crawler
sudo chown greenway:greenway /opt/greenway
sudo -u greenway git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git /opt/greenway/app
sudo -u greenway cp -r /opt/greenway/app/crawler/. /opt/greenway/crawler/

cd /opt/greenway/crawler
sudo -u greenway python3 -m venv .venv
sudo -u greenway .venv/bin/pip install --upgrade pip
sudo -u greenway .venv/bin/pip install -r requirements.txt
# Installs Chromium AND its system libraries (needs apt; run with sudo):
sudo .venv/bin/python -m playwright install --with-deps chromium

sudo -u greenway cp .env.example .env
sudo chmod 600 .env && sudo chown greenway:greenway .env
sudo -u greenway nano .env       # fill per Section 5
```

Install the shipped unit (`docs/greenway-crawler.service` already targets `/opt/greenway/crawler`, user `greenway`, port 8200):

```bash
sudo cp /opt/greenway/app/crawler/docs/greenway-crawler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now greenway-crawler
sudo systemctl status greenway-crawler
curl -s http://127.0.0.1:8200/health
```

For systemd, also harden the bind: the unit uses `--host 0.0.0.0`. Since `ufw` denies inbound and only the tunnel (localhost) reaches it, this is acceptable, but for defense in depth you may change `ExecStart` to `--host 127.0.0.1` and `sudo systemctl daemon-reload && sudo systemctl restart greenway-crawler`.

---

## 4. Expose to Vercel with Cloudflare Tunnel (no inbound ports)

This gives a stable HTTPS hostname (e.g. `crawler.greenwaymarijuana.com`) backed by an outbound-only tunnel. Requires the domain to be on Cloudflare DNS.

### 4.1 Install cloudflared

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

### 4.2 Authenticate and create the tunnel

```bash
cloudflared tunnel login                       # opens a browser auth; pick the Greenway zone
cloudflared tunnel create greenway-crawler      # note the Tunnel ID + credentials json path
```

### 4.3 Configure the tunnel

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: crawler.greenwaymarijuana.com
    service: http://127.0.0.1:8200
  - service: http_status:404
```

Route DNS to the tunnel:

```bash
cloudflared tunnel route dns greenway-crawler crawler.greenwaymarijuana.com
```

### 4.4 Run cloudflared as a service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

### 4.5 (Strongly recommended) Add Cloudflare Access in front of the hostname

Even though the worker requires `X-Crawler-Secret`, add a second lock so the endpoint is not openly reachable:
- In Cloudflare Zero Trust → Access → Applications, add a self-hosted app for `crawler.greenwaymarijuana.com`.
- Create a **Service Token** for the Vercel site to call it, OR scope a policy by request header. If you use a Service Token, set the site to send `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers (store them as Vercel env vars). This is optional but best practice.

### 4.6 Verify externally

```bash
curl -s https://crawler.greenwaymarijuana.com/health
```

Should return the same health JSON. If you added Access without a service token, this curl will be challenged — that is expected.

---

## 5. Secrets and configuration (`crawler/.env`)

Edit `/opt/greenway/app/crawler/.env` (Docker) or `/opt/greenway/crawler/.env` (systemd). Permissions must be `600`, owner `greenway`. Never commit this file; it is gitignored.

### 5.1 Required now

| Variable | What it is | Where to get it | Where it goes |
|---|---|---|---|
| `CRAWLER_SHARED_SECRET` | Auth secret between site and worker | Generate: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` | This `.env` **and** identical value in Vercel as `CRAWLER_SHARED_SECRET` |
| `SUPABASE_URL` | Project URL | Supabase → Project Settings → API → Project URL | This `.env` only |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side write key | Supabase → Project Settings → API → `service_role` secret | This `.env` only (treat as root password) |

### 5.2 Recommended now

| Variable | Default | Guidance |
|---|---|---|
| `CRAWL_RESPECT_ROBOTS` | `true` | Keep `true` in production. |
| `CRAWL_REALISTIC_HEADERS` | `true` | Browser-parity headers (not evasion). Keep `true`. |
| `CRAWL_MIN_DELAY_SECONDS` | `2.0` | Per-domain politeness. |
| `CRAWL_MAX_RETRIES` | `3` | Backoff on 429/5xx. |
| `CRAWL_USER_AGENT` | (set) | Keep a real contact email so site owners can reach you. |
| `CRAWL_ALLOW_DOMAINS` | empty | Optional comma-separated host allow-list to lock the worker to brands you carry. Empty = allow any host staff submit. |
| `CRAWLER_PORT` | `8200` | Leave unless you change the tunnel/container mapping too. |

### 5.3 Optional — AI gap-filling

Leave `AI_API_KEY` empty for a first run (CSS-first extraction is free and proves the pipeline). To enable LLM gap-filling later:

| Variable | Where to get it |
|---|---|
| `AI_BASE_URL` | OpenAI-compatible endpoint (same provider the site uses) |
| `AI_MODEL` | e.g. `gpt-4o-mini` |
| `AI_API_KEY` | The provider's API key (this `.env` only) |

### 5.4 Optional — Social (Meta Instagram Business Discovery)

The owner will deliver these once obtained. **They are access tokens from the Meta developer console — never passwords.** Full walkthrough: `crawler/docs/SOCIAL_SETUP.md`.

| Variable | What it is | Where to get it | Where it goes |
|---|---|---|---|
| `META_GRAPH_TOKEN` | Long-lived Page access token | Meta app → Graph API Explorer → long-lived Page token (steps in SOCIAL_SETUP.md) | This `.env` only |
| `META_IG_BUSINESS_ID` | Greenway's IG Business account id | `GET /{PAGE_ID}?fields=instagram_business_account` (steps in SOCIAL_SETUP.md) | This `.env` only |
| `META_GRAPH_VERSION` | Graph API version | Leave `v21.0` unless Meta deprecates it | This `.env` only |

How the owner hands them off: have them place the two values in a password manager / secure note, and you paste them into this `.env`. **Do not** send them over email/chat in plaintext. After pasting, restart the service and confirm `social_configured: true` on `/health`. Until then, social is soft-disabled and the rest of the crawler works normally.

### 5.5 Apply changes

After editing `.env`:

```bash
# Docker:
sudo docker restart greenway-crawler
# systemd:
sudo systemctl restart greenway-crawler
```

---

## 6. Wire the Vercel site to the worker

In **Vercel → Project (the Greenway site) → Settings → Environment Variables**, add for Production (and Preview if you test there):

| Variable | Value |
|---|---|
| `CRAWLER_BASE_URL` | `https://crawler.greenwaymarijuana.com` |
| `CRAWLER_SHARED_SECRET` | The exact same string as the worker's `.env` |

If you enabled Cloudflare Access with a service token (4.5), also add those header credentials as Vercel env vars and ensure the site forwards them (coordinate with the owner/dev before enabling, so the call path is updated).

**Redeploy the site** after setting env vars (Vercel only injects env at build/deploy). Then the "Research with the crawler" and "Pull from Instagram" buttons in `/admin/vendors` will call the worker.

---

## 7. End-to-end verification checklist

Run these in order and confirm each:

1. **Local health (on VM):** `curl -s http://127.0.0.1:8200/health` → `ok:true`, `supabase_configured:true`.
2. **Tunnel health (anywhere):** `curl -s https://crawler.greenwaymarijuana.com/health` → same JSON (or Access challenge if Access enabled).
3. **Auth rejects bad secret:**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://crawler.greenwaymarijuana.com/research \
     -H "Content-Type: application/json" -H "X-Crawler-Secret: WRONG" \
     -d '{"url":"https://example.com","entity_type":"vendor","entity_id":"00000000-0000-0000-0000-000000000000","write":false}'
   ```
   Expect `401`.
4. **Dry-run research (no DB write):** same call with the **correct** secret and `"write":false` against a real brand URL → returns draft candidates, `200`.
5. **Back office:** in the deployed site, open a vendor in `/admin/vendors`, paste an official brand URL, click **Research with the crawler** → pending drafts appear with source `crawl:<url>`.
6. **Social (after Meta values set):** `/health` shows `social_configured:true`; the IG button drafts from a discoverable business account.

---

## 8. Operations & maintenance

- **Logs:**
  - Docker: `sudo docker logs -f greenway-crawler`
  - systemd: `journalctl -u greenway-crawler -f`
  - Tunnel: `journalctl -u cloudflared -f`
- **Restart:** `sudo docker restart greenway-crawler` / `sudo systemctl restart greenway-crawler`.
- **Cache:** on-disk page cache (default 24h TTL) lives in the container's `/tmp` (Docker) or `crawler/.cache` (systemd). Safe to clear; it just re-fetches.
- **Updates:** `git pull` → rebuild image (Docker) or `pip install -r requirements.txt` (systemd) → restart. Test `/health` after.
- **OS patching:** `unattended-upgrades` handles security patches; reboot during off-hours when the kernel updates.
- **Secret rotation:** to rotate `CRAWLER_SHARED_SECRET`, update the worker `.env` and the Vercel env in the same change window, then restart worker + redeploy site. Rotate `SUPABASE_SERVICE_ROLE_KEY` only via Supabase, then update `.env`.
- **Backups:** the VM is stateless (all real data is in Supabase). Back up `/opt/greenway/app/crawler/.env` securely (it holds secrets) and your cloudflared credentials.

---

## 9. Security summary (what protects what)

| Layer | Control |
|---|---|
| Network inbound | `ufw` denies all inbound except admin SSH; **no 8200 exposure** |
| Public reachability | Only via Cloudflare Tunnel (outbound-only); optional Cloudflare Access in front |
| App auth | `X-Crawler-Secret` required on every `/research*` call |
| Process | Runs as unprivileged `greenway`; Docker non-root + `NoNewPrivileges`/`PrivateTmp` (systemd) |
| Secrets | `.env` is `600`, owner-only; service-role key never leaves the VM; tokens not passwords |
| Data safety | Worker can only INSERT `pending` suggestions; never edits/publishes; verify-against-source + I-502 compliance gates |

---

## 10. Quick troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/health` `supabase_configured:false` | Missing/wrong Supabase vars | Fix `.env`, restart |
| Site button → 401 | Secret mismatch | Make `CRAWLER_SHARED_SECRET` identical in `.env` and Vercel; restart + redeploy |
| Site button → "not configured" | Vercel missing `CRAWLER_BASE_URL`/secret | Set env vars, redeploy |
| Site button → connection error | Tunnel down / wrong hostname | `systemctl status cloudflared`; verify DNS route; `curl` the hostname |
| Drafts "not supported by source" / empty | JS-heavy page, browser missing (systemd) | Use Docker image, or re-run `playwright install --with-deps chromium` |
| `social_configured:false` after setting tokens | Token not loaded / wrong var name | Confirm `META_GRAPH_TOKEN` + `META_IG_BUSINESS_ID` in `.env`; restart; re-check `/health` |
| IG returns clean error | Target not a discoverable business/creator account | Expected; only public business/creator accounts are readable |

---

## 11. One-paragraph summary for the owner

The worker runs as a hardened, auto-restarting Docker container on the business VM, bound to localhost and exposed to the Vercel site only through a Cloudflare Tunnel (no inbound ports). Authentication is a shared secret the IT guy sets in both the VM's `.env` and Vercel. Supabase URL + service-role key come from Supabase → Project Settings → API and live only on the VM. The AI key is optional. The Meta Instagram values (access tokens, never passwords) are obtained per `SOCIAL_SETUP.md`, dropped into the same `.env`, and the service restarted — until then everything else works. Verification is a series of `/health` and dry-run checks ending with clicking "Research with the crawler" in `/admin/vendors`.
