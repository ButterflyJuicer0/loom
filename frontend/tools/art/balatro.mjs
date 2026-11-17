import { sprite, svg, write } from "./lib.mjs"

// ── 小丑牌 (Balatro) ─────────────────────────────────────────────────────
// Drawn after the game's own screens: the slate panels of its left column
// and their stepped corners, the blue chips box and the red mult box, its
// red, blue, orange and green buttons, white cards with their four suits, the
// red deck's back, the Joker, a booster pack, the blind chips, the flames a
// big score sets on the two boxes, and the paint that swirls behind it all.
// Nothing is taken from the game's files.

// A grid of characters and a palette to a file, as lib.mjs's writeSprite
// does, but one path for each colour: these pictures are many and some are
// large.
function writeSprite(name, rows, palette) {
  const bad = rows.findIndex((row) => row.length !== rows[0].length)
  if (bad >= 0) throw new Error(`${name}: row ${bad} is ${rows[bad].length} wide, not ${rows[0].length}`)
  const paths = {}
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x]
      let n = 1
      while (x + n < row.length && row[x + n] === c) n++
      if (palette[c]) paths[c] = (paths[c] ?? "") + `M${x} ${y}h${n}v1h-${n}z`
      x += n
    }
  })
  const body = Object.entries(paths).map(([c, d]) => `<path d="${d}" fill="${palette[c]}"/>`).join("")
  write(name, sprite(rows[0].length, rows.length, body))
}

// The colours, sampled from its screens.
const C = {
  white: "#ffffff",
  edge: "#c3cbdb", // a card's lower edge
  ink: "#374244", // the slate of its panels, and of the print on a card
  panel: "#1b2628",
  cell: "#2f3a3c",
  row: "#4f6367",
  blue: "#0092ff",
  blueDeep: "#0a6fd0",
  // What a label is written on: a shade deeper than the game's own, so
  // that white reads on it (4.5 to 1 on the blue and the red).
  blueFill: "#0078d6",
  redFill: "#de3629",
  orangeFill: "#d67100",
  red: "#fe4c40",
  redDeep: "#c5362e",
  orange: "#ff9700",
  orangeDeep: "#cf7400",
  gold: "#efb345",
  green: "#34bd85",
  greenDeep: "#23946a",
  purple: "#706ecf",
  grey: "#545454",
  spade: "#29305c",
  heart: "#f11b51",
  club: "#0b4a45",
  diamond: "#f15927",
}

// ── Frames ───────────────────────────────────────────────────────────────
// What a panel or a button is cut from: a fill with stepped corners, a
// shadow under it, optionally a line round it. Nine-sliced by `border-image`
// at two screen pixels to the square; `corner` is how far each row from the
// top is cut in, `drop` how many rows of shadow hang under the body.
function frame(name, { fill, line, drop = 2, shadow = "#000000", shadowOpacity = 0.32, corner = [3, 1, 1], lineBottom = 1 }) {
  const c = corner.length
  const w = 2 * c + 1
  const h = 2 * c + 1
  const inset = (y) => (y < c ? corner[y] : y >= h - c ? corner[h - 1 - y] : 0)
  let s = ""
  // The shadow: the body's own shape, lower.
  for (let y = 0; y < h; y++) {
    const i = inset(y)
    if (drop) s += `<rect x="${i}" y="${y + drop}" width="${w - 2 * i}" height="1" fill="${shadow}" fill-opacity="${shadowOpacity}"/>`
  }
  const inside = (x, y) => y >= 0 && y < h && x >= inset(y) && x < w - inset(y)
  for (let y = 0; y < h; y++) {
    const i = inset(y)
    s += `<rect x="${i}" y="${y}" width="${w - 2 * i}" height="1" fill="${line ?? fill}"/>`
    if (!line) continue
    // Inside the line: every square whose neighbours are all inside too.
    for (let x = i; x < w - i; ) {
      const deep = (xx) => inside(xx - 1, y) && inside(xx + 1, y) && inside(xx, y - 1) && inside(xx, y + lineBottom) && inside(xx, y + 1)
      if (!deep(x)) {
        x++
        continue
      }
      let n = 1
      while (deep(x + n)) n++
      s += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${fill}"/>`
      x += n
    }
  }
  write(name, sprite(w, h + drop, s))
}

frame("balatro-f-panel.svg", { fill: C.panel })
frame("balatro-f-cell.svg", { fill: C.cell, drop: 0 })
frame("balatro-f-well.svg", { fill: C.panel, drop: 0 })
frame("balatro-f-row.svg", { fill: C.row })
// A dialog: slate, a pale line round it, thicker along the foot.
frame("balatro-f-dialog.svg", { fill: C.ink, line: "#dae1e7", lineBottom: 2, shadowOpacity: 0.4 })
// A tooltip's white box, and the slate one round it.
// The dock under the hand, a pale line round it; a card's back as a button;
// a panel gone wrong.
frame("balatro-f-dock.svg", { fill: C.panel, line: "#dae1e7" })
frame("balatro-f-deck.svg", { fill: "#f1503f", line: "#fbfffc", shadow: "#8a94a6", shadowOpacity: 1, drop: 1, corner: [2, 1] })
frame("balatro-f-bad.svg", { fill: C.panel, line: C.red })
frame("balatro-f-card-up.svg", { fill: C.white, drop: 2, shadowOpacity: 0.45, corner: [2, 1] })
frame("balatro-f-tip.svg", { fill: C.white, line: "#dae1e7", drop: 1 })
frame("balatro-f-card.svg", { fill: C.white, shadow: "#8a94a6", shadowOpacity: 1, drop: 1, corner: [2, 1] })
frame("balatro-f-card-3.svg", { fill: C.white, shadow: "#8a94a6", shadowOpacity: 1, drop: 1 })
for (const [k, fill] of [["blue", C.blueFill], ["red", C.redFill], ["orange", C.orangeFill]]) {
  frame(`balatro-f-${k}.svg`, { fill })
  // Pressed: down into its own shadow.
  frame(`balatro-f-${k}-down.svg`, { fill, drop: 0 })
}
frame("balatro-f-grey.svg", { fill: C.grey })
frame("balatro-f-gold.svg", { fill: "#9e6800" })
frame("balatro-f-pill-blue.svg", { fill: C.blueFill, drop: 0, corner: [2, 1] })
frame("balatro-f-pill-red.svg", { fill: C.redFill, drop: 0, corner: [2, 1] })
frame("balatro-f-pill-dark.svg", { fill: C.panel, drop: 0, corner: [2, 1] })
frame("balatro-f-pill-cell.svg", { fill: C.cell, drop: 0, corner: [2, 1] })

