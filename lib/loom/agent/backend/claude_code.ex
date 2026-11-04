defmodule Loom.Agent.Backend.ClaudeCode do
  @moduledoc """
  Claude Code as the engine: one long-lived `claude -p` process per session,
  spoken to over stdin/stdout in stream-json, and let go when the session idles.

  (An earlier version spawned a process per turn and tore it down on `result`.
  Every turn paid the cold start for it; see `docs/backends.md` §6.4.)

  ## One process per session, kept warm between turns

  The startup cost is paid **once per session**, not once per turn. Measured on
  one process, writing the second message only after the first turn's `result`
  had arrived:

      turn 1 (cold)   init 4.65 s   first token 9.70 s   done 9.74 s   275 MB
      turn 2          init 0.02 s   first token 1.91 s   done 1.93 s   277 MB
      turn 3          init 0.01 s   first token 1.65 s   done 1.76 s   279 MB

  Turn 3 correctly recalled both earlier answers, so the conversation really is
  live in the process rather than being re-read from disk each time. Memory grows
  about 2 MB per turn, not the hundreds an earlier note had feared.

  Spawning per turn instead would pay ~6 s *every* turn — and pre-spawning the
  next one in the background costs the same resident memory as just keeping this
  one, while churning a 275 MB process for nothing. So: keep it.

  What makes that affordable is `release/1` on an idle timer: 275 MB is the right
  price while someone is working and pure waste once they walk away. The
  conversation survives regardless, in
  `~/.claude/projects/<cwd-slug>/<uuid>.jsonl`, and comes back with `--resume`.

  ## Everything goes over stdin, including steering

  A message written while a turn is running is injected into that turn at the
  next tool-result boundary. Measured: a "stop, do this instead" sent 16 s into a
  five-step shell task arrived alongside step two's output, and the model
  abandoned steps three to five — **one** `result`, not two. With no tool
  boundary left it falls through to the next turn instead.

  So `run_turn/2` and `steer/2` write the same line to the same pipe; the
  difference is only whether a turn is already in flight.

  (`claude -p "<prompt>"` with the prompt in argv waits three seconds for stdin
  before starting — "no stdin data received in 3s" — and would put arbitrary user
  text on a command line. stdin avoids both.)

  stdin is never closed. The process is reclaimed by killing it, not by EOF.

  ## Not on a port, so a restart does not stop it

  The process is a `Loom.Agent.Proc`: stdin a FIFO, stdout a file, polled. A
  node that stops lets go of it (`detach/1`) instead of killing it, and the
  next one takes it back (`adopt/1`) with the decoding state saved beside the
  output (`checkpoint/1`) — so a turn under way when loom restarts carries on
  and is seen to the end, and an idle one is still warm.

  Slash commands ride the same pipe. `/compact` typed as a message is run by
  Claude Code itself (measured: 15.7K → 1.3K tokens, earlier context still
  recalled), and reports back only as a `compact_boundary` — see `translate/2`.
  Codex has no such passthrough; `Loom.Agent.Backend.Codex` intercepts it.

  ## Interrupting asks politely, because killing would burn the warm process

  A `control_request` with subtype `interrupt` ends the turn and leaves the
  process running and usable (measured: it answered `{"still_queued": []}` and
  was still alive 18 s later). Killing would work too — SIGKILL mid-turn leaves
  the conversation perfectly resumable — but it would throw away the warm
  process and make the next turn cold again.

  The cost is that the aborted turn reports itself as
  `result/error_during_execution` with `terminal_reason: "aborted_streaming"`,
  which is not an error at all. `interrupted?` is what lets `decode/2` recognise
  the one we asked for and stay quiet, so the session's own abort event is not
  double-reported as a failure.

  Teardown still has to kill, and killing means the whole tree: `claude` is three
  processes deep and killing the outermost **leaves the other two alive**
  (measured: a 24 MB launcher and a 224 MB runtime orphaned). So `kill_tree/1`
  snapshots descendants with `pgrep -P` *before* killing anything — once the
  parent dies the children are reparented and the relationship is gone.

  ## Which configuration gets loaded

  `--setting-sources user` loads the machine's own Claude Code config — MCP
  servers, hooks, rules — and excludes `project` and `local`. Measured:

      --setting-sources ""     20 tools,  0 MCP, 15,555 prompt tokens
      --setting-sources user   90 tools, 67 MCP, 31,001 prompt tokens

  The MCP servers are the point: web search and everything else loom used to
  implement natively now arrives this way, so paying for them is paying for the
  capability. The prompt is cached after the first turn of a session, so the
  marginal cost of the extra ~15K is a cached read.

  `project` and `local` are excluded because every session runs in the home
  directory: whatever `.claude/settings.local.json` happens to be lying around
  should not change how the agent behaves.

  Two measurements that look tempting and are not:

    * `--strict-mcp-config` cuts the prompt in half, and takes every MCP server
      with it. MCP is the only extension point left now that loom runs no tools
      of its own.
    * `--bare` cuts the prompt to 1,604 tokens, but strips Claude Code's own
      system prompt too and leaves `Bash, Edit, Read`. That throws away what we
      came for.
  """

  @behaviour Loom.Agent.Backend

  require Logger

  alias Loom.Agent.Backend
  alias Loom.Agent.Jsonl
  alias Loom.Agent.Proc

  @base_args [
    "-p",
    "--verbose",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--setting-sources",
    "user"
  ]

  # Interrupt and teardown both kill; this is how long we give the tree to
  # actually disappear before saying so in the log. Generous because a 224 MB
  # node process can take a moment, and we only read it to warn.
  @reap_grace_ms 2_000

  @impl Backend
  def start(loom_id, meta) do
    {:ok, new(loom_id, uuid4(), meta)}
  end

  @impl Backend
  def resume(loom_id, meta) do
    case Backend.meta_get(meta, :cc_session_id) do
      id when is_binary(id) ->
        # `--resume <uuid>` locates a conversation across working directories
        # (measured), so there is nothing else to restore — provided there is a
        # conversation. A session restored before its first turn has only an id.
        {:ok, %{new(loom_id, id, meta) | started?: started?(meta, id)}}

      _ ->
        {:error, "no cc_session_id recorded for this session"}
    end
  end

  defp new(loom_id, session_id, meta) do
    %{
      # Loom's own session id, which names the process's directory.
      loom_id: loom_id,
      session_id: session_id,
      cwd: Backend.meta_get(meta, :cc_cwd) || default_cwd(),
      # Appended to Claude Code's own system prompt on every spawn — it is a
      # flag, not something the conversation remembers across `--resume`.
      instructions: Backend.meta_get(meta, :instructions),
      # An incognito session's: spawned under `Loom.Agent.Sandbox`.
      sandbox: Backend.meta_get(meta, :sandbox) == true,
      # `--model`, when the session pins one; Claude Code's default otherwise.
      model: Backend.meta_get(meta, :cc_model),
      # `--effort`, which a running process cannot change: nil for the model's
      # default. See set_effort/2.
      effort: Backend.meta_get(meta, :cc_effort),
      # `total_cost_usd` as the running process last reported it: a running
      # total since that process started, so a turn's cost is the difference.
      cost_seen: 0.0,
      # Whether Claude Code has this conversation on disk, so the next spawn
      # resumes it rather than naming it. Set by `system/init`, not by the spawn:
      # a session that is released or restarted before its first turn got going
      # has nothing to resume, and `--resume` then exits with "No conversation
      # found" on every turn after.
      started?: false,
      # A conversation of another session's to start from (`--fork-session`):
      # the first spawn copies it under this session's own id, and every later
      # one resumes that copy. See `Loom.Agent.Carry`.
      fork_from: Backend.meta_get(meta, :cc_fork_from),
      # Set while a spawn has not yet said `system/init`: how it was started and
      # what has been written to it since, newest first. Enough to start over
      # once if `--resume` turns out to have nothing to resume. See decode/2.
      booting: nil,
      # The running process, a `Loom.Agent.Proc`; nil when there is none.
      proc: nil,
      # What the last checkpoint saved, so an unchanged handle is not saved again.
      saved: nil,
      # Identity of the API call currently streaming. One turn makes several, and
      # the SSE `index` restarts at 0 in each — see `block_id/2`.
      message_id: nil,
      # block_ids handed out by `content_block_start`, oldest first. The
      # authoritative `assistant` messages consume them in the same order.
      pending_blocks: [],
      buffer: "",
      tools: %{},
      # Set by interrupt/1 so the `result` that follows is recognised as the one
      # we asked for rather than reported as a failure.
      interrupted?: false,
      next_control_id: 1,
      # Taken from the *last* API call of the turn, which is the only honest
      # measure of how big the conversation now is. See `context/2`.
      context_tokens: 0,
      context_window: nil,
      # The model the process was started on (`system/init`), and the one that
      # last answered this turn. They differ when Claude Code fell back, or the
      # API answered from another model; `turn_done` carries both.
      asked_model: nil,
      turn_model: nil
    }
  end

  @impl Backend
  def run_turn(handle, text) when is_binary(text) do
    with {:ok, handle} <- ensure_process(handle) do
      handle = write(handle, message_line(text))
      # Block ids need no per-turn reset: they are qualified by the API call's
      # message id, which is unique across turns. See `block_id/2`.
      {:ok, Map.merge(handle, %{tools: %{}, interrupted?: false, turn_model: nil})}
    end
  end

  # Spawned with nothing written: Claude Code loads, then waits on stdin, and
  # says `system/init` only once the first message comes.
  @impl Backend
  def warm(handle), do: ensure_process(handle)

  @impl Backend
  def steer(%{proc: nil}, _text) do
    # Nothing is running, so there is nothing to join. The session falls back to
    # starting a turn.
    {:error, "no live claude process to steer"}
  end

  def steer(handle, text) when is_binary(text) do
    # Same pipe as run_turn/2: Claude Code decides where it lands, and mid-turn
    # it lands at the next tool-result boundary.
    {:ok, write(handle, message_line(text))}
  end

  defp ensure_process(%{proc: %Proc{} = proc} = handle) do
    if Proc.alive?(proc) do
      {:ok, handle}
    else
      # The process died without us noticing. Start a new one rather than
      # writing into a pipe nobody reads.
      Proc.close(proc)
      spawn_process(%{handle | proc: nil, buffer: ""})
    end
  end

  defp ensure_process(handle), do: spawn_process(handle)

  defp spawn_process(handle) do
    args =
      @base_args ++
        model_args(handle) ++
        effort_args(handle) ++
        fallback_args() ++
        session_args(handle) ++ instruction_args(handle) ++ guard_args(handle)

    with {:ok, exe} <- executable(),
         {exe, args} = sandboxed(handle, exe, args),
         {:ok, proc} <- Proc.spawn(handle.loom_id, exe, args, handle.cwd) do
      {:ok,
       %{
         handle
         | proc: proc,
           cost_seen: 0.0,
           buffer: "",
           tools: %{},
           message_id: nil,
           pending_blocks: [],
           booting: %{resumed?: handle.started?, lines: []}
       }}
    end
  end

  # Its conversation is kept where Claude Code keeps any started in its cwd.
  defp sandboxed(handle, exe, args) do
    Loom.Agent.Sandbox.wrap(
      Map.get(handle, :sandbox),
      exe,
      args,
      [
        handle.cwd,
        Loom.Agent.Store.output_dir(handle.loom_id),
        Loom.Agent.Sandbox.claude_project_dir(handle.cwd)
      ] ++ Loom.Agent.Sandbox.caches()
    )
  end

  defp write(handle, line) do
    # A CLI that exits at once (a bad `--resume`, a missing login) is reported
    # by the poll that finds it gone; the write into its FIFO goes nowhere.
    if handle.proc, do: Proc.write(handle.proc, line)

    case handle.booting do
      nil -> handle
      booting -> %{handle | booting: %{booting | lines: [line | booting.lines]}}
    end
  end

  # The very first turn names the conversation; every later one reattaches to
  # it. Passing both is rejected by the CLI.
  defp session_args(%{started?: false, fork_from: from, session_id: id}) when is_binary(from),
    do: ["--resume", from, "--fork-session", "--session-id", id]

  defp session_args(%{started?: false, session_id: id}), do: ["--session-id", id]
  defp session_args(%{session_id: id}), do: ["--resume", id]

  # Headers written before `cc_started` existed say nothing, so ask Claude
  # Code's own store whether the conversation is there.
  defp started?(meta, id) do
    case Backend.meta_get(meta, :cc_started) do
      started when is_boolean(started) -> started
      _ -> stored?(id)
    end
  end

  defp stored?(id),
    do: Path.wildcard(Path.join([claude_dir(), "projects", "*", id <> ".jsonl"])) != []

  defp claude_dir, do: System.get_env("CLAUDE_CONFIG_DIR") || Path.expand("~/.claude")

  # What to answer with when the model is unavailable. Claude Code (2.1.300)
  # switches on a 500 or 503 after one attempt, on a 529 after its retries,
  # never on a 429; the switch lasts the rest of the turn, and the next turn
  # starts on the usual model again. See docs/backends.md.
  defp fallback_args do
    case Application.get_env(:loom, Loom.Agent, [])[:claude_fallback_model] do
      model when is_binary(model) and model != "" -> ["--fallback-model", model]
      _ -> []
    end
  end

  defp model_args(%{model: model}) when is_binary(model) and model != "", do: ["--model", model]
  defp model_args(_handle), do: []

  defp effort_args(%{effort: effort}) when is_binary(effort), do: ["--effort", effort]
  defp effort_args(_handle), do: []

  defp instruction_args(%{instructions: text}) when is_binary(text) and text != "",
    do: ["--append-system-prompt", text]

  defp instruction_args(_handle), do: []

  # The permission mode, and for a virtual employee its rules: the hook on a
  # workstation, Claude Code's own permissions when it is given some
  # (`Loom.Agent.Guard.claude_args/1`). Last, as `--allowedTools` and the like
  # take every argument up to the next flag.
  defp guard_args(%{loom_id: id}), do: Loom.Agent.Guard.claude_args(id)

  defp tool_input(handle, message),
    do: Map.get(Map.get(handle, :inputs, %{}), message["tool_use_id"], %{})

  defp message_line(text) do
    Jsonl.line(%{"type" => "user", "message" => %{"role" => "user", "content" => text}})
  end

  @impl Backend
  def interrupt(%{proc: nil} = handle), do: {:ok, handle}

  def interrupt(handle) do
    # Asking beats killing: the process survives, so the next turn is still
    # warm. See the moduledoc.
    id = "int_#{handle.next_control_id}"

    write(
      handle,
      Jsonl.line(%{
        "type" => "control_request",
        "request_id" => id,
        "request" => %{"subtype" => "interrupt"}
      })
    )

    {:ok, %{handle | interrupted?: true, next_control_id: handle.next_control_id + 1}}
  end

  # A flag, so a warm process spawned with another level is let go of; the
  # turn about to start spawns its successor, which resumes the conversation.
  @impl Backend
  def set_effort(handle, effort) do
    if Map.get(handle, :effort) == effort,
      do: handle,
      else: %{teardown(handle) | effort: effort}
  end

  # Also a flag (`--model`), so the same as set_effort/2.
  @impl Backend
  def set_model(handle, model) do
    if Map.get(handle, :model) == model,
      do: handle,
      else: %{teardown(handle) | model: model}
  end

  @impl Backend
  def release(%{proc: nil} = handle), do: {:ok, handle}
  def release(handle), do: {:ok, teardown(handle)}

  @impl Backend
  def relocate(handle, cwd, instructions) do
    {:ok, %{teardown(handle) | cwd: cwd || default_cwd(), instructions: instructions}}
  end

  @impl Backend
  def persist(handle) do
    %{
      cc_session_id: handle.session_id,
      cc_cwd: handle.cwd,
      cc_started: handle.started?,
      cc_fork_from: Map.get(handle, :fork_from),
      cc_model: Map.get(handle, :model),
      cc_effort: Map.get(handle, :effort)
    }
  end

  @impl Backend
  def stop(handle) do
    teardown(handle)
    :ok
  end

  defp teardown(%{proc: nil} = handle), do: handle

  defp teardown(handle) do
    Proc.kill(handle.proc)
    %{handle | proc: nil, buffer: "", saved: nil}
  end

  # ── Outliving the node ───────────────────────────────────────────────────

  @impl Backend
  def detach(%{proc: nil}), do: :ok

  def detach(handle) do
    checkpoint(handle)
    Proc.close(handle.proc)
  end

  @impl Backend
  def adopt(handle) do
    case Proc.adopt(handle.loom_id) do
      # The fresh handle's instructions win: only a spawn reads them.
      {:ok, proc, saved} ->
        {:ok, %{Map.merge(handle, saved) | proc: proc, instructions: handle.instructions}}

      :error ->
        :error
    end
  end

  @impl Backend
  def checkpoint(%{proc: nil} = handle), do: handle

  def checkpoint(handle) do
    saved = Map.drop(handle, [:proc, :saved, :instructions])
    mark = :erlang.phash2({handle.proc.offset, saved})

    if mark == handle.saved do
      handle
    else
      Proc.checkpoint(handle.proc, saved)
      %{handle | saved: mark}
    end
  end

  # ── Decoding ──────────────────────────────────────────────────────────────

  @impl Backend
  def decode(%{proc: %Proc{ref: ref} = proc} = handle, {:loom_proc, ref}) do
    case Proc.poll(proc) do
      {"", proc, :alive} ->
        {:ok, %{handle | proc: proc}, []}

      {data, proc, :alive} ->
        {handle, out} = feed(%{handle | proc: proc}, data)
        {:ok, handle, out}

      {"", _proc, {:exited, status}} ->
        died(handle, status)
    end
  end

  # A poll for a process we have let go of.
  def decode(handle, {:loom_proc, _ref}), do: {:ok, handle, []}

  def decode(_handle, _message), do: :ignore

  @doc false
  # Output as read: lines may be split anywhere. Public for the tests.
  def feed(handle, chunk) do
    {lines, buffer} = Jsonl.split(handle.buffer <> chunk)
    {handle, out} = Enum.reduce(lines, {%{handle | buffer: buffer}, []}, &reduce_line/2)
    {handle, Enum.reverse(out)}
  end

  # Only reachable when the process died on its own: the one we kill ourselves
  # (`release/1`, `stop/1`) is forgotten first, so its polls no longer match
  # it. So this always means the process went away with nothing to
  # explain it — and a session left sitting in `:running` with no reason is the
  # failure mode that makes a background agent look hung.
  #
  # It fires between turns too (a crash while idle). The session then records a
  # failure for a turn that was not running, which is noisy but honest; the
  # next `run_turn/2` respawns via `ensure_process/1` either way.
  #
  # One exit is not a failure: `--resume` of a conversation Claude Code does not
  # have ("No conversation found"), before `system/init`. The record said it had
  # started and the store disagrees — a header from before `cc_started`, or a
  # store cleaned by hand. The conversation is then named afresh and the turn's
  # messages written again, so the user sees nothing but a slower start. Only
  # once per spawn: the retry is a `--session-id` spawn, which never lands here.
  @doc false
  # Public for the tests.
  def died(%{booting: %{resumed?: true} = booting} = handle, status) do
    if stored?(handle.session_id) do
      exited(handle, status)
    else
      Logger.warning(
        "ClaudeCode: no conversation #{handle.session_id} to resume; starting it afresh"
      )

      restart = %{handle | proc: nil, buffer: "", started?: false}

      case spawn_process(restart) do
        {:ok, fresh} ->
          {:ok, booting.lines |> Enum.reverse() |> Enum.reduce(fresh, &write(&2, &1)), []}

        {:error, _reason} ->
          exited(handle, status)
      end
    end
  end

  # A fork whose source Claude Code no longer has starts empty instead: the
  # first message says where the conversation was, so it can be read.
  def died(%{booting: %{}, started?: false, fork_from: from} = handle, status)
      when is_binary(from) do
    Logger.warning(
      "ClaudeCode: no conversation #{from} to fork; starting #{handle.session_id} empty"
    )

    restart = %{handle | proc: nil, buffer: "", fork_from: nil}

    case spawn_process(restart) do
      {:ok, fresh} ->
        {:ok, handle.booting.lines |> Enum.reverse() |> Enum.reduce(fresh, &write(&2, &1)), []}

      {:error, _reason} ->
        exited(handle, status)
    end
  end

  def died(handle, status), do: exited(handle, status)

  defp exited(handle, status) do
    {:ok, %{handle | proc: nil, booting: nil, saved: nil},
     [
       {:event, :turn_failed,
        %{reason: "claude exited with status #{status || "?"} before finishing the turn"}}
     ]}
  end

  defp reduce_line(line, {handle, out}) do
    case Jason.decode(line) do
      {:ok, message} ->
        {handle, produced} = translate(handle, message)
        {handle, Enum.reverse(produced) ++ out}

      {:error, _} ->
        # stderr is not redirected into this stream, so a non-JSON line is a
        # protocol surprise worth seeing — but never worth crashing the session.
        Logger.warning("ClaudeCode: unparseable output line: #{String.slice(line, 0, 200)}")
        {handle, out}
    end
  end

  # ── Translation ───────────────────────────────────────────────────────────

  defp translate(handle, %{"type" => "system", "subtype" => "init"} = message) do
    # Authoritative session id. We minted it, but taking it from here means a
    # future CLI that reassigns ids cannot silently orphan the conversation.
    handle =
      Map.put(
        %{
          handle
          | session_id: message["session_id"] || handle.session_id,
            started?: true,
            booting: nil
        },
        :fork_from,
        nil
      )

    handle = Map.put(handle, :asked_model, message["model"])

    {handle, [{:event, :status, %{status: :running, backend_ref: handle.session_id}}]}
  end

  defp translate(handle, %{"type" => "system", "subtype" => "permission_denied"} = message) do
    # A virtual employee's permissions at work (`dontAsk`): a line in its
    # Updates. Anywhere else, under bypassPermissions, it should be
    # unreachable, and the model is being silently crippled, so it is loud.
    if Loom.Agent.Guard.guarded?(handle.loom_id),
      do:
        Loom.Agent.Guard.denied(
          handle.loom_id,
          message["tool_name"] || "?",
          tool_input(handle, message)
        ),
      else: Logger.error("ClaudeCode: permission denied despite automode: #{inspect(message)}")

    {handle,
     [
       {:event, :tool_result,
        %{
          id: message["tool_use_id"],
          name: message["tool_name"],
          status: :error,
          output: message["message"] || "permission denied"
        }}
     ]}
  end

  # A compaction, typed (`/compact` goes through stdin like any message, and
  # Claude Code runs it) or automatic. Measured on a manual one:
  #
  #     compact_metadata: trigger=manual pre_tokens=15723 post_tokens=1257
  #
  # followed by an empty `result/success` — the turn says nothing else, so this
  # is the only sign it happened. No API call follows it, so `post_tokens` is
  # also the only honest context size until the next turn's `message_start`.
  defp translate(handle, %{"type" => "system", "subtype" => "compact_boundary"} = message) do
    meta = message["compact_metadata"] || %{}

    handle =
      case meta["post_tokens"] do
        tokens when is_integer(tokens) -> %{handle | context_tokens: tokens}
        _ -> handle
      end

    {handle,
     [
       {:event, :compacted,
        %{
          trigger: meta["trigger"],
          pre_tokens: meta["pre_tokens"],
          post_tokens: meta["post_tokens"]
        }}
     ]}
  end

  # A request the API refused (Bedrock's 503, an overload) that Claude Code is
  # about to send again, after `retry_delay_ms`. It says nothing else while it
  # waits — ten attempts at a 503 took 4½ minutes, measured — so without this
  # the turn looks hung.
  defp translate(handle, %{"type" => "system", "subtype" => "api_retry"} = message) do
    {handle,
     [
       {:event, :api_retry,
        %{
          attempt: message["attempt"],
          max_retries: message["max_retries"],
          delay_ms: message["retry_delay_ms"],
          status: message["error_status"],
          error: message["error"]
        }}
     ]}
  end

  # A safety classifier stopped the model. Claude Code says so in one of two
  # ways (measured, 2.1.312): a notice that it goes on, once, on another model,
  # or a refusal it cannot get round, which the `result` then reports as an
  # error. Either way the conversation now holds what tripped it, and every
  # later turn on that model is liable to trip it again.
  defp translate(
         handle,
         %{"type" => "system", "subtype" => "model_refusal_no_fallback"} = message
       ) do
    {handle, [{:event, :flagged, %{category: message["api_refusal_category"], fell_back: false}}]}
  end

  defp translate(handle, %{"type" => "system", "subtype" => "informational", "content" => text})
       when is_binary(text) do
    if text =~ ~r/safeguards/i,
      do: {handle, [{:event, :flagged, %{category: nil, fell_back: true}}]},
      else: {handle, []}
  end

  defp translate(handle, %{"type" => "system"}), do: {handle, []}

  # The ack for our own interrupt. `still_queued` would list messages that
  # survived it, which cannot happen here — the session never writes a second
  # message while it is stopping one.
  defp translate(handle, %{"type" => "control_response"}), do: {handle, []}

  # Each API call announces its own prompt size here. An agentic turn makes
  # several, so this is overwritten each time and the last one wins — that is
  # the number that matters, and `result` cannot give it (see `context/2`).
  defp translate(handle, %{
         "type" => "stream_event",
         "event" => %{"type" => "message_start", "message" => message}
       }) do
    {%{
       handle
       | message_id: message["id"],
         # Each API call's blocks are self-contained: all of call N's
         # `assistant` messages arrive before call N+1 starts, so clearing here
         # bounds the list and drops anything that was never claimed.
         pending_blocks: [],
         context_tokens: context_of(message["usage"] || %{})
     }, []}
  end

  defp translate(handle, %{"type" => "stream_event", "event" => event}) do
    stream_event(handle, event)
  end

  # Claude Code splits one API call's blocks across *several* `assistant`
  # messages — one per block — so a block's position in `content` is not its
  # position in the stream. Counting it there gave the tool_use event the text
  # block's id, which made it clear the wrong placeholder and orphan its own.
  # Not the model: Claude Code's own words, written as a reply. When the API
  # gave up ("API Error: 503 …") the `result` that follows says the same as an
  # error, which is how it is shown; as a reply as well it would read as if
  # the model had said it. The rest ("No response requested." after an
  # interrupt) is noise.
  defp translate(handle, %{"type" => "assistant", "message" => %{"model" => "<synthetic>"}}),
    do: {handle, []}

  defp translate(handle, %{"type" => "assistant", "message" => %{"content" => content}} = message)
       when is_list(content) do
    # The main conversation's model; a subagent's (`parent_tool_use_id`) may
    # be another by design.
    model = message["message"]["model"]

    handle =
      if is_binary(model) and message["parent_tool_use_id"] == nil,
        do: Map.put(handle, :turn_model, model),
        else: handle

    Enum.reduce(content, {handle, []}, fn block, {acc, out} ->
      {acc, produced} = assistant_block(acc, block)
      {acc, out ++ produced}
    end)
  end

  defp translate(handle, %{"type" => "user", "message" => %{"content" => content}})
       when is_list(content) do
    produced =
      for %{"type" => "tool_result", "tool_use_id" => id} = block <- content do
        {:event, :tool_result,
         %{
           id: id,
           name: Map.get(handle.tools, id, "tool"),
           status: if(block["is_error"], do: :error, else: :ok),
           output: describe(block["content"])
         }}
      end

    {handle, produced}
  end

  defp translate(handle, %{"type" => "result"} = message) do
    # The process deliberately survives: the next turn starts in 0.02 s instead
    # of 6 s. It is released on the session's idle timer, not here.
    usage = message["usage"] || %{}
    {handle, cost} = cost(handle, message)

    cond do
      handle.interrupted? ->
        # The turn we asked to stop. Claude Code reports it as
        # `error_during_execution`, which is not an error — and the session
        # emits its own abort event, so saying anything here double-reports it.
        # What it cost is still owed.
        {%{handle | interrupted?: false}, cost}

      result_ok?(message) ->
        handle = %{handle | context_window: context_window(message)}

        {handle,
         cost ++
           [
             {:event, :turn_done,
              %{
                stop_reason: message["stop_reason"],
                usage: usage,
                context_tokens: handle.context_tokens,
                context_window: handle.context_window,
                model: Map.get(handle, :turn_model) || Map.get(handle, :asked_model),
                expected: Map.get(handle, :asked_model)
              }}
           ]}

      true ->
        {handle,
         cost ++
           [
             {:event, :turn_failed,
              %{
                reason: failure_reason(message),
                terminal_reason: message["terminal_reason"],
                usage: usage
              }}
           ]}
    end
  end

  defp translate(handle, _message), do: {handle, []}

  # This turn's share of the process's running total. A smaller total than
  # last seen means a process that started over, so all of it is this turn's.
  defp cost(handle, %{"total_cost_usd" => total}) when is_number(total) do
    seen = Map.get(handle, :cost_seen, 0.0)
    usd = if total >= seen, do: total - seen, else: total
    {Map.put(handle, :cost_seen, total * 1.0), [{:event, :cost, %{usd: usd}}]}
  end

  defp cost(handle, _message), do: {handle, []}

  # `is_error` first: a turn the API gave up on still says `"subtype":
  # "success"`, with the error in `result` and `api_error_status`.
  defp result_ok?(%{"is_error" => true}), do: false
  defp result_ok?(%{"subtype" => "success"}), do: true
  defp result_ok?(_message), do: false

  defp failure_reason(%{"is_error" => true, "result" => text})
       when is_binary(text) and text != "",
       do: text

  defp failure_reason(message), do: message["subtype"] || "unknown"

  @doc """
  How big the prompt of one API call was.

  **Not** computed from `result`, which is the sum over every API call in the
  turn. Measured on a four-step shell task:

      call 1  in=2  cache_read=10112  cache_write=20958  ->  31,072
      call 2  in=2  cache_read=31070  cache_write=  141  ->  31,213
      call 3  in=2  cache_read=31211  cache_write=  359  ->  31,572
      call 4  in=2  cache_read=31570  cache_write=  141  ->  31,713
      call 5  in=2  cache_read=31711  cache_write=  141  ->  31,854
      result  in=10 cache_read=135674 cache_write=21740  -> 157,424

  The conversation was 31,854 tokens the whole time; `result` reports the turn's
  total token traffic, because each tool call re-reads the cached prefix. Showing
  that as "context" told the user they were at 157K when they were at 32K.
  """
  def context_of(usage) do
    Enum.sum(
      for key <- ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"],
          is_integer(usage[key]),
          do: usage[key]
    )
  end

  # `modelUsage` is keyed by model id; there is one entry per model the turn
  # used, and all of them report the same window for a single-model turn.
  defp context_window(message) do
    case message["modelUsage"] do
      usage when is_map(usage) ->
        usage |> Map.values() |> Enum.find_value(fn u -> is_map(u) && u["contextWindow"] end)

      _ ->
        nil
    end
  end

  defp assistant_block(handle, %{"type" => "text", "text" => text}) do
    {block_id, handle} = claim_block(handle, nil)
    {handle, [{:event, :assistant_text, %{block_id: block_id, text: text}}]}
  end

  defp assistant_block(handle, %{"type" => "thinking"} = block) do
    {block_id, handle} = claim_block(handle, nil)
    {handle, [{:event, :thinking, %{block_id: block_id, text: Map.get(block, "thinking", "")}}]}
  end

  defp assistant_block(handle, %{"type" => "tool_use", "id" => id, "name" => name} = block) do
    {block_id, handle} = claim_block(handle, id)

    # Remembered so the matching tool_result, which only carries the id, can be
    # labelled with the tool that produced it.
    handle = %{handle | tools: Map.put(handle.tools, id, name)}

    # And its input, for a call a virtual employee's permissions refuse: the
    # refusal names only the tool (see the permission_denied clause).
    inputs = Map.get(handle, :inputs, %{})
    inputs = if map_size(inputs) > 50, do: %{}, else: inputs
    handle = Map.put(handle, :inputs, Map.put(inputs, id, Map.get(block, "input", %{})))

    {handle,
     [
       {:event, :tool_use,
        %{id: id, block_id: block_id, name: name, input: Map.get(block, "input", %{})}}
     ]}
  end

  defp assistant_block(handle, _block), do: {handle, []}

  # ── Matching events back to the deltas they supersede ─────────────────────

  defp remember_block(handle, block_id, tool_id) do
    %{handle | pending_blocks: handle.pending_blocks ++ [{block_id, tool_id}]}
  end

  # A tool_use carries an id that the SSE `content_block_start` also carried, so
  # it can be matched exactly. Text and thinking have nothing to match on, so
  # they take the oldest unclaimed block — which is correct because the SSE
  # stream and the `assistant` messages arrive in the same order.
  defp claim_block(handle, tool_id) do
    pending = handle.pending_blocks

    entry =
      (tool_id && Enum.find(pending, fn {_id, tid} -> tid == tool_id end)) ||
        List.first(pending)

    case entry do
      {block_id, _tid} ->
        {block_id, %{handle | pending_blocks: List.delete(pending, entry)}}

      nil ->
        # No `content_block_start` was seen for this block. Should not happen
        # with --include-partial-messages; a synthetic id keeps the event
        # renderable and simply matches no placeholder.
        {"#{handle.message_id || "m?"}.unstreamed", handle}
    end
  end

  # ── SSE passthrough ───────────────────────────────────────────────────────
  #
  # `--include-partial-messages` wraps the raw Anthropic SSE events, which is
  # the same shape the client delta protocol was built around, so this layer is
  # almost a rename.

  defp stream_event(handle, %{
         "type" => "content_block_start",
         "index" => index,
         "content_block" => %{"type" => "tool_use", "id" => id, "name" => name}
       }) do
    block_id = block_id(handle, index)

    {remember_block(handle, block_id, id),
     [{:delta, %{block_id: block_id, type: :tool_use_start, name: name, id: id}}]}
  end

  defp stream_event(handle, %{
         "type" => "content_block_start",
         "index" => index,
         "content_block" => %{"type" => type}
       }) do
    block_id = block_id(handle, index)

    {remember_block(handle, block_id, nil),
     [{:delta, %{block_id: block_id, type: :block_start, block_type: atomize(type)}}]}
  end

  defp stream_event(handle, %{
         "type" => "content_block_delta",
         "index" => index,
         "delta" => %{"type" => "text_delta", "text" => text}
       }) do
    {handle, [{:delta, %{block_id: block_id(handle, index), type: :text, chunk: text}}]}
  end

  defp stream_event(handle, %{
         "type" => "content_block_delta",
         "index" => index,
         "delta" => %{"type" => "thinking_delta", "thinking" => text}
       }) do
    {handle, [{:delta, %{block_id: block_id(handle, index), type: :thinking, chunk: text}}]}
  end

  defp stream_event(handle, %{"type" => "content_block_stop", "index" => index}) do
    {handle, [{:delta, %{block_id: block_id(handle, index), type: :block_end}}]}
  end

  # `input_json_delta` and `signature_delta` are dropped on purpose: the
  # authoritative version arrives in the `assistant` message, and a client has
  # nothing useful to do with half a JSON argument list.
  defp stream_event(handle, _event), do: {handle, []}

  # Block types are the API's to add to (`redacted_thinking`,
  # `server_tool_use`, …). An unknown one stays a string: it reaches the client
  # as the same JSON either way, and an atom per new name would never be freed.
  defp atomize("text"), do: :text
  defp atomize("thinking"), do: :thinking
  defp atomize("tool_use"), do: :tool_use
  defp atomize(other), do: other

  defp describe(content) when is_binary(content), do: content

  defp describe(blocks) when is_list(blocks) do
    Enum.map_join(blocks, "\n", fn
      %{"type" => "text", "text" => text} -> text
      %{"type" => "image"} -> "[image]"
      other -> "[#{other["type"] || "block"}]"
    end)
  end

  defp describe(other), do: inspect(other)

  # ── Processes ─────────────────────────────────────────────────────────────

  @doc false
  # Public only so a test can assert the orphan behaviour this exists to prevent.
  def kill_tree(nil), do: :ok

  def kill_tree(os_pid) do
    # Snapshot first: killing the parent reparents the children and loses the
    # relationship, which is exactly how the 224 MB runtime gets orphaned.
    pids = [os_pid | descendants(os_pid)]
    Enum.each(pids, &kill/1)

    Process.sleep(@reap_grace_ms)

    case Enum.filter(pids, &alive?/1) do
      [] -> :ok
      survivors -> Logger.warning("ClaudeCode: processes survived SIGKILL: #{inspect(survivors)}")
    end

    :ok
  end

  defp descendants(os_pid) do
    case cmd("pgrep", ["-P", to_string(os_pid)]) do
      {:ok, output} ->
        children =
          output
          |> String.split(~r/\s+/, trim: true)
          |> Enum.flat_map(fn raw ->
            case Integer.parse(raw) do
              {pid, ""} -> [pid]
              _ -> []
            end
          end)

        children ++ Enum.flat_map(children, &descendants/1)

      :error ->
        []
    end
  end

  defp kill(os_pid), do: cmd("kill", ["-KILL", to_string(os_pid)])

  defp alive?(os_pid) do
    match?({:ok, _}, cmd("kill", ["-0", to_string(os_pid)]))
  end

  defp cmd(binary, args) do
    case System.cmd(binary, args, stderr_to_stdout: true) do
      {output, 0} -> {:ok, output}
      _ -> :error
    end
  rescue
    # A missing `pgrep`/`kill` must not take the session down with it; the
    # consequence is a leaked process, which the warning above will surface.
    ErlangError -> :error
  end

  # ── Misc ──────────────────────────────────────────────────────────────────

  defp executable do
    configured = Application.get_env(:loom, Loom.Agent, [])[:claude_cli] || "claude"

    case System.find_executable(configured) do
      nil -> {:error, "could not find the `#{configured}` executable on PATH"}
      path -> {:ok, path}
    end
  end

  defp default_cwd do
    Application.get_env(:loom, Loom.Agent, [])[:workspace] || System.user_home!()
  end

  @doc """
  Identity of one content block, stable between its deltas and its event.

  Qualified by the **API call's** message id, not by the turn. One agentic turn
  makes an API call per tool round and the SSE `index` restarts at 0 in each, so
  a per-turn qualifier made call 2's first block collide with call 1's — the
  second answer streamed into the first one's placeholder, which is what
  produced doubled text mid-turn.
  """
  def block_id(%{message_id: nil}, index), do: "m?.#{index}"
  def block_id(%{message_id: id}, index), do: "#{id}.#{index}"

  # Claude Code requires a syntactically valid v4 UUID for --session-id, and
  # rejects anything else. Not worth a dependency.
  defp uuid4 do
    <<head::48, _::4, mid::12, _::2, tail::62>> = :crypto.strong_rand_bytes(16)

    <<head::48, 4::4, mid::12, 2::2, tail::62>>
    |> Base.encode16(case: :lower)
    |> hyphenate()
  end

  defp hyphenate(<<a::binary-8, b::binary-4, c::binary-4, d::binary-4, e::binary-12>>) do
    "#{a}-#{b}-#{c}-#{d}-#{e}"
  end
end
