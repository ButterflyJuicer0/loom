defmodule LoomWeb.AgentBtwController do
  @moduledoc "A session's side questions; see `Loom.Agent.Btw`."
  use LoomWeb, :controller

  alias Loom.Agent
  alias Loom.Agent.Btw

  # GET /api/agents/:id/btw
  def index(conn, %{"id" => id}) do
    # Also what keeps the id from being a path: an unknown one has no process.
    if Agent.exists?(id),
      do: json(conn, %{items: Btw.list(id)}),
      else: unknown(conn)
  end

  # POST /api/agents/:id/btw — `text`, the question.
  def create(conn, %{"id" => id} = params) do
    case is_binary(params["text"]) && Btw.ask(id, params["text"]) do
      {:ok, item} -> json(conn, %{item: item, items: Btw.list(id)})
      false -> refuse(conn, :unprocessable_entity, "`text` must be a string")
      {:error, :empty} -> refuse(conn, :unprocessable_entity, "the question is empty")
      {:error, :too_long} -> refuse(conn, :request_entity_too_large, "the question is too long")
      {:error, :not_found} -> unknown(conn)
      {:error, :busy} -> refuse(conn, :conflict, "another side question is being answered")
      {:error, :unsupported} -> refuse(conn, :unprocessable_entity, "this session's agent cannot be asked on the side")
      {:error, reason} when is_binary(reason) -> refuse(conn, :unprocessable_entity, reason)
      {:error, reason} -> refuse(conn, :internal_server_error, inspect(reason))
    end
  end

  # POST /api/agents/:id/btw/stop — the answer under way.
  def stop(conn, %{"id" => id}) do
    if Agent.exists?(id) do
      Btw.stop(id)
      json(conn, %{items: Btw.list(id)})
    else
      unknown(conn)
    end
  end

  # DELETE /api/agents/:id/btw — empty the panel.
  def clear(conn, %{"id" => id}) do
    if Agent.exists?(id) do
      Btw.clear(id)
      json(conn, %{items: []})
    else
      unknown(conn)
    end
  end

  defp unknown(conn), do: refuse(conn, :not_found, "unknown session")
  defp refuse(conn, status, error), do: conn |> put_status(status) |> json(%{error: error})
end
