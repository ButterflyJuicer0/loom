import { random, sprite, write } from "./lib.mjs"

// ── 以撒 (The Binding of Isaac: Rebirth) ─────────────────────────────────
// Pixel art, redrawn square by square after the game's own screens: the HUD
// in the corner (hearts, the coin / bomb / key counters, the active item and
// its charge bar, the map), Isaac, a fly, rocks and poop, the stone an item
// stands on, the doors and walls of a basement room, the black brush-stroke
// an item's name is written on, a boss's bar and skull, and the pinned paper
// its menus are written on. Nothing is copied from the game's files.

// A picture is a grid of colours (null = nothing). Sprites are written as
// rows of characters and a palette; the rest is drawn by rule.
const grid = (w, h, fill = null) => Array.from({ length: h }, () => new Array(w).fill(fill))
function paint(name, rows, palette) {
  const bad = rows.findIndex((row) => row.length !== rows[0].length)
  if (bad >= 0) throw new Error(`${name}: row ${bad} is ${rows[bad].length} wide, not ${rows[0].length}`)
  return rows.map((row) => [...row].map((c) => palette[c] ?? null))
}
function rects(g, ox = 0, oy = 0) {
  let s = ""
  g.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const c = row[x]
      let n = 1
      while (x + n < row.length && row[x + n] === c) n++
      if (c) s += `<rect x="${ox + x}" y="${oy + y}" width="${n}" height="1" fill="${c}"/>`
      x += n
    }
  })
  return s
}
const save = (name, g) => write(`isaac-${name}.svg`, sprite(g[0].length, g.length, rects(g)))
const draw = (name, rows, palette) => {
  const g = paint(name, rows, palette)
  save(name, g)
  return g
}
// A quarter turn clockwise, and the mirror images.
const turn = (g) => g[0].map((_, x) => g.map((row) => row[x]).reverse())
const flipX = (g) => g.map((row) => [...row].reverse())
const flipY = (g) => [...g].reverse()
// One picture onto another.
function stamp(onto, g, ox, oy) {
  g.forEach((row, y) => row.forEach((c, x) => {
    if (c && onto[oy + y] && ox + x >= 0 && ox + x < onto[0].length) onto[oy + y][ox + x] = c
  }))
  return onto
}

const K = "#0a0404" // the outline everything in the game wears

// ── Isaac ────────────────────────────────────────────────────────────────
// 28 × 33 as in the game: a head as wide as he is, eyes that are holes with
// one white square each, a mouth of teeth, tears down both cheeks, a body
// that is hardly there.
const SKIN = { K, S: "#e6c8c8", s: "#d0a0a0", d: "#b87878", W: "#ffffff", T: "#a4d4d8", t: "#6a9ea6" }
const ISAAC = [
  "..........KKKKKKKK..........",
  "........KKKKKKKKKKKK........",
  "......KKKKssssssssKKKK......",
  ".....KKKsSSSSSSSSSSsKKK.....",
  "....KKsSSSSSSSSSSSSSSsKK....",
  "...KKsSSSSSSSSSSSSSSSSsKK...",
  "..KKsSSSSSSSSSSSSSSSSSSsKK..",
  "..KKSSSSSSSSSSSSSSSSSSSSKK..",
  ".KKsSSSSSSSSSSSSSSSSSSSSsKK.",
  ".KKSSSSSSSSSSSSSSSSSSSSSSKK.",
  "KKsSSSSSSSSSSSSSSSSSSSSSSsKK",
  "KKsSsKKKKsSSSSSSSSsKKKKsSsKK",
  "KKsSKWWKKKSSSSSSSSKWWKKKSsKK",
  "KKssKWWKKKSSSSSSSSKWWKKKssKK",
  "KKdsKKKKKKSSKKKKSSKKKKKKsdKK",
  ".KKsKKKKKKSKKKKKKSKKKKKKsKK.",
  ".KKdsKKKKsSKWWWWKSsKKKKsdKK.",
  "..KKsTTTsSSKKKKKKSSsTTTsKK..",
  "..KKdTTTSSSSSSSSSSSSTTTdKK..",
  "...KKtTTSSSSSSSSSSSSTTtKK...",
  "....KKtTsSSSSSSSSSSsTtKK....",
  ".....KKKtsSSSSSSSSstKKK.....",
  "......KKKKdssssssdKKKK......",
  ".......KKKKKKKKKKKKKK.......",
  "......KKsSKssssssKSsKK......",
  ".....KKSSKsSSSSSSsKSSKK.....",
  ".....KKSSKSSSSSSSSKSSKK.....",
  ".....KKsSKSSSSSSSSKSsKK.....",
  "......KKKKSSSSSSSSKKKK......",
  "........KKSSsKKsSSKK........",
  ".........KKSSKKSSKK.........",
  ".........KKSSKKSSKK.........",
  "..........KKKK.KKK..........",
]
draw("isaac", ISAAC, SKIN)
// His head alone: the theme's mark, and the face on a dialog.
const HEAD = [...ISAAC.slice(0, 22), "......KKKKKKKKKKKKKKKK......"]
draw("mark", HEAD, SKIN)
// The same face at the size of a line of text.
draw(
  "face",
  [
    "....KKKKKK....",
    "..KKSSSSSSKK..",
    ".KSSSSSSSSSSK.",
    "KsSSSSSSSSSSsK",
    "KSKKKSSSSKKKSK",
    "KsWKKSSSSWKKsK",
    "KsKKKSKKSKKKsK",
    "KsTTSKWWKSTTsK",
    ".KTtSSKKSStTK.",
    "..KKsSSSSsKK..",
    "....KKKKKK....",
  ],
  SKIN,
)

