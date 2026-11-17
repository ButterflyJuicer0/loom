import { pixels, random, sprite, write, writeSprite } from "./lib.mjs"

// ── 我的世界 (Minecraft, Java Edition's interface) ───────────────────────
// Every picture here is Loom's own pixel drawing, made after looking at the
// game's screens on minecraft.wiki (the options and world-selection menus,
// the furnace / inventory / villager windows, the HUD, the advancement
// toast, the sign editor, item icons) and sampling their colours. Nothing is
// taken from the game's files; no logo is reproduced.

// A tile of speckle: `w` by `h` squares, each one of `colours` (weighted),
// with some chance of repeating its left neighbour, as the game's noisy
// textures run in short dashes.
function speckle(seed, w, h, colours, run = 0.3) {
  const rnd = random(seed)
  const total = colours.reduce((n, [, weight]) => n + weight, 0)
  const pick = () => {
    let at = rnd() * total
    for (const [colour, weight] of colours) if ((at -= weight) < 0) return colour
    return colours[0][0]
  }
  let s = ""
  for (let y = 0; y < h; y++) {
    let last = pick()
    for (let x = 0; x < w; ) {
      const colour = x > 0 && rnd() < run ? last : pick()
      let n = 1
      while (x + n < w && rnd() < run * 0.5) n++
      s += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${colour}"/>`
      last = colour
      x += n
    }
  }
  return sprite(w, h, s)
}

// ── Grounds ──────────────────────────────────────────────────────────────

// The menu background: dirt, darkened to a quarter as the options screen
// has it — and to an eighth, as inside a list (and at night).
write("minecraft-dirt.svg", speckle(7, 16, 16, [["#1e150f", 41], ["#261b13", 26], ["#2e2117", 15], ["#160f0a", 14], ["#222428", 2], ["#1b1b1b", 2]]))
write("minecraft-dirt-deep.svg", speckle(7, 16, 16, [["#0f0b07", 41], ["#130e09", 26], ["#17110c", 15], ["#0b0805", 14], ["#111214", 2], ["#0e0e0e", 2]]))

// A button's face: stone-grey noise. And the face of one that is off (a
// disabled button, a slider's track, an unchosen tab).
write("minecraft-stone.svg", speckle(21, 16, 16, [["#6f6f6f", 12], ["#6c6c6c", 2], ["#717171", 2], ["#6e6e6e", 2], ["#737373", 1], ["#6a6a6a", 1], ["#757575", 1], ["#696969", 1]], 0.2))
write("minecraft-stone-off.svg", speckle(22, 16, 16, [["#2c2c2c", 12], ["#2b2b2b", 2], ["#2d2d2d", 2], ["#2e2e2e", 1], ["#292929", 1], ["#2a2a2a", 1], ["#2f2f2f", 1], ["#313131", 1]], 0.2))

// Bedrock, for a rule across the page.
write("minecraft-bedrock.svg", speckle(40, 16, 16, [["#575757", 30], ["#333333", 26], ["#151515", 16], ["#444444", 14], ["#979797", 9], ["#6b6b6b", 5]], 0.55))

// Oak planks, as on a sign: four boards, a seam under each, joints that do
// not line up. The seams are lighter than the game's, to keep text readable.
{
  const rnd = random(12)
  const rows = []
  for (let y = 0; y < 16; y++) {
    let row = ""
    const seam = y % 4 === 3
    const joint = [5, 12, 2, 9][Math.floor(y / 4)]
    for (let x = 0; x < 16; x++) {
      if (seam) row += "s"
      else if (x === joint) row += "j"
      else row += rnd() < 0.2 ? "e" : rnd() < 0.08 ? "c" : "f"
    }
    rows.push(row)
  }
  writeSprite("minecraft-planks.svg", rows, { f: "#b7985f", e: "#ad8d54", c: "#a58650", s: "#a3874f", j: "#a88c54" })
}

// ── Frames, as border-images ─────────────────────────────────────────────

