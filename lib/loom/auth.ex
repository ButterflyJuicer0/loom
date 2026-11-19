defmodule Loom.Auth do
  @moduledoc """
  Who may use this Loom: one user, signing in on each device with a passkey,
  or with the password and a yes from a device already signed in.

  Whoever is signed in has a shell, so the door is what is guarded. Ported in
  part from upstream EthanLLL/loom e7a6339 (passkeys, one login per device);
  the approval step and the per-client brake (`Loom.Auth.Throttle`) are ours.

  - **Passkeys** (`Loom.Auth.WebAuthn`) — Face ID, Touch ID, Windows Hello,
    Android's screen lock — are a second factor in themselves and sign in at
    once. Adding one needs a signed-in device *and* the password again, so a
    stolen token cannot plant a passkey of its own and outlive being revoked.
  - **The password** alone no longer lets a new device in once any device is
    signed in: it makes a *pending* sign-in, shown on every signed-in device
    (lobby channel, plus a push) with Allow / Deny, good for
    `@pending_ttl` s. The waiting page polls with a secret only it holds.
    With no login at all (first device, or every device signed out) the
    password alone works, or nobody could ever get in; on the host,
    `bin/loom rpc 'Loom.Auth.pending() |> IO.inspect'` and
    `Loom.Auth.approve(id)` are the way in if every device is lost.
  - **One login per device.** A sign-in records a login — device name from
    its user agent, how it signed in, its IP — and the token names it.
    Removing it signs that device out (its sockets too); so does
    `@idle_days` without using it. A device in use never has to sign in again.
  - **The password's fingerprint** rides in every token, so changing
    `LOOM_PASSWORD` still retires every token at once.
  - **Tokens from before logins** (`%{ok: true, pw: _}`) still work until their
    old 30-day limit, and are swapped for a login of their own the first time
    the app opens (`upgrade/1`), so the change signs nobody out. One with no
    password fingerprint is refused: whoever has the signing key (dev's is
    in the repo) could mint it without the password.
  - A new sign-in is announced on every device with notifications on.

  Truth is `~/.loom/auth.json` (mode 0600): passkeys and logins. Challenges
  and pending sign-ins are only in memory: a restart drops them.
  """
  use GenServer

  require Logger

  alias Loom.Auth.WebAuthn

  @name __MODULE__
  @salt "loom auth token"
  # The signature's own limit; a login lapses long before, after @idle_days.
  @max_age 60 * 60 * 24 * 365
  # What tokens from before logins were signed for.
  @legacy_max_age 60 * 60 * 24 * 30
  @idle_days 30
  # How stale a login's last_seen_at may get before it is written again.
  @touch_every 3600
  @challenge_ttl 300
  @max_challenges 100
  @pending_ttl 120
  @max_pending 5

  def start_link(opts) do
    name = Keyword.get(opts, :name, @name)
    GenServer.start_link(__MODULE__, opts, if(name, do: [name: name], else: []))
  end

  def path,
    do:
      Application.get_env(:loom, __MODULE__, [])[:path] ||
        Path.join(Loom.Agent.Store.home(), "auth.json")

  def pending_ttl, do: @pending_ttl

  @doc """
  Verify a plaintext password against the configured one (constant-time).
  Fails closed: an empty password, or no configured password, never matches.
  """
  def valid_password?(password) when is_binary(password) and password != "" do
    case configured() do
      "" -> false
      configured -> Plug.Crypto.secure_compare(password, configured)
    end
  end

  def valid_password?(_), do: false

  @doc """
  The login a token belongs to: `{:ok, id}`, `{:ok, :legacy}` for a token from
  before logins, or `{:error, reason}`. Keeps the login's last_seen_at fresh.
  """
  def verify_token(token, server \\ @name)

  def verify_token(token, server) when is_binary(token) do
    case Phoenix.Token.verify(LoomWeb.Endpoint, @salt, token, max_age: @max_age) do
      {:ok, %{login: id, pw: pw}} ->
        if same_password?(pw), do: GenServer.call(server, {:touch, id}), else: {:error, :invalid}

      {:ok, %{ok: true} = legacy} ->
        with {:ok, _} <-
               Phoenix.Token.verify(LoomWeb.Endpoint, @salt, token, max_age: @legacy_max_age),
             true <- is_binary(legacy[:pw]) and same_password?(legacy.pw) do
          {:ok, :legacy}
        else
          _ -> {:error, :invalid}
        end

      {:ok, _} ->
        {:error, :invalid}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def verify_token(_, _), do: {:error, :missing}

  @doc "What the sign-in page offers: `%{passkey: bool}`."
  def options(server \\ @name), do: GenServer.call(server, :options)

  @doc """
  The password was right (the caller checked it, and the brake): a token at
  once when no device is signed in, else a pending sign-in to wait on.
  `{:ok, token}` or `{:pending, %{id:, poll:, expires_in:}}`.
  """
  def password_login(info, server \\ @name),
    do: GenServer.call(server, {:password_login, info})

  @doc """
  What became of a pending sign-in, asked by the page waiting on it with the
  secret it was given: `{:ok, token}` (once), `:waiting`,
  `{:error, :denied | :expired}`.
  """
  def poll(id, secret, server \\ @name), do: GenServer.call(server, {:poll, id, secret})

  @doc "The waiting page gave up."
  def cancel(id, secret, server \\ @name), do: GenServer.call(server, {:cancel, id, secret})

  @doc "Pending sign-ins, for signed-in devices to allow or deny."
  def pending(server \\ @name), do: GenServer.call(server, :pending)

  @doc "Let a pending sign-in in. `by` is the login that said yes."
  def approve(id, by \\ "host", server \\ @name), do: GenServer.call(server, {:decide, id, {:approve, by}})

  def deny(id, server \\ @name), do: GenServer.call(server, {:decide, id, :deny})

  @doc "A challenge for a passkey to sign, good for #{@challenge_ttl} s, once."
  def challenge(kind, server \\ @name) when kind in [:login, :register],
    do: GenServer.call(server, {:challenge, kind})

  @doc "Sign in with a passkey: the assertion's fields, base64url. `{:ok, token}` or `{:error, _}`."
  def passkey_login(assertion, info, server \\ @name),
    do: GenServer.call(server, {:passkey_login, assertion, info})

  @doc "Keep a new passkey: the registration's fields, base64url, plus `id`."
  def register_passkey(registration, info, server \\ @name),
    do: GenServer.call(server, {:register_passkey, registration, info})

  def delete_passkey(id, server \\ @name), do: GenServer.call(server, {:delete_passkey, id})

  @doc "Swap a token from before logins for one naming a login of its own."
  def upgrade(info, server \\ @name), do: GenServer.call(server, {:upgrade, info})

  @doc "Passkeys and logins, for the settings page."
  def overview(server \\ @name), do: GenServer.call(server, :overview)

  @doc "Sign one device out. The caller drops its sockets."
  def revoke(id, server \\ @name), do: GenServer.call(server, {:revoke, id})

  @doc "Sign every device out. Returns the ids, for the caller to drop their sockets."
  def revoke_all(server \\ @name), do: GenServer.call(server, :revoke_all)

  @doc "A token for a new login, as a sign-in would make. For tests and tools."
  def mint_token(name \\ "test", server \\ @name),
    do: GenServer.call(server, {:mint, %{name: name, ip: nil}, "password"})

  # ── Server ──────────────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    path = Keyword.get(opts, :path, path())

    state =
      path
      |> load()
      |> Map.merge(%{path: path, challenges: %{}, pending: %{}})

    {:ok, state}
  end

  @impl true
  def handle_call({:touch, id}, _from, state) do
    now = System.os_time(:second)

    case state.logins[id] do
      nil ->
        {:reply, {:error, :revoked}, state}

      login ->
        seen = unix(login.last_seen_at)

        cond do
          now - seen > @idle_days * 86_400 ->
            {:reply, {:error, :expired}, save(%{state | logins: Map.delete(state.logins, id)})}

          now - seen >= @touch_every ->
            state = put_in(state.logins[id].last_seen_at, iso(now))
            {:reply, {:ok, id}, save(state)}

          true ->
            {:reply, {:ok, id}, state}
        end
    end
  end

  def handle_call(:options, _from, state) do
    {:reply, %{passkey: map_size(state.passkeys) > 0}, state}
  end

  def handle_call({:password_login, info}, _from, state) do
    state = prune_pending(state)

    if map_size(state.logins) == 0 do
      {token, state} = new_login(state, info, "password")
      {:reply, {:ok, token}, state}
    else
      id = rand(9)
      secret = rand(24)

      entry = %{
        id: id,
        secret: secret,
        name: info.name,
        ip: info.ip,
        at: System.monotonic_time(:second),
        requested_at: iso(System.os_time(:second)),
        status: :waiting
      }

      # Only the newest few: the password is needed to make one at all, so
      # this only bounds a flood from someone who has it.
      pending =
        state.pending
        |> Map.values()
        |> Enum.sort_by(& &1.at, :desc)
        |> Enum.take(@max_pending - 1)
        |> Map.new(&{&1.id, &1})
        |> Map.put(id, entry)

      state = %{state | pending: pending}
      Logger.warning("login: password ok, awaiting approval id=#{id} device=#{info.name} ip=#{info.ip}")

      Loom.Push.notify(
        "Sign-in request",
        "#{info.name}#{ip_note(info.ip)} wants to sign in. Open Loom to allow or deny.",
        nil
      )

      announce_pending(state)
      {:reply, {:pending, %{id: id, poll: secret, expires_in: @pending_ttl}}, state}
    end
  end

  def handle_call({:poll, id, secret}, _from, state) do
    state = prune_pending(state)

    case fetch_pending(state, id, secret) do
      nil ->
        {:reply, {:error, :expired}, state}

      %{status: :waiting} ->
        {:reply, :waiting, state}

      %{status: :denied} ->
        {:reply, {:error, :denied}, drop_pending(state, id)}

      %{status: {:approved, by}} = entry ->
        {token, state} =
          new_login(drop_pending(state, id), entry, "password, allowed on #{by}")

        {:reply, {:ok, token}, state}
    end
  end

  def handle_call({:cancel, id, secret}, _from, state) do
    case fetch_pending(state, id, secret) do
      nil -> {:reply, :ok, state}
      _ -> {:reply, :ok, drop_pending(state, id)}
    end
  end

  def handle_call(:pending, _from, state) do
    state = prune_pending(state)
    {:reply, public_pending(state), state}
  end

  def handle_call({:decide, id, decision}, _from, state) do
    state = prune_pending(state)

    case state.pending[id] do
      %{status: :waiting} = entry ->
        status =
          case decision do
            {:approve, by} -> {:approved, login_name(state, by)}
            :deny -> :denied
          end

        Logger.warning("login: pending id=#{id} #{inspect(status)}")
        state = put_in(state.pending[id], %{entry | status: status})
        announce_pending(state)
        {:reply, :ok, state}

      nil ->
        {:reply, {:error, :expired}, state}

      _ ->
        {:reply, {:error, :decided}, state}
    end
  end

  def handle_call({:challenge, kind}, _from, state) do
    now = System.monotonic_time(:second)
    challenge = rand(32)

    challenges =
      state.challenges
      |> Map.reject(fn {_, {_, at}} -> now - at > @challenge_ttl end)
      |> Enum.sort_by(fn {_, {_, at}} -> at end, :desc)
      |> Enum.take(@max_challenges - 1)
      |> Map.new()
      |> Map.put(challenge, {kind, now})

    {:reply, challenge, %{state | challenges: challenges}}
  end

  def handle_call({:passkey_login, assertion, info}, _from, state) do
    with id when is_binary(id) <- assertion["id"],
         %{} = passkey <- state.passkeys[id],
         {:ok, challenge} <- WebAuthn.verify(assertion, passkey),
         {:ok, state} <- take_challenge(state, challenge, :login) do
      state = put_in(state.passkeys[id].last_used_at, iso(System.os_time(:second)))
      {token, state} = new_login(state, Map.put(info, :passkey, passkey.name), "passkey")
      {:reply, {:ok, token}, state}
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
      _ -> {:reply, {:error, :unknown_passkey}, state}
    end
  end

  def handle_call({:register_passkey, registration, info}, _from, state) do
    with id when is_binary(id) and id != "" <- registration["id"],
         false <- Map.has_key?(state.passkeys, id),
         {:ok, %{challenge: challenge} = checked} <- WebAuthn.register(registration),
         {:ok, state} <- take_challenge(state, challenge, :register) do
      passkey = %{
        id: id,
        name: info.name,
        rp_id: checked.rp_id,
        public_key: checked.public_key,
        created_at: iso(System.os_time(:second)),
        last_used_at: nil
      }

      Loom.Push.notify("Passkey added to Loom", "#{info.name}#{ip_note(info[:ip])}", nil)
      state = save(put_in(state.passkeys[id], passkey))
      {:reply, {:ok, public_passkey(passkey)}, state}
    else
      true -> {:reply, {:error, :exists}, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
      _ -> {:reply, {:error, :malformed}, state}
    end
  end

  def handle_call({:delete_passkey, id}, _from, state) do
    {:reply, :ok, save(%{state | passkeys: Map.delete(state.passkeys, id)})}
  end

  def handle_call({:upgrade, info}, _from, state) do
    {token, state} = new_login(state, info, "password", announce: false)
    {:reply, {:ok, token}, state}
  end

  def handle_call({:mint, info, method}, _from, state) do
    {token, state} = new_login(state, info, method, announce: false)
    {:reply, token, state}
  end

  def handle_call(:overview, _from, state) do
    overview = %{
      passkeys:
        state.passkeys
        |> Map.values()
        |> Enum.sort_by(& &1.created_at)
        |> Enum.map(&public_passkey/1),
      logins: state.logins |> Map.values() |> Enum.sort_by(& &1.last_seen_at, :desc),
      idle_days: @idle_days
    }

    {:reply, overview, state}
  end

  def handle_call({:revoke, id}, _from, state) do
    {:reply, :ok, save(%{state | logins: Map.delete(state.logins, id)})}
  end

  def handle_call(:revoke_all, _from, state) do
    {:reply, Map.keys(state.logins), save(%{state | logins: %{}})}
  end

  # ── Helpers ─────────────────────────────────────────────────────────────

  defp take_challenge(state, challenge, kind) do
    now = System.monotonic_time(:second)

    case Map.pop(state.challenges, challenge) do
      {{^kind, at}, rest} when now - at <= @challenge_ttl -> {:ok, %{state | challenges: rest}}
      _ -> {:error, :challenge}
    end
  end

  defp new_login(state, info, method, opts \\ []) do
    id = rand(9)
    now = iso(System.os_time(:second))

    login = %{
      id: id,
      name: info.name,
      method: method_label(method, info),
      ip: info.ip,
      created_at: now,
      last_seen_at: now
    }

    if Keyword.get(opts, :announce, true) do
      Logger.info("login: new login id=#{id} device=#{login.name} method=#{login.method} ip=#{info.ip}")
      Loom.Push.notify("New sign-in to Loom", "#{login.name}, #{login.method}" <> ip_note(info.ip), nil)
    end

    state = save(put_in(state.logins[id], login))
    {Phoenix.Token.sign(LoomWeb.Endpoint, @salt, %{login: id, pw: fingerprint()}), state}
  end

  # A passkey made elsewhere — a PC signing in with the phone next to it — says where.
  defp method_label("passkey", %{passkey: made_on, name: name}) when made_on != name,
    do: "passkey made on #{made_on}"

  defp method_label(method, _info), do: method

  defp login_name(state, by) do
    case state.logins[by] do
      %{name: name} -> name
      _ -> to_string(by)
    end
  end

  defp ip_note(nil), do: ""
  defp ip_note(ip), do: ", from #{ip}"

  defp fetch_pending(state, id, secret) when is_binary(id) and is_binary(secret) do
    case state.pending[id] do
      %{secret: s} = entry -> if Plug.Crypto.secure_compare(s, secret), do: entry
      _ -> nil
    end
  end

  defp fetch_pending(_, _, _), do: nil

  defp drop_pending(state, id) do
    state = %{state | pending: Map.delete(state.pending, id)}
    announce_pending(state)
    state
  end

  defp prune_pending(state) do
    now = System.monotonic_time(:second)
    {live, gone} = Enum.split_with(state.pending, fn {_, p} -> now - p.at <= @pending_ttl end)
    state = %{state | pending: Map.new(live)}
    if gone != [], do: announce_pending(state)
    state
  end

  defp public_pending(state) do
    now = System.monotonic_time(:second)

    state.pending
    |> Map.values()
    |> Enum.filter(&(&1.status == :waiting))
    |> Enum.sort_by(& &1.at)
    |> Enum.map(fn p ->
      %{
        id: p.id,
        name: p.name,
        ip: p.ip,
        requested_at: p.requested_at,
        expires_in: max(@pending_ttl - (now - p.at), 0)
      }
    end)
  end

  defp announce_pending(state) do
    Phoenix.PubSub.broadcast(Loom.PubSub, "agents", {:auth_pending, public_pending(state)})
  end

  defp rand(bytes), do: Base.url_encode64(:crypto.strong_rand_bytes(bytes), padding: false)

  defp public_passkey(p), do: Map.take(p, [:id, :name, :rp_id, :created_at, :last_used_at])

  defp configured do
    case Application.get_env(:loom, :password) do
      p when is_binary(p) -> p
      _ -> ""
    end
  end

  defp same_password?(pw) when is_binary(pw), do: Plug.Crypto.secure_compare(pw, fingerprint())
  defp same_password?(_), do: false

  # Not the password: 8 bytes of an HMAC keyed by the endpoint secret, so the
  # (signed, not encrypted) token reveals nothing usable about it.
  defp fingerprint do
    key = LoomWeb.Endpoint.config(:secret_key_base) || ""

    :crypto.mac(:hmac, :sha256, key, "loom-password:" <> configured())
    |> binary_part(0, 8)
    |> Base.url_encode64(padding: false)
  end

  defp unix(iso) do
    case DateTime.from_iso8601(iso || "") do
      {:ok, dt, _} -> DateTime.to_unix(dt)
      _ -> 0
    end
  end

  defp iso(unix), do: unix |> DateTime.from_unix!() |> DateTime.to_iso8601()

  # ── Storage ─────────────────────────────────────────────────────────────

  @passkey_keys ~w(id name rp_id public_key created_at last_used_at)a
  @login_keys ~w(id name method ip created_at last_seen_at)a

  defp load(path) do
    with {:ok, body} <- File.read(path),
         {:ok, %{} = data} <- Jason.decode(body) do
      %{
        passkeys: index(data["passkeys"], @passkey_keys),
        logins: index(data["logins"], @login_keys)
      }
    else
      {:error, :enoent} ->
        %{passkeys: %{}, logins: %{}}

      _ ->
        # Not overwritten: it may hold the passkeys. Until it is fixed the
        # password alone gets in, as before any device signed in.
        aside = "#{path}.bad-#{System.os_time(:second)}"
        File.rename(path, aside)
        Logger.error("Loom.Auth cannot read #{path}; moved it to #{aside}")
        %{passkeys: %{}, logins: %{}}
    end
  end

  defp index(list, keys) when is_list(list) do
    for item <- list, is_binary(item["id"]), into: %{} do
      {item["id"], Map.new(keys, &{&1, item[to_string(&1)]})}
    end
  end

  defp index(_, _), do: %{}

  defp save(state) do
    body = %{
      passkeys: state.passkeys |> Map.values() |> Enum.sort_by(& &1.created_at),
      logins: state.logins |> Map.values() |> Enum.sort_by(& &1.created_at)
    }

    File.mkdir_p!(Path.dirname(state.path))
    tmp = state.path <> ".tmp"
    File.write!(tmp, Jason.encode_to_iodata!(body, pretty: true))
    File.chmod!(tmp, 0o600)
    File.rename!(tmp, state.path)
    state
  end
end
