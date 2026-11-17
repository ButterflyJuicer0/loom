import { pixels, random, sprite, write, writeSprite } from "./lib.mjs"

// ── 星露谷物语 (Stardew Valley) ───────────────────────────────────────────
// Every picture here is Loom's own pixel drawing, made after looking at the
// game: its menu frame and tabs, the dialogue box, the clock, the energy
// bar, the tools, a parsnip growing, a Junimo, the scarecrow, the farmhouse.
// The colours are sampled from screenshots; no pixel is copied.

// A canvas of squares, for what is easier to build than to type.
function canvas(w, h) {
  const px = Array.from({ length: h }, () => new Array(w).fill(null))
  const c = {
    w,
    h,
    put(x, y, colour) {
      if (colour && x >= 0 && x < w && y >= 0 && y < h) px[y][x] = colour
      return c
    },
    clear(x, y) {
      if (x >= 0 && x < w && y >= 0 && y < h) px[y][x] = null
      return c
    },
    get: (x, y) => (x >= 0 && x < w && y >= 0 && y < h ? px[y][x] : null),
    rect(x, y, rw, rh, colour) {
      for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) c.put(x + i, y + j, colour)
      return c
    },
    blit(rows, palette, ox = 0, oy = 0) {
      rows.forEach((row, y) => [...row].forEach((ch, x) => c.put(ox + x, oy + y, palette[ch])))
      return c
    },
    // Every colour through a function: night, a faded copy.
    map(fn) {
      for (const row of px) row.forEach((colour, x) => colour && (row[x] = fn(colour)))
      return c
    },
    body() {
      let s = ""
      px.forEach((row, y) => {
        for (let x = 0; x < w; ) {
          const colour = row[x]
          let n = 1
          while (x + n < w && row[x + n] === colour) n++
          if (colour) s += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${colour}"/>`
          x += n
        }
      })
      return s
    },
    save: (name) => write(name, sprite(w, h, c.body())),
  }
  return c
}

const check = (name, rows) => {
  const bad = rows.findIndex((row) => row.length !== rows[0].length)
  if (bad >= 0) throw new Error(`${name}: row ${bad} is ${rows[bad].length} wide, not ${rows[0].length}`)
  return rows
}

// Night in the valley: everything under a deep blue, as the game tints it.
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
const night = (colour) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16))
  return "#" + hex2(r * 0.4 + 12) + hex2(g * 0.44 + 16) + hex2(b * 0.56 + 50) + colour.slice(7)
}

// ── The wood of a menu ──────────────────────────────────────────────────
// Sampled from the dialogue box and the inventory: a dark maroon line, two
// browns, the orange and its highlight; parchment and its shade.
const WOOD = { K: "#5b2b2a", D: "#853605", M: "#b14e05", O: "#dc7b05", H: "#fa9405", N: "#9fb3ad" }
const WOOD_NIGHT = { K: "#170e2b", D: "#472033", M: "#6e3320", O: "#96561b", H: "#bd7a1e", N: "#7f8fb0" }

// The frame of a menu, as a border-image: rails five squares wide (top to
// bottom: dark, highlight, mid, dark, the maroon line; left to right the
// same with the maroon outside), and at each corner the head of a post with
// a nail in it.
function frame(name, p) {
  const s = 14
  const c = canvas(s, s)
  const across = [p.D, p.H, p.M, p.D, p.K]
  const down = [p.K, p.D, p.M, p.O, p.D]
  for (let i = 0; i < 5; i++) {
    c.rect(0, i, s, 1, across[i])
    c.rect(0, s - 5 + i, s, 1, across[i])
  }
  for (let i = 0; i < 5; i++) {
    c.rect(i, 0, 1, s, down[i])
    c.rect(s - 5 + i, 0, 1, s, [p.D, p.M, p.O, p.D, p.K][i])
  }
  const POST = check("post", ["KKKKK", "KHHOK", "KHNOK", "KOOMK", "KKKKK"])
  for (const [x, y] of [[0, 0], [s - 5, 0], [0, s - 5], [s - 5, s - 5]]) c.blit(POST, p, x, y)
  // The middle is left empty: the element's own ground shows there.
  for (let y = 5; y < s - 5; y++) for (let x = 5; x < s - 5; x++) c.clear(x, y)
  c.save(name)
}
frame("stardew-frame.svg", WOOD)
frame("stardew-frame-night.svg", WOOD_NIGHT)

// A thinner frame for what is small (a bubble, a card, a menu): the maroon
// line with its corner left out, the orange lit along the top, a brown line.
function box(name, p) {
  const BOX = check("box", [".KKKKKK.", "KHHHHHHK", "KODDDDOK", "KOD..DOK", "KOD..DOK", "KODDDDOK", "KMMMMMMK", ".KKKKKK."])
  writeSprite(name, BOX, p)
}
box("stardew-box.svg", WOOD)
box("stardew-box-night.svg", WOOD_NIGHT)

// A plank, for a heading's sign and a button: an outline, a lit top edge, a
// shaded foot.
function plank(name, p) {
  const PLANK = check("plank", [".KKKK.", "KHHHHK", "K....K", "K....K", "KSSSSK", ".KKKK."])
  writeSprite(name, PLANK, p)
}
plank("stardew-plank.svg", { K: "#5b2b2a", H: "#f2a04c", S: "#b25f33" })
plank("stardew-plank-night.svg", { K: "#170e2b", H: "#8a5a52", S: "#3d2334" })
// The same cut in parchment: the plate a name is written on.
plank("stardew-plate.svg", { K: "#5b2b2a", H: "#fff3c4", S: "#e4ae6e" })
plank("stardew-plate-night.svg", { K: "#170e2b", H: "#6a62a8", S: "#2a2752" })