// A container's window (the inventory, a furnace): black outline with
// stepped corners, two pixels of white up and left, two of dark grey down
// and right, #c6c6c6 between.
writeSprite(
  "minecraft-panel.svg",
  ["..KKKK...", ".KWWWWK..", "KWWWWWFK.", "KWWWFFDDK", "KWWFFFDDK", "KWWFFDDDK", ".KFDDDDDK", "..KDDDDK.", "...KKKK.."],
  { K: "#000000", W: "#ffffff", F: "#c6c6c6", D: "#555555" },
)

// A toast ("Advancement Made!"): the same outline, a grey frame all round,
// near-black inside. At night every window is one.
writeSprite(
  "minecraft-toast.svg",
  ["..KKKKK..", ".KGGGGGK.", "KGGGGGGGK", "KGGGFGGGK", "KGGFFFGGK", "KGGGFGGGK", "KGGGGGGGK", ".KGGGGGK.", "..KKKKK.."],
  { K: "#000000", G: "#555555", F: "#212121" },
)

// A button's edge over its stone face: black outline; light along the top
// and left; dark along the right, and two pixels of it along the bottom; the
// two odd corners left to the face. Hovered or focused, the outline is white.
const BUTTON = ["KKKKK", "KLL.K", "KL.DK", "K.DDK", "K.DDK", "KKKKK"]
writeSprite("minecraft-button.svg", BUTTON, { K: "#000000", L: "#aaaaaa", D: "#565656" })
writeSprite("minecraft-button-hover.svg", BUTTON, { K: "#ffffff", L: "#aaaaaa", D: "#565656" })
// One that is off has the outline and nothing else.
writeSprite("minecraft-button-off.svg", BUTTON, { K: "#000000" })

// A hotbar slot: grey frame, dark along the top and left inside it, lighter
// along the bottom and right. And the frame of the one that is held.
writeSprite("minecraft-hotbar.svg", ["HHHHM", "HDDLM", "HD.LM", "HLLLM", "MMMMM"], { H: "#8f8f8f", M: "#5d5d5d", D: "#0c0c0c", L: "#7e7e7e" })
writeSprite("minecraft-hotbar-held.svg", ["WWWWW", "WGGGW", "WG.GW", "WGGGW", "WWWWW"], { W: "#f2f2f2", G: "#9a9a9a" })

// ── The HUD ──────────────────────────────────────────────────────────────

const HEART = ["..KK.KK..", ".KRRKRRK.", "KRWRRRRRK", "KRRRRRRRK", "KDRRRRRDK", ".KDRRRDK.", "..KDRDK..", "...KDK...", "....K...."]
const HEART_COLOURS = { K: "#000000", R: "#ff1313", W: "#ffc8c8", D: "#bb1313" }
const SHANK = ["..KK.....", ".KRrK....", "KRSRBK...", "KrRBbBK..", ".KdDbbK..", "..KdDDK..", "...KKKWKK", "......KwK", "......KK."]
const SHANK_COLOURS = { K: "#000000", R: "#d42a2a", r: "#b21818", S: "#dfb18f", B: "#b88458", b: "#9d6d43", d: "#613c1b", D: "#7b512d", W: "#e2d5aa", w: "#fff7dc" }

writeSprite("minecraft-heart.svg", HEART, HEART_COLOURS)
// Ten of each in a row, eight pixels apart, as over the hotbar.
{
  let hearts = ""
  let shanks = ""
  for (let i = 0; i < 10; i++) {
    hearts += pixels(HEART, HEART_COLOURS, i * 8, 0)
    shanks += pixels(SHANK, SHANK_COLOURS, i * 8, 0)
  }
  write("minecraft-hearts.svg", sprite(81, 9, hearts))
  write("minecraft-hunger.svg", sprite(81, 9, shanks))
}

// The experience bar, full: a tile of two of its segments.
writeSprite(
  "minecraft-xp.svg",
  ["abbcccbbbaabbccccbba", "dmHHhhmmmndmmhHHhmmn", "dhLLHhhHhmdhHLLhhHhm", "dnmmmnnmnndnnmmmnmnn", "abbcccbbbaabbcccbbba"],
  { a: "#081c11", b: "#162d1a", c: "#223d22", d: "#2c4915", n: "#436924", m: "#5c853b", h: "#7aa657", H: "#8bca59", L: "#b4f57e" },
)
// And empty.
writeSprite(
  "minecraft-xp-empty.svg",
  ["abbcccbbbaabbccccbba", "deeeeeeeeedeeeeeeeee", "deffffffeedefffffffe", "deeeeeeeeedeeeeeeeee", "abbcccbbbaabbcccbbba"],
  { a: "#081c11", b: "#162d1a", c: "#223d22", d: "#0b1a0d", e: "#14261a", f: "#1b3320" },
)

