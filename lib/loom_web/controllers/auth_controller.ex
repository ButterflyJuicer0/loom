defmodule LoomWeb.AuthController do
  @moduledoc """
  Signing in, and the settings that decide how; see `Loom.Auth`.

  Open to anyone, for the sign-in page:

  - `GET /api/auth/options` — `%{passkey:}`: whether to offer a passkey.
  - `POST /api/login` with `%{password:}` — `200 %{token:}` when no device is
    signed in yet, else `202 %{pending:, poll:, expires_in:}`: wait for a
    signed-in device to allow it, polling `POST /api/login/poll` with
    `%{id:, poll:}` (`200 %{token:}`, `202`, `403 denied`, `410 expired`);
    `POST /api/login/cancel` gives up.
  - `POST /api/auth/passkey/challenge`, then `POST /api/auth/passkey/login`
    with the assertion's `id`, `client_data`, `authenticator_data` and
    `signature`, base64url.

  Signed in:

  - `GET /api/auth` — passkeys, logins, which one is this device; and a
    `token` to keep when the device's own is from before logins.
  - `POST /api/auth/passkeys/challenge`, then `POST /api/auth/passkeys` with
    `id`, `client_data`, `authenticator_data`, `public_key` and the
    `password` again; `DELETE` one.
  - `DELETE /api/auth/logins/:id` signs that device out, socket included.
  - `POST /api/auth/pending/:id/approve` and `.../deny`.

  Every password check, at sign-in or adding a passkey, goes through the
  per-client brake (`Loom.Auth.Throttle`) and is logged.
  """
  use LoomWeb, :controller

  require Logger

  alias Loom.Auth
  alias Loom.Auth.Throttle

  # A wrong password costs this much, whether or not it trips the brake.
  @fail_delay 300

  def options(conn, _params), do: json(conn, Auth.options())

  def login(conn, %{"password" => password}) do
    with_password(conn, password, fn conn ->
      case Auth.password_login(info(conn)) do
        {:ok, token} ->
          Logger.info("login: ok (no device signed in yet) client=#{client(conn)}")
          json(conn, %{token: token})

        {:pending, p} ->
          conn
          |> put_status(:accepted)
          |> json(%{pending: p.id, poll: p.poll, expires_in: p.expires_in})
      end
    end)
  end

  def login(conn, _), do: conn |> put_status(:bad_request) |> json(%{error: "missing_password"})

  def poll(conn, params) do
    case Auth.poll(params["id"], params["poll"]) do
      {:ok, token} -> json(conn, %{token: token})
      :waiting -> conn |> put_status(:accepted) |> json(%{pending: params["id"]})
      {:error, :denied} -> conn |> put_status(:forbidden) |> json(%{error: "denied"})
      {:error, _} -> conn |> put_status(:gone) |> json(%{error: "expired"})
    end
  end

  def cancel(conn, params) do
    Auth.cancel(params["id"], params["poll"])
    send_resp(conn, 204, "")
  end

  def login_challenge(conn, _params), do: json(conn, %{challenge: Auth.challenge(:login)})

  def passkey_login(conn, params) do
    case Auth.passkey_login(params, info(conn)) do
      {:ok, token} ->
        json(conn, %{token: token})

      {:error, reason} ->
        Logger.warning("login: passkey refused (#{reason}) client=#{client(conn)}")
        conn |> put_status(:unauthorized) |> json(%{error: to_string(reason)})
    end
  end

  def show(conn, _params) do
    upgrade =
      case conn.assigns.login do
        :legacy ->
          {:ok, token} = Auth.upgrade(info(conn))
          %{token: token}

        _ ->
          %{}
      end

    json(
      conn,
      Auth.overview()
      |> Map.put(:current, conn.assigns.login)
      |> Map.put(:pending, Auth.pending())
      |> Map.merge(upgrade)
    )
  end

  def register_challenge(conn, _params) do
    exclude = Enum.map(Auth.overview().passkeys, & &1.id)
    json(conn, %{challenge: Auth.challenge(:register), exclude: exclude})
  end

  def register(conn, params) do
    with_login(conn, fn conn ->
      with_password(conn, params["password"], fn conn ->
        case Auth.register_passkey(params, info(conn)) do
          {:ok, passkey} -> json(conn, %{passkey: passkey})
          {:error, reason} -> conn |> put_status(422) |> json(%{error: to_string(reason)})
        end
      end)
    end)
  end

  def delete_passkey(conn, %{"id" => id}) do
    :ok = Auth.delete_passkey(id)
    send_resp(conn, 204, "")
  end

  def revoke(conn, %{"id" => id}) do
    :ok = Auth.revoke(id)
    LoomWeb.Endpoint.broadcast("login:#{id}", "disconnect", %{})
    send_resp(conn, 204, "")
  end

  def approve(conn, %{"id" => id}) do
    with_login(conn, fn conn -> decided(conn, Auth.approve(id, conn.assigns.login)) end)
  end

  def deny(conn, %{"id" => id}) do
    with_login(conn, fn conn -> decided(conn, Auth.deny(id)) end)
  end

  defp decided(conn, :ok), do: send_resp(conn, 204, "")
  defp decided(conn, {:error, reason}), do: conn |> put_status(:gone) |> json(%{error: to_string(reason)})

  # A token from before logins can't approve or add a passkey: it may be one
  # of many copies and can't be revoked. The app swaps it on open anyway.
  defp with_login(conn, fun) do
    case conn.assigns.login do
      :legacy -> conn |> put_status(:forbidden) |> json(%{error: "reload"})
      _ -> fun.(conn)
    end
  end

  defp with_password(conn, password, fun) do
    client = client(conn)

    case Throttle.check(client) do
      {:locked, seconds} ->
        Logger.warning("login: locked out client=#{client} retry_after=#{seconds}s")

        conn
        |> put_resp_header("retry-after", Integer.to_string(seconds))
        |> put_status(:too_many_requests)
        |> json(%{error: "too_many_attempts", retry_after: seconds})

      :ok ->
        if Auth.valid_password?(password) do
          Throttle.success(client)
          fun.(conn)
        else
          Throttle.failure(client)
          Logger.warning("login: wrong password client=#{client} ua=#{ua(conn)}")
          Process.sleep(@fail_delay)
          conn |> put_status(:unauthorized) |> json(%{error: "invalid_password"})
        end
    end
  end

  defp info(conn), do: %{name: device_name(ua(conn)), ip: client(conn)}

  # Who is asking. Behind a proxy `remote_ip` is the proxy, so the client is
  # read from X-Forwarded-For: the last hop, which the proxy appended itself
  # and a client cannot forge, or the one before the proxies named in
  # LOOM_TRUSTED_PROXIES (`LoomWeb.ClientAddress`). Direct connections have
  # no header.
  defp client(conn) do
    hops =
      conn
      |> get_req_header("x-forwarded-for")
      |> Enum.join(",")
      |> String.split(",", trim: true)
      |> Enum.map(&String.trim/1)

    LoomWeb.ClientAddress.pick(hops, LoomWeb.ClientAddress.trusted()) ||
      conn.remote_ip |> :inet.ntoa() |> to_string()
  end

  defp ua(conn) do
    case get_req_header(conn, "user-agent") do
      [ua | _] -> String.slice(ua, 0, 200)
      _ -> ""
    end
  end

  @doc false
  def device_name(ua) do
    platform =
      cond do
        ua =~ "iPhone" -> "iPhone"
        ua =~ "iPad" -> "iPad"
        ua =~ "Android" -> "Android"
        ua =~ "Windows" -> "Windows"
        ua =~ "Macintosh" -> "Mac"
        ua =~ "CrOS" -> "ChromeOS"
        ua =~ "Linux" -> "Linux"
        true -> "Unknown device"
      end

    browser =
      cond do
        ua =~ "Edg" -> "Edge"
        ua =~ "Firefox" or ua =~ "FxiOS" -> "Firefox"
        ua =~ "CriOS" or ua =~ "Chrome" -> "Chrome"
        ua =~ "Safari" -> "Safari"
        true -> nil
      end

    if browser, do: "#{platform} · #{browser}", else: platform
  end
end
