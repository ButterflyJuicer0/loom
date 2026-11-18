import { writeSprite } from "./lib.mjs"

// ── 山山兔 ───────────────────────────────────────────────────────────────
// The plush rabbit of 明日方舟's merchandise brand, redrawn in pixels after
// the brand's own product photographs (kept out of the repo): it sits — a
// wide rounded head on a small body, two arms out at the sides, two round
// feet in front — with two ears standing up, peach inside, a tuft on top, a
// tuft at each cheek, and a deadpan face: two tall pale eyes with a lash at
// the top and a mouth like "ʌ". Each doll is the same rabbit dressed as an
// operator; five of them are here.
// Around it, 明日方舟's own: 龙泡泡, the dragon bun of the same plush line
// (and the buns in their bamboo steamers), drawn after the brand's
// photographs too; and the game's things, redrawn small after its pictures
// of them — 合成玉, 至纯源石, 龙门币, 作战记录, 技巧概要, 招聘许可, 寻访凭证,
// 理智 and its 顶液, a chip, 家具零件, a drone — with the grid, the warning
// stripes and the corner marks its screens are drawn with.

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
// step's mark, the ones at work, a rule. Its face and its clothes
// by version; the hood's rim (H) only on the Amiya one.
const SMALL_TOP = ["..OO...OO..", ".OFEO.OEFO.", ".OFEO.OEFO.", ".OFEOOOEFO."]
const SMALL_FEET = [".OLFdFdFLO.", ".ODDOOODDO.", "..OO...OO.."]
const SMALL = {
  amiya: [".HFFFFFFFH.", "OFFFFFFFFFH", "OFKFFFFFKFH", "OFWFFFFFWFH", "OFWFFKFFWFH", "OFFFKFKFFFO", ".OSSSSSSSO.", "OFBFFFFFBFO", "OFHBFFFBHFO"],
  grey: [".OFFFFFFFO.", "OFFFFFFFFFO", "OFKFFFFFKFO", "OFWFFFFFWFO", "OFWFFFFFWFO", "OFFKWKWKFFO", ".OHHHHHHHO.", "OHHgHhHgHHO", "OHHHgFgHHHO"],
}
const small = (version, top = SMALL_TOP) => [...top, ...SMALL[version], ...SMALL_FEET]
writeSprite("bunny-small.svg", small("amiya"), VERSIONS.amiya)
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

// ── 龙泡泡 ───────────────────────────────────────────────────────────────
// The rabbit's sibling in the same plush line: a round bun of a dragon,
// drawn after the brand's photographs of the 黍 doll — white, wider than it
// is tall, two forked horns (yellow, going to indigo at the tips), yellow
// spikes down its back, an indigo tail, four yellow stubs of feet; its face
// low on the bun: two big square eyes under heavy lids, sage green, a grey
// dab of a brow over each, a mouth like "ω"; an orange tag hanging from one
// horn. 50 squares by 44.
// O its line, F the plush, L its light, D its shade; Y yellow, y its shade;
// B indigo, b its light; E the eye, e its lower half; K black thread; G the
// brows; T the tag, t its clip.
const LPP = { O: "#6a5f5a", F: "#f6f2ec", L: "#ffffff", D: "#dcd3ca", Y: "#f4cb38", y: "#d9a520", B: "#3b4391", b: "#6c74c4", E: "#bcd8c6", e: "#a5c9b3", K: "#211a1c", G: "#b5b9c4", T: "#f0641e", t: "#cfd3d8" }
function bun() {
  const c = new Canvas(50, 44)
  const body = (x, y, grow = 0) => Math.abs((x - 24.5) / (20.6 + grow)) ** 2.4 + Math.abs((y - 26.6) / (16 + grow)) ** 2.4 <= 1
  // The tail, behind; then the feet, the horns, the spikes; then the body.
  c.poly([[40, 20], [49, 8], [48, 20], [50, 27], [42, 28]], "B")
  c.poly([[44, 14], [49, 8], [48, 14]], "b")
  for (const x of [11, 37.5]) {
    c.oval(x, 41, 4.2, 2.6, "Y")
    c.fill((px, py) => ((px - x) / 4.2) ** 2 + ((py - 41) / 2.6) ** 2 <= 1 && py > 41.6, "y")
  }
  for (const side of [-1, 1]) {
    const X = (x) => 24.5 + side * x
    // A horn: a long prong up and out, a short one to the side.
    c.poly([[X(8), 18], [X(14.6), 12], [X(21.6), 0], [X(21), 16], [X(15), 23]], "Y")
    c.poly([[X(15), 22], [X(19), 13.4], [X(25), 11], [X(22), 21]], "Y")
    c.poly([[X(17.6), 7], [X(21.6), 0], [X(21.3), 8.4]], "B")
    c.poly([[X(16.2), 9.4], [X(17.6), 7], [X(21.3), 8.4], [X(21.2), 10.6]], "b")
    c.poly([[X(22.4), 12.2], [X(25), 11], [X(23.8), 14.6]], "B")
  }
  for (const [x, h] of [[19.5, 7], [25.5, 9], [31, 6]]) c.poly([[x - 3.2, 12.6], [x + 0.4, 12 - h], [x + 3.4, 12.6]], "Y")
  c.fill((x, y) => body(x, y), "F")
  c.fill((x, y) => body(x, y) && !body(x, y - 1.3) && y < 20, "L")
  c.fill((x, y) => body(x, y) && !body(x, y + 1.6), "D")
  c.fill((x, y) => body(x, y) && !body(x + 1.4, y + 0.6) && x > 36 && y > 22, "D")
  // The face: a brow, a lid wider than the eye, the eye square above and
  // round below.
  for (const x of [8, 25]) {
    c.rect(x + 3, 22, 3, 1, "G")
    c.rect(x - 1, 25, 11, 1, "K")
    c.put(["KEEEEEEEK", "KEEEEEEEK", "KEEEEEEEK", "KEEEEEEEK", "KeeeeeeeK", "KeeeeeeeK", "KeeeeeeeK", " KeeeeeK ", "  KKKKK  "], x, 26)
  }
  c.put(["K K K", " K K "], 19, 33)
  // The tag, clipped to a horn and hanging over the corner of an eye.
  c.rect(36, 16, 4, 2, "t").rect(36, 18, 4, 16, "T")
  return c.outline("O")
}
bun().save("bunny-lpp.svg", LPP)