// An experience orb.
writeSprite(
  "minecraft-orb.svg",
  ["...AAAAAA...", "..ABBBBBBA..", ".ABCCCCCCBA.", "ABCCCCCCCCBA", "ABCCDDDDCCBA", "ABCCDWDDCCBA", "ABCCDDDDCCBA", "ABCCDDDDCCBA", "ABCCCCCCCCBA", ".ABCCCCCCBA.", "..ABBBBBBA..", "...AAAAAA..."],
  { A: "#007a00", B: "#009f00", C: "#00c300", D: "#05ff00", W: "#b8ff9e" },
)

// ── A furnace at work ────────────────────────────────────────────────────

// The three wisps where its fire goes, unlit.
const WISPS = [
  ".B.........B.",
  ".B.........B.",
  "..B...B...B..",
  "..B...B...B..",
  ".BB....B..BB.",
  ".BB....B..BB.",
  "BBB...BB..BBB",
  "BB....BB...BB",
  "BB...BBB...BB",
  "BBB..BB...BBB",
  ".BB..BB...BB.",
  ".BB..BBB..BB.",
  "BBB..BBB..BBB",
]
// Lit, after the game's own: three thin tongues, red at the tip, orange,
// yellow, white-hot at the foot, each a pixel to the left of its wisp so the
// grey shows down its right side. And burning down, as fuel does there: the
// top of it gone back to wisps, in two steps.
const TONGUES = [
  ".r....r....r..",
  ".or...o...ro..",
  "..o...or..o...",
  ".ry...yo..yr..",
  ".oy...ry..oy..",
  ".yw...oy..yw..",
  "roy...yw..oyr.",
  "oyw..rwy..ryw.",
  "ywo..oyo...wy.",
  "wwy..ywr..owy.",
  "oww..owy..ywo.",
  ".ww..yww..wwy.",
  "oyw..oww..oww.",
  "..............",
]
function flame(burnt) {
  return TONGUES.map((row, y) =>
    [...row]
      .map((c, x) => (c !== "." && y >= burnt ? c : y > 0 && WISPS[y - 1][x - 1] === "B" ? "g" : "."))
      .join(""),
  )
}
const FLAME_COLOURS = { r: "#d84c45", o: "#ffb600", y: "#ffff1f", w: "#ffffff", g: "#8b8b8b" }
writeSprite("minecraft-flame-off.svg", flame(14), FLAME_COLOURS)
writeSprite("minecraft-flame.svg", flame(0), FLAME_COLOURS)
writeSprite("minecraft-flame-half.svg", flame(5), FLAME_COLOURS)
writeSprite("minecraft-flame-low.svg", flame(9), FLAME_COLOURS)

// Its arrow: a shaft three pixels thick and a head, grey until the work
// passes along it in white.
{
  const rows = []
  for (let y = 0; y < 15; y++) {
    let row = ""
    for (let x = 0; x < 22; x++) {
      const shaft = x < 14 && Math.abs(y - 7) <= 1
      const head = x >= 14 && Math.abs(y - 7) <= 21 - x
      row += shaft || head ? "A" : "."
    }
    rows.push(row)
  }
  writeSprite("minecraft-arrow-off.svg", rows, { A: "#8b8b8b" })
  // The head alone, white: the shaft's fill is a plain bar the stylesheet
  // draws and stretches, the head comes in after it.
  writeSprite("minecraft-arrow-head.svg", rows.map((row) => row.slice(14)), { A: "#ffffff" })
}

// ── Marks ────────────────────────────────────────────────────────────────

