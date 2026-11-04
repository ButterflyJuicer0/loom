defmodule LoomWeb.AgentPdfController do
  @moduledoc """
  POST /api/agents/:id/pdf — the parts of a conversation the user picked,
  printed to PDF for sharing. Multipart: `page` is the HTML the browser
  rendered (a file part, so a page with images inlined is not held to the JSON
  parser's limit), `css` and `title` are fields. See `Loom.Pdf`.
  """
  use LoomWeb, :controller

  alias Loom.Agent

  def create(conn, %{"id" => id} = params) do
    with true <- Agent.exists?(id),
         %Plug.Upload{path: path} <- params["page"],
         {:ok, body} <- File.read(path),
         {:ok, pdf} <- Loom.Pdf.render(body, params["css"] || "", params["title"] || "Loom") do
      conn
      |> put_resp_content_type("application/pdf")
      |> send_resp(200, pdf)
    else
      false -> conn |> put_status(:not_found) |> json(%{error: "unknown session"})
      {:error, reason} when is_binary(reason) -> conn |> put_status(:bad_gateway) |> json(%{error: reason})
      _ -> conn |> put_status(:unprocessable_entity) |> json(%{error: "no page in the request"})
    end
  end
end
