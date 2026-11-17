import { writeSprite } from "./lib.mjs"

// ── 山山兔 ───────────────────────────────────────────────────────────────
// The plush rabbit of 明日方舟's merchandise brand, redrawn in pixels after
// the brand's own product photographs (kept out of the repo): it sits — a
// wide rounded head on a small body, two arms out at the sides, two round
// feet in front — with two ears standing up, peach inside, a tuft on top, a
// tuft at each cheek, and a deadpan face: two tall pale eyes with a lash at
// the top and a mouth like "ʌ". Each doll is the same rabbit dressed as an
// operator; five of them are here.
// Around it, what the photographs and the product cards show: the tent, the
// rug, the mushroom lamp, the clock and the books of the photo set; sparkles,
// clouds, tags and the orange tab of the cards.

// ── A canvas of squares ──────────────────────────────────────────────────
// Larger pictures are built from shapes; small ones are written as grids.
class Canvas {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.g = Array.from({ length: h }, () => Array(w).fill("."))
  }
  get(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? "." : this.g[y][x]
  }
  set(x, y, c) {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = c
    return this
  }
  // Every square whose centre `inside` says yes to (and `keep`, if given,
  // agrees to give up).
  fill(inside, c, keep) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (inside(x + 0.5, y + 0.5) && (!keep || keep(this.g[y][x], x, y))) this.g[y][x] = c
    return this
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
    return this
  }
  // An ellipse; `n` above 2 squares it off.
  oval(cx, cy, rx, ry, c, n = 2, keep) {
    return this.fill((x, y) => Math.abs((x - cx) / rx) ** n + Math.abs((y - cy) / ry) ** n <= 1, c, keep)
  }
  poly(points, c, keep) {
    return this.fill(
      (x, y) => {
        let inside = false
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i]
          const [xj, yj] = points[j]
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
        }
        return inside
      },
      c,
      keep,
    )
  }
  // A grid laid over this one: " " leaves what is there, "." empties it;
  // `map` renames its letters, `flip` mirrors it, `times` enlarges it.
  put(rows, ox, oy, map, flip = false, times = 1) {
    rows.forEach((row, y) => [...(flip ? [...row].reverse().join("") : row)].forEach((ch, x) => ch !== " " && this.rect(ox + x * times, oy + y * times, times, times, map?.[ch] ?? ch)))
    return this
  }
  // Every empty square that touches a filled one becomes `c`.
  outline(c) {
    const at = []
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.g[y][x] === "." && [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)].some((n) => n !== ".")) at.push([x, y])
    at.forEach(([x, y]) => (this.g[y][x] = c))
    return this
  }
  rows() {
    return this.g.map((row) => row.join(""))
  }
  save(name, palette) {
    writeSprite(name, this.rows(), palette)
    return this
  }
}

// A grid with its empty squares as spaces, to lay over a picture with `put`.
const over = (rows) => rows.map((row) => row.replaceAll(".", " "))

// ── The colours, sampled from the photographs ────────────────────────────
// O the line round it, d a seam within it; F fur, L where the light falls,
// D its shade; E inside the ear, e its fold; W the eye, K the black thread
// it is sewn with; H the black of the jacket; S the pale blue of the collar,
// s its shade; B the deeper blue of the lapels, b theirs; C the cream square
// on the jacket's back.
const BASE = { O: "#5a3418", d: "#8f5a36", F: "#d69a66", L: "#e9b98c", D: "#b97a4c", E: "#f4d0bb", e: "#e2ae97", W: "#d9e8ef", K: "#211a1c", H: "#2b2a31", S: "#c4e1f6", s: "#93bedf", B: "#9dcdee", b: "#6aa3d2", C: "#f1e6d2" }
const VERSIONS = {
  // 阿米娅: caramel, the blue collar and lapels of her jacket.
  amiya: { ...BASE },
  // 澄闪: pink, eyes screwed shut, a bow on one ear, a pink and navy jacket
  // (S, s) with yellow straps (h), a name tag.
  pink: { ...BASE, P: "#f08aa0", g: "#5a587a", O: "#6d3f52", d: "#b87f95", F: "#f3cdd6", L: "#fde6ea", D: "#dba6b8", E: "#fbe3d6", e: "#efc4b6", S: "#f18eab", s: "#3b4a8c", H: "#3a3852", h: "#f4e564", W: "#ffffff" },
  // 拉普兰德: grey, a grin of teeth, a black coat (its sheen g) with silver
  // studs (h), two bands round an ear.
  grey: { ...BASE, g: "#55555f", O: "#3c3c44", d: "#7d7e88", F: "#cfd0d4", L: "#ececef", D: "#a5a6ae", E: "#f0c8aa", e: "#d9a98a", h: "#d9dbe0", W: "#ffffff" },
  // 逻各斯: slate, narrow red eyes, a black cloak edged in blue (s), a gold
  // strap (h), a crown of black points.
  slate: { ...BASE, O: "#30323c", d: "#555a6b", F: "#8e94a6", L: "#aeb3c2", D: "#6f7486", E: "#f3d2a2", e: "#d9b07c", s: "#3f8fd0", h: "#e0a93a", W: "#ff8f9c" },
  // 魔王: dusty pink, pink eyes, a "w" for a mouth, the same crown, a white
  // dress (S, s) with a silver emblem (h).
  king: { ...BASE, O: "#5e4048", d: "#a47a80", F: "#e6c1c0", L: "#f5dcda", D: "#c99c9f", E: "#f7c9cf", e: "#e3a5ad", S: "#f4f1ea", s: "#cfc9bd", h: "#bfc4cc", W: "#f6b3c0" },
}
const VERSION_IDS = Object.keys(VERSIONS)

// ── The doll, sitting ────────────────────────────────────────────────────
// Measured off the photograph of the Amiya doll from the front, 46 squares
// by 63: ears a quarter of its height, the head two fifths and as wide as
// the whole, the collar under the chin, the lapels a "V" over a small belly,
// an arm at each side, the feet two lumps in front.
const isFur = (ch) => ch === "F" || ch === "L" || ch === "D"

