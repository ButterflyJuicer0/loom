import { pixels, random, sprite, write } from "./lib.mjs"

// ── Celeste ──────────────────────────────────────────────────────────────
// Pixel redraws after the game's own screens (Steam's screenshots and the
// Celeste wiki's entity pictures, looked at, never copied): the Prologue's
// cabin and lamp post on snow over blue ice, Golden Ridge's pink dusk and
// prayer flags, the dialogue box with its twig corners, a zip mover and its
// traffic light, dream blocks, dash crystals, crystal hearts, golden
// feathers, B-side cassettes, springs, spikes, the checkpoint plaque, the
// gondola, the memorial and the campfire, the chapters' icons, and Madeline
// with her hair red, blue or pink. Strawberries only where something has
// been collected.

// ── Tools ────────────────────────────────────────────────────────────────

const pad = (rows) => {
  const w = Math.max(...rows.map((r) => r.length))
  return rows.map((r) => r.padEnd(w, "."))
}

// A dark line around a drawing: every empty square beside a filled one.
function outline(rows, ch = "K") {
  const src = pad(rows).map((r) => "." + r + ".")
  const blank = ".".repeat(src[0].length)
  const g = [blank, ...src, blank]
  return g.map((row, y) =>
    [...row]
      .map((c, x) => {
        if (c !== ".") return c
        const beside = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== ".")
        return beside ? ch : "."
      })
      .join(""),
  )
}

const mirror = (rows) => pad(rows).map((r) => [...r].reverse().join(""))
const beside = (...frames) => {
  const fs = frames.map(pad)
  const h = Math.max(...fs.map((f) => f.length))
  return Array.from({ length: h }, (_, y) => fs.map((f) => f[y] ?? ".".repeat(f[0].length)).join(""))
}
const draw = (name, rows, palette) => {
  const g = pad(rows)
  write(name, sprite(g[0].length, g.length, pixels(g, palette)))
}

// A sheet of squares to paint on, for the scenes.
class Canvas {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.c = Array.from({ length: h }, () => new Array(w).fill(null))
  }
  px(x, y, col) {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.c[y][x] = col
    return this
  }
  rect(x, y, w, h, col) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, col)
    return this
  }
  line(x0, y0, x1, y1, col) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, col)
    return this
  }
  blit(rows, palette, ox, oy) {
    pad(rows).forEach((r, y) => [...r].forEach((ch, x) => palette[ch] && this.px(ox + x, oy + y, palette[ch])))
    return this
  }
  body() {
    let s = ""
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; ) {
        const col = this.c[y][x]
        let n = 1
        while (x + n < this.w && this.c[y][x + n] === col) n++
        if (col) s += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${col}"/>`
        x += n
      }
    }
    return s
  }
  save(name) {
    write(name, sprite(this.w, this.h, this.body()))
  }
}

const K = "#1b1428"

// ── Madeline: red hair with a dash in hand, blue once it is spent, pink
// with two ───────────────────────────────────────────────────────────────

const MADELINE = [
  "..HHHHH..",
  ".HHHHHHH.",
  "HHHHHHHHH",
  "HHhHHSSSH",
  "HHhSSeSeS",
  "HHhSSSSS.",
  ".HhJBBBJ.",
  "HH.JBBBJS",
  ".h.JBBBJ.",
  "...LLLL..",
  "...L..L..",
  "..FF..FF.",
]
const HEAD = [".HHHHH.", "HHHHHHH", "HHhHSSH", "HhSeSeS", "HhSSSS.", ".h....."]
const HAIR = {
  red: { H: "#c83a3a", h: "#8a2230" },
  blue: { H: "#48b0f8", h: "#2c7fd6" },
  pink: { H: "#ff7ef0", h: "#c850c8" },
}
const BODY = { S: "#f4c9a0", e: "#2a1830", J: "#8a4030", B: "#5878f8", L: "#3a2a4e", F: "#a85a3a", K }
// Whole, where she stands or runs; her head alone, where a row needs a mark.
for (const name of ["red", "blue"]) draw(`celeste-madeline-${name}.svg`, outline(MADELINE), { ...BODY, ...HAIR[name] })
for (const name of ["blue", "pink"]) draw(`celeste-head-${name}.svg`, outline(HEAD), { ...BODY, ...HAIR[name] })
// The trail a dash leaves: her shape, in one colour.
draw("celeste-trail.svg", pad(MADELINE).map((r) => r.replace(/[^.]/g, "T")), { T: "#2c6fd0" })
draw("celeste-mark.svg", outline(MADELINE), { ...BODY, ...HAIR.red })

// The skull the game counts deaths with.
draw("celeste-skull.svg", outline([".WWWWW.", "WWWWWWW", "WkkWkkW", "WkkWkkW", "WWWkWWW", ".WWWWW.", ".WkWkW."]), { W: "#f4f0f8", k: "#3a2a4e", K })

// The face in the dialogue box, after the game's portrait of her: the head
// turned three-quarters, hair down the near side, one long bang falling
// between the eyes, the near eye wide with its white showing, a blush under
// each, a small smile, the blue scarf.
draw(
  "celeste-portrait.svg",
  [
    "hhhhhHHHHHHHHHhHHHHHhhhh",
    "hhhhHHHHHHHHHhHHHHHHhhhh",
    "hhhHHHHHHHHHhHHHHhHHHhhh",
    "hHHHHHHhhHHhHHHHhHHHHhhh",
    "hHHHhhPPPhhHHHHhPPhHHhhh",
    "HHhhPPPPPPhHHHhPPPPhHhhh",
    "HHhPPEEEEEPhHHhPPEEPhhhh",
    "HHhPEEEEEEEhHHhPEEEEhhhh",
    "HHhPWWWEEEEPhHhPEEEEDhhh",
    "HHhPWWWGEEEPPhhSEWEEDhhh",
    "HHhPSWWWEEESPhSSEEEEDhhh",
    "HHhCSSSSEESSSSSSSEESDhhh",
    "HHhCCDDDDSSSSSSSSSCCDhhh",
    "HHhhCSSSSSSSSSSSSSSCDhhh",
    "HHHhPSSSSSSSSSnnSSSDhhhh",
    "HHHhPPSSSSSSSSnSSSSDhhhh",
    "hHHhPPPSSSSSSSSSSSSDhhhh",
    "hHHHhPPPSSmSSSSmSSDhhhhh",
    "hhHHhhPPPSSmmmmSSDhhhhhh",
    "hHHBBhhPPPPSSSSSDDBhhhhh",
    "hHBBBBBhhhhDDDDDBBBhhhhh",
    "hBBBbbbbbBBBBBBBBBBhhhhh",
    "hBBBBbbbbbbBBBBBBBhhhhhh",
    "DDDDDDDDDDDDDDDDDDDDDDDD",
  ],
  { H: "#f04428", h: "#801020", D: "#380010", P: "#f8a078", S: "#fdf4c8", E: "#141018", W: "#ffffff", G: "#b8b8c0", C: "#f05030", m: "#801020", n: "#e88868", B: "#3058c8", b: "#30a0d0" },
)

