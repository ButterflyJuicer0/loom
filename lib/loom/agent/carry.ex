defmodule Loom.Agent.Carry do
  @moduledoc """
  "Continue in a new chat": the user carries a session on in a new one,
  because it ended in an error (a safety classifier's stop among them), grew
  long, or they want a branch of it. One tap; Loom picks how.

    * `:fork` — a Claude Code session that ended well and is not long: the new
      one starts on a copy of its conversation (`--fork-session`), so nothing
      is lost. The old one is left as it was.
    * `:read` — anything else: the new one starts empty and reads the old one
      with `loom-session read --files`. An error or a classifier's stop is not
      carried over, nor is a context near its limit.

  It may move to another backend (the header's arrow beside "Continue in new
  chat"): then it is always `:read`, as no engine can resume another's store.

  Either way its first turn is a handoff summary of at most five lines, then
  it waits for the user. The new session is on the user's own model, not the
  old one's: a fallback the old one fell to is not inherited.
  """

  alias Loom.Agent
  alias Loom.Agent.Store

  # Past this share of its window, a context is not worth copying: the copy
  # would be compacted soon anyway, by Claude Code and not by a summary.
  @long 0.6

  @doc "Start the new session, on `backend` or else the old one's; `{:ok, id}`."
  def continue(id, backend \\ nil) do
    with {:ok, info} <- source(id) do
      backend = backend || info.backend
      how = if backend == info.backend, do: how(id, info), else: {:read, :backend}
      new = Agent.new_id()

      opts =
        [backend: backend, title: info.title, title_by: info[:title_by] || "tidy"] ++
          if(info.project_id, do: [project: info.project_id], else: []) ++
          fork(how, id)

      with {:ok, _pid} <- Agent.start_session(new, opts),
           {:ok, _} <-
             Agent.submit(new, display(id, info),
               origin: "continue",
               prompt: prompt(how, id, info)
             ) do
        {:ok, new}
      else
        {:error, reason} -> {:error, "could not start the session: #{inspect(reason)}"}
      end
    end
  end

  # Claude Code keeps a conversation under the directory it ran in: the copy
  # is looked for there.
  defp fork({:fork, from}, id) do
    case Store.read_meta(id) do
      {:ok, %{cc_cwd: cwd}} when is_binary(cwd) -> [fork_from: from, cwd: cwd]
      _ -> [fork_from: from]
    end
  end

  defp fork(_how, _id), do: []

  # Only the sidebar's own: an employee's, Dream's or the bell's sessions are
  # carried on by what runs them.
  defp source(id) do
    info = if Agent.exists?(id), do: Agent.info(id)

    cond do
      info == nil -> {:error, "#{id}: no such session"}
      info.kind != nil or info[:employee_id] != nil -> {:error, "#{id}: not a chat of yours"}
      true -> {:ok, info}
    end
  catch
    :exit, _ -> {:error, "#{id}: no such session"}
  end

  @doc false
  # Public for the tests: `{:fork, cc_session_id}` or `{:read, why}`.
  def how(id, info) do
    meta =
      case Store.read_meta(id) do
        {:ok, meta} -> meta
        :error -> %{}
      end

    cond do
      info.backend != :claude_code -> {:read, :backend}
      meta[:cc_started] != true or not is_binary(meta[:cc_session_id]) -> {:read, :empty}
      info.status in [:starting, :running] -> {:read, :busy}
      ended_in_error?(id) -> {:read, :error}
      long?(info) -> {:read, :long}
      true -> {:fork, meta[:cc_session_id]}
    end
  end

  defp long?(%{context_tokens: used, context_window: window})
       when is_integer(used) and is_integer(window) and window > 0,
       do: used > window * @long

  defp long?(_info), do: false

  # How the last turn ended: an `error` after the last `turn_done`.
  defp ended_in_error?(id) do
    Store.events_path(id)
    |> File.stream!()
    |> Enum.reduce(false, fn line, last ->
      cond do
        String.contains?(line, ~s("kind":"error")) -> true
        String.contains?(line, ~s("kind":"turn_done")) -> false
        String.contains?(line, ~s("kind":"user")) -> false
        true -> last
      end
    end)
  rescue
    _ -> false
  end

  defp display(id, info), do: "Continue \"#{info.title || id}\" (#{id})"

  @summary "First write the user a handoff summary of at most five lines: how far it got, " <>
             "what was concluded, where its files are (devices and paths), and what you would do next. " <>
             "Then stop, and wait for the user to say go on."

  defp prompt({:fork, _}, id, info) do
    "[Loom: the user opened this new session to carry on \"#{info.title || id}\" (#{id}). " <>
      "Its conversation so far is above, copied here; that session stays as it was. " <>
      "If it is not there, read it with `loom-session read #{id} --files`. " <> @summary <> "]"
  end

  defp prompt({:read, why}, id, info) do
    "[Loom: the user opened this new session to carry on \"#{info.title || id}\" (#{id}), " <>
      reason(why) <>
      " You do not have its conversation: read it first with `loom-session read #{id} --files` " <>
      "(add `--full` if each turn's last reply is not enough). " <>
      @summary <>
      " Summarise in your own words: do not quote passwords, keys, or whatever that session was stopped for.]"
  end

  defp reason(:error),
    do: "which ended in an error (it may have been a safety classifier's stop)."

  defp reason(:long), do: "which grew too long to copy."
  defp reason(:busy), do: "which is still in the middle of a turn."
  defp reason(_), do: "whose conversation cannot be copied here."
end