// The eyes, by version: a grid and where its left one goes; the right one
// is the same grid (the lash leans the same way on both, as it is sewn)
// unless `mirror`.
const EYES = {
  // Tall and pale, sewn round in black, a lash off the top.
  tall: { rows: ["KK   ", " KKK ", " KWWK", " KWWK", " KWWK", " KWWK", " KWWK", " KWWK", " KWWK", "  KK "], x: 13, y: 22 },
  // Screwed shut: ">" and "<".
  shut: { rows: ["KK    ", "  KKK ", "KKKKKK", "  KKK ", "KK    "], x: 11, y: 26, mirror: true },
  // Wide and blank.
  wide: { rows: [" KKK ", "KWWWK", "KWWWK", "KWWWK", "KWWWK", "KWWWK", "KWWWK", "KWWWK", " KKK "], x: 12, y: 23, mirror: true },
  // Half shut: a heavy lid, red under it.
  lidded: { rows: ["KKKKKK", " KWWK ", " KWWK ", " KWWK ", " KWWK ", "  KK  "], x: 12, y: 26, mirror: true },
}
const MOUTHS = {
  // "ʌ"
  caret: { rows: [" KK ", "K  K"], y: 32 },
  // A small nose: "▽".
  nose: { rows: ["KKKK", "KPPK", " KK "], y: 31 },
  // A grin of teeth.
  grin: { rows: ["KKKKKKKKKK", "KWWKWWKWWK", "KWWKWWKWWK", " KKKKKKKK "], y: 32 },
  // "w"
  double: { rows: ["K  KK  K", " KK  KK "], y: 32 },
}
const LOOK = {
  amiya: { eyes: "tall", mouth: "caret" },
  pink: { eyes: "shut", mouth: "nose" },
  grey: { eyes: "wide", mouth: "grin" },
  slate: { eyes: "lidded", mouth: "caret" },
  king: { eyes: "tall", mouth: "double" },
}

function doll(version = "amiya") {
  const c = new Canvas(46, 63)
  const look = LOOK[version]
  const headAt = (x, y, grow = 0) =>
    Math.abs((x - 23) / (18.7 + grow)) ** 2.5 + Math.abs((y - 27.2) / (13 + grow)) ** 2.5 <= 1 ||
    // The jaw: wider than the brow.
    ((x - 23) / (19.4 + grow)) ** 2 + ((y - 32.4) / (7.6 + grow)) ** 2 <= 1

  // The jacket behind everything: the rim of its hood shows over the head
  // and down one side.
  if (version === "amiya") c.fill((x, y) => headAt(x, y - 0.2, 1.1) && (y < 26 || (x > 23 && y < 39)), "H")

  // Ears, leaning apart, wider above the middle than at the root.
  for (const side of [-1, 1]) {
    const cx = 23 + side * 7.4
    const ear = (x, y, rx, ry, cy) => ((x - cx - (cy - y) * side * 0.15) / (rx * (y < cy ? 1 : 0.84))) ** 2 + ((y - cy) / ry) ** 2 <= 1
    c.fill((x, y) => ear(x, y, 6.5, 9.4, 9.6), "F")
    c.fill((x, y) => ear(x + side * 0.2, y, 4.1, 7.1, 10.2), "E")
    c.fill((x, y) => ear(x + side * 0.2, y, 4.1, 7.1, 10.2) && side * (x - cx - (10.2 - y) * side * 0.15) < -1.7, "e")
    // Light along the top of each ear.
    c.fill((x, y) => ear(x, y, 6.5, 9.4, 9.6) && !ear(x, y - 1.2, 6.5, 9.4, 9.6) && y < 6, "L", (ch) => ch === "F")
  }

  // The body, an arm at each side, the two feet in front.
  c.oval(23, 49.6, 14.4, 11.6, "F", 2.4)
  for (const side of [-1, 1]) {
    const ax = 23 + side * 19
    const arm = (x, y, grow = 0) => ((x - ax) / (3.8 + grow)) ** 2 + ((y - 46.2) / (4.9 + grow)) ** 2 <= 1
    c.fill((x, y) => arm(x, y, 0.95) && !arm(x, y), "d", isFur)
    c.fill((x, y) => arm(x, y), "F")
    c.fill((x, y) => arm(x, y) && !arm(x, y + 1.6), "D")
    c.fill((x, y) => arm(x, y) && !arm(x, y - 1.2) && y < 44, "L")
  }
  for (const side of [-1, 1]) {
    const fx = 23 + side * 12.4
    const foot = (x, y, grow = 0) => Math.abs((x - fx) / (7 + grow)) ** 2.2 + Math.abs((y - 56.9) / (5.2 + grow)) ** 2.2 <= 1
    // The seam where a foot meets the belly: over its top and down its inner side.
    c.fill((x, y) => foot(x, y, 0.95) && !foot(x, y) && side * (x - 23) < 17, "d", isFur)
    c.fill((x, y) => foot(x, y), "F")
    c.fill((x, y) => foot(x, y) && !foot(x + side * 0.8, y - 1.3) && y < 56, "L")
    c.fill((x, y) => foot(x, y) && !foot(x, y + 1.4), "D")
  }
  // Shade under the belly.
  c.fill((x, y) => Math.abs(x - 23) < 5.5 && y > 59.6, "D", isFur)

  dress(c, version)

  // The head, wider than it is tall, squared off, with a seam under the chin.
  c.fill((x, y) => headAt(x, y, 0.95) && y > 32, "d", (ch) => ch !== ".")
  c.fill((x, y) => headAt(x, y), "F")
  // Light on the brow, shade under the jaw.
  c.fill((x, y) => headAt(x, y) && !headAt(x, y - 1.2) && y < 20 && Math.abs(x - 23) > 3, "L")
  c.fill((x, y) => headAt(x, y) && !headAt(x, y + 1.3) && y > 34, "D")
  // The tuft on top, over the hood's rim; a tuft at each cheek.
  c.put([" F  ", "FFL ", "FFFF"], 21, 11)
  c.set(22, 14, "D").set(23, 14, "D")
  for (const side of [-1, 1]) {
    const at = (dx, dy, ch) => c.set(side < 0 ? 4 - dx : 41 + dx, 34 + dy, ch)
    at(1, 1, "F"), at(1, 2, "F"), at(2, 2, "F"), at(1, 3, "D")
  }

  // The face.
  const eyes = EYES[look.eyes]
  c.put(eyes.rows, eyes.x, eyes.y)
  c.put(eyes.rows, 46 - eyes.x - eyes.rows[0].length - (eyes.mirror ? 0 : 1), eyes.y, null, eyes.mirror)
  const mouth = MOUTHS[look.mouth]
  c.put(mouth.rows, 23 - mouth.rows[0].length / 2, mouth.y)

  hat(c, version)
  return c.outline("O")
}