// The same small (15 by 13): beside the rabbit at that size.
const BUN_SMALL = [
  ".O...........O.",
  "OBO...O.O...OBO",
  "OYO..OYOYO..OYO",
  ".OYOOOYOYOOOYO.",
  "OOYOLLLLLLLOYOB",
  "OYOFFFFFFFFFOTB",
  ".OFFFFFFFFFFFTO",
  "OFKKKFFFKKKFFTO",
  "OFKEKFKFKEKFFTO",
  "OFFKFFFFFKFFFFO",
  "OFFFFFFFFFFFFDO",
  ".OYYDDDDDDDYYO.",
  "..OO.OOOOO.OO..",
]
writeSprite("bunny-lpp-small.svg", BUN_SMALL, LPP)
// Its face alone, nine squares: a mark beside the rabbit's.
const BUN_HEAD = ["B.......B", "YO.O.O.OY", "OYOYOYOYO", "OFFFFFFFO", "OKKFFFKKO", "OEEFFFEEO", "OFFKFKFFO", "OFFFFFFFO", ".OOOOOOO."]
writeSprite("bunny-lpp-head.svg", BUN_HEAD, LPP)

// ── Its siblings ─────────────────────────────────────────────────────────
// The other dragons of the line, each drawn after the brand's photographs:
// 年 (cream, red horns, eyes shut in a smile, mouth open), 夕 (dark grey,
// teal horns, orange eyes under black lids, a frown, a drop of sweat), 令
// (white going to lilac, blue horns, half-lidded purple eyes, a ":3" and a
// tongue), 重岳 (charcoal, cream-yellow horns, slanted red eyes rimmed in
// green, a flat little mouth), 望 (pale grey, grey horns, mustard spikes
// down its back, eyes rimmed in gold under flat lids, a "^" for a mouth, a
// string of black and white beads with a tassel). The photographs of the
// first four are of the small round pendants; the body here is the bun the
// 黍 and 望 dolls have. The letters are 黍's, and: f the feet, u their
// shade; s a spike; R the rim of an eye; M inside a mouth; W white.
const K = "#211a1c"
const SIBLINGS = {
  nian: { O: "#8a5a52", F: "#f7e4d8", L: "#fff4ec", D: "#e6c9ba", Y: "#e2262d", y: "#b3161d", B: "#e2262d", b: "#e2262d", f: "#e2262d", u: "#b3161d", s: "#e2262d", G: "#e2262d", M: "#ef6b7c", K },
  xi: { O: "#2a2b30", F: "#5d5f68", L: "#72747e", D: "#484a52", Y: "#226876", y: "#17505c", B: "#226876", b: "#2f8696", f: "#226876", u: "#17505c", s: "#226876", G: "#35a6b6", E: "#f59a2a", e: "#ee7f12", W: "#e8eef4", K },
  ling: { O: "#6d6a80", F: "#edebf5", L: "#ffffff", D: "#d2cfe2", Y: "#5b84d8", y: "#3f66b8", B: "#5b84d8", b: "#86a8ec", f: "#5b84d8", u: "#3f66b8", s: "#5b84d8", G: "#5b84d8", E: "#b692e4", e: "#9b76cf", M: "#f0641e", K },
  chongyue: { O: "#2e2f31", F: "#6c6e70", L: "#808284", D: "#57595b", Y: "#f0da8c", y: "#d6bb62", B: "#f0da8c", b: "#f0da8c", f: "#efe6d2", u: "#d3c7ad", s: "#4a4b4d", G: "#efe0b8", E: "#dc4a40", e: "#c2372f", R: "#1f7a5c", K },
  wang: { O: "#6a6460", F: "#eae7e2", L: "#faf8f5", D: "#cfcac3", Y: "#7e7c7d", y: "#5f5d5e", B: "#7e7c7d", b: "#9b999a", f: "#f3ddd2", u: "#dcc0b3", s: "#e2a32c", G: "#85858c", E: "#f3ecdf", e: "#e9dfcd", R: "#c9a23a", W: "#ffffff", K },
}
// Each one's face, on the full-sized doll; `mirror` lays a grid on the
// other side too.
const SIB_FACE = {
  nian(c, mirror) {
    c.rect(20, 21, 2, 2, "G").rect(28, 21, 2, 2, "G")
    mirror(["..KKKKK..", ".K.....K.", "K.......K", "K.......K"], 9, 26)
    c.put(["KK...KK", ".KKKKK.", ".KMMMK.", ".KMMMK.", "..KMK..", "...K..."], 21, 30)
  },
  xi(c, mirror) {
    mirror(["GG..", ".GGG"], 15, 21)
    c.rect(8, 20, 1, 3, "W").set(9, 21, "W").rect(23, 22, 4, 1, "K").rect(23, 24, 4, 1, "K")
    mirror(["KK.........", "KKKKK......", "KEEKKKKK...", "KEEEEEKKKK.", "KEEEEEEEEK.", "KeeeeeeeeK.", "KeeeeeeeeK.", ".KeeeeeeK..", "..KKKKKK..."], 8, 25)
    c.put([".KKK.", "K...K"], 22, 36)
  },
  ling(c, mirror) {
    mirror(["GGG"], 18, 21)
    mirror(["KKKKKKKKKKK", "...KEEEEEEK", "...KEEEEEEK", "...KEEEEEEK", "...KeeeeeeK", "...KeeeeeeK", "....KeeeeK.", ".....KKKK.."], 7, 25)
    c.put(["K..K..K", ".KKMKK.", "..KMK..", "...K..."], 21, 32)
  },
  chongyue(c, mirror) {
    mirror(["G.", "GG", ".G"], 18, 21)
    mirror(["KK.........", "KKKKK......", ".RKKKKKK...", ".REEEEKKKK.", ".REEEEEEER.", ".ReeeeeeeR.", "..ReeeeeR..", "...RRRRR..."], 8, 25)
    c.put(["KKKKK"], 22, 35)
  },
  wang(c, mirror) {
    mirror(["GGG", "GGG"], 15, 20)
    mirror(["KKKKKKKKKK", "KKKKKKKKKK", ".REEEEEER.", ".REEEEEER.", ".REEEEEER.", ".REEEEEER.", ".ReeeeeeR.", ".ReeeeeeR.", "..ReeeeR..", "...RRRR..."], 9, 23)
    c.put([".KK.", "K..K"], 23, 35)
    // The beads, off a horn; the tassel under them.
    for (const [i, ch] of [..."KKWKKWK"].entries()) c.rect(35 + i, 13 + i, 2, 2, ch)
    for (const x of [42, 44, 46]) c.rect(x, 21, 1, 12 - (x - 42), "G")
  },
}
function sibling(kind) {
  const c = new Canvas(50, 44)
  const body = (x, y) => Math.abs((x - 24.5) / 20.6) ** 2.4 + Math.abs((y - 26.6) / 16) ** 2.4 <= 1
  // 望's tail shows behind it, as 黍's does.
  if (kind === "wang") c.poly([[40, 20], [49, 10], [48, 20], [50, 27], [42, 28]], "Y")
  for (const x of [11, 37.5]) {
    c.oval(x, 41, 4.2, 2.6, "f")
    c.fill((px, py) => ((px - x) / 4.2) ** 2 + ((py - 41) / 2.6) ** 2 <= 1 && py > 41.6, "u")
  }
  for (const side of [-1, 1]) {
    const X = (x) => 24.5 + side * x
    c.poly([[X(8), 18], [X(14.6), 12], [X(21.6), 0], [X(21), 16], [X(15), 23]], "Y")
    c.poly([[X(15), 22], [X(19), 13.4], [X(25), 11], [X(22), 21]], "Y")
    c.poly([[X(17.6), 7], [X(21.6), 0], [X(21.3), 8.4]], "B")
    c.poly([[X(16.2), 9.4], [X(17.6), 7], [X(21.3), 8.4], [X(21.2), 10.6]], "b")
    c.poly([[X(22.4), 12.2], [X(25), 11], [X(23.8), 14.6]], "B")
    // The under side of each horn, in shade.
    c.fill((x, y) => side * (x - 24.5) > 14 && y > 16 && y < 23, "y", (ch) => ch === "Y")
  }
  // Spikes down the back for 望; one thin one on top for the rest.
  if (kind === "wang") for (const [x, h] of [[18.5, 8], [25.5, 10], [32, 7]]) c.poly([[x - 3.6, 12.6], [x + 0.4, 12 - h], [x + 3.8, 12.6]], "s")
  else c.rect(24, 4, 2, 8, "s")
  c.fill((x, y) => body(x, y), "F")
  c.fill((x, y) => body(x, y) && !body(x, y - 1.3) && y < 20, "L")
  c.fill((x, y) => body(x, y) && !body(x, y + 1.6), "D")
  c.fill((x, y) => body(x, y) && !body(x + 1.4, y + 0.6) && x > 36 && y > 22, "D")
  const mirror = (rows, x, y) => c.put(over(rows), x, y).put(over(rows), 50 - x - rows[0].length, y, null, true)
  SIB_FACE[kind](c, mirror)
  return c.outline("O")
}
// Small (15 by 13) and as a face (9 by 9), as 黍 has: the same outline,
// each one's own three rows of face.
const SIB_SMALL = {
  nian: ["FFFFGFGFFFF", "FKKKFFFKKKF", "KFFFKMKFFFK", "FFFFFMFFFFF"],
  xi: ["FFFGFFFGFFF", "KKKKFFFKKKK", "FKEEFFFEEKF", "FFFFKKKFFFF"],
  ling: ["FFFGFFFGFFF", "KKKKFFFKKKK", "FFEEKFKEEFF", "FFFFFMFFFFF"],
  chongyue: ["FFFGFFFGFFF", "KKKFFFFFKKK", "FEEKFFFKEEF", "FFFFKKKFFFF"],
  wang: ["FFGGFFFGGFF", "FKKKFFFKKKF", "FRERFFFRERF", "FFRFFKFFRFF"],
}
const sibSmall = (kind) => [
  ".O...........O.",
  kind === "wang" ? "OBO...O.O...OBO" : "OBO....O....OBO",
  kind === "wang" ? "OYO..OsOsO..OYO" : "OYO...OsO...OYO",
  kind === "wang" ? ".OYOOOsOsOOOYO." : ".OYOOOOsOOOOYO.",
  "OOYOLLLLLLLOYOO",
  "OYOFFFFFFFFFOYO",
  ".O" + SIB_SMALL[kind][0] + "O.",
  ...SIB_SMALL[kind].slice(1).map((row) => "OF" + row + "FO"),
  "OFFFFFFFFFFFFDO",
  ".OffDDDDDDDffO.",
  "..OO.OOOOO.OO..",
]
const SIB_HEAD = {
  nian: ["KKFFFKK", "FFFMFFF", "FFFFFFF"],
  xi: ["KKFFFKK", "EEFFFEE", "FFKKKFF"],
  ling: ["KKFFFKK", "EEFKFEE", "FFFMFFF"],
  chongyue: ["KKFFFKK", "EEFFFEE", "FFFKFFF"],
  wang: ["KKFFFKK", "RRFFFRR", "FFKFKFF"],
}
const sibHead = (kind) => ["Y.......Y", kind === "wang" ? "YOs.s.sOY" : "YO..s..OY", kind === "wang" ? "OYOOsOOYO" : "OYOOsOOYO", "OFFFFFFFO", ...SIB_HEAD[kind].map((row) => "O" + row + "O"), "OFFFFFFFO", ".OOOOOOO."]
for (const kind of Object.keys(SIBLINGS)) {
  sibling(kind).save(`bunny-lpp-${kind}.svg`, SIBLINGS[kind])
  writeSprite(`bunny-lpp-${kind}-head.svg`, sibHead(kind), SIBLINGS[kind])
}

