# A theme's files

A designed theme touches no file but its own, so several can be worked on at
once. For a theme `<id>`:

| File | What it is |
| --- | --- |
| `tools/themes/<id>.json` | Its tokens: `id`, `order` (where it comes in Settings' list), `name` and `blurb` (`en`, `zh`), `font` (`sans`, `serif`, `rounded`, `mono`, `hand`, `pixel`), optional `outline` (px), and `styles.light` / `styles.dark` — a shadcn/ui preset as tweakcn exports them (colours, `radius`, `shadow-*`). |
| `tools/art/<id>.mjs` | Its pictures, drawn in code with `tools/art/lib.mjs` (pixel sprites are grids of characters and a palette). Writes `src/themes/art/<id>-*.svg`; `<id>-mark.svg` is the one on its card in Settings. |
| `src/themes/<id>.css` | Its design: what it does with the pictures, component by component. Every selector starts `html[data-style="<id>"][data-theme]`. |
| `src/themes/<id>.tokens.css`, `<id>.meta.json` | Generated from the JSON by `node tools/themes.mjs <id>`. |

`node tools/themes.mjs [id]` and `node tools/theme-art.mjs [id]` regenerate
one theme or all. Nothing else needs editing: `src/themes/index.ts` fetches
a theme's `src/themes/<id>*.css` when it is chosen (and only then), `src/themes.ts` lists every `*.meta.json`, and the
picker finds every `*-mark.svg`.

The pictures are tributes, drawn by hand after looking at the real thing.
Nothing is taken from a game's files, and no logo or wordmark is reproduced.

## What the components give a theme to hold on to

- `--usage` on `.turn-line` (and `data-usage`, a whole percent): how full the
  context is, 0 to 1 — for a real gauge, e.g. `width: calc(var(--usage) * 100%)`.
  Absent when the window is unknown.
- `data-tool` on `.tool` (a single call), on `.tool-chip` (a name on a folded
  card) and on `.tool.group` (its first tool): the tool's name (`Bash`,
  `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, `Agent`,
  `mcp__…`) — for a picture per tool.
- `--font-pixel`: Fusion Pixel (bundled, Simplified Chinese included) for
  `"font": "pixel"`.
