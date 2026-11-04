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