// ── The four suits ───────────────────────────────────────────────────────
const SUITS = {
  spade: ["...#...", "..###..", ".#####.", "#######", "##.#.##", "...#...", "..###.."],
  heart: [".##.##.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."],
  club: ["..###..", "..###..", "##.#.##", "#######", "##.#.##", "...#...", "..###.."],
  diamond: ["...#...", "..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."],
}

// A small card with one pip on it: a list's dot.
function pipCard(suit) {
  const rows = []
  const W = 11
  const H = 14
  for (let y = 0; y < H; y++) {
    let r = ""
    for (let x = 0; x < W; x++) {
      const corner = (x === 0 || x === W - 1) && (y === 0 || y >= H - 2)
      if (corner) r += "."
      else if (y === H - 1) r += "e"
      else {
        const px = x - 2
        const py = y - 3
        r += py >= 0 && py < 7 && px >= 0 && px < 7 && SUITS[suit][py][px] === "#" ? "#" : "w"
      }
    }
    rows.push(r)
  }
  writeSprite(`balatro-pip-${suit}.svg`, rows, { w: C.white, e: C.edge, "#": C[suit] })
}
Object.keys(SUITS).forEach(pipCard)

// A card's corner: its rank over its suit. An ace of spades.
writeSprite(
  "balatro-index.svg",
  ["..#..", ".###.", "##.##", "#####", "##.##", "##.##", ".....", "..#..", ".###.", "#####", "#####", "..#..", ".###."],
  { "#": C.spade },
)

// ── Chips ────────────────────────────────────────────────────────────────
// The chip beside a score: a disc, eight notches round its rim.
const CHIP = [
  "....WnnnW....",
  "..WWWnnnWWW..",
  ".WnnWWWWWnnW.",
  ".WnnWWWWWnnW.",
  "WWWWWWWWWWWWW",
  "nnWWWWWWWWWnn",
  "nnWWWWWWWWWnn",
  "nnWWWWWWWWWnn",
  "WWWWWWWWWWWWW",
  ".WnnWWWWWnnW.",
  ".WnnWWWWWnnW.",
  "..WWWnnnWWW..",
  "....WnnnW....",
]
writeSprite("balatro-chip.svg", CHIP, { W: "#f4f8f9", n: "#4f6367" })
writeSprite("balatro-chip-blue.svg", CHIP, { W: C.blue, n: "#ffffff" })
writeSprite("balatro-chip-red.svg", CHIP, { W: C.red, n: "#ffffff" })
writeSprite("balatro-chip-gold.svg", CHIP, { W: C.gold, n: "#fff3cf" })
writeSprite("balatro-chip-green.svg", CHIP, { W: C.green, n: "#ffffff" })
writeSprite("balatro-chip-grey.svg", CHIP, { W: "#9aa7ab", n: "#e3e9eb" })

// A blind's chip: a coin seen a little from above, light across its top,
// its mark in the middle.
function blind(name, { face, side, shine, mark, glyph }) {
  const N = 19
  const rows = []
  for (let y = 0; y < N; y++) {
    let r = ""
    for (let x = 0; x < N; x++) {
      const top = Math.hypot(x - 8.5, y - 8) <= 8.2
      const low = Math.hypot(x - 9.5, y - 10) <= 8.2
      if (top) {
        const gx = x - 5
        const gy = y - 4
        const g = gy >= 0 && gy < glyph.length && gx >= 0 && gx < glyph[0].length && glyph[gy][gx] === "#"
        const band = x + y
        r += g ? "m" : band === 9 || band === 12 ? "s" : "f"
      } else r += low ? "d" : "."
    }
    rows.push(r)
  }
  writeSprite(name, rows, { f: face, d: side, s: shine, m: mark })
}
blind("balatro-blind-small.svg", {
  face: "#3d74d6",
  side: "#274c93",
  shine: "#6f9bea",
  mark: "#18264a",
  glyph: [".......", ".#####.", ".#.....", ".#####.", ".....#.", ".#####.", ".......", "..###..", "......."],
})
blind("balatro-blind-big.svg", {
  face: "#e79a1f",
  side: "#9a6410",
  shine: "#f3bc5b",
  mark: "#3a3423",
  glyph: [".......", ".####..", ".#...#.", ".####..", ".#...#.", ".####..", ".......", "..###..", "......."],
})
// A boss: the hook of The Goad.
blind("balatro-blind-boss.svg", {
  face: "#b9488c",
  side: "#6d2a55",
  shine: "#d77fb4",
  mark: "#4a1b3a",
  glyph: [".....#.", "....##.", "...##..", "..##...", ".##....", "##.....", "#######", ".......", "......."],
})