// Several pictures on one sheet, each in its own colours: every letter of
// each is given a name of its own.
function sheet(w, h) {
  const c = new Canvas(w, h)
  const pal = {}
  const names = {}
  let next = 0x3b1
  const place = (rows, colours, x, y) => {
    const rename = {}
    for (const ch of new Set(rows.join(""))) {
      if (ch === "." || ch === " " || !colours[ch]) continue
      rename[ch] = names[colours[ch]] ??= String.fromCharCode(next++)
      pal[rename[ch]] = colours[ch]
    }
    c.put(over(rows), x, y, rename)
    return api
  }
  const api = { c, pal, place, save: (name) => c.save(name, pal) }
  return api
}
// The six of them small, side by side: a strip the stylesheet shows one at
// a time, so the bun among the ones at work is a different sibling each hop.
{
  const strip = sheet(90, 13)
  strip.place(BUN_SMALL, LPP, 0, 0)
  Object.keys(SIBLINGS).forEach((kind, i) => strip.place(sibSmall(kind), SIBLINGS[kind], 15 * (i + 1), 0))
  strip.save("bunny-lpp-troupe.svg")
  // And three of them in a row, for a page's foot.
  sheet(49, 13).place(sibSmall("nian"), SIBLINGS.nian, 0, 0).place(sibSmall("xi"), SIBLINGS.xi, 17, 0).place(sibSmall("ling"), SIBLINGS.ling, 34, 0).save("bunny-lpp-three.svg")
}

