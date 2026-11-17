import { Check } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { language, t } from "./i18n"
import type { Appearance } from "./settings"
import { THEMES, type Swatch, type ThemeInfo } from "./themes"

// A designed theme's own picture, in the corner of its card's sidebar:
// themes/art/<id>-mark.svg, if it has one.
const marks = import.meta.glob<string>("./themes/art/*-mark.svg", { eager: true, import: "default" })
const MARKS: Record<string, string> = Object.fromEntries(
  Object.entries(marks).map(([file, url]) => [file.slice(file.lastIndexOf("/") + 1, -"-mark.svg".length), url]),
)

/**
 * Settings → Theme: every theme as a card with a small picture of itself, in
 * the appearance (light or dark) Loom is in now. Picking one applies it at
 * once, to the page behind the dialog too.
 *
 * Built with Tailwind and shadcn/ui (see tailwind.css): the cards read the
 * current theme's tokens, the pictures the colours of the theme they show.
 */
export function ThemePicker({
  value,
  appearance,
  onChange,
}: {
  value: string
  appearance: Appearance
  onChange: (style: string) => void
}) {
  return (
    <div className="tw grid grid-cols-2 gap-3 pt-1 pb-2 min-[720px]:grid-cols-4" role="radiogroup" aria-label={t("Theme")}>
      {THEMES.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          swatch={theme[appearance]}
          selected={theme.id === value}
          onPick={() => onChange(theme.id)}
        />
      ))}
    </div>
  )
}

function ThemeCard({
  theme,
  swatch,
  selected,
  onPick,
}: {
  theme: ThemeInfo
  swatch: Swatch
  selected: boolean
  onPick: () => void
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={cn(
        "group flex flex-col gap-2 rounded-lg border bg-card p-2 text-left text-card-foreground transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border",
      )}
    >
      <Preview swatch={swatch} radius={theme.radius} mark={MARKS[theme.id]} />
      <span className="flex min-w-0 flex-col gap-0.5 px-1 pb-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{theme.name[language]}</span>
          {selected && (
            <Badge className="h-4 gap-0.5 px-1.5 text-[0.625rem]">
              <Check className="size-2.5" />
              {t("In use")}
            </Badge>
          )}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground group-hover:text-accent-foreground/80">
          {theme.blurb[language]}
        </span>
      </span>
    </button>
  )
}

/** Loom in miniature: its sidebar, a question and an answer, the composer and its send button. */
function Preview({ swatch, radius, mark }: { swatch: Swatch; radius: string; mark?: string }) {
  // A corner of the theme's own, scaled to the picture and kept sensible.
  const corner = `min(calc(${radius} * 0.6), 0.6rem)`
  const line = (width: string, opacity = 0.55) => (
    <span className="block h-1 rounded-full" style={{ width, background: swatch.foreground, opacity }} />
  )
  return (
    <span
      aria-hidden
      className="flex aspect-[16/10] w-full overflow-hidden border"
      style={{ background: swatch.background, borderColor: swatch.border, borderRadius: `min(${radius}, 0.75rem)` }}
    >
      <span className="flex w-[26%] flex-col gap-1.5 p-1.5" style={{ background: swatch.sidebar }}>
        {line("70%", 0.8)}
        {line("90%", 0.35)}
        {line("60%", 0.35)}
        {line("80%", 0.35)}
        {mark && <img src={mark} alt="" className="mt-auto h-5 w-auto self-center" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-2" style={{ borderLeft: `1px solid ${swatch.border}` }}>
        <span
          className="ml-auto block h-3 w-[46%] border"
          style={{ background: swatch.bubble, borderColor: swatch.border, borderRadius: corner }}
        />
        {line("82%")}
        {line("64%")}
        {line("40%")}
        <span
          className="mt-auto flex h-4 items-center justify-end border px-1"
          style={{ background: swatch.card, borderColor: swatch.border, borderRadius: corner }}
        >
          <span className="block size-2.5" style={{ background: swatch.primary, borderRadius: corner }} />
        </span>
      </span>
    </span>
  )
}