// The boards behind a portrait, upright: seams, a little grain, a knot.
function planks(name, p) {
  const [W, H] = [48, 64]
  const c = canvas(W, H)
  const rnd = random(7)
  for (let x = 0; x < W; x += 12) {
    c.rect(x, 0, 1, H, p.seam)
    c.rect(x + 1, 0, 1, H, p.lit)
    for (let i = 0; i < 4; i++) {
      const gx = x + 3 + Math.floor(rnd() * 8)
      const gy = Math.floor(rnd() * H)
      const len = 3 + Math.floor(rnd() * 7)
      for (let j = 0; j < len; j++) c.put(gx, (gy + j) % H, i % 2 ? p.grain : p.lit)
    }
  }
  // Where one board ends and the next begins.
  c.rect(1, 20, 11, 1, p.seam).rect(25, 44, 11, 1, p.seam).rect(13, 57, 11, 1, p.seam).rect(37, 9, 11, 1, p.seam)
  c.blit(["gg", "gg"], { g: p.seam }, 30, 22)
  c.save(name)
}
planks("stardew-planks.svg", { seam: "#b25f3399", lit: "#f2943c66", grain: "#b25f3366" })
planks("stardew-planks-night.svg", { seam: "#1d123099", lit: "#5a3a5666", grain: "#1d123066" })

// ── A Junimo ────────────────────────────────────────────────────────────
// An apple of a body — wider than it is tall, a dimple at the crown where
// the stem and its leaf come out, shaded down one side — on two small feet,
// twig arms thrown up (one a little higher than the other), eyes far apart,
// cheeks. Three of them, in three of their colours.
const JUNIMO = check("junimo", [
  "................",
  ".......L......K.",
  "......KK......K.",
  ".K...KKKKKK...K.",
  ".K.KKLLLDGGKK.K.",
  ".K.KLLDDDDGGK.K.",
  ".KKLLGGGGGGGDKK.",
  "..KLGGGGGGGGDK..",
  "..KGGGGGGGGGDK..",
  "..KGGEGGGGEGDK..",
  "..KGGEGGGGEGDK..",
  "..KDCGGGGGGCDK..",
  "...KDGGGGGGDK...",
  "....KKDDDDKK....",
  "....KK....KK....",
  "................",
])
const JUNIMOS = {
  green: { K: "#043d0f", E: "#043d0f", G: "#47cb1b", L: "#8df033", D: "#32861c", C: "#a5e07a" },
  blue: { K: "#0c2a66", E: "#0c2a66", G: "#3d9bf5", L: "#8fd0ff", D: "#2a6fc4", C: "#a9dcff" },
  gold: { K: "#6b3a00", E: "#6b3a00", G: "#ffc21a", L: "#fff08a", D: "#d98a0b", C: "#ffe7a0" },
}
writeSprite("stardew-junimo.svg", JUNIMO, JUNIMOS.green)
writeSprite("stardew-junimo-blue.svg", JUNIMO, JUNIMOS.blue)
writeSprite("stardew-junimo-gold.svg", JUNIMO, JUNIMOS.gold)
writeSprite("stardew-mark.svg", JUNIMO, JUNIMOS.green)

// ── What a harvest is rated with, and what a friend is ───────────────────
writeSprite(
  "stardew-star.svg",
  check("star", ["....K....", "...KYK...", "KKKKYKKKK", "KYYYYYYYK", ".KSYYYSK.", "..KYYYK..", ".KYYSYYK.", ".KYSKSYK.", "KKKK.KKKK"]),
  { K: "#ae6200", Y: "#ffff18", S: "#efc90b" },
)
const HEART = check("heart", [".KK...KK.", "KRRK.KRRK", "KRLRKRRRK", "KRRRRRRRK", ".KRRRRRK.", "..KRRRK..", "...KRK...", "....K...."])
writeSprite("stardew-heart.svg", HEART, { K: "#63003e", R: "#dd003b", L: "#ff7a8a" })
writeSprite("stardew-heart-empty.svg", HEART, { K: "#63003e", R: "#63003e55", L: "#63003e55" })

