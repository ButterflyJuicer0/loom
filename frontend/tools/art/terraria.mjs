// ── 泰拉瑞亚 (Terraria) ───────────────────────────────────────────────────
// Drawn after looking at the game: its Steam screenshots (the HUD: hotbar,
// life hearts, mana stars, the gold-framed minimap; wooden houses on grass
// and dirt; the sky by day) and the official wiki's pictures — interface
// screenshots (the open inventory, an NPC's dialogue box, a sign, the Select
// Player and Create World menus), the forest's painted backdrop and a strip
// of forest (its trees' clumps of leaves), and item / NPC pages (the Guide,
// a slime, a chest, the copper pickaxe, shortsword and hammer, a book, a
// torch, the magic mirror, a fishing pole, a wrench, a gold coin, a fallen
// star). Colours are sampled from those; every grid below is Loom's own
// drawing, one square per game pixel (the game shows each at 2×, and so
// does the stylesheet).
import { random, sprite, write } from "./lib.mjs"

const ID = "terraria"

// ── A canvas of squares ──────────────────────────────────────────────────
class Cv {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.p = Array.from({ length: h }, () => new Array(w).fill(null))
  }
  put(x, y, c) {
    if (c && x >= 0 && x < this.w && y >= 0 && y < this.h) this.p[y][x] = c
  }
  clear(x, y) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.p[y][x] = null
  }
  get(x, y) {
    return x >= 0 && x < this.w && y >= 0 && y < this.h ? this.p[y][x] : null
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.put(i, j, c)
  }
  // A rectangle with a one-square outline.
  box(x, y, w, h, line, fill) {
    this.rect(x, y, w, h, line)
    if (fill) this.rect(x + 1, y + 1, w - 2, h - 2, fill)
  }
  stamp(rows, pal, x, y, flip = false) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i]]
        if (c) this.put(x + (flip ? row.length - 1 - i : i), y + j, c)
      }
    })
  }
  disc(cx, cy, rx, ry, c) {
    for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++)
      for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
        const dx = (i + 0.5 - cx) / rx
        const dy = (j + 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1) this.put(i, j, c)
      }
  }
  body() {
    let s = ""
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; ) {
        const c = this.p[y][x]
        let n = 1
        while (x + n < this.w && this.p[y][x + n] === c) n++
        if (c) s += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${c}"/>`
        x += n
      }
    return s
  }
  save(name, extra = "") {
    write(`${ID}-${name}.svg`, sprite(this.w, this.h, extra + this.body()))
  }
}

// A hand-drawn grid: every row as long as the first.
function grid(name, rows) {
  const bad = rows.findIndex((row) => row.length !== rows[0].length)
  if (bad >= 0) throw new Error(`${name}: row ${bad} is ${rows[bad].length} wide, not ${rows[0].length}`)
  return rows
}

function save(name, rows, pal) {
  const cv = new Cv(rows[0].length, rows.length)
  cv.stamp(rows, pal, 0, 0)
  cv.save(name)
}

// ── Day and night ────────────────────────────────────────────────────────
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
const mix = (a, b, p) => hex(rgb(a).map((v, i) => v * (1 - p) + rgb(b)[i] * p))
// What stands outside goes towards the night's navy; what a torch lights
// keeps most of its colour; a flame keeps all of it.
const day = (c) => c
const night = (c, zone = "out") => (zone === "glow" ? c : mix(c, "#05081c", zone === "in" ? 0.22 : 0.58))
const tones = { "": day, "-night": night }

// ── Items ────────────────────────────────────────────────────────────────

// A life heart, as on the HUD: eleven squares, a dark slate outline, a
// darker red along the left and under the lobes, a pink plus of light.
const HEART = grid("heart", [
  "..ooo.ooo..",
  ".odddodRRo.",
  "odRRRdRhRRo",
  "odRRRRhhhRo",
  "odRRRRhhRRo",
  "odRRRRRRRdo",
  ".odRRRRRdo.",
  "..odRRRdo..",
  "...odRdo...",
  "....odo....",
  ".....o.....",
])
const heartRed = { o: "#27344e", d: "#b5172d", R: "#fe1d2d", h: "#ff7f8e" }
const heartEmpty = { o: "#27344e", d: "#3b1622", R: "#4d1c2b", h: "#4d1c2b" }
save("heart", HEART, heartRed)
save("heart-empty", HEART, heartEmpty)

// A mana star: the same outline, three blues, light in the middle.
const STAR = grid("star", [
  ".....o.....",
  "....oLo....",
  "....omo....",
  "...obmmo...",
  "ooobmmLmooo",
  "obmmmLLLmmo",
  ".obmmLLmmo.",
  "..obmmmmo..",
  ".obmmmmmmo.",
  ".ombbobbmo.",
  "obboo.oobbo",
  "ooo.....ooo",
])
const starBlue = { o: "#263650", b: "#3344f0", m: "#5979fb", L: "#a4b9ff" }
// A fallen star: the same shape (the game's are one star in two colours),
// gold that pales to its middle and browns at the tips of its feet.
const FALLEN = grid("fallen", [
  ".....o.....",
  "....oLo....",
  "....omo....",
  "...obmbo...",
  "ooobmLmbooo",
  "obLmLLLmLbo",
  ".onmmLmmno.",
  "..obmmmbo..",
  ".onLbmbmno.",
  ".oLbnonbLo.",
  "obnoo.oonbo",
  "ooo.....ooo",
])
const starYellow = { o: "#574206", b: "#c5ae23", m: "#f2dd40", L: "#f8ffba", n: "#967b0f" }
save("star", STAR, starBlue)
save("fallen", FALLEN, starYellow)

// Coins: an oval on its edge, a line of light down it.
const COIN = grid("coin", [
  "..oo..",
  ".oYLo.",
  "oYsLYo",
  "oYsLYo",
  "oYsLYo",
  "oYsYYo",
  ".oYYo.",
  "..oo..",
])
save("coin-gold", COIN, { o: "#4c2d08", Y: "#ccb548", L: "#fff9b7", s: "#947e18" })
save("coin-silver", COIN, { o: "#3a3f4a", Y: "#b9c0cc", L: "#ffffff", s: "#7f8794" })
save("coin-copper", COIN, { o: "#4a2410", Y: "#d8824a", L: "#ffd2b0", s: "#96481c" })

// The copper pickaxe everyone starts with: a head that arcs from the upper
// left round to the right, a wooden handle down to the lower left.
const PICKAXE = grid("pickaxe", [
  "......ooo.......",
  ".....oCCLoo.....",
  "......ooCCLo....",
  "........oCHLo...",
  ".........oCCLo..",
  "........owoCCo..",
  ".......owo.oCLo.",
  "......owo..oCLo.",
  ".....owo....oCo.",
  "....owo.....oo..",
  "...owo..........",
  "..owo...........",
  ".owo............",
  "owo.............",
  "oo..............",
  "................",
])
const copper = { o: "#2d190e", C: "#b75819", L: "#eba687", H: "#ffe2d9", w: "#976b4b" }
save("pickaxe", PICKAXE, copper)

const PICK = grid("pick", [
  "...ooo.....",
  "..oCCLoo...",
  "...ooCCLo..",
  ".....oCLo..",
  "....owoCLo.",
  "...owo.oCo.",
  "..owo..oCo.",
  ".owo....o..",
  "owo........",
  "oo.........",
  "...........",
])
save("pick", PICK, copper)