// ── The HUD ──────────────────────────────────────────────────────────────
// Hearts as the corner of the screen has them: flat red, one white glint,
// a black line round each. Half of one; an empty container; a soul heart.
const HEART = [
  "..KKK...KKK..",
  ".KaaaK.KbbbK.",
  "KaggaaKbbbbbK",
  "KagaaaabbbbbK",
  "KaaaaaabbbbbK",
  "KaaaaaabbbbbK",
  ".KaaaaabbbbK.",
  "..KaaaabbbK..",
  "...KaaabbK...",
  "....KaabK....",
  ".....KaK.....",
  "......K......",
]
const HEARTS = { K, R: "#e80000", W: "#ffffff", e: "#2a1512", B: "#5a6aa6", l: "#8a9ad0" }
const heart = (name, a, b, g) => {
  const picture = paint(name, HEART.map((row) => row.replace(/[abg]/g, (c) => ({ a, b, g })[c])), HEARTS)
  save(name, picture)
  return picture
}
const HEART_FULL = heart("heart", "R", "R", "W")
heart("heart-half", "R", "e", "W")
heart("heart-empty", "e", "e", "e")
heart("heart-soul", "B", "B", "l")

// What is counted under the hearts: a penny, a bomb, a key.
const COIN = paint(
  "coin",
  ["..KKK..", ".KYYYK.", "KYWYYyK", "KYWYYyK", "KYWYYyK", "KYWYYyK", "KYYYYyK", ".KYyyK.", "..KKK.."],
  { K, Y: "#d6d05a", y: "#a8a23c", W: "#fbfbd8" },
)
const BOMB = paint(
  "bomb",
  [".K.......", "..KK.....", "..KKKKK..", ".KGGgGGK.", "KGgGGGgGK", "KGGGgGGGK", "KGgGGGgGK", ".KGGgGGK.", "..KKKKK.."],
  { K, G: "#4c4c50", g: "#77777c" },
)
const KEY = paint(
  "key",
  [".KKKKK.", "KWWWWWK", "KWKKKWK", "KWWWWWK", ".KKWKK.", "KKKWK..", "KWWWK..", "KKKWK..", "KWWWK..", "KKKKK.."],
  { K, W: "#c4c4c4" },
)
save("coin", COIN)
save("bomb", BOMB)
save("key", KEY)
// The three of them in a column, as they stand in the corner; the numbers
// beside them are written by the stylesheet, from what the sidebar holds.
{
  const g = grid(9, 36)
  stamp(g, COIN, 1, 1)
  stamp(g, BOMB, 0, 13)
  stamp(g, KEY, 1, 25)
  save("pickups", g)
}
// Three red hearts: what Isaac starts with.
{
  const g = grid(41, 12)
  for (let i = 0; i < 3; i++) stamp(g, HEART_FULL, i * 14, 0)
  save("hearts", g)
}

