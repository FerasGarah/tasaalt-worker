# Step 1 — Plan the episode (director's breakdown)

Read the narration below (every word is numbered with its start time in seconds) and plan a new episode of the series,
in the exact spirit of the two reference episodes.

Audio length: {{LENGTH}} s

## Narration (index · start time · word)
{{WORDS}}

## Pauses in the recording (start-end, seconds)
{{PAUSES}}

## Phrase captions already prepared (start time, text) — they are shown automatically at the bottom
{{CAPTIONS}}

{{EXTRA}}

## What to return

Return ONE JSON object (no prose, no markdown) with this shape:

{
  "title": "episode title in Arabic, usually the question of the hook, e.g. كيف اختفت الديناصورات؟",
  "poster": 3.8,                       // a time (s) in chapter 1 where the hook looks best as a still poster
  "look": "2-3 sentences: the overall visual direction, recurring objects, color mood per part",
  "fact_notes": ["Arabic notes about factual inaccuracies in the narration, if any (empty list if none)"],
  "helpers": [                         // reusable drawing functions needed by more than one scene (0-6)
    {"name": "sauropod", "signature": "sauropod(S,p,x,y,s,col)", "returns": "{o,g}",
     "draw": "long-neck dinosaur, feet at (x,y), facing right; body ellipse, 4 legs, long neck curve, small head, eye, tail"}
  ],
  "chapters": [
    {
      "key": "hook",                   // short latin id, unique: hook, rock, chain, sky, cold, end …
      "start_word": 0,                 // index of the first narrated word of this chapter (chapter 1 starts at 0)
      "idea": "what this chapter says, in one English sentence",
      "scenes": [                      // 1-4 sub-scenes; each begins at a word
        {"start_word": 0, "background": "warm sand sky #f6d8a8, far volcano with smoke, green ground bands",
         "drawing": "big sauropod center, small one far left, t-rex right, ferns, birds crossing",
         "motion": "dinosaurs breathe, smoke rises, birds drift across the whole scene"}
      ],
      "cues": [                        // the kinetic words: every important word/number/name of the chapter
        {"word": 4, "text": "الديناصورات؟", "role": "hero", "color": "#e4572e", "fx": "slam, size 48, red, light stroke"},
        {"word": 1, "text": "هل تساءلت يومًا", "role": "secondary", "fx": "slide"},
        {"word": 9, "text": "160 مليون سنة", "role": "number", "fx": "count 0→160 then slam"}
      ]
    }
  ]
}

Rules for the plan:
- 5–9 chapters for ~60–90 s of audio (about one per 8–15 s), split at the natural idea changes, right after pauses.
- `start_word` values strictly increase; chapter 1 has start_word 0; every word belongs to one chapter.
- Each chapter: 2–6 cues. Each scene shows something concrete and specific to the narration (a viewer with the
  sound off must follow the story). Prefer objects that physically interact with the words.
- The first chapter is the hook (the question + the main object, alive). The last chapter returns to the opening
  object and ends on a strong hero word.
- Cue `text` is the exact word(s) to display (you may shorten a phrase to its key words, keep the spelling).
