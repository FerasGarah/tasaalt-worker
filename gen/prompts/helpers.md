# Step 2 — Write the shared drawing helpers

Episode look: {{LOOK}}

Write these drawing helper functions in the style of the references (`sauropod`, `trex`, `fern`, `mushroom`, `mammal`,
`horseshoe`, `filings`): ES5, built from SVG primitives with `S(tag, attrs, parent)`, positioned with an outer
`translate(x y) scale(s)` group, returning the inner group (or `{o, g}`) for motion. 10–40 shapes each, flat colors
from the series palette, recognizable at a glance, proportions like the references.

{{HELPERS}}

Return ONLY one ```js code block containing the function declarations (no other code, no calls).
Each function receives `S` as its first parameter exactly as in its signature (do not use globals other than `K` if passed).