// ── What is collected, and the marks beside a line of text ──────────────

// A strawberry, and a golden one: a box ticked, a session pinned.
const BERRY_S = ["...g...", ".gtggg.", ".RpRpR.", "RRoRRRR", "RRRRoRR", ".RrRRr.", "..RrR..", "...R..."]
const RED_BERRY = { g: "#a4ff6b", t: "#6fd8a8", p: "#a050c0", R: "#ff5a68", o: "#ff9a8a", r: "#f03a6e", K: "#4a1830" }
const GOLD_BERRY = { g: "#a4ff6b", t: "#6fd8a8", p: "#c08020", R: "#ffe040", o: "#fff8b0", r: "#f0b020", K: "#5a3a10" }
draw("celeste-berry-s.svg", outline(BERRY_S), RED_BERRY)
draw("celeste-goldberry-s.svg", outline(BERRY_S), GOLD_BERRY)

// One with wings, beating them: what is not yet read. Wings up, then down.
const WING_S_UP = ["ww..", "wWw.", ".wWW", "..wW", "....", "....", "....", "...."]
const WING_S_DOWN = ["....", "....", ".wWW", "wWWW", "ww..", "....", "....", "...."]
const WINGS = { W: "#f4faff", w: "#b4d0f4" }
const wingedSmall = (wing) => outline(beside(wing, BERRY_S, mirror(wing)))
draw("celeste-unread-a.svg", wingedSmall(WING_S_UP), { ...RED_BERRY, ...WINGS })
draw("celeste-unread-b.svg", wingedSmall(WING_S_DOWN), { ...RED_BERRY, ...WINGS })

// A dash crystal: a list's dot, a device that is there.
draw("celeste-crystal-s.svg", outline(["..W..", ".WgW.", "WgGgW", ".WgW.", "..W.."]), { W: "#f0fcc0", g: "#8ee86a", G: "#4cc060", K: "#1f5a3a" })

// A crystal heart: blue for a chapter's own, red for its B-side, gold for
// its C-side.
const HEART_S = outline([".CC.CC.", "CWbCbbC", "CbbbbbC", ".CbbbC.", "..CbC..", "...C..."])
draw("celeste-heart-s.svg", HEART_S, { C: "#a8f4ff", b: "#58b8f8", W: "#ffffff", K: "#20408a" })
draw("celeste-heart-s-red.svg", HEART_S, { C: "#ffb0b8", b: "#f04860", W: "#ffffff", K: "#701030" })
draw("celeste-heart-s-gold.svg", HEART_S, { C: "#fff0a0", b: "#f8c030", W: "#ffffff", K: "#7a4a10" })

// A golden feather.
draw("celeste-feather-s.svg", outline(["..YY.", ".YyYW", "YYyYY", "YYyYY", ".YyY.", ".YyY.", "..y..", "..y.."]), { Y: "#ffe030", y: "#d89a10", W: "#fff8b0", K: "#5a3a10" })

// ── A picture for each tool, from what the game has ─────────────────────

// Bash: a zip mover's cog.
draw("celeste-tool-bash.svg", outline([".G.G.G.", "GgGGGgG", ".GGdGG.", "GGd.dGG", ".GGdGG.", "GgGGGgG", ".G.G.G."]), { G: "#9a9aac", g: "#c8c8d8", d: "#4a4a5c", K })
// Read: the journal, red with its blue bookmark.
draw("celeste-tool-read.svg", outline([".RRRRR.", "RRdddRR", "RRRRRRr", "RRRRRRr", "RRRRRRr", "WWWWWWr", ".Brrrr."]), { R: "#d84458", r: "#a02c40", d: "#6a1428", W: "#fff0e0", B: "#3a8af0", K })
// Grep and Glob: the lookout's binoculars on their post.
draw("celeste-tool-look.svg", outline([".WWWWW.", "WWWWWWw", "WLLWLLw", "WLLWLLw", ".wwwww.", "..kkk..", "...k..."]), { W: "#e8ecf4", w: "#a8b0c4", L: "#28346a", k: "#3a3a4e", K })
// Edit: a golden feather, held as a quill.
draw("celeste-tool-edit.svg", outline(["....YY.", "...YYYW", "..YyYY.", ".YYyY..", ".YyYY..", "..y....", ".y....."]), { Y: "#ffe030", y: "#d89a10", W: "#fff8b0", K: "#5a3a10" })
// Write: a postcard.
draw("celeste-tool-write.svg", outline(["PPPPPPP", "PrrrrBP", "PrPPPBP", "PrlllrP", "PrPPPrP", "PrrrrrP", "PPPPPPP"]), { P: "#f6ede4", r: "#d4a8a4", l: "#b89088", B: "#78a8e8", K: "#5a4048" })
// The web: the bird that comes and goes.
draw("celeste-tool-web.svg", outline([".b...b.", ".bb.bb.", "..bbbb.", ".BBBeOO", "BBBBBB.", ".pBBB..", "..o.o.."]), { b: "#8ccaf8", B: "#4a8ae8", p: "#5a4aa8", e: "#141018", O: "#f8a040", o: "#f8a040", K })
// Another agent: the other self, her hair violet and her eyes red.
draw("celeste-tool-agent.svg", outline(HEAD), { H: "#d858e8", h: "#8a2aa8", S: "#ecd4f0", e: "#ff2848", K: "#2a1038" })
// A tool from somewhere else (MCP): the gondola that goes there.
draw("celeste-tool-mcp.svg", outline(["..www..", "...m...", ".HHHHH.", "MgMgMgM", "MgMgMgM", "HHHHHHH", ".MMMMM."]), { w: "#c0c0e0", m: "#565684", H: "#c0c0e0", M: "#8c8cb8", g: "#1a2a60", K })

// Spikes.
draw("celeste-spikes-s.svg", outline([".W..W.", ".W..W.", "WWsWWs", "WWsWWs"]), { W: "#ffffff", s: "#b8d4f0", K: "#8a1c34" })

// A key, as the game's: a round bow pierced four times about its middle, the
// shank running up from it, one tooth near the tip.
draw(
  "celeste-key.svg",
  outline(["YY.......", ".YY......", "Y.YY.....", "YY.YY....", "....YY...", "....YYYY.", "....YYdYy", "....YdYdy", "....YYdYy", ".....yyy."]),
  { Y: "#ffe030", y: "#e8a818", d: "#7a2040", K: "#5a1a30" },
)

// ── Machines ─────────────────────────────────────────────────────────────

