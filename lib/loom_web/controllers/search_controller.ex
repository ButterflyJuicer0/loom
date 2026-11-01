defmodule LoomWeb.SearchController do
  @moduledoc "The sidebar's search over what was said in each session; see `Loom.Agent.Search`."
  use LoomWeb, :controller

  # GET /api/search?q=words
  def index(conn, params) do
    query = if is_binary(params["q"]), do: params["q"], else: ""
    # Incognito sessions are found only in Settings.
    ids = for s <- Loom.Agent.list_sessions(), s.kind != "incognito", do: s.id
    json(conn, %{results: Loom.Agent.Search.run(ids, query)})
  end
end
