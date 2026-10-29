# Change request from the producer

The producer watched the generated episode and asks (in Arabic):

«{{NOTE}}»

Chapters of the episode (key · start–end · idea):
{{CHAPTERS}}

Decide which chapters must be rewritten to satisfy the request (only those that are concerned) and write precise
instructions for each one (English, concrete: what to draw, move, resize, recolor, retime; which words; times in seconds).

Return ONE JSON object:
{"reply": "one or two Arabic sentences telling the producer what will change",
 "chapters": [{"key": "sky", "instructions": "…"}]}
