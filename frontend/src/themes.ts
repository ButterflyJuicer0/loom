
/**
 * The themes Settings offers. "default" is Loom's own look, whose colours live
 * in theme.css. The others are designed themes: a set of shadcn/ui tokens —
 * colours, a corner radius, a shadow, a font — in a light and a dark
 * appearance (tools/themes.mjs writes them, themes.css maps them onto the
 * interface), and on top of that pictures and motion of their own. A theme
 * is its own files and nothing else: themes/<id>.css, <id>.tokens.css,
 * <id>.meta.json and themes/art/<id>-*.svg.
 */
export type Swatch = {
  background: string
  foreground: string
  sidebar: string
  card: string
  bubble: string
  primary: string
  border: string
}

export type ThemeInfo = {
  id: string
  // Where it comes in Settings' list, lowest first.
  order?: number
  name: { en: string; zh: string }
  blurb: { en: string; zh: string }
  radius: string
  light: Swatch
  dark: Swatch
}

export const DEFAULT_THEME = "default"

const LOOM: ThemeInfo = {
  id: DEFAULT_THEME,
  name: { en: "Loom", zh: "Loom 默认" },
  blurb: { en: "Neutral greys, after ChatGPT", zh: "中性灰，ChatGPT 的样子" },
  radius: "0.75rem",
  light: {
    background: "#ffffff",
    foreground: "#0d0d0d",
    sidebar: "#f9f9f9",
    card: "#ffffff",
    bubble: "#f4f4f4",
    primary: "#0d0d0d",
    border: "#e5e5e5",
  },
  dark: {
    background: "#212121",
    foreground: "#ececec",
    sidebar: "#181818",
    card: "#2f2f2f",
    bubble: "#303030",
    primary: "#ececec",
    border: "#383838",
  },
}

// Every theme that has a themes/<id>.meta.json (tools/themes.mjs writes it).
const metas = import.meta.glob<ThemeInfo>("./themes/*.meta.json", { eager: true, import: "default" })
const DESIGNED = Object.values(metas).sort((a, b) => (a.order ?? 100) - (b.order ?? 100))

export const THEMES: ThemeInfo[] = [LOOM, ...DESIGNED]

export const themeById = (id: string): ThemeInfo => THEMES.find((theme) => theme.id === id) ?? LOOM
