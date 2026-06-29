# DF-7 (crawler hardening) + DF-9 (social connector) — Task List

> Option A: legitimate hardening + sanctioned social. No fake accounts, no
> login automation, no anti-bot bypass. Drafts-only + compliance-gated (unchanged).
> One PR per slice. Re-read roadmap + walk tree every session (standing rule).

## Audit (do first)
- [ ] Read every crawler/app/*.py; note current UA, headers, retry, robots, cache, concurrency.
- [ ] Identify gaps vs. the legit expert toolkit.

## DF-7 — Crawler hardening (legitimate techniques)
- [ ] Realistic rotating User-Agent + full modern browser headers (Accept, Accept-Language,
      Sec-Fetch-*, etc.) on BOTH crawl4ai and httpx paths. Honest, not deceptive.
- [ ] Exponential backoff + jitter + Retry-After handling; per-domain concurrency cap;
      polite global concurrency.
- [ ] sitemap.xml discovery (+ sitemap index) and RSS/Atom discovery to find the right pages.
- [ ] Expanded structured-data extraction: JSON-LD arrays/@graph, microdata, more OG/meta.
- [ ] Optional transparent egress: HTTP_PROXY / HTTPS_PROXY settings (off by default).
- [ ] Per-domain allow-list config + simple reliability scoring + a robots/politeness report.
- [ ] tsc/eslint/build (site untouched mostly) + Python tests. PR.

## DF-9 — Social-content connector (sanctioned)
- [ ] Tier 1: Instagram Business Discovery via Meta Graph API (you auth as Greenway IG Business;
      pull a vendor's PUBLIC profile + media: captions, image URLs, permalinks). Free, ToS-clean.
- [ ] Tier 1: Facebook Page public posts (same Graph token where available).
- [ ] Tier 2: public logged-out fetch of the brand's social page (fallback).
- [ ] Tier 3: link-in-bio / Linktree / linked Shopify store → normal crawler path (often the catalog).
- [ ] Normalize social posts → draft product/brand fields (description from caption, image candidates),
      verify-against-source + compliance gate, write to ai_suggestions (source=social:ig:<handle> etc.).
- [ ] `social_handle` inputs + "Pull from social" buttons on vendor/brand admin (soft-disable w/o token).
- [ ] Step-by-step Meta app setup guide in crawler/docs/SOCIAL_SETUP.md (tokens, never passwords).
- [ ] tsc/eslint/build + Python tests. PR.

## Deployment writeup (owner asked)
- [ ] "Where to run it" doc: shop VM host vs. cheap cloud VM trade-offs, security, networking,
      how the Vercel site reaches it.

---
### Status log
- DF-7/DF-9 kicked off (Option A — legit hardening + sanctioned social).
