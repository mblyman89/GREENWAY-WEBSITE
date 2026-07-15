# POS Front-End Design Brief (Task AL)

Owner's mission (verbatim): *"build me a front end that has a great workflow.
Better presentation. We don't need to reinvent the wheel here, we are just
using already proven methods and strategies… make my front end beautiful, and
clean, and simple and enjoyable."*

This brief distills REAL research (sources below) into the concrete rules the
register front end follows. Every Task AL slice cites a rule from this file —
nothing is invented.

## Sources consulted

1. **Shopify — POS UI design** (smart-grid tiles, clear labels, less-is-more,
   consistency, contrast, dynamic tiles).
2. **Bright Inventions — payment UX best practices** (button hierarchy: the
   biggest button is the most frequent action; icons WITH labels; preset
   amounts — "don't make me think"; informative-only animation).
3. **Creative Navy / UX Journal — POS design principles** (design for hours of
   use; ergonomics over aesthetics; minimize steps per interaction; balance
   new-hire discoverability with power-user speed; careful validation).
4. **Microsoft Dynamics 365 Commerce — POS screen layouts** (the transaction
   screen anatomy: receipt/check panel + totals panel + number pad + customer
   card + button grid; welcome screen vs transaction screen separation).
5. **Rossul — dispensary POS UX case study** (tablet-first large tap zones,
   minimized keyboard input, compliance embedded in the flow — not bolted on).
6. **Flowhub Maui** (fewer clicks per sale; order fulfillment workflow;
   customer context at checkout).
7. **Touch-target standards**: Apple HIG 44×44 pt, Material Design 48×48 dp,
   WCAG 2.5.5 (AAA, 44 px) / 2.5.8 (AA, 24 px minimum). Register rule: **44 px
   minimum** on anything tapped during a sale; secondary affordances never
   below 36 px.

## The rules the register follows

1. **The transaction screen owns the viewport.** No page scroll during a sale
   (Dynamics/Square anatomy): the product browser and the check each scroll
   internally; search, tabs, chips, and the totals + tender button are always
   visible. (AL-A)
2. **Browse big, check narrow.** The tile grid gets ~60% of the width, the
   check ~40% — products need room to breathe; a check line needs one
   comfortable row. (AL-A)
3. **44 px touch targets.** Category chips, browse tabs, line-editor buttons,
   keypad keys — everything a budtender taps mid-sale hits at least 44 px on
   its short axis. (AL-A)
4. **The biggest button is the most frequent action.** "Cash tender →" and the
   keypad "Complete sale" dominate their panels; Cancel/Back stay visibly
   secondary. (already true; preserved)
5. **Preset amounts beat typing.** Smart tender chips (exact, next bill,
   common bills) come first; a keypad — not a naked text field — handles the
   rest, because a register keypad is a muscle-memory instrument and a text
   input is not. (AL-B)
6. **Icons carry labels.** Every action tile pairs its glyph with words
   (already true; preserved).
7. **Compliance is embedded, not bolted on.** ID gate before the cart, limit
   meters inside the check, High-THC blocks inline (already true; preserved —
   Rossul's core finding).
8. **Home screen: one hero action.** "Start sale" is the single dominant
   entry point; device status is glanceable but demoted below the actions
   (Dynamics welcome-screen pattern). (AL-C)