// Done, and failed.
writeSprite(
  "minecraft-check.svg",
  [".........GG.", "........GGGd", ".......GGGd.", "GG....GGGd..", "GGG..GGGd...", "dGGGGGGd....", ".dGGGGd.....", "..dGGd......", "...dd......."],
  { G: "#3bd13b", d: "#0f5f0f" },
)
writeSprite(
  "minecraft-cross.svg",
  ["RR......RR.", "RRR....RRRd", "dRRR..RRRd.", ".dRRRRRRd..", "..dRRRRd...", "..RRRRRR...", ".RRRddRRR..", "RRRd..dRRR.", "RRd....dRRd", "dd......ddd"],
  { R: "#e00000", d: "#7a0000" },
)

// "Not allowed": the barrier's ring and bar.
writeSprite(
  "minecraft-barrier.svg",
  [
    "................",
    "...ARRRRRRRRA...",
    "..RRRRRRRRRRRD..",
    ".ARRA......RRRD.",
    ".RRA......RRARD.",
    ".RR......RRA.RD.",
    ".RR.....RRA..RD.",
    ".RR....RRA...RD.",
    ".RR...RRA....RD.",
    ".RR..RRA.....RD.",
    ".RR.RRA......RD.",
    ".RRRRA......RRD.",
    ".ARRA......RRRD.",
    "..DRRRRRRRRRRD..",
    "...DDDDDDDDDD...",
    "................",
  ],
  { A: "#bc0101", R: "#e00000", D: "#af0000" },
)

// ── Items ────────────────────────────────────────────────────────────────

// An iron pickaxe: what work is done with.
writeSprite(
  "minecraft-pickaxe.svg",
  [
    "................",
    "................",
    "......KKKKK.....",
    ".....KWLLLLKhH..",
    "......KGGGLLHd..",
    "..........hLLG..",
    ".........hHdLLG.",
    "........hHd.GLG.",
    ".......hHd..GLG.",
    "......hHd...GLG.",
    ".....hHd....GWG.",
    "....hHd......G..",
    "...hHd..........",
    "..hHd...........",
    "..dd............",
    "................",
  ],
  { K: "#434343", W: "#fcfcfc", L: "#cacaca", G: "#181818", h: "#483515", H: "#876627", d: "#271e0b" },
)

// A clock: gold round, the sky and its sun in the window.
writeSprite(
  "minecraft-clock.svg",
  [
    "......OOOO......",
    "....OOYYyyOO....",
    "...OgYgBBgygO...",
    "..OgYBBBBBBygO..",
    "..OYBBbSSbBByo..",
    ".OYgBbSSSSbBgyo.",
    ".OYBBbSSSSbBByo.",
    ".OyBBBbSSbBBByo.",
    ".OyOKKKYyKKKOyo.",
    ".oYyWWYygYYygyo.",
    ".onYyyyyggggyno.",
    "..onYYyyggyyno..",
    "..oOnnYYYynOOo..",
    "...oOnnnOOOOo...",
    "....ooOnOOoo....",
    "......oooo......",
  ],
  { O: "#b26411", Y: "#fdf55f", y: "#fad64a", g: "#e9b115", B: "#3a53ac", b: "#4968d8", S: "#ffff00", o: "#752802", W: "#fbf7b7", K: "#181616", n: "#dc9613" },
)

// A compass: dark face, red needle.
writeSprite(
  "minecraft-compass.svg",
  [
    "................",
    "................",
    ".....KKKKKK.....",
    "...KKLLMDMDKK...",
    "..kDMKFFFFKDDk..",
    ".kDKFFFFFFFFKDk.",
    ".kKFFFFFFRFFFKk.",
    ".kKFFFFFRRFFFKk.",
    ".kLKFFFFRFFFKMk.",
    ".kMWWFFrFFFMMDk.",
    ".kMllWWLllMDDDk.",
    "..kLlllMLLDDDk..",
    "...kkLlMLLDkk...",
    ".....kkkkkk.....",
    "................",
    "................",
  ],
  { K: "#353535", L: "#a8a8a8", M: "#828282", D: "#5e5e5e", k: "#181717", F: "#2f2f2f", R: "#ff1414", r: "#be1515", W: "#ffffff", l: "#d8d8d8" },
)