// A zip mover's light: at rest, going, and stopped.
const LIGHT = [".SSSSS.", "SkkkkkS", "SkRRRkS", "SkRRRkS", "SkkkkkS", "SkOOOkS", "SkOOOkS", "SkkkkkS", "SkGGGkS", "SkGGGkS", "SkkkkkS", ".SSSSS."]
const HOUSING = { S: "#b8c4d4", k: "#23263a", K }
draw("celeste-light.svg", outline(LIGHT), { ...HOUSING, R: "#6a2c40", O: "#5c4428", G: "#1f4a3a" })
draw("celeste-light-go.svg", outline(LIGHT), { ...HOUSING, R: "#4a2434", O: "#4a3824", G: "#5cf08a" })
draw("celeste-light-stop.svg", outline(LIGHT), { ...HOUSING, R: "#ff5a7a", O: "#4a3824", G: "#1f4a3a" })

// The cog at the end of its track, and the track.
draw(
  "celeste-cog.svg",
  ["...G.G...", ".G.GGG.G.", "..GgGgG..", "GGGGdGGGG", ".GGd.dGG.", "GGGGdGGGG", "..GgGgG..", ".G.GGG.G.", "...G.G..."],
  { G: "#8a8a9c", g: "#a8a8b8", d: "#4a4a5c" },
)
draw("celeste-rail.svg", [".t..t...", "TTTTTTTT"], { T: "#8a5058", t: "#c08088" })

// The block itself, small, to run along the rail while a step runs.
draw("celeste-zip.svg", outline(["SSSSSSSSSS", "SddSGGSddS", "SddSGGSddS", "SSSSSSSSSS"]), { S: "#b8c4d4", d: "#3a3f58", G: "#5cf08a", K })

// A spring: the plate, the coil, the foot.
draw(
  "celeste-spring.svg",
  outline(["OOOOOOOOOOOO", "oOOOOOOOOOOo", ".oooooooooo.", "....ssss....", "...S....S...", "....ssss....", "...S....S...", "..GGGGGGGG..", ".GgGGGGGGgG."]),
  { O: "#f0983a", o: "#b86420", s: "#8a8a9c", S: "#c8c8d4", G: "#8a96a8", g: "#c8d4e0", K },
)

// The bell on the hotel's front desk.
draw(
  "celeste-bell.svg",
  outline(["....kk....", "...SSSS...", "..SWSSSs..", ".SWSSSSSs.", ".SSSSSSss.", "SSSSSSSsss", ".DDDDDDDD.", "DDdDDDDdDD"]),
  { S: "#d4dce6", W: "#ffffff", s: "#98a4b8", k: "#3a2a4e", D: "#8a5440", d: "#b87858", K },
)

// ── The chapters' icons, small ───────────────────────────────────────────

// Forsaken City: a green road sign with a skyline.
draw(
  "celeste-ch-city.svg",
  [".DDDDDDDDDD.", "DGGGGGGGGGGD", "DGGGGLGGGGGD", "DGGGGLGLLGLD", "DGLLGLLLLGLD", "DGLLLLLLLLLD", "DGGGGGGGGGGD", ".DDDDDDDDDD.", ".....SS.....", ".....Ss.....", ".....Ss....."],
  { D: "#1f6a3c", G: "#4fb868", L: "#d0f8d8", S: "#a8b4c0", s: "#788494" },
)
// Old Site: a torn red banner with a tower on it.
draw(
  "celeste-ch-site.svg",
  ["BBBBBBBBBBBB", ".RRRRRRRRRR.", ".RRdRdRdRRR.", ".RRdddddRRR.", ".RRRdddRRRR.", ".RRRdddRRRR.", ".RRdddddRrR.", ".RRRRRRRRrR.", ".RR.RRR.RrR.", ".R...R...rR.", ".....R....R."],
  { B: "#6a3a30", R: "#c0402c", r: "#8a2420", d: "#5a1418" },
)
// Celestial Resort: a scroll under a tiled roof, a dust bunny on it.
draw(
  "celeste-ch-resort.svg",
  ["..RRRRRRRR..", ".RrRRrRRrRR.", "RRRrRRrRRrRR", "..CCCCCCCC..", "..CCkkkkCC..", "..CkkwkwkC..", "..CkkkkkkC..", "..CCkkkkCC..", "..CCCCCCCC..", ".BBBBBBBBBB."],
  { R: "#d04838", r: "#8a2428", C: "#fff0c8", k: "#3a1420", w: "#ffffff", B: "#8a5440" },
)
// Golden Ridge: a purple rock under snow, the gondola on it.
draw(
  "celeste-ch-ridge.svg",
  ["...WWWWWW...", "..WWWWWWWW..", ".WWwPPPwWWW.", ".PPPPPdPPPP.", "PPPPPdPdPPPP", "PPPdddddddPP", "PPPdPdPdPdPP", "PPPdddddddPP", ".PPPdPPPdPP.", "..PPPPPPPP..", "...PPPPPP..."],
  { W: "#ffffff", w: "#c8d8f0", P: "#9a78c0", d: "#3a2458" },
)
// Mirror Temple: a carved block — a lintel on two pillars round a dark
// mirror — the blue eye in its socket on an arm above, two spikes beneath.
draw(
  "celeste-ch-temple.svg",
  [".OOO........", "OBWOOOOOOO..", "OBBOoooooo..", ".Oo.OOOOOOOO", ".Oo.OddddddO", ".Oo.OOdmmdOO", ".oo.OOdMmdOo", "....OOdmMdOo", "....OdOOOOdo", "....Oooooooo", ".....W..W..."],
  { O: "#d07038", o: "#8e4422", d: "#5a2414", m: "#3a1a2c", M: "#c898a8", B: "#2a5ae0", W: "#e4ecff" },
)

// The Summit's flag, flying: two frames side by side.
const FLAG_A = ["P...........", "PTTTTTTTT...", "PTTTdTTTTTT.", "PTTdTdTTTT..", "PTdTTTdTdTT.", "PTTTTTTTTT..", "PTTTTTTT....", "P...........", "P...........", "P...........", "P..........."]
const FLAG_B = ["P...........", "PTTTTTTT....", "PTTTdTTTTT..", "PTTdTdTTTTT.", "PTdTTTdTdT..", "PTTTTTTTTTT.", "PTTTTTTTT...", "P...........", "P...........", "P...........", "P..........."]
const FLAG = { P: "#c06838", T: "#38d8b0", d: "#167868", K }
draw("celeste-flag-a.svg", outline(FLAG_A), FLAG)
draw("celeste-flag-b.svg", outline(FLAG_B), FLAG)

// A peak under snow, for a heading.
draw("celeste-peak.svg", outline(["....W....", "...WWW...", "..WWwWW..", ".WPwPPwW.", "PPPPPPPPP"]), { W: "#ffffff", w: "#c8d8f0", P: "#8068b8", K: "#3a2a5e" })

