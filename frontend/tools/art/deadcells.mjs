import { pixels, random, sprite, write, writeSprite } from "./lib.mjs"

// ── Dead Cells ───────────────────────────────────────────────────────────
// Drawn after the game's own screens: the start of a run in the Prisoners'
// Quarters (a barred window, its beam across teal stone, the Beheaded under
// it), the title screen (the island against a sunset, a boat, crows), the
// HUD (flask, weapon and skill slots, the three stats, cells and gold) and
// the menus (copper-framed navy panels, a cyan bar on the chosen row, red
// boxes ticked in gold, a grey knob on a blue track, white key caps).

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
const mix = (a, b, t) => {
  const A = hex(a)
  const B = hex(b)
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, "0")).join("")
}
// A colour along a ramp of stops, t from 0 to 1.
const ramp = (stops, t) => {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  return mix(stops[i], stops[i + 1], x - i)
}

// A grid to paint on, written out as runs of one colour.
function canvas(W, H) {
  const g = Array.from({ length: H }, () => new Array(W).fill(null))
  const put = (x, y, c) => {
    x = Math.round(x)
    y = Math.round(y)
    if (c && x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c
  }
  const get = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? g[y][x] : null)
  const rect = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c)
  }
  const blit = (rows, palette, ox, oy) => rows.forEach((row, y) => [...row].forEach((ch, x) => palette[ch] && put(ox + x, oy + y, palette[ch])))
  const body = () => {
    let s = ""
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; ) {
        const c = g[y][x]
        let n = 1
        while (x + n < W && g[y][x + n] === c) n++
        if (c) s += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${c}"/>`
        x += n
      }
    }
    return s
  }
  // Another canvas laid over this one, its empty squares left alone.
  const lay = (other, ox = 0, oy = 0) => {
    for (let y = 0; y < other.H; y++) for (let x = 0; x < other.W; x++) put(x + ox, y + oy, other.get(x, y))
  }
  return { W, H, put, get, rect, blit, lay, body, svg: () => sprite(W, H, body()) }
}

// ── The Beheaded ─────────────────────────────────────────────────────────
// Standing as at the start of a run: a dark head with a flame for a face, a
// red scarf, one big navy pauldron, gauntlets lit cyan, a red tabard over
// pale trousers, boots with a lit toe.
const HERO_PALETTE = {
  H: "#1c2426", // the head's smoke
  h: "#3c4a48",
  K: "#0b1220",
  N: "#1b2b4d",
  B: "#5f89b0",
  S: "#3f5269",
  M: "#5c1738",
  D: "#2a0f24",
  R: "#c62b26",
  r: "#8f1c2b",
  C: "#93ecf0",
  c: "#3c80a2",
  E: "#dfbb93",
  e: "#7d5a72",
  G: "#5a5a60",
  Y: "#fff37a",
  O: "#ffa133",
  P: "#e9506b",
  W: "#f4e8c2",
  T: "#4b2a2c",
}
const HERO = [
  "...........h.H............",
  "..........hHHH.h..........",
  "..........HHHHHH..........",
  "..........HHHYHH..........",
  "..........HPPYOH..........",
  "..........HPYYYO..........",
  "..........HPPYOH..........",
  "..........HHPOHH..........",
  "........DDHHHHHHDD........",
  ".......DDMMDDDDMMRR.......",
  "...KK..DMRRRRRRRRRR.......",
  "..KNNK.DMMRRRRRRRMMC......",
  "..NNBBKKSMMMRRMMMSSC......",
  ".NNNBBKKSSSMMMMSSSSCC.....",
  ".NNNNBKKNSSSSSSSSSKK......",
  ".NNNNNKKNNNNNNNNNNKN......",
  ".KKKKKKKKNNNNNNNNNN.......",
  "..KKKK..DDDRRRRRRRDD......",
  "..cCC...DDDDDDDDRRDDc.....",
  "..cCCc..DDDDDDDRRRD.cC....",
  ".GcCC...MDDDDDDRRR..cCC...",
  ".GEEc...eEDDDMRRRDD.cCCG..",
  ".GEEe...MeeGGRRRRDDGGEEE..",
  ".GEE....GGGGGRRRDDD.GGeE..",
  ".GeG....DDDDTRRMMMM..GGeE.",
  "GGCC....GGGeERRRRRRM..cCe.",
  "GcCC...GGGeEERRRRRRM..cCC.",
  ".cC.C..GGeEEERRRRRRM..cCC.",
  ".cC....GGeEEErRRRRRRM.cC..",
  ".CC...GGeEEEErRRRRRRM..c..",
  "......GGeEEEErRRRRRRMe....",
  ".....GGeEEEEErRRRRRRMEe...",
  ".....GGeEEEE.rRRRRRRREe...",
  "....GGeEEEEE.rMRRRRRMEe...",
  "....GDeEEEEE..MMMMMMMEEe..",
  "....GGWEEEEE...GGGGEEEEe..",
  "....NNcWEEE....GGGGGEEEe..",
  "....KNNNNEE....GGGGNNNNN..",
  ".....KNNNNN.....KNNNNNN...",
  ".....TTT..........TTR.....",
  ".....KTT..........KKR.....",
  ".....TT...........KMR.....",
  "....KTM...........KM......",
  "....KK............KK......",
  "....CCc..........cCC......",
  "....CCC...........CC......",
]
writeSprite("deadcells-beheaded.svg", HERO, HERO_PALETTE)

// Its head alone, three frames side by side: the smoke and the flame shift.
// Shown one frame at a time (steps(3)) beside the name, while thinking, and
// as "loading".
// On its own the head is drawn with a pale rim round the smoke and a hotter,
// wider flame, so it reads on the dark wall of the sidebar as well as on the
// dusk sky. Each frame is 13 by 12.
const HEAD_PALETTE = { ...HERO_PALETTE, H: "#2f3d42", h: "#52646a", o: "#9db4b6", W: "#fffbd6" }
const rimmed = (rows) => {
  const w = rows[0].length + 2
  const grid = [".".repeat(w), ...rows.map((r) => "." + r + "."), ".".repeat(w)].map((r) => [...r])
  const solid = (x, y) => grid[y]?.[x] && grid[y][x] !== "." && grid[y][x] !== "o"
  return grid.map((row, y) => row.map((c, x) => (c === "." && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ? "o" : c)).join(""))
}
const HEAD = [
  [
    "....h.H....",
    "...hHHH.h..",
    "...HHHYHH..",
    "..HHHOYOHH.",
    "..HHPYYYOH.",
    "..HPPYWYOH.",
    "..HHPYYYPH.",
    "..HHHPOPHH.",
    "...HHHHHH..",
    "....HHHH...",
  ],
  [
    ".....Hh....",
    "..h.HHH....",
    "...HHYHHh..",
    "..HHOYYOHH.",
    "..HHPYWYOH.",
    "..HPPYYYOH.",
    "..HHPPYOPH.",
    "..HHHPPOHH.",
    "...HHHHHH..",
    "....HHHH...",
  ],
  [
    "...Hh..h...",
    "...HHH.H...",
    "..hHHHYHH..",
    "..HHHOYYHH.",
    "..HHPYYWOH.",
    "..HHPYYYPH.",
    "..HHOPYPHH.",
    "..HHHOPHHH.",
    "...HHHHHH..",
    "....HHHH...",
  ],
].map(rimmed)
write("deadcells-head.svg", sprite(39, 12, HEAD.map((rows, i) => pixels(rows, HEAD_PALETTE, i * 13, 0)).join("")))

// The theme's mark: head, scarf and shoulders.
writeSprite(
  "deadcells-mark.svg",
  [
    "......h.H.......",
    ".....hHHH.h.....",
    ".....HHHHHH.....",
    "....HHHHYHHH....",
    "....HHPPYOHH....",
    "....HHPYYYOH....",
    "....HHPPYOHH....",
    "....HHHPOHHH....",
    "...DDHHHHHHDD...",
    "..DDMRRRRRRRMC..",
    ".NNBBMMRRRMMSCC.",
    ".NNBBKSMMMMSSSC.",
    "NNNNBKSSSSSSSKN.",
    "NNNNNKNNNNNNNKN.",
    "KKKKKKKNNNNNNN..",
    ".KKKK.DDRRRRDD..",
  ],
  HEAD_PALETTE,
)

