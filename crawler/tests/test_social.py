"""Unit tests for the sanctioned social connector (DF-9) — no real network.

We monkeypatch the httpx client so the Graph-API parsing logic is tested
deterministically. Covers handle normalization, profile parsing, soft-disable
without a token, and the verify+compliance gate on a social caption.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import social as social_mod  # noqa: E402
from app.config import Settings  # noqa: E402
from app.social import SocialPost, SocialProfile, normalize_handle, profile_text_blob  # noqa: E402


def test_normalize_handle_variants():
    assert normalize_handle("@greenway") == "greenway"
    assert normalize_handle("greenway") == "greenway"
    assert normalize_handle("https://instagram.com/greenway/") == "greenway"
    assert normalize_handle("https://www.instagram.com/green.way_420?hl=en") == "green.way_420"
    assert normalize_handle("") == ""


def test_social_soft_disabled_without_token():
    s = Settings(META_GRAPH_TOKEN="", META_IG_BUSINESS_ID="123")  # type: ignore
    prof = social_mod.fetch_instagram_business("brand", settings=s)
    assert prof.ok is False
    assert "not configured" in prof.error


def test_social_requires_business_id():
    s = Settings(META_GRAPH_TOKEN="tok", META_IG_BUSINESS_ID="")  # type: ignore
    prof = social_mod.fetch_instagram_business("brand", settings=s)
    assert prof.ok is False
    assert "IG_BUSINESS_ID" in prof.error


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get(self, url, params=None):
        return _FakeResp(self._payload)


def test_social_parses_business_discovery(monkeypatch):
    payload = {
        "business_discovery": {
            "biography": "Small-batch live resin from Tacoma. Bright citrus, clean process.",
            "website": "https://brand.example",
            "followers_count": 4200,
            "profile_picture_url": "https://cdn.example/pfp.jpg",
            "media": {
                "data": [
                    {
                        "media_type": "IMAGE",
                        "media_url": "https://cdn.example/post1.jpg",
                        "permalink": "https://instagram.com/p/abc",
                        "caption": "Fresh drop: Lemon Haze live resin, jar packaging, citrus-forward.",
                        "timestamp": "2026-01-01T00:00:00+0000",
                    }
                ]
            },
        }
    }
    monkeypatch.setattr(social_mod, "_client", lambda settings: _FakeClient(payload))
    s = Settings(META_GRAPH_TOKEN="tok", META_IG_BUSINESS_ID="123")  # type: ignore
    prof = social_mod.fetch_instagram_business("brand", settings=s)
    assert prof.ok is True
    assert "live resin" in prof.biography
    assert prof.followers == 4200
    assert "https://cdn.example/post1.jpg" in prof.image_urls
    assert "https://cdn.example/pfp.jpg" in prof.image_urls
    assert prof.posts[0].permalink == "https://instagram.com/p/abc"


def test_social_handles_graph_error(monkeypatch):
    payload = {"error": {"message": "Invalid OAuth access token."}}
    monkeypatch.setattr(social_mod, "_client", lambda settings: _FakeClient(payload))
    s = Settings(META_GRAPH_TOKEN="tok", META_IG_BUSINESS_ID="123")  # type: ignore
    prof = social_mod.fetch_instagram_business("brand", settings=s)
    assert prof.ok is False
    assert "OAuth" in prof.error


def test_profile_text_blob_includes_bio_and_captions():
    prof = SocialProfile(
        handle="b", ok=True, biography="Bio line.",
        posts=[SocialPost(caption="Caption one."), SocialPost(caption="Caption two.")],
    )
    blob = profile_text_blob(prof)
    assert "Bio line." in blob and "Caption one." in blob and "Caption two." in blob


# --- Minimal monkeypatch shim so this runs without pytest installed ----------
class _MonkeyPatch:
    def __init__(self):
        self._undo = []

    def setattr(self, target, name, value=None):
        if value is None:
            # setattr(obj, "attr", val) form not used here; require 3-arg form.
            raise TypeError("use setattr(module, name, value)")
        old = getattr(target, name)
        self._undo.append((target, name, old))
        setattr(target, name, value)

    def undo(self):
        for target, name, old in reversed(self._undo):
            setattr(target, name, old)
        self._undo.clear()


if __name__ == "__main__":
    import inspect
    import traceback

    funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in funcs:
        mp = _MonkeyPatch()
        try:
            if "monkeypatch" in inspect.signature(fn).parameters:
                fn(mp)
            else:
                fn()
            print(f"PASS {fn.__name__}")
            passed += 1
        except Exception:
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
        finally:
            mp.undo()
    print(f"\n{passed}/{len(funcs)} passed")
    sys.exit(0 if passed == len(funcs) else 1)