// The copper shortsword: a blade up to the right, a guard across, a grip.
const SWORD = grid("sword", [
  ".............ooo",
  "............oLHo",
  "...........oLCo.",
  "..........oLCo..",
  ".........oLCo...",
  "........oLCo....",
  ".......oLCo.....",
  "..o...oLCo......",
  "..oo.oLCo.......",
  "...ooLCo........",
  "....oCoo........",
  "...owooo........",
  "..owo..oo.......",
  ".owo............",
  "owo.............",
  "oo..............",
])
save("sword", SWORD, copper)
save("sword-off", SWORD, { o: "#2a3350", C: "#5e6a8c", L: "#8d98b8", H: "#aab4d0", w: "#566080" })

// A wooden chest: iron down the middle and round the lid, a lock.
const CHEST = grid("chest", [
  "..oooooooooooo..",
  ".oLLWWwggwWWLLo.",
  "oLWWWWwgGwWWWWLo",
  "oWWLLWwgGwWLLWWo",
  "oWLLLWwgGwWLLLWo",
  "owwwwwwgGwwwwwwo",
  "oGGGGGGkkGGGGGGo",
  "owWWWWgkkgWWWWwo",
  "owWLLWWggWWLLWwo",
  "owWWLLWwwWLLWWwo",
  "owwWWWWwwWWWWwwo",
  "owwwwwwwwwwwwwwo",
  "okkkkkkkkkkkkkko",
  "oooooooooooooooo",
])
const wood = { o: "#202020", L: "#a2785c", W: "#946b50", w: "#614739", g: "#808080", G: "#5f5f5f", k: "#3d3d3d" }
const goldChest = { o: "#2a2208", L: "#f4e27a", W: "#d9b83a", w: "#a07f1c", g: "#c9c9c9", G: "#8f8f8f", k: "#5a4a10" }
save("chest", CHEST, wood)
save("chest-gold", CHEST, goldChest)

const CHEST_S = grid("chest-s", [
  ".ooooooooo.",
  "oLWWwgwWWLo",
  "oWLLwgwLLWo",
  "owwwwgwwwwo",
  "oGGGGkGGGGo",
  "owWWgkgWWwo",
  "owLLWgWLLwo",
  "owwWWwWWwwo",
  "okkkkkkkkko",
  "ooooooooooo",
])
save("chest-s", CHEST_S, wood)

// What a tool is, in the slot: one item each, drawn after the game's own.
// A book (to read), shut, its pages showing along two edges.
save(
  "book",
  grid("book", [
    ".......oo.......",
    "......oLDo......",
    ".....oLDDGo.....",
    "....oLDGGGGo....",
    "...oLDDGGGGGo...",
    "..oLDGGDDGGGLo..",
    ".oLDDGGDDGGLLop.",
    "oLDGGGDDLLLLowp.",
    "poGGGLLDDLowp...",
    "spoLLLLLLowp....",
    ".spoLLLLowp.....",
    "..spoLLowp......",
    "...spoowp.......",
    "....spwp........",
    ".....pp.........",
    "................",
  ]),
  { o: "#092a14", L: "#84bb45", G: "#579d47", D: "#2e7e3f", p: "#4a413a", w: "#dfdddb", s: "#a19389" },
)

// A torch (to look for something).
save(
  "torch",
  grid("torch", [
    "................",
    "..........r.....",
    ".........rYr....",
    "........rOYOr...",
    "........rYWYr...",
    ".........rOr....",
    "........owo.....",
    ".......owo......",
    "......owo.......",
    ".....owo........",
    "....owo.........",
    "...owo..........",
    "...oo...........",
    "................",
    "................",
    "................",
  ]),
  { r: "#fd3e03", O: "#fe7902", Y: "#fddd03", W: "#fff3a0", o: "#372619", w: "#a97d5d" },
)

// The copper hammer (to change what is there).
save(
  "hammer",
  grid("hammer", [
    ".........oo.....",
    "........oCLo.oo.",
    ".......oCLHLowo.",
    "......oDCLHLLo..",
    ".......oDCLHLo..",
    "........oDCLHLo.",
    "........ooDCLLo.",
    ".......owooDCo..",
    "......owo..oo...",
    ".....owo........",
    "....owo.........",
    "...owo..........",
    "..owo...........",
    ".owo............",
    "owo.............",
    "oo..............",
  ]),
  { ...copper, D: "#964316" },
)

// A fishing pole (to fetch something from far off): its line, a float.
save(
  "pole",
  grid("pole", [
    ".............oo.",
    "............owo.",
    "...........owol.",
    "..........owo.l.",
    ".........owo..l.",
    "........owo...l.",
    ".......owo....l.",
    "......owo.....l.",
    ".....owo......r.",
    "....owo......rWr",
    "...ogo........r.",
    "..ogo...........",
    ".ogo............",
    "ogo.............",
    "oo..............",
    "................",
  ]),
  { o: "#382c24", w: "#aa8267", g: "#47c376", l: "#d0d8b4", r: "#b3182e", W: "#ffffff" },
)

// A wrench (for what is wired in from outside).
save(
  "wrench",
  grid("wrench", [
    "...........ooo..",
    "..........oSsso.",
    ".........oSso.so",
    "........ooss..oo",
    ".......oRRoso...",
    ".......oRrRoo...",
    "......oRrRo.....",
    ".....oRrRo......",
    "....oRrRo.......",
    "...oRrRo........",
    "..oRrRo.........",
    ".oRrRo..........",
    "oRrRo...........",
    "oRRo............",
    ".oo.............",
    "................",
  ]),
  { o: "#2a0a0c", S: "#adadad", s: "#737373", R: "#e00408", r: "#fc5a5c" },
)

// The magic mirror (to look out into the world): glass in a silver rim.
{
  const cv = new Cv(16, 16)
  cv.disc(8, 8, 6.6, 6.6, "#2a3034")
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8)
      if (d <= 5.6) cv.put(x, y, (x + y) % 3 === 0 ? "#7c8d8e" : x + y < 15 ? "#dbe1e1" : "#a1acad")
      if (d <= 4.4) cv.put(x, y, "#254c5f")
      if (d <= 3.5) cv.put(x, y, x + y < 13 ? "#97dde5" : x + y > 17 ? "#3e7994" : "#6bccd5")
    }
  for (const [x, y] of [[6, 5], [5, 6], [6, 6], [9, 9]]) cv.put(x, y, "#d7faff")
  cv.save("mirror")
}

