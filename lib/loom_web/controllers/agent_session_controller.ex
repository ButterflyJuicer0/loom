defmodule LoomWeb.AgentSessionController do
  use LoomWeb, :controller

  alias Loom.Agent

  # GET /api/agents — list live agent sessions.
  def index(conn, _params) do
    json(conn, %{sessions: Enum.map(Agent.list_sessions(), &view/1)})
  end

  # POST /api/agents — start a session.
  #
  # `backend` is required: `claude_code` or `codex`. There is no default,
  # because the choice is permanent — the conversation lives in that engine's
  # own store, so switching later would mean abandoning the history. Better to
  # make the caller say which one than to quietly pick for them.
  #
  # Deliberately takes no directory. `project_id`, optional, puts the session
  # in a project, whose workspace becomes its cwd for good (`Loom.Projects`).
  # Without one a session has no root, and the model composes absolute paths
  # from the conversation. A channel only ever attaches to an existing session,
  # so creation goes through here. `model` picks one of the engine's models.
  # `incognito: true` starts one in its own
  # sandboxed directory, out of every list but Settings (`Loom.Agent.Sandbox`).
  def create(conn, params) do
    case Loom.Agent.Backend.parse(params["backend"]) do
      {:ok, backend} -> create_session(conn, backend, params)
      :error -> bad_backend(conn, params["backend"])
    end
  end

  # `id`, optional, is one the browser made up (`a_` + 12 url-safe chars), so
  # it can show the new chat and take a message before this reply comes back
  # on a slow network. The same id again returns the session already made:
  # a retry after a lost reply cannot make a second one.
  defp create_session(conn, backend, params) do
    case params["id"] do
      nil -> start_new(conn, backend, params, Agent.new_id())
      id when is_binary(id) -> start_given(conn, backend, params, id)
      _ -> conn |> put_status(:unprocessable_entity) |> json(%{error: "bad id"})
    end
  end

  defp start_given(conn, backend, params, id) do
    cond do
      not Regex.match?(~r/\Aa_[A-Za-z0-9_-]{12}\z/, id) ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "bad id"})

      Agent.exists?(id) ->
        json(conn, view(Agent.info(id)))

      # Stored but not running: someone else's history, not ours to start.
      match?({:ok, _}, Loom.Agent.Store.read_meta(id)) ->
        conn |> put_status(:conflict) |> json(%{error: "id taken"})

      true ->
        start_new(conn, backend, params, id)
    end
  end

  defp start_new(conn, backend, params, id) do
    opts = [{:backend, backend} | build_opts(params)]

    case Agent.start_session(id, opts) do
      {:ok, _pid} ->
        conn |> put_status(:created) |> json(view(Agent.info(id)))

      {:error, {:unknown_project, _}} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: "no such project"})

      {:error, reason} ->
        conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
    end
  end

  defp bad_backend(conn, given) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{
      error: "`backend` must be \"claude_code\", \"codex\" or \"kiro\"",
      given: given
    })
  end

  # POST /api/agents/:id/continue — carry it on in a new session, which
  # starts on a handoff summary; see `Loom.Agent.Carry`. An optional
  # `backend` moves it to another engine.
  def continue(conn, %{"id" => id} = params) do
    with {:ok, backend} <- continue_backend(params["backend"]),
         {:ok, new} <- Agent.Carry.continue(id, backend) do
      conn |> put_status(:created) |> json(view(Agent.info(new)))
    else
      :error -> bad_backend(conn, params["backend"])
      {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end

  defp continue_backend(nil), do: {:ok, nil}
  defp continue_backend(given), do: Loom.Agent.Backend.parse(given)

  # PATCH /api/agents/:id — any of `title` (rename), `pinned`, `archived`, `done`, `seen_seq` (read
  # up to there), `effort` (the thinking level, null for the default), `model` (likewise) and `project_id` (move into that project, or out of any with
  # null), and `incognito: false` (keep an incognito session: into Recents,
  # out of its sandbox). Only a move and keeping touch the backend.
  def update(conn, %{"id" => id} = params) do
    changes =
      [
        {"title", &Agent.rename(id, &1)},
        {"pinned", &Agent.pin(id, &1)},
        {"archived", &Agent.archive(id, &1)},
        {"done", &Agent.done(id, &1)},
        {"seen_seq", &Agent.seen(id, &1)},
        {"effort", &Agent.set_effort(id, &1)},
        {"model", &Agent.set_model(id, &1)},
        {"project_id", &Agent.move(id, &1)},
        {"incognito", &keep(id, &1)}
      ]
      |> Enum.filter(fn {key, _} -> Map.has_key?(params, key) end)

    case Enum.find_value(changes, :ok, fn {key, change} -> refused(change.(params[key])) end) do
      :ok -> json(conn, view(Agent.info(id)))
      {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end

  defp keep(id, false), do: Agent.promote(id)
  defp keep(_id, _), do: {:error, "a session can only be kept, not made incognito"}

  defp refused(:ok), do: nil
  defp refused({:error, :busy}), do: {:error, "the session is in the middle of a turn"}
  defp refused({:error, {:unknown_project, _}}), do: {:error, "no such project"}
  defp refused({:error, :incognito}), do: {:error, "keep the incognito session first"}
  defp refused({:error, reason}), do: {:error, reason}

  # DELETE /api/agents/:id — stop the session *and* discard its history.
  #
  # Stopping without deleting would be a trap in a UI: the session vanishes
  # from the list, then comes back at the next boot because `Agent.Bootstrap`
  # restores everything on disk.
  #
  # The id has to be gated here the same way the file-plane routes gate theirs:
  # Plug percent-decodes each path segment, so `:id` could arrive as `..` and
  # the whole call chain (`Agent.delete_session/1` → `Store.delete_session/1`
  # → `File.rm_rf!/1`) would turn into a path traversal. `Store.session_dir/1`
  # now rejects anything that is not shaped like a session id; this guard
  # turns that rejection into a 404 instead of a 500 and matches the behaviour
  # of every other `:id`-bearing route.
  # POST /api/agents/:id/relay — `text`: the user writes into this session from
  # elsewhere (its `…` menu), without opening it. Queued if it is mid-turn.
  def relay(conn, %{"id" => id, "text" => text}) when is_binary(text) do
    case Loom.Agent.Relay.deliver(id, text, :user) do
      {:ok, how} -> json(conn, %{ok: true, status: how})
      {:error, reason} -> conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
    end
  end

  def relay(conn, _params),
    do: conn |> put_status(:bad_request) |> json(%{error: "relay takes text"})

  def delete(conn, %{"id" => id}) do
    if Loom.Agent.Store.valid_id?(id) and Agent.exists?(id) do
      Agent.delete_session(id)
      send_resp(conn, :no_content, "")
    else
      conn |> put_status(:not_found) |> json(%{error: "no such session"})
    end
  end

  defp build_opts(params) do
    []
    |> maybe_put(:title, params["title"])
    |> maybe_put(:project, params["project_id"])
    |> maybe_put(:kind, if(params["incognito"] == true and params["project_id"] == nil, do: "incognito"))
    |> maybe_put(:model, if(is_binary(params["model"]) and params["model"] != "", do: params["model"]))
    # Someone is about to type in it: the engine starts now, not on the
    # first message (`Backend.warm/2`).
    |> maybe_put(:warm, true)
  end

  defp maybe_put(opts, _key, nil), do: opts
  defp maybe_put(opts, key, val), do: [{key, val} | opts]

  defp view(info) do
    %{
      id: info.id,
      title: info.title,
      backend: info.backend,
      backend_label: info.backend_label,
      project_id: info.project_id,
      pinned: info.pinned,
      archived_at: Map.get(info, :archived_at),
      done_at: Map.get(info, :done_at),
      preview: Map.get(info, :preview),
      recap: Map.get(info, :recap),
      kind: info.kind,
      employee_id: Map.get(info, :employee_id),
      seen_seq: info.seen_seq,
      reply_seq: Map.get(info, :reply_seq, 0),
      effort: Map.get(info, :effort),
      model: Map.get(info, :model),
      created_at: info.created_at,
      last_active_at: info.last_active_at,
      status: info.status,
      queued: info.queued,
      queue: info.queue,
      usage: info.usage,
      context_tokens: info.context_tokens,
      context_window: info.context_window,
      turns: info.turns,
      seq: info.seq
    }
  end
end
