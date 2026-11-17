/**
 * The interface in Chinese or English, per device (Settings → Language).
 *
 * gettext's way: the English text in the code is the key, and `t()` looks it
 * up in the Chinese dictionary, falling back to the English itself. So a string
 * nobody has translated yet still shows, and the code reads as it did:
 *
 *     t("New chat")                      → "新会话"
 *     t("{n} archived", { n: 3 })        → "3 个已归档"
 *     tc("report", "Daily")              → "日报"   (a word with two meanings)
 *
 * The dictionaries are `i18n/zh/*.ts`, one beside each source file's strings,
 * all merged here. The language is read once, when this module loads, so `t()`
 * also works in a module's top-level constants; changing it in Settings reloads
 * the page (`setLanguage`).
 *
 * Only the interface: what the server sends (titles, an agent's replies, a
 * notice's text) is shown as it comes, and nothing sent to an agent is
 * translated.
 */
export type Language = "zh" | "en"

const KEY = "loom_settings"

function stored(): Language {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}").language
    if (saved === "zh" || saved === "en") return saved
  } catch {
    // An unreadable setting is no setting.
  }
  return "zh"
}

export const language: Language = stored()
document.documentElement.lang = language === "zh" ? "zh-CN" : "en"

const files = import.meta.glob<Record<string, string>>("./i18n/zh/*.ts", { eager: true, import: "default" })
const zh: Record<string, string> = Object.assign({}, ...Object.values(files))

/** The text in the interface's language, with each `{name}` filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const said = language === "zh" ? (zh[text] ?? text) : text
  return vars ? said.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : said
}

/**
 * `t()` for a word that means two things: "Daily" is a schedule on the Tasks
 * page and a report on an employee. The dictionary key is `context|text`
 * ("report|Daily"); without one, it is as `t(text)`.
 */
export function tc(context: string, text: string, vars?: Record<string, string | number>): string {
  const key = `${context}|${text}`
  return language === "zh" && key in zh ? t(key, vars) : t(text, vars)
}

/** Save the choice and reload: every string, top-level constants included, is read anew. */
export function setLanguage(next: Language) {
  if (next === language) return
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    localStorage.setItem(KEY, JSON.stringify({ ...saved, language: next }))
  } catch {
    localStorage.setItem(KEY, JSON.stringify({ language: next }))
  }
  location.reload()
}
