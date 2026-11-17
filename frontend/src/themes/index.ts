// A designed theme's stylesheets — its tokens (<id>.tokens.css) and its
// design (<id>.css) — fetched when the theme is chosen and not before: nine
// themes' pictures are a megabyte and a half nobody should wait for to see
// one. Loaded this way they also come after themes.css, which they are
// written to follow.
const sheets = import.meta.glob("./*.css")
const loading = new Map<string, Promise<void>>()

/** Resolves once the theme's stylesheets are in the page (at once for one that has none). */
export function loadTheme(id: string): Promise<void> {
  let pending = loading.get(id)
  if (!pending) {
    const files = [`./${id}.tokens.css`, `./${id}.css`].filter((file) => file in sheets)
    pending = Promise.all(files.map((file) => sheets[file]())).then(() => undefined)
    // A failed fetch may be tried again.
    pending.catch(() => loading.delete(id))
    loading.set(id, pending)
  }
  return pending
}