// The same items small, for a chip and for a single call's line: eleven
// squares, as the pickaxe, the chest and the sign have already.
save(
  "book-s",
  grid("book-s", [
    "....oo.....",
    "...oLGo....",
    "..oLGGDo...",
    ".oLGDDGGo..",
    "oLGGDDGLop.",
    "oGGDDLLLowp",
    "poGLLLLowp.",
    ".poLLLowp..",
    "..poLowp...",
    "...pwwp....",
    "....pp.....",
  ]),
  { o: "#092a14", L: "#84bb45", G: "#579d47", D: "#2e7e3f", p: "#4a413a", w: "#dfdddb" },
)
save(
  "torch-s",
  grid("torch-s", [
    "...........",
    "......r....",
    ".....rYr...",
    "....rOWOr..",
    ".....rOr...",
    ".....owo...",
    "....owo....",
    "...owo.....",
    "..owo......",
    ".owo.......",
    ".oo........",
  ]),
  { r: "#fd3e03", O: "#fe7902", Y: "#fddd03", W: "#fff3a0", o: "#372619", w: "#a97d5d" },
)
save(
  "hammer-s",
  grid("hammer-s", [
    "......oo...",
    ".....oCLo.o",
    "....oCLHLoo",
    ".....oDCLLo",
    "......oDCLo",
    ".....owoDo.",
    "....owo.o..",
    "...owo.....",
    "..owo......",
    ".owo.......",
    "oo.........",
  ]),
  { ...copper, D: "#964316" },
)
save(
  "pole-s",
  grid("pole-s", [
    "........oo.",
    ".......owol",
    "......owo.l",
    ".....owo..l",
    "....owo...l",
    "...owo...rW",
    "..ogo....Wr",
    ".ogo.......",
    "ogo........",
    "oo.........",
    "...........",
  ]),
  { o: "#382c24", w: "#aa8267", g: "#47c376", l: "#d0d8b4", r: "#b3182e", W: "#ffffff" },
)
save(
  "wrench-s",
  grid("wrench-s", [
    "........oo.",
    ".......oSso",
    "......oSo.o",
    ".....oRsoo.",
    "....oRrRo..",
    "...oRrRo...",
    "..oRrRo....",
    ".oRrRo.....",
    "oRrRo......",
    "oRRo.......",
    ".oo........",
  ]),
  { o: "#2a0a0c", S: "#adadad", s: "#737373", R: "#e00408", r: "#fc5a5c" },
)
save(
  "sword-s",
  grid("sword-s", [
    ".........oo",
    "........oLo",
    ".......oLo.",
    "......oLo..",
    ".o...oLo...",
    ".oo.oLo....",
    "..ooLo.....",
    "...oCo.....",
    "..owoo.....",
    ".owo.oo....",
    "oo.........",
  ]),
  copper,
)
{
  const cv = new Cv(11, 11)
  for (let y = 0; y < 11; y++)
    for (let x = 0; x < 11; x++) {
      const d = Math.hypot(x - 5, y - 5)
      if (d <= 5.3) cv.put(x, y, "#2a3034")
      if (d <= 4.3) cv.put(x, y, x + y < 10 ? "#dbe1e1" : "#a1acad")
      if (d <= 3.3) cv.put(x, y, "#254c5f")
      if (d <= 2.4) cv.put(x, y, x + y < 9 ? "#97dde5" : x + y > 11 ? "#3e7994" : "#6bccd5")
    }
  cv.put(4, 3, "#d7faff")
  cv.put(3, 4, "#d7faff")
  cv.save("mirror-s")
}

// A slime: a dome, darker at its rim, a window of light up to the right.
const SLIME = grid("slime", [
  ".....oooooo.....",
  "...ooBGGGGGoo...",
  "..oBGGLLLLHLGo..",
  ".oBGGLLLLHHHLGo.",
  ".oGGGLLLLLHHLLo.",
  "oBGGGLLLLLLLLLGo",
  "oBGGGGLLLLLLLLGo",
  "oBGGGGGGLLLLLGGo",
  "oBBGGGGGGGGGGGBo",
  ".oBBBGGGGGGGBBo.",
  "..oooooooooooo..",
])
const slimeGreen = { o: "#123a19", B: "#247433", G: "#2f9842", L: "#3abb52", H: "#7fe08f" }
const slimeBlue = { o: "#14215e", B: "#2a3fa8", G: "#3a55d0", L: "#5173f0", H: "#9db4ff" }
save("slime", SLIME, slimeGreen)
save("slime-blue", SLIME, slimeBlue)

// The Guide: brown hair in tufts, a sleeveless khaki shirt, blue trousers.
const GUIDE = grid("guide", [
  "...aa.aa.....",
  ".aabcabcaa...",
  "acfbccbfcba..",
  ".afccfbcfbfa.",
  "abfacfcfbcba.",
  "afafaacbfcfa.",
  ".a.aspeasba..",
  "...kspesssa..",
  "..kSssssnak..",
  "...kssssnk...",
  "..ookkkkkoo..",
  "..otuTttoTto.",
  "..outtutoTto.",
  "..ootutuoTto.",
  ".kkotututkssk",
  ".ksotTtuuksSk",
  ".knoTutttknsk",
  "..kDEDEFFkkk.",
  "...DEDEFFD...",
  "...DFDFFFFD..",
  "...HIHIFFFD..",
  "..HIHIIIFDD..",
  "..HHHHHHDDD..",
])
const guide = {
  a: "#351d06", b: "#d98b2f", c: "#ae650e", f: "#6e3e0e",
  s: "#ef845a", S: "#ffad8c", n: "#d65a31", e: "#f7f7f7", p: "#524030", k: "#37170c",
  o: "#323225", t: "#a7a67d", T: "#c6c4aa", u: "#7c7c61",
  D: "#23262b", E: "#7f9fd5", F: "#5f7597", H: "#201e1a", I: "#3f3d32",
}
save("guide", GUIDE, guide)

const GUIDE_HEAD = grid("guide-head", [
  "..aa.aa....",
  ".abcabcaa..",
  "acfbccbfca.",
  "afccfbcfba.",
  "abacfcfbca.",
  ".aaspeasa..",
  "..kspessa..",
  ".kSssssnk..",
  "..kssssk...",
  "...kkkk....",
  "...........",
])
save("guide-head", GUIDE_HEAD, guide)

// A bunny.
const BUNNY = grid("bunny", [
  "....o.o.....",
  "...oWoWo....",
  "...oWoWo....",
  "...oWWWoo...",
  "..ooWWWWWo..",
  ".oWWsWWWeWo.",
  "oWWWssWWWWo.",
  "oWsWWsWWWo..",
  ".oWWoWWoo...",
  "..oo.oo.....",
])
const bunny = { o: "#384261", W: "#f4faff", s: "#a8cfe7", e: "#16161c" }
save("bunny", BUNNY, bunny)

// The watch beside the time, among what the accessories tell you.
save(
  "clock",
  grid("clock", [
    "...ooooo...",
    "..oYYYYYo..",
    ".oYcccdcYo.",
    "oYccckccdYo",
    "oYccckcccYo",
    "oYccckkkcYo",
    "oYcccccccYo",
    "oYdcccccdYo",
    ".oYdcccdYo.",
    "..oYYYYYo..",
    "...ooooo...",
  ]),
  { o: "#5c4308", Y: "#dcc23e", c: "#fff6c8", d: "#eeda7a", k: "#4c2d08" },
)

// A sign on its post.
save(
  "sign",
  grid("sign", [
    ".ooooooooo.",
    "oLLLLLLLLLo",
    "oLkkLkkkLLo",
    "oWWWWWWWWWo",
    "oWkkkWkkWWo",
    "owwwwwwwwwo",
    ".ooooooooo.",
    "....owo....",
    "....owo....",
    "....owo....",
    "....ooo....",
  ]),
  { o: "#2d190e", L: "#b98a62", W: "#9a6c4e", w: "#735640", k: "#4a3222" },
)

// Done, and failed: marks in the game's outlined hand.
save(
  "check",
  grid("check", [
    "........oo.",
    ".......oGGo",
    "......oGGo.",
    ".oo..oGGo..",
    "oGGooGGo...",
    "oGGGGGo....",
    ".oGGGo.....",
    "..oGo......",
    "...o.......",
  ]),
  { o: "#0d3a1a", G: "#4be36a" },
)
save(
  "cross",
  grid("cross", [
    "oo.....oo",
    "oRo...oRo",
    ".oRo.oRo.",
    "..oRoRo..",
    "...oRo...",
    "..oRoRo..",
    ".oRo.oRo.",
    "oRo...oRo",
    "oo.....oo",
  ]),
  { o: "#4a0d16", R: "#ff4a5c" },
)

