defmodule LoomWeb.AuthController do
  use LoomWeb, :controller

  require Logger

  alias Loom.Auth.Throttle

  # A wrong password costs this much, whether or not it trips the brake.
  @fail_delay 300

  # POST /api/login — exchange the password for a signed token. Throttled per
  # client and globally (`Loom.Auth.Throttle`); every miss is logged.
  def login(conn, %{"password" => password}) do
    client = client(conn)

    case Throttle.check(client) do
      {:locked, seconds} ->
        Logger.warning("login: locked out client=#{client} retry_after=#{seconds}s")

        conn
        |> put_resp_header("retry-after", Integer.to_string(seconds))
        |> put_status(:too_many_requests)
        |> json(%{error: "too_many_attempts", retry_after: seconds})

      :ok ->
        if Loom.Auth.valid_password?(password) do
          Throttle.success(client)
          Logger.info("login: ok client=#{client}")
          json(conn, %{token: Loom.Auth.mint_token()})
        else
          Throttle.failure(client)
          Logger.warning("login: wrong password client=#{client} ua=#{ua(conn)}")
          Process.sleep(@fail_delay)
          conn |> put_status(:unauthorized) |> json(%{error: "invalid_password"})
        end
    end
  end

  def login(conn, _), do: conn |> put_status(:bad_request) |> json(%{error: "missing_password"})

  # Who is guessing. Behind CloudFront (or another proxy) `remote_ip` is the
  # proxy, so take the last X-Forwarded-For hop — the one the proxy appended
  # itself, which a client cannot forge. Direct connections have no header.
  defp client(conn) do
    forwarded =
      conn
      |> get_req_header("x-forwarded-for")
      |> Enum.join(",")
      |> String.split(",", trim: true)
      |> Enum.map(&String.trim/1)
      |> List.last()

    forwarded || conn.remote_ip |> :inet.ntoa() |> to_string()
  end

  defp ua(conn) do
    case get_req_header(conn, "user-agent") do
      [ua | _] -> String.slice(ua, 0, 120)
      _ -> "-"
    end
  end
end