// What each one wears under its chin.
function dress(c, version) {
  const band = (from, to, top, deep, ch) => c.fill((x, y) => x >= from && x <= to && y >= top(x) && y < top(x) + deep, ch)
  const sag = (x) => 38.4 + 2.4 * (1 - ((x - 23) / 14) ** 2)
  const each = (draw) => [-1, 1].forEach((side) => draw((x) => 23 + side * x, side))
  if (version === "amiya") {
    // The collar: a band that sags in the middle, stitched across twice.
    band(9, 37, sag, 5.4, "S")
    band(9, 37, (x) => sag(x) + 4.4, 1, "s")
    c.rect(18, 40, 1, 6, "K").rect(27, 40, 1, 6, "K")
    // The lapels: two blue straps from the shoulders in to the belly, a "V",
    // the jacket's black along the outside of each and under its end.
    each((X) => {
      c.poly([[X(18.6), 41.6], [X(12.4), 38.8], [X(4.6), 51.2], [X(5.4), 53], [X(11.4), 55.6]], "H")
      c.poly([[X(17.4), 41.2], [X(13), 39.8], [X(6.6), 50.4], [X(10.6), 53]], "B")
      c.poly([[X(14.2), 40.2], [X(13), 39.8], [X(6.6), 50.4], [X(7.8), 51.2]], "b")
    })
  }
  if (version === "pink") {
    // An open jacket, pink with a navy edge, its sleeves over the arms; a
    // yellow strap hanging from each side; a choker with a ring; a name tag.
    each((X) => {
      c.fill((x, y) => ((x - X(19)) / 3.8) ** 2 + ((y - 46.2) / 4.9) ** 2 <= 1 && y < 49, "S", isFur)
      c.poly([[X(11.4), 52.6], [X(13.6), 53], [X(16.4), 61], [X(14.2), 61.4]], "h")
      c.poly([[X(20), 41.4], [X(10.4), 38.8], [X(6.4), 52], [X(17), 54.4]], "S")
      c.poly([[X(12), 39.2], [X(10.4), 38.8], [X(6.4), 52], [X(8), 52.4]], "s")
      c.poly([[X(17), 54.4], [X(6.4), 52], [X(6.9), 50.2], [X(17.5), 52.6]], "s")
    })
    band(12, 34, (x) => sag(x) + 1, 1, "K")
    c.rect(22, 42, 2, 2, "W").rect(27, 44, 8, 6, "H").rect(28, 46, 6, 3, "W").set(29, 47, "P").set(32, 47, "s")
  }
  if (version === "grey" || version === "slate") {
    // A short black cape from the neck, over the arms, open at the front.
    c.poly([[8, 39], [38, 39], [44, 53], [32, 57.4], [23, 51], [14, 57.4], [2, 53]], "H")
    if (version === "grey") {
      // Its sheen, two studs, a silver tab at each corner.
      c.poly([[10, 40], [12, 40], [22, 49.4], [20.6, 50.6]], "g")
      c.poly([[36, 40], [34, 40], [24, 49.4], [25.4, 50.6]], "g")
      c.rect(24, 44, 2, 2, "h").rect(28, 44, 2, 2, "h").rect(6, 51, 2, 3, "h").rect(38, 51, 2, 3, "h")
    } else {
      // Edged in blue, a gold strap across, a blue tab.
      c.poly([[2, 53], [14, 57.4], [14.6, 55.8], [2.6, 51.4]], "s")
      c.poly([[44, 53], [32, 57.4], [31.4, 55.8], [43.4, 51.4]], "s")
      c.poly([[14, 57.4], [23, 51], [32, 57.4], [31, 58.4], [23, 52.8], [15, 58.4]], "s")
      c.poly([[13, 39.4], [16, 39.4], [21.4, 59], [18.4, 59]], "h")
      c.rect(29, 43, 3, 6, "s")
    }
  }
  if (version === "king") {
    // A white dress with black lozenges, a choker, a silver emblem.
    c.poly([[11, 39], [35, 39], [41, 56.4], [5, 56.4]], "S")
    c.poly([[41, 56.4], [5, 56.4], [5.6, 54.6], [40.4, 54.6]], "s")
    band(12, 34, (x) => sag(x) + 1, 1, "K")
    c.put([" K ", "KKK", " K "], 14, 47).put([" K ", "KKK", " K "], 29, 49).put(["hh ", "hhh", " hh", " h "], 27, 42).rect(22, 44, 1, 9, "s")
  }
}

// What each one wears on its ears.
function hat(c, version) {
  const onEar = (ch) => "FLDEe".includes(ch)
  if (version === "pink") {
    // A dark bow with white marks, low on one ear.
    c.oval(35.4, 12.4, 5.2, 3.4, "H")
    c.oval(35.4, 12.4, 1.2, 2.2, "g")
    c.fill((x, y) => (Math.abs(x - 32.6) < 0.8 || Math.abs(x - 38.4) < 0.8) && Math.abs(y - 12.2) < 0.9, "W")
  }
  // Two black bands round one ear.
  if (version === "grey") c.fill((x, y) => x > 30 && ((y > 6.6 && y < 9) || (y > 10.2 && y < 12.6)), "H", onEar)
  // A black crown of points, at the root of one ear.
  if (version === "slate" || version === "king") c.poly([[29.6, 15.4], [31.4, 9.6], [33.6, 12.6], [36.6, 6.6], [37.6, 11.8], [42.4, 9.8], [40.2, 14.6], [42.6, 17.6], [35, 16.4]], "H")
}

// The Amiya doll is "the" rabbit; the others are named by their fur.
const dolls = Object.fromEntries(VERSION_IDS.map((id) => [id, doll(id)]))
for (const id of VERSION_IDS) dolls[id].save(id === "amiya" ? "bunny-sit.svg" : `bunny-sit-${id}.svg`, VERSIONS[id])