// One of the round gold buttons under the minimap.
save(
  "round",
  grid("round", [
    "...ooooo...",
    "..oLLLLLo..",
    ".oLDDDDDLo.",
    "oLDDDDDDDLo",
    "oLDDDDDDDLo",
    "oLDDDDDDDLo",
    "oLDDDDDDDLo",
    "oLDDDDDDDLo",
    ".oLDDDDDLo.",
    "..oLLLLLo..",
    "...ooooo...",
  ]),
  { o: "#45372c", L: "#dcb44a", D: "#a8842f" },
)

// The mark on the theme's card: a forest tree on its block of grass.
save(
  "mark",
  grid("mark", [
    "....oooooo......",
    "..ooGGGgGGoo....",
    ".oGgGGGGGgGGo...",
    "oGGGGgGGGGGgGo..",
    "oGgGGGGGgGGGGo..",
    "oGGGGgGGGGGgGo..",
    ".oGGgGGGGgGGo...",
    "..oooGGGGooo....",
    "....ktTTk.......",
    "....ktTTk..oo...",
    "...kktTTkkGGo...",
    "....ktTTk.oo....",
    "....ktTTk.......",
    "ABABktTTkBABABAB",
    "BDBBDDBDBBDBDDBB",
    "DdDDDdDDdDDDdDDd",
  ]),
  { o: "#045117", G: "#1d9247", g: "#2fb558", k: "#3c2d21", t: "#735640", T: "#9a6c4e", A: "#19d55f", B: "#18a04b", D: "#7e583e", d: "#5f4031" },
)

// A fallen star on its way down, sparks behind it.
{
  const cv = new Cv(26, 26)
  const trail = [[24, 1, "#f8ffba66"], [21, 3, "#f8ffba88"], [22, 6, "#f2dd4066"], [18, 5, "#f8ffbaaa"], [17, 9, "#f2dd4099"], [14, 8, "#f8ffbacc"], [13, 12, "#f2dd40cc"]]
  for (const [x, y, c] of trail) cv.put(x, y, c)
  cv.stamp(FALLEN, starYellow, 1, 13)
  cv.save("falling")
}

// Hearts in a row, for a measure that fills: one heart and its gap.
for (const [name, pal] of [["hearts", heartRed], ["hearts-empty", heartEmpty]]) {
  const cv = new Cv(12, 11)
  cv.stamp(HEART, pal, 0, 0)
  cv.save(name)
}

// ── Frames (nine-slice) ──────────────────────────────────────────────────
// A corner, drawn once and turned to the other three; an edge, from the
// outside in. The middle is the fill.
function frame(name, corner, edge, pal) {
  const s = corner.length
  const n = 2 * s + 2
  const cv = new Cv(n, n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const fx = x < s ? x : x >= n - s ? n - 1 - x : -1
      const fy = y < s ? y : y >= n - s ? n - 1 - y : -1
      const ch = fx >= 0 && fy >= 0 ? corner[fy][fx] : fy >= 0 ? edge[fy] : fx >= 0 ? edge[fx] : "F"
      cv.put(x, y, pal[ch])
    }
  cv.save(name)
}

const ROUND4 = grid("round4", ["..OO", ".OFF", "OFFF", "OFFF"])
const ROUND3 = grid("round3", [".OO", "OFF", "OFF"])
const ROUND5 = grid("round5", ["...OO", ".OOFF", ".OFFF", "OFFFF", "OFFFF"])
const RING4 = grid("ring4", ["..OO", ".OEE", "OEEF", "OEFF"])

// An NPC's dialogue box, a sign's.
frame("dialog", ROUND4, "OFFF", { O: "#24294b", F: "#4852ac" })
frame("dialog-focus", ROUND4, "OFFF", { O: "#fde521", F: "#4852ac" })
frame("dialog-bad", ROUND4, "OFFF", { O: "#ff4a5c", F: "#4852ac" })
// A menu's panel, and a row in it (a player, a world).
frame("menu", ROUND5, "OFFFF", { O: "#0a0d1e", F: "#2f3b6e" })
frame("row", ROUND4, "OFFF", { O: "#5665b4", F: "#394a8b" })
frame("row-hover", ROUND4, "OFFF", { O: "#fde521", F: "#4253a0" })
// A menu's button; gold round it under the pointer.
frame("button", ROUND4, "OFFF", { O: "#06081a", F: "#4a5b99" })
frame("button-hover", ROUND4, "OFFF", { O: "#fde521", F: "#5a6cb0" })
frame("button-off", ROUND4, "OFFF", { O: "#161a36", F: "#39426e" })
// One of Create World's choices, and the lighter box its words sit in.
frame("option", ROUND3, "OFF", { O: "#161a44", F: "#323975" })
frame("option-on", ROUND3, "OFF", { O: "#161a44", F: "#66709e" })
frame("note", ROUND4, "OFFF", { O: "#5b6699", F: "#5b6699" })
// An inventory slot; the one in hand.
frame("slot", ROUND3, "OFF", { O: "#1d2b6b", F: "#4246a2" })
frame("slot-light", ROUND3, "OFF", { O: "#1d2b6b", F: "#5b63c8" })
frame("gold", RING4, "OEFF", { O: "#281925", E: "#f7a605", F: "#fde521" })
// Fields let into a panel.
frame("field", ROUND3, "OFF", { O: "#0a0d1e", F: "#232c58" })

// The minimap's gold frame: dark, two golds, dark, and a block at each
// corner. Five squares thick; the corner's three more reach over the page.
frame(
  "map",
  grid("map", [
    ".ddddddd",
    "dLLLLLLL",
    "dLDLLLLL",
    "dLLDLDDD",
    "dLLLDLkk",
    "dLLDLLk.",
    "dLLDkkk.",
    "dLLDk...",
  ]),
  "dLLDk...",
  { d: "#45372c", L: "#c9a244", D: "#8d722b", k: "#2b2118", F: null },
)

// A hotbar slot whole: the outline, the fill, the battlements pressed into
// it a little way in. `n` squares a side.
function slot(n, pal) {
  const cv = new Cv(n, n)
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return false
    const fx = Math.min(x, n - 1 - x)
    const fy = Math.min(y, n - 1 - y)
    return fx + fy >= 2
  }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!inside(x, y)) continue
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      cv.put(x, y, edge ? pal.O : pal.F)
    }
  const a = 2
  const b = n - 3
  for (let i = a; i <= b; i++) {
    for (const [x, y] of [[i, a], [i, b], [a, i], [b, i]]) cv.put(x, y, pal.E)
    if (i >= a + 2 && i <= b - 2 && (i - a - 2) % 4 < 2) for (const [x, y] of [[i, a + 1], [i, b - 1], [a + 1, i], [b - 1, i]]) cv.put(x, y, pal.E)
  }
  return cv
}

const slotBlue = { O: "#171c65", F: "#3f46a8", E: "#5f72c4" }
const slotGold = { O: "#281925", F: "#fde521", E: "#f09a05" }
const slotBin = { O: "#22364a", F: "#55778f", E: "#6b8ba2" }
for (const n of [16, 18, 20]) {
  slot(n, slotBlue).save(`slot-${n}`)
  slot(n, slotGold).save(`gold-${n}`)
}
slot(18, slotBin).save("bin-18")