// A book, lying open-side down; and one with a quill across it.
const BOOK = [
  "................",
  "........dd......",
  "......ddBBd.....",
  "....ddBBBBBd....",
  "..ddBBBbBBBBd...",
  "ddBBBBBBBbBBBd..",
  "dBBBbBBBBBBbBBd.",
  "ddBBBBbBBBBBbdk.",
  "dPdBBBBBBBbbPpk.",
  "kdPPdBBBbbPppdk.",
  ".kdPPdbbPppdkk..",
  "..kdPPdPpdkk....",
  "...kdPpdkk......",
  "....kddkk.......",
  ".....kk.........",
  "................",
]
writeSprite("minecraft-book.svg", BOOK, { B: "#644a17", b: "#43250a", d: "#302104", P: "#d3d3d3", p: "#979797", k: "#161005" })
writeSprite(
  "minecraft-quill.svg",
  [
    "................",
    "....WQg.dd......",
    "...QWWWdBBd.....",
    "...QWgWWBBBd....",
    "..ddQQgQgdBBd...",
    "ddBBgWgWWddBBd..",
    "dBBBBQWqWBddBBd.",
    "ddBBBBQqQgBBbdk.",
    "dPdBBBWWqWbbPpk.",
    "kdPPdBgWqWPppdk.",
    ".kdPPdbQqQpdkk..",
    "..kdPPdPQqkk....",
    "...kdPpdkq......",
    "....kddkk.......",
    ".....kk...k.....",
    "................",
  ],
  { B: "#74311e", b: "#5c2210", d: "#381003", P: "#d3d3d3", p: "#979797", k: "#161005", W: "#dbdbdb", Q: "#c8c8c8", g: "#ababab", q: "#6b6b6b" },
)

// A diamond and an emerald: a list's dots.
writeSprite(
  "minecraft-diamond.svg",
  [
    "................",
    "................",
    "......AAAA......",
    ".....AWWLLA.....",
    "....AWLCCCCG....",
    "...AWLCCCLCFG...",
    "...AWCCLLCCFG...",
    "..AWLCLLCCCFHG..",
    "..AWCLLCCCFFHG..",
    "..AWCCCCCFFHHG..",
    "..ALCCFFFFHHIG..",
    "...GCFFFHHHIG...",
    "...GCFHHHHIIG...",
    "....GIHHHIIG....",
    ".....GGGGGG.....",
    "................",
  ],
  { A: "#117179", W: "#fcfcfc", L: "#d2fcf3", C: "#49ead6", F: "#20c3b3", H: "#1aa8a5", I: "#1c8f98", G: "#145d52" },
)
writeSprite(
  "minecraft-emerald.svg",
  [
    "................",
    "................",
    "......AAAA......",
    ".....AWLLDA.....",
    "....AWELLFDG....",
    "...AWEELLFFDG...",
    "...AEDDEEFHFG...",
    "...AEDDEEFHFG...",
    "...AEDDEEFJFG...",
    "...AEDDEEFJDG...",
    "...AEDDELJHDG...",
    "....AFHJJHDG....",
    ".....AFHJDG.....",
    "......GGGG......",
    "................",
    "................",
  ],
  { A: "#005200", W: "#d8fce8", L: "#40f082", D: "#17da61", E: "#adfacb", F: "#00a82b", H: "#009328", J: "#007a18", G: "#002c00" },
)

// A bell on its bar.
writeSprite(
  "minecraft-bell.svg",
  [
    "................",
    "..ABAACCAAACAC..",
    "..CACDDDCCCDCD..",
    ".....EFFFFE.....",
    "....EGHIIHFJ....",
    "....FHIKIIHJ....",
    "....FHKKIIHJ....",
    "....FHKKIIHJ....",
    "....EHKKIIHJ....",
    "....FKLLKKKJ....",
    "....EFHHHHFJ....",
    "...FKLLLLKKKE...",
    "...EHIHHHIIFJ...",
    "....JJJJJJJJ....",
    "................",
    "................",
  ].map((row) => row.replace(/[AB]/g, "A").replace(/[CD]/g, "C").replace(/G/g, "H").replace(/L/g, "K")),
  { A: "#5e3423", C: "#3f2114", E: "#b26429", F: "#d09431", H: "#fbd338", I: "#fce94e", J: "#9a4e16", K: "#fcf38b" },
)