// 小笼泡: the same dragons as soup buns in a bamboo steamer — cream, a knot
// of pleats on top, a face let into the front, antlers. Two of them, after
// the photographs: one dark-faced with gold antlers, an orange eye and a
// wink; one pale-faced with grey antlers and a gold eye under a heavy lid.
// O line, C cream, c its light, d its shade; m the face; a the antlers.
const BAO = [
  "......OOOOOO......",
  ".a..aOccccccOa..a.",
  ".aa.aOCCCCCCOa.aa.",
  "..aaaOOCCCCOOaaa..",
  "..OaOcccccccccOaO.",
  ".OccCCCCCCCCCCCCO.",
  ".OCCCmmmmmmmmCCCO.",
  "OCCCmmmmmmmmmmCCCO",
  "OCCmmKKKmmmmmmmCCO",
  "OCCmmEEEmmKKKmmCCO",
  "OCCmmmEmmmmmmmmCCO",
  "OCCCmmmmKmKmmmCCCO",
  "OdCCCmmmmmmmmCCCdO",
  ".OddCCCCCCCCCCddO.",
]
// The seven of them, as the photograph of them all in one steamer shows:
// each a face let into the cream, antlers in its own colour. (余 is the one
// no doll was found for; it is known here only by being the seventh.)
const BAO_BASE = { O: "#7a5a3a", C: "#f8edc9", c: "#fffbe6", d: "#e3d0a2", K: "#211a1c" }
const BAOS = {
  chongyue: { ...BAO_BASE, m: "#5d5856", a: "#d7b055", E: "#f0641e" },
  wang: { ...BAO_BASE, m: "#cdc8c9", a: "#8b888c", E: "#e2b23c" },
  nian: { ...BAO_BASE, m: "#f7f1ea", a: "#e2262d", E: "#b692e4", both: true },
  xi: { ...BAO_BASE, m: "#2f3035", a: "#226876", E: "#f08a1c", both: true },
  ling: { ...BAO_BASE, m: "#d3e3f4", a: "#5b84d8", E: "#b692e4", both: true },
  shu: { ...BAO_BASE, m: "#fbf8f2", a: "#f4cb38", E: "#a5c9b3", both: true },
  yu: { ...BAO_BASE, m: "#27304f", a: "#2b2a31", E: "#7fd6cf" },
}
const BAO_GOLD = BAOS.chongyue
// Both eyes open, where the photograph has them so: the wink becomes a lid
// and an eye under it.
const bao = (kind) => (BAOS[kind].both ? BAO.map((row, y) => (y === 8 ? row.slice(0, 10) + "KKK" + row.slice(13) : y === 9 ? row.slice(0, 10) + "EEE" + row.slice(13) : y === 10 ? row.slice(0, 11) + "E" + row.slice(12) : row)) : BAO)
// The steamer: a hoop of bamboo, a band round it.
const STEAMER = [
  ".OOOOOOOOOOOOOOOOOOOOOO.",
  "OwwwwwwwwwwwwwwwwwwwwwwO",
  "OWWWWWWWWWWWWWWWWWWWWWWO",
  "OOOOOOOOOOOOOOOOOOOOOOOO",
  "OWWWuWWWWWWWWWWWWWWuWWWO",
  "OWWWuWWWWWWWWWWWWWWuWWWO",
  "OwwwuwwwwwwwwwwwwwwuwwwO",
  "OUUUUUUUUUUUUUUUUUUUUUUO",
  ".OOOOOOOOOOOOOOOOOOOOOO.",
]
const WOOD = { O: "#7a5230", W: "#efc793", w: "#f8dcb4", u: "#c4925e", U: "#d5a873" }
// A bun in its steamer, as one picture: 24 by 21. (Each in its own colours:
// the bun's letters are renamed.)
function basket(colours) {
  const rename = { O: "1", C: "2", c: "3", d: "4", m: "5", a: "6", K: "7", E: "8" }
  const pal = { ...WOOD }
  for (const [from, to] of Object.entries(rename)) pal[to] = colours[from]
  const c = new Canvas(24, 21)
  c.put(over(BAO), 3, 0, rename).put(over(STEAMER), 0, 12)
  return { c, pal }
}
{
  const gold = basket(BAO_GOLD)
  gold.c.save("bunny-bao.svg", gold.pal)
}