// ── The world ────────────────────────────────────────────────────────────

// Grass over dirt, as wide as you like; it tiles.
function ground(cv, x0, w, y, h, t, seed, blades = true) {
  const rnd = random(seed)
  const G1 = t("#19d55f")
  const G2 = t("#18a04b")
  const G3 = t("#0a6522")
  const D1 = t("#7e583e")
  const D2 = t("#986d53")
  const D3 = t("#5f4031")
  const D4 = t("#6b4b36")
  for (let i = 0; i < w; i++) {
    const x = x0 + i
    // Dirt, darker as it goes down.
    for (let j = 3; j < h; j++) cv.put(x, y + j, j > h - 5 ? D4 : D1)
    // Grass: a bright line, two rows of green, a ragged hem.
    cv.put(x, y, rnd() < 0.72 ? G1 : G2)
    cv.put(x, y + 1, G2)
    cv.put(x, y + 2, rnd() < 0.5 ? G2 : G3)
    const drip = Math.floor(rnd() * 4)
    for (let j = 0; j < drip && 3 + j < h; j++) cv.put(x, y + 3 + j, j === drip - 1 ? G3 : G2)
    if (blades && rnd() < 0.16) {
      cv.put(x, y - 1, G2)
      if (rnd() < 0.5) cv.put(x, y - 2, G1)
    }
  }
  // Clods and pebbles.
  for (let k = 0; k < (w * Math.max(0, h - 6)) / 9; k++) {
    const i = Math.floor(rnd() * w)
    const j = 6 + Math.floor(rnd() * Math.max(1, h - 6))
    const c = rnd() < 0.5 ? D2 : D3
    const len = 1 + Math.floor(rnd() * 2)
    for (let q = 0; q < len; q++) if (j < h) cv.put(x0 + ((i + q) % w), y + j, c)
  }
}

// A forest tree, as the game grows them: a straight trunk in bark, stubs of
// branch, and leaves in clumps — each a round top with fronds hanging under
// it — set by hand: one on each stub, a heap of them for the head.
const LEAVES = grid("leaves", [
  "....ooooo....",
  "..ooLLLLLoo..",
  ".oLLHLLLLLGo.",
  "oLLHLLLGLLGGo",
  "oLLLLGLLGLGGo",
  "oGLLGLLGLGGDo",
  "oGLGDLGDLGDGo",
  "oGDGoGDoGDoDo",
  "oDo.oDo.oDooo",
  ".o...o...o...",
])
const LEAVES_S = grid("leaves-s", [
  "..ooooo..",
  ".oLLLLGo.",
  "oLHLLGLGo",
  "oLLGLLGDo",
  "oGLGDGDGo",
  "oGDoGDoDo",
  "oDo.oo.o.",
  ".o.......",
])
const leaves = { o: "#042f0f", D: "#0d6b2c", G: "#1a9447", L: "#22b455", H: "#4fe884" }

// `x` is the trunk's left edge (seven squares with its outline), `clumps`
// where each clump of the head goes ([dx, dy] from the top of the trunk,
// back ones first), `stubs` the branches ([how far up, side, length]).
function tree(cv, x, base, h, t, seed, clumps, stubs) {
  const rnd = random(seed)
  const K = t("#3c2d21")
  const bark = [t("#b98a62"), t("#9a6c4e"), t("#9a6c4e"), t("#735640"), t("#563d29")]
  const top = base - h
  const pal = Object.fromEntries(Object.entries(leaves).map(([k, c]) => [k, t(c)]))
  // Bark: lighter towards the left, grain running down it in broken lines.
  const grain = [0, 0, 0, 0, 0]
  for (let y = top; y < base; y++) {
    cv.put(x, y, K)
    cv.put(x + 6, y, K)
    for (let i = 0; i < 5; i++) {
      if (rnd() < 0.22) grain[i] = grain[i] ? 0 : 1
      cv.put(x + 1 + i, y, grain[i] && i > 0 && i < 4 ? bark[Math.min(4, i + 1)] : bark[i])
    }
  }
  // Roots, spreading.
  for (const [dx, dy, c] of [[-1, -3, K], [-1, -2, bark[1]], [-1, -1, bark[1]], [-2, -2, K], [-2, -1, bark[3]], [-3, -1, K], [7, -3, K], [7, -2, bark[4]], [7, -1, bark[3]], [8, -2, K], [8, -1, bark[4]], [9, -1, K]]) cv.put(x + dx + (dx > 0 ? -1 : 1), base + dy, c)
  // Stubs: a limb going up and out, a clump at its end.
  for (const [up, side, len] of stubs) {
    const y0 = base - up
    for (let k = 0; k < len; k++) {
      const px = side < 0 ? x - 1 - k : x + 7 + k
      const py = y0 - Math.floor(k / 2)
      cv.put(px, py - 1, K)
      cv.put(px, py, bark[side < 0 ? 1 : 3])
      cv.put(px, py + 1, K)
    }
    const ex = side < 0 ? x - 1 - len : x + 7 + len
    const ey = y0 - Math.floor(len / 2)
    cv.stamp(LEAVES_S, pal, side < 0 ? ex - 6 : ex - 2, ey - 5, side > 0)
  }
  // The head.
  clumps.forEach(([dx, dy, flip]) => cv.stamp(LEAVES, pal, x + 3 + dx, top + dy, !!flip))
}

// A wooden fence.
function fence(cv, x, base, posts, t) {
  const O = t("#2b1317")
  const F1 = t("#9b7350")
  const F2 = t("#856043")
  const F3 = t("#6e4d36")
  const w = posts * 7 - 2
  for (const dy of [4, 8]) {
    cv.rect(x, base - dy - 1, w, 3, O)
    cv.rect(x, base - dy, w, 1, F3)
  }
  for (let k = 0; k < posts; k++) {
    const px = x + k * 7
    const tall = k % 2 === 0
    const h = tall ? 12 : 9
    cv.rect(px, base - h, 5, h, O)
    cv.rect(px + 1, base - h + 1, 3, h - 1, F2)
    cv.rect(px + 1, base - h + 1, 1, h - 1, F1)
    if (tall) {
      cv.rect(px + 1, base - h - 1, 3, 1, O)
      cv.clear(px, base - h)
      cv.clear(px + 4, base - h)
    }
  }
}

function sunflower(cv, x, base, t) {
  const S1 = t("#18a04b")
  const S2 = t("#0a6522")
  for (let j = 1; j <= 13; j++) cv.put(x, base - j, j % 3 === 0 ? S2 : S1)
  cv.rect(x - 2, base - 6, 2, 1, S1)
  cv.put(x - 3, base - 7, S1)
  cv.rect(x + 1, base - 9, 2, 1, S1)
  cv.put(x + 3, base - 10, S1)
  cv.stamp(["oYyYo", "YbBbY", "yBbBy", "YbBbY", "oYyYo"], { Y: t("#ebd224"), y: t("#e5bc0f"), B: t("#6b4b36"), b: t("#8b6b45") }, x - 2, base - 18)
}

