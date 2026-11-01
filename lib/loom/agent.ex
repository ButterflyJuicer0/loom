defmodule Loom.Agent do
  @moduledoc "Entry point for managing agent sessions."

  alias Loom.Agent.Session

  @doc """
  Start a new agent session (or return the existing one for `id`).

  `:backend` is required and permanent: `:claude_code`, `:codex` or `:kiro`. The
  conversation lives in that engine's own store, so there is nothing to migrate
  if it changes.
  """
  def start_session(id, opts \\ []) do
    spec = {Session, [{:id, id} | opts]}

    case DynamicSupervisor.start_child(Loom.Agent.SessionSupervisor, spec) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      other -> other
    end
  end

  @doc "A fresh session id."
  def new_id, do: "a_" <> (:crypto.strong_rand_bytes(9) |> Base.url_encode64(padding: false))

  @doc "Whether a session with `id` is currently alive."
  def exists?(id) do
    case Registry.lookup(Loom.Agent.Registry, id) do
      [{_pid, _}] -> true
      [] -> false
    end
  end

  @doc """
  Whether a safety classifier has stopped the model in this session. What
  tripped it stays in the conversation and is liable to trip it again on every
  later turn, so what keeps a session for a fixed job (Dream, an employee, the
  bell, a task) starts a fresh one instead.
  """
  def flagged?(id),
    do: match?({:ok, %{flagged_at: at}} when is_integer(at), Loom.Agent.Store.read_meta(id))

  @doc "Whether the session is mid-turn. One that is not running is not."
  def busy?(id) do
    exists?(id) and info(id).status in [:starting, :running]
  catch
    :exit, _ -> false
  end

  @doc "What the agent last said in the session, or nil."
  def last_reply(id) do
    id
    |> Loom.Agent.Store.read_events(500)
    |> Enum.find_value(fn
      %{kind: :assistant_text, payload: %{text: text}} when is_binary(text) -> text
      _ -> nil
    end)
  end

  @doc """
  The options that start a session carrying on from flagged `id` for the job
  it did: shown below it as one thread, and told, ahead of its first message,
  `what` it needs to know. Nothing of the flagged conversation goes with it
  but what `what` says.
  """
  def set_aside_opts(id, what) do
    [
      earlier_opt(id),
      note: "Carried on from a session a safety classifier stopped, shown above.",
      notice:
        "[Note from Loom, not written by the user: this session carries on from an " <>
          "earlier one that a safety classifier stopped, so it starts afresh. Do not " <>
          "read that earlier session; what you need from it is below.]" <>
          if(what in [nil, ""], do: "", else: "\n\n" <> what)
    ]
  end

  @doc """
  The option that starts a session carrying on from `id` for the job it did,
  shown below it as one thread: `{:earlier, ids}`, the 30 newest.
  """
  def earlier_opt(id), do: {:earlier, Enum.take([id | earlier_of(id)], 30)}

  defp earlier_of(id) do
    case Loom.Agent.Store.read_meta(id) do
      {:ok, %{earlier: list}} when is_list(list) -> Enum.filter(list, &is_binary/1)
      _ -> []
    end
  end

  @doc """
  Restore a persisted session's process from disk.

  A session that was mid-turn when the node stopped comes back `:interrupted`
  with its queue intact: a backend turn dies with this node and cannot be
  rejoined, and re-sending would duplicate a message the backend already has.
  """
  def restore_session(id), do: start_session(id, restore: true)

  @doc """
  Stop a session's process. Its history stays on disk and can be restored —
  use `delete_session/1` to actually discard it.
  """
  def stop_session(id) do
    case Registry.lookup(Loom.Agent.Registry, id) do
      [{pid, _}] ->
        result = DynamicSupervisor.terminate_child(Loom.Agent.SessionSupervisor, pid)
        Phoenix.PubSub.broadcast(Loom.PubSub, lobby_topic(), {:agent_removed, id})
        result

      [] ->
        {:error, :not_found}
    end
  end

  @doc "Stop a session and delete its persisted history."
  def delete_session(id) do
    incognito? = match?({:ok, %{kind: "incognito"}}, Loom.Agent.Store.read_meta(id))
    stop_session(id)
    Loom.Notices.forget_session(id)

    # Claude Code kept an incognito conversation under its own directory's
    # name, which nothing else uses: it goes too.
    if incognito?,
      do: File.rm_rf(Loom.Agent.Sandbox.claude_project_dir(Loom.Agent.Sandbox.workspace(id)))

    Loom.Agent.Store.delete_session(id)
  end

  @doc "List metadata for all live sessions, oldest first."
  def list_sessions do
    Loom.Agent.Registry
    |> Registry.select([{{:"$1", :_, :_}, [], [:"$1"]}])
    |> Enum.map(&safe_info/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(& &1.created_at)
  end

  @doc """
  List every persisted session's header, live or not.

  Reads only the headers, so it stays cheap regardless of transcript size.
  """
  def list_persisted, do: Loom.Agent.Store.list_metas()

  @doc """
  Make both backends pick up changed config — settings, MCP servers, skills —
  without restarting loom. What `/reload` does, from any session.

  Every session is told to let its backend process go (now if idle, after its
  turn if not), which is what Claude Code needs: the next turn starts a fresh
  `claude --resume`. Codex has one shared app-server, which restarts itself once
  no codex turn is running. Fire and forget: nothing waits on either.
  """
  def reload_backends do
    for {_, pid, _, _} <- DynamicSupervisor.which_children(Loom.Agent.SessionSupervisor),
        is_pid(pid),
        do: send(pid, :reload_backend)

    Loom.Agent.Codex.Server.reload()
    :ok
  end

  defdelegate submit(id, text, opts \\ []), to: Session
  defdelegate interrupt(id), to: Session
  defdelegate drop_queued(id, index), to: Session
  defdelegate rename(id, title), to: Session
  defdelegate retitle(id, title), to: Session
  defdelegate pin(id, pinned?), to: Session
  defdelegate promote(id), to: Session
  defdelegate archive(id, archived?), to: Session
  defdelegate seed(id, display, prompt, origin \\ "tidy"), to: Session
  defdelegate tell(id, text), to: Session
  defdelegate note(id, text), to: Session

  @doc "Let one session's backend go, as `reload_backends/0` does for all."
  def reload_backend(id) do
    case Registry.lookup(Loom.Agent.Registry, id) do
      [{pid, _}] -> send(pid, :reload_backend)
      [] -> :ok
    end

    :ok
  end

  defdelegate tidied(id), to: Session
  defdelegate seen(id, seq), to: Session
  defdelegate set_effort(id, effort), to: Session
  defdelegate set_model(id, model), to: Session
  defdelegate move(id, project_id), to: Session
  defdelegate attach(id, since_seq \\ 0), to: Session
  defdelegate info(id), to: Session
  defdelegate turn_seq(id), to: Session
  defdelegate topic(id), to: Session

  @doc """
  The topic the session list lives on.

  Each session broadcasts `{:agent_summary, info}` whenever its header changes —
  status, title, queue, usage — and `stop_session/1` broadcasts
  `{:agent_removed, id}`. That is everything a sidebar needs, so it never has to
  poll.
  """
  def lobby_topic, do: "agents"

  @doc """
  The topic turn ends are announced on, for `Loom.Push`: `{:turn_ended, id,
  %{title:, outcome:}}` once a turn is over and nothing queued follows it.
  `outcome` is `{:ok, last_reply_or_nil}` or `{:error, message}`.
  """
  def turns_topic, do: "turns"

  defp safe_info(id) do
    Session.info(id)
  catch
    :exit, _ -> nil
  end
end