// ── What you carry ───────────────────────────────────────────────────────

// A cell: a dark blue orb flecked with light, a cyan heart ringed in cream.
writeSprite(
  "deadcells-cell.svg",
  [
    "....LLLL....",
    "..LLbbbbLL..",
    ".LbbBbbBbbL.",
    ".LbBbwwbbBL.",
    "LbbbwCCwbbbL",
    "LbBwCWWCwbbL",
    "LbbwCWWCwBbL",
    "LbbbwCCwbbbL",
    ".LbBbwwbbbL.",
    ".LbbbbbBbbL.",
    "..LLbbbbLL..",
    "....LLLL....",
  ],
  { L: "#6fd3f2", b: "#1d4fb4", B: "#4a90e6", w: "#f4f0c8", C: "#1edbd2", W: "#ffffff" },
)

// A cell that is spent: the socket it leaves.
writeSprite(
  "deadcells-cell-empty.svg",
  [
    "....LLLL....",
    "..LLbbbbLL..",
    ".LbbbbbbbbL.",
    ".LbbbbbbbbL.",
    "LbbbbBBbbbbL",
    "LbbbBbbBbbbL",
    "LbbbBbbBbbbL",
    "LbbbbBBbbbbL",
    ".LbbbbbbbbL.",
    ".LbbbbbbbbL.",
    "..LLbbbbLL..",
    "....LLLL....",
  ],
  { L: "#56688a", b: "#0c1424", B: "#2a3a5a" },
)

// Gold: a coin, red at the heart, lit from the left.
writeSprite(
  "deadcells-gold.svg",
  [
    "...YYYYY...",
    "..WYYYYYYo.",
    ".WWYOOOOYYo",
    ".WYOOrrOOYo",
    "WYYOrOOrOYo",
    "WYYOrrrOOYo",
    "WYYOrOOrOYo",
    ".YYOOrrOOYo",
    ".YYYOOOOYYo",
    "..YYYYYYYo.",
    "...ooooo...",
  ],
  { Y: "#fcdd2a", W: "#fff6b0", O: "#ff8a1c", r: "#e83a12", o: "#a8521a" },
)

// The health flask as the HUD draws it: a tall triangle, a cork banded red
// and gold, the liquid orange on one side and red on the other.
writeSprite(
  "deadcells-flask.svg",
  [
    ".....RYR.....",
    ".....RYR.....",
    ".....lLl.....",
    ".....lLl.....",
    "....glLpg....",
    "....glLpp....",
    "...gglLppp...",
    "...gglLppp...",
    "..ggglLpppp..",
    "..YYYYWYYYY..",
    ".OOOOOYRRRRR.",
    ".OOOOOYRRRRR.",
    "OOOOOOYRRRRRR",
    "ooooooorrrrrr",
  ],
  { g: "#7c5c5c", p: "#4c2c4e", l: "#9ad0e8", L: "#e0f4ff", Y: "#ffd83a", W: "#fff8c0", O: "#ff9a1c", R: "#e8442a", o: "#c86a10", r: "#a82a20" },
)

// A scroll, shaped as the game draws one: a roll across the head that
// overhangs to the left, a sheet that bellies out, a roll at the foot that
// overhangs to the right. Plain, with lines of writing, for a file; and the
// Scroll of Power, gold with its blue arrow, for a choice to make.
const SCROLL = [
  ".PPPPPPPPPPPP...",
  "PpWWWWWWWWWWWP..",
  "PsPPPPPPPPPPPPs.",
  ".sWWWWWWWWWWWs..",
  "..WWWWWWWWWWWWs.",
  "..WWWWWWWWWWWWs.",
  ".WWWWWWWWWWWWs..",
  ".WWWWWWWWWWWWs..",
  "..WWWWWWWWWWWs..",
  "..WWWWWWWWWWWWs.",
  "...WWWWWWWWWWWs.",
  "..PPPPPPPPPPPPP.",
  ".PsWWWWWWWWWWpsP",
  ".PPPPPPPPPPPPPsP",
  "..ssssssssssss..",
]
const SCROLL_LINES = ["iiiiiii", ".......", "iiiii..", ".......", "iiiiiii", ".......", "iiii..."]
const SCROLL_ARROW = ["...a...", "..aCa..", ".aCCCa.", "aCCCCCa", "aaaCaaa", "..aCa..", "..aCa..", "..aaa.."]
{
  const tan = { W: "#dcc49c", P: "#b89878", p: "#f0e0bc", s: "#7a5a4c", i: "#9a7c64" }
  write("deadcells-scroll.svg", sprite(16, 15, pixels(SCROLL, tan) + pixels(SCROLL_LINES, tan, 4, 4)))
  const gold = { W: "#ffa81c", P: "#ffe23a", p: "#fff6a0", s: "#7a3a08", a: "#2a3aa8", C: "#1ee0f8" }
  write("deadcells-scroll-power.svg", sprite(16, 15, pixels(SCROLL, gold) + pixels(SCROLL_ARROW, gold, 4, 3)))
}