// A chest, from the front.
writeSprite(
  "minecraft-chest.svg",
  [
    "................",
    ".KKKKKKKKKKKKKK.",
    ".KLLLLLLLLLLLLK.",
    ".KLMMMMMMMMMMDK.",
    ".KLMMMMMMMMMMDK.",
    ".KDDDDDSSDDDDDK.",
    ".KKKKKKSsKKKKKK.",
    ".KLLLLLSsLLLLLK.",
    ".KLMMMMMMMMMMDK.",
    ".KLMMMMMMMMMMDK.",
    ".KLMMMMMMMMMMDK.",
    ".KLMMMMMMMMMMDK.",
    ".KLMMMMMMMMMMDK.",
    ".KDDDDDDDDDDDDK.",
    ".KKKKKKKKKKKKKK.",
    "................",
  ],
  { K: "#2d2209", L: "#c08a2e", M: "#a56d1f", D: "#6b4714", S: "#d8d8d8", s: "#8a8a8a" },
)

// A villager's face: one brow, green eyes, the nose.
writeSprite(
  "minecraft-villager.svg",
  ["ssssnsss", "tsssssst", "ttsssstt", "tbbbbbbt", "sWGnnGWs", "dnsNNsnd", "dnmNNmnd", "dnnNNnnd"],
  { s: "#be886c", t: "#b78272", b: "#332411", W: "#ffffff", G: "#009611", n: "#b37b62", N: "#905e43", d: "#9a6a50", m: "#774235" },
)

// A creeper's face.
writeSprite(
  "minecraft-creeper.svg",
  ["gGgLggGg", "GggGgLgg", "gKKggKKg", "gKKgLKKg", "LgGKKggG", "GgKKKKgL", "ggKKKKGg", "gGKggKgg"],
  { g: "#4ccb3d", G: "#2e9a2a", L: "#8fdc82", K: "#0c0c0c" },
)

// A command block's face: copper casing, a grey panel, its lights.
writeSprite(
  "minecraft-command.svg",
  [
    "DCCCCCCCCCCCCCCD",
    "CLLLLLLLLLLLLLLd",
    "CLOOOOOOOOOOOOdd",
    "CLOddddddddddOdd",
    "CLOdGGGGGGGGdOdd",
    "CLOdGSSSSSSgdOdd",
    "CLOdGSrSySSgdOdd",
    "CLOdGSSSSSSgdOdd",
    "CLOdGSySrSSgdOdd",
    "CLOdGSSSSSSgdOdd",
    "CLOdGSrSSySgdOdd",
    "CLOdGggggggggOdd",
    "CLOddddddddddOdd",
    "CLOOOOOOOOOOOOdd",
    "Cddddddddddddddd",
    "Dddddddddddddddd",
  ],
  { D: "#51311f", C: "#885536", L: "#ba9880", O: "#b77244", d: "#71411d", G: "#a1a0aa", g: "#484549", S: "#7a787c", r: "#d23a2e", y: "#e6c84a" },
)

// A grass block, from the side: Loom's mark in this theme.
{
  const rnd = random(3)
  const drip = [4, 3, 4, 5, 3, 3, 4, 3, 5, 4, 3, 4, 4, 3, 5, 3]
  const rows = []
  for (let y = 0; y < 16; y++) {
    let row = ""
    for (let x = 0; x < 16; x++) {
      const r = rnd()
      if (y < drip[x]) row += y === 0 ? (r < 0.3 ? "L" : "G") : r < 0.2 ? "g" : r < 0.38 ? "L" : "G"
      else row += r < 0.05 ? "S" : r < 0.25 ? "d" : r < 0.42 ? "l" : r < 0.52 ? "k" : "D"
    }
    rows.push(row)
  }
  writeSprite("minecraft-mark.svg", rows, { G: "#6a9b3f", L: "#7fb24a", g: "#4f7a2e", D: "#866043", l: "#9a7250", d: "#6b4a31", k: "#593d29", S: "#7d7d7d" })
}