// ── A card's back: the red deck ──────────────────────────────────────────
// At the size the game draws a card, 71 by 95, after its red deck: a white
// edge, a dotted line and a frame inside it, two rounds of three rings one
// over the other, a pointed medallion at the head and the foot, a square
// emblem in each quarter, two more where the rounds meet with a spiked bar
// between them, a wedge at each side. One quarter is worked out and the
// other three are its reflections.
function backRows() {
  const W = 71
  const H = 95
  const rows = []
  for (let y = 0; y < H; y++) {
    let r = ""
    for (let x = 0; x < W; x++) {
      const ax = Math.abs(x - 35)
      const ay = Math.abs(y - 47)
      if ((ax === 35 && ay >= 46) || (ax >= 34 && ay === 47)) {
        r += "."
        continue
      }
      if (ax >= 32 || ay >= 44) {
        r += "w"
        continue
      }
      let c = "r"
      const on = (t) => {
        if (t) c = "w"
      }
      const off = (t) => {
        if (t) c = "r"
      }
      // The dotted line, a small square on it at each side.
      on((ax === 29 || ay === 41) && ax <= 29 && ay <= 41 && (ax + ay) % 2 === 0)
      on(Math.abs(ax - 29) <= 1 && Math.abs(ay - 13) <= 1)
      off(ax === 29 && ay === 13)
      // The frame, its corners cut; a dotted one inside it.
      const cut = ax + ay
      on(((ax === 26 && ay <= 33) || (ay === 38 && ax <= 21) || (cut === 59 && ax >= 21 && ax <= 26)) && true)
      const inFrame = ax < 26 && ay < 38 && cut < 59
      on(inFrame && (ax === 24 || ay === 36 || cut === 56) && (ax + ay) % 2 === 1 && ax <= 24 && ay <= 36 && cut <= 56)
      if (inFrame && ax < 24 && ay < 36 && cut < 56) {
        // The rounds: three rings to each, fine lines on the red.
        const d = Math.hypot(ax / 20.5, (ay - 18) / 18)
        on(Math.abs(d - 1) < 0.04)
        on(Math.abs(d - 0.84) < 0.032)
        on(Math.abs(d - 0.68) < 0.036 && (ax + ay) % 2 === 0)
        // An emblem in each quarter: a square, an eye in it, a point above
        // and below.
        const ex = Math.abs(ax - 11.5)
        const ey = Math.abs(ay - 19)
        on(ex <= 4.5 && ey <= 3 && ex + ey < 7)
        off(ex <= 3.5 && ey <= 2 && ex + ey < 5)
        on(ex <= 1.5 && ey <= 1 && ex + ey < 2.5)
        off(ex <= 0.5 && ey === 0)
        on(Math.abs(ax - 11.5) + Math.abs(ay - 12.5) <= 1.5)
        on(Math.abs(ax - 11.5) + Math.abs(ay - 25.5) <= 1.5)
        // Where the rounds meet: an emblem above and below, barred.
        const cy = ay - 8
        on(ax <= 7 && Math.abs(cy) <= 5 && ax + Math.abs(cy) < 11)
        off(ax <= 5 && (cy === -3 || cy === 1))
        off(ax >= 1 && ax <= 5 && cy === -1)
        off(ax <= 2 && cy === 3)
        on(ax <= 1 && cy >= 6 && cy <= 8)
        // Between them: a bar, a spike at each end.
        on(ax <= 14 && ay <= 2)
        off(ay === 0 && ax <= 13)
        off(ax >= 6 && ax <= 12 && ay <= 2.6 - Math.abs(ax - 9) * 0.9)
        // A wedge at each side, pointing in.
        on(ax >= 15 && ax <= 23 && ay <= (ax - 14) * 0.8)
        off(ax >= 18 && ax <= 22 && ay <= (ax - 17.5) * 0.6)
      }
      // The medallion at the head, over the frame: pointed, a red diamond
      // in it, a white heart to that.
      const my = Math.abs(ay - 34.5)
      if (ay <= 42) {
        on(ax / 8 + my / 9.5 <= 1)
        off(ax / 5 + my / 6 <= 1)
        on(ax / 2.2 + my / 2.6 <= 1)
        off(ax === 0 && my <= 0.5)
      }
      r += c
    }
    rows.push(r)
  }
  return rows
}
const BACK = { w: "#fbfffc", r: "#f1503f", e: C.edge, d: "#9aa3b2" }
writeSprite("balatro-back.svg", backRows(), BACK)

// The deck: a few more under it, down and to the left.
{
  const b = backRows()
  const W = 71 + 4
  const H = 95 + 4
  const grid = Array.from({ length: H }, () => Array(W).fill("."))
  for (let k = 4; k >= 1; k--) {
    for (let y = 0; y < 95; y++) for (let x = 0; x < 71; x++) if (b[y][x] !== ".") grid[y + k][x + 4 - k] = k % 2 ? "d" : "e"
  }
  for (let y = 0; y < 95; y++) for (let x = 0; x < 71; x++) if (b[y][x] !== ".") grid[y][x + 4] = b[y][x]
  writeSprite("balatro-deck.svg", grid.map((r) => r.join("")), BACK)
}