// ── The tools ───────────────────────────────────────────────────────────
// A handle from the bottom left, the head at the top right, as they lie in
// the toolbar.
const TOOL = { a: "#3e1b00", d: "#70380e", g: "#944b06", h: "#bc6c09", c: "#3d353e", e: "#605459", m: "#898989", l: "#cccccc", w: "#efefef", k: "#141414" }
const TOOLS = {
  hoe: [
    "..............",
    "........cccc..",
    ".......cemmec.",
    "......cemddmlc",
    "......cmmmmllc",
    ".......ccemlwc",
    "......ada.cmlc",
    ".....ada...cc.",
    "....aga.......",
    "...aha........",
    "..aga.........",
    ".ada..........",
    "ada...........",
    "aa............",
  ],
  axe: [
    "..............",
    "........cc....",
    ".......ceecda.",
    ".......ceeeda.",
    "........ceeeec",
    ".......aaemmlc",
    "......adacmllc",
    ".....ada.cllc.",
    "....aga...cc..",
    "...aha........",
    "..aga.........",
    ".ada..........",
    "ada...........",
    "aa............",
  ],
  pick: [
    "..............",
    "...ccc........",
    "...cllccc.aa..",
    "....ccmlmcda..",
    "......ccmlc...",
    "........acmc..",
    ".......adacmc.",
    "......ada.clc.",
    ".....ada..cmc.",
    "....aga....clc",
    "...aha.....cmc",
    "..aga.......cc",
    ".ada..........",
    "aa............",
  ],
  can: [
    "..............",
    "...cccccc.....",
    "..cmkkkkmc..c.",
    "..cmlllmmc.cmc",
    ".ccemmlmmecmc.",
    "cmcemmmlmmmc..",
    "cm.emlmmmmec..",
    "cm.emmmmlmec..",
    "cmcemmlmmmec..",
    ".ccemmmmmmec..",
    "...ceeeeeec...",
    "....cccccc....",
    "..............",
    "..............",
  ],
  scythe: [
    ".....sss......",
    ".....snffs....",
    ".....asnfws...",
    ".....aa.sfws..",
    "....aga..sfws.",
    "....aha...sfws",
    "...aga.....sfs",
    "...ada.....sns",
    "..aga.......s.",
    "..ada.........",
    ".aga..........",
    ".ada..........",
    "aaa...........",
    "aa............",
  ],
}
// A fishing rod, for what is fetched from far off: a bamboo pole, its line
// back to the reel. And the magnifying glass, for what is read.
TOOLS.rod = [
  "............aa",
  "...........aba",
  "..........abaw",
  ".........aba.w",
  "........aba..w",
  ".......aba...w",
  "..cc..aba...w.",
  ".cllcaba...w..",
  ".clecba..ww...",
  "..ccdawww.....",
  "..ddda........",
  ".dDd..........",
  "dDd...........",
  "dd............",
]
TOOLS.lens = [
  ".....kkkkk....",
  "....kgggggk...",
  "...kgcCCCcgk..",
  "..kgcCCwCCcgk.",
  "..kgCCCCwCCgk.",
  "..kgCCCCCCCgk.",
  "..kgcCCCCCcgk.",
  "...kgcCCCcgk..",
  "..rrkgggggk...",
  ".rRrrkkkkk....",
  "rRPr..........",
  "rPRr..........",
  "rRr...........",
  ".r............",
]
const SCYTHE = { a: "#492d33", d: "#74433b", g: "#915628", h: "#bb8033", s: "#616172", n: "#8d8d96", f: "#bfbfbf", w: "#ffffff" }
const ROD = { a: "#7a4a00", b: "#d9a406", w: "#f0f0f0", c: "#3d353e", l: "#cccccc", e: "#605459", d: "#4c1418", D: "#8a3a36" }
const LENS = { k: "#2a2a2a", g: "#a5a5a5", c: "#2fb8a8", C: "#9dffe8", w: "#ffffff", r: "#6b0038", R: "#d8003c", P: "#ff6a5a" }
const PALETTES = { scythe: SCYTHE, rod: ROD, lens: LENS }
// By night a slot is dark, and a handle of dark wood is lost in it: the same
// tools with the wood and the iron's outline a few steps lighter.
const NIGHT_TOOLS = {
  hoe: { ...TOOL, a: "#8a5a2a", d: "#b07a3a", g: "#d09a4a", h: "#f0c070", c: "#6a6272" },
  axe: { ...TOOL, a: "#8a5a2a", d: "#b07a3a", g: "#d09a4a", h: "#f0c070", c: "#6a6272" },
  pick: { ...TOOL, a: "#8a5a2a", d: "#b07a3a", g: "#d09a4a", h: "#f0c070", c: "#6a6272" },
  can: { ...TOOL, c: "#6a6272", e: "#8a828a" },
  scythe: { ...SCYTHE, a: "#8f6a70", d: "#b58a7e", g: "#d6a868", h: "#f2cf8a", s: "#8a8aa0" },
  rod: { ...ROD, a: "#b07a1a", d: "#9a4a4e", D: "#c87a70", c: "#6a6272" },
  lens: { ...LENS, k: "#6a6272", r: "#b03060" },
}
for (const [name, rows] of Object.entries(TOOLS)) {
  writeSprite(`stardew-${name}.svg`, check(name, rows), PALETTES[name] ?? TOOL)
  writeSprite(`stardew-${name}-night.svg`, rows, NIGHT_TOOLS[name])
}

// The watering can at work, as it is held over a crop: leaning forward, the
// spout down and out to the right, the water falling from it — two frames
// side by side, the drops a step lower in the second.
{
  const POUR = check("pour", [
    "................",
    "....cccccc......",
    "...cmkkkkmc.....",
    "...cmlllmmc.....",
    "..ccemmlmmecc...",
    ".cmcemmmlmmmmcc.",
    ".cm.emlmmmmecmmc",
    ".cm.emmmmlmec.cc",
    ".cmcemmlmmmec...",
    "..ccemmmmmmec...",
    "....ceeeeeec....",
    ".....cccccc.....",
    "................",
    "................",
    "................",
    "................",
  ])
  const [W1, W2] = ["#3b9bff", "#a1edff"]
  const frames = [
    [[15, 8, W1], [14, 10, W2], [15, 12, W1], [13, 13, W2], [14, 15, W1]],
    [[14, 8, W2], [15, 9, W1], [14, 11, W1], [15, 13, W2], [13, 14, W1]],
  ]
  for (const [name, palette] of [["stardew-can-pour.svg", TOOL], ["stardew-can-pour-night.svg", NIGHT_TOOLS.can]]) {
    const strip = canvas(32, 16)
    frames.forEach((drops, i) => {
      strip.blit(POUR, palette, i * 16, 0)
      for (const [x, y, colour] of drops) strip.put(i * 16 + x, y, colour)
    })
    strip.save(name)
  }
}

