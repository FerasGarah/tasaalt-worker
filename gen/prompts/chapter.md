# Step 3 — Animate chapter "{{KEY}}" ({{INDEX}} of {{COUNT}})

Episode: {{TITLE}}
Overall look: {{LOOK}}

Chapter timing: starts at AT.{{KEY}} = {{AT}} s, ends at {{END}} s (duration {{DUR}} s).
Write every time as an ABSOLUTE time through L(): `L(13.0)` means 13.0 s into the episode.

Previous chapter: {{PREV}}
Next chapter: {{NEXT}}

## Narration of this chapter (absolute start time · word)
{{WORDS}}

## Phrase captions shown at the bottom during this chapter (do not draw them)
{{CAPTIONS}}

## Director's plan for this chapter
{{PLAN}}

## Shared helpers available (already defined in the episode file, call them directly)
{{HELPERS}}

{{EXTRA}}

## Write the code

Return ONLY one ```js code block containing exactly one function expression, nothing before or after it:

```js
function(g,tl,K){
  var S=K.S, T=K.T, L=function(t){return t-AT.{{KEY}};};
  // sub-scenes with sub(S,g,bg) + cut(tl,from,to,L(t)), drawings, words, motion…
}
```

Requirements (re-read section 6 and 7 of the series bible):
- Match the references: same density of detail, same motion vocabulary, same text sizes and positions.
- Each cue of the plan appears at its spoken time via L(): hero → K.slam, secondary → K.slide, label → K.pop,
  number → K.count + K.slam. Hide words before the next hero word lands.
- All times between L({{AT}}) and L({{END}}). Keep scene text inside x 20–340 and above y 500.
- The scene must be alive during the whole chapter.