// The active item: the D6, a red die seen from its corner…
const D6 = draw(
  "d6",
  [
    ".......KKKKK........",
    ".....KKmmmmmKK......",
    "...KKmmmmKmmmmKK....",
    "..KmmmKmmmmmmmmmK...",
    ".KKmmmmmmmmDmmmmKK..",
    ".KDDmmmmmmDDmmmmmK..",
    "KKllDDDmDDDrrrrrrKK.",
    "KllllllDDDrrrrrrrrK.",
    ".KlKllllDDrrrKrrrrKK",
    ".KllllllDDrrrrrrrrrK",
    ".KKllKlllDDrrrrrrrdK",
    "..KlllllLDDrrrrrrdKK",
    "..KllllKlLDDrrrrddK.",
    "..KKlllllLLDrrrddKK.",
    "...KKllllLLDrrddKK..",
    ".....KKllLLDrdKK....",
    ".......KKLLDKK......",
    ".........KKKK.......",
  ],
  { K, m: "#8a2436", l: "#bc3a4e", L: "#d4566a", r: "#6a1a28", d: "#4a1019", D: "#3e0e18" },
)
// What else can sit in the item's place, one for each kind of tool: a book
// to read, a blank card to write on, a compass to find things, a crystal
// ball to look far off, a little brother who helps, a battery for what is
// plugged in. (A bomb for a command is drawn further down.)
const ITEM_BOOK = paint(
  "item-book",
  [
    "..KKKKKKKKKKK...",
    ".KBBBBBBBBBBBK..",
    "KBBBBBBBBBBBBpK.",
    "KBBBBBcBBBBBBpK.",
    "KBBBBBcBBBBBBpK.",
    "KBBBcccccBBBBpK.",
    "KBBBBBcBBBBBBpK.",
    "KBBBBBcBBBBBBpK.",
    "KBBBBBcBBBBBBpK.",
    "KBBBBBcBBBBBBpK.",
    "KBBBBBBBBBBBBpK.",
    "KbbbbbbbbbbbbpK.",
    "KbppppppppppppK.",
    "KKbbbbbbbbbbbKK.",
    ".KKKKKKKKKKKKK..",
  ],
  { K, B: "#6e5244", b: "#3a2416", c: "#2a1a14", p: "#c8c8c8" },
)
const ITEM_CARD = paint(
  "item-card",
  [
    ".KKKKKKKKKK.",
    "KsWWWWWWWssK",
    "KWWWWWWWWssK",
    "KWWWWWWWWssK",
    "KWWWWWWWWssK",
    "KWWWWWWWWssK",
    "KWWWWWWWWssK",
    "KWWWWWWWWssK",
    "KWWWWWWWWssK",
    "KWWWWWWWsssK",
    "KWWWWWWssssK",
    "KWWWWWsssssK",
    "KWWWWssssssK",
    "KsWWsssssssK",
    ".KKKKKKKKKK.",
  ],
  { K, W: "#ffffff", s: "#dadada" },
)
const ITEM_COMPASS = paint(
  "item-compass",
  [
    "......KKKKKK......",
    "....KKttTTttKK....",
    "..KKtTTTKKTTTtKK..",
    ".KKtTTTTKRKTTTTtK.",
    ".KtTTTTKRRRKTTTTK.",
    "KKtTTTTKKRKKTTTTKK",
    "KtTTTTTKgWgKTTTTtK",
    "KRtTTTTTKgKTTTTtRK",
    "KRRttTTTTKTTTTtRRK",
    "KRRRRKKKKKKKKRRRRK",
    "KrRRRRRRRRRRRRRRrK",
    ".KrrRRRRRRRRRRrrK.",
    "..KKrrrrrrrrrrKK..",
    "....KKKKKKKKKK....",
  ],
  { K, T: "#ecd2b4", t: "#d8a878", R: "#c83038", r: "#7a1a20", W: "#ffffff", g: "#9a9a9a" },
)
const ITEM_BALL = paint(
  "item-ball",
  [
    "......KKKKKK......",
    "....KKccCCccKK....",
    "...KcCCCCCCCCcK...",
    "..KcCWWWCCCCCccK..",
    ".KcCWWWWCCCCCCccK.",
    ".KcCCWWCCCCCCCccK.",
    "KccCCCCCCCCCCCcccK",
    "KcWWCCCCCCCCggcccK",
    "KcWCCCCCCCCgGgGccK",
    "KccCCCCCCCggggggcK",
    ".KccCCCCCCgGggGgK.",
    ".KcccCCCCcggggggK.",
    "..KKccccccccggKK..",
    ".KPPKKccccccKKPPK.",
    "KPPpPPKKKKKKPPpPPK",
    "KppPPPPPPPPPPPPppK",
    ".KKppppppppppppKK.",
    "...KKKKKKKKKKKK...",
  ],
  { K, C: "#e4e8f4", c: "#c8d0e8", W: "#ffffff", g: "#d8d8dc", G: "#6a6a76", P: "#8a609a", p: "#5e4470" },
)
const ITEM_BOBBY = paint(
  "item-bobby",
  [
    "....KKKKKKK.....",
    "..KKbBBBBBbKK...",
    ".KbBBBBBBBBBbK..",
    ".KBKKBBBBBKKBK..",
    "KbBKKBBBBBKKBbK.",
    "KbBBBBBBBBBBBbK.",
    "KbBBBKKKKKBBBbK.",
    "KbBBKKKKKKKBBbK.",
    ".KbBBKKKKKBBbK..",
    ".KKbBBBBBBBbKK..",
    "..KKKdddddKKK...",
    ".KKbBBBBBBBbKK..",
    "KbKBBBBBBBBBKbK.",
    "KKKbBBBBBBBbKKK.",
    "..KbBBBBBBBbK...",
    "...KbBBBBBbK....",
    "....KbBBBbK.....",
    ".....KbBbK......",
    "......KKK.......",
  ],
  { K, B: "#8a92c0", b: "#6a72a4", d: "#4a5080" },
)
const ITEM_BATTERY = paint(
  "item-battery",
  [
    "....KKKKKK....",
    ".KKKKggggKKKK.",
    "KdGGGGGGGGGGdK",
    "KdGGLLLLLGGGdK",
    "KdggggggggggdK",
    "KKKKKKKKKKKKKK",
    "KPPPpppKPPPPPK",
    "KPPpppKKPppPPK",
    "KPPppKKKKppPPK",
    "KPPpppKKpppPPK",
    "KPPPppKpppPPPK",
    "KKKKKKKKKKKKKK",
    "KdGGLLLLLGGGdK",
    "KdGGGGGGGGGGdK",
    "KdggggggggggdK",
    ".KKKKKKKKKKKK.",
  ],
  { K, G: "#a8a4b0", L: "#c8c4d0", g: "#84808c", d: "#5c5864", P: "#a06864", p: "#c89c98" },
)
// …and the bar beside it that fills as rooms are cleared: its case, six
// notches. The green is the stylesheet's, so it can fill.
draw(
  "charge",
  [
    ".KKKK.",
    "K....K",
    "K....K",
    "KKKKKK",
    "K....K",
    "K....K",
    "KKKKKK",
    "K....K",
    "K....K",
    "KKKKKK",
    "K....K",
    "K....K",
    "KKKKKK",
    "K....K",
    "K....K",
    "KKKKKK",
    "K....K",
    "K....K",
    ".KKKK.",
  ],
  { K },
)