// A house of wood, after the ones the game is shown with: its front open,
// the wall behind in darker planks; posts of stacked timber, a beam under a
// pitched roof of planks in a black outline; a window between two banners,
// torches, a bookcase, a chest, a panelled door; a brick chimney, smoking.
// `wb` blocks wide; `pitch` is how far the roof comes in for each row up.
function house(cv, x, base, wb, t, { who = false, pitch = 1 } = {}) {
  const W = wb * 8
  const IH = 26
  const O = t("#1b100c")
  const P1 = t("#ac8d78")
  const P2 = t("#8f6b55")
  const P3 = t("#6b4b36")
  const B1 = t("#5c4030", "in")
  const B2 = t("#49301f", "in")
  const B3 = t("#7b5a40", "in")
  const floorY = base - 4
  const ceilY = floorY - IH
  const eaveY = ceilY - 5
  const inner = (c) => t(c, "in")
  // Planks in an outline.
  const plank = (px, py) => {
    const row = ((py % 4) + 4) % 4
    return row === 3 ? P3 : row === 2 || (px * 7 + py * 3) % 13 < 3 ? P2 : P1
  }
  const planks = (px, py, w, h) => {
    cv.rect(px, py, w, h, O)
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) cv.put(px + i, py + j, plank(px + i, py + j))
  }
  // The wall behind, its boards.
  for (let y = ceilY; y < floorY; y++)
    for (let i = 5; i < W - 5; i++) cv.put(x + i, y, (y - ceilY) % 5 === 4 || ((x + i) * 5 + y * 3) % 17 === 0 ? B2 : B1)
  // A torch on it, the boards round it lit.
  const torch = (tx, ty) => {
    for (let j = -4; j <= 5; j++)
      for (let i = -4; i <= 4; i++) if (i * i + j * j <= 18 && [B1, B2].includes(cv.get(tx + i, ty + j))) cv.put(tx + i, ty + j, cv.get(tx + i, ty + j) === B2 ? B1 : B3)
    cv.rect(tx, ty + 2, 1, 4, inner("#7a5230"))
    cv.put(tx - 1, ty + 1, "#fd3e03")
    cv.put(tx + 1, ty + 1, "#fd3e03")
    cv.put(tx, ty + 1, "#fe7902")
    cv.put(tx - 1, ty, "#fe7902")
    cv.put(tx + 1, ty, "#fe7902")
    cv.put(tx, ty, "#fddd03")
    cv.put(tx, ty - 1, "#fe7902")
    cv.put(tx, ty + 1, "#fff3a0")
  }
  // A banner hung from the beam: blue, a gold device on it.
  const banner = (bx) => {
    cv.rect(bx, ceilY, 5, 13, inner("#0f2c46"))
    cv.rect(bx + 1, ceilY, 3, 12, inner("#1f6a9a"))
    cv.rect(bx + 1, ceilY, 1, 12, inner("#2a80b6"))
    cv.clear(bx, ceilY + 12)
    cv.clear(bx + 4, ceilY + 12)
    cv.put(bx, ceilY + 12, B1)
    cv.put(bx + 4, ceilY + 12, B1)
    for (const [i, j] of [[2, 3], [1, 4], [2, 4], [3, 4], [2, 5], [1, 6], [3, 6], [2, 7]]) cv.put(bx + i, ceilY + j, j > 5 ? "#e5bc0f" : "#f6d84a")
  }
  // The window between two of them.
  const wx = x + 13
  const wy = ceilY + 3
  cv.rect(wx, wy, 15, 12, O)
  cv.rect(wx + 1, wy + 1, 13, 10, t === day ? "#86b9ee" : "#131a44")
  if (t === day) {
    for (const [i, j] of [[2, 2], [3, 2], [4, 2], [2, 3], [2, 4], [10, 7], [11, 7], [11, 8], [7, 4]]) cv.put(wx + i, wy + j, j > 5 ? "#a9d0fa" : "#d2e9ff")
  } else {
    for (const [i, j, c] of [[3, 3, "#fff8b0"], [9, 6, "#a4b9ff"], [11, 2, "#ffffff"], [6, 8, "#ffffff"]]) cv.put(wx + i, wy + j, c)
  }
  banner(x + 7)
  banner(x + 29)
  // Books on their shelves.
  const kx = x + W - 18
  const ky = floorY - 14
  cv.rect(kx, ky, 12, 14, O)
  cv.rect(kx + 1, ky + 1, 10, 12, inner("#3a271b"))
  cv.rect(kx + 1, ky + 6, 10, 1, inner("#8f6b55"))
  cv.rect(kx + 1, ky + 12, 10, 1, inner("#8f6b55"))
  const spines = ["#c0392b", "#2e86c1", "#d4ac0d", "#27ae60", "#8e44ad", "#d35400", "#1abc9c", "#c0392b", "#f1c40f"]
  for (let i = 0; i < 9; i++) {
    cv.rect(kx + 1 + i, ky + 2 + (i % 3 === 1 ? 1 : 0), 1, 4 - (i % 3 === 1 ? 1 : 0), inner(spines[i]))
    if (i !== 4 && i !== 7) cv.rect(kx + 1 + i, ky + 8 + (i % 4 === 2 ? 1 : 0), 1, 4 - (i % 4 === 2 ? 1 : 0), inner(spines[(i + 4) % 9]))
  }
  torch(x + W - 12, ceilY + 4)
  torch(x + 37 > x + W - 20 ? x + 9 : x + 37, ceilY + 16)
  // A chest on the floor.
  cv.stamp(CHEST_S, Object.fromEntries(Object.entries(wood).map(([k, c]) => [k, inner(c)])), x + 7, floorY - 10)
  // Who lives here; or a table and a chair.
  const gx = kx - 15
  if (who) cv.stamp(GUIDE, Object.fromEntries(Object.entries(guide).map(([k, c]) => [k, inner(c)])), gx, floorY - 23)
  else {
    const tx = x + 20
    cv.rect(tx, floorY - 7, 11, 2, O)
    cv.rect(tx + 1, floorY - 7, 9, 1, inner("#ac8d78"))
    cv.rect(tx + 2, floorY - 5, 1, 5, inner("#6b4b36"))
    cv.rect(tx + 8, floorY - 5, 1, 5, inner("#6b4b36"))
    cv.rect(tx + 13, floorY - 11, 1, 11, inner("#6b4b36"))
    cv.rect(tx + 13, floorY - 5, 5, 1, inner("#8f6b55"))
    cv.rect(tx + 17, floorY - 4, 1, 4, inner("#6b4b36"))
  }
  // The frame: floor, posts, the beam under the eaves.
  planks(x - 1, floorY, W + 2, 5)
  planks(x, ceilY - 1, 6, IH + 2)
  planks(x + W - 6, ceilY - 1, 6, IH + 2 - 24)
  // The door, shut: two leaves of two panels.
  const dx = x + W - 7
  const dy = floorY - 25
  cv.rect(dx, dy, 7, 26, O)
  cv.rect(dx + 1, dy + 1, 5, 24, t("#b48a66"))
  cv.rect(dx + 1, dy + 1, 5, 1, t("#c79d78"))
  cv.rect(dx + 3, dy + 1, 1, 24, t("#7b5a40"))
  for (const py of [dy + 3, dy + 14]) {
    cv.rect(dx + 1, py, 2, 9, t("#946b4a"))
    cv.rect(dx + 4, py, 2, 9, t("#946b4a"))
    cv.rect(dx + 1, py, 1, 9, t("#a57c58"))
    cv.rect(dx + 4, py, 1, 9, t("#a57c58"))
  }
  cv.put(dx + 2, dy + 12, "#f0d060")
  // A chimney, its top above the ridge; the roof goes on in front of it.
  const roofW = W + 10
  const step = pitch === 1 ? 1 : 2
  const rows = Math.floor((roofW - 16) / (2 * step))
  const cx = x + W - 17
  const cy = eaveY - rows - 4
  cv.rect(cx, cy, 9, rows + 4, t("#232323"))
  for (let j = 1; j < rows + 4; j++)
    for (let i = 1; i < 8; i++) cv.put(cx + i, cy + j, j % 3 === 0 || (i + (Math.floor(j / 3) % 2) * 2) % 4 === 0 ? t("#5e5e5e") : i < 3 ? t("#9a9a9a") : t("#828282"))
  cv.rect(cx - 1, cy - 1, 11, 3, t("#232323"))
  cv.rect(cx, cy, 9, 1, t("#a8a8a8"))
  const smoke = t === day ? "#f4f6fa" : "#9aa0c0"
  for (const [i, j, a] of [[4, -3, "dd"], [5, -4, "dd"], [3, -5, "cc"], [4, -6, "bb"], [5, -6, "bb"], [6, -7, "aa"], [7, -8, "99"], [6, -9, "88"], [5, -10, "77"], [5, -11, "66"], [7, -12, "55"], [8, -12, "44"]]) cv.put(cx + i, cy + j, smoke + a)
  // The beam, and the roof on it: planks, coming in as they go up.
  planks(x - 5, eaveY, roofW, 6)
  for (let r = 1; r <= rows; r++) {
    const y = eaveY - r
    const left = x - 5 + r * step
    const right = x - 5 + roofW - 1 - r * step
    for (let px = left; px <= right; px++) {
      const edge = px < left + step || px > right - step || r === rows
      // Under the planks of a steep roof, the dark of the loft.
      const loft = pitch === 1 && px >= left + 7 && px <= right - 7 && r <= rows - 6
      cv.put(px, y, edge ? O : loft ? (((px * 5 + y * 3) % 17 === 0 || (y - eaveY) % 5 === 0) ? B2 : B1) : plank(px, y))
    }
    if (pitch === 1 && r <= rows - 6) {
      cv.put(left + 6, y, O)
      cv.put(right - 6, y, O)
    }
  }
  if (pitch === 1) {
    // The loft's round window.
    const mx = x + Math.floor(W / 2) - 3
    const my = eaveY - 8
    cv.rect(mx, my, 6, 6, O)
    cv.rect(mx + 1, my + 1, 4, 4, t === day ? "#86b9ee" : "#131a44")
    cv.put(mx + 1, my + 1, t === day ? "#d2e9ff" : "#fff8b0")
    for (let px = x - 5 + 7 + (rows - 6); px <= x - 5 + roofW - 8 - (rows - 6); px++) cv.put(px, eaveY - (rows - 5), O)
  }
}