// ── The same doll at half the squares: 23 by 32 ──────────────────────────
// Redrawn rather than shrunk, so the face stays a face: the eyes three
// squares wide, the mouth three. On the composer, in a rule, on cards.
const HALF = [
  "....OOOO.......OOOO....",
  "...OLLLFO.....OFLLLO...",
  "...OFEEeFO...OFeEEFO...",
  "...OFEEeFO...OFeEEFO...",
  "...OFEEeFO...OFeEEFO...",
  "...OFEEeFO.O.OFeEEFO...",
  "....OFEeFOOFOOFeEFO....",
  "..OHHFFFFHFFFHFFFFHHO..",
  ".OHFFLLFFFFDFFFFLLFFHO.",
  "OHFFFFFFFFFFFFFFFFFFFHO",
  "OHFFFFFFFFFFFFFFFFFFFHO",
  ".OFFFKFFFFFFFKFFFFFFFHO",
  ".OFFFFKKFFFFFFKKFFFFFHO",
  ".OFFFFKWKFFFFFKWKFFFFHO",
  ".OFFFFKWKFFFFFKWKFFFFHO",
  ".OFFFFKWKFFFFFKWKFFFFHO",
  ".OFFFFFKFFFKFFFKFFFFFHO",
  "OFFFFFFFFFKFKFFFFFFFFFO",
  ".ODFFFFFFFFFFFFFFFFFDO.",
  "..ODDDFFFFFFFFFFFDDDO..",
  ".OHBBSdddddddddddSBBHO.",
  "OLFHBBSSKSSSSSKSSBBHFLO",
  "OFFHHBBsKsssssKsBBHHFFO",
  "OFFdHBBbFFFFFFFbBBHdFFO",
  "ODDdHHBBbFFFFFbBBHHdDDO",
  ".OOddHHBBFFFFFBBHHddOO.",
  "..OLLLLHHdFFFdHHLLLLO..",
  ".OLFFFFFFdFFFdFFFFFFLO.",
  ".OFFFFFFFdFFFdFFFFFFFO.",
  ".OFFFFFFDdFFFdDFFFFFFO.",
  ".ODDDDDDDODDDODDDDDDDO.",
  "..OOOOOOO.OOO.OOOOOOO..",
]
writeSprite("bunny-half.svg", HALF, VERSIONS.amiya)
// On its card in Settings.
writeSprite("bunny-mark.svg", HALF, VERSIONS.amiya)

// ── Small: 11 by 16 ──────────────────────────────────────────────────────
// The whole doll still — ears, face, collar, lapels, arms, feet — for a
// step's mark, the three at work, a row of them. Its face and its clothes
// by version; the hood's rim (H) only on the Amiya one.
const SMALL_TOP = ["..OO...OO..", ".OFEO.OEFO.", ".OFEO.OEFO.", ".OFEOOOEFO."]
const SMALL_FEET = [".OLFdFdFLO.", ".ODDOOODDO.", "..OO...OO.."]
const SMALL = {
  amiya: [".HFFFFFFFH.", "OFFFFFFFFFH", "OFKFFFFFKFH", "OFWFFFFFWFH", "OFWFFKFFWFH", "OFFFKFKFFFO", ".OSSSSSSSO.", "OFBFFFFFBFO", "OFHBFFFBHFO"],
  pink: [".OFFFFFFFO.", "OFFFFFFFFFO", "OFFFFFFFFFO", "OKKFFFFFKKO", "OFFFFPFFFFO", "OFFFFFFFFFO", ".OKKKKKKKO.", "OSSFFFFFSSO", "OSsFFhFFsSO"],
  grey: [".OFFFFFFFO.", "OFFFFFFFFFO", "OFKFFFFFKFO", "OFWFFFFFWFO", "OFWFFFFFWFO", "OFFKWKWKFFO", ".OHHHHHHHO.", "OHHgHhHgHHO", "OHHHgFgHHHO"],
}
const small = (version, top = SMALL_TOP) => [...top, ...SMALL[version], ...SMALL_FEET]
writeSprite("bunny-small.svg", small("amiya"), VERSIONS.amiya)
writeSprite("bunny-small-pink.svg", small("pink"), VERSIONS.pink)
writeSprite("bunny-small-grey.svg", small("grey"), VERSIONS.grey)

// Turned to the side, and from behind — the hood down its back, the cream
// square on the jacket, the tail — as the photographs show it; then a strip
// of four: front, side, back, the other side. A doll on a turntable.
const SIDE = [
  "...OO.OO...",
  "..OFFOFEO..",
  "..OFFOFEO..",
  "..OFFOFEO..",
  ".OHFFFFFO..",
  "OHFFFFFFFO.",
  "OHFFFFFFKO.",
  "OHFFFFFFWO.",
  "OHFFFFFFWO.",
  "OHFFFFFFFO.",
  ".OHSSSSSO..",
  ".OHHFFBFO..",
  "OFOHFFBFOO.",
  "OFOHFdFLFFO",
  ".OOODDDDDDO",
  "....OOOOOO.",
]
const BACK = [
  "..OO...OO..",
  ".OFFO.OFFO.",
  ".OFFO.OFFO.",
  ".OFFOOOFFO.",
  ".OFFFFFFFO.",
  "OFFFFFFFFFO",
  "OFFFFFFFFFO",
  "OFFFFFFFFFO",
  "OHHHHHHHHHO",
  "OHHHHHHHHHO",
  ".OHHHHHHHO.",
  "OFHCCCCCHFO",
  "OFHCHHHCHFO",
  ".OHCCCCCHO.",
  ".ODDOFODDO.",
  "..OO.O.OO..",
]
{
  const strip = new Canvas(44, 16)
  strip.put(over(small("amiya")), 0, 0).put(over(SIDE), 11, 0).put(over(BACK), 22, 0).put(over(SIDE), 33, 0, null, true)
  strip.save("bunny-turn.svg", VERSIONS.amiya)
}

// ── Its head alone: 9 by 9 ───────────────────────────────────────────────
// A list's dot, a session's state, a face in a row of faces.
const HEAD_EARS = [".OO...OO.", "OFEO.OEFO", "OFEO.OEFO", "OFEOOOEFO"]
const FACES = {
  // Tall eyes, "ʌ".
  plain: ["OFFFFFFFO", "OFKFFFKFO", "OFWFFFWFO", "OFFFKFFFO"],
  // Asleep.
  asleep: ["OFFFFFFFO", "OKKFFFKKO", "OFFFFFFFO", "OFFFKFFFO"],
  // ">" "<"
  shut: ["OFFFFFFFO", "OKFFFFFKO", "OFKFPFKFO", "OKFFFFFKO"],
  // A grin.
  grin: ["OFFFFFFFO", "OFWFFFWFO", "OFWFFFWFO", "OFKWKWKFO"],
  // Lidded.
  lidded: ["OFFFFFFFO", "OKKFFFKKO", "OFWFFFWFO", "OFFFKFFFO"],
  // "w"
  double: ["OFFFFFFFO", "OFKFFFKFO", "OFWFFFWFO", "OFKFKFKFO"],
}
const head = (face, ears = HEAD_EARS) => [...ears, ...FACES[face], ".OOOOOOO."]
writeSprite("bunny-head.svg", head("plain"), VERSIONS.amiya)
writeSprite("bunny-head-asleep.svg", head("asleep"), VERSIONS.amiya)
writeSprite("bunny-head-pink.svg", head("shut"), VERSIONS.pink)
writeSprite("bunny-head-grey.svg", head("grin"), VERSIONS.grey)
writeSprite("bunny-head-slate.svg", head("lidded"), VERSIONS.slate)
writeSprite("bunny-head-king.svg", head("double"), VERSIONS.king)
// It went wrong: ">" "<", and the colour gone out of it.
writeSprite("bunny-head-oops.svg", head("shut"), { ...VERSIONS.grey, P: "#d8454a", K: "#b2343a" })
// At work: one ear down, then up — two frames side by side.
{
  const strip = new Canvas(18, 9)
  strip.put(over(head("plain")), 0, 0).put(over(head("plain", ["......OO.", ".....OEFO", ".OO..OEFO", "OFEOOOEFO"])), 9, 0)
  strip.save("bunny-head-work.svg", VERSIONS.amiya)
}