// ── What is in a room ────────────────────────────────────────────────────
// A tear: round, pale blue, a glint.
const TEAR = { K: "#16202c", T: "#c4e6f2", t: "#86bcd6", W: "#ffffff" }
draw("tear", ["..KKKK..", ".KTTTTK.", "KTWTTTtK", "KTWTTTtK", "KTTTTttK", "KTTTtttK", ".KttttK.", "..KKKK.."], TEAR)
// A big one, to shoot (the send button), and a spent one.
const SHOT = [
  "....KKKKKK....",
  "..KKTTTTTTKK..",
  ".KTTTTTTTTTTK.",
  "KTTWWTTTTTTTtK",
  "KTWWTTTTTTTTtK",
  "KTWTTTTTTTTTtK",
  "KTTTTTTTTTTTtK",
  "KTTTTTTTTTTTtK",
  "KTTTTTTTTTTttK",
  "KTTTTTTTTTtttK",
  "KtTTTTTTtttttK",
  ".KttttttttttK.",
  "..KKttttttKK..",
  "....KKKKKK....",
]
draw("shot", SHOT, TEAR)
draw("shot-off", SHOT, { K: "#3a3436", T: "#b4acac", t: "#9a9292", W: "#cfc8c8" })
// A bomb with its fuse lit (the stop button).
const BOMB_LIT = draw(
  "bomb-lit",
  [
    ".........YY...",
    "........YOOY..",
    ".......K.YY...",
    "......KK......",
    "...KKKKKKK....",
    "..KGGGgGGGKK..",
    ".KGGgGGGgGGGK.",
    "KGGGGGGGGGgGGK",
    "KGgGGGgGGGGGGK",
    "KGGGGGGGGgGGGK",
    "KGGGgGGGGGGGDK",
    ".KGGGGGgGGGDK.",
    "..KGGGGGGDDK..",
    "...KKKKKKKK...",
  ],
  { K, G: "#3c3c40", g: "#606066", D: "#262628", Y: "#ffd83a", O: "#ff7a1a" },
)
// Every item on the same 20 × 20 canvas, so they sit in the same place.
function item(name, g) {
  const N = 20
  const canvas = grid(N, N)
  stamp(canvas, g, Math.floor((N - g[0].length) / 2), Math.floor((N - g.length) / 2))
  save(`item-${name}`, canvas)
}
item("d6", D6)
item("bomb", BOMB_LIT)
item("book", ITEM_BOOK)
item("card", ITEM_CARD)
item("compass", ITEM_COMPASS)
item("ball", ITEM_BALL)
item("bobby", ITEM_BOBBY)
item("battery", ITEM_BATTERY)