// A back in small, for a mark: the same card, read from across the table.
{
  const rows = []
  for (let y = 0; y < 14; y++) {
    let r = ""
    for (let x = 0; x < 11; x++) {
      const corner = (x === 0 || x === 10) && (y === 0 || y >= 12)
      const ax = Math.abs(x - 5)
      const ay = Math.abs(y - 6)
      if (corner) r += "."
      else if (y === 13) r += "e"
      else if (x === 0 || x === 10 || y === 0 || y === 12) r += "w"
      else r += ax + ay === 3 || (ax === 0 && ay === 0) || (ax === 4 && ay === 5) ? "w" : "r"
    }
    rows.push(r)
  }
  writeSprite("balatro-mini-back.svg", rows, BACK)
}

// ── The Joker ────────────────────────────────────────────────────────────
// A white card, JOKER down one side and up the other; a jester: a red cap
// that tips over with a bell at its end, an orange horn each side with a
// bell too, a white face that grins, a blue ruff, two small cards below.
const LETTERS = {
  J: [".##", "..#", "#.#", "###"],
  O: ["###", "#.#", "#.#", "###"],
  K: ["#.#", "##.", "##.", "#.#"],
  E: ["###", "##.", "#..", "###"],
  R: ["##.", "#.#", "##.", "#.#"],
}
const JESTER = [
  // x = 6 … 28, y = 3 … 40
  ".............RR........",
  "............RRRR.......",
  "...........RRRRRkk.....",
  "..........RRRRRkWWk....",
  "..........RRRRRkWWk....",
  ".........RRRRRRRkk.....",
  "...OOOOOORRRRRRRROOOO..",
  "..OOOOOORRRRRRRRROOOOO.",
  ".OOOO...RRRRRRRRRR.OOOO",
  ".OOO...RRRRRRRRRRR..OOO",
  ".OO....RRRRRRRRRRR...OO",
  ".qq....RFFFFFFFFFR..qq.",
  "qWWq...RPPPFFFPPPR.qWWq",
  "qWWq...fPEPFnFPEPF.qWWq",
  ".qq....fFFFFnFFFFF..qq.",
  "......fFMMMMMMMMMFF....",
  "......fMMMMMMMMMMMF....",
  "......fMMTTTTTTTMMF....",
  "......fFMMMMMMMMMFF....",
  ".......fFMMMMMMMFF.....",
  "...BBBB.fFFMMMFFf.BBBB.",
  ".BBBBBBBBfffffffBBBBBBB",
  "BBBbBBBBBBbBbBBBBBBbBBB",
  "BBbBBBBBBbBBBbBBBBBBbBB",
  "BbBBBBBBbBBBBBbBBBBBBbB",
  "BBBBBBBBBBBDBBBBBBBBBBB",
  "rBBBBDBBBBB.BBBBBDBBBBk",
  "rrBBD.BBBBB.BBBBB.DBBkk",
  ".r....BBBBB.BBBBB....k.",
  "......BBBB...BBBB......",
  "......DBB.....BBD......",
  ".....kk.........rr.....",
  ".......................",
  "......gggg...gggg......",
  "......g..g...g..g......",
  "......g.kg...gr.g......",
  "......g..g...g..g......",
  "......gggg...gggg......",
]

function joker(name, p, card = C.white, ink = C.ink) {
  const W = 35
  const H = 47
  const grid = Array.from({ length: H }, () => Array(W).fill("w"))
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) grid[y][x] = "."
  for (let x = 1; x < W - 1; x++) grid[H - 1][x] = "e"
  for (let y = 1; y < H - 1; y++) grid[y][W - 1] = "e"
  // JOKER, down the left; then the same turned round, up the right.
  "JOKER".split("").forEach((ch, i) => {
    LETTERS[ch].forEach((row, dy) => {
      for (let dx = 0; dx < 3; dx++) {
        if (row[dx] !== "#") continue
        const x = 2 + dx
        const y = 3 + i * 5 + dy
        grid[y][x] = "i"
        grid[H - 2 - y][W - 2 - x] = "i"
      }
    })
  })
  JESTER.forEach((row, dy) => {
    if (row.length !== 23) throw new Error(`jester row ${dy} is ${row.length} wide`)
    for (let dx = 0; dx < row.length; dx++) if (row[dx] !== ".") grid[3 + dy][6 + dx] = row[dx]
  })
  writeSprite(name, grid.map((r) => r.join("")), {
    w: card,
    e: C.edge,
    i: ink,
    k: C.ink,
    g: "#b5bfd0",
    q: "#8793a3",
    f: "#b9c2cf",
    n: "#b9c2cf",
    F: "#ffffff",
    W: "#ffffff",
    T: "#ffffff",
    E: "#263336",
    M: "#f2392e",
    P: C.orange,
    r: C.red,
    ...p,
  })
}
// Three of the troupe, as the shop deals them: the Joker; an orange cap
// over a red ruff; a blue cap over a grey one.
const TROUPE = [
  { R: C.red, O: C.orange, B: C.blue, b: "#7cc8ff", D: "#0a5fc0", o: "#0a4a9e" },
  { R: C.orange, O: "#3a3a44", P: "#ff7a6e", B: C.red, b: "#ff9c93", D: "#b8302a", o: "#8a1d16", r: "#3a3a44" },
  { R: C.blue, O: "#3a3a44", B: "#8d98a8", b: "#c9d1dc", D: "#5d6878", o: "#48515e", M: "#1f6fd6", m: "#174f9c", r: "#3a3a44" },
]
// Small, for a row or a mark.
joker("balatro-joker-s.svg", TROUPE[0])
joker("balatro-joker-s-2.svg", TROUPE[1])
joker("balatro-joker-s-3.svg", TROUPE[2])
joker("balatro-mark.svg", TROUPE[0])