// The enchanting table's letters: marks of Loom's own in the manner of the
// alphabet it writes in — a stem, a bar, a corner, and dots set beside them.
// Two lines of them, shown in turn, as the table's words keep changing.
{
  const LINES = [
    [
      ["X....", "X....", "X..X.", "X....", "XXXXX", "....."],
      ["XXXX.", "..X..", "..X.X", "..X..", "..X..", "....."],
      ["X.X.X", ".....", "XXXXX", ".....", "..X..", "....."],
      ["X...X", "...X.", "..X..", ".X...", "X....", "....."],
      ["X.X..", "X.X.X", "X.X..", "X.X.X", "X.X..", "....."],
      ["XX...", ".X...", ".XXX.", "...X.", "...XX", "....."],
      [".XXX.", "X...X", "X...X", "X.X.X", "X...X", "....."],
      ["X...X", ".....", "X...X", ".....", "XXXXX", "....."],
    ],
    [
      ["XXXX.", "...X.", "...X.", "X..X.", ".XX..", "....."],
      ["XXXXX", "..X..", "..X..", ".....", "..X..", "....."],
      ["..X..", "..X..", "X.X.X", "..X..", "..X..", "....."],
      ["XXXXX", "X....", "X.X..", "X....", "X....", "....."],
      [".X.X.", ".....", "XXXXX", "....X", "....X", "....."],
      ["X....", "XXX..", "..X..", "..XXX", "....X", "....."],
      ["X.X..", ".....", ".X.X.", ".....", "..X.X", "....."],
      ["XXXXX", ".....", "XXXXX", "..X..", "X.X.X", "....."],
    ],
  ]
  LINES.forEach((line, n) => {
    let s = ""
    line.forEach((glyph, i) => (s += pixels(glyph, { X: "#ffffff" }, i * 7 + 1, 1)))
    write(`minecraft-runes${n ? "-2" : ""}.svg`, sprite(56, 7, s))
  })
}

// ── The name, in blocks ──────────────────────────────────────────────────
// "LOOM" as letters hewn of stone, for the title screen: thick strokes, light
// along every top edge, cracks running through, a dark underside two pixels
// deep, a black line round it all. Its own lettering, not the game's logo.
{
  const LETTERS = {
    L: ["XX......", "XX......", "XX......", "XX......", "XX......", "XX......", "XX......", "XX......", "XXXXXXXX", "XXXXXXXX"],
    O: ["XXXXXXXX", "XXXXXXXX", "XX....XX", "XX....XX", "XX....XX", "XX....XX", "XX....XX", "XX....XX", "XXXXXXXX", "XXXXXXXX"],
    M: ["XX......XX", "XXX....XXX", "XXXX..XXXX", "XXXXXXXXXX", "XX.XXXX.XX", "XX..XX..XX", "XX......XX", "XX......XX", "XX......XX", "XX......XX"],
  }
  const word = ["L", "O", "O", "M"]
  const TALL = 10
  const W = word.reduce((n, c) => n + LETTERS[c][0].length + 1, 0) + 1
  const H = TALL + 2 + 2
  const grid = Array.from({ length: H }, () => new Array(W).fill(null))
  const rnd = random(8)
  const FACE = ["#a9a9a9", "#a9a9a9", "#b4b4b4", "#9d9d9d", "#a9a9a9", "#bcbcbc"]
  let ox = 1
  for (const c of word) {
    LETTERS[c].forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== "X") continue
        const top = y === 0 || LETTERS[c][y - 1][x] !== "X"
        grid[y + 1][ox + x] = top ? "#dcdcdc" : FACE[Math.floor(rnd() * FACE.length)]
      }
    })
    ox += LETTERS[c][0].length + 1
  }
  // Cracks: short dark runs, down and across, on the faces only.
  for (const [x, y, dx, dy, n] of [[2, 4, 0, 1, 3], [5, 10, 1, 0, 3], [11, 3, 1, 1, 2], [16, 7, 0, 1, 3], [21, 2, 1, 0, 2], [25, 6, 0, 1, 3], [20, 9, 1, 0, 3], [29, 5, 0, 1, 3], [33, 4, 1, 1, 2], [37, 7, 0, 1, 3]])
    for (let i = 0; i < n; i++) {
      const [cx, cy] = [x + dx * i, y + dy * i]
      if (grid[cy]?.[cx] && grid[cy][cx] !== "#dcdcdc") grid[cy][cx] = "#6e6e6e"
    }
  // The underside: two pixels down from every face.
  for (let pass = 0; pass < 2; pass++) {
    const colour = pass === 0 ? "#5a5a5a" : "#3a3a3a"
    for (let y = H - 2; y > 0; y--)
      for (let x = 0; x < W; x++) {
        const above = grid[y - 1][x]
        if (!grid[y][x] && above && (pass === 0 ? above !== "#5a5a5a" : above === "#5a5a5a")) grid[y][x] = colour
      }
  }
  // An outline round it all.
  const filled = grid.map((row) => row.map((c) => c !== null))
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (filled[y][x]) continue
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => filled[y + dy]?.[x + dx])
      if (near) grid[y][x] = "#141414"
    }
  let s = ""
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; ) {
      const colour = grid[y][x]
      let n = 1
      while (x + n < W && grid[y][x + n] === colour) n++
      if (colour) s += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${colour}"/>`
      x += n
    }
  write("minecraft-title.svg", sprite(W, H, s))
  console.log(`  title ${W}x${H}`)
}