// A fly: two wings like rings, a grey cross where they meet, the body under.
draw(
  "fly",
  [
    "..KKKK.......KKKK..",
    ".KggggKK...KKggggK.",
    "KggggggKKWKKggggggK",
    "KggggggKWWWKggggggK",
    ".KggggKKKWKKKggggK.",
    "..KKKKKKKKKKKKKKK..",
    "......KKKKKKK......",
    ".......KKKKK.......",
    "........KKK........",
  ],
  { K, g: "#4a465280", W: "#a09eae" },
)
// A rock: a boulder with a lit face, dithered where it turns away.
const ROCK = paint(
  "rock",
  [
    "....KKKKKKK.......",
    "..KKlllllllKKK....",
    ".KllllllllllmmKK..",
    ".KlllllllllmmmmmK.",
    "KlllllllllmmmmmmmK",
    "KllllllllKmmmmmmmK",
    "KKllllllKmmmdmdmmK",
    "KmKKllKKmmmdmdmdmK",
    "KmmmKKmmmmdmdmdddK",
    "KmmmmmmmmdmdmddddK",
    "KdmmmmmmdmdmdddddK",
    "KdmdmdmdmdddddddDK",
    "KddddddddddddddDDK",
    ".KDDdddddddddDDDK.",
    "..KKDDDDDDDDDDKK..",
    "....KKKKKKKKKK....",
  ],
  { K: "#140c0c", l: "#6a5a58", m: "#4c3e3c", d: "#3a2e2c", D: "#2a2020" },
)
save("rock", ROCK)
// Poop: three coils and a tip, glints on the lit side.
const POOP = paint(
  "poop",
  [
    ".......KK.......",
    "......KppK......",
    ".....KppHpK.....",
    "....KpppppPK....",
    "...KKPPPPPPKK...",
    "..KpppHHppppPK..",
    ".KppppppppppPPK.",
    ".KKPPPPPPPPPPKK.",
    "KppppHHHpppppPPK",
    "KppppppppppppPPK",
    "KPppppppppppPPPK",
    ".KPPPPPPPPPPPPK.",
    "..KKKKKKKKKKKK..",
  ],
  { K: "#1a0e0c", p: "#6e4636", P: "#4c2e24", H: "#9a6a54" },
)
save("poop", POOP)
// A rule across a reply: rock, poop, rock, on a crack in the floor.
{
  const g = grid(96, 16)
  const rnd = random(7)
  let y = 12
  for (let x = 0; x < 96; x++) {
    if (x > 22 && x < 74) continue
    if (rnd() < 0.3) y = Math.max(10, Math.min(14, y + (rnd() < 0.5 ? -1 : 1)))
    g[y][x] = "#1a0e0c90"
  }
  stamp(g, ROCK, 22, 0)
  stamp(g, POOP, 40, 3)
  stamp(g, flipX(ROCK), 56, 0)
  save("rule", g)
}
// The stone an item stands on.
const ALTAR = paint(
  "altar",
  [
    "......KKKKKKKK......",
    "...KKKllllllllKKK...",
    "..KllllllllllllmmK..",
    ".KllllllllllllmmmmK.",
    ".KmllllllllllmmmmdK.",
    "KKmmmmllllmmmmmmddKK",
    "KmmmmmmmmmmmmmdddddK",
    "KdmmmmmKmmmmmddddddK",
    "KddmmmmKKmmdddddddDK",
    ".KdddddddddddddddDK.",
    ".KKDDddddddddddDDKK.",
    "...KKKKKKKKKKKKKK...",
  ],
  { K: "#141010", l: "#8a8084", m: "#655c60", d: "#4a4246", D: "#343034" },
)
save("altar", ALTAR)
// The way down: a trapdoor (the button that jumps to the latest message).
draw(
  "trapdoor",
  [
    "KKKKKKKKKKKKKKKK",
    "KwwwwwwwwwwwwwwK",
    "KwKKKKKKKKKKKKwK",
    "KwK..........KwK",
    "KwK.LL....LL.KwK",
    "KwK.LLLLLLLL.KwK",
    "KwK.LL....LL.KwK",
    "KwK.LL....LL.KwK",
    "KwK.LLLLLLLL.KwK",
    "KwK.LL....LL.KwK",
    "KwK.LL....LL.KwK",
    "KwK.LLLLLLLL.KwK",
    "KwK.ll....ll.KwK",
    "KwKKKKKKKKKKKKwK",
    "KWWWWWWWWWWWWWWK",
    "KKKKKKKKKKKKKKKK",
  ],
  { K: "#0c0606", w: "#6a4a3c", W: "#4a3228", L: "#8a6a4a", l: "#5a4432", ".": "#050202" },
)
// A chest: wood between iron bands, a lock.
draw(
  "chest",
  [
    ".KKKKKKKKKKKKKK.",
    "KMMBBBBMMBBBBMMK",
    "KMLBbbBMLBbbBLMK",
    "KMMBbbBMMBbbBMMK",
    "KMMBBBBMMBBBBMMK",
    "KKKKKKKKKKKKKKKK",
    "KmmbbbbKKbbbbmmK",
    "KmmbBBbYYbBBbmmK",
    "KmmbBBbKKbBBbmmK",
    "KmmbbbbmmbbbbmmK",
    ".KKKKKKKKKKKKKK.",
  ],
  { K, M: "#8a8a8e", L: "#c0c0c4", m: "#66666a", B: "#7a5a48", b: "#5a4034", Y: "#e8c83a" },
)
// A boss's skull, for the head of its bar.
draw(
  "skull",
  [
    "....KKKKKKKKKK....",
    "..KKKbbBBBBbbKKK..",
    ".KKbbBBBBBBBBbbKK.",
    ".KbbBBbbbbbbBBbbK.",
    "KKddddbbbbbbddddKK",
    "KbBBBbbddddbbBBBbK",
    "KbbBBBBbbbbBBBBbbK",
    "KKKKKKbbbbbbKKKKKK",
    "KbKKKKKddddKKKKKbK",
    "KbKKKKKKddKKKKKKbK",
    "KBBbKKbKKKKbKKbBBK",
    ".KBBbbbbbbbbbbBBK.",
    "..KKKbBKBBKBbKKK..",
    "....KBBKBBKBBK....",
    "....KBBKBBKBBK....",
    "....KKKKKKKKKK....",
  ],
  { K, B: "#b9a98e", b: "#8f806a", d: "#2a1e1a" },
)
// Blood on the floor (what went wrong).
draw(
  "blood",
  [
    "....R.......R...",
    ".R....RRR.......",
    "....RRRRRRR..R..",
    "..RRRrrRRRRR....",
    ".RRRrrrrRRRRRR..",
    "RRRRrrrRRRRRRRR.",
    ".RRRRRRRRRRrRR..",
    "..RRRRRRRRrrRRR.",
    "R..RRRRRRRRRRR..",
    "....RRRRRRRR...R",
    "..R...RRRR......",
    "......R...R.....",
  ],
  { R: "#980000", r: "#c81010" },
)
// A push-pin, and the ▶ a menu points with.
const PIN = paint("pin", ["..KKK..", ".KgggK.", "KgWgggK", "KgggggK", "KggggdK", ".KgddK.", "..KKK.."], { K, g: "#807c80", W: "#c8c4c8", d: "#5a565a" })
save("pin", PIN)
draw("cursor", ["K....", "KKK..", "KKKK.", "KKKKK", "KKKK.", "KKK..", "K...."], { K: "#000000" })