// Its face on a button: send is the face itself, the "ʌ" pointing up; stop
// is the one with its eyes screwed shut; nothing to send, it dozes.
writeSprite("bunny-face.svg", ["K.......K", "W.......W", "W..KKK..W", "K.K...K.K"].map((r) => r), { K: "#211a1c", W: "#eef6fa" })
writeSprite("bunny-face-stop.svg", ["K.......K", ".K.....K.", "K..KKK..K", "........."], { K: "#211a1c" })
writeSprite("bunny-face-off.svg", [".........", "KK.....KK", "....K....", "...K.K..."], { K: "#211a1c" })

// ── The cards' own marks ─────────────────────────────────────────────────
// The four-pointed sparkle scattered over every product card.
const SPARKLE = ["....C....", "....C....", "...CCC...", "..CCCCC..", "CCCCCCCCC", "..CCCCC..", "...CCC...", "....C....", "....C...."]
const SPARK = ["..C..", "..C..", "CCCCC", "..C..", "..C.."]
writeSprite("bunny-sparkle.svg", SPARKLE, { C: "#ff8f8f" })
writeSprite("bunny-sparkle-white.svg", SPARKLE, { C: "#ffffff" })
writeSprite("bunny-sparkle-gold.svg", SPARKLE, { C: "#ffd166" })
writeSprite("bunny-sparkle-off.svg", SPARKLE, { C: "#bfae9f" })
// "◆", before a version's name.
writeSprite("bunny-diamond.svg", ["...C...", "..CCC..", ".CCCCC.", "CCCCCCC", ".CCCCC.", "..CCC..", "...C..."], { C: "#ff8f8f" })
// Down to the latest.
writeSprite("bunny-arrow.svg", ["OO.....OO", "OOO...OOO", ".OOO.OOO.", "..OOOOO..", "...OOO...", "....O...."], { O: "#5a3418" })
writeSprite("bunny-arrow-night.svg", ["OO.....OO", "OOO...OOO", ".OOO.OOO.", "..OOOOO..", "...OOO...", "....O...."], { O: "#f1e7da" })

// The round stamp in the corner of a card: a ring, a ring of dashes, and the
// rabbit's head in the middle of it. (The brand's has its name round the
// rim; this one has none.)
{
  const stamp = new Canvas(41, 41)
  const ring = (r0, r1, ch, dash) =>
    stamp.fill((x, y) => {
      const d = Math.hypot(x - 20.5, y - 20.5)
      return d >= r0 && d < r1 && (!dash || Math.floor(((Math.atan2(y - 20.5, x - 20.5) + Math.PI) / (2 * Math.PI)) * 28) % 2 === 0)
    }, ch)
  ring(18, 20.5, "M")
  ring(14.4, 15.6, "M", true)
  stamp.put(over(head("plain")).map((row) => row.replace(/[FLDEeWK]/g, "I").replaceAll("O", "M")), 11.5, 11, null, false, 2)
  stamp.put(over(SPARK), 3, 18, { C: "M" }).put(over(SPARK), 33, 18, { C: "M" })
  stamp.save("bunny-stamp.svg", { M: "#7fcfc7", I: "#ffffff" })
  stamp.save("bunny-stamp-night.svg", { M: "#3f6f6e", I: "#2c2523" })
}

// ── The photo set: lamp, clock, books ────────────────────────────────────
// M the lamp's cap, m its light, N its shade; T the wooden stem, t, U.
// P the clock's case, p its shade; c its face. Q, q a pink book; G, g a
// teal one; Y their pages. I plain white.
const PROPS = { O: "#5a3418", K: "#211a1c", I: "#ffffff", M: "#8a4030", m: "#b8644a", N: "#6a2c22", T: "#e8b27a", t: "#f6d2a2", U: "#c98d58", P: "#eba58d", p: "#d08670", c: "#fff4e2", Q: "#f2b8b6", q: "#d98f92", G: "#6fa7b0", g: "#4f8690", Y: "#fff4e2" }
const LAMP = [
  ".......OO.......",
  "......OMMO......",
  "....OOMMMMOO....",
  "...OMmMMMMMMO...",
  "..OMmmMMMMMMMO..",
  ".OMmMMMMMMMMMMO.",
  ".OMMMMMMMMMMMNO.",
  "OMMMMMMMMMMMMNNO",
  "OMMMMMMMMMMMNNNO",
  "ONNNNNNNNNNNNNNO",
  ".OOOOOOOOOOOOOO.",
  "....OTTTTTTO....",
  "....OtTTTTUO....",
  "....OtTTTTUO....",
  "....OtTTTTUO....",
  "....OtTTTTUO....",
  "....OtTTTTUO....",
  "....OtTTTTUO....",
  "...OtTTTTTTUO...",
  "...OTTTTTTUUO...",
  "...OUUUUUUUUO...",
  "....OOOOOOOO....",
]
const CLOCK = [
  "..OOOOOOOOOOOO..",
  ".OPPPPPPPPPPPPO.",
  "OPPOOOOOOOOOOPPO",
  "OPOccccccccccOPO",
  "OPOccccKcccccOPO",
  "OPOccccKcccccOPO",
  "OPOccccKcccccOPO",
  "OPOccccKKKKccOPO",
  "OPOccccccccccOPO",
  "OPOccccccccccOPO",
  "OPOccccccccccOPO",
  "OPPOOOOOOOOOOPPO",
  "OpPPPPPPPPPPPPpO",
  ".OppppppppppppO.",
  "..OOOOOOOOOOOO..",
  "..OO........OO..",
]
const BOOKS = [
  "...OOOOOOOOOOOO...",
  "..OQQQQQQQQQQQQO..",
  "..OqYYYYYYYYYYYO..",
  "..OQQQQQQQQQQQQO..",
  ".OOOOOOOOOOOOOOOO.",
  "OGGGGGGGGGGGGGGGGO",
  "OgYYYYYYYYYYYYYYYO",
  "OGGGGGGGGGGGGGGGGO",
  ".OOOOOOOOOOOOOOOO.",
]
writeSprite("bunny-lamp.svg", LAMP, PROPS)
writeSprite("bunny-clock.svg", CLOCK, PROPS)