// A checkpoint's flag, as on its plaque.
draw("celeste-check.svg", ["F.FFFFF", "FFFFFFF", "FFFFFFF", ".FF.FFF", "......F", "......F", "......F"], { F: "#c888e0" })

// A postcard's stamp: the mountain, not a country.
draw(
  "celeste-stamp.svg",
  ["P.P.P.P.P.P", ".BBBBBBBBB.", "PBBBBWBBBBP", ".BBBWWWBBB.", "PBBWWMWWBBP", ".BWMMMMMWB.", "PBMMMMMMMBP", ".BMMMMMMMB.", "PBBBBBBBBBP", ".PPPPPPPPP.", "P.P.P.P.P.P"],
  { P: "#f4ebe2", B: "#78a8e8", W: "#ffffff", M: "#8068b8" },
)

// ── Frames, as border-images ─────────────────────────────────────────────

// The dialogue box: a dark box, a carved twig hooked round each corner and
// standing proud of it.
{
  const TWIG = [
    "..mm........",
    ".mMMm.mmmmm.",
    "mMmmMMMMMMMm",
    "mM.mMmmmmmm.",
    ".mMMm.......",
    ".mMm........",
    "mMm.........",
    "mM..........",
    "mM..........",
    "mMm.........",
    ".mm.........",
    "............",
  ]
  const pal = { M: "#8a6c88", m: "#4e3a52" }
  const c = new Canvas(32, 32)
  c.rect(4, 4, 24, 24, "#201820")
  c.rect(5, 5, 22, 1, "#2c2230").rect(5, 5, 1, 22, "#2c2230")
  c.blit(TWIG, pal, 0, 0)
  c.blit(mirror(TWIG), pal, 20, 0)
  c.blit([...TWIG].reverse(), pal, 0, 20)
  c.blit(mirror([...TWIG].reverse()), pal, 20, 20)
  c.save("celeste-dialog.svg")
}

// The knot carved at the middle of the box's upper edge.
draw(
  "celeste-knot.svg",
  ["...mmm.....mmm...", ".mMMMMMm.mMMMMMm.", "mMm...mMMMm...mMm", "mM..m..mMm..m..Mm", ".mMMMm..m..mMMMm.", "..mmm.......mmm.."],
  { M: "#8a6c88", m: "#4e3a52" },
)

// A postcard: cream paper, a dusty-rose line inside its edge. And one that
// has been out at night.
for (const [name, p] of [
  ["celeste-postcard.svg", { edge: "#cdb8ac", paper: "#f6ede4", line: "#d4a8a4" }],
  ["celeste-postcard-night.svg", { edge: "#0a0818", paper: "#1c1a34", line: "#5a4a80" }],
]) {
  const c = new Canvas(16, 16)
  c.rect(0, 0, 16, 16, p.edge).rect(1, 1, 14, 14, p.paper)
  c.rect(3, 3, 10, 1, p.line).rect(3, 12, 10, 1, p.line).rect(3, 3, 1, 10, p.line).rect(12, 3, 1, 10, p.line)
  // The corner of the paper, clipped.
  for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) c.px(x, y, null)
  c.save(name)
}

// A zip mover's block: a steel band with a bolt in each corner.
for (const [name, p] of [
  ["celeste-metal.svg", { out: "#3a4460", hi: "#f4f8fc", band: "#b4c0d0", lo: "#7c8aa0", in: "#5a6680", fill: "#e4eaf2" }],
  ["celeste-metal-night.svg", { out: "#0c0a18", hi: "#c8d4e4", band: "#8a96ac", lo: "#566078", in: "#14121e", fill: "#262a3e" }],
]) {
  const c = new Canvas(16, 16)
  c.rect(0, 0, 16, 16, p.out).rect(1, 1, 14, 14, p.band).rect(1, 1, 14, 1, p.hi).rect(1, 1, 1, 14, p.hi)
  c.rect(1, 14, 14, 1, p.lo).rect(14, 1, 1, 14, p.lo).rect(3, 3, 10, 10, p.in).rect(4, 4, 8, 8, p.fill)
  for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) c.rect(x, y, 2, 2, p.lo).px(x, y, p.out)
  for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) c.px(x, y, null)
  c.save(name)
}

// A girder's face, for the small square buttons; a plank, for the ones with
// words on them.
for (const [name, p] of [
  ["celeste-girder.svg", { out: "#3a4a78", hi: "#ffffff", lo: "#a8b8cc", fill: "#e6edf4" }],
  ["celeste-girder-night.svg", { out: "#05060f", hi: "#a8bccc", lo: "#55657c", fill: "#1a2140" }],
  ["celeste-plank.svg", { out: "#3a1c20", hi: "#c88a60", lo: "#6a3c34", fill: "#93583f" }],
  ["celeste-plank-night.svg", { out: "#0a0612", hi: "#b47a54", lo: "#573028", fill: "#804a36" }],
]) {
  const c = new Canvas(12, 12)
  c.rect(0, 0, 12, 12, p.out).rect(1, 1, 10, 10, p.fill).rect(1, 1, 10, 1, p.hi).rect(1, 1, 1, 10, p.hi)
  c.rect(1, 10, 10, 1, p.lo).rect(10, 1, 1, 10, p.lo)
  for (const [x, y] of [[0, 0], [11, 0], [0, 11], [11, 11]]) c.px(x, y, null)
  c.save(name)
}

// A checkpoint's plaque: indigo, its corners taken off.
{
  const c = new Canvas(12, 12)
  c.rect(0, 0, 12, 12, "#484888").rect(1, 0, 10, 1, "#343470").rect(1, 11, 10, 1, "#343470")
  for (const [x, y] of [[0, 0], [11, 0], [0, 11], [11, 11]]) c.px(x, y, null)
  c.save("celeste-plaque.svg")
}

// A dream block's edge: one white line that wanders, black inside it. The
// corners are 4 squares; the 32 between them repeat along each side.
{
  const N = 40
  const c = new Canvas(N, N)
  const INK = "#05050d"
  const LINE = "#ffffff"
  // How far in the line runs at each step along an edge.
  const wobble = Array.from({ length: N }, (_, i) => (i >= 14 && i < 25 ? 1 : 0))
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x >= wobble[y] && x <= N - 1 - wobble[y] && y >= wobble[x] && y <= N - 1 - wobble[x]) c.px(x, y, INK)
  for (let i = 0; i < N; i++) c.px(i, wobble[i], LINE).px(i, N - 1 - wobble[i], LINE).px(wobble[i], i, LINE).px(N - 1 - wobble[i], i, LINE)
  for (const [x, y] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) c.px(x, y, null)
  c.save("celeste-dream.svg")
}

