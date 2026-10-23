# Lesson Builder + Snippet Reader — Phase 1 / 0.85

This is the first shared-player repository layout.

- `index.html` — Lesson Builder authoring app
- `reader.html` — standalone Snippet Reader
- `player/player-core.js` — one shared runtime used by both pages
- `player/player.css` — one shared visual stylesheet used by both pages
- `player/reader.js` — tiny Reader-only snippet loader/dropdown
- `snippets/index.json` — snippet catalog
- `snippets/*.json` — saved snippet data

For this first milestone, the bundled Reader loads `Demo — Chord Hammer-on`.

The Reader deliberately hides Admin/Create Open/Approve/Recall. Its playback UI is the same Player runtime used by Lesson Builder.

The existing guitar sample lookup paths remain unchanged (`samples/guitar/...` plus the existing fallback behavior), so when this folder is uploaded to the existing GitHub repository the current sample folder can remain where it already is.


## 0.85 Reader correction

`reader.html` is now a player-only shell. It contains no visible Admin, authoring, movement, score-editing, approval, or recall controls. Hidden runtime support nodes exist only so the exact shared `player-core.js` can run unchanged in both Lesson Builder and Reader.
