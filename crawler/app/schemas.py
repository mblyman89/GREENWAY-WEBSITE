"""Pydantic schemas for the crawler's structured extraction.

These mirror the field shapes the site already uses (vendor/brand profiles,
product sensory/description) so the drafts the crawler writes slot straight into
the same `ai_suggestions` review lifecycle. Every schema asks the model to be
honest about CONFIDENCE and to leave a field empty rather than guess — the
no-guessing rule is enforced again downstream by verify-against-source.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

EntityKind = Literal["vendor", "brand", "product"]


class ExtractedField(BaseModel):
    """One extracted field destined for a single ai_suggestions row."""

    field_key: str = Field(..., description="Target column, e.g. 'about', 'mission_statement'.")
    value: str = Field(..., description="The extracted text. Empty string = nothing found (skipped).")
    # Where on the page this came from, for verify-against-source + audit.
    evidence: str = Field(default="", description="A short verbatim snippet from the page supporting this value.")


class VendorBrandExtraction(BaseModel):
    """What we try to learn about a vendor or brand from its site."""

    about: str = Field(default="", description="2-4 sentence company/brand overview. Facts from the page ONLY.")
    mission_statement: str = Field(default="", description="The mission/values statement, if the page states one.")
    product_philosophy: str = Field(default="", description="Brand-only: how they make/approach their products.")
    website: str = Field(default="", description="Canonical website URL if discoverable.")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="0..1 grounding in the page text.")
    used_generic_language: bool = Field(default=False, description="True if the page was thin and you generalized.")


class ProductExtraction(BaseModel):
    """Sensory + descriptive facts for a specific product page. Sensory language
    only — never effects/medical (the compliance scan enforces this too)."""

    description: str = Field(default="", description="2-3 sentence product description. Aroma/flavor/format only.")
    aroma_notes: list[str] = Field(default_factory=list, description="Up to 5 short aroma descriptors.")
    flavor_notes: list[str] = Field(default_factory=list, description="Up to 5 short flavor descriptors.")
    strain_name: str = Field(default="", description="Cultivar/strain name if the page states it.")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    used_generic_language: bool = Field(default=False)


class ImageCandidate(BaseModel):
    """A product/brand image discovered on the page, for the media review step."""

    url: str
    alt: str = Field(default="")
    # "exact" (named the product), "branded" (branded but untitled — tube/jar/box),
    # "logo", or "unknown". The reviewer makes the final call.
    kind: Literal["exact", "branded", "logo", "unknown"] = "unknown"
    width: int | None = None
    height: int | None = None