// The same card at the size the game draws it, 71 by 95, where there is
// room for a face: the cap's tip curls over to its bell, the horns are
// crescents, the eyes sit in orange patches over a grin with teeth in it,
// the ruff has five lobes with light along each, and every part is outlined.
// Built from shapes (ellipses and a polygon) so its curves step evenly; the
// face's small parts are put in by hand.
const SLAB = {
  J: ["..#####", "....##.", "....##.", "....##.", "....##.", "##..##.", "##..##.", ".####.."],
  O: [".#####.", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", ".#####."],
  K: ["###.###", ".##.##.", ".####..", ".###...", ".####..", ".##.##.", ".##..##", "###.###"],
  E: ["#######", ".##...#", ".##.#..", ".####..", ".##.#..", ".##....", ".##...#", "#######"],
  R: ["######.", ".##..##", ".##..##", ".#####.", ".##.#..", ".##.##.", ".##..##", "###..##"],
}
function bigJoker(name, p) {
  const W = 71
  const H = 95
  const g = Array.from({ length: H }, () => Array(W).fill(" "))
  const each = (fn) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fn(x, y, x + 0.5, y + 0.5)
  }
  const inEllipse = (px, py, cx, cy, rx, ry, rot = 0) => {
    const dx = px - cx
    const dy = py - cy
    const u = dx * Math.cos(rot) + dy * Math.sin(rot)
    const v = -dx * Math.sin(rot) + dy * Math.cos(rot)
    return (u / rx) ** 2 + (v / ry) ** 2 <= 1
  }
  const ellipse = (c, cx, cy, rx, ry, rot = 0, also = () => true) =>
    each((x, y, px, py) => {
      if (inEllipse(px, py, cx, cy, rx, ry, rot) && also(px, py, x, y)) g[y][x] = c
    })
  const inPoly = (pts, px, py) => {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }

  // The ruff: a lobe from the neck to each of four points, a band across
  // the top; light along each lobe; its points shod red and dark.
  const neck = [36, 49]
  const tips = [[13.5, 61, "r"], [24, 68.5, "k"], [45, 68.5, "r"], [56, 61, "k"]]
  for (const [tx, ty] of tips) {
    const dx = tx - neck[0]
    const dy = ty - neck[1]
    const len = Math.hypot(dx, dy)
    ellipse("B", neck[0] + dx * 0.56, neck[1] + dy * 0.56, len * 0.52, 4.7 - Math.abs(dx) * 0.03, Math.atan2(dy, dx))
  }
  ellipse("B", 36, 50.6, 12.5, 4.4)
  for (const [tx, ty] of tips) {
    const dx = tx - neck[0]
    const dy = ty - neck[1]
    for (let t = 0.3; t < 0.82; t += 0.02) {
      const x = Math.round(neck[0] + dx * t - dy * 0.07)
      const y = Math.round(neck[1] + dy * t + dx * 0.07 - 1)
      if (g[y][x] === "B") g[y][x] = "b"
    }
  }
  // Its under-edge in shade.
  each((x, y) => {
    if (g[y][x] === "B" && y + 1 < H && g[y + 1][x] === " ") g[y][x] = "D"
  })
  for (const [tx, ty, c] of tips) ellipse(c, tx, ty, 2.3, 2)

  // The head: shade behind it to the left, then the face.
  ellipse("f", 34.6, 39.6, 11.2, 9.6)
  ellipse("F", 36.5, 38.2, 10.4, 10)
  // The horns: crescents, out and down from behind the cap.
  ellipse("O", 22.6, 25, 8.2, 7.6, 0, (px, py) => !inEllipse(px, py, 22, 30.4, 6.4, 6.2) && py < 29.6)
  ellipse("O", 48.6, 25.6, 7.2, 7.2, 0, (px, py) => !inEllipse(px, py, 49.2, 30.8, 5.4, 6) && py < 30)
  // The cap: a cone that tips over to the right, a brim over the brow.
  each((x, y, px, py) => {
    if (inPoly([[38.4, 6.2], [41.4, 8.4], [44.6, 16], [47.6, 28.6], [25.4, 28.6], [31.2, 17]], px, py)) g[y][x] = "R"
  })
  ellipse("R", 36.5, 28.4, 11.2, 2.6)
  // Shade down the cap's right side.
  each((x, y, px, py) => {
    if (g[y][x] === "R" && inPoly([[42.2, 12], [44.6, 16], [47.6, 28.6], [44.2, 28.6]], px, py)) g[y][x] = "S"
  })
  // Bells: one on the cap's tip, one on each horn.
  for (const [bx, by] of [[43.6, 13.4], [16.4, 30.2], [53.6, 31.2]]) {
    ellipse("k", bx, by, 3.3, 3.3)
    ellipse("W", bx, by, 2.2, 2.2)
  }
  // The eyes: an orange patch each, a dark eye in it.
  ellipse("P", 30.8, 34, 3.7, 2.2)
  ellipse("P", 41.7, 34.3, 3.7, 2.2)
  for (const [ex, ey] of [[30, 33], [31, 33], [30, 34], [41, 34], [42, 34], [42, 33]]) g[ey][ex] = "E"
  g[33][31] = "T"
  g[33][41] = "T"
  // The nose.
  g[37][36] = "n"
  g[37][37] = "n"
  g[36][36] = "n"
  // The grin: wide, its corners turned up, teeth across it.
  ellipse("M", 36.3, 40.4, 9.3, 6.7, 0, (px, py) => !inEllipse(px, py, 36.3, 35.8, 10.6, 3.9))
  ellipse("T", 36.3, 41.4, 6.6, 2, 0, (px, py) => !inEllipse(px, py, 36.3, 38.6, 8, 2.5))
  each((x, y) => {
    if (g[y][x] === "M" && y + 1 < H && (g[y + 1][x] === "F" || g[y + 1][x] === "f")) g[y][x] = "m"
  })

  // An outline round every part, in a colour of its own.
  const lineOf = { B: "o", b: "o", D: "o", F: "g", f: "g", M: "g", m: "g", R: "k", S: "k", O: "k", P: "k" }
  const lines = []
  each((x, y) => {
    if (g[y][x] !== " ") return
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = (g[y + dy] ?? [])[x + dx]
      if (lineOf[c]) return lines.push([x, y, lineOf[c]])
    }
  })
  for (const [x, y, c] of lines) g[y][x] = c
  // Under it: two small cards, tipped apart.
  for (const [cx, cy, rot, dot] of [[28.6, 77, -0.22, "k"], [38.6, 77, 0.22, "r"]]) {
    each((x, y, px, py) => {
      const dx = px - cx
      const dy = py - cy
      const u = Math.abs(dx * Math.cos(rot) + dy * Math.sin(rot))
      const v = Math.abs(-dx * Math.sin(rot) + dy * Math.cos(rot))
      if (u <= 4 && v <= 5.2 && u + v < 8.4) g[y][x] = u > 3 || v > 4.2 || u + v > 6.6 ? "c" : "W"
    })
    g[Math.round(cy - 0.5)][Math.round(cx - 0.5)] = dot
  }
  // JOKER down the left, and turned round up the right.
  "JOKER".split("").forEach((ch, i) => {
    SLAB[ch].forEach((row, dy) => {
      for (let dx = 0; dx < 7; dx++) {
        if (row[dx] !== "#") continue
        const x = 4 + dx
        const y = 6 + i * 9 + dy
        g[y][x] = "i"
        g[H - 1 - y][W - 1 - x] = "i"
      }
    })
  })
  // The card itself: white, a pale edge, its corners rounded.
  each((x, y) => {
    const ax = Math.min(x, W - 1 - x)
    const ay = Math.min(y, H - 1 - y)
    if (ax + ay < 2) g[y][x] = "."
    else if (ax === 0 || ay === 0 || ax + ay === 2 || y >= H - 2) g[y][x] = "e"
    else if (g[y][x] === " ") g[y][x] = "w"
  })
  writeSprite(name, g.map((r) => r.join("")), {
    w: C.white,
    e: C.edge,
    i: C.ink,
    k: C.ink,
    c: "#b5bfd0",
    g: "#a3adbb",
    f: "#c5ccd6",
    n: "#b9c2cf",
    F: "#ffffff",
    W: "#ffffff",
    T: "#ffffff",
    E: "#263336",
    M: "#f2392e",
    m: "#c2281f",
    P: C.orange,
    S: "#d93a30",
    r: C.red,
    ...p,
  })
}
bigJoker("balatro-joker.svg", TROUPE[0])

