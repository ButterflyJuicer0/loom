import { useEffect, useRef, useState } from "react"
import RFB from "@novnc/novnc"
import { ArrowRightToLine, ChevronLeft, CornerDownLeft, Delete, Keyboard, Maximize, Minimize, RefreshCw, Send, X, ZoomIn, ZoomOut } from "lucide-react"
import { getToken } from "./api"
import { t } from "./i18n"

/**
 * Loom's own browser — the Chromium that agents drive over CDP — shown here so
 * the user can take it over: log in to a site once, get past a check that
 * wants a human. Over VNC: `LoomWeb.VncSocket` carries it, noVNC draws it.
 *
 * On a phone the pane asks for a window of its own shape (see
 * `Loom.Browser`), so sites lay themselves out for a narrow screen and the
 * page fills the pane, rather than a desktop screen shrunk to unreadable.
 *
 * Mounted only while shown, so a closed pane holds no connection open.
 */
export function Browser({
  narrow,
  maximized,
  onToggleMaximized,
  onClose,
}: {
  narrow: boolean
  maximized: boolean
  onToggleMaximized: () => void
  onClose: () => void
}) {
  const screen = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const [state, setState] = useState<"connecting" | "connected" | "closed">("connecting")
  const [attempt, setAttempt] = useState(0)
  // Fit the whole screen in the pane, or show it at 1:1 and pan by dragging.
  const [fit, setFit] = useState(true)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState("")

  useEffect(() => {
    const el = screen.current
    if (!el) return
    const proto = location.protocol === "https:" ? "wss:" : "ws:"
    let url = `${proto}//${location.host}/browser/vnc?token=${encodeURIComponent(getToken() ?? "")}`
    if (narrow) url += `&w=${el.clientWidth}&h=${el.clientHeight}`
    const r = new RFB(el, url, { wsProtocols: [] })
    r.background = "transparent"
    // A replaced connection's goodbye arrives after its successor started.
    r.addEventListener("connect", () => rfb.current === r && setState("connected"))
    r.addEventListener("disconnect", () => rfb.current === r && setState("closed"))
    rfb.current = r
    setState("connecting")
    return () => {
      rfb.current = null
      r.disconnect()
    }
  }, [attempt, narrow])

  // A phone turned on its side wants a window of the other shape. The screen's
  // orientation, not the pane's: the keyboard coming up squashes the pane
  // without the phone having turned. Connect again once the pane has settled.
  useEffect(() => {
    if (!narrow) return
    let timer: number | undefined
    const turned = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => setAttempt((n) => n + 1), 400)
    }
    // Older iOS has no `screen.orientation`, only the window's event.
    const [target, event] = window.screen.orientation
      ? [window.screen.orientation, "change"]
      : [window, "orientationchange"]
    target.addEventListener(event, turned)
    return () => {
      clearTimeout(timer)
      target.removeEventListener(event, turned)
    }
  }, [narrow])

  useEffect(() => {
    const r = rfb.current
    if (!r) return
    r.scaleViewport = fit
    r.clipViewport = !fit
    r.dragViewport = !fit && narrow
  }, [fit, narrow, attempt, state])

  // A phone's keyboard won't come up for a canvas, so text goes in through a
  // field of our own and is typed into the page key by key.
  const send = (s: string) => {
    const r = rfb.current
    if (!r) return
    for (const ch of s) {
      const code = ch.codePointAt(0)!
      // X keysyms: Latin-1 is its own code point; the rest of Unicode is offset.
      r.sendKey(code < 0x100 ? code : 0x01000000 + code, null)
    }
  }
  const key = (keysym: number) => rfb.current?.sendKey(keysym, null)

  return (
    <div className="browser-pane">
      <div className="pane-head">
        <span className="pane-title">
          {narrow && (
            <button className="pane-btn" onClick={onClose} title={t("Back to the chat")}>
              <ChevronLeft />
            </button>
          )}
          {t("browser")}
          {state !== "connected" && <span className="browser-state">{state === "connecting" ? t("connecting…") : t("disconnected")}</span>}
        </span>
        <span className="pane-actions">
          {state === "closed" && (
            <button className="pane-btn" onClick={() => setAttempt((n) => n + 1)} title={t("Connect again")}>
              <RefreshCw />
            </button>
          )}
          <button
            className={"pane-btn" + (typing ? " on" : "")}
            onClick={() => setTyping((t) => !t)}
            title={t("Type text into the page")}
          >
            <Keyboard />
          </button>
          <button
            className="pane-btn"
            onClick={() => setFit((f) => !f)}
            title={fit ? t("Actual size; drag to pan on a touch screen") : t("Fit the screen in the pane")}
          >
            {fit ? <ZoomIn /> : <ZoomOut />}
          </button>
          {!narrow && (
            <button
              className="pane-btn"
              onClick={onToggleMaximized}
              title={maximized ? t("Back beside the chat") : t("Full window")}
            >
              {maximized ? <Minimize /> : <Maximize />}
            </button>
          )}
          {!narrow && (
            <button className="pane-btn" onClick={onClose} title={t("Close")}>
              <X />
            </button>
          )}
        </span>
      </div>
      {typing && (
        <form
          className="browser-type"
          onSubmit={(e) => {
            e.preventDefault()
            send(text)
            setText("")
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("Text for the focused field")}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="pane-btn" title={t("Type it")}>
            <Send />
          </button>
          <button type="button" className="pane-btn" onClick={() => key(0xff08)} title="Backspace">
            <Delete />
          </button>
          <button type="button" className="pane-btn" onClick={() => key(0xff09)} title="Tab">
            <ArrowRightToLine />
          </button>
          <button type="button" className="pane-btn" onClick={() => key(0xff0d)} title="Enter">
            <CornerDownLeft />
          </button>
        </form>
      )}
      <div className="browser-screen" ref={screen} />
    </div>
  )
}