// The stars inside a dream block: crosses and specks in four colours.
{
  const rnd = random(77)
  const c = new Canvas(72, 72)
  const tints = ["#e84848", "#58c858", "#48c8f0", "#4868e8", "#98d058", "#e84848"]
  for (let i = 0; i < 12; i++) {
    const x = 2 + Math.floor(rnd() * 68)
    const y = 2 + Math.floor(rnd() * 68)
    const col = tints[i % tints.length]
    c.px(x, y, col)
    if (i % 3 === 0) c.px(x - 1, y, col).px(x + 1, y, col).px(x, y - 1, col).px(x, y + 1, col)
  }
  c.save("celeste-dreamstars.svg")
}

// Ground with snow lying on it and blue ice under the snow, as every ledge
// in the game: the page's own edge and the composer's. By day the rock is
// Golden Ridge's purple.
for (const [name, p] of [
  ["celeste-terrain-night.svg", { snow: "#ffffff", shade: "#d3e6f2", ice: "#5888f8", deep: "#4068e0", gap: "#0a0e20" }],
  ["celeste-terrain.svg", { snow: "#ffffff", shade: "#e4d8f4", ice: "#8a70b8", deep: "#685090", gap: "#f9f1f7" }],
]) {
  const c = new Canvas(24, 24)
  const rnd = random(9)
  // Top: snow, its underside ragged, ice showing through.
  for (let x = 0; x < 24; x++) {
    c.rect(x, 0, 1, 3, p.snow)
    c.px(x, 3, x % 3 === 1 ? p.shade : p.snow)
    c.px(x, 4, x % 4 === 0 ? p.snow : x % 2 ? p.ice : p.shade)
    c.px(x, 5, x % 5 === 2 ? p.gap : x % 3 === 0 ? p.deep : p.ice)
  }
  // Sides and foot: ice, ragged on the inside.
  for (let i = 6; i < 24; i++) {
    for (const flip of [false, true]) {
      const at = (d) => (flip ? 23 - d : d)
      c.px(at(0), i, p.deep).px(at(1), i, p.ice).px(at(2), i, rnd() < 0.55 ? p.ice : p.deep)
      if (rnd() < 0.4) c.px(at(3), i, p.ice)
    }
  }
  for (let x = 0; x < 24; x++) {
    c.px(x, 23, p.deep).px(x, 22, p.ice).px(x, 21, rnd() < 0.55 ? p.ice : p.deep)
    if (rnd() < 0.4) c.px(x, 20, p.ice)
  }
  for (const [x, y] of [[0, 0], [23, 0], [0, 23], [23, 23]]) c.px(x, y, null)
  c.save(name)
}

// The same ledge as a strip: along the foot of the sidebar, and as a rule
// across a reply.
for (const [name, p] of [
  ["celeste-ledge-night.svg", { snow: "#ffffff", shade: "#d3e6f2", ice: "#5888f8", deep: "#4068e0" }],
  ["celeste-ledge.svg", { snow: "#ffffff", shade: "#e4d8f4", ice: "#b49ce0", deep: "#8a70b8" }],
]) {
  const c = new Canvas(48, 10)
  const rnd = random(21)
  for (let x = 0; x < 48; x++) {
    const bump = x % 12 < 5 ? 0 : 1
    c.rect(x, bump, 1, 3 - bump, p.snow)
    c.px(x, 3, x % 3 === 1 ? p.shade : p.snow)
    c.px(x, 4, x % 4 === 0 ? p.snow : x % 2 ? p.ice : p.shade)
    const depth = 1 + Math.floor(rnd() * 4)
    for (let d = 0; d < depth; d++) c.px(x, 5 + d, d === depth - 1 || rnd() < 0.3 ? p.deep : p.ice)
  }
  c.save(name)
}

// ── Weather ──────────────────────────────────────────────────────────────

// Snow on a sheet that tiles: mostly single pixels, a few bigger. A mask.
{
  const rnd = random(31)
  let s = ""
  for (let i = 0; i < 18; i++) {
    const size = i % 6 === 0 ? 3 : i % 2 === 0 ? 2 : 1
    s += `<rect x="${Math.floor(rnd() * 150)}" y="${Math.floor(rnd() * 150)}" width="${size}" height="${size}" fill="#ffffff" opacity="${(0.5 + rnd() * 0.5).toFixed(2)}"/>`
  }
  write("celeste-snow.svg", sprite(156, 156, s))
}

// The Summit's wind: white streaks, level. A mask too.
{
  const rnd = random(5)
  let s = ""
  for (let i = 0; i < 5; i++) s += `<rect x="${Math.floor(rnd() * 150)}" y="${6 + i * 23 + Math.floor(rnd() * 10)}" width="${14 + Math.floor(rnd() * 26)}" height="1" fill="#ffffff"/>`
  write("celeste-wind.svg", sprite(200, 120, s))
}

// Stars: white, and the cold blue of the game's night.
{
  const rnd = random(11)
  const c = new Canvas(96, 96)
  for (let i = 0; i < 18; i++) {
    const x = 2 + Math.floor(rnd() * 92)
    const y = 2 + Math.floor(rnd() * 92)
    const col = ["#ffffff", "#5890f8", "#ffffff", "#2c50c0"][i % 4]
    c.px(x, y, col)
    if (i % 6 === 0) c.px(x - 1, y, col).px(x + 1, y, col).px(x, y - 1, col).px(x, y + 1, col)
  }
  c.save("celeste-stars.svg")
}

// Golden Ridge's clouds: a white one and a pink one, each with its outline.
const CLOUD = [
  "...WWWW.....WWWW......",
  ".WWWWWWWW.WWWWWWWW.WW.",
  "WWWWWWWWWWWWWWWWWWWWWW",
  "WWWWWWWWWWWWWWWWWWWWWW",
  "sWWWWssWWWWWWsssWWWWWs",
  ".sssssssssssssssssss..",
  "...ssss....sssss......",
]

// The two of them on a strip that tiles, to drift across the sidebar.
{
  const c = new Canvas(180, 60)
  c.blit(outline(CLOUD), { W: "#ffffff", s: "#a8d0ff", K: "#4a58c8" }, 12, 4)
  c.blit(outline(CLOUD), { W: "#ffd8f4", s: "#ff9ae0", K: "#b048b8" }, 104, 44)
  c.save("celeste-clouds.svg")
}

// The dusk sky's bands of cloud, to lie over its gradient: each a wash with
// a scalloped upper edge, thinning to nothing below it.
{
  const W = 160
  const H = 120
  let s = '<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="m" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#f)"/></mask></defs>'
  const band = (base, amp, phase, fill, opacity, depth) => {
    let cols = ""
    for (let x = 0; x < W; x += 2) {
      const scallop = Math.abs(Math.sin((Math.PI * (x + phase)) / 20)) * amp + Math.sin((2 * Math.PI * (x + phase)) / W) * 4
      const top = Math.round(base - scallop)
      cols += `<rect x="${x}" y="${top}" width="2" height="${base + depth - top}" fill="${fill}"/>`
    }
    s += `<g opacity="${opacity}" mask="url(#m)">${cols}</g>`
  }
  band(22, 5, 0, "#f8a8e4", 0.55, 30)
  band(50, 6, 9, "#ffc4ea", 0.55, 30)
  band(78, 5, 4, "#ffe2f0", 0.6, 30)
  write("celeste-dusk.svg", sprite(W, H, s))
}