// ── A small card for each kind of tool ───────────────────────────────────
// The suits are the four an agent plays most (the pip cards above). The
// rest are the game's other cards, as small as a pip card: a Planet for
// what searches, a Tarot for what goes out to the web, a Spectral for what
// comes from outside (MCP), a Joker for another agent.
function miniCard(name, body, draw, palette) {
  const rows = []
  for (let y = 0; y < 14; y++) {
    let r = ""
    for (let x = 0; x < 11; x++) {
      const corner = (x === 0 || x === 10) && (y === 0 || y >= 12)
      if (corner) r += "."
      else if (y === 13) r += "e"
      else if (x === 0 || x === 10 || y === 0 || y === 12) r += "d"
      else r += draw(x, y) ?? body
    }
    rows.push(r)
  }
  writeSprite(name, rows, palette)
}
miniCard(
  "balatro-mini-planet.svg",
  "t",
  (x, y) => {
    if (y === 2 && x >= 2 && x <= 8) return "p"
    if (y === 11 && x >= 2 && x <= 8 && x % 2 === 0) return "p"
    const d = Math.hypot(x - 5, y - 6.5)
    if (d <= 2.7) return x + y <= 10 ? "O" : "o"
    if ((x === 2 && y === 5) || (x === 8 && y === 9) || (x === 8 && y === 4)) return "p"
    return null
  },
  { t: "#3f8fa8", d: "#2a6478", e: "#1f4a59", p: "#cfe9f0", o: "#d9582f", O: "#f39a6c" },
)
miniCard(
  "balatro-mini-tarot.svg",
  "y",
  (x, y) => {
    if (x === 1 || x === 9 || y === 1 || y === 11) return "b"
    if (y === 10 && x >= 3 && x <= 7) return "W"
    const d = Math.hypot(x - 5, y - 5.5)
    if (Math.abs(d - 2.6) < 0.55) return "W"
    if (x === 5 || y === 5 || y === 6) return d < 2.6 ? "b" : null
    return null
  },
  { y: "#e3c27a", d: "#8f6a2a", e: "#6b4d1b", b: "#b98a3c", W: "#fff6da" },
)
miniCard(
  "balatro-mini-spectral.svg",
  "s",
  (x, y) => {
    const ax = Math.abs(x - 5)
    const ay = Math.abs(y - 6)
    if (ax === 0 && ay <= 3) return "W"
    if (ay === 0 && ax <= 3) return "W"
    if (ax === 1 && ay === 1) return "g"
    if ((x === 2 && y === 2) || (x === 8 && y === 10) || (x === 8 && y === 3) || (x === 2 && y === 9)) return "g"
    return null
  },
  { s: "#4f6bd6", d: "#2c3f8f", e: "#1f2c66", W: "#ffffff", g: "#a9b8ff" },
)
{
  const face = [
    ".....R...",
    "....RRk..",
    "....RRR..",
    ".OO.RRR.O",
    "O..RRRRR.",
    "...FEFEF.",
    "...FMMMF.",
    "..BBBBBBB",
    ".BBbBBbBB",
    ".B.BB.BB.",
  ]
  miniCard(
    "balatro-mini-joker.svg",
    "w",
    (x, y) => {
      const c = (face[y - 2] ?? "")[x - 1]
      return c && c !== "." ? c : null
    },
    { w: "#ffffff", d: "#dfe5ea", e: C.edge, R: C.red, O: C.orange, k: C.ink, F: "#ffffff", E: C.ink, M: "#f2392e", B: C.blue, b: "#7cc8ff" },
  )
}