// ── An item for each tool ────────────────────────────────────────────────
// (Bash is the command block, Read the book, Edit the book and quill, a
// search the compass, an agent the villager: above. These are the rest.)

// Write: a sheet of paper.
writeSprite(
  "minecraft-paper.svg",
  [
    "................",
    "................",
    ".........aa.....",
    "........aWWa....",
    "......aaWWWWa...",
    ".....aWWWWWWWe..",
    "...aaWWWWWWWWae.",
    "..aWWWWWWWWWWWae",
    ".aWWWWWWWWWWWWe.",
    "..eWWWWWWWWWWe..",
    "...eWWWWWWWWe...",
    "....ebWWWWbe....",
    ".....ebWbe......",
    "......ee........",
    "................",
    "................",
  ],
  { a: "#acacac", W: "#f9f9ef", b: "#d3d3d3", e: "#858585" },
)

// The web: a map.
writeSprite(
  "minecraft-map.svg",
  [
    ".aaaaaaaa.......",
    ".aBBBBBBcaaaaaad",
    ".aBBcBBBBBBBcBBd",
    ".aBBBBBBBBcBBBBd",
    ".aBcBBBBBBBBBcBd",
    ".aBBBBBcBBBBBBeg",
    ".dcBBBBBBBBcBBeg",
    "dcBBBcBBBBBBBBBg",
    "aBBBBBBBBcBBBBeg",
    "aBBcBBBBBBBBBeg.",
    "aBBBBBBcBBBBcBg.",
    "acBBBBBBBBBcBBg.",
    "dBBcBBBBcBBBBBg.",
    "dcBBBBBBBBBcBBg.",
    "ddgdgggeBBBBBcg.",
    ".......gggggggd.",
  ],
  { a: "#947f5d", B: "#fff0d1", c: "#ebd7b2", d: "#877251", e: "#d4c09d", g: "#736041" },
)

// A message sent: a feather.
writeSprite(
  "minecraft-feather.svg",
  [
    "................",
    "................",
    "............a...",
    "...........aWa..",
    "..........aWWb..",
    ".........aWWba..",
    "........aWWba...",
    ".......aWWba....",
    "......aWWbaa....",
    ".....aWWbaWa....",
    "....aWWba.......",
    "...baWba........",
    "..b.bba.........",
    ".b..............",
    "................",
    "................",
  ],
  { a: "#d0d0d0", W: "#fcfcfc", b: "#949494" },
)

// Something wired in from outside (an MCP tool): redstone dust.
writeSprite(
  "minecraft-redstone.svg",
  [
    "................",
    "................",
    "................",
    ".......aa.......",
    "......aCRa......",
    ".....aCRCef.....",
    "....aCRCCRef....",
    "...aCCRCCeaef...",
    "..aCRCCeRCeCef..",
    "..aCCRCCCeeaef..",
    "..feCRCCeCeeef..",
    "...feCCeaeeef...",
    "....ffeeeeff....",
    "......ffff......",
    "................",
    "................",
  ],
  { a: "#5b0700", C: "#a80f01", R: "#fc0000", e: "#400500", f: "#2c0000" },
)