// What a slot holds, one for each tool, all 14 by 14 and each after something
// the game shows: twin daggers (broad curved blades, green stones at the
// guard, pink grips), the meat skewer, a bow with a flaming arrow, a grenade,
// the magnifying glass, the bone key, the green rune, the spear from the
// first room, a scroll, and the head itself — which leaves the body and goes
// off on its own.
const TOOLS = {
  blades: [
    [
      "W............W",
      "WW..........WW",
      "WWW........WWW",
      "gWWW......WWWg",
      "gWWWW....WWWWg",
      ".gWWWW..WWWWg.",
      "..gWGWWWWGWg..",
      "...gWWWWWWg...",
      "....gWWWWg....",
      "...hhgWWghh...",
      "..hPh.gg.hPh..",
      ".hPh......hPh.",
      "wPh........hPw",
      "ww..........ww",
    ],
    { W: "#eef2f4", g: "#8c9ca8", G: "#2fd070", h: "#7a2a44", P: "#ff6a8a", w: "#ffffff" },
  ],
  skewer: [
    [
      "..cC..........",
      ".cCc..........",
      "cCcs..........",
      ".c.ss.........",
      "....sYOO......",
      ".....OOORr....",
      "....YOORRRr...",
      ".....ORRRRr...",
      "......rRRRd...",
      ".......rRds...",
      "........d.ss..",
      "...........sC.",
      "............Cc",
      ".............c",
    ],
    { c: "#3a9ac0", C: "#8fe0f0", s: "#c8d4dc", Y: "#ffd83a", O: "#ff8a1c", R: "#e83a22", r: "#a8201c", d: "#6a1420" },
  ],
  bow: [
    [
      "....bbbBB.....",
      "ROY.b...Bw....",
      "OYOb.....w....",
      "YOCb.....w....",
      ".bbC.....w....",
      ".b..C....w....",
      ".b...C...w....",
      ".b....C..w....",
      ".bb....C.w....",
      "..b.....Cw....",
      "..bb....wC....",
      "...bb..w..C...",
      "....bbBw...C..",
      "......B.....C.",
    ],
    { b: "#5a5ac8", B: "#8a7ae8", w: "#e8e8f4", C: "#3ad0f0", R: "#e83a22", O: "#ff8a1c", Y: "#ffe04a" },
  ],
  grenade: [
    [
      "..........oo..",
      ".........o....",
      "....tttt.o....",
      "..ttTTTTtk....",
      ".tTTLTTTTtk...",
      ".tTLLTTTTTk...",
      "tTTLTTTTTTtk..",
      "tTTTTTTTTTtk..",
      "tTTTTTTTTTkk..",
      ".tTTTTTTTtk...",
      ".ktTTTTTtkk...",
      "..kkttttkk....",
      "....kkkk......",
      "..............",
    ],
    { T: "#2a7a8a", L: "#7fd0d8", t: "#1d5a78", k: "#123a5a", o: "#f08a2a" },
  ],
  glass: [
    [
      "....lllll.....",
      "...lLLLLLl....",
      "..lLdddddLl...",
      "..LddDDDddL...",
      "..LdDDDDDdL...",
      "..LdDDDDDdL...",
      "..LddDDDddp...",
      "..lLdddddLp...",
      "...lLLLLLp....",
      "..wWlpppp.....",
      ".wWp..........",
      "wWp...........",
      "Wp............",
      "..............",
    ],
    { L: "#e8dcf8", l: "#b89ad8", d: "#5a4a6a", D: "#3e3450", p: "#c0607a", W: "#ffffff", w: "#c8c0d8" },
  ],
  key: [
    [
      ".......kkkkk..",
      "......kYYyYYk.",
      ".....kYyk.kYyk",
      ".....kYk...kYk",
      ".....kYyk.kYyk",
      "....kkYYyYYYk.",
      "...kYykkkkkk..",
      "..kYyk........",
      ".kYykYk.......",
      "kYyk.kyk......",
      "kYkYk.k.......",
      ".kkyk.........",
      "...k..........",
      "..............",
    ],
    { Y: "#cfc27c", y: "#8a8250", k: "#2e2a18" },
  ],
  rune: [
    [
      "......gg......",
      ".....gGGg.....",
      "....gGDDGg....",
      "...gGDDDDGg...",
      "..gGDDcDDDGg..",
      ".gGDDDcCDDDGg.",
      ".gGDDDcDDDDGg.",
      ".gGDDDcCDDDGg.",
      ".gGDDDcDDDDGg.",
      "..gGDDcCDDGg..",
      "..gGDDDDDDGg..",
      "...gGDDDDGg...",
      "....gGGGGg....",
      ".....gggg.....",
    ],
    { G: "#3fd84a", g: "#1a6a22", D: "#0a8a3a", c: "#7fe8e0", C: "#b8fff4" },
  ],
  spear: [
    [
      "CC............",
      "CWs...........",
      ".ssO..........",
      "..bOO.........",
      "...bOO........",
      "....bOY.......",
      ".....bOO......",
      "......bOO.....",
      ".......bOO....",
      "........bOY...",
      ".........bOO..",
      "..........bOO.",
      "...........bOs",
      "............ss",
    ],
    { C: "#7fe8e0", W: "#ffffff", s: "#8c9ca8", O: "#ff6a2a", Y: "#ffb040", b: "#5a2a22" },
  ],
}
for (const [name, [rows, palette]] of Object.entries(TOOLS)) writeSprite(`deadcells-${name === "blades" ? "blades" : "tool-" + name}.svg`, rows, palette)
// The scroll and the head, fitted to the same square.
write("deadcells-tool-scroll.svg", sprite(16, 16, pixels(SCROLL, { W: "#dcc49c", P: "#b89878", p: "#f0e0bc", s: "#7a5a4c" }) + pixels(SCROLL_LINES, { i: "#9a7c64" }, 4, 4)))
write("deadcells-tool-head.svg", sprite(14, 14, pixels(HEAD[0], HEAD_PALETTE, 0, 1)))

// The hourglass an item's card shows beside its cooldown.
writeSprite(
  "deadcells-hourglass.svg",
  [
    ".KKKKKKKKK.",
    "KCCCCCCCCCK",
    "KCBBBBBBBCK",
    ".KCOOOOOCK.",
    ".KCOOOOOCK.",
    "..KCOOOCK..",
    "...KCOCK...",
    "..KCkOkCK..",
    ".KCkkOkkCK.",
    ".KCkOOOkCK.",
    "KCBOOOOOBCK",
    "KCCCCCCCCCK",
    ".KKKKKKKKK.",
  ],
  { K: "#2e1006", C: "#f0d8a0", B: "#8a3a10", O: "#f6921c", k: "#5a2408" },
)

// A padlock, red: what the Collector shows on what you cannot have yet.
writeSprite(
  "deadcells-lock.svg",
  [
    "...RRRRR...",
    "..RsssssR..",
    ".Rs.....sR.",
    ".Rs.....sR.",
    "RRRRRRRRRRR",
    "RpppkkkpppR",
    "RppkkkkkppR",
    "RppkkkkkppR",
    "RpppkkkpppR",
    "RppkkkkkppR",
    "RppkkkkkppR",
    "RRRRRRRRRRR",
  ],
  { s: "#b08aa0", R: "#e22c3c", p: "#85546d", k: "#710a12" },
)

// The arrow that bobs over a slot with something new in it.
writeSprite(
  "deadcells-arrow.svg",
  [
    "....k....",
    "...kYk...",
    "..kYYYk..",
    ".kYYYYYk.",
    "kYYYYYYYk",
    "kkkYOYkkk",
    "..kYOYk..",
    "..kOOOk..",
    "..kkkkk..",
  ],
  { k: "#7a1c0a", Y: "#ffd83a", O: "#ff9a1c" },
)

// ── Controls ─────────────────────────────────────────────────────────────

// A box in the settings: dark red, empty …
writeSprite(
  "deadcells-check-off.svg",
  [
    "KKKKKKKKKKKKK",
    "KRRRRRRRRRRRK",
    "KRddddddddrRK",
    "KRdmmmmmmddRK",
    "KRdmmmmmmddRK",
    "KRdmmmmmmddRK",
    "KRdmmmmmmddRK",
    "KRdmmmmmmddRK",
    "KRdmmmmmmddRK",
    "KRddddddddrRK",
    "KRrrrrrrrrrRK",
    "KRRRRRRRRRRRK",
    "KKKKKKKKKKKKK",
  ],
  { K: "#120404", R: "#ad2f0d", d: "#2b0202", m: "#4d0604", r: "#210101" },
)
// … and ticked: a gold cross on orange.
writeSprite(
  "deadcells-check-on.svg",
  [
    "KKKKKKKKKKKKK",
    "KYYYYYYYYYYYK",
    "KYbbbbbbbbbGK",
    "KYbYYbbbYYbGK",
    "KYbYYYbYYYbGK",
    "KYbbYYYYYbbGK",
    "KYbbbYYYbbbGK",
    "KYbbYYYYYbbGK",
    "KYbYYYbYYYbGK",
    "KYbYYbbbYYbGK",
    "KYbbbbbbbbbGK",
    "KYGGGGGGGGGGK",
    "KKKKKKKKKKKKK",
  ],
  { K: "#120404", Y: "#f8d70e", G: "#c68913", b: "#7a3408" },
)

// A slider's knob: grey, ringed in cream, the ring broken at the corners.
writeSprite(
  "deadcells-knob.svg",
  [
    "....CCCCC....",
    "..C.kkkkk.C..",
    ".C.kGGGGGk.C.",
    "..kGGGGGGGk..",
    "CkGGGGGGGGGkC",
    "CkGGGGGGGGGkC",
    "CkGGGGGGGGGkC",
    "CkGGGGGGGGGkC",
    "CkGGGGGGGGGkC",
    "..kGGGGGGGk..",
    ".C.kGGGGGk.C.",
    "..C.kkkkk.C..",
    "....CCCCC....",
  ],
  { C: "#d8d2b8", k: "#2a2c34", G: "#787979" },
)

// A key cap, as the hints at the foot of a menu draw them: white, a grey lip
// below, its corners stepped. A border-image (3 3 4 3, filled).
const KEY = ["..WWWWW..", ".WWWWWWW.", "WWWWWWWWW", "WWWWWWWWW", "WWWWWWWWW", "WWWWWWWWW", "gWWWWWWWg", ".ggggggg.", "..ggggg.."]
writeSprite("deadcells-key.svg", KEY, { W: "#fbfcff", g: "#b9bfcc" })
writeSprite("deadcells-key-red.svg", KEY, { W: "#fb5c4e", g: "#a32a22" })
writeSprite("deadcells-key-off.svg", KEY, { W: "#8b93a8", g: "#5b6278" })