const tinted = (pal, t) => Object.fromEntries(Object.entries(pal).map(([k, c]) => [k, t(c)]))

// What stands along the sidebar's foot: a tree, a fence with a sunflower, a
// bunny, a house. 130 squares wide (the sidebar is 260px), its last row the
// top of the grass.
for (const [suffix, t] of Object.entries(tones)) {
  const cv = new Cv(130, 58)
  const base = 58
  tree(cv, 12, base, 33, t, 7, [[-14, -6], [1, -7, 1], [-7, -12], [-10, -1], [-3, -3, 1]], [[13, -1, 5], [20, 1, 6]])
  fence(cv, 28, base, 6, t)
  sunflower(cv, 47, base, t)
  cv.stamp(BUNNY, tinted(bunny, t), 33, base - 10)
  house(cv, 75, base, 6, t, { pitch: 2 })
  cv.save(`surface${suffix}`)
}

// The same place, larger, for the page with no session open: the Guide at
// home, on an island in the sky.
for (const [suffix, t] of Object.entries(tones)) {
  const cv = new Cv(184, 100)
  const base = 84
  tree(cv, 20, base, 46, t, 3, [[-16, -5], [3, -6, 1], [-12, -13], [-1, -14, 1], [-6, -19], [-15, 1], [3, 2, 1], [-7, -3], [-4, -8, 1]], [[14, -1, 6], [22, 1, 7], [31, -1, 5]])
  tree(cv, 163, base, 31, t, 12, [[-13, -6], [0, -7, 1], [-7, -12], [-9, -1], [-3, -3, 1]], [[12, 1, 5], [19, -1, 6]])
  fence(cv, 36, base, 3, t)
  sunflower(cv, 44, base, t)
  sunflower(cv, 153, base, t)
  cv.stamp(BUNNY, tinted(bunny, t), 139, base - 10, true)
  house(cv, 66, base, 8, t, { who: true })
  ground(cv, 0, 184, base, 16, t, 21, false)
  // The earth under it tapers to its ends.
  const rnd = random(77)
  for (let x = 0; x < 184; x++) {
    const depth = Math.max(3, Math.round(16 * Math.pow(1 - Math.abs(x - 91.5) / 92, 0.42) - rnd() * 1.6))
    for (let j = depth; j < 16; j++) cv.clear(x, base + j)
    if (depth > 4) cv.put(x, base + depth - 1, t("#4a3226"))
  }
  cv.save(`home${suffix}`)
}

// The ground alone, to run along under them.
for (const [suffix, t] of Object.entries(tones)) {
  const cv = new Cv(96, 30)
  ground(cv, 0, 96, 2, 28, t, 5)
  cv.save(`ground${suffix}`)
  // A strip of turf, for a rule across the page.
  const turf = new Cv(96, 8)
  ground(turf, 0, 96, 2, 6, t, 9)
  turf.save(`turf${suffix}`)
}