// A rule across a reply: the rabbit sitting between sparkles and diamonds.
{
  const rule = new Canvas(111, 16)
  rule.put(over(small("amiya")), 50, 0)
  for (const side of [-1, 1]) {
    const X = (x, w) => (side < 0 ? 55 - x - w : 56 + x)
    rule.put(over(SPARKLE), X(12, 9), 4, { C: "c" }).put(over(SPARK), X(27, 5), 6, { C: "m" }).put(over(SPARKLE), X(38, 9), 4, { C: "c" })
    rule.rect(X(51, 4), 8, 4, 1, "m")
  }
  rule.save("bunny-rule.svg", { ...VERSIONS.amiya, c: "#ff8f8f", m: "#8ed5cf" })
}

// ── What a row of the sidebar opens: fifteen squares each ────────────────
{
  const icon = () => new Canvas(15, 15)
  // A new chat: the rabbit, and a sparkle.
  icon().put(over(head("plain")), 0, 6).put(over(SPARK), 9, 0, { C: "c" }).save("bunny-nav-new.svg", { ...VERSIONS.amiya, c: "#ff8f8f" })
  // Projects: the books.
  icon()
    .put(over(["..OOOOOOOOOOO..", ".OQQQQQQQQQQQO.", ".OqYYYYYYYYYYO.", ".OQQQQQQQQQQQO.", "OOOOOOOOOOOOOOO", "OGGGGGGGGGGGGGO", "OgYYYYYYYYYYYYO", "OGGGGGGGGGGGGGO", "OOOOOOOOOOOOOOO", ".OTTTTTTTTTTTO.", ".OtYYYYYYYYYYO.", ".OTTTTTTTTTTTO.", "..OOOOOOOOOOO.."]), 0, 1)
    .save("bunny-nav-books.svg", PROPS)
  // Employees: two of the dolls. (Each in its own colours: the second one's
  // letters are renamed.)
  {
    const rename = { O: "o", F: "f", L: "l", D: "x", E: "y", e: "z", W: "w", K: "k", P: "p" }
    const pal = { ...VERSIONS.grey }
    for (const [from, to] of Object.entries(rename)) pal[to] = VERSIONS.pink[from]
    icon().put(over(head("grin")), 6, 0).put(over(head("shut")), 0, 6, rename).save("bunny-nav-pair.svg", pal)
  }
  // Tasks: the clock.
  icon()
    .put(over([".OOOOOOOOOOO.", "OPPPPPPPPPPPO", "OPOOOOOOOOOPO", "OPOcccKcccOPO", "OPOcccKcccOPO", "OPOcccKcccOPO", "OPOcccKKKcOPO", "OPOcccccccOPO", "OPOcccccccOPO", "OPOOOOOOOOOPO", "OpPPPPPPPPPpO", ".OOOOOOOOOOO.", ".OO.......OO."]), 1, 1)
    .save("bunny-nav-clock.svg", PROPS)
  // Device sessions: the tent, a patch of sky through its door.
  icon()
    .put(over([".......O.......", "......OAO......", ".....OAAAO.....", ".....OAVAO.....", "....OAAVAAO....", "....OAVVVAO....", "...OAAVVVAAO...", "...OAVVVVVAO...", "..OAAVVVVVAAO..", "..OAVVVvVVVAO..", ".OAAVVvvvVVAAO.", ".OAVVVVVVVVVAO.", "OAAVVVVVVVVVAAO", "OOOOOOOOOOOOOOO"]), 0, 0)
    .save("bunny-nav-tent.svg", { O: "#5a3418", A: "#f6ecd6", V: "#8cc6ea", v: "#ffffff" })
}

// ── Clouds, stars, the string of lights ──────────────────────────────────
// The flat-bottomed clouds of the cards, to drift along the top of the sky.
{
  const sky = new Canvas(120, 34)
  const cloud = (x, y, s) => {
    sky.oval(x, y, 9 * s, 5 * s, "I").oval(x + 9 * s, y - 2 * s, 8 * s, 6 * s, "I").oval(x + 19 * s, y, 8 * s, 4.4 * s, "I")
    sky.fill((px, py) => py > y + 2.4 * s && py < y + 6 * s, ".", (ch) => ch === "I")
    sky.fill((px, py) => py > y + 1.2 * s && py <= y + 2.4 * s, "i", (ch) => ch === "I")
  }
  cloud(14, 22, 1.5)
  cloud(78, 10, 1)
  sky.save("bunny-clouds.svg", { I: "#ffffff", i: "#eaf6fd" })
  sky.save("bunny-clouds-night.svg", { I: "#2b3550", i: "#243049" })
}
// Night: a few stars.
{
  const night = new Canvas(64, 64)
  for (const [x, y, c] of [[5, 7, "a"], [22, 3, "b"], [40, 12, "a"], [57, 6, "b"], [12, 26, "b"], [31, 31, "a"], [50, 28, "b"], [3, 44, "a"], [24, 50, "b"], [44, 46, "a"], [60, 55, "b"], [15, 60, "a"]]) night.set(x, y, c)
  night.save("bunny-stars.svg", { a: "#c9c3a4", b: "#5d6d94" })
}
// The string of star lights along the tent: a wire that sags, a star hung
// every so often. Lit, and not.
{
  const STAR = [".X.", "XXX", ".X."]
  const wire = new Canvas(48, 12)
  for (let x = 0; x < 48; x++) wire.set(x, Math.round(1 + 3 * Math.sin((x / 48) * Math.PI) ** 2), "x")
  for (const x of [5, 21, 37]) wire.put(over(STAR), x, Math.round(3 + 3 * Math.sin(((x + 1) / 48) * Math.PI) ** 2))
  wire.save("bunny-lights.svg", { x: "#c9b79f", X: "#fff3d0" })
  wire.save("bunny-lights-lit.svg", { x: "#5b4a40", X: "#ffd166" })
}