// ── Frames ───────────────────────────────────────────────────────────────
// Paper, as the game's menus are: a sheet with a torn edge and a dark line
// round it. A square of it for `border-image`: the edges repeat, never the
// same nick twice in a row.
function paper(name, fill, line, seed) {
  const N = 40
  const B = 4
  const rnd = random(seed)
  // How far the edge is eaten in, along each side; 1 at both ends of the
  // part that repeats, so its tiles meet.
  const edge = () => {
    const d = new Array(N).fill(1)
    for (let i = B + 1; i < N - B - 1; i++) {
      const r = rnd()
      d[i] = r < 0.2 ? 0 : r < 0.42 ? 2 : 1
      if (Math.abs(d[i] - d[i - 1]) > 1) d[i] = 1
    }
    d[N - B - 2] = Math.min(d[N - B - 2], 1) || 1
    return d
  }
  const [top, right, bottom, left] = [edge(), edge(), edge(), edge()]
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return false
    if (y < top[x] || N - 1 - y < bottom[x] || x < left[y] || N - 1 - x < right[y]) return false
    // Corners: a little off each.
    const cx = Math.min(x, N - 1 - x)
    const cy = Math.min(y, N - 1 - y)
    return cx + cy >= 2
  }
  const g = grid(N, N)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inside(x, y)) continue
      if (x >= B && x < N - B && y >= B && y < N - B) continue // the middle is the element's own ground
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      g[y][x] = rim ? line : fill
    }
  save(name, g)
}
paper("paper-sheet", "#ece5e3", "#352c2d", 3)
paper("paper-note", "#e8d8c8", "#352c2d", 9)
paper("paper-sheet-night", "#d8c8b0", "#8a735e", 3)
paper("paper-note-night", "#e6dccb", "#8a735e", 9)

// The black brush-stroke an item's name is written on: ragged at both ends,
// rough along the top and the bottom.
{
  const W = 60
  const H = 14
  const END = 16
  const rnd = random(21)
  const g = grid(W, H)
  const INK = "#080000"
  for (let y = 0; y < H; y++) {
    // Strokes reach furthest in the middle rows.
    const mid = 1 - Math.abs(y - (H - 1) / 2) / ((H - 1) / 2)
    const reach = (r) => Math.round(END - 3 - mid * (END - 5) * (0.55 + 0.45 * r) - r * 2)
    const from = Math.max(0, reach(rnd()))
    const to = W - 1 - Math.max(0, reach(rnd()))
    for (let x = from; x <= to; x++) g[y][x] = INK
  }
  // Rough along the long edges, and specks flung off the ends.
  for (let x = END; x < W - END; x++) {
    if (rnd() < 0.3) g[0][x] = null
    if (rnd() < 0.3) g[H - 1][x] = null
  }
  for (const [x, y] of [[1, 3], [3, 10], [0, 7], [5, 1], [W - 2, 4], [W - 4, 11], [W - 1, 8], [W - 6, 0]]) g[y][x] = INK
  save("banner", g)
}

