defmodule LoomWeb.MeetingController do
  @moduledoc "Meeting mode: speech models for the page, and sentences in; see `Loom.Meeting`."
  use LoomWeb, :controller

  alias Loom.Agent
  alias Loom.Meeting
  alias Loom.Meeting.Models

  # GET /api/meeting/models — ready (with the file list), downloading, or missing.
  def models(conn, _params), do: json(conn, Models.status())

  # POST /api/meeting/models — fetch them onto the server, if missing.
  def fetch(conn, _params), do: json(conn, Models.fetch())

  # GET /api/meeting/models/:bundle/:name — one file, for the page's workers.
  def file(conn, %{"bundle" => bundle, "name" => name}) do
    case Models.file(bundle, name) do
      nil ->
        conn |> put_status(:not_found) |> json(%{error: "no such file"})

      path ->
        type =
          cond do
            String.ends_with?(name, ".wasm") -> "application/wasm"
            String.ends_with?(name, ".js") -> "text/javascript"
            true -> "application/octet-stream"
          end

        conn
        |> put_resp_content_type(type, nil)
        |> put_resp_header("cache-control", "private, max-age=31536000, immutable")
        |> send_file(200, path)
    end
  end

  # POST /api/agents/:id/meeting — `action`: start | stop | ask | lines (+ `lines`).
  def update(conn, %{"id" => id, "action" => action} = params) do
    if Agent.exists?(id) do
      lines = params["lines"]

      result =
        case action do
          "start" -> Meeting.start(id, params["title"])
          "stop" -> Meeting.stop(id)
          "ask" -> Meeting.ask(id)
          "lines" when is_list(lines) -> Meeting.lines(id, lines)
          _ -> {:error, :bad_action}
        end

      case result do
        :ok -> json(conn, %{ok: true, meeting: Meeting.info(id)})
        {:ok, view} -> json(conn, %{ok: true, meeting: view})
        {:error, why} -> conn |> put_status(:unprocessable_entity) |> json(%{error: to_string(why)})
      end
    else
      conn |> put_status(:not_found) |> json(%{error: "unknown session"})
    end
  end

  # GET /api/agents/:id/meeting — the running meeting, or null.
  def show(conn, %{"id" => id}), do: json(conn, %{meeting: Meeting.info(id)})
end