// ── A parsnip, from seed to harvest ─────────────────────────────────────
const CROP = { g: "#04443c", G: "#3fc32a", L: "#9ce43c", b: "#5e3232", s: "#be7439", t: "#9c642488", w: "#483808", W: "#8a7a1c", Y: "#dccc44", P: "#e8ba57", p: "#fff6b0" }
const STAGES = {
  seeds: ["........", "........", "........", ".bb.....", ".bs..bb.", ".....bs.", "..bb....", "..bs...."],
  sprout: ["........", "........", ".g....g.", "gGg..gGg", ".gGggGg.", "..gGGg..", "...gg...", "...tt..."],
  leafy: ["..g..g..", ".gGggGg.", "gGLgGLGg", ".gGGGGg.", "g.gGGg.g", "gGgGGgGg", ".gggggg.", "...tt..."],
  ripe: [".g.gg.g.", "gGgGGgGg", "gGLGGLGg", ".gGGGGg.", "..gGGg..", "..bPPb..", "..bPpb..", "...bb..."],
  // Dead: gone olive and yellow, the leaves fallen flat to either side.
  wilted: ["........", "........", ".ww..ww.", "wYWwwWYw", ".wWWWWw.", "wYwWWwYw", ".w.ww.w.", "...tt..."],
}
// (Ripe is only ever seen as the last frame of the strip below, and on the farm.)
for (const [name, rows] of Object.entries(STAGES)) if (check(name, rows) && name !== "ripe") writeSprite(`stardew-crop-${name}.svg`, rows, CROP)
// Growing, three frames in a row: what a running session's dot is.
{
  const c = canvas(24, 8)
  ;["sprout", "leafy", "ripe"].forEach((name, i) => c.blit(STAGES[name], CROP, i * 8, 0))
  c.save("stardew-crop-grow.svg")
}

// The parsnip itself, out of the ground: a list's dot.
writeSprite(
  "stardew-parsnip.svg",
  check("parsnip", [
    "....gg....",
    "..g.gGg.g.",
    ".gGggGgGGg",
    ".gGGgLgGg.",
    "..gGGGGg..",
    "..bbggbb..",
    ".bPPPPPcb.",
    ".bPpPPccb.",
    "..bPPPcb..",
    "..bPPccb..",
    "...bPcb...",
    "....bb....",
  ]),
  { g: "#00391a", G: "#2fa40f", L: "#67c700", b: "#4c1f18", P: "#e8ba57", p: "#fff6b0", c: "#be7439" },
)

// ── Things about the farm ───────────────────────────────────────────────
writeSprite(
  "stardew-chicken.svg",
  check("chicken", [
    "........rr....",
    ".......rRRr...",
    ".......kwwkk..",
    "..k...kwwewyy.",
    ".kwk..kwwwwk..",
    "kwwwkkwwwwwk..",
    "kwswwwwwwwsk..",
    ".kwwwswwwwwk..",
    ".kswwwwwwwsk..",
    "..kswwwwssk...",
    "...kkkkkkk....",
    "....y...y.....",
    "...yy..yy.....",
  ]),
  { k: "#6b3710", w: "#ffe1ae", s: "#dda059", r: "#c22323", R: "#ff4e23", y: "#ffd921", e: "#3b1a05" },
)

writeSprite(
  "stardew-mail.svg",
  check("mail", [
    ".kkkkkkkkkkkk.",
    "kcwwwwwwwwwwck",
    "kwcwwwwwwwwcwk",
    "kwwcwwwwwwcwwk",
    "kwwwcwwwwcwwwk",
    "kwwwwccccwwwwk",
    "kwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwk",
    ".kkkkkkkkkkkk.",
  ]),
  { k: "#826665", w: "#fffae4", c: "#c4a993" },
)

// The game's cursor: a small arrow of tan wood with a dark edge, pointing up
// and to the left.
writeSprite(
  "stardew-cursor.svg",
  check("cursor", [
    "K........",
    "KK.......",
    "KLK......",
    "KLLK.....",
    "KLOLK....",
    "KLOOLK...",
    "KLOOOLK..",
    "KLOOOOLK.",
    "KLOODKKKK",
    "KLDKODK..",
    "KDK.KODK.",
    "KK..KODK.",
    ".....KK..",
  ]),
  { K: "#5b2408", L: "#e0a850", O: "#b87828", D: "#8a4a18" },
)

// "!" — something new to read.
writeSprite(
  "stardew-bang.svg",
  check("bang", [".KKK.", "KYLYK", "KYLYK", "KYYYK", "KYYYK", ".KYK.", ".KYK.", "..K..", ".KKK.", "KYLYK", ".KKK."]),
  { K: "#7a3b00", Y: "#ffd21a", L: "#fff59a" },
)

// "…" over a head: thinking.
{
  const BUBBLE = check("bubble", [
    ".kkkkkkkkkkkkk.",
    "kwwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwwk",
    "kwwwwwwwwwwwwwk",
    "kssssssssssssk.".replace(/.$/, "k"),
    ".kkkkkwwkkkkkk.",
    ".....kwk.......",
    "......k........",
  ])
  const p = { k: "#3c3c3c", w: "#fafafa", s: "#cfcfcf" }
  const one = (n) => {
    const c = canvas(15, 11).blit(BUBBLE, p)
    for (let i = 0; i < n; i++) c.rect(3 + i * 4, 4, 2, 2, "#3c3c3c")
    return c
  }
  one(3).save("stardew-dots.svg")
}