// A panel's frame, as the Collector's and the forge's have: copper, lighter
// stretches along it, a dark line inside, the corner pixel left out. Tiles
// along each side (border-image … round).
function frame(name, c) {
  const W = 30
  const g = canvas(W, W)
  for (let i = 0; i < W; i++) {
    const light = i % 24 >= 3 && i % 24 < 11 // a lighter stretch, a darker one
    const outer = light ? c.light : c.mid
    g.put(i, 0, outer)
    g.put(i, W - 1, light ? c.mid : c.dark)
    g.put(0, i, c.red)
    g.put(W - 1, i, c.mid)
    g.put(i, 1, c.mid)
    g.put(i, W - 2, c.dark)
    g.put(1, i, c.mid)
    g.put(W - 2, i, c.dark)
  }
  for (let i = 2; i < W - 2; i++) {
    g.put(i, 2, c.line)
    g.put(i, W - 3, c.line)
    g.put(2, i, c.line)
    g.put(W - 3, i, c.line)
  }
  // corners: the outermost pixel is left out
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, W - 1], [W - 1, W - 1]]) g.put(x, y, "none")
  write(name, sprite(W, W, g.body().replace(/<rect[^>]*fill="none"\/>/g, "")))
}
frame("deadcells-frame.svg", { light: "#c0703f", mid: "#9a3b28", red: "#b2412c", dark: "#6a2a20", line: "#0a1428" })
frame("deadcells-frame-day.svg", { light: "#c9793f", mid: "#9a3b28", red: "#b2412c", dark: "#6a2a20", line: "#e6cf9f" })

// The rivet inside each corner of a panel.
writeSprite("deadcells-rivet.svg", ["Lc", "cd"], { L: "#f08a5c", c: "#b2412c", d: "#6a2a20" })

// ── The Prisoners' Quarters ──────────────────────────────────────────────
// Stone in teal and blue: courses of blocks, mortar between, each block its
// own shade. `shade(x, y)` is -1 on mortar, else 0, 1 or 2.
function stones(W, H, seed, course = 8) {
  const rnd = random(seed)
  const m = Array.from({ length: H }, () => new Array(W).fill(0))
  for (let r = 0, y0 = 0; y0 < H; r++, y0 += course) {
    let x = -Math.floor(rnd() * 10)
    while (x < W) {
      const w = 9 + Math.floor(rnd() * 8)
      const s = Math.floor(rnd() * 3)
      const chip = rnd() < 0.3
      for (let j = 0; j < course && y0 + j < H; j++) {
        for (let i = 0; i < w; i++) {
          const xx = x + i
          if (xx < 0 || xx >= W) continue
          const edge = i === 0 || j === 0 || (chip && i === 1 && j === 1)
          m[y0 + j][xx] = edge ? -1 : s
        }
      }
      x += w
    }
  }
  return m
}

// The wall behind the sidebar: the same stone, far from any light. It tiles.
{
  const W = 64
  const H = 48
  const g = canvas(W, H)
  const rnd = random(21)
  const tones = ["#14303a", "#17353f", "#122b35"]
  // courses that wrap: block edges at fixed columns per course
  for (let r = 0; r < H / 8; r++) {
    const cuts = []
    let x = Math.floor(rnd() * 6)
    while (x < W) {
      cuts.push(x)
      x += 10 + Math.floor(rnd() * 7)
    }
    for (let j = 0; j < 8; j++) {
      let s = 0
      for (let i = 0; i < W; i++) {
        if (cuts.includes(i)) s = (s + 1 + Math.floor(rnd() * 2)) % 3
        const edge = cuts.includes(i) || j === 0
        g.put(i, r * 8 + j, edge ? "#0d2029" : tones[cuts.length ? (s + r) % 3 : 0])
      }
    }
  }
  write("deadcells-wall.svg", g.svg())
}

// `wide` is the cut for the sign-in page: the window well to the left, the
// Beheaded well to the right, bare wall between them for the box.
function quarters(H = 96, wide = false) {
  const W = wide ? 150 : 130
  const heroX = wide ? 112 : 82
  const g = canvas(W, H)
  const rnd = random(4)
  const wall = stones(W, 96, 9)
  const FLOOR = 86
  const win = { cx: wide ? 30 : 46, top: 16, half: 13, spring: 30, foot: 58 }

  const halfAt = (y) => (y < win.spring ? Math.sqrt(Math.max(0, win.half * win.half - (win.spring - y) * (win.spring - y))) : win.half)
  const inWindow = (x, y) => y >= win.top + 1 && y < win.foot && Math.abs(x - win.cx) <= halfAt(y) - 0.5
  // The beam: a wedge from the window down to the right.
  const beam = (x, y) => {
    const top = 20 + (x - win.cx - 12) * (wide ? 0.3 : 0.56)
    const left = y < 56 ? win.cx - 6 : win.cx - 6 + (y - 56) * 0.8
    if (x < left || y < top || x < win.cx) return 0
    const far = Math.hypot(x - win.cx, y - 40)
    return Math.max(0, 1 - far / (wide ? 150 : 105))
  }
  const light = (x, y) => {
    const d = Math.hypot((x - win.cx) * 0.9, y - 38)
    let l = 0.2 + Math.max(0, 0.62 - d / 62)
    l += 0.42 * beam(x, y)
    l -= Math.max(0, (win.cx - 20 - x) / 60) // the dark to the left
    l -= Math.max(0, (x - (W - 18)) / 90)
    return l
  }
  const STONE = ["#0b2340", "#123048", "#1c3b41", "#24514b", "#3a6150", "#657b56", "#8e975a", "#b9b260", "#dccf6c"]
  for (let y = 0; y < FLOOR; y++) {
    for (let x = 0; x < W; x++) {
      const s = wall[y][x]
      let l = light(x, y)
      l = Math.round(l * 14) / 14
      const c = ramp(STONE, s < 0 ? l - 0.14 : l + (s - 1) * 0.035)
      g.put(x, y, c)
    }
  }

  // A pillar in dark red, at the left.
  for (let y = 0; y < FLOOR && !wide; y++) {
    for (let x = 5; x < 19; x++) {
      const base = x < 7 ? "#7a3034" : x > 15 ? "#3b1820" : "#5a2228"
      g.put(x, y, mix(base, "#0b2340", 0.25 + Math.max(0, (40 - y) / 120)))
    }
    if (y % 14 === 3) for (let x = 5; x < 19; x++) g.put(x, y, "#2f141c")
  }

  // The arch's stones: a ring of lit blocks round the window.
  for (let y = win.top - 7; y < win.foot + 1; y++) {
    for (let x = win.cx - win.half - 8; x <= win.cx + win.half + 8; x++) {
      const h = halfAt(Math.max(y, win.top))
      const dx = Math.abs(x - win.cx)
      let ring
      let gap
      if (y < win.spring) {
        const r = Math.hypot(x - win.cx, y - win.spring)
        ring = r > win.half - 0.5 && r <= win.half + 7
        const a = Math.atan2(win.spring - y, x - win.cx)
        gap = Math.abs(((a / Math.PI) * 9) % 1) < 0.14 || Math.abs(r - (win.half + 7)) < 0.6
      } else {
        ring = dx > h - 0.5 && dx <= h + 7
        gap = (y - win.spring) % 7 === 6 || dx > h + 6.4
      }
      if (!ring) continue
      const l = light(x, y) + 0.2
      g.put(x, y, ramp(STONE, gap ? l - 0.3 : l + (((x + y * 3) % 5) - 2) * 0.012))
    }
  }

  // The window: light through bars.
  for (let y = win.top; y < win.foot; y++) {
    for (let x = win.cx - win.half; x <= win.cx + win.half; x++) {
      if (!inWindow(x, y)) continue
      const bar = (x - win.cx + 40) % 4 === 0
      const edge = Math.abs(x - win.cx) / win.half
      g.put(x, y, bar ? "#f5b54a" : mix("#ffffa6", "#ffe46c", edge * edge))
    }
  }
  // Its sill: an orange ledge, a shelf of stone under it.
  g.rect(win.cx - 15, win.foot, 31, 5, "#f9b556")
  g.rect(win.cx - 13, win.foot + 2, 27, 1, "#c98a3e")
  g.rect(win.cx - 15, win.foot + 4, 31, 1, "#dd9a46")
  for (let x = win.cx - 20; x <= win.cx + 20; x++) {
    g.put(x, win.foot + 5, "#c9bd66")
    g.put(x, win.foot + 6, "#8e975a")
    g.put(x, win.foot + 7, "#657b56")
    if (Math.abs(x - win.cx) < 17) g.put(x, win.foot + 8, "#2c5048")
  }

  // A chain, hanging in front of the window.
  for (let y = 0; y < 32; y++) {
    const x = win.cx - 5
    const link = y % 4
    g.put(x, y, link < 2 ? "#4c5046" : "#2b2f2c")
    if (link === 0) g.put(x + 1, y, "#4c5046")
    if (link === 2) g.put(x - 1, y, "#2b2f2c")
  }
  g.put(win.cx - 5, 32, "#2b2f2c")
  g.put(win.cx - 5, 33, "#2b2f2c")

  // A cage on a chain, and a manacle on the wall.
  const CAGE = [
    "....K....",
    "....k....",
    "....K....",
    "....k....",
    "....K....",
    "...KKK...",
    "..KKKKK..",
    ".KKKKKKK.",
    "KK.K.K.KK",
    "K..K.K..K",
    "K..K.K..K",
    "KKKKKKKKK",
    "K..K.K..K",
    "K..K.K..K",
    "K..K.K..K",
    "K..K.K..K",
    "KKKKKKKKK",
    ".KKoKKKK.",
    "..K..K...",
    "..K......",
  ]
  g.blit(CAGE, { K: "#07121f", k: "#12202e", o: "#9a4a22" }, W - 18, 0)
  if (wide) g.blit(CAGE.slice(2), { K: "#0a1c2c", k: "#12283a", o: "#7a3a1e" }, 76, 0)
  else g.blit(CAGE.slice(4), { K: "#081a30", k: "#0c2038", o: "#081a30" }, 22, 0)
  const MANACLE = ["..KKK..", "..KkK..", ".KKkKK.", "KK...KK", "K.....K", "r......"]
  g.blit(MANACLE, { K: "#16242e", k: "#2a3a44", r: "#6a3a2a" }, wide ? 62 : 70, 44)
  if (wide) g.blit(MANACLE, { K: "#14202a", k: "#26343e", r: "#14202a" }, 96, 50)

  // The floor: dark blocks, their tops catching a little light.
  for (let x = 0; x < W; x++) {
    const block = Math.floor(x / 9)
    const up = block % 3 === 1 ? 1 : 0
    const seam = x % 9 === 0
    for (let y = FLOOR - up; y < H; y++) {
      const top = y === FLOOR - up
      const lit = beam(x, FLOOR) > 0.25
      let c = top ? (lit ? "#2f5a5c" : "#14293e") : y === FLOOR - up + 1 ? "#0b1a2e" : "#061426"
      if (seam && !top) c = "#030a16"
      g.put(x, y, c)
    }
  }

  // The Beheaded, standing in the beam.
  g.blit(HERO, HERO_PALETTE, heroX, FLOOR - HERO.length)

  // Dust in the light.
  for (let i = 0; i < 12; i++) {
    const x = 34 + Math.floor(rnd() * (W - 40))
    const y = 20 + Math.floor(rnd() * 60)
    if (g.get(x, y) && beam(x, y) > 0.1 && !(x > heroX - 2 && x < heroX + 28 && y > 38)) g.put(x, y, i % 3 ? "#f6f0a8" : "#9fe8e0")
  }
  return g
}
write("deadcells-quarters.svg", quarters().svg())
// The same without its floor: the sidebar's foot is the floor.
write("deadcells-quarters-wall.svg", quarters(86).svg())
write("deadcells-quarters-wide.svg", quarters(96, true).svg())

