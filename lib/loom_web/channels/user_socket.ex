defmodule LoomWeb.UserSocket do
  use Phoenix.Socket

  channel "terminal:*", LoomWeb.TerminalChannel
  channel "agent:*", LoomWeb.AgentChannel
  channel "agents", LoomWeb.LobbyChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Loom.Auth.verify_token(token) do
      {:ok, login} -> {:ok, assign(socket, :login, login)}
      {:error, _} -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  # So that signing a device out (`LoomWeb.AuthController`) drops its socket.
  # A token from before logins has none to name.
  @impl true
  def id(%{assigns: %{login: :legacy}}), do: nil
  def id(socket), do: "login:#{socket.assigns.login}"
end
