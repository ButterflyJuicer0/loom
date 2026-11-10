import { Search as SearchIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { searchSessions, type AgentInfo, type SearchHit } from "./api"
import { lastActive } from "./useLobby"

/**
 * ChatGPT's search: the sidebar's button opens it over everything. Empty, it
 * lists the latest sessions; typed in, the ones whose name or conversation
 * has the words, each with the line they are in. On a phone the whole screen,
 * on a desktop a panel over the page. The sidebar's button or ⌘K / Ctrl+K
 * opens it; archived sessions are found too, and say so.
 */
export function SearchSheet({
  sessions,
  onSelect,
  onClose,
}: {
  sessions: AgentInfo[]
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const q = query.trim()

  useEffect(() => input.current?.focus(), [])

  // What was said: from the server, once typing pauses.
  useEffect(() => {
    setHits(null)
    if (!q) return
    const abort = new AbortController()
    const timer = setTimeout(
      () => searchSessions(q, abort.signal).then(setHits, () => {}),
      200,
    )
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [q])

  const rows = useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]))
    const newest = [...sessions].sort((a, b) => lastActive(b) - lastActive(a))
    if (!q) return newest.slice(0, 30).map((s) => ({ session: s, snippet: null as string | null }))
    // By name at once, here; by what was said when the server answers. One
    // row a session, newest first.
    const lower = q.toLowerCase()
    const said = new Map((hits ?? []).map((h) => [h.id, h.snippet]))
    return newest
      .filter((s) => (s.title ?? s.id).toLowerCase().includes(lower) || said.has(s.id))
      .filter((s) => byId.has(s.id))
      .map((s) => ({ session: s, snippet: said.get(s.id) ?? null }))
  }, [sessions, q, hits])

  const pick = (id: string) => {
    onSelect(id)
    onClose()
  }

  return createPortal(
    <div className="search-sheet" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="search-bar">
          <label className="search-field">
            <SearchIcon />
            <input
              ref={input}
              type="search"
              value={query}
              placeholder="Search chats"
              enterKeyHint="search"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose()
                else if (e.key === "Enter" && rows[0]) pick(rows[0].session.id)
              }}
            />
          </label>
          <button className="search-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="search-results">
          {!q && <div className="search-heading">Recents</div>}
          {rows.map(({ session, snippet }) => (
            <button key={session.id} className="search-row" onClick={() => pick(session.id)}>
              <span className="search-title">
                <Marked text={session.title ?? session.id} query={q} />
              </span>
              {session.archived_at != null && <span className="search-archived">archived</span>}
              {snippet && (
                <span className="search-snippet">
                  <Marked text={snippet} query={q} />
                </span>
              )}
            </button>
          ))}
          {q && hits !== null && rows.length === 0 && <div className="search-empty">No chats mention “{q}”.</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** The text with each place it has the words in bold. */
function Marked({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"))
  return <>{parts.map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</>
}