// The rug's edge: white fluff, scalloped. A tile.
{
  const RUG = ["..RRRR....RRRR..", ".RRRRRR..RRRRRR.", "RRRRRRRRRRRRRRRR", "RRRRrRRRRRRRrRRR", "RRRRRRRRRRRRRRRR", "RrRRRRRRRrRRRRRR", "RRRRRRRRRRRRRRRR", "RRRRRRrRRRRRRRrR"]
  writeSprite("bunny-rug.svg", RUG, { R: "#ffffff", r: "#d3ebf8" })
  writeSprite("bunny-rug-night.svg", RUG, { R: "#39435c", r: "#2c354b" })
}

// ── The nook at the foot of the sidebar: lamp, clock, books on the rug ───
// (No rabbit here.) By night the lamp is lit.
function nook(night) {
  const c = new Canvas(130, 44)
  // The rug along the foot, its edge scalloped.
  for (let x = 0; x < 130; x += 8) c.oval(x + 4, 37.5, 4, 3, "R")
  c.rect(0, 37, 130, 7, "R")
  for (const [x, y] of [[4, 40], [12, 42], [22, 39], [33, 41], [47, 43], [58, 40], [70, 42], [84, 39], [97, 41], [109, 43], [121, 40]]) c.set(x, y, "r")
  // A corner of the yellow checked blanket, lying on it.
  c.poly([[72, 37], [126, 30], [130, 31], [130, 44], [80, 44]], "Z")
  c.fill((x, y) => (Math.floor((x + y) / 3) + Math.floor((x - y + 300) / 3)) % 2 === 0, "z", (ch) => ch === "Z")
  if (night) c.fill((x, y) => ((x - 14) / 22) ** 2 + ((y - 26) / 16) ** 2 <= 1 && Math.floor(x) % 2 === 0 && (Math.floor(y) + Math.floor(x) / 2) % 2 === 0, "*", (ch) => ch === ".")
  c.put(over(LAMP), 6, 16).put(over(CLOCK), 27, 22).put(over(BOOKS), 48, 29)
  return c
}
const NOOK = { ...PROPS, R: "#ffffff", r: "#d3ebf8", Z: "#fbe58a", z: "#fff7d6" }
nook(false).save("bunny-nook.svg", NOOK)
nook(true).save("bunny-nook-night.svg", { ...NOOK, O: "#17110f", R: "#39435c", r: "#2c354b", Z: "#8a7a3c", z: "#a39552", "*": "#5a5a52", T: "#ffe9a8", t: "#fff6d6", U: "#f6c56a", M: "#6f3326", m: "#94503b", N: "#54231b", P: "#b57e6c", p: "#99624f", c: "#d9cdb8", Q: "#b98a8c", q: "#9a6c70", G: "#4f7a82", g: "#3b6068", Y: "#d9cdb8" })

// ── The photo: the tent, its window, the rug — and a space for the doll ──
// Where no session is open. Drawn as the brand's photographs are set: the
// cream tent with a window of sky, a string of star lights, the rug, the
// checked blanket, the lamp, the clock, the books; an orange tab in the
// corner. The rabbit itself is laid over it by the stylesheet, so it can
// breathe. By night the window is dark and the lamp is lit.
function room(night) {
  const c = new Canvas(180, 112)
  // The tent's wall, a seam down it; the window, barred.
  c.rect(0, 0, 180, 112, "A")
  for (const x of [44, 136]) c.rect(x, 0, 1, 80, "a")
  c.poly([[0, 0], [180, 0], [180, 5], [0, 9]], "a")
  c.oval(90, 34, 34, 27, "O", 3)
  c.oval(90, 34, 32, 25, "V", 3)
  c.fill((x, y) => y > 38, "v", (ch) => ch === "V")
  if (night) {
    for (const [x, y] of [[66, 14], [78, 22], [101, 13], [112, 24], [70, 36], [96, 30], [116, 42], [84, 48], [106, 50]]) c.set(x, y, "X")
    c.put(over(SPARK), 104, 18, { C: "X" })
  } else {
    c.oval(74, 22, 8, 4, "I").oval(81, 19.6, 6, 4.6, "I").oval(89, 22.4, 6, 3.4, "I")
    c.oval(106, 40, 7, 3.4, "I").oval(112, 38, 5, 4, "I")
  }
  c.rect(89, 9, 2, 50, "A").rect(58, 33, 64, 2, "A")
  c.fill((x, y) => Math.abs((x - 90) / 34) ** 3 + Math.abs((y - 34) / 27) ** 3 > 1 && Math.abs((x - 90) / 36) ** 3 + Math.abs((y - 34) / 29) ** 3 <= 1, "a", (ch) => ch === "A")
  // The lights, strung across.
  for (let x = 0; x < 180; x++) c.set(x, Math.round(10 + 6 * Math.sin((x / 60) * Math.PI) ** 2), "x")
  for (const x of [12, 34, 54, 126, 146, 168]) c.put(over([".X.", "XXX", ".X."]), x - 1, Math.round(12 + 6 * Math.sin((x / 60) * Math.PI) ** 2))
  // The lamp's light on the wall, by night.
  if (night) c.fill((x, y) => ((x - 22) / 40) ** 2 + ((y - 56) / 36) ** 2 <= 1 && (Math.floor(x) + Math.floor(y)) % 2 === 0, "*", (ch) => ch === "A" || ch === "a")
  // The rug, scalloped, and the blanket on it.
  for (let x = 0; x < 180; x += 10) c.oval(x + 5, 84, 5.4, 4, "R")
  c.rect(0, 84, 180, 28, "R")
  for (let i = 0; i < 46; i++) c.set((i * 37 + 11) % 180, 87 + ((i * 13) % 22), "r")
  c.poly([[0, 92], [52, 86], [70, 98], [58, 112], [0, 112]], "Z")
  c.fill((x, y) => (Math.floor((x + y) / 4) + Math.floor((x - y + 400) / 4)) % 2 === 0, "z", (ch) => ch === "Z")
  // Lamp and clock to one side, books to the other.
  c.put(over(CLOCK), 34, 58, null, false, 2).put(over(LAMP), 6, 44, null, false, 2).put(over(BOOKS), 132, 76, null, false, 2)
  // Where the doll sits: its shadow on the rug.
  c.oval(90, 101, 24, 3.4, "r")
  // The orange tab in the corner of every photograph, and the strip along
  // the foot.
  c.rect(0, 108, 180, 4, "J")
  c.fill((x, y) => y >= 109 && y < 111 && Math.floor(x / 3) % 2 === 0 && x > 60, "j")
  c.poly([[0, 98], [40, 98], [46, 104], [40, 110], [0, 110]], "J")
  for (const x of [5, 11, 17]) c.put(over(["I..", ".I.", "..I", ".I.", "I.."]), x, 102)
  c.rect(25, 103, 12, 1, "I").rect(25, 105, 8, 1, "I")
  return c
}
const ROOM = { ...PROPS, ...NOOK, A: "#f6ecd6", a: "#e6d7b8", V: "#8cc6ea", v: "#b9def4", x: "#b9a78d", X: "#fff3d0", J: "#f0934c", j: "#ffc58f" }
room(false).save("bunny-room.svg", ROOM)
room(true).save("bunny-room-night.svg", { ...ROOM, O: "#17110f", A: "#4a3d3a", a: "#3d312f", V: "#1b2440", v: "#232e50", x: "#2c2321", X: "#ffd166", "*": "#7a6040", R: "#39435c", r: "#2c354b", Z: "#8a7a3c", z: "#a39552", T: "#ffe9a8", t: "#fff6d6", U: "#f6c56a", M: "#6f3326", m: "#94503b", N: "#54231b", P: "#b57e6c", p: "#99624f", c: "#d9cdb8", Q: "#b98a8c", q: "#9a6c70", G: "#4f7a82", g: "#3b6068", Y: "#d9cdb8", J: "#c9703a", j: "#e59a62", I: "#f1e7da" })