// ── The game's own things, fifteen squares each ──────────────────────────
// Redrawn small after the game's pictures of them. One palette for all:
// K black, k dark grey, g grey, s silver, W white; R red, r its light, d its
// dark; A amber, a its light, n its dark; C cyan, c its light, b its deep;
// Y yellow; G gold; N navy; V circuit green, v its dark; T teal; m steel,
// M its dark; P violet.
const ITEM = { K: "#1d1d21", k: "#3a3b40", g: "#8a8d93", s: "#c9ccd1", W: "#ffffff", R: "#e23b3b", r: "#ff9a8f", d: "#9c1f2a", A: "#f08a1c", a: "#ffc266", n: "#7a3f10", C: "#23b1e6", c: "#a8e6fa", b: "#0e6f9c", Y: "#f6cf3a", G: "#d9a441", N: "#1f3a5c", V: "#3f8f5a", v: "#2b6a44", T: "#2f9aa8", m: "#b9a094", M: "#8f7468", P: "#a78bfa" }
const ITEMS = {
  // 合成玉: a red crystal held in a frame, a rod off each corner.
  orundum: [
    "...............",
    ".g...........g.",
    "..g...KKK...g..",
    "...g.KRrRK.g...",
    "....KRrrRRK....",
    "...KRrrRRRdK...",
    "..KRrrRRRRddK..",
    "..KRrRRRRdddK..",
    "..KRRRRRRdddK..",
    "...KRRRRdddK...",
    "....KRRdddK....",
    "...g.KRdRK.g...",
    "..g...KKK...g..",
    ".g...........g.",
    "...............",
  ],
  // 至纯源石: a block of amber and black, a square mark in its face.
  originite: [
    "...............",
    "....KKKKKKK....",
    "...KnnAAAaKK...",
    "..KnnAAAaaaaK..",
    ".KnnAAAaaaaaaK.",
    ".KnAAAKKKaaaaK.",
    "KnnAAAKaKAaaaAK",
    "KnAAAAKKKAAAAAK",
    "KnnAAAAAAAAAAnK",
    "KnnnAAAAAAAAnnK",
    ".KnnnAAAAAAnnK.",
    ".KKnnnAAAAnnKK.",
    "..KKnnnnnnnKK..",
    "....KKKKKKK....",
    "...............",
  ],
  // 龙门币: a cyan banknote, a few under it.
  lmd: [
    "...............",
    "...............",
    ".KKKKKKKKKKKKK.",
    ".KCCCCCCCCCCCK.",
    ".KCWcccccccWCK.",
    ".KCccWcWccccCK.",
    ".KCcWcWcWcccCK.",
    ".KCccWcWccccCK.",
    ".KCWcccccccWCK.",
    ".KCCCCCCCCCCCK.",
    ".KKKKKKKKKKKKK.",
    "..KbbbbbbbbbbbK",
    "..KKKKKKKKKKKKK",
    "...............",
    "...............",
  ],
  // 作战记录: a tape, black above with a tower on it, gold below.
  tape: [
    "...............",
    ".KKKKKKKKKKKKK.",
    ".KkkkkkWkkkkkK.",
    ".KkkkkWWWkkkkK.",
    ".KkkkkWWWkkkkK.",
    ".KkkkWWWWWkkkK.",
    ".KkkkkkkkkkkkK.",
    ".KGGGGGGGGGGGK.",
    ".KGWWGWGWGWWGK.",
    ".KGWGGGWGGWWGK.",
    ".KGWWGWGWGWGGK.",
    ".KGGGGGGGGGGGK.",
    ".KKKKKKKKKKKKK.",
    "...............",
    "...............",
  ],
  // 技巧概要: a navy book, a grid of marks on its cover.
  book: [
    "...............",
    "..KKKKKKKKKKK..",
    "..KNNNNNNNNNKs.",
    "..KNWWNNNNNNKs.",
    "..KNWNCCCCCNKs.",
    "..KNNNNNNNNNKs.",
    "..KNCNCNCNCNKs.",
    "..KNNNNNNNNNKs.",
    "..KNCNCNCNCNKs.",
    "..KNNNNNNNNNKs.",
    "..KNCNCNCNCNKs.",
    "..KNNNNNNNNNKs.",
    "..KKKKKKKKKKKs.",
    "...sssssssssss.",
    "...............",
  ],
  // 招聘许可: a silver pouch, black below, a blue mark on it.
  permit: [
    "...............",
    "...KKKKKKKKK...",
    "..KsssssssssK..",
    "..KsWsssssssK..",
    "..KssWssssssK..",
    "..KsssssssssK..",
    "..KsssssssssK..",
    "..KKKKKKKKKKK..",
    "..KkkkkkkkkkK..",
    "..KkCCCkkkkkK..",
    "..KkCWCkWWWkK..",
    "..KkCCCkkkkkK..",
    "..KkkkkkkkkkK..",
    "..KKKKKKKKKKK..",
    "...............",
  ],
  // 寻访凭证: a yellow pass on a clip, black down one side.
  ticket: [
    "...............",
    "......KKK......",
    "......KsK......",
    ".KKKKKKKKKKKKK.",
    ".KkkkkYYYYYYYK.",
    ".KkWkkYKKKKYYK.",
    ".KkkWkYYYYYYYK.",
    ".KkWkkYKKKYYYK.",
    ".KkkkkYYYYYCYK.",
    ".KkWWkYYYYYCYK.",
    ".KkkkkYYYYYYYK.",
    ".KKKKKKKKKKKKK.",
    "...............",
    "...............",
    "...............",
  ],
  // 应急理智顶液: a dark pouch, a vial of amber across its corner.
  potion: [
    "...............",
    ".KKKKKKKKKK.K..",
    ".KkkkkkkkkKKsK.",
    ".KkkkkkkkKAsK..",
    ".KkkkkkkKAaK...",
    ".KkkkkkKAaKkK..",
    ".KkWkWkKAKkkK..",
    ".KkkWkkkKkkkK..",
    ".KkWWWkkkkkkK..",
    ".KkkWkkkkkkkK..",
    ".KkWkWkkkWWkK..",
    ".KkkkkkkkkkkK..",
    ".KKKKKKKKKKKK..",
    "...............",
    "...............",
  ],
  // 芯片: a green board, a teal chip on it, a shield on the chip.
  chip: [
    "...............",
    ".KKKKKKKKKKKKK.",
    ".KVvVVVVVVVvVK.",
    ".KvKKKKKKKKKvK.",
    ".KVKTTTTTTTKVK.",
    ".KVKTWWWWWTKVK.",
    ".KVKTWTTTWTKVK.",
    ".KVKTWTTTWTKVK.",
    ".KVKTTWTWTTKVK.",
    ".KVKTTTWTTTKVK.",
    ".KVKTTTTTTTKVK.",
    ".KvKKKKKKKKKvK.",
    ".KVvVVVVVVVvVK.",
    ".KKKKKKKKKKKKK.",
    "...............",
  ],
  // 家具零件: a bolt and a nut.
  bolt: [
    "...............",
    ".........KKKK..",
    "........KmmmmK.",
    "..KKKKKKKmmMmK.",
    ".KmMmMmMKmmMmK.",
    "..KKKKKKKmmMmK.",
    "........KmmmmK.",
    "...KKKK..KKKK..",
    "..KmmmmK.......",
    ".KmmKKmmK......",
    ".KmK..KMK......",
    ".KmmKKMMK......",
    "..KmMMMK.......",
    "...KKKK........",
    "...............",
  ],
  // 无人机: four arms, a rotor on each, a violet light under it.
  drone: [
    "...............",
    "ggg.........ggg",
    ".ggg.......ggg.",
    "..kk.......kk..",
    "...kk.KKK.kk...",
    "....kKkkkKk....",
    ".....KkPkK.....",
    "....kKPPPKk....",
    ".....KkPkK.....",
    "....kKkkkKk....",
    "...kk.KKK.kk...",
    "..kk.......kk..",
    ".ggg.......ggg.",
    "ggg.........ggg",
    "...............",
  ],
}
for (const [name, rows] of Object.entries(ITEMS)) writeSprite(`bunny-i-${name}.svg`, rows, ITEM)
// 理智: the faceted head with a bolt through it, nine squares. And the
// marks the interface is drawn with: a tick, a pointer, a cross of the kind
// an empty slot wears.
writeSprite("bunny-sanity.svg", [".KKKKKKK.", "KWWWWWWWK", "KWWWKKWWK", "KWWKKWWWK", "KWKKKKKWK", "KWWWKKWWK", "KWWKKWWWK", "KWWKWWWWK", ".KKKKKKK."], ITEM)
// Nine squares of 合成玉 (and one with the colour gone, for what is not
// yet reached), and of 源石: what is unread, what counts, what is done.
const GEM = ["....K....", "...KRK...", "..KRrRK..", ".KRrRRdK.", "KRrRRRddK", ".KRRRddK.", "..KRddK..", "...KdK...", "....K...."]
writeSprite("bunny-gem.svg", GEM, ITEM)
writeSprite("bunny-gem-off.svg", GEM, { K: "#8c8f96", R: "#d6d8dc", r: "#eceef0", d: "#bfc2c8" })
writeSprite("bunny-ore.svg", ["..KKKKK..", ".KnAAaaK.", "KnAAAaaaK", "KnAKKKaaK", "KnAKaKAaK", "KnAKKKAAK", "KnnAAAAnK", ".KnnnnnK.", "..KKKKK.."], ITEM)
writeSprite("bunny-tick.svg", ["........C", ".......CC", "......CC.", "C....CC..", "CC..CC...", ".CCCC....", "..CC....."], { C: "#1596c9" })
writeSprite("bunny-caret.svg", ["C......", "CCC....", "CCCCC..", "CCCCCCC", "CCCCC..", "CCC....", "C......"], { C: "#1596c9" })
// Down to the latest.
writeSprite("bunny-arrow.svg", ["OO.....OO", "OOO...OOO", ".OOO.OOO.", "..OOOOO..", "...OOO...", "....O...."], { O: "#5a3418" })
writeSprite("bunny-arrow-night.svg", ["OO.....OO", "OOO...OOO", ".OOO.OOO.", "..OOOOO..", "...OOO...", "....O...."], { O: "#f1e7da" })

