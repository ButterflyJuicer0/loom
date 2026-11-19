defmodule Loom.Agent.Btw.Worker do
  @moduledoc """
  One side question being answered (`Loom.Agent.Btw`): the copy of the
  conversation, from its start to its one answer.

  One per session at a time, registered under the session's id, so a second
  question waits for the first — two copies answering at once would each miss
  what the other said.

  ## Claude Code

  A port on `sh -c 'exec "$@" < prompt'`: the question is read from a file as
  the process's stdin, which then ends, so `claude -p` runs its one turn and
  exits by itself. (A port cannot close stdin alone, and `claude -p` waits
  three seconds for input that never ends.) Its stdout is stream-json; only
  the text deltas and the `result` matter here. Stopping kills the tree.

  ## Codex

  A fork of the session's thread on the shared app-server
  (`Loom.Agent.Codex.Server.fork_thread/2`), claimed by this process, and one
  turn on it. Its notifications arrive as `{:codex, fork_id, message}`. The
  fork is ephemeral: unsubscribing is all the cleaning up there is.

  Either way the answer is told to `Loom.Agent.Btw` chunk by chunk and once
  more when it ends, and the process stops.
  """
  use GenServer, restart: :temporary

  require Logger

  alias Loom.Agent.Btw
  alias Loom.Agent.Codex.Server
  alias Loom.Agent.Jsonl

  # A side question is a paragraph, not a task. Past this the copy is stuck.
  @timeout_ms :timer.minutes(5)

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: via(Keyword.fetch!(opts, :id)))
  end

  defp via(id), do: {:via, Registry, {Loom.Agent.BtwRegistry, id}}

  @doc "The worker answering for session `id`, or nil."
  def whereis(id) do
    case Registry.lookup(Loom.Agent.BtwRegistry, id) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  @doc """
  What the answer to `item` says so far, and the `seq` of its last chunk:
  `{:ok, text, seq}`; `:error` when nobody is answering it.
  """
  def text(id, item) do
    case whereis(id) do
      nil -> :error
      pid -> GenServer.call(pid, {:text, item}, 2_000)
    end
  catch
    :exit, _ -> :error
  end

  @doc "Stop the answer under way and wait until it is recorded."
  def stop(id) do
    case whereis(id) do
      nil -> :ok
      pid -> GenServer.call(pid, :stop, 10_000)
    end
  catch
    :exit, _ -> :ok
  end

  # ── GenServer ─────────────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    state = %{
      id: Keyword.fetch!(opts, :id),
      item: Keyword.fetch!(opts, :item),
      spec: Keyword.fetch!(opts, :spec),
      prompt: Keyword.fetch!(opts, :prompt),
      text: "",
      seq: 0,
      # Claude Code: the port, its pid, what is left of a line, the `result`.
      port: nil,
      os_pid: nil,
      buffer: "",
      result: nil,
      files: [],
      # Codex: the fork, its turn, and the last error it reported.
      thread: nil,
      turn: nil,
      failure: nil
    }

    Process.send_after(self(), :took_too_long, @timeout_ms)
    {:ok, state, {:continue, :start}}
  end

  @impl true
  def handle_continue(:start, %{spec: %{engine: :claude_code}} = state) do
    case spawn_claude(state) do
      {:ok, state} -> {:noreply, state}
      {:error, reason} -> finish(state, "error", reason)
    end
  end

  def handle_continue(:start, %{spec: %{engine: :codex} = spec} = state) do
    case Server.fork_thread(spec.thread_id, cwd: spec[:cwd], model: spec[:model]) do
      {:ok, thread} ->
        # Kept from here on, so a turn that does not start still lets it go.
        state = %{state | thread: thread}

        case Server.start_turn(thread, state.prompt, effort: spec[:effort], model: spec[:model]) do
          {:ok, turn} -> {:noreply, %{state | turn: turn}}
          {:error, reason} -> finish(state, "error", describe(reason))
        end

      {:error, reason} ->
        finish(state, "error", describe(reason))
    end
  end

  def handle_continue(:start, state), do: finish(state, "error", "this session cannot be copied")

  @impl true
  def handle_call({:text, item}, _from, %{item: item} = state),
    do: {:reply, {:ok, state.text, state.seq}, state}

  def handle_call({:text, _item}, _from, state), do: {:reply, :error, state}

  def handle_call(:stop, _from, state) do
    {:stop, :normal, state} = finish(state, "stopped", nil)
    {:stop, :normal, :ok, state}
  end

  # ── Claude Code ───────────────────────────────────────────────────────────

  @impl true
  def handle_info({port, {:data, chunk}}, %{port: port} = state) do
    {lines, buffer} = Jsonl.split(state.buffer <> chunk)
    {:noreply, Enum.reduce(lines, %{state | buffer: buffer}, &claude_line/2)}
  end

  def handle_info({port, {:exit_status, status}}, %{port: port} = state) do
    state = %{state | port: nil, os_pid: nil}

    case state.result do
      %{"is_error" => true} = result ->
        finish(state, "error", result["result"] || result["subtype"] || "the copy failed")

      %{} = result ->
        # Nothing streamed (no partial messages): the result has the text.
        text = if state.text == "", do: result["result"] || "", else: state.text
        finish(%{state | text: text}, "done", nil)

      nil ->
        finish(state, "error", stderr(state) || "claude exited with status #{status}")
    end
  end

  # ── Codex ─────────────────────────────────────────────────────────────────

  def handle_info({:codex, thread, %{"method" => method} = message}, %{thread: thread} = state) do
    codex(method, message["params"] || %{}, state)
  end

  def handle_info({down, thread}, %{thread: thread} = state)
      when down in [:codex_down, :codex_reloaded] do
    finish(%{state | thread: nil}, "error", "the Codex server restarted")
  end

  def handle_info(:took_too_long, state),
    do: finish(state, "error", "no answer within five minutes")

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    release(state)
    :ok
  end

  # ── Claude Code ───────────────────────────────────────────────────────────

  # `$0` is the prompt's file. Stopped before it got this far, it finds the
  # file gone and has nothing to do.
  @script ~s([ -f "$0" ] || exit 0; exec "$@" < "$0" 2> "$0.err")

  defp spawn_claude(%{spec: spec} = state) do
    # The prompt, and beside it what the process says on stderr.
    base = Path.join(System.tmp_dir!(), "loom-btw-#{state.item}")
    File.write!(base, state.prompt)

    port =
      Port.open({:spawn_executable, System.find_executable("sh")}, [
        :binary,
        :exit_status,
        :use_stdio,
        :hide,
        args: ["-c", @script, base, spec.exe | spec.args],
        cd: spec.cwd,
        env:
          Loom.ChildEnv.port_env() ++
            [
              {~c"LOOM_SESSION_ID", String.to_charlist(state.id)},
              {~c"LOOM_CLI", String.to_charlist(Loom.Nodes.cli_path())}
            ]
      ])

    os_pid =
      case Port.info(port, :os_pid) do
        {:os_pid, pid} -> pid
        _ -> nil
      end

    {:ok, %{state | port: port, os_pid: os_pid, files: [base, base <> ".err"]}}
  rescue
    error -> {:error, Exception.message(error)}
  end

  defp claude_line(line, state) do
    case Jason.decode(line) do
      {:ok, %{"type" => "stream_event", "event" => event}} -> claude_event(event, state)
      {:ok, %{"type" => "result"} = result} -> %{state | result: result}
      _ -> state
    end
  end

  defp claude_event(
         %{"type" => "content_block_delta", "delta" => %{"type" => "text_delta", "text" => text}},
         state
       ),
       do: say(state, text)

  # A second stretch of text, after a tool call the hook turned down.
  defp claude_event(
         %{"type" => "content_block_start", "content_block" => %{"type" => "text"}},
         %{text: text} = state
       )
       when text != "",
       do: say(state, "\n\n")

  defp claude_event(_event, state), do: state

  defp stderr(%{files: [_prompt, err]}) do
    case File.read(err) do
      {:ok, text} ->
        text
        |> String.split("\n", trim: true)
        # What Claude Code says on every start, not why this one failed.
        |> Enum.reject(&String.starts_with?(&1, "[claude-code:"))
        |> List.last()

      _ ->
        nil
    end
  end

  defp stderr(_state), do: nil

  # ── Codex ─────────────────────────────────────────────────────────────────

  defp codex("item/agentMessage/delta", %{"delta" => delta}, state) when is_binary(delta),
    do: {:noreply, say(state, delta)}

  defp codex("item/started", %{"item" => %{"type" => "agentMessage"}}, %{text: text} = state)
       when text != "",
       do: {:noreply, say(state, "\n\n")}

  defp codex("error", %{"willRetry" => true}, state), do: {:noreply, state}

  defp codex("error", params, state) do
    reason = get_in(params, ["error", "message"]) || params["message"]
    {:noreply, %{state | failure: reason}}
  end

  defp codex("turn/completed", params, state) do
    # Over: nothing left to interrupt when the fork is let go.
    state = %{state | turn: nil}

    case get_in(params, ["turn", "status"]) do
      "completed" ->
        finish(state, "done", nil)

      "interrupted" ->
        finish(state, "stopped", nil)

      _ ->
        reason =
          get_in(params, ["turn", "error", "message"]) || state.failure || "the turn failed"

        finish(state, "error", reason)
    end
  end

  defp codex(_method, _params, state), do: {:noreply, state}

  # ── Both ──────────────────────────────────────────────────────────────────

  defp say(state, ""), do: state

  defp say(state, chunk) do
    seq = state.seq + 1
    Btw.text(state.id, state.item, seq, chunk)
    %{state | text: state.text <> chunk, seq: seq}
  end

  defp finish(state, status, error) do
    state = release(state)

    Btw.finished(state.id, state.item, %{
      "status" => status,
      "answer" => String.trim(state.text),
      "error" => error && describe(error)
    })

    {:stop, :normal, state}
  end

  # Let go of whatever is still running, once.
  defp release(state) do
    if state.os_pid do
      pid = state.os_pid

      # In its own process: it waits for the tree to go. Then the group — a
      # port's child leads one of its own — for whatever was started after
      # the tree was looked at: a process still starting spawns as it dies.
      Task.start(fn ->
        Loom.Agent.Backend.ClaudeCode.kill_tree(pid)
        System.cmd("kill", ["-KILL", "--", "-#{pid}"], stderr_to_stdout: true)
      end)
    end

    if is_port(state.port) and Port.info(state.port) != nil, do: Port.close(state.port)
    Enum.each(state.files, &File.rm/1)

    if state.thread do
      thread = state.thread
      turn = state.turn

      Task.start(fn ->
        if turn, do: Server.interrupt(thread, turn)
        Server.request("thread/unsubscribe", %{"threadId" => thread})
        Server.release(thread)
      end)
    end

    %{state | port: nil, os_pid: nil, files: [], thread: nil, turn: nil}
  end

  defp describe(:server_down), do: "the Codex server is not running"
  defp describe(:not_attached), do: "the Codex server restarted"
  defp describe(reason) when is_binary(reason), do: String.slice(reason, 0, 500)
  defp describe(reason), do: reason |> inspect() |> String.slice(0, 500)
end