// ── The foot of the sidebar by night: the Prologue's cabin ───────────────

const PINE = { a: "#16343a", b: "#0f262e" }
function pine(c, cx, base, h, col) {
  for (let y = 0; y < h; y++) {
    const tier = y % 7
    const half = Math.round(1 + (y / h) * (h * 0.36) + tier * 0.5)
    c.rect(cx - half, base - h + y, half * 2 + 1, 1, col)
  }
  c.rect(cx, base - 2, 1, 2, col)
}

{
  const W = 150
  const H = 46
  const c = new Canvas(W, H)
  const gy = H // the ground is the foot's own, below this picture
  // Pines, far and near.
  for (const [x, h, col] of [[8, 30, PINE.b], [30, 22, PINE.b], [124, 34, PINE.b], [142, 24, PINE.a], [112, 20, PINE.a], [44, 16, PINE.a]]) pine(c, x, gy, h, col)

  // The cabin: purple planks, wooden trim, snow on the near slope.
  const wood = { l: "#b0704c", m: "#905840", d: "#603838" }
  const plank = { p: "#4a3052", q: "#402848", d: "#241238" }
  const x0 = 48
  const wallL = x0 + 12
  const wallR = x0 + 50
  const wallTop = gy - 19
  const ridgeX = x0 + 31
  const ridgeY = gy - 34
  const slope = 1.6
  // Gable and walls.
  for (let y = ridgeY + 3; y < gy; y++) {
    const half = y < wallTop ? Math.min(19, Math.round((y - ridgeY) * slope) - 3) : 19
    for (let x = ridgeX - half; x < ridgeX + half; x++) c.px(x, y, (gy - y) % 4 === 0 ? plank.d : (x + y * 3) % 11 < 5 ? plank.p : plank.q)
  }
  // The lean-to on the left.
  for (let y = gy - 9; y < gy; y++) c.rect(x0 + 2, y, 11, 1, (gy - y) % 4 === 0 ? plank.d : plank.q)
  c.line(x0 - 1, gy - 9, x0 + 14, gy - 13, wood.m).line(x0 - 1, gy - 8, x0 + 14, gy - 12, wood.d)
  c.line(x0 + 1, gy - 11, x0 + 9, gy - 13, "#ffffff").line(x0 + 3, gy - 12, x0 + 8, gy - 14, "#ffffff").px(x0 + 5, gy - 12, "#5888f8")
  c.rect(x0 + 2, gy - 8, 1, 8, wood.d)
  // Corner posts, door, windows.
  c.rect(wallL, wallTop, 2, 19, wood.m).rect(wallR - 2, wallTop, 2, 19, wood.m).rect(wallL + 2, wallTop, 1, 19, wood.d).rect(wallR - 3, wallTop, 1, 19, wood.d)
  c.rect(ridgeX - 4, gy - 13, 9, 13, wood.d).rect(ridgeX - 3, gy - 12, 7, 12, plank.d).px(ridgeX + 2, gy - 6, wood.l)
  for (const wx of [wallL + 6, wallR - 13]) {
    c.rect(wx - 1, gy - 15, 8, 10, wood.d).rect(wx, gy - 14, 6, 8, "#62e8e8")
    c.rect(wx + 2, gy - 14, 2, 8, plank.d).rect(wx, gy - 11, 6, 1, plank.d)
    c.px(wx + 1, gy - 13, "#c8ffff").px(wx + 5, gy - 9, "#2aa0b0").px(wx, gy - 8, "#2aa0b0")
    c.rect(wx - 2, gy - 5, 10, 1, wood.m)
  }
  // The chimney, then the roof over it.
  c.rect(ridgeX + 11, ridgeY + 1, 5, 9, "#8088a0").rect(ridgeX + 11, ridgeY + 1, 5, 1, "#b0b8c8").rect(ridgeX + 15, ridgeY + 2, 1, 8, "#5a607a")
  const rnd = random(3)
  for (let dx = -30; dx <= 30; dx++) {
    const y = ridgeY + Math.round(Math.abs(dx) / slope)
    c.px(ridgeX + dx, y, wood.l).px(ridgeX + dx, y + 1, wood.m).px(ridgeX + dx, y + 2, wood.d)
    if (dx < -1 && dx > -29) {
      const deep = 2 + (rnd() < 0.3 ? 1 : 0)
      c.rect(ridgeX + dx, y - deep, 1, deep, "#ffffff")
      if (rnd() < 0.18) c.px(ridgeX + dx, y - 1, "#5888f8")
    } else if (dx > 6 && dx < 16 && rnd() < 0.7) c.px(ridgeX + dx, y - 1, "#ffffff")
    // Icicles from the eaves.
    if (Math.abs(dx) > 21 && Math.abs(dx) < 29 && (dx + 60) % 3 === 0) c.rect(ridgeX + dx, y + 3, 1, 2 + ((dx + 60) % 2), "#ffffff")
  }
  c.rect(ridgeX - 2, ridgeY + 3, 5, 5, wood.m).rect(ridgeX - 1, ridgeY + 4, 3, 3, wood.d)
  // Snow drifted against the walls.
  for (const [x, w, h] of [[wallL - 3, 9, 2], [wallR - 5, 10, 3], [ridgeX + 6, 6, 1], [x0 - 2, 7, 2]]) {
    c.rect(x, gy - h, w, h, "#ffffff").rect(x + 1, gy - h - 1, w - 3, 1, "#ffffff").px(x + w - 2, gy - 1, "#5888f8")
  }

  // The lamp post, its wire running to the cabin.
  const lx = 22
  c.line(lx + 3, gy - 33, x0 + 9, gy - 24, "#5a6078").line(x0 + 9, gy - 24, x0 + 16, gy - 26, "#5a6078")
  c.line(lx, gy - 33, 0, gy - 22, "#3a4058")
  c.rect(lx, gy - 30, 3, 30, "#2a1420").rect(lx + 1, gy - 30, 1, 30, "#7a4034")
  c.rect(lx - 1, gy - 1, 5, 1, "#8088a0")
  c.blit(["....W....", "...WWW...", "..WWWWW..", ".WWWWWWW.", "..sYYYs..", "..sYLYs..", "..sYLYs..", "..sYYYs..", "...sss..."], { W: "#d0e0f8", s: "#8898b8", Y: "#f8f070", L: "#ffffff" }, lx - 3, gy - 39)
  for (const [dx, dy] of [[-4, -35], [6, -35], [-4, -33], [6, -33], [1, -41]]) c.px(lx + dx, gy + dy, "#f8f07055")

  // Madeline at the door.
  c.blit(outline(MADELINE), { ...BODY, ...HAIR.red }, ridgeX - 15, gy - 14)
  c.save("celeste-cabin.svg")
}

