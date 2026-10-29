# Fix chapter "{{KEY}}"

The chapter code below was run in the real player (headless Chrome, 360×640, export mode) and the automatic checker
found these problems:

{{ISSUES}}

Current code:

```js
{{CODE}}
```

Chapter timing: AT.{{KEY}} = {{AT}} s → {{END}} s. Narration with absolute times:
{{WORDS}}

Fix every problem while keeping the scene design and everything that already works.
Common fixes: shorten or shrink a text that is too wide (size ≤ 300 / (0.55 × characters)); move text up out of the
caption band (y ≤ 500); hide the previous word before a new one appears at the same place; wrap an element that has a
`transform` attribute in an inner group before animating it; reveal elements created hidden.

Return ONLY one ```js code block with the complete corrected function `function(g,tl,K){ … }`.