// The floor's blocks, to lay along the top of the sidebar's foot.
writeSprite("deadcells-floor.svg", ["sttttttttsttttttttsHHHHHHHH", "kddddddddkddddddddktttttttt", "kffffffffkffffffffkdddddddd"], { t: "#14293e", H: "#1d3a52", d: "#0b1a2e", f: "#061426", k: "#030a16", s: "#0b1a2e" })

// ── The island at dusk (the title screen) ────────────────────────────────
// The island by itself, on a sheet of its own (130 wide, the water at 82):
// a keep that grows like a tree — one tall tower, a chimney of a tower beside
// it with a gap of sky between, houses stepping down to the left, and to the
// right limbs that carry a spire, a flat-topped tree and a last house out
// over the water; before it a lighthouse on the arch; under it the rock, an
// arch at the left end, square blocks at the right, an undercut cliff, and
// low down the haze the sun burns through.
function island() {
  const W = 130
  const SEA = 82
  const g = canvas(W, 96)
  const KEEP = "#8a586c"
  const KEEP_LIT = "#b47a86"
  const KEEP_DARK = "#6c4459"
  const PINK = "#c48a8c"
  const WINDOW = "#f6a85a"
  const mass = (x0, x1, top, bottom) => {
    for (let x = x0; x <= x1; x++) {
      const jag = (x * 7 + top * 3) % 6 === 0 ? 1 : 0 // a ragged roofline
      for (let y = top + jag; y < bottom; y++) g.put(x, y, KEEP)
    }
  }
  // the body, from the left
  mass(33, 34, 37, 45)
  mass(35, 36, 37, 51)
  mass(37, 37, 37, 60)
  mass(38, 41, 32, 62)
  mass(42, 47, 22, 62) // a house, an aerial on it
  for (const [x, y] of [[42, 21], [42, 20], [43, 20]]) g.put(x, y, KEEP_DARK)
  mass(47, 49, 18, 62)
  mass(50, 53, 8, 62) // the chimney of a tower
  mass(53, 56, 13, 17) // what joins it to the tall one, sky under it
  mass(54, 56, 22, 62)
  mass(55, 65, 14, 62)
  mass(57, 60, 1, 14) // the tall tower, notched at the top
  mass(61, 64, 3, 14)
  mass(65, 70, 22, 56)
  mass(60, 68, 52, 60)
  // limbs to the right: a spire on the first, a bush on the second
  mass(66, 72, 26, 31)
  mass(73, 79, 28, 32)
  mass(74, 74, 18, 28)
  mass(73, 75, 22, 28)
  mass(70, 76, 35, 38)
  mass(77, 82, 33, 36)
  for (const [x, y] of [[80, 32], [81, 31], [82, 32], [83, 33], [81, 32]]) g.put(x, y, KEEP_DARK)
  // the third and longest, rising to the right, a house at its tip
  for (let x = 68; x <= 93; x++) {
    const yc = Math.round(51 - ((x - 70) * 9) / 23)
    const thick = Math.max(2, Math.round(5 - ((x - 68) * 3) / 25)) + ((x * 3) % 5 === 0 ? 1 : 0)
    for (let y = yc; y < yc + thick; y++) g.put(x, y, y === yc ? KEEP : KEEP_DARK)
  }
  mass(90, 92, 40, 43)
  mass(86, 87, 43, 46)
  // the tree on it: a flat crown on a thin trunk
  for (let x = 78; x <= 89; x++) g.put(x, 39, KEEP_DARK)
  for (let x = 80; x <= 87; x++) g.put(x, 38, KEEP_DARK)
  for (const [x, y] of [[82, 37], [83, 37], [86, 37], [79, 40], [84, 40], [88, 40]]) g.put(x, y, KEEP_DARK)
  for (let y = 40; y < 45; y++) g.put(86, y, KEEP_DARK)
  // the side away from the sun is darker, the edge towards it catches light,
  // and here and there a ledge or a buttress shows
  for (let y = 0; y < 64; y++) {
    for (let x = 30; x < 96; x++) {
      if (g.get(x, y) !== KEEP) continue
      if (!g.get(x + 1, y)) g.put(x, y, KEEP_LIT)
      else if (!g.get(x - 1, y) || !g.get(x - 2, y) || x < 41) g.put(x, y, KEEP_DARK)
      else if ((x * 13 + y * 7) % 31 === 0 || ((x + y * 2) % 19 === 0 && y % 4 === 0)) g.put(x, y, KEEP_DARK)
    }
  }
  // paler houses in the body, their doors and windows dark
  g.rect(54, 41, 8, 10, PINK)
  g.rect(65, 45, 5, 6, "#b88088")
  for (const [x, y] of [[55, 43], [58, 43], [60, 46], [56, 48], [66, 47], [68, 49]]) g.put(x, y, KEEP_DARK)
  // the lit side of the tall tower, and openings the sky shows through
  for (let y = 4; y < 13; y++) g.put(63, y, y % 4 === 0 ? KEEP : y % 2 ? "#ffd08a" : WINDOW)
  for (let y = 5; y < 11; y += 2) g.put(62, y, WINDOW)
  for (const [x, y, w, h] of [[58, 24, 1, 3], [52, 26, 1, 2], [45, 25, 1, 2], [44, 29, 1, 1], [60, 33, 2, 2], [67, 36, 1, 2], [47, 38, 1, 2], [40, 40, 1, 2], [57, 54, 1, 3], [49, 47, 1, 2], [39, 50, 1, 1], [51, 15, 1, 2]]) g.rect(x, y, w, h, WINDOW)

  // The lighthouse: a square tower under a pointed roof, its right face lit.
  for (let y = 35; y < 62; y++) {
    const half = y < 41 ? (y - 35) * 0.7 : 3.5
    for (let x = Math.ceil(29.5 - half); x <= Math.floor(29.5 + half); x++) g.put(x, y, y >= 41 && x >= 32 ? "#e09a66" : y >= 41 && x <= 27 ? "#573041" : "#6a3b4c")
  }
  for (let x = 25; x <= 34; x++) g.put(x, 41, "#573041")
  for (const y of [45, 51, 57]) g.put(31, y, "#ffd88a")

  // The rock.
  const ROCK = "#56293c"
  const CLIFF = "#9a3c3a"
  const HAZE = "#f0703c"
  const top = (x) => {
    if (x < 13) return 82 - x * 1.08
    if (x < 26) return 68 - (x - 13) * 0.54
    if (x < 60) return 59.5 + ((x * 5) % 3 === 0 ? 0.5 : 0)
    if (x < 76) return 61
    if (x < 86) return [59, 59, 58, 58, 57, 57, 58, 58, 59, 59][x - 76] // a house
    if (x < 93) return 62
    if (x < 95) return 55
    if (x < 102) return 53 // a tall block
    if (x < 108) return 57
    if (x < 115) return 60 + (x - 108) * 1.6
    return SEA
  }
  const rocks = new Set()
  for (let x = 0; x < W; x++) {
    for (let y = Math.round(top(x)); y < SEA; y++) {
      if (((x - 32) * (x - 32)) / 72 + ((y - SEA) * (y - SEA)) / 144 < 1) continue // the arch
      if (y > 70 && x > 113 - (y - 70) * 0.45) continue // the cliff, undercut
      const depth = Math.max(0, (y - top(x) - 3) / Math.max(1, SEA - top(x) - 3))
      const across = x < 40 ? 0 : x < 70 ? (x - 40) / 30 : x < 106 ? 1 : Math.max(0, 1 - (x - 106) / 10)
      let c = x < 70 ? ROCK : mix(ROCK, CLIFF, Math.min(1, (x - 70) / 22))
      c = mix(c, HAZE, Math.min(1, (Math.round(depth * 6) / 6) * across * 1.2))
      if (x < 74 && y - top(x) < 1) c = "#7a4050"
      g.put(x, y, c)
      rocks.add(x + "," + y)
    }
  }
  // posts and a rope between the house and the tall block
  for (const x of [87, 90]) for (let y = 58; y < 62; y++) g.put(x, y, "#7a3038")
  for (let x = 86; x < 93; x++) if (x % 2) g.put(x, 59, "#7a3038")
  // yellow leaves on the rock
  for (const [x, y] of [[50, 54], [51, 54], [52, 55], [53, 58], [54, 58], [66, 58], [67, 59], [26, 62], [27, 61], [31, 60], [32, 60], [44, 60]]) g.put(x, y, "#ffd24a")
  return { g, rocks }
}