// Pines alone, to run on past the cabin where the sidebar is wider.
{
  const c = new Canvas(96, 40)
  for (const [x, h, col] of [[10, 30, PINE.b], [34, 20, PINE.a], [58, 36, PINE.b], [80, 24, PINE.a]]) pine(c, x, 40, h, col)
  c.save("celeste-pines.svg")
}

// ── The foot of the sidebar at dusk: Golden Ridge's peaks, the Summit's
// prayer flags ───────────────────────────────────────────────────────────

function peaks(c, base, amp, seed, fill, snow, shade) {
  const rnd = random(seed)
  const W = c.w
  let phase = rnd() * 6
  for (let x = 0; x < W; x++) {
    const t = (2 * Math.PI * x) / W
    const tri = Math.abs(((x + seed * 13) % 40) - 20) / 20
    const top = Math.round(base - amp * (0.55 * (1 - tri) + 0.25 * Math.sin(t * 2 + phase) + 0.2 * Math.sin(t * 3 + 1)))
    for (let y = top; y < c.h; y++) c.px(x, y, y < top + 3 + (x % 3) ? snow : (x + y) % 9 < 3 && y < top + 9 ? shade : fill)
  }
}

{
  const c = new Canvas(160, 40)
  peaks(c, 22, 20, 2, "#e2c4f6", "#fbeefc", "#d2b0f0")
  peaks(c, 32, 14, 5, "#cfaaf0", "#f4e4fc", "#bb94e4")
  c.save("celeste-ridge.svg")
}

{
  const W = 150
  const H = 46
  const c = new Canvas(W, H)
  const gy = H
  const POLE = "#8a3868"
  // A flag off a pole: bars of colour blown to the left, their ends torn.
  const flag = (px, top, len, deep, a, b, glyph) => {
    for (let i = 0; i < len; i++) {
      const lift = Math.round(Math.sin(i / 3) * 1.2)
      for (let d = 0; d < deep; d++) {
        if (i > len - 4 && (d + i) % 2 === 0) continue
        c.px(px - 1 - i, top + d + lift, d === 0 || d === deep - 1 || (d % 3 === 0 && i > 1) ? b : a)
      }
    }
    if (glyph) c.px(px - 5, top + 2, b).rect(px - 6, top + 3, 3, 1, b).rect(px - 7, top + 4, 5, 1, b)
  }
  const pole = (x, h) => c.rect(x, gy - h, 1, h, POLE).px(x, gy - h - 1, "#c05890")
  pole(40, 40)
  pole(86, 44)
  pole(120, 30)
  c.line(40, gy - 22, 30, gy, POLE).line(86, gy - 20, 98, gy, POLE)
  flag(40, gy - 39, 16, 6, "#48d8e8", "#28a0c8")
  flag(40, gy - 26, 20, 5, "#f04ca8", "#b02c80")
  flag(86, gy - 43, 18, 6, "#f04ca8", "#b02c80")
  flag(86, gy - 33, 15, 8, "#a0e840", "#58b030", true)
  flag(86, gy - 20, 22, 5, "#48d8e8", "#28a0c8")
  flag(120, gy - 29, 14, 5, "#a0e840", "#58b030")
  flag(120, gy - 20, 17, 5, "#f04ca8", "#b02c80")
  // Purple rock under snow, where she stands.
  const rock = { a: "#685090", b: "#584080", t: "#c898e8" }
  for (let x = 54; x < 76; x++) {
    const top = gy - 7 + (x < 57 || x > 72 ? 2 : x % 5 === 0 ? 1 : 0)
    c.rect(x, top, 1, gy - top, (x * 7) % 5 < 2 ? rock.b : rock.a).px(x, top, "#ffffff").px(x, top + 1, x % 3 ? "#ffffff" : rock.t)
  }
  c.blit(outline(MADELINE), { ...BODY, ...HAIR.pink, K: "#483868" }, 59, gy - 21)
  c.save("celeste-flags.svg")
}

// ── The gondola, and Celeste Mountain ────────────────────────────────────

{
  const c = new Canvas(30, 34)
  const s = { hi: "#c0c0e0", m: "#8c8cb8", lo: "#565684", glass: "#1a2a60", glass2: "#243878", K }
  // The arm and its wheel, on the cable.
  c.rect(0, 2, 30, 1, "#3a3a58")
  c.rect(4, 0, 5, 4, s.m).rect(5, 1, 3, 2, s.hi).px(6, 1, s.lo)
  c.line(8, 3, 14, 3, s.m).rect(14, 3, 1, 6, s.m)
  c.line(14, 5, 8, 10, s.lo).line(15, 5, 21, 10, s.lo)
  // Roof.
  c.rect(5, 10, 20, 1, s.hi).rect(3, 11, 24, 2, s.m).rect(3, 13, 24, 1, s.lo).rect(7, 9, 16, 1, s.m)
  // Cabin: posts, glass, rails, floor.
  c.rect(4, 14, 22, 15, s.glass)
  c.rect(4, 14, 1, 15, s.m).rect(25, 14, 1, 15, s.m).rect(14, 14, 1, 9, s.lo).rect(9, 14, 1, 9, s.glass2).rect(20, 14, 1, 9, s.glass2)
  c.rect(4, 23, 22, 1, s.hi)
  for (let x = 6; x < 25; x += 3) c.rect(x, 24, 1, 5, s.lo)
  c.rect(2, 29, 26, 2, s.m).rect(2, 29, 26, 1, s.hi).rect(3, 31, 24, 1, s.lo)
  // Madeline and Theo are not aboard: one passenger, in red.
  c.rect(11, 20, 4, 3, "#c83a3a").rect(12, 22, 2, 2, "#f4c9a0").rect(11, 24, 4, 3, "#5878f8")
  c.save("celeste-gondola.svg")
}

// A small gondola, for what slides along a cable.
draw(
  "celeste-gondola-s.svg",
  outline(["....WW.....", ".....m.....", "....mmm....", "..HHHHHHH..", ".MgggMgggM.", ".MgggMgggM.", ".HHHHHHHHH.", ".MlMlMlMlM.", ".MMMMMMMMM."]),
  { W: "#c0c0e0", m: "#565684", H: "#c0c0e0", M: "#8c8cb8", g: "#1a2a60", l: "#3a3a68", K },
)