// Far off, the forest's own backdrop as the game paints it: pale blue
// mountains, their faces lit and shaded in slanting strokes; a green-blue
// ridge before them; then firs in three ranks, each nearer and darker. It
// tiles sideways.
for (const [suffix, t] of Object.entries(tones)) {
  const W = 160
  const H = 64
  const cv = new Cv(W, H)
  const rnd = random(29)
  const wrap = (d) => ((((d + W / 2) % W) + W) % W) - W / 2
  const jitter = Array.from({ length: W }, () => (rnd() < 0.3 ? 1 : 0))
  // A range: the highest of its peaks at each column. A peak is where its
  // top is and how steeply it falls to the left and to the right.
  const range = (peaks, x) => {
    let best = null
    for (const [ax, ay, ls, rs] of peaks) {
      const d = wrap(x - ax)
      const y = ay + (d < 0 ? -d * ls : d * rs)
      if (!best || y < best.y) best = { y, d, ay }
    }
    return best
  }
  const far = [[26, 14, 0.62, 0.5], [78, 4, 0.72, 0.55], [128, 17, 0.5, 0.66], [152, 24, 0.4, 0.5]]
  const near = [[40, 31, 0.42, 0.34], [104, 34, 0.3, 0.4], [146, 37, 0.3, 0.3]]
  const M0 = t("#6896c9")
  const M1 = t("#6a9dce")
  const M2 = t("#75b2dd")
  const M3 = t("#5f8cc4")
  const R0 = t("#449990")
  const R1 = t("#52aab0")
  const R2 = t("#3b8884")
  for (let x = 0; x < W; x++) {
    const m = range(far, x)
    const top = Math.round(m.y) + jitter[x]
    for (let y = top; y < H; y++) {
      const depth = y - top
      // Strokes down the faces: light to the right of a peak, shade to its left.
      const lit = m.d >= 0 && depth < 16 && (((m.d - 0.55 * (y - m.ay)) % 9) + 9) % 9 < 3.4
      const dark = m.d < 0 && (((-m.d + 0.8 * (y - m.ay)) % 11) + 11) % 11 < 3.2
      cv.put(x, y, lit ? M2 : dark ? M3 : depth > 20 ? M0 : M1)
    }
    const r = range(near, x)
    const rtop = Math.round(r.y) + jitter[(x + 7) % W]
    for (let y = rtop; y < H; y++) {
      const lit = r.d >= 0 && y - rtop < 9 && (((r.d - 0.7 * (y - r.ay)) % 8) + 8) % 8 < 2.6
      const dark = r.d < 0 && (((-r.d + 0.9 * (y - r.ay)) % 10) + 10) % 10 < 2.6
      cv.put(x, y, lit ? R1 : dark ? R2 : R0)
    }
  }
  // A fir: tiers that widen downwards, needles in strokes across them.
  const fir = (cx, h, body, needle) => {
    const top = H - h
    for (let j = 0; j < h; j++) {
      const tier = j % 5
      const half = Math.floor(j * 0.21) + (tier >= 3 ? 1 : 0) + (tier === 4 ? 1 : 0)
      for (let i = -half; i <= half; i++) {
        const stroke = (tier === 2 || tier === 3) && ((i + j * 2 + cx) % 4 + 4) % 4 < 2 && Math.abs(i) > 0
        cv.put((((cx + i) % W) + W) % W, top + j, stroke ? needle : body)
      }
    }
  }
  for (const [cx, h] of [[6, 30], [24, 27], [43, 32], [61, 26], [79, 31], [98, 28], [116, 33], [134, 27], [151, 30]]) fir(cx, h, t("#3f8189"), t("#4b8f9b"))
  for (const [cx, h] of [[15, 22], [35, 25], [53, 21], [71, 24], [90, 22], [108, 26], [126, 21], [143, 24]]) fir(cx, h, t("#35786f"), t("#3f9482"))
  for (const [cx, h] of [[3, 15], [22, 18], [44, 14], [63, 19], [84, 15], [101, 18], [121, 14], [139, 17]]) fir(cx, h, t("#286f58"), t("#289260"))
  cv.rect(0, H - 4, W, 4, t("#286f58"))
  cv.save(`hills${suffix}`)
}

// Clouds, heaped by hand: each a row of lumps on a flat foot — white where
// the light falls, a line of blue under every lump, darker along the foot.
// At night the same heaps, dark, their tops caught by the moon.
for (const [suffix, c] of [
  ["", { light: "#ffffff", body: "#e6f1fa", line: "#c6e0f4", foot: "#a9cdef" }],
  ["-night", { light: "#7686cc", body: "#46539a", line: "#333f7c", foot: "#232b5c" }],
]) {
  const W = 160
  const H = 44
  const cv = new Cv(W, H)
  const heaps = [
    [34, 20, [[-16, 4], [-10, 6.5], [-2, 8.5], [8, 7], [15, 4.5]]],
    [100, 41, [[-21, 4], [-14, 6.5], [-5, 8.5], [5, 10], [14, 7], [21, 4.5]]],
    [143, 14, [[-8, 3.5], [-2, 5.5], [5, 4]]],
  ]
  for (const [cx, by, lumps] of heaps) {
    const m = new Cv(W, H)
    for (const [dx, r] of lumps) m.disc(cx + dx, by - r * 0.8, r * 1.15, r, "x")
    const inside = (x, y) => y < by && m.get(x, y)
    for (let y = 0; y < by; y++)
      for (let x = 0; x < W; x++) {
        if (!inside(x, y)) continue
        const lit = !inside(x, y - 1) || !inside(x, y - 2) || !inside(x - 1, y - 1)
        cv.put(x, y, y >= by - 2 ? c.foot : lit ? c.light : c.body)
      }
    // The line under each lump, where the next one begins.
    for (const [dx, r] of lumps) {
      const ox = cx + dx
      const oy = by - r * 0.8
      for (let a = 0.15; a < 1.45; a += 0.04) {
        const x = Math.round(ox + Math.cos(a) * (r * 1.15 - 1.2))
        const y = Math.round(oy + Math.sin(a) * (r - 1.2))
        if (inside(x, y) && inside(x + 2, y) && inside(x, y + 2) && y < by - 2 && cv.get(x, y) !== c.light) cv.put(x, y, c.line)
      }
    }
  }
  cv.save(`clouds${suffix}`)
}

// The edge of a bank of cloud: what hangs under the chat's head. As a mask
// (black), and in the page's own colour by day and at night.
for (const [name, colour] of [["cloudline", "#000000"], ["cloudline-day", "#e9eeff"], ["cloudline-night", "#1c2348"]]) {
  const W = 96
  const H = 8
  const cv = new Cv(W, H)
  const rnd = random(41)
  for (let x = 0; x < W; ) {
    const w = 5 + Math.floor(rnd() * 8)
    const h = 2 + Math.floor(rnd() * 5)
    for (let i = 0; i < w && x + i < W; i++) {
      const lift = i === 0 || i === w - 1 ? 2 : i === 1 || i === w - 2 ? 1 : 0
      for (let y = H - Math.max(1, h - lift); y < H; y++) cv.put(x + i, y, colour)
    }
    x += w
  }
  cv.save(name)
}

// The sun: a pale disc in its glow. The moon: grey seas on white.
{
  const cv = new Cv(40, 40)
  cv.disc(20, 20, 9.5, 9.5, "#f6ffcf")
  cv.disc(18.5, 18.5, 5.5, 5.5, "#fdffe8")
  cv.save(
    "sun",
    `<defs><radialGradient id="g"><stop offset="0.4" stop-color="#f6ffcf" stop-opacity="0.75"/><stop offset="1" stop-color="#f6ffcf" stop-opacity="0"/></radialGradient></defs><circle cx="20" cy="20" r="20" fill="url(#g)"/>`,
  )
  const moon = new Cv(40, 40)
  moon.disc(20, 20, 8.5, 8.5, "#aab3cc")
  moon.disc(19.3, 19.3, 7.8, 7.8, "#e8ecf5")
  moon.disc(16.5, 17, 2, 1.6, "#c3cade")
  moon.disc(22.5, 22, 2.6, 2, "#c3cade")
  moon.disc(22, 15, 1.2, 1, "#cfd6e6")
  moon.put(17, 24, "#c3cade")
  moon.save(
    "moon",
    `<defs><radialGradient id="g"><stop offset="0.4" stop-color="#c8d4ff" stop-opacity="0.35"/><stop offset="1" stop-color="#c8d4ff" stop-opacity="0"/></radialGradient></defs><circle cx="20" cy="20" r="20" fill="url(#g)"/>`,
  )
}

// Stars, for the night.
{
  const cv = new Cv(96, 96)
  const rnd = random(11)
  for (let i = 0; i < 22; i++) {
    const x = 2 + Math.floor(rnd() * 92)
    const y = 2 + Math.floor(rnd() * 92)
    const c = ["#ffffff", "#fff8b0", "#a4b9ff", "#ffffff"][i % 4] + (i % 3 === 0 ? "" : "aa")
    cv.put(x, y, c)
    if (i % 6 === 0) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cv.put(x + dx, y + dy, c.slice(0, 7) + "77")
  }
  cv.save("stars")
}
