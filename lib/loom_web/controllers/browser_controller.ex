defmodule LoomWeb.BrowserController do
  @moduledoc """
  Upgrades to `LoomWeb.VncSocket`. A browser can't set headers on a WebSocket,
  so the login token comes as `?token=`, as it does for `/socket`. A phone adds
  its pane's size as `?w=&h=`, for a window of that shape.
  """
  use LoomWeb, :controller

  def vnc(conn, params) do
    case Loom.Auth.verify_token(params["token"]) do
      {:ok, _login} ->
        # A screen that doesn't change sends nothing, and noVNC doesn't ping, so
        # the idle limit is long; a dropped connection ends it either way.
        conn
        |> WebSockAdapter.upgrade(LoomWeb.VncSocket, size(params),
          timeout: :timer.hours(4),
          compress: true
        )
        |> halt()

      {:error, _} ->
        send_resp(conn, 401, "")
    end
  end

  defp size(%{"w" => w, "h" => h}) do
    with {w, ""} when w in 1..10_000 <- Integer.parse(w),
         {h, ""} when h in 1..10_000 <- Integer.parse(h) do
      {w, h}
    else
      _ -> nil
    end
  end

  defp size(_), do: nil
end