// The mountain, as the title screen has it: one great peak, snow from the
// shoulders up, a flag on the summit.
{
  const W = 200
  const H = 110
  const c = new Canvas(W, H)
  const rnd = random(5)
  const p = { far: "#141d46", lit: "#3b4a94", shade: "#262f6a", snow: "#f8f8ff", snowShade: "#a8bcf4" }
  for (let x = 0; x < W; x++) {
    // The far ridge sinks away at both ends, so the picture has no cut edge.
    const edge = Math.min(1, x / 30, (W - 1 - x) / 30)
    const top = Math.round(H - edge * (26 + 9 * Math.sin((2 * Math.PI * x) / W + 0.6) + 5 * Math.sin((6 * Math.PI * x) / W)))
    c.rect(x, top, 1, H - top, p.far)
  }
  const peak = (cx, height, half, flagged) => {
    for (let dx = -half; dx <= half; dx++) {
      const jag = Math.round((rnd() - 0.5) * 2)
      const h = Math.max(0, Math.round(height * (1 - Math.abs(dx) / half) ** 0.9) + (Math.abs(dx) < half - 2 ? jag : 0))
      const snowTo = H - Math.round(height * 0.56) + Math.round(Math.abs(dx) * 0.5) + (Math.abs(dx) % 4 === 0 ? 4 : Math.abs(dx) % 3 === 0 ? 2 : 0)
      for (let y = H - h; y < H; y++) c.px(cx + dx, y, y < snowTo ? (dx < 0 ? p.snow : p.snowShade) : dx < 0 ? p.lit : p.shade)
    }
    if (flagged) {
      const top = H - height
      c.rect(cx, top - 8, 1, 8, "#c06838")
      c.blit(["TTTTT.", "TTTTTT", "TTTT.."], { T: "#38d8b0" }, cx + 1, top - 8)
    }
  }
  peak(150, 50, 44, false)
  peak(34, 44, 40, false)
  peak(96, 100, 66, true)
  c.save("celeste-mountain.svg")
}

// The fire, low and then high: the high one covers the low one.
const FIRE_LOW = ["..........", "..........", "..........", ".....r....", "....rr....", "...rOOr...", "..rOOOOr..", "..rOYYOr..", ".rOOYYOOr.", ".rOYYYYOr.", "..OYWWYO.."]
const FIRE_HIGH = ["....r.....", "....rr....", "...rrr..r.", "..rrOr.rr.", "..rOOrrr..", ".rrOOOOrr.", ".rOOYYOOr.", "rrOYYYYOrr", "rOOYYYYOOr", "rOYYWWYYOr", ".OOYWWYOO."]
const FIRE = { r: "#e8482c", O: "#f8902c", Y: "#ffd048", W: "#fff8c8" }
draw("celeste-fire-high.svg", FIRE_HIGH, FIRE)

// ── Where a climb is remembered: the memorial, a fire beside it ──────────

{
  const c = new Canvas(64, 36)
  const gy = 30
  // Snow, a rise of it behind.
  const ice = random(8)
  for (let x = 0; x < 64; x++) {
    const rise = Math.round(3 * Math.sin((Math.PI * x) / 64))
    c.rect(x, gy - rise, 1, 2 + rise, "#ffffff")
    c.px(x, gy + 2, x % 4 === 0 ? "#ffffff" : x % 2 ? "#5888f8" : "#d3e6f2")
    // Ice under the snow, hanging ragged, as under every ledge.
    const depth = x < 2 || x > 61 ? 0 : 1 + Math.floor(ice() * 2)
    for (let d = 0; d < depth; d++) c.px(x, gy + 3 + d, d === depth - 1 ? "#4068e0" : "#5888f8")
    if (x % 7 === 3) c.px(x, gy - rise + 1, "#d3e6f2")
  }
  // The memorial: a grey slab, lines cut in it, snow on its head.
  const st = { a: "#8a84a8", b: "#6a6488", d: "#3e3a5a" }
  c.rect(6, gy - 22, 16, 21, st.a).rect(6, gy - 22, 1, 21, st.b).rect(21, gy - 22, 1, 21, st.d).rect(7, gy - 23, 14, 1, st.a)
  for (let i = 0; i < 6; i++) c.rect(9, gy - 19 + i * 3, i % 3 === 2 ? 7 : 10, 1, st.d)
  c.rect(5, gy - 24, 18, 2, "#ffffff").rect(7, gy - 25, 12, 1, "#ffffff").px(6, gy - 22, "#ffffff").px(20, gy - 22, "#ffffff").px(21, gy - 22, "#d3e6f2")
  c.rect(4, gy - 2, 20, 2, "#ffffff")
  // Madeline, resting.
  c.blit(outline(MADELINE), { ...BODY, ...HAIR.red }, 28, gy - 15)
  // The logs and a low fire. The high one is its own picture, laid over it.
  c.line(45, gy - 2, 57, gy - 4, "#8a5440").line(45, gy - 4, 57, gy - 2, "#b0704c").line(45, gy - 1, 57, gy - 3, "#603838")
  c.blit(FIRE_LOW, FIRE, 46, gy - 14)
  c.save("celeste-camp.svg")
}

// ── A postcard, whole: what the game shows between chapters ──────────────

{
  const W = 150
  const H = 100
  const c = new Canvas(W, H)
  const p = { edge: "#cdb8ac", paper: "#f6ede4", line: "#d4a8a4", ink: "#b89088" }
  c.rect(0, 0, W, H, p.edge).rect(1, 1, W - 2, H - 2, p.paper)
  c.rect(6, 6, W - 12, 1, p.line).rect(6, H - 7, W - 12, 1, p.line).rect(6, 6, 1, H - 12, p.line).rect(W - 7, 6, 1, H - 12, p.line)
  // "To:", and the lines an address goes on.
  c.blit(["TTT...", ".T..oo", ".T.o.o", ".T.oo.", "......"], { T: p.ink, o: p.ink }, 14, 14)
  c.rect(24, 19, 46, 1, p.ink).rect(14, 27, 50, 1, p.line)
  // The postmark's waves, and the stamp over them.
  for (let i = 0; i < 4; i++) for (let x = 96; x < 126; x++) c.px(x, 14 + i * 3 + Math.round(Math.sin(x / 2.2)), p.line)
  const STAMP = ["P.P.P.P.P.P.P.P", ".BBBBBBBBBBBBB.", "PBBBBBBBWBBBBBP", ".BBBBBBWWWBBBB.", "PBBBBBWWMWWBBBP", ".BBBBWWMMMWWBB.", "PBBBWMMMMMMMWBP", ".BBWMMMMMMMMMB.", "PBBMMMMMMMMMMBP", ".BBBBBBBBBBBBB.", "P.P.P.P.P.P.P.P"]
  c.rect(121, 9, 17, 13, "#fffdf8")
  c.blit(STAMP, { P: "#d8c4b8", B: "#78a8e8", W: "#ffffff", M: "#8068b8" }, 122, 10)
  // A strawberry in the corner, where the game signs its cards.
  c.blit(outline(BERRY_S), RED_BERRY, 12, H - 22)
  for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]]) c.px(x, y, null)
  c.save("celeste-card.svg")
}