// A box on the HUD (the map's): a black line, the corners a square short.
const BOX = [".KKKK.", "KkkkkK", "Kk..kK", "Kk..kK", "KkkkkK", ".KKKK."]
draw("box", BOX, { K: "#050202", k: "#00000066" })
draw("box-ink", BOX, { K: "#352c2d", k: "#352c2d22" })
// A slab of stone, for code: lit along the top and the left.
draw("stone", [".KKKK.", "KLLLLK", "KL..DK", "KL..DK", "KDDDDK", ".KKKK."], { K: "#0c0a0c", L: "#5c5458", D: "#1a161a" })
// A room on the map: a square with its corners rounded, black round it.
// White where you are, grey where you have been.
const ROOM = [".KKKKKK.", "KKccccKK", "KccccccK", "KccccccK", "KccccccK", "KccccccK", "KKccccKK", ".KKKKKK."]
draw("room", ROOM, { K: "#050202", c: "#ececec" })
draw("room-dim", ROOM, { K: "#050202", c: "#6e6e6e" })
// A boss's bar.
draw(
  "bar",
  [".KKKKKKKK.", "KKrrrrrrKK", "KRRRRRRRRK", "KRRRRRRRRK", "KRRRRRRRRK", "KRRRRRRRRK", "KKddddddKK", ".KKKKKKKK."],
  { K: "#0a0000", R: "#c80000", r: "#e01818", d: "#980000" },
)

// ── The room ─────────────────────────────────────────────────────────────
// Its wall, sixteen squares thick: brick in two courses, dark where it meets
// the floor. One strip for the top; the other three sides are it turned.
const WALL = 16
const COURSE = (WALL - 4) / 2
function wall(seed, c) {
  const W = 48
  const g = grid(W, WALL)
  const rnd = random(seed)
  for (let x = 0; x < W; x++) {
    g[0][x] = c.out
    g[1][x] = c.out
    g[WALL - 2][x] = c.foot
    g[WALL - 1][x] = c.line
  }
  for (let course = 0; course < 2; course++) {
    const y0 = 2 + course * COURSE
    for (let b = 0; b < 4; b++) {
      const x0 = b * 12 + course * 6
      const fill = c.brick[Math.floor(rnd() * c.brick.length)]
      for (let y = y0; y < y0 + COURSE; y++)
        for (let dx = 0; dx < 12; dx++) {
          const x = (x0 + dx) % W
          g[y][x] = dx === 11 || y === y0 + COURSE - 1 ? c.mortar : y === y0 ? c.lit : fill
        }
      // A chip out of one brick in three.
      if (rnd() < 0.35) g[y0 + 1 + Math.floor(rnd() * (COURSE - 2))][(x0 + 2 + Math.floor(rnd() * 7)) % W] = c.mortar
    }
  }
  return g
}
const corner = (top) => {
  const g = grid(WALL, WALL)
  for (let y = 0; y < WALL; y++) for (let x = 0; x < WALL; x++) g[y][x] = x === y ? top[WALL - 1][0] : y < x ? top[y][x] : top[x][y]
  return g
}
function sides(name, top) {
  save(`${name}-top`, top)
  save(`${name}-bottom`, flipY(top))
  save(`${name}-right`, turn(top))
  save(`${name}-left`, flipX(turn(top)))
  const c = corner(top)
  save(`${name}-tl`, c)
  save(`${name}-tr`, flipX(c))
  save(`${name}-bl`, flipY(c))
  save(`${name}-br`, flipX(flipY(c)))
}
sides("wall", wall(4, { out: "#0c0605", foot: "#2a1611", line: "#120907", mortar: "#26140f", lit: "#5a382e", brick: ["#4a2e26", "#44291f", "#3e2620", "#4e3027"] }))
// The same brick with the light out, behind the sidebar.
{
  const top = wall(12, { out: "#170d0a", foot: "#170d0a", line: "#0b0605", mortar: "#0b0605", lit: "#251611", brick: ["#1d120e", "#1a100c", "#20130f"] })
  save("bricks", top.slice(2, 2 + 2 * COURSE))
}

// A door in the middle of a wall, seen from above as the game draws it: a
// lit beam along the wall's outer edge, two posts leaning in from it towards
// the floor, the dark of the way through between them.
const DOOR = (() => {
  const W = 40
  const c = { K: "#120806", F: "#c0937a", f: "#8a6250", d: "#0e0605", l: "#2c1813" }
  const g = grid(W, WALL)
  for (let x = 0; x < W; x++) {
    g[0][x] = g[4][x] = c.K
    g[1][x] = g[2][x] = x === 0 || x === W - 1 ? c.K : c.F
    g[3][x] = x === 0 || x === W - 1 ? c.K : c.f
  }
  for (let y = 5; y < WALL - 1; y++) {
    const off = 2 + Math.round((y - 5) * 0.8)
    const post = [c.K, c.F, c.f, c.f, c.K]
    for (let i = 0; i < 5; i++) {
      g[y][off + i] = post[i]
      g[y][W - 1 - off - i] = post[i]
    }
    for (let x = off + 5; x < W - off - 5; x++) g[y][x] = y >= 7 && x >= off + 9 && x < W - off - 9 ? c.l : c.d
  }
  const last = 2 + Math.round((WALL - 7) * 0.8)
  for (let x = last; x < W - last; x++) g[WALL - 1][x] = c.K
  return g
})()
save("door-top", DOOR)
save("door-bottom", flipY(DOOR))
save("door-left", flipY(turn(DOOR)))
save("door-right", turn(flipY(DOOR)))