// The whole picture: sky, clouds, the island (moved `ox` across a sheet `W`
// wide), the sea giving it back, a boat, crows, grass on the near shore.
function dusk(H = 96, W = 130, ox = 0) {
  const g = canvas(W, H)
  const rnd = random(12)
  const SEA = 82
  const SKY = ["#8a3040", "#a8444a", "#c45d56", "#d9744f", "#e98a52", "#f3a85c", "#f8c66c", "#fde27c"]
  const sunX = 74 + ox
  for (let y = 0; y < SEA; y++) {
    for (let x = 0; x < W; x++) {
      let t = 0.1 + Math.min(1, (x - ox + 20) / 150) * 0.42 + (y / SEA) * 0.4
      t += Math.max(0, 0.34 - Math.hypot(x - sunX, (y - SEA) * 1.4) / 150)
      g.put(x, y, ramp(SKY, Math.round(t * 16) / 16))
    }
  }
  // Clouds: towers of them, lit gold from below.
  const puff = (cx, cy, r, c) => {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 1 && cy + y < SEA) g.put(cx + x, cy + y, c)
  }
  const cloud = (lobes, shade, lit) => {
    for (const [x, y, r] of lobes) puff(x + ox - 1, y + 1, r + 1, shade)
    for (const [x, y, r] of lobes) puff(x + ox + 1, y - 1, r, lit)
  }
  cloud([[4, 56, 6], [12, 60, 5], [-2, 62, 5]], "#b85a52", "#d0705a")
  cloud([[26, 34, 5], [33, 30, 4], [20, 38, 4]], "#d98858", "#eaa262")
  cloud([[40, 6, 8], [50, 3, 7], [60, 6, 9], [72, 5, 8], [80, 10, 7], [46, 14, 6], [84, 18, 6]], "#eeb060", "#f8cf74")
  cloud([[100, 34, 9], [110, 30, 8], [118, 38, 10], [108, 44, 9], [96, 44, 7], [122, 50, 8], [112, 54, 8], [100, 56, 7]], "#e59a58", "#f6c56c")
  cloud([[120, 66, 7], [108, 70, 6], [128, 72, 6]], "#d97a50", "#eea25c")
  if (W > 130) {
    cloud([[150, 20, 9], [162, 14, 8], [172, 22, 10], [186, 18, 8], [160, 28, 7], [196, 26, 7]], "#eeb060", "#f8cf74")
    cloud([[150, 62, 8], [164, 58, 9], [178, 64, 8], [192, 60, 9], [206, 66, 8]], "#d97a50", "#eea25c")
  }

  const land = island()
  g.lay(land.g, ox, 0)

  // The sea: a bright line, then the sky given back, the rock's shadow in it.
  for (let y = SEA; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = y - SEA
      let c = d === 0 ? "#fff3a8" : ramp(["#ffb04e", "#f08440", "#c9573c", "#a8443c"], d / 13 + Math.abs(x - sunX) / 240)
      // the rock, darker, in streaks that break up with depth
      if (d > 0 && land.rocks.has(x - ox + "," + (SEA - 1 - d)) && (d < 3 || (x + d * 3) % (d + 1) < 2)) c = mix(c, "#8a3540", 0.5)
      if (d > 0 && Math.abs(x - ox - 32) < 7 - d && d % 2 === 1) c = "#ffd670" // the sun, through the arch
      g.put(x, y, c)
    }
  }

  // The boat.
  const BOAT = [
    "......K.......",
    "......K.......",
    ".....kKk......",
    "....k.K.k.....",
    "...KKKK..k....",
    "..KKKKK...k...",
    ".KKKKKKK..k...",
    ".KKKKKK....k..",
    "k.KKKK.....k..",
    "k..KK.K.....k.",
    "k.....K.....kK",
    "KKK...K..KKKKK",
    ".KKKKKKKKKKKK.",
    "..KKKKKKKKKK..",
  ]
  g.blit(BOAT, { K: "#2a1422", k: "#4a2430" }, 52 + ox, SEA - BOAT.length + 1)

  // Crows.
  for (const [x, y] of [[6, 62], [21, 55], [13, 48], ...(W > 130 ? [[150, 44], [168, 50], [184, 40]] : [])]) {
    g.put(x + ox, y, "#2a1422")
    g.put(x + ox + 1, y, "#2a1422")
    g.put(x + ox + 2, y - 1, "#2a1422")
    g.put(x + ox - 1, y - 1, "#2a1422")
    g.put(x + ox + 1, y + 1, "#2a1422")
  }

  // Grass along the near shore, black against the water.
  for (let x = 0; x < W && H > 90; x++) {
    const h = 2 + Math.floor(rnd() * 4) - (x > W - 34 ? 2 : 0)
    for (let y = H - Math.max(0, h); y < H; y++) g.put(x, y, "#1c0e1a")
  }
  return g
}
write("deadcells-dusk.svg", dusk().svg())
// The same down to the waterline: the sidebar's foot is the sea.
write("deadcells-dusk-sky.svg", dusk(83).svg())
// And a wide cut for signing in: the island to the left, open sky to the right.
write("deadcells-dusk-wide.svg", dusk(96, 190, -8).svg())

