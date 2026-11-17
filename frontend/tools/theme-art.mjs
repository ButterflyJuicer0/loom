// The pictures of Loom's designed themes, drawn in code and written as SVG to
// src/themes/art/. A theme's are in tools/art/<id>.mjs (tools/art/lib.mjs is
// what they are drawn with), and every file it writes is named <id>-*.svg;
// <id>-mark.svg is the one on its card in Settings.
//
//   node tools/theme-art.mjs            every theme
//   node tools/theme-art.mjs celeste    one
//
// They are tributes: drawn by hand after looking at the real thing, never
// taken from a game's files.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "art")
const wanted = process.argv.slice(2)
const ids = wanted.length ? wanted : fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && f !== "lib.mjs").map((f) => f.slice(0, -4))
for (const id of ids) {
  await import(path.join(dir, `${id}.mjs`))
  console.log(`${id} → src/themes/art/${id}-*.svg`)
}