// The dial of the clock: day on one side, night coming on the other, the sun.
writeSprite(
  "stardew-dial.svg",
  check("dial", [
    "....kkkk....",
    "..kkOOOOkk..",
    ".kObbbnnnOk.",
    ".kbbbbbnnnk.",
    "kObbybbbnnOk",
    "kObyyybbbnOk",
    "kOccycccccOk",
    "kOccccccccOk",
    ".kccccccwck.",
    ".kOccccccOk.",
    "..kkOOOOkk..",
    "....kkkk....",
  ]),
  { k: "#5b2b2a", O: "#dc7b05", b: "#84c1ff", c: "#a1edff", n: "#656a89", y: "#fff000", w: "#ffffff" },
)

// The energy bar's cap, with its "E". The bar itself is drawn by the
// stylesheet, as long as what is left of the context.
writeSprite("stardew-energy-cap.svg", check("cap", ["DOYYYO", "DOYOOO", "DOYYOO", "DOYOOO", "DOYYYO"]), { D: "#853605", O: "#dc7b05", Y: "#fbf900" })

// An arrow, for going down to the latest.
writeSprite(
  "stardew-arrow.svg",
  check("arrow", [
    "...kkkkk...",
    "...kHOOk...",
    "...kHOOk...",
    "kkkkHOOkkkk",
    "kHHHOOOOODk",
    ".kHOOOOODk.",
    "..kHOOODk..",
    "...kHODk...",
    "....kOk....",
    ".....k.....",
  ]),
  { k: "#5b2b2a", H: "#fa9405", O: "#dc7b05", D: "#b14e05" },
)

// Yes, and no.
writeSprite(
  "stardew-ok.svg",
  check("ok", [".........kk", "........kGk", ".......kGLk", "kk....kGGk.", "kGk..kGGk..", "kGLkkGGk...", ".kGGGGk....", "..kGGk.....", "...kk......"]),
  { k: "#0b5a12", G: "#35d32f", L: "#9af07a" },
)
writeSprite(
  "stardew-no.svg",
  check("no", ["kk.....kk", "kRk...kRk", ".kRk.kRk.", "..kRkRk..", "...kRk...", "..kRkRk..", ".kRk.kRk.", "kRk...kRk", "kk.....kk"]),
  { k: "#7a0f0f", R: "#f0392b" },
)

// A stardrop: what raises your energy.
writeSprite(
  "stardew-stardrop.svg",
  check("stardrop", [
    "..gg....gg..",
    ".gtg....gtg.",
    ".g.gk..kg.g.",
    "....kppk....",
    "...kpPPpk...",
    "kkkkpPPpkkkk",
    "kpPppPPppPpk",
    ".kpPPppPPpk.",
    "..kpPPPPpk..",
    "..kpPppPpk..",
    ".kpPpkkpPpk.",
    ".kkkk..kkkk.",
  ]),
  { g: "#27504d", t: "#1cff96", k: "#2a0a84", p: "#801fe2", P: "#db67c4" },
)

// ── The tabs along the top of the menu ──────────────────────────────────
// A tab with a rounded top and what it opens drawn on it.
const TAB = check("tab", [
  "..KKKKKKKKKK..",
  ".KOOOOOOOOOOK.",
  "KOOPPPPPPPPOOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOPPPPPPPPPPOK",
  "KOSSSSSSSSSSOK",
  "KKKKKKKKKKKKKK",
])
const ICONS = {
  pack: [
    ["..kkkkkk..", ".kRRRRRRk.", "kRRLLLLRRk", "kRRRRRRRRk", "kddddyyddk", "kRRRRyyRRk", "kRRRRRRRRk", "kRLRRRRRRk", ".kRRRRRRk.", "..kkkkkk.."],
    { k: "#63003e", R: "#dd003b", L: "#ff6a5a", d: "#8f0030", y: "#ffd84a" },
  ],
  heart: [
    ["..........", ".kk....kk.", "kRRk..kRRk", "kRLRkkRRRk", "kRRRRRRRRk", "kRRRRRRRRk", ".kRRRRRRk.", "..kRRRRk..", "...kRRk...", "....kk...."],
    { k: "#63003e", R: "#dd003b", L: "#ff7a8a" },
  ],
  map: [
    ["kkkkkkkkkk", "kwwwwwwwwk", "kwggbbggwk", "kwgggbbgwk", "kwggbbggwk", "kwgbbgggwk", "kwbbggggwk", "kwbbbgggwk", "kwwwwwwwwk", "kkkkkkkkkk"],
    { k: "#9a7a4a", w: "#fff8e0", g: "#4fae2f", b: "#3b9bff" },
  ],
  hammer: [
    ["..........", ".kkkkkkkk.", "kmmllmmmmk", "kmmmmmmmek", ".kkkbhkkk.", "....bh....", "....bh....", "....bh....", "....bh....", "....bb...."],
    { k: "#3d353e", m: "#898989", l: "#cccccc", e: "#605459", b: "#3e1b00", h: "#944b06" },
  ],
  pad: [
    ["....kk....", "....kk....", ".kkkkkkkk.", "kmmmmmmmmk", "kmdmmmmrmk", "kdddmmymbk", "kmdmmmmgmk", "kmmkkkkmmk", "kmk....kmk", ".k......k."],
    { k: "#4a4a52", m: "#8d9293", d: "#3a3a40", r: "#e0241a", y: "#ffd800", b: "#3b6bff", g: "#2fb82f" },
  ],
  calendar: [
    ["kkkkkkkkkk", "krrrrrrrrk", "krrrrrrrrk", "kwwwwwwwwk", "kwdwdwdwwk", "kwwwwwwwwk", "kwdwRwdwwk", "kwwwwwwwwk", "kwdwdwdwwk", "kkkkkkkkkk"],
    { k: "#5b2b2a", r: "#d8281e", w: "#fff8e0", d: "#b79a78", R: "#d8281e" },
  ],
}
for (const [name, [rows, palette]] of Object.entries(ICONS)) {
  check(name, rows)
  canvas(14, 14).blit(TAB, { K: "#5b2b2a", O: "#dc7b05", P: "#ffd284", S: "#e4ae6e" }).blit(rows, palette, 2, 2).save(`stardew-tab-${name}.svg`)
  // On their own too, where there is no tab to draw them on.
  if (name === "pack" || name === "calendar") writeSprite(`stardew-icon-${name}.svg`, rows, palette)
}

