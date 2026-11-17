# Working on Loom

## Every feature change updates loom-guide

When you add or change something Loom can do — a new feature, a changed
behaviour, a removed one — update `skills/loom-guide/SKILL.md` in the same
commit. That skill is what agents read to answer "can Loom do X / how does X
work", so a feature it doesn't mention is one they will say doesn't exist.

Write, for the feature:

- what it does, in a sentence or two;
- its limits (who can use it, what it won't do);
- where the how-to lives: the skill, the doc section, or the module.

Check names, menu labels, commands and paths against the code before writing
them. Then install the updated skill so running agents see it without a
deploy:

```sh
for s in ~/.claude/skills ~/.codex/skills; do
  mkdir -p "$s/loom-guide" && cp skills/loom-guide/SKILL.md "$s/loom-guide/"
done
```

(`rel/deploy.sh` does the same for every skill in `skills/`.)

## Interface text goes through `t()`

The interface speaks Chinese and English (`frontend/src/i18n.ts`). Any text a
user reads — JSX text, `title`, `placeholder`, `aria-label`, labels, hints,
confirms — is written `t("English")`, with its Chinese added to the
dictionary named after the source file (`frontend/src/i18n/zh/<File>.ts`); a
word with two meanings takes a context, `tc("report", "Daily")`. Never
translate what is sent to the server or to an agent, nor identifiers, brand
names, commands or keys.

## Colours come from the theme

Settings offers themes (`frontend/src/themes.css`, `frontend/src/themes/`,
`frontend/tools/themes.mjs`). New CSS uses the variables (`--bg`, `--fg`,
`--fg-dim`, `--line`, `--bg-card`, `--surface-*`) or, in Tailwind and shadcn/ui
components, the tokens (`bg-background`, `text-muted-foreground`,
`border-border`, `bg-primary` …) — never a fixed colour — and is checked in a
light and dark, in the default look and in a designed theme (e.g. 星露谷物语 and 我的世界). A block built with Tailwind
carries the class `tw` (`frontend/src/tailwind.css` says why).