// ── The Black Bridge by night (the empty page, dark) ────────────────────
// A moon the size of a house behind a mast and its stays, the ribs of a dome
// overhead with spikes hanging from them, a stone bridge on round arches
// rimmed in blue, a brazier burning white, crows on the deck, the Beheaded.
function bridge() {
  const W = 130
  const H = 96
  const g = canvas(W, H)
  const DECK = 66
  const WATER = 86
  const moon = { x: 56, y: 35, r: 17 }
  const sky = (x, y) => {
    let c = ramp(["#2b5180", "#315f91", "#42729a", "#5c86b0"], y / DECK)
    const d = Math.hypot(x - moon.x, y - moon.y)
    if (d < moon.r + 16) c = mix(c, "#ffd9da", Math.round(Math.max(0, 1 - (d - moon.r) / 16) * 0.7 * 6) / 6)
    return c
  }
  for (let y = 0; y < WATER; y++) for (let x = 0; x < W; x++) g.put(x, y, sky(x, y))
  // the moon, its seas a shade darker
  for (let y = -moon.r; y <= moon.r; y++) {
    for (let x = -moon.r; x <= moon.r; x++) {
      if (x * x + y * y > moon.r * moon.r + 2) continue
      const sea = Math.hypot(x + 5, y + 4) < 5 || Math.hypot(x - 6, y - 2) < 4 || Math.hypot(x + 2, y - 8) < 3.2 || Math.hypot(x - 8, y + 8) < 2.4
      g.put(moon.x + x, moon.y + y, sea ? "#f6dc9a" : Math.hypot(x, y) > moon.r - 2 ? "#ffeeb0" : "#fff7c8")
    }
  }
  // the dome's ribs, and the spikes that hang from them
  const shade = (x, y, t = 0.5) => g.put(x, y, mix(g.get(x, y) ?? "#2b5180", "#1c3460", t))
  for (const [cy, r, thick, step, off] of [[172, 164, 3, 9, 2], [196, 170, 2, 11, 6]]) {
    for (let x = 0; x < W; x++) {
      const y0 = Math.round(cy - Math.sqrt(r * r - (x - 65) * (x - 65)))
      for (let t = 0; t < thick; t++) shade(x, y0 + t, 0.45)
      if ((x + off) % step === 0) {
        const len = 5 + ((x * 7) % 9)
        for (let j = 0; j < len; j++) shade(x, y0 + thick + j, 0.5)
        for (const [dx, dy] of [[-1, len - 3], [1, len - 3], [-1, len - 2], [1, len - 2], [0, len], [0, len + 1]]) shade(x + dx, y0 + thick + dy, 0.5)
      }
    }
  }
  // far off: low cloud on the water, a derrick
  for (const [cx, cy, r] of [[6, 62, 4], [14, 63, 3], [100, 60, 4], [108, 62, 5], [118, 61, 4], [126, 63, 3], [40, 63, 3]]) {
    for (let y = -r; y <= 0; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) g.put(cx + x, cy + y, "#5f8cb8")
  }
  const line = (x0, y0, x1, y1, c) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= n; i++) g.put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c)
  }
  for (const [x0, y0, x1, y1] of [[14, 40, 8, 66], [14, 40, 20, 66], [14, 40, 14, 66], [118, 44, 112, 66], [118, 44, 124, 66]]) line(x0, y0, x1, y1, "#274a78")
  // the mast before the moon, and its stays
  line(60, 18, 60, DECK, "#3a2f4c")
  line(61, 22, 61, DECK, "#3a2f4c")
  for (const [x1, y1] of [[46, 60], [76, 58], [86, 64]]) line(60, 21, x1, y1, "#4a3a5a")

  // the rail: posts with a knob, a rail between, a bracket either side
  for (let x = 0; x < W; x++) {
    g.put(x, 58, "#8a4458")
    g.put(x, 59, "#5c2c40")
  }
  for (const x of [5, 31, 57, 83, 109]) {
    g.rect(x, 54, 2, 12, "#7a3a50")
    g.rect(x - 1, 53, 4, 2, "#a85a6c")
    for (const [dx, dy] of [[-2, 60], [-3, 61], [-3, 62], [3, 60], [4, 61], [4, 62]]) g.put(x + dx, dy, "#5c2c40")
  }
  // a brazier on a foot, its flame white
  g.rect(22, 55, 12, 1, "#e08a98")
  g.rect(23, 56, 10, 1, "#b0506a")
  g.rect(24, 57, 8, 2, "#8a3a54")
  g.rect(27, 59, 2, 5, "#6a2c44")
  g.rect(25, 64, 6, 2, "#8a3a54")
  for (const [x, y, c] of [[27, 54, "#fff3c0"], [28, 54, "#ffffff"], [27, 53, "#ffffff"], [28, 53, "#ffffff"], [28, 52, "#fff3c0"], [27, 51, "#ffe9a0"], [28, 50, "#ffd9da"], [26, 54, "#ffd9a0"], [29, 54, "#ffd9a0"]]) g.put(x, y, c)

  // the bridge: a lit edge, dark stone, here and there a brick the moon finds
  const STONE = "#2b2e41"
  for (let y = DECK; y < WATER + 2; y++) {
    for (let x = 0; x < W; x++) {
      const brick = (x * 7 + y * 13) % 37 < 3 && y % 3 === 1
      g.put(x, y, y === DECK ? ((x + 2) % 11 < 8 ? "#c78cba" : "#8a5a86") : brick ? "#7a4a6a" : y % 5 === 4 ? "#22293b" : STONE)
    }
  }
  // round arches rimmed in blue; through them the last pink of the day
  for (const cx of [13, 52, 91, 130]) {
    for (let y = DECK + 4; y < WATER; y++) {
      for (let x = cx - 16; x <= cx + 16; x++) {
        const d = Math.hypot(x - cx, y - WATER)
        if (d <= 13) g.put(x, y, ramp(["#476a94", "#7a7aa8", "#e89ab8", "#ffb4c6"], (y - (WATER - 13)) / 13))
        else if (d <= 15.2) g.put(x, y, (x + y) % 3 === 0 ? "#7fb0f0" : "#3f6fc0")
      }
    }
  }
  // between them a niche, water running from it, a footing in the stream
  for (const cx of [32, 71, 110]) {
    for (let y = DECK + 4; y < DECK + 10; y++) for (let x = cx - 3; x <= cx + 3; x++) if (Math.hypot(x - cx, y - (DECK + 8)) <= 3.4) g.put(x, y, "#476a94")
    for (let y = DECK + 10; y < WATER; y++) for (const dx of [-2, 2]) if ((y + dx) % 4) g.put(cx + dx, y, "#5f86c0")
    g.rect(cx - 8, WATER - 2, 17, 1, "#46587c")
    g.rect(cx - 8, WATER - 1, 17, 3, "#1d2538")
  }
  // the water: blue, the pink and the moon given back
  for (let y = WATER; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = y - WATER
      let c = ramp(["#3a6383", "#2c4a70", "#23314b"], d / 10)
      const under = [13, 52, 91, 130].some((cx) => Math.abs(x - cx) < 12)
      if (under && d < 7 && (d < 2 || (x + d * 2) % 5 > 1)) c = mix(ramp(["#f0a0c0", "#c78cba", "#7b6b98"], d / 6), c, d / 8)
      if (Math.abs(x - moon.x) < 6 - d / 2 && d % 2 === 0) c = mix(c, "#fff7c8", 0.55)
      if ([32, 71, 110].some((cx) => Math.abs(x - cx) < 9) && d < 3) c = "#1d2538"
      g.put(x, y, c)
    }
  }
  // crows on the deck
  const CROW = [".KK..", "KKKk.", ".KKK.", ".KKKK", "..K.."]
  g.blit(CROW, { K: "#10121c", k: "#3a3a4a" }, 68, DECK - 5)
  g.blit(CROW, { K: "#10121c", k: "#3a3a4a" }, 75, DECK - 5)
  // the Beheaded
  g.blit(HERO, HERO_PALETTE, 90, DECK - HERO.length)
  return g
}
write("deadcells-bridge.svg", bridge().svg())