// ── The farmer, in a portrait's frame ───────────────────────────────────
{
  const FACE = check("farmer", [
    "pppppppppppp",
    "ppphhhhhhppp",
    "pphHHhhhhhpp",
    "pphhhhhhhhpp",
    "pphsssssshpp",
    "pphsesseshpp",
    "ppsssssssspp",
    "pppssmmssppp",
    "ppprssssrppp",
    "pprrbrrbrrpp",
    "prrrbbbbrrrp",
    "prrrbbbbrrrp",
  ])
  const c = canvas(16, 16)
  c.rect(0, 0, 16, 16, "#5b2b2a").rect(1, 1, 14, 14, "#dc7b05").rect(1, 1, 14, 1, "#fa9405").rect(2, 2, 12, 12, "#daad72")
  c.blit(FACE, { p: "#daad72", h: "#6a2f10", H: "#a5571c", s: "#f9c9a0", e: "#2a1408", m: "#c9605a", r: "#c8281e", b: "#3f60a8" }, 2, 2)
  c.save("stardew-farmer.svg")
}

// ── A fence, for a rule across the page ─────────────────────────────────
const FENCE = check("fence", [
  ".kk.........",
  "khwk........",
  "khwk........",
  "khwkkkkkkkkk",
  "khwkhhhhhhhh",
  "khwkwwwwwwww",
  "khwkkkkkkkkk",
  "khwk........",
  "khwkkkkkkkkk",
  "khwkhhhhhhhh",
  "khwkwwwwwwww",
  "khwkkkkkkkkk",
  "khwk........",
  "kkkk........",
])
const FENCE_DAY = { k: "#4c1c14", h: "#c47c2c", w: "#a45c24" }
writeSprite("stardew-fence.svg", FENCE, FENCE_DAY)
writeSprite("stardew-fence-night.svg", FENCE, Object.fromEntries(Object.entries(FENCE_DAY).map(([k, v]) => [k, night(v)])))

// ── The scarecrow ───────────────────────────────────────────────────────
const SCARECROW = check("scarecrow", [
  "....kkkkkk....",
  "...khhhhhhk...",
  ".kkkhnnnnhkkk.",
  "khhyhhhhhhyhhk",
  ".kkkkkkkkkkkk.",
  "...kppppppk...",
  "...kpeppepk...",
  "...kppmmppk...",
  ".kkkkrrrrkkkk.",
  "kyorrrrrrrroyk",
  "kyorrbrrbrroyk",
  ".kkkrbbbbrkkk.",
  "...kbbbbbbk...",
  "...kbblbbbk...",
  "...kbbbbbbk...",
  "...kbbkkbbk...",
  "....kkwwkk....",
  "......ww......",
  "......ww......",
  "......ww......",
  "......ww......",
])
const SCARECROW_P = { k: "#3a1a05", h: "#ce7829", n: "#ffb032", y: "#ffb032", p: "#f7c5c5", e: "#882f2b", m: "#fc746d", r: "#f37734", o: "#96182b", b: "#3f60a8", l: "#6c8fdd", w: "#874d27" }

// ── Ground: grass with tufts, tilled soil ───────────────────────────────
const GRASS = { base: "#74c42c", dark: "#5ca43c", lit: "#9ce43c", edge: "#3f8a2c" }
const SOIL = { base: "#b46c2c", dark: "#9c5a24", lit: "#c98440" }

function grass(c, x0, y0, w, h, seed, top = true) {
  const rnd = random(seed)
  for (let x = x0; x < x0 + w; x++) {
    // The top edge is blades, not a line.
    const lift = top ? [0, 1, 0, 2, 1, 0, 1, 3, 0, 1][(x * 7 + seed) % 10] : 0
    for (let y = y0 - lift; y < y0 + h; y++) c.put(x, y, y < y0 + 1 - lift + 0 && top ? GRASS.edge : GRASS.base)
  }
  for (let i = 0; i < (w * h) / 26; i++) {
    const x = x0 + Math.floor(rnd() * (w - 2))
    const y = y0 + 3 + Math.floor(rnd() * Math.max(1, h - 5))
    const colour = i % 3 ? GRASS.dark : GRASS.lit
    c.put(x, y, colour).put(x + 1, y - 1, colour)
    if (i % 4 === 0) c.put(x + 2, y, colour)
  }
}

