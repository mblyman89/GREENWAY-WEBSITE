"""D244 R-23: the crawler follows the owner's Compliance guardrails settings
(Knowledge base -> Compliance guardrails), the same way the site does.

Owner round 10: "I need to be in control, and if I choose something is ok to
do, thats my choice".
"""
from __future__ import annotations

from app import compliance as c


def _reset() -> None:
    c.set_guardrails(None)


def test_key_matches_site() -> None:
    assert c.ai_pattern_key("safety/efficacy claim") == "ai.safety-efficacy-claim"
    assert c.ai_pattern_key("appeal-to-minors language") == "ai.appeal-to-minors-language"


def test_built_in_levels_unchanged_without_settings() -> None:
    _reset()
    r = c.check_compliance("Totally safe for kids.")
    assert r.ok is False
    assert "safety/efficacy claim" in r.blocking_flags


def test_rule_off_and_warn() -> None:
    _reset()
    c.set_guardrails({"rules": {"ai.safety-efficacy-claim": "off", "ai.appeal-to-minors-language": "warn"}})
    r = c.check_compliance("Totally safe for kids.")
    assert r.ok is True
    assert not any("safety" in f for f in r.flags)
    assert any("minors" in f and "heads-up" in f for f in r.flags)
    _reset()


def test_allowed_word_skipped_everywhere() -> None:
    _reset()
    c.set_guardrails({"allow": ["kids", "Safe"]})
    assert c.check_compliance("Totally safe for kids.").ok is True
    assert c.check_compliance("kids vibes", ["kids"]).ok is True
    _reset()


def test_owner_phrase_set_to_warn() -> None:
    _reset()
    assert c.check_compliance("couch lock vibes", ["couch lock"]).ok is False
    c.set_guardrails({}, ["couch lock"])
    r = c.check_compliance("couch lock vibes", ["couch lock"])
    assert r.ok is True and any("heads-up" in f for f in r.flags)
    _reset()


def test_bad_values_ignored() -> None:
    _reset()
    c.set_guardrails({"rules": {"ai.safety-efficacy-claim": "maybe", "BAD KEY": "off"}, "allow": ["", "x" * 81]})
    assert c.check_compliance("It is safe.").ok is False
    _reset()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("crawler guardrails tests passed")