// ── The Promenade of the Condemned (the empty page, light) ───────────────
// Green light between tall trunks, chains slung from one to the next, a cage
// hanging in the bright of it, ledges grown over in purple, a palisade, red
// leaves coming down, the Beheaded on the far ledge.
function promenade() {
  const W = 130
  const H = 96
  const g = canvas(W, H)
  const rnd = random(23)
  const LIGHT = ["#eefff2", "#c9fbe0", "#8fdccc", "#5ccbc8", "#4f9cc4", "#4f6fb4", "#4d4284"]
  const back = (x, y) => {
    const t = Math.abs(x - 54) / 76 + (y / H) * 0.42 - 0.06
    let c = ramp(LIGHT, Math.round(Math.max(0, t) * 14) / 14)
    if (x < 26) c = mix(c, "#f8c4b0", (1 - x / 26) * 0.55) // the warm side
    return c
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g.put(x, y, back(x, y))
  // trunks: far ones barely darker than the light, nearer ones blue, then violet
  const trunk = (x0, w, c, t, lit) => {
    for (let x = x0; x < x0 + w; x++) {
      for (let y = 0; y < H; y++) {
        const wob = (y * 3 + x0) % 29 === 0 ? 1 : 0
        g.put(x + wob, y, x === x0 && lit ? mix(mix(back(x, y), c, t), "#ffffff", 0.18) : mix(back(x, y), c, t))
      }
    }
  }
  for (const [x, w] of [[5, 4], [19, 3], [33, 5], [46, 2], [60, 3], [75, 3], [87, 5], [103, 3], [119, 4]]) trunk(x, w, "#7899a8", 0.38, false)
  const limb = (x0, y0, x1, y1, c, t) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n)
      const y = Math.round(y0 + ((y1 - y0) * i) / n)
      g.put(x, y, mix(back(x, y), c, t))
      if (i < n * 0.6) g.put(x, y + 1, mix(back(x, y + 1), c, t))
    }
  }
  for (const [x, w] of [[11, 5], [39, 6], [66, 7], [95, 5]]) {
    trunk(x, w, "#56609a", 0.78, true)
    limb(x, 18, x - 7, 8, "#56609a", 0.78)
    limb(x + w - 1, 26, x + w + 8, 15, "#56609a", 0.78)
    limb(x + w - 1, 9, x + w + 5, 3, "#56609a", 0.78)
  }
  // chains, slung between the trunks, and a cage hanging in the light
  const chain = (x0, y0, x1, y1, sag, c) => {
    const n = Math.abs(x1 - x0)
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const x = x0 + (x1 - x0) * u
      const y = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * sag
      if (i % 3 !== 2) g.put(x, y, c)
      if (i % 3 === 0) g.put(x, y + 1, c)
    }
  }
  chain(15, 8, 40, 20, 7, "#4a6a8c")
  chain(44, 24, 67, 10, 8, "#4a6a8c")
  chain(72, 30, 96, 40, 6, "#44608a")
  chain(0, 22, 12, 30, 3, "#6a7a9a")
  for (let y = 0; y < 26; y++) if (y % 3 !== 2) g.put(56, y, "#5a6a9c")
  const CAGE = [
    "...KKK...",
    "..KKKKK..",
    ".KK.K.KK.",
    "K.K.K.K.K",
    "K.K.K.K.K",
    "KKKKKKKKK",
    "K.K.K.K.K",
    "K.K.K.K.K",
    "K.K.K.K.K",
    "K.K.K.K.K",
    "K.K.K.K.K",
    "KKKKKKKKK",
    ".KKKKKKK.",
  ]
  g.blit(CAGE, { K: "#5f6fa6" }, 52, 26)
  // near trunks, dark
  for (const [x, w] of [[25, 7], [107, 8]]) {
    trunk(x, w, "#2c1b52", 0.96, true)
    limb(x + w - 1, 14, x + w + 9, 4, "#2c1b52", 0.96)
    limb(x, 34, x - 8, 24, "#2c1b52", 0.96)
  }
  // a palisade on the near ledge: boards with pointed heads
  for (let i = 0; i < 6; i++) {
    const x = 1 + i * 4
    const head = 30 + ((i * 5) % 4)
    for (let y = head; y < 52; y++) for (let dx = 0; dx < 3; dx++) g.put(x + dx, y + (dx === 1 ? -1 : 0), dx === 0 ? "#4e466e" : "#3a3458")
    g.put(x + 1, head + 6, "#24203c")
    g.put(x + 1, head + 14, "#24203c")
  }
  g.rect(0, 38, 24, 1, "#2c2848")
  // ledges and the ground, overgrown: leaves in lumps, lighter where the light falls
  const ledge = (x0, x1, top, seed) => {
    const r = random(seed)
    for (let x = x0; x <= x1; x++) {
      const bump = Math.round(Math.sin(x * 0.9 + seed) * 1.2 + r() * 1.4)
      for (let y = top - bump; y < H; y++) {
        const d = y - (top - bump)
        g.put(x, y, d === 0 ? "#7a4aa0" : d < 3 ? ((x + y) % 3 === 0 ? "#61316d" : "#3c2468") : d < 9 ? ((x * 3 + y * 5) % 11 === 0 ? "#3c2468" : "#2c1b52") : "#1c1247")
      }
      if (r() < 0.16) for (let j = 1; j < 4; j++) g.put(x, top - bump - j, j === 3 ? "#9a5ab8" : "#61316d") // a frond
    }
  }
  ledge(0, 30, 52, 3)
  ledge(82, 129, 60, 8)
  ledge(0, 129, 89, 5)
  // under the far ledge, a frame of timber
  for (const x of [84, 96]) g.rect(x, 66, 2, 23, "#3a3458")
  g.rect(84, 72, 14, 2, "#4e466e")
  for (let i = 0; i < 12; i++) g.put(85 + i, 74 + i, "#3a3458")
  // red leaves, falling
  for (let i = 0; i < 9; i++) {
    const x = 6 + Math.floor(rnd() * 118)
    const y = 6 + Math.floor(rnd() * 70)
    g.put(x, y, "#c8324a")
    g.put(x + 1, y + (i % 2 ? 1 : -1), "#e0506a")
  }
  // the Beheaded, on the far ledge
  g.blit(HERO, HERO_PALETTE, 99, 59 - HERO.length)
  return g
}
write("deadcells-promenade.svg", promenade().svg())

// Dust in the air: a few specks on a sheet that tiles, used as a mask so the
// page can colour them.
{
  const rnd = random(77)
  let s = ""
  for (let i = 0; i < 9; i++) {
    const size = i % 4 === 0 ? 2 : 1
    s += `<rect x="${Math.floor(rnd() * 156)}" y="${Math.floor(rnd() * 156)}" width="${size}" height="${size}" fill="#ffffff" opacity="${(0.45 + rnd() * 0.55).toFixed(2)}"/>`
  }
  write("deadcells-motes.svg", sprite(160, 160, s))
}