function soil(c, x0, y0, w, h) {
  c.rect(x0, y0, w, h, SOIL.base)
  c.rect(x0, y0, w, 1, SOIL.dark).rect(x0, y0 + h - 1, w, 1, SOIL.dark)
  // Furrows.
  for (let y = y0 + 2; y < y0 + h - 1; y += 3) for (let x = x0 + 1; x < x0 + w - 1; x++) if ((x + y) % 5) c.put(x, y, (x + y) % 2 ? SOIL.dark : SOIL.lit)
  for (const [x, y] of [[x0, y0], [x0 + w - 1, y0], [x0, y0 + h - 1], [x0 + w - 1, y0 + h - 1]]) c.clear(x, y).put(x, y, GRASS.base)
}

// The farmhouse: a red roof, upright boards, a window with shutters, a door.
function house(c, x0, y0, lit) {
  const R = { r: "#d0432a", d: "#8f1f12", h: "#f06a4a", k: "#4c1414" }
  // Roof: a gable, wider towards the eaves, in courses of tiles.
  for (let y = 0; y < 12; y++) {
    const inset = Math.max(0, 5 - Math.floor(y / 2))
    for (let x = inset; x < 40 - inset; x++) {
      const edge = x === inset || x === 39 - inset || y === 0
      const course = y % 3 === 2
      c.put(x0 + x, y0 + y, edge ? R.k : course ? R.d : (x + Math.floor(y / 3) * 2) % 4 === 0 ? R.d : y % 3 === 0 ? R.h : R.r)
    }
  }
  c.rect(x0, y0 + 12, 40, 1, R.k)
  // Walls.
  for (let x = 3; x < 37; x++) for (let y = 13; y < 27; y++) c.put(x0 + x, y0 + y, x === 3 || x === 36 ? "#5b2b2a" : y === 13 ? "#b25f33" : (x - 3) % 4 === 0 ? "#b25f33" : (x - 3) % 4 === 1 ? "#f2943c" : "#d88239")
  // The window, with its shutters.
  c.rect(x0 + 7, y0 + 15, 12, 8, "#5b2b2a")
  c.rect(x0 + 8, y0 + 16, 2, 6, "#6aa84f").rect(x0 + 16, y0 + 16, 2, 6, "#6aa84f")
  c.rect(x0 + 10, y0 + 16, 6, 6, lit ? "#ffe27a" : "#84c1ff")
  c.rect(x0 + 12, y0 + 16, 1, 6, lit ? "#f0a030" : "#e7f6ff").rect(x0 + 10, y0 + 18, 6, 1, lit ? "#f0a030" : "#e7f6ff")
  if (!lit) c.put(x0 + 10, y0 + 16, "#ffffff").put(x0 + 11, y0 + 17, "#ffffff")
  // The door.
  c.rect(x0 + 23, y0 + 15, 9, 12, "#5b2b2a").rect(x0 + 24, y0 + 16, 7, 11, "#c9772e").rect(x0 + 24, y0 + 16, 1, 11, "#e39a4f")
  c.rect(x0 + 26, y0 + 18, 3, 3, lit ? "#ffe27a" : "#84c1ff").put(x0 + 29, y0 + 22, "#ffd84a")
  // The step.
  c.rect(x0 + 21, y0 + 27, 13, 2, "#8a6a5a").rect(x0 + 21, y0 + 27, 13, 1, "#b79a88")
  c.rect(x0 + 3, y0 + 27, 18, 1, "#5b2b2a").rect(x0 + 34, y0 + 27, 3, 1, "#5b2b2a")
}

// The foot of the sidebar: the corner of a farm, in pieces, so that it keeps
// its size and its pixels whatever the sidebar's width — the house and its
// path stand at the right with the scarecrow beside them, a plot of parsnips
// at the left, a fence runs along the back and grass along the foot.
// By night the same under blue, the lamp in the house lit.
const FARM = { h: 74, ground: 30 }
for (const dark of [false, true]) {
  const tag = dark ? "-night" : ""
  const { h: H, ground } = FARM

  // The house, and the scarecrow beside it: one piece, so that a narrow
  // sidebar never puts one on top of the other.
  const home = canvas(66, H)
  const hx = 24
  house(home, hx, ground - 27, false)
  for (let y = ground + 2; y < H; y++) for (let x = hx + 22 - Math.floor((y - ground) / 3); x < hx + 32 - Math.floor((y - ground) / 4); x++) home.put(x, y, (x + y) % 7 === 0 ? "#e4a424" : "#ecac24")
  home.blit(SCARECROW, SCARECROW_P, 2, ground - 16)
  home.rect(5, ground + 5, 8, 1, "#3f8a2c")
  if (dark) {
    home.map(night)
    const lit = canvas(66, H)
    house(lit, hx, ground - 27, true)
    for (const [x, y, w, h] of [[hx + 10, ground - 11, 6, 6], [hx + 26, ground - 9, 3, 3]]) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) home.put(x + i, y + j, lit.get(x + i, y + j))
  }
  home.save(`stardew-farm-house${tag}.svg`)

  const plot = canvas(54, H)
  soil(plot, 6, ground + 4, 46, 13)
  ;["seeds", "sprout", "leafy", "ripe", "leafy"].forEach((stage, i) => plot.blit(STAGES[stage], { ...CROP, t: null }, 9 + i * 8, ground + 3 + (i % 2)))
  if (dark) plot.map(night)
  plot.save(`stardew-farm-plot${tag}.svg`)

  // Grass that tiles sideways, blades along its top edge.
  const turf = canvas(40, H - ground + 3)
  grass(turf, 0, 3, 40, H - ground, 5)
  if (dark) turf.map(night)
  turf.save(`stardew-grass${tag}.svg`)
}

