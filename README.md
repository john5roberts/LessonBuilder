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


## 0.86 repair
Restores the Fingering state helpers accidentally removed during the chord-movement refactor.
The Mode cycle is again Framework → Played Notes → Fingering → Framework.
HTML references use `?v=0.86` cache-busting query strings so GitHub Pages/Safari fetch the repaired runtime.


## 0.87 audio repair
This package is now self-contained. It includes seven local guitar WAV samples under:

`samples/guitar/`

Do not omit this folder when uploading to GitHub. The shared runtime still has its Web Audio fallback, and that fallback now explicitly retries after a suspended AudioContext resumes rather than silently dropping the note.