// ── A booster pack ───────────────────────────────────────────────────────
// Foil, crimped along the top and the foot, a figure on it and a label.
{
  const W = 21
  const H = 31
  const rows = []
  for (let y = 0; y < H; y++) {
    let r = ""
    for (let x = 0; x < W; x++) {
      if (y < 3 || y > H - 4) {
        // The crimp: ridges.
        r += y === 2 || y === H - 3 ? "s" : x % 2 ? "c" : "C"
        continue
      }
      if (x === 0 || x === W - 1) {
        r += "o"
        continue
      }
      // The foil: bands of light across it.
      const band = (x + y * 2 + 60) % 17
      let c = band < 3 ? "h" : band < 6 ? "l" : "p"
      // A figure: a head, a pointed hat, a robe.
      const ax = Math.abs(x - 10)
      if (y >= 5 && y <= 8 && ax <= (y - 5) * 0.7 + 0.5) c = "F"
      if (y >= 9 && y <= 11 && ax <= 2) c = "F"
      if (y >= 12 && y <= 18 && ax <= 2 + (y - 12) * 0.5) c = "F"
      // The label.
      if (y >= 20 && y <= 24) c = y === 20 || y === 24 ? "o" : x > 2 && x < W - 3 && y === 22 && x % 4 !== 1 ? "o" : "y"
      r += c
    }
    rows.push(r)
  }
  writeSprite("balatro-pack.svg", rows, { C: "#e9e4ff", c: "#b9b2ee", s: "#8f86d9", o: "#4a3f8f", p: "#8a78e0", l: "#b9a6f2", h: "#e6dcff", F: "#f7f2ff", y: C.gold })
}

// The same pack as a frame, for a card that holds a file: the crimp tiles
// along its top and foot.
writeSprite("balatro-f-pack.svg", ["CcCc", "cCcC", "ssss", "oppo", "ssss", "CcCc", "cCcC"], { C: "#e9e4ff", c: "#b9b2ee", s: "#8f86d9", o: "#4a3f8f", p: "#6f5fd0" })

// ── Flames ───────────────────────────────────────────────────────────────
// What a big score sets on the chips box and the mult box. They stand on
// the box's top edge, and are flipped and stretched in turn to flicker.
function flame(name, tongues, p) {
  const W = 24
  const H = 12
  const rows = []
  for (let y = 0; y < H; y++) {
    let r = ""
    for (let x = 0; x < W; x++) {
      const h = tongues[x]
      const up = H - y // 1 at the foot
      if (up > h) {
        // A drop or two that has come away.
        r += tongues.sparks.some(([sx, sy]) => sx === x && sy === y) ? "2" : "."
      } else {
        const t = up / Math.max(h, 1)
        r += t > 0.72 ? "3" : t > 0.4 ? "2" : "1"
      }
    }
    rows.push(r)
  }
  writeSprite(name, rows, p)
}
const TONGUES_A = Object.assign([2, 4, 6, 5, 7, 9, 7, 5, 6, 8, 10, 8, 6, 5, 7, 9, 11, 9, 7, 5, 6, 4, 3, 2], { sparks: [[3, 2], [13, 1], [20, 3]] })
const TONGUES_B = Object.assign([3, 5, 4, 6, 8, 7, 9, 7, 5, 7, 9, 11, 8, 6, 8, 10, 8, 10, 8, 6, 4, 5, 3, 2], { sparks: [[1, 4], [8, 1], [18, 0], [22, 5]] })
const BLUE_FIRE = { 1: C.blue, 2: "#19c8ff", 3: "#7ff3ff" }
const RED_FIRE = { 1: C.red, 2: "#ff9b3d", 3: "#ffe9a6" }
flame("balatro-flame-blue-a.svg", TONGUES_A, BLUE_FIRE)
flame("balatro-flame-red-a.svg", TONGUES_B, RED_FIRE)

