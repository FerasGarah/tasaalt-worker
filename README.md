# Tasaalt Studio — cloud worker

This repository is the free cloud worker of **Tasaalt Studio** (استوديو «هل تساءلت يومًا؟»).
The studio server starts it through GitHub Actions to render episode previews and final videos
(and, optionally, to transcribe voice for alignment). Files are uploaded here automatically by the
studio installer — you don't need to edit anything.

- `worker.js` — downloads the episode from the studio, renders, uploads the result back.
- `lib/render.js` — headless Chrome frame rendering (same engine as the desktop studio).
- `lib/media.js` — ffmpeg helpers.
- `.github/workflows/studio.yml` — the Actions workflow (manual dispatch only).

Keep this repository **private**.