// The round stamp in the corner of a product card: a ring, a ring of
// dashes, and the rabbit's head in the middle of it. (The brand's has its
// name round the rim; this one has none.)
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
  stamp.save("bunny-stamp.svg", { M: "#9fb4bd", I: "#ffffff" })
  stamp.save("bunny-stamp-night.svg", { M: "#4a5560", I: "#2c2523" })
}

// A rule across a reply: the rabbit and the bun side by side, a line of
// dashes and a crystal out to each side.
{
  const rule = new Canvas(121, 16)
  const rename = Object.fromEntries(Object.keys(LPP).map((k, i) => [k, String.fromCharCode(0x3b1 + i)]))
  const pal = { ...VERSIONS.amiya, x: "#b9a999", R: ITEM.R, r: ITEM.r, q: ITEM.d, J: ITEM.K }
  for (const [from, to] of Object.entries(rename)) pal[to] = LPP[from]
  rule.put(over(small("amiya")), 47, 0).put(over(BUN_SMALL), 60, 3, rename)
  const gem = ["..J..", ".JRJ.", "JRrqJ", ".JqJ.", "..J.."]
  for (const [x0, x1, gx] of [[0, 30, 34], [91, 121, 82]]) {
    for (let x = x0; x < x1; x += 4) rule.rect(x, 9, 2, 1, "x")
    rule.put(over(gem), gx, 7)
  }
  rule.save("bunny-rule.svg", pal)
}

