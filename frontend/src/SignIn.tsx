import { Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  authOverview,
  clearToken,
  decideSignIn,
  deletePasskey,
  passkeysSupported,
  registerPasskey,
  revokeLogin,
  type AuthOverview,
  type PendingSignIn,
} from "./api"

// An IPv6 address is too long for a phone's row; its first half says enough.
const shortIp = (ip: string) => (ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + ":…" : ip)

const since = (iso: string | null) => {
  if (!iso) return "never"
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 3600) return "just now"
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * Settings → Sign-in: passkeys (adding one asks for the password again) and
 * the devices signed in now, each removable. See `Loom.Auth`.
 */
export function SignInPage() {
  const [overview, setOverview] = useState<AuthOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    authOverview()
      .then(setOverview)
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(reload, [reload])

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (e) {
      // Dismissing the system sheet is not an error worth a message.
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) setError((e as Error).message)
    } finally {
      setBusy(false)
    }
    reload()
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await registerPasskey(password)
      setAdding(false)
      setPassword("")
    })
  }

  if (!overview) return <p className="settings-hint">{error ?? "…"}</p>

  return (
    <div className="archived-list signin-page">
      <p className="settings-label">Passkeys</p>
      <p className="settings-hint">
        Face ID, Touch ID, Windows Hello or an Android screen lock signs in at once. Without one, the
        password has to be allowed on a device already signed in.
      </p>
      {overview.passkeys.length === 0 && <p className="settings-hint">None yet.</p>}
      {overview.passkeys.map((p) => (
        <div className="signin-item" key={p.id}>
          <div className="signin-body">
            <span className="signin-name">{p.name}</span>
            <span className="signin-meta">used {since(p.last_used_at)}</span>
          </div>
          <button
            className="icon-btn"
            title="Remove passkey"
            onClick={() =>
              confirm(`Remove the passkey made on ${p.name}? Delete it from that device's passwords too.`) &&
              run(() => deletePasskey(p.id))
            }
          >
            <Trash2 />
          </button>
        </div>
      ))}
      {passkeysSupported() ? (
        adding ? (
          <form className="signin-add" onSubmit={add}>
            <input
              type="password"
              className="signin-input"
              placeholder="Password, to confirm"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="keep-btn" disabled={busy || !password}>
              {busy ? "…" : "Add"}
            </button>
            <button type="button" className="icon-btn" title="Cancel" onClick={() => setAdding(false)}>
              <X />
            </button>
          </form>
        ) : (
          <div>
            <button className="keep-btn" onClick={() => setAdding(true)}>
              Add a passkey on this device
            </button>
          </div>
        )
      ) : (
        <p className="settings-hint">This browser can't make passkeys.</p>
      )}

      <p className="settings-label signin-gap">Signed-in devices</p>
      <p className="settings-hint">
        Each signs out after {overview.idle_days} days unused. A device shows up here the next time it
        opens Loom.
      </p>
      {[...overview.logins]
        .sort((a, b) => Number(b.id === overview.current) - Number(a.id === overview.current))
        .map((l) => {
        const me = l.id === overview.current
        return (
          <div className="signin-item" key={l.id}>
            <div className="signin-body">
              <span className="signin-name">
                {l.name}
                {me && <span className="signin-me">This device</span>}
              </span>
              <span className="signin-meta" title={l.ip ?? undefined}>
                {l.method} · {since(l.last_seen_at)}
                {l.ip ? ` · ${shortIp(l.ip)}` : ""}
              </span>
            </div>
            <button
              className="keep-btn"
              onClick={() => {
                if (!confirm(me ? "Sign this device out?" : `Sign ${l.name} out?`)) return
                void run(async () => {
                  await revokeLogin(l.id)
                  if (me) {
                    clearToken()
                    location.reload()
                  }
                })
              }}
            >
              Sign out
            </button>
          </div>
        )
      })}
      {error && <p className="login-error signin-error">{error}</p>}
    </div>
  )
}

/**
 * A password sign-in from another device, waiting for this one's yes. Shown
 * over everything on every signed-in device, newest first; see `Loom.Auth`.
 */
export function SignInRequest({ pending }: { pending: PendingSignIn[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const req = pending.find((p) => !gone.has(p.id))
  if (!req) return null

  const decide = async (allow: boolean) => {
    setError(null)
    setGone((g) => new Set(g).add(req.id))
    try {
      await decideSignIn(req.id, allow)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return createPortal(
    <div className="modal-scrim">
      <div className="modal signin-request" role="alertdialog" aria-label="Sign-in request">
        <div className="modal-head">
          <span>Sign-in request</span>
        </div>
        <div className="settings-body">
          <p>
            <b>{req.name}</b>
            {req.ip ? ` from ${req.ip}` : ""} entered the right password and wants to sign in.
          </p>
          <p className="settings-hint">Only allow it if it's you, on that device, right now.</p>
          {error && <p className="signin-error">{error}</p>}
          <div className="signin-actions">
            <button className="keep-btn" onClick={() => void decide(false)}>
              Deny
            </button>
            <button className="keep-btn signin-allow" onClick={() => void decide(true)}>
              Allow
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
