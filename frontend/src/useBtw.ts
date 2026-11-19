import { useCallback, useEffect, useRef, useState } from "react"
import { askBtw, clearBtw, listBtw, stopBtw, type BtwItem, type BtwMessage } from "./api"

/**
 * A session's side questions (BTW): asked of a copy of the conversation while
 * its turn carries on, and never part of it. See `Loom.Agent.Btw`.
 *
 * The list is the server's, so another device shows the same panel. It comes
 * two ways — asked for here, and announced on the session's channel (`feed`,
 * which `useAgent` calls) — and an answer under way comes as numbered chunks
 * besides. The two do not arrive in order with each other, so:
 *
 *   - a list never takes back text already here: for an item still being
 *     answered, whichever side holds more chunks keeps its answer;
 *   - a chunk is appended only when it is the next one; a later one means
 *     some were missed, and the list is asked for again.
 */
export function useBtw(sessionId: string, enabled: boolean) {
  const [items, setItems] = useState<BtwItem[]>([])
  const [error, setError] = useState<string | null>(null)
  // The list as it stands, ahead of the render: several chunks arrive between
  // two renders, and each has to see the one before it.
  const held = useRef<BtwItem[]>([])
  // Which session the state is for: a reply that comes back after the user
  // moved on must not land in the next one.
  const current = useRef(sessionId)
  current.current = sessionId

  const set = useCallback((next: BtwItem[]) => {
    held.current = next
    setItems(next)
  }, [])

  const take = useCallback(
    (id: string, next: BtwItem[]) => {
      if (current.current === id) set(merge(held.current, next))
    },
    [set],
  )

  const refresh = useCallback(() => {
    const id = current.current
    listBtw(id).then((list) => take(id, list)).catch(() => {})
  }, [take])

  useEffect(() => {
    set([])
    setError(null)
    if (enabled) refresh()
  }, [sessionId, enabled, refresh, set])

  const feed = useCallback(
    (message: BtwMessage) => {
      if (message.type === "items") return set(merge(held.current, message.items))

      const it = held.current.find((x) => x.id === message.id)
      const have = it?.seq ?? 0
      if (it?.status === "answering" && message.seq === have + 1) {
        set(held.current.map((x) => (x === it ? { ...it, answer: it.answer + message.text, seq: message.seq } : x)))
      } else if (!it || (it.status === "answering" && message.seq > have + 1)) {
        // A chunk of an answer this page has not got so far: ask for it whole.
        refresh()
      }
    },
    [refresh, set],
  )

  const run = useCallback(
    (work: (id: string) => Promise<BtwItem[] | void>) => {
      const id = current.current
      setError(null)
      return work(id).then(
        (list) => {
          if (list) take(id, list)
          return true
        },
        (e: unknown) => {
          if (current.current === id) setError(e instanceof Error ? e.message : String(e))
          return false
        },
      )
    },
    [take],
  )

  const ask = useCallback((text: string) => run((id) => askBtw(id, text)), [run])
  const stop = useCallback(() => run((id) => stopBtw(id)), [run])
  const clear = useCallback(
    () =>
      run(async (id) => {
        await clearBtw(id)
        if (current.current === id) set([])
      }),
    [run, set],
  )

  const answering = items.some((it) => it.status === "answering")
  return { items, answering, error, ask, stop, clear, feed }
}

// The server's list, keeping for an answer under way whichever copy is ahead.
function merge(prev: BtwItem[], next: BtwItem[]): BtwItem[] {
  return next.map((n) => {
    const p = prev.find((x) => x.id === n.id)
    return p && n.status === "answering" && (p.seq ?? 0) > (n.seq ?? 0) ? { ...n, answer: p.answer, seq: p.seq } : n
  })
}