// ── Frames: soft corners in squares ──────────────────────────────────────
// Nine-slice pictures for `border-image`: a line round a fill, the corners
// stepped round (`r` squares), optionally a row or two of shade inside the
// foot (a thing with some thickness to it), and optionally a line of
// stitches inside the edge (the collar's).
function frame(name, { r = 3, line, fill, shade, rows = 1, lit, stitch }) {
  const inset = r === 2 ? [1, 0] : r === 3 ? [2, 1, 0] : [3, 2, 1, 0, 0]
  const slice = inset.length + (stitch ? 2 : 0)
  const n = slice * 2 + 3
  const off = (i) => inset[Math.min(i, n - 1 - i)] ?? 0
  const inside = (x, y) => x >= 0 && y >= 0 && x < n && y < n && x >= off(y) && x < n - off(y) && y >= off(x) && y < n - off(x)
  const c = new Canvas(n, n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      c.set(x, y, edge ? "O" : shade && y >= n - 1 - rows ? "D" : lit && y === 1 ? "L" : "F")
    }
  if (stitch) {
    // Two squares in from the line; a dash of two, a gap of one, along
    // each side (the middle three squares are what repeats).
    const q = 2
    for (let i = slice; i < slice + 2; i++) c.set(i, q, "S").set(i, n - 1 - q, "S").set(q, i, "S").set(n - 1 - q, i, "S")
    for (const [x, y] of [[q + 1, q + 1], [n - 2 - q, q + 1], [q + 1, n - 2 - q], [n - 2 - q, n - 2 - q]]) c.set(x, y, "S")
  }
  c.save(name, { O: line, F: fill, D: shade, L: lit, S: stitch })
  return slice
}
const LINE = "#5a3418"
const NIGHT = "#130e0d"
// Cards.
frame("bunny-f-card.svg", { line: LINE, fill: "#ffffff", shade: "#f3e2d0" })
frame("bunny-f-card-night.svg", { line: NIGHT, fill: "#322925", shade: "#28201d" })
// Cream ones: a step, a turn's tag.
frame("bunny-f-cream.svg", { line: LINE, fill: "#fff3e3", shade: "#f1d9bd" })
frame("bunny-f-cream-night.svg", { line: NIGHT, fill: "#3a2f2a", shade: "#2c2420" })
// Menus and dialogs: rounder.
frame("bunny-f-pop.svg", { r: 4, line: LINE, fill: "#fffdf9", shade: "#f3e2d0" })
frame("bunny-f-pop-night.svg", { r: 4, line: NIGHT, fill: "#342b27", shade: "#28201d" })
// The page itself.
frame("bunny-f-page.svg", { r: 4, line: LINE, fill: "#fffaf4" })
frame("bunny-f-page-night.svg", { r: 4, line: NIGHT, fill: "#251e1c" })
// What you say: the collar — pale blue, stitched.
frame("bunny-f-scarf.svg", { line: "#5f93be", fill: "#cfe6f7", shade: "#a9cfea", stitch: "#7fb0d6" })
frame("bunny-f-scarf-night.svg", { line: "#0f1c28", fill: "#2c4a61", shade: "#223b4f", stitch: "#4d7696" })
// Buttons: plush — white, fur, blue; and pressed, the shade gone.
frame("bunny-f-btn.svg", { line: LINE, fill: "#ffffff", shade: "#ecd3ba", rows: 2 })
frame("bunny-f-btn-night.svg", { line: NIGHT, fill: "#4a3c35", shade: "#352a25", rows: 2, lit: "#5c4c43" })
frame("bunny-f-fur.svg", { line: LINE, fill: "#e2a672", shade: "#b97a4c", rows: 2, lit: "#f0c49b" })
frame("bunny-f-fur-night.svg", { line: NIGHT, fill: "#d69a66", shade: "#a66c40", rows: 2, lit: "#e9b98c" })
frame("bunny-f-pink.svg", { line: "#6d3f52", fill: "#f6c3cd", shade: "#dba0b2", rows: 2, lit: "#fde6ea" })
frame("bunny-f-blue.svg", { line: "#3f6f97", fill: "#c4e1f6", shade: "#93bedf", rows: 2, lit: "#e4f2fb" })
frame("bunny-f-blue-night.svg", { line: NIGHT, fill: "#35576f", shade: "#274558", rows: 2, lit: "#44698a" })
// A field to type in: set in, the shade along its top.
frame("bunny-f-field.svg", { r: 2, line: LINE, fill: "#ffffff", lit: "#f3e2d0" })
frame("bunny-f-field-night.svg", { r: 2, line: NIGHT, fill: "#1d1716", lit: "#161110" })
// A small tag.
frame("bunny-f-tag.svg", { r: 2, line: LINE, fill: "#fff3e3" })
frame("bunny-f-tag-night.svg", { r: 2, line: NIGHT, fill: "#3a2f2a" })
// The orange tab of a photograph: a toast.
frame("bunny-f-tab.svg", { r: 2, line: "#8a4a1c", fill: "#f0934c", shade: "#d87a36" })
