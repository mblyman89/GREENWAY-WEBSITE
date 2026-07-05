# Custom SVG nav glyphs (pot leaf + bong)

## Verbatim request (Msg I)
"Can you create our very own icon glyphs please. I don't like either of those
options. I am uploading photos I want to be turned into icon glyphs. Please do
your best. For the bong, please make an icon for both the light and dark
version, so I can choose which one I like more. Thank you."
+ uploaded IMG_1060.jpeg (cannabis/pot leaf, 7 leaflets) and IMG_1061.webp
(round-bottom bong / flask-style with downstem + mouthpiece; light & dark shown).

## Decision
- Render as inline SVG (crisp at 16px, CSS-tintable, zero network cost) instead
  of emoji or raster. Support both an emoji string (existing) AND a custom SVG
  glyph key for these two items.

## Plan
- [ ] Inspect AdminTopNav icon rendering (3 render spots) + admin-nav-data icon field
- [ ] Create SVG glyph set: PotLeaf, Bong (currentColor => auto light/dark)
      + a Bong "light" (outline) and "dark" (filled) variant so owner can pick
- [ ] Extend nav data to allow a glyph key; renderer maps key -> SVG component
- [ ] Wire Inventory -> pot leaf, Other Inventory -> bong (dark by default,
      light variant available to swap)
- [ ] Build a tiny preview page/HTML so the owner can SEE all options and choose
- [ ] tsc / eslint / build clean
- [ ] Branch + PR; ask owner which bong variant before merge

## Notes
- Standing rules: ground in fact, handoff-ready, don't cut corners.
- Nav icon is a string today; keep backward compatible.
