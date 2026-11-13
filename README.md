# Dispatch

A personal morning news app: the world's most important stories, explained,
with a daily quiz. A new edition is published every morning by 08:00 Athens time.

**Live:** https://optickbl.github.io/dispatch/. In Safari, tap Share → Add to Home Screen.

## How it works

- The app (`index.html`, `app.js`, `styles.css`, `sw.js`) is a static web app on GitHub Pages.
- Each morning a scheduled Claude task researches the news, writes an edition
  following [`EDITOR.md`](EDITOR.md), validates it with `scripts/publish.py`
  and pushes it to `data/`.
- `data/latest.json` is the current edition. `data/index.json` lists every
  edition, and each one is kept in `data/editions/`.

Fonts: Newsreader and Inter, under the SIL Open Font License (see `fonts/`).
