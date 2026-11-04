defmodule LoomWeb.AgentImageController do
  @moduledoc """
  POST /api/agents/:id/image — the parts of a conversation the user picked,
  drawn as one long PNG for sharing. Multipart: `page` is the HTML the browser
  rendered (a file part, so a page with images inlined is not held to the JSON
  parser's limit), `css` a field. See `Loom.Snapshot`.
  """
  use LoomWeb, :controller

  alias Loom.Agent

  def create(conn, %{"id" => id} = params) do
    with true <- Agent.exists?(id),
         %Plug.Upload{path: path} <- params["page"],
         {:ok, body} <- File.read(path),
         {:ok, png} <- Loom.Snapshot.render(body, params["css"] || "") do
      conn
      |> put_resp_content_type("image/png")
      |> send_resp(200, png)
    else
      false -> conn |> put_status(:not_found) |> json(%{error: "unknown session"})
      {:error, reason} when is_binary(reason) -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
      _ -> conn |> put_status(:unprocessable_entity) |> json(%{error: "no page in the request"})
    end
  end
end
