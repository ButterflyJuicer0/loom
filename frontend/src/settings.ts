import { useEffect, useState } from "react"
import type { AgentBackend } from "./api"

/**
 * This device's preferences, from the Settings dialog: how Loom looks, how
 * big its text is, and which engine a new session starts on. Kept in
 * localStorage — a phone and a laptop may well want different ones — and
 * applied as soon as they change.
 */
export type Appearance = "dark" | "light"

export type Settings = {
  appearance: Appearance
  // Text size, as a multiple of the default 16px. Every size is in rem, so
  // this one scales the whole interface; see theme.css.
  fontScale: number
  // And on top of it, each area's own: the sidebar, the conversation, and
  // code in it (blocks and tool output). 1 is as the interface is.
  sidebarScale: number
  chatScale: number
  codeScale: number
  // The cards of the phone's switcher (Switcher.tsx): titles, the recap under
  // them (also a Working row's second line), and the last reply below that.
  cardTitleScale: number
  cardTextScale: number
  cardBodyScale: number
  // What "+" makes, with nothing to choose. Codex is a setting away.
  backend: AgentBackend
}

const KEY = "loom_settings"
const DEFAULTS: Settings = {
  appearance: "dark",
  fontScale: 1,
  sidebarScale: 1,
  chatScale: 1,
  codeScale: 1,
  cardTitleScale: 1,
  cardTextScale: 1,
  cardBodyScale: 1,
  backend: "claude_code",
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }
  } catch {
    return DEFAULTS
  }
}

// The status bar and a home-screen app's chrome follow the page: black on a
// phone and #212121 on a desktop when dark (see index.html), white when light.
function apply({ appearance, fontScale, sidebarScale, chatScale, codeScale, cardTitleScale, cardTextScale, cardBodyScale }: Settings) {
  const root = document.documentElement
  root.dataset.theme = appearance
  root.style.setProperty("--font-scale", String(fontScale))
  root.style.setProperty("--sidebar-scale", String(sidebarScale))
  root.style.setProperty("--chat-scale", String(chatScale))
  root.style.setProperty("--code-scale", String(codeScale))
  root.style.setProperty("--card-title-scale", String(cardTitleScale))
  root.style.setProperty("--card-text-scale", String(cardTextScale))
  root.style.setProperty("--card-body-scale", String(cardBodyScale))
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.dataset.dark ??= meta.content
    meta.content = appearance === "light" ? "#ffffff" : meta.dataset.dark
  }
}

// Before the first render, so a light page never flashes dark.
apply(load())

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(load)
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings))
    apply(settings)
  }, [settings])
  return [settings, (patch) => setSettings((s) => ({ ...s, ...patch }))]
}