// ── What a row of the sidebar opens ──────────────────────────────────────
// 新会话 is the rabbit, a cross beside it as on an empty slot of a squad;
// 员工, the rabbit and the bun; the rest are the game's things (项目 the
// records, 任务 a recruitment permit, 设备会话 a drone).
{
  const icon = () => new Canvas(15, 15)
  icon().put(over(head("plain")), 0, 6).put(over(["..C..", "..C..", "CCCCC", "..C..", "..C.."]), 10, 0, { C: "c" }).save("bunny-nav-new.svg", { ...VERSIONS.amiya, c: "#1596c9" })
  sheet(15, 15).place(sibHead("nian"), SIBLINGS.nian, 6, 0).place(head("plain"), VERSIONS.amiya, 0, 6).save("bunny-nav-pair.svg")
}

// ── The ground: a tactical grid ──────────────────────────────────────────
// What the game's screens are ruled with: fine lines, a cross where they
// meet. A tile.
{
  const grid = new Canvas(24, 24)
  for (let i = 0; i < 24; i += 2) grid.set(i, 0, "a").set(0, i, "a")
  grid.put(over([".b.", "bbb", ".b."]), 23, 23).set(0, 0, "b").set(1, 0, "b").set(0, 1, "b")
  grid.save("bunny-grid.svg", { a: "#b9d6e6", b: "#8dbbd3" })
  grid.save("bunny-grid-night.svg", { a: "#2a3346", b: "#3b4963" })
}