// ── Small marks ──────────────────────────────────────────────────────────
// The × between chips and mult.
writeSprite("balatro-times.svg", ["##...##", "###.###", ".#####.", "..###..", ".#####.", "###.###", "##...##"], { "#": C.red })
// Done: a tick, white with the font's shadow.
writeSprite(
  "balatro-check.svg",
  [".......##", "......###", ".....###s", "##..###s.", "######s..", ".####s...", "..##s....", "...s....."],
  { "#": "#ffffff", s: "#1b2628" },
)
// Failed: a card debuffed, a red cross over it.
writeSprite(
  "balatro-debuff.svg",
  [".wwwwwwwww.", "wXXwwwwwXXw", "wXXXwwwXXXw", "wwXXXwXXXww", "wwwXXXXXwww", "wwwwXXXwwww", "wwwXXXXXwww", "wwXXXwXXXww", "wXXXwwwXXXw", "wXXwwwwwXXw", "wwwwwwwwwww", "wwwwwwwwwww", ".eeeeeeeee."],
  { w: "#dfe5ea", X: C.red, e: C.edge },
)
// The pointer over what is chosen.
writeSprite("balatro-pointer-right.svg", ["#...", "##..", "###.", "####", "###.", "##..", "#..."], { "#": C.red })
// New: the red alert with its !
writeSprite(
  "balatro-alert.svg",
  [".#####.", "###w###", "###w###", "###w###", "#######", "###w###", ".#####."],
  { "#": C.red, w: "#ffffff" },
)
// Money.
writeSprite(
  "balatro-dollar.svg",
  ["...#...", ".#####.", "##.#...", ".####..", "...#.##", "...#.##", "#####..", "...#..."],
  { "#": C.gold },
)
// A playing card, small and blank: what is dealt while it works.
writeSprite(
  "balatro-card.svg",
  [".ooooo.", "owwwwwo", "owwwwwo", "owwwwwo", "owwwwwo", "owwwwwo", "owwwwwo", "owwwwwo", ".eeeee."],
  { w: C.white, o: "#aeb8c8", e: "#8a94a6" },
)
// A list of chips for a rule: blue, red, white, gold, a gap between.
{
  const N = 9
  const disc = (face, rim) => {
    const rows = []
    for (let y = 0; y < N; y++) {
      let r = ""
      for (let x = 0; x < N; x++) {
        const d = Math.hypot(x - 4, y - 4)
        const a = (Math.atan2(y - 4, x - 4) + Math.PI * 2) % (Math.PI * 2)
        r += d > 4.4 ? "." : d > 2.6 ? (Math.floor((a / (Math.PI * 2)) * 8 + 0.5) % 2 ? face : rim) : face
      }
      rows.push(r)
    }
    return rows
  }
  const set = [disc("b", "w"), disc("r", "w"), disc("g", "W"), disc("y", "Y")]
  const rows = Array.from({ length: N }, (_, y) => set.map((d) => d[y]).join("...."))
  writeSprite("balatro-chips.svg", rows.map((r) => r + "...."), { b: C.blue, r: C.red, w: "#ffffff", g: "#eaf2f4", W: "#4f6367", y: C.gold, Y: "#fff3cf" })
}

// ── The paint behind it all ──────────────────────────────────────────────
// A plane wound round its middle, then bent by sines of itself, finer each
// round, and cut into three tones: the look of the game's table. Three
// drawings of it, a third of a turn of its slow drift apart, to fade from
// one to the next. Light and dark only (white and black, mostly clear), so
// the same pictures lie on green felt and on gold.
function paint(ix, iy, t, W, H) {
  const x = ((ix + 0.5) / W - 0.5) * (W / H) - 0.06
  const y = (iy + 0.5) / H - 0.5 + 0.03
  const r = Math.hypot(x, y)
  const a = Math.atan2(y, x) + 2.6 * Math.exp(-r * 2.2) + 0.9 * r + 0.4
  let u = r * Math.cos(a) * 5.2
  let v = r * Math.sin(a) * 5.2
  for (let i = 1; i <= 5; i++) {
    const k = 0.9 * i
    const nu = u + (1.15 / i) * Math.sin(k * v + 1.3 * i + (i === 1 ? Math.sin(t) : i === 2 ? Math.cos(t) : 0) * 0.42)
    const nv = v + (1.15 / i) * Math.cos(k * u + 2.1 * i + (i === 1 ? Math.cos(t) : i === 3 ? Math.sin(t) : 0) * 0.42)
    u = nu
    v = nv
  }
  return 0.5 + 0.5 * Math.sin(1.25 * u + 0.75 * v + 0.6 * Math.sin(v * 0.7))
}

function swirl(name, t, low, mid, high) {
  const W = 384
  const H = 240
  const tones = [low, mid, high]
  const runs = ["", "", ""]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; ) {
      const tone = (xx) => {
        const m = paint(xx, y, t, W, H)
        return m < 0.34 ? 0 : m < 0.74 ? 1 : 2
      }
      const c = tone(x)
      let n = 1
      while (x + n < W && tone(x + n) === c) n++
      if (tones[c]) runs[c] += `M${x} ${y}h${n}v1h-${n}z`
      x += n
    }
  }
  write(
    name,
    svg(
      `0 0 ${W} ${H}`,
      tones.map((tone, i) => (tone ? `<path d="${runs[i]}" fill="${tone[0]}" fill-opacity="${tone[1]}"/>` : "")).join(""),
      ` width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges"`,
    ),
  )
}
// At night, on felt: the page's own green is the palest tone and the paint
// only darkens it. By day, on gold: the page's gold is the deepest and the
// paint only lightens it. Either way what is written on it reads at least as
// well over the paint as beside it.
"abc".split("").forEach((k, i) => {
  const t = (Math.PI * 2 * i) / 3
  swirl(`balatro-swirl-${k}.svg`, t, ["#000", 0.2], ["#000", 0.09], null)
  swirl(`balatro-swirl-day-${k}.svg`, t, null, ["#fff", 0.26], ["#fff", 0.5])
})
