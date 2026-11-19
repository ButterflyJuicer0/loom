import { Fingerprint } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  authOptions,
  cancelLogin,
  login,
  passkeyLogin,
  passkeysSupported,
  pollLogin,
  type AuthOptions,
} from "./api"
import { t, tc } from "./i18n"
import "./Login.css"

type Props = {
  onSuccess: () => void
}

type Waiting = { id: string; poll: string; until: number }

/**
 * The ways in (see `Loom.Auth`): a passkey, offered once one is registered,
 * or the password — which, once some device is signed in, waits for that
 * device to allow this one.
 */
export function Login({ onSuccess }: Props) {
  const [options, setOptions] = useState<AuthOptions | null>(null)
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState<Waiting | null>(null)
  const [now, setNow] = useState(Date.now())
  const waitingRef = useRef<Waiting | null>(null)
  waitingRef.current = waiting

  useEffect(() => {
    authOptions()
      .then(setOptions)
      .catch(() => setOptions({ passkey: false }))
  }, [])

  // Ask every two seconds until the other device answers or time runs out.
  useEffect(() => {
    if (!waiting) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      setNow(Date.now())
      const result = await pollLogin(waiting.id, waiting.poll).catch(() => "waiting" as const)
      if (stopped) return
      if (result === "ok") {
        setWaiting(null)
        onSuccess()
      } else if (result === "denied") {
        setWaiting(null)
        setError("Denied on your other device")
      } else if (result === "expired" || Date.now() > waiting.until) {
        setWaiting(null)
        setError("Nobody allowed it in time — try again")
      }
    }
    const timer = setInterval(tick, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [waiting, onSuccess])

  // Leaving the page gives the request up, so it doesn't linger on the others.
  useEffect(() => {
    const leave = () => {
      const w = waitingRef.current
      if (w) cancelLogin(w.id, w.poll)
    }
    window.addEventListener("pagehide", leave)
    return () => window.removeEventListener("pagehide", leave)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await login(password)
      setPassword("")
      if ("token" in result) onSuccess()
      else {
        const { id, poll, expiresIn } = result.pending
        setNow(Date.now())
        setWaiting({ id, poll, until: Date.now() + expiresIn * 1000 })
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message === "invalid_password"
          ? t("Wrong password")
          : err instanceof Error && err.message === "too_many_attempts"
            ? t("Too many tries — wait a few minutes")
            : t("Login failed"),
      )
      setPassword("")
    } finally {
      setBusy(false)
    }
  }

  const withPasskey = async () => {
    setBusy(true)
    setError(null)
    try {
      await passkeyLogin()
      onSuccess()
    } catch (err) {
      // Dismissing the sheet is not an error worth a message.
      if (!(err instanceof DOMException && err.name === "NotAllowedError")) {
        setError("That passkey was not accepted")
      }
    } finally {
      setBusy(false)
    }
  }

  const giveUp = () => {
    if (waiting) cancelLogin(waiting.id, waiting.poll)
    setWaiting(null)
  }

  if (waiting) {
    const left = Math.max(0, Math.round((waiting.until - now) / 1000))
    return (
      <div className="login">
        <div className="login-box">
          <div className="login-title">loom</div>
          <div className="login-wait">
            Password OK. Allow this sign-in on a device that is already signed in — your phone has a
            notification.
          </div>
          <div className="login-wait-time">{left}s left</div>
          <button type="button" className="login-btn login-secondary" onClick={giveUp}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const offerPasskey = options?.passkey && passkeysSupported()

  return (
    <div className="login">
      <form className="login-box" onSubmit={submit}>
        <div className="login-title">loom</div>
        {offerPasskey && (
          <>
            <button type="button" className="login-btn login-passkey" onClick={withPasskey} disabled={busy}>
              <Fingerprint />
              Sign in with passkey
            </button>
            <div className="login-or">or</div>
          </>
        )}
        <input
          type="password"
          className="login-input"
          placeholder={t("password")}
          value={password}
          autoFocus={!offerPasskey}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="login-error">{error}</div>}
        <button
          className={offerPasskey ? "login-btn login-secondary" : "login-btn"}
          type="submit"
          disabled={busy || !password}
        >
          {busy ? "…" : tc("login", "Enter")}
        </button>
      </form>
    </div>
  )
}
