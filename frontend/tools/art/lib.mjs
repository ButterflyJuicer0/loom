// What every theme's pictures are drawn with. A theme's own are in
// tools/art/<id>.mjs, written as SVG to src/themes/art/<id>-*.svg.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/themes/art")
fs.mkdirSync(out, { recursive: true })

export const write = (name, svg) => fs.writeFileSync(path.join(out, name), svg.replace(/\n\s*/g, "") + "\n")
export const svg = (viewBox, body, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra}>${body}</svg>`

// A small seeded random, so the art is the same on every run.
export function random(seed) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

// ── Pixel art ────────────────────────────────────────────────────────────
// A sprite is a grid of characters and a palette: one square per character,
// "." (or any character the palette lacks) left empty. Runs along a row are
// merged into one rectangle.
export function pixels(rows, palette, ox = 0, oy = 0) {
  let s = ""
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x]
      let n = 1
      while (x + n < row.length && row[x + n] === c) n++
      if (palette[c]) s += `<rect x="${ox + x}" y="${oy + y}" width="${n}" height="1" fill="${palette[c]}"/>`
      x += n
    }
  })
  return s
}

// A sprite as an SVG of its own, `w` by `h` squares, drawn with hard edges.
export const sprite = (w, h, body) => svg(`0 0 ${w} ${h}`, body, ` width="${w}" height="${h}" shape-rendering="crispEdges"`)

// A grid straight to a file: every row must be as long as the first.
export function writeSprite(name, rows, palette) {
  const bad = rows.findIndex((row) => row.length !== rows[0].length)
  if (bad >= 0) throw new Error(`${name}: row ${bad} is ${rows[bad].length} wide, not ${rows[0].length}`)
  write(name, sprite(rows[0].length, rows.length, pixels(rows, palette)))
}