// No session open: the scarecrow keeping a row of parsnips, seed to harvest.
{
  const [W, H] = [72, 40]
  const c = canvas(W, H)
  grass(c, 2, 20, W - 4, 18, 9)
  for (const [x, y] of [[2, 20], [3, 20], [2, 21], [W - 3, 20], [W - 4, 20], [W - 3, 21], [2, 37], [3, 37], [2, 36], [W - 3, 37], [W - 4, 37], [W - 3, 36]]) c.clear(x, y)
  for (let y = 17; y < 20; y++) for (let x = 2; x < 4; x++) c.clear(x, y)
  soil(c, 8, 24, 56, 10)
  ;["seeds", "sprout", "leafy", "ripe", "ripe", "leafy"].forEach((stage, i) => c.blit(STAGES[stage], { ...CROP, t: null }, 11 + i * 9, 22 + (i % 2)))
  c.blit(SCARECROW, SCARECROW_P, 29, 2)
  c.save("stardew-plot.svg")
}

// ── The sky of the title screen ─────────────────────────────────────────
const CLOUD = check("cloud", [
  "......wwww............",
  "....wwwwwwww....www...",
  "..wwwwwwwwwwww.wwwww..",
  ".wwwwwwwwwwwwwwwwwwww.",
  "wwwwwwwwwwwwwwwwwwwwww",
  "wwwwwwwwwwwwwwwwwwwwww",
  "ssswwwwwwwwwwwwwwwwsss",
  ".sssssssswwwwssssssss.",
  "...ssssssssssssssss...",
])
const CLOUD_SMALL = check("cloud-small", ["...www......", ".wwwwwww.ww.", "wwwwwwwwwwww", "sswwwwwwwwss", ".ssssssssss."])
for (const [name, palette] of [
  ["stardew-clouds.svg", { w: "#ffffff", s: "#cdeeff" }],
  ["stardew-clouds-night.svg", { w: "#3a3f78", s: "#2a2d5e" }],
]) {
  canvas(140, 44).blit(CLOUD, palette, 8, 4).blit(CLOUD_SMALL, palette, 62, 24).blit(CLOUD, palette, 100, 12).blit(CLOUD_SMALL, palette, 30, 34).save(name)
}

// Hills and a line of trees along the foot of the title screen; tiles sideways.
function hills(name, p) {
  const [W, H] = [160, 56]
  const c = canvas(W, H)
  const rnd = random(21)
  for (let x = 0; x < W; x++) {
    const far = Math.round(18 - 9 * Math.sin((2 * Math.PI * x) / W + 1) - 4 * Math.sin((6 * Math.PI * x) / W))
    for (let y = far; y < H; y++) c.put(x, y, y < far + 2 ? p.farLit : p.far)
    const near = Math.round(32 - 5 * Math.sin((4 * Math.PI * x) / W + 2.2) - 2 * Math.sin((10 * Math.PI * x) / W))
    for (let y = near; y < H; y++) c.put(x, y, y < near + 1 ? p.nearLit : p.near)
  }
  // Round trees along the front.
  for (let i = 0; i < 12; i++) {
    const cx = Math.round(i * (W / 12) + rnd() * 6)
    const r = 5 + Math.floor(rnd() * 3)
    const cy = 44 - Math.floor(rnd() * 3)
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue
        const lit = dx + dy < -r * 0.6
        c.put((((cx + dx) % W) + W) % W, cy + dy, lit ? p.treeLit : dx + dy > r * 0.7 ? p.treeDark : p.tree)
      }
    }
    c.rect(((cx % W) + W) % W, cy + r, 1, 4, p.trunk)
  }
  for (let x = 0; x < W; x++) for (let y = 50; y < H; y++) c.put(x, y, y === 50 ? p.grassLit : p.grass)
  c.save(name)
}
hills("stardew-hills.svg", { far: "#6fb7d9", farLit: "#9fd6ea", near: "#4f9a6a", nearLit: "#7cc27a", tree: "#2f8f2f", treeLit: "#74c42c", treeDark: "#1f6a2f", trunk: "#5b2b2a", grass: "#74c42c", grassLit: "#9ce43c" })
hills("stardew-hills-night.svg", { far: "#1c2466", farLit: "#2a3486", near: "#152a52", nearLit: "#1f3a66", tree: "#10304a", treeLit: "#1f4a5e", treeDark: "#0a1f3a", trunk: "#170e2b", grass: "#173a4a", grassLit: "#245a5a" })

// Stars for the night sky, and fireflies over the grass: a tile of each.
{
  const rnd = random(13)
  const c = canvas(96, 96)
  for (let i = 0; i < 18; i++) {
    const [x, y] = [Math.floor(rnd() * 94) + 1, Math.floor(rnd() * 94) + 1]
    const colour = ["#ffffff", "#ffe9bf", "#9fb4ff"][i % 3]
    c.put(x, y, colour)
    if (i % 6 === 0) c.put(x - 1, y, colour + "99").put(x + 1, y, colour + "99").put(x, y - 1, colour + "99").put(x, y + 1, colour + "99")
  }
  c.save("stardew-stars.svg")
  const f = canvas(64, 40)
  for (const [x, y] of [[6, 8], [22, 27], [35, 5], [49, 19], [58, 33], [14, 34]]) {
    f.put(x, y, "#f6ff8a")
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) f.put(x + dx, y + dy, "#c8f04a77")
  }
  f.save("stardew-fireflies.svg")
}