// ── The steamer at the end of the sidebar's list ─────────────────────────
// (No rabbit here.) All seven buns in one wide steamer, three behind and
// four in front, as in the photograph; a crystal and a block of 源石 beside
// it; a strip of the deck's warning stripes under them.
function steamer(w) {
  const row = (ends, fill, mark) => ends[0] + Array.from({ length: w - 2 }, (_, i) => (mark && (i + 1) % 16 === 4 ? mark : fill)).join("") + ends[1]
  return [row("..", "O"), row("OO", "w"), row("OO", "W"), row("OO", "O"), row("OO", "W", "u"), row("OO", "W", "u"), row("OO", "w", "u"), row("OO", "U"), row("..", "O")]
}
{
  const n = sheet(130, 40)
  ;["yu", "xi", "ling"].forEach((kind, i) => n.place(bao(kind), BAOS[kind], 16 + i * 24, 0))
  ;["nian", "shu", "chongyue", "wang"].forEach((kind, i) => n.place(bao(kind), BAOS[kind], 3 + i * 24, 8))
  n.place(steamer(100), WOOD, 0, 21)
  n.place(ITEMS.orundum.slice(1, 14), ITEM, 99, 17).place(ITEMS.originite.slice(1, 14), ITEM, 112, 17)
  // The deck's edge: yellow and black, on the slant.
  n.pal.h = "#f6cf3a"
  n.pal.H = "#2b2a31"
  n.c.fill((x, y) => y >= 34 && y < 38 && Math.floor((x + y) / 4) % 2 === 0, "h", (ch) => ch === ".")
  n.c.fill((x, y) => y >= 34 && y < 38, "H", (ch) => ch === ".")
  n.c.rect(0, 33, 130, 1, "H").rect(0, 38, 130, 1, "H")
  n.save("bunny-nook.svg")
}

// ── Where no session is open: the deck ───────────────────────────────────
// A hangar of the landship as the game's first screen shows it behind its
// menu: panelled walls, a strip of light, a shutter edged in warning
// stripes, an orange rail, the floor marked in yellow; a crate, a steamer.
// The rabbit and the bun are laid over it by the stylesheet. By night the
// lights are low and the strip glows cyan.
function deck() {
  const c = new Canvas(180, 112)
  // Wall panels, their seams; a strip of light along the top.
  c.rect(0, 0, 180, 84, "A")
  for (let x = 0; x < 180; x += 30) c.rect(x, 0, 1, 84, "a")
  c.rect(0, 30, 180, 1, "a").rect(0, 6, 180, 3, "I").rect(0, 9, 180, 1, "a")
  // The shutter: slats, a frame of warning stripes.
  c.rect(52, 16, 76, 68, "H")
  c.fill((x, y) => x >= 52 && x < 128 && y >= 16 && y < 84 && (x < 57 || x >= 123 || y < 21) && Math.floor((x + y) / 5) % 2 === 0, "Y")
  c.rect(57, 21, 66, 63, "S")
  for (let y = 24; y < 84; y += 5) c.rect(57, y, 66, 1, "s")
  // A window in it: the sky going by.
  c.rect(72, 28, 36, 14, "H").rect(73, 29, 34, 12, "V")
  c.oval(84, 36, 6, 2.4, "I").oval(90, 34.6, 4, 2.6, "I").oval(99, 38, 4, 1.6, "I")
  // Pipes down the wall; a rail.
  c.rect(14, 0, 3, 84, "p").rect(15, 0, 1, 84, "P").rect(160, 0, 4, 84, "p").rect(161, 0, 1, 84, "P")
  for (const y of [22, 58]) c.rect(13, y, 5, 2, "H").rect(159, y, 6, 2, "H")
  for (let x = 2; x < 50; x += 12) c.rect(x, 64, 2, 20, "O")
  for (let x = 132; x < 180; x += 12) c.rect(x, 64, 2, 20, "O")
  c.rect(0, 62, 50, 2, "O").rect(130, 62, 50, 2, "O").rect(0, 72, 50, 1, "o").rect(130, 72, 50, 1, "o")
  // The floor: plates, a yellow line, a hatched bay where the dolls sit.
  c.rect(0, 84, 180, 28, "F").rect(0, 84, 180, 1, "f")
  for (let x = 10; x < 180; x += 40) c.rect(x, 85, 1, 27, "f")
  c.rect(0, 96, 180, 1, "f")
  c.rect(36, 88, 108, 2, "Y").rect(36, 108, 108, 2, "Y").rect(36, 88, 2, 22, "Y").rect(142, 88, 2, 22, "Y")
  c.oval(74, 103, 22, 3, "f").oval(118, 103, 22, 3, "f")
  // A supply crate, a crystal marked on it.
  c.rect(150, 84, 26, 22, "H").rect(151, 85, 24, 20, "K").rect(151, 85, 24, 3, "k").rect(151, 94, 24, 1, "H")
  c.put(over(["..R..", ".RrR.", "RrRRR", ".RRR.", "..R.."]), 160, 97)
  // Corner marks, as on every screen of the game.
  for (const [x, y, dx, dy] of [[3, 3, 1, 1], [176, 3, -1, 1], [3, 108, 1, -1], [176, 108, -1, -1]]) for (let i = 0; i < 7; i++) c.set(x + dx * i, y, "I").set(x, y + dy * i, "I")
  return c
}
const DECK = { A: "#c7ccd3", a: "#aeb4bd", I: "#ffffff", H: "#2b2a31", Y: "#f6cf3a", S: "#dfe3e8", s: "#bfc5cd", V: "#8cc6ea", p: "#8f96a1", P: "#c9ced6", O: "#f0871c", o: "#c96a12", F: "#e7e9ec", f: "#c5cad1", K: "#3d4048", k: "#565a64", R: "#e23b3b", r: "#ff9a8f" }
deck().save("bunny-deck.svg", DECK)
deck().save("bunny-deck-night.svg", { ...DECK, A: "#353a45", a: "#272b34", I: "#7fe0ff", S: "#444a57", s: "#343945", V: "#16203a", p: "#22262f", P: "#4b5160", O: "#b9651a", o: "#8a4a12", F: "#2c303a", f: "#20232b", Y: "#c9a52c", H: "#121317", K: "#1b1d22", k: "#2c2f37" })

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