// The floor: nothing but its marks — a few cracks and specks, to lay over
// the floor's own colour.
{
  const N = 128
  const g = grid(N, N)
  const rnd = random(17)
  const DARK = "#00000026"
  for (let i = 0; i < 4; i++) {
    let x = Math.floor(rnd() * N)
    let y = Math.floor(rnd() * N)
    const len = 8 + Math.floor(rnd() * 14)
    const dir = rnd() < 0.5 ? 1 : -1
    for (let n = 0; n < len; n++) {
      g[((y % N) + N) % N][((x % N) + N) % N] = DARK
      if (rnd() < 0.6) x += dir
      if (rnd() < 0.55) y += 1
    }
  }
  for (let i = 0; i < 22; i++) g[Math.floor(rnd() * N)][Math.floor(rnd() * N)] = i % 4 ? DARK : "#ffffff0a"
  save("floor", g)
}

// The light a figure stands in on a dark screen: an ellipse in three bands.
{
  const W = 96
  const H = 26
  const g = grid(W, H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const r = Math.hypot((x - W / 2 + 0.5) / (W / 2), (y - H / 2 + 0.5) / (H / 2))
      const dither = (x + y) % 2 === 0 ? 0.04 : -0.04
      if (r + dither < 0.5) g[y][x] = "#55301f"
      else if (r + dither < 0.78) g[y][x] = "#43251b"
      else if (r < 1) g[y][x] = "#2c1812"
    }
  save("spot", g)
}

// ── Paper: the day side ──────────────────────────────────────────────────
// The sheet the page is, with a torn edge six squares deep; one strip for
// the top, the other sides are it turned. And what a child has pencilled on
// the table round it.
{
  const T = 6
  const W = 64
  const rnd = random(33)
  const g = grid(W, T)
  let d = 1
  for (let x = 0; x < W; x++) {
    if (x > 1 && x < W - 2 && rnd() < 0.3) d = Math.max(0, Math.min(2, d + (rnd() < 0.5 ? -1 : 1)))
    if (x >= W - 2) d = 1
    for (let y = d; y < T; y++) g[y][x] = "#ece5e3"
    g[d][x] = "#352c2d"
  }
  // Where the edge steps, the line steps with it.
  for (let x = 1; x < W; x++) {
    const a = g.findIndex((row) => row[x - 1])
    const b = g.findIndex((row) => row[x])
    for (let y = Math.min(a, b); y <= Math.max(a, b); y++) g[y][a > b ? x - 1 : x] = "#352c2d"
  }
  const top = g
  save("sheet-top", top)
  save("sheet-bottom", flipY(top))
  save("sheet-right", turn(top))
  save("sheet-left", flipX(turn(top)))
  const c = paint(
    "sheet-corner",
    ["......", "...KKK", "..KPPP", ".KPPPP", ".KPPPP", ".KPPPP"],
    { K: "#352c2d", P: "#ece5e3" },
  )
  save("sheet-tl", c)
  save("sheet-tr", flipX(c))
  save("sheet-bl", flipY(c))
  save("sheet-br", flipX(flipY(c)))
}
{
  const N = 128
  const g = grid(N, N)
  const PENCIL = { X: "#b3a7a3" }
  const doodles = [
    ["....XXXXX....", "..XX.....XX..", ".X.........X.", "X...........X", "X..XX...XX..X", "X..XX...XX..X", "X...........X", "X....XXX....X", ".X.........X.", "..XX.....XX..", "....XXXXX...."],
    ["..XX...XX..", ".X..X.X..X.", "X....X....X", "X.........X", ".X.......X.", "..X.....X..", "...X...X...", "....X.X....", ".....X....."],
    ["......X......", ".X....X....X.", "..X.......X..", "....XXXXX....", "...X.....X...", "...X.....X...", "XX.X.....X.XX", "...X.....X...", "...X.....X...", "....XXXXX....", "..X.......X..", ".X....X....X.", "......X......"],
    ["..XXXXXXXXXX..", ".X..........X.", "X............X", "X............X", "XXXXXXXXXXXXXX", "X.....XX.....X", "X.....XX.....X", "X............X", "X............X", "XXXXXXXXXXXXXX"],
    ["..XXX..", ".X...X.", "X..X..X", "X..X..X", "X..X..X", ".X...X.", "..XXX.."],
    ["....X....", "...X.X...", "..XXXXX..", ".X.....X.", ".XXXXXXX.", "X.......X", "XXXXXXXXX"],
  ]
  const at = [[10, 14], [70, 8], [100, 52], [28, 66], [84, 100], [12, 104], [56, 40]]
  at.forEach(([x, y], i) => stamp(g, paint("doodle", doodles[i % doodles.length], PENCIL), x, y))
  save("doodles", g)
}
