defmodule Loom.Agent.Session do
  @moduledoc """
  One conversation: one GenServer bound for life to one Claude Code session or
  one Codex thread.

  Loom no longer runs an agent loop. This process owns everything the backend
  does not: the queue of user messages, event numbering, the replayable
  transcript, the title, and status. The agent loop, the tools, the context
  window and the system prompt all belong to the backend now — see
  `docs/backends.md`.

  ## A message typed mid-turn joins that turn

  Both backends inject a mid-turn message into the running turn — Claude Code at
  the next tool-result boundary, Codex immediately via `turn/steer` (both
  measured; see `Loom.Agent.Backend`). So a message that arrives while the agent
  is working is handed straight over rather than queued: the point of typing "no,
  not like that" is that it lands before the work is finished.

  The queue therefore exists for exactly one case — `:interrupted`, where no turn
  is running to join. Those messages wait, and go out merged with whatever the
  user types next; three things said at once should reach the model together,
  because the third is usually the one that overrules the first two.

  If steering fails (Codex refuses when the turn ended under us) the message
  falls back to the queue and the next turn carries it. Late beats lost.

  ## Interrupting parks the queue instead of draining it

  `interrupt/1` stops the turn and moves to `:interrupted`, whose only purpose is
  to suppress the "idle and the queue is not empty, so start a turn" rule. If an
  interrupt drained the queue, stopping the agent would immediately start
  something else, which is not what pressing escape means.

  ## The backend is kept warm, then let go

  Claude Code holds a ~275 MB process so that later turns start in 0.02 s instead
  of 6 s. That is worth paying while someone is working and pure waste once they
  walk away, so a timer releases it after `@idle_release_ms` with no turn. The
  conversation is unaffected — it lives in the backend's own store — the next
  turn just pays the cold start again. For Codex this is a no-op.

  `/reload` (`Loom.Agent.reload_backends/0`) lets every session's backend go at
  once instead of on the timer, so changed config is read on the next turn. A
  session that is mid-turn sets `reload_after_turn` and lets go when it ends.

  To continue, the user types. That submission merges with whatever was parked,
  so there is no resume button, no "continue or discard" prompt, and no second
  code path — recovery *is* an ordinary submit.

  ## A restart mid-turn carries on, where the backend allows

  Claude Code and Kiro run outside the node (`Loom.Agent.Proc`): a stopping
  node lets their process go (`Backend.detach/1`) and the next one takes it
  back (`Backend.adopt/1`), reading what it wrote meanwhile from where the last
  one stopped. So a session found `:running` on disk with its process adopted
  is still running, and the turn ends as it would have. So does one whose node
  was killed outright: the decoding state is saved after every batch of output
  (`Backend.checkpoint/1`), once its events are on disk.

  Otherwise — Codex, whose app-server dies with the node, or a process that is
  gone — the turn went with the node and cannot be rejoined. Re-submitting is
  worse than it looks: the user's message is already in the backend's own
  history, so the model would see it twice. So that session comes back
  `:interrupted` with its queue intact, and says so; the user continues as
  after a deliberate interrupt.

  ## Fan-out to several devices

  Unchanged, and still the reason this process exists at all: every state change
  becomes an event with a monotonic `seq`, appended to `events.jsonl` and
  broadcast on `"agent:<id>"`. Clients join with the last `seq` they saw and get
  only what they missed. Transient deltas go out on the same topic as
  `{:agent_delta, id, delta}` and are never persisted — a client that missed one
  gets the authoritative event instead.

  Deltas carry their own monotonic `delta_seq` for the same reason events carry
  `seq`: so a client can tell a delta it has already applied from a new one.
  Text deltas are *appended*, so applying one twice visibly corrupts the output
  — and double delivery really happens. phoenix.js skips the leave push when a
  channel has not finished joining (it fakes a local "ok" instead), so a client
  that mounts and immediately remounts — React StrictMode does exactly this —
  leaves a channel process alive on the server, subscribed and pushing. Events
  survived it because `seq` deduplicated them; deltas interleaved the same text
  with itself.
  """
  use GenServer, restart: :transient

  require Logger

  alias Loom.Agent.Backend
  alias Loom.Agent.Files
  alias Loom.Agent.Output
  alias Loom.Agent.Store

  # How many events stay in memory for replay. A client that has been away
  # longer gets `truncated_before` and reloads.
  @transcript_limit 500

  @title_limit 80

  # How long a finished session keeps its backend warm. Long enough to cover
  # reading the output and typing a follow-up; short enough that a session left
  # open overnight costs nothing.
  @idle_release_ms :timer.minutes(15)

  # A new session nothing is written in goes after this; see `unused?/1`.
  @unused_ms :timer.minutes(5)

  # How long a first message waits for `Loom.Projects.Classifier` before the
  # turn starts where the session already is. It answers in about two seconds.
  @classify_timeout_ms :timer.seconds(15)

  # What counts as the session being used, for `last_active_at`. Not `:status`:
  # a restart restores every session, and must not make them all "just now".
  @activity [:user, :assistant_text, :turn_done]

  # How long a finished turn sits unanswered before its session is recapped
  # for the sidebar's Working card; see `Loom.Agent.Recap`.
  @recap_after_ms :timer.minutes(10)

  # What the agent says, for `reply_seq`.
  @replies [:assistant_text, :turn_done]

  # ── Public API ──────────────────────────────────────────────────────────

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: via(Keyword.fetch!(opts, :id)))
  end

  @doc """
  Submit a user message.

  Always accepted. Returns `{:ok, :started}` if it begins a turn immediately or
  `{:ok, :queued}` if it is waiting for the current turn — or for the user to
  continue, when the session is `:interrupted`.

  `opts` accepts `:origin` (which device sent it), `:client_msg_id` (so the
  sender can reconcile its optimistic bubble with the broadcast one) and
  `:files` — paths of this session's uploaded attachments, which are appended to
  the message the backend sees but kept out of the one that is displayed.
  """
  def submit(id, text, opts \\ []), do: GenServer.call(via(id), {:submit, text, opts})

  @doc """
  Stop the running turn, like pressing escape.

  Queued messages are kept, not sent. See the moduledoc.
  """
  def interrupt(id), do: GenServer.call(via(id), :interrupt)

  @doc """
  Discard one queued message by its position, oldest first.

  Worth having because a message queued before an interrupt was written for a
  trajectory that no longer exists, and the alternative is forcing the user to
  send it anyway.
  """
  def drop_queued(id, index), do: GenServer.call(via(id), {:drop_queued, index})

  @doc """
  Rename the session.

  Local to loom: the title is a sidebar label, not conversation state, so it is
  never pushed to the backend. That also avoids inventing an answer to "who wins
  when the backend renames it too".
  """
  def rename(id, title), do: GenServer.call(via(id), {:rename, title, "user"})

  @doc """
  Rename it as the `loom-tidy` skill does: a title for telling sessions apart,
  which the next tidying may write again. One the user gave (`rename/2`) it
  never replaces; see `LoomWeb.TidyController`.
  """
  def retitle(id, title), do: GenServer.call(via(id), {:rename, title, "tidy"})

  @doc "Pin the session to the top of the sidebar, or unpin it. Local to loom."
  def pin(id, pinned?), do: GenServer.call(via(id), {:pin, pinned?})

  @doc """
  Archive the session, or bring it back. Local to loom, and only for the
  sidebar: the session lives on as before — restored at boot, read by Dream,
  reachable from the bell. The page keeps archived ones out of its lists until
  the session is active again (`last_active_at` past `archived_at`): writing
  in one brings it back without anyone clearing the mark.
  """
  def archive(id, archived?), do: GenServer.call(via(id), {:archive, archived?})

  @doc """
  Mark the session done, or not: it leaves the sidebar's Working group for
  Recents. Local to loom. The user's next message in it clears the mark.
  """
  def done(id, done?), do: GenServer.call(via(id), {:done, done?})

  @doc """
  Begin a session with what it should know, without a turn: `display` is shown
  as a message (`origin`, "tidy" unless given), and `prompt` goes to the
  backend ahead of the next message, as a project move does. How a merge of
  sessions starts, and a handoff; see `LoomWeb.TidyController`.
  """
  def seed(id, display, prompt, origin \\ "tidy"),
    do: GenServer.call(via(id), {:seed, display, prompt, origin})

  @doc """
  Something the agent should know, sent ahead of its next message and not
  shown: how an employee's chat hears that the boss profile changed.
  """
  def tell(id, text), do: GenServer.call(via(id), {:tell, text})

  @doc "A line from Loom in the conversation, for the user, not the agent."
  def note(id, text), do: GenServer.call(via(id), {:note, text})

  @doc """
  Record that a tidying looked at it now (`tidied_at`), so the next one can
  start with what is new since. Local to loom.
  """
  def tidied(id), do: GenServer.call(via(id), :tidied)

  @doc """
  Record that the user has read the session up to `seq`. Local to loom, and
  only ever moves forward. What the sleep session's unread mark is made of; see
  `Loom.Dream`.
  """
  def seen(id, seq), do: GenServer.call(via(id), {:seen, seq})

  @doc """
  How hard the model thinks from the next turn on: one of
  `Backend.efforts/1` for the session's backend, or nil for the model's own
  default. Local to loom, and given to the backend as each turn starts.
  """
  def set_effort(id, effort), do: GenServer.call(via(id), {:effort, effort})

  @doc """
  The model from the next turn on: an id the session's agent knows, or nil
  for its own default. Local to loom, and given to the backend as each turn
  starts, like `set_effort/2`.
  """
  def set_model(id, model), do: GenServer.call(via(id), {:model, model})

  @doc """
  Move the session into a project (by id), or out of any with nil.

  The conversation carries on where it is, from the project's workspace: the
  backend is relocated there with the project's instructions (see
  `Backend.relocate/3`). Files the session already wrote stay where they are.
  Refused mid-turn, as a running turn cannot change directory.
  """
  def move(id, project_id), do: GenServer.call(via(id), {:move, project_id})

  @doc """
  Keep an incognito session: it joins Recents as an ordinary one in the home
  directory, out of its sandbox, with its conversation and files. Refused
  mid-turn.
  """
  def promote(id), do: GenServer.call(via(id), :promote)

  @doc """
  Attach for replay. Returns the session's metadata plus every event after
  `since_seq` (pass 0 for the whole retained transcript).
  """
  def attach(id, since_seq \\ 0), do: GenServer.call(via(id), {:attach, since_seq})

  @doc "Session metadata without the transcript."
  def info(id), do: GenServer.call(via(id), :info)

  @doc "The `seq` of the message that started the latest turn, or nil."
  def turn_seq(id), do: GenServer.call(via(id), :turn_seq)

  def topic(id), do: "agent:#{id}"
  def via(id), do: {:via, Registry, {Loom.Agent.Registry, id}}

  # ── GenServer ───────────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    # Trap exits so `terminate/2` runs on a supervisor shutdown — that is where
    # the backend is torn down. Without it a stopped session leaves a `claude`
    # process running, or a codex thread holding its writer lock.
    Process.flag(:trap_exit, true)

    id = Keyword.fetch!(opts, :id)

    # State on disk always wins over whatever the caller asked for. Two paths
    # land here and both must reattach rather than start over: the explicit
    # restore at boot, and the supervisor restarting us with the *original* spec
    # after a crash. Treating the second as new would bind a second backend
    # conversation to a session that already has one.
    case Store.read_meta(id) do
      {:ok, meta} ->
        restore(id, meta)

      :error ->
        if Keyword.get(opts, :restore, false) do
          {:stop, {:no_such_session, id}}
        else
          start_fresh(id, opts)
        end
    end
  end

  defp start_fresh(id, opts) do
    with {:ok, backend} <- requested_backend(opts),
         {:ok, project} <- requested_project(opts),
         {:ok, logs} <- Store.open_logs(id) do
      now = System.system_time(:millisecond)

      state = %{
        blank_state(id)
        | backend: backend,
          project_id: project && project.id,
          kind: Keyword.get(opts, :kind),
          employee_id: Keyword.get(opts, :employee),
          model: Keyword.get(opts, :model) || Keyword.get(opts, :kiro_model),
          title: Keyword.get(opts, :title),
          title_by: Keyword.get(opts, :title_by, if(Keyword.get(opts, :title), do: "user")),
          created_at: now,
          last_active_at: now,
          logs: logs,
          outputs: outputs(id)
      }

      employee = {Keyword.get(opts, :employee), Keyword.get(opts, :kind)}

      case Backend.impl(backend).start(id, backend_meta(id, opts, project, employee)) do
        {:ok, handle} ->
          state = %{state | handle: handle}
          persist_meta(state)
          if Keyword.get(opts, :warm, false), do: send(self(), :warm_backend)
          {:ok, expire_if_unused(state, @unused_ms)}

        {:error, reason} ->
          Store.close_logs(logs)
          {:stop, {:backend_failed, reason}}
      end
    else
      {:error, reason} -> {:stop, reason}
    end
  end

  # No default on purpose. The binding is permanent — the conversation lives in
  # the backend's own store, so there is nothing to migrate — and guessing would
  # silently commit the user to the wrong engine.
  defp requested_backend(opts) do
    case Backend.parse(Keyword.get(opts, :backend)) do
      {:ok, backend} -> {:ok, backend}
      :error -> {:error, {:backend_required, Keyword.get(opts, :backend)}}
    end
  end

  # Optional, and permanent like the backend: the project's workspace becomes
  # the session's cwd, which the backend's conversation is tied to.
  defp requested_project(opts) do
    case Keyword.get(opts, :project) do
      nil ->
        {:ok, nil}

      id ->
        case Loom.Projects.get(id) do
          {:ok, project} -> {:ok, project}
          :error -> {:error, {:unknown_project, id}}
        end
    end
  end

  # A session in a project starts in its workspace. One outside any project has
  # no root: the backend falls back to `:workspace` (or the user's home).
  # `:cwd` is a test or operator override.
  # `:model` pins Claude Code's model; a virtual employee's is chosen for it.
  # `:fork_from` starts Claude Code on a copy of another conversation.
  # An incognito session works in a directory of its own, sandboxed.
  defp backend_meta(id, opts, project, employee) do
    incognito? = Keyword.get(opts, :kind) == "incognito"

    cwd =
      Keyword.get(opts, :cwd) || (project && Loom.Projects.workspace(project)) ||
        (incognito? && Loom.Agent.Sandbox.workspace(id)) || nil

    if cwd, do: File.mkdir_p!(cwd)

    %{
      sandbox: incognito?,
      cc_cwd: cwd,
      codex_cwd: cwd,
      cc_model: Keyword.get(opts, :model),
      cc_fork_from: Keyword.get(opts, :fork_from),
      kiro_cwd: cwd,
      kiro_model: Keyword.get(opts, :kiro_model),
      instructions: instructions(id, project, employee)
    }
  end

  # Loom's own, plus the project's when there is one, or a virtual employee's
  # standing orders (`Loom.Employees`). Built again on every restore, so a
  # renamed project or edited instructions are what the backend is told next.
  defp instructions(id, project, {_, "bell"}),
    do: instructions(id, project, nil) <> "\n" <> Loom.Notices.Prompt.system()

  defp instructions(id, project, {_, "incognito"}),
    do: instructions(id, project, nil) <> "\n" <> Loom.Agent.Sandbox.instructions()

  defp instructions(id, project, {employee_id, kind}) when is_binary(employee_id),
    do: instructions(id, project, nil) <> "\n" <> Loom.Employees.Prompt.system(employee_id, kind)

  defp instructions(id, nil, _employee), do: Output.instructions(id)

  defp instructions(id, project, _employee),
    do: Output.instructions(id) <> "\n" <> Loom.Projects.instructions(project)

  # For a move between projects, which an employee's sessions never make.
  defp instructions(id, project), do: instructions(id, project, nil)

  defp project_of(nil), do: nil

  defp project_of(id) do
    case Loom.Projects.get(id) do
      {:ok, project} -> project
      :error -> nil
    end
  end

  # The directory as the session starts. Made first, so the agent can write
  # straight into it; snapshotted so that only what a turn produces is
  # announced — a restart must not re-offer every file made last week.
  defp outputs(id) do
    Output.ensure_dir(id)
    Output.snapshot(id)
  end

  defp restore(id, meta) do
    with {:ok, backend} <- recorded_backend(meta),
         {:ok, logs} <- Store.open_logs(id),
         project = project_of(meta[:project_id]),
         {:ok, handle} <-
           reattach(
             backend,
             id,
             meta
             |> Map.put(:instructions, instructions(id, project, {meta[:employee_id], meta[:kind]}))
             |> Map.put(:sandbox, meta[:kind] == "incognito"),
             logs
           ) do
      transcript = Store.read_events(id, @transcript_limit)

      state = %{
        blank_state(id)
        | backend: backend,
          handle: handle,
          project_id: meta[:project_id],
          pinned: meta[:pinned] == true,
          archived_at: if(is_integer(meta[:archived_at]), do: meta[:archived_at]),
          done_at: if(is_integer(meta[:done_at]), do: meta[:done_at]),
          recap: if(is_binary(meta[:recap]), do: meta[:recap]),
          tidied_at: if(is_integer(meta[:tidied_at]), do: meta[:tidied_at]),
          kind: if(is_binary(meta[:kind]), do: meta[:kind]),
          employee_id: if(is_binary(meta[:employee_id]), do: meta[:employee_id]),
          seen_seq: if(is_integer(meta[:seen_seq]), do: meta[:seen_seq], else: 0),
          reply_seq: reply_seq(meta, transcript),
          effort: if(meta[:effort] in Backend.efforts(backend), do: meta[:effort]),
          model: restored_model(meta),
          notice: restored_notice(meta),
          title: meta[:title],
          title_by: if(meta[:title_by] in ["auto", "user", "tidy"], do: meta[:title_by]),
          created_at: meta[:created_at],
          last_active_at: last_active(transcript) || meta[:created_at],
          transcript: transcript,
          # The log, when it is ahead: a node killed outright had appended
          # events since it last wrote the header.
          seq: max(meta[:seq] || 0, last_seq(transcript)),
          queue: restore_queue(meta[:queue]),
          usage: meta[:usage],
          context_tokens: meta[:context_tokens] || 0,
          context_window: meta[:context_window],
          turns: meta[:turns] || 0,
          logs: logs,
          outputs: outputs(id)
      }

      {adopted?, state} = adopt(state)

      cond do
        # Its process carried on while the node was down, and is ours again:
        # the turn is still this one, and the output it wrote meanwhile is
        # read from where the last node stopped. See `Loom.Agent.Proc`.
        adopted? and meta[:status] == "running" ->
          state = %{state | status: :running}
          announce(state)
          {:ok, state}

        # `:starting` with a queue was still waiting for its project, so no
        # turn was ever started.
        adopted? and meta[:status] == "starting" and state.queue == [] ->
          state = %{state | status: :starting}
          announce(state)
          {:ok, state}

        meta[:status] in ["running", "starting"] ->
          # It was mid-turn when the node stopped, and the turn went with it
          # (a Codex one, or a process that is gone). Say so and wait for the
          # user rather than re-sending a message the backend has already
          # recorded.
          {:ok, interrupted(state, "the session was interrupted by a restart")}

        true ->
          state = %{state | status: restore_status(meta[:status])}
          state = if adopted?, do: schedule_release(state), else: state
          announce(state)
          # Made, never written in, then a restart: what is left of its five
          # minutes, and a minute for the page to come back first.
          left = (state.created_at || 0) + @unused_ms - System.system_time(:millisecond)
          {:ok, expire_if_unused(state, max(left, :timer.minutes(1)))}
      end
    else
      {:error, reason} -> {:stop, {:restore_failed, reason}}
    end
  end

  # A header with no usable `backend` cannot be reattached to anything. Refusing
  # with a reason beats guessing an engine and opening an empty conversation
  # under the old title — and beats crashing, which is what an unmatched `:error`
  # in the `with` above used to do.
  defp recorded_backend(meta) do
    case Backend.parse(Backend.meta_get(meta, :backend)) do
      {:ok, backend} -> {:ok, backend}
      :error -> {:error, {:no_backend_recorded, meta[:backend]}}
    end
  end

  defp reattach(backend, id, meta, logs) do
    case Backend.impl(backend).resume(id, meta) do
      {:ok, handle} ->
        {:ok, handle}

      {:error, reason} ->
        Store.close_logs(logs)
        {:error, reason}
    end
  end

  defp last_seq([%{seq: seq} | _]), do: seq
  defp last_seq([]), do: 0

  defp adopt(state) do
    if Backend.detachable?(state.backend) do
      case Backend.impl(state.backend).adopt(state.handle) do
        {:ok, handle} -> {true, %{state | handle: handle}}
        :error -> {false, state}
      end
    else
      {false, state}
    end
  end

  # After anything that changed the handle: what `adopt/1` would resume from.
  defp checkpoint(%{handle: handle} = state) when handle != nil do
    if Backend.detachable?(state.backend),
      do: %{state | handle: Backend.impl(state.backend).checkpoint(handle)},
      else: state
  end

  defp checkpoint(state), do: state

  defp restore_status("interrupted"), do: :interrupted
  defp restore_status(_other), do: :idle

  defp restore_queue(queue) when is_list(queue), do: Enum.filter(queue, &is_binary/1)
  defp restore_queue(_other), do: []

  defp blank_state(id) do
    %{
      id: id,
      backend: nil,
      # Backend-private. Only `Backend.persist/1` knows what of it to keep.
      handle: nil,
      # The project it is in, if any; see `move/2` and `Loom.Projects`.
      project_id: nil,
      # Shown above everything else in the sidebar.
      pinned: false,
      # When the user archived it, or nil. See `archive/2`.
      archived_at: nil,
      # When the user marked it done, or nil. See `done/2`.
      done_at: nil,
      # Where it got to, in a sentence, once a turn has sat unanswered for a
      # while; nil once the user writes again. See `Loom.Agent.Recap`.
      recap: nil,
      # When a tidying last looked at it, or nil. See `tidied/1`.
      tidied_at: nil,
      # nil for a conversation; "dream" for a project's sleep session, which
      # the sidebar keeps out of its lists. See `Loom.Dream`.
      kind: nil,
      # The virtual employee whose chat or work this is, for "employee_chat"
      # and "employee_work". See `Loom.Employees`.
      employee_id: nil,
      # How far the user has read, for an unread mark. See `seen/2`.
      seen_seq: 0,
      # Where the agent last said something: the sidebar's unread mark is
      # this past `seen_seq`. Not `seq`, which also counts status and queue
      # events nobody reads.
      reply_seq: 0,
      # The thinking level, or nil for the model's default. See `set_effort/2`.
      effort: nil,
      # The model, or nil for the agent's default. See `set_model/2`.
      model: nil,
      # Told to the backend ahead of the next turn's message, once: what changed
      # about its project since the conversation began. See `moved_notice/2`.
      notice: nil,
      # Set while the first message waits to be filed into a project.
      classifying: nil,
      title: nil,
      # Who gave it: "auto" (the first message), "user", "tidy" (`retitle/2`),
      # or nil for a session from before this was kept.
      title_by: nil,
      created_at: nil,
      # When the last message went either way; orders the sidebar. Derived from
      # the transcript on restore rather than stored.
      last_active_at: nil,
      status: :idle,
      # Normalized events for clients, newest first.
      transcript: [],
      seq: 0,
      # Deltas are not persisted, so this restarts at 0 on every restore — which
      # is fine: a client that reattaches also discards its streaming buffers.
      delta_seq: 0,
      truncated_before: nil,
      # User messages waiting for the current turn to end, oldest first. On disk
      # too: a restart must not drain a queue the user deliberately parked.
      queue: [],
      logs: nil,
      # Straight from the backend's own report. No token counting here any more.
      usage: nil,
      context_tokens: 0,
      # The model's context window, as the backend reports it. Codex sends it
      # outright; Claude Code carries it on `modelUsage`.
      context_window: nil,
      turns: 0,
      # Timer that releases the warm backend process once nothing is happening.
      release_timer: nil,
      # `/reload` arrived mid-turn: let the backend go as soon as the turn ends.
      reload_after_turn: false,
      # The output directory as of the last turn's end. See `Loom.Agent.Output`.
      outputs: %{}
    }
  end

  # ── Calls ───────────────────────────────────────────────────────────────

  @impl true
  def handle_call({:submit, text, opts}, _from, state) do
    # A resend of a message that did arrive: on a weak connection the first
    # push can land after the client gave up on it, and the user pressing
    # "resend" must not make the model read it twice. The client matches the
    # `:user` event it already has on `client_msg_id`.
    if delivered?(state, Keyword.get(opts, :client_msg_id)) do
      {:reply, {:ok, :duplicate}, state}
    else
      take(text, opts, state)
    end
  end

  def handle_call(:interrupt, _from, %{status: status} = state)
      when status in [:idle, :interrupted] do
    {:reply, :ok, state}
  end

  def handle_call(:interrupt, _from, state) do
    case Backend.impl(state.backend).interrupt(state.handle) do
      {:ok, handle} ->
        # Whatever the turn wrote before it was stopped is still the user's.
        state = collect_outputs(checkpoint(%{state | handle: handle}))
        {:reply, :ok, interrupted(state, "interrupted")}

      {:error, reason} ->
        # The turn may well be dead anyway, but claiming it stopped when the
        # backend says otherwise would leave the UI lying.
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:drop_queued, index}, _from, state) do
    if index >= 0 and index < length(state.queue) do
      state = Map.update!(state, :queue, &List.delete_at(&1, index))
      {:reply, :ok, persist_and_broadcast_queue(state)}
    else
      {:reply, {:error, :out_of_range}, state}
    end
  end

  def handle_call({:rename, title, by}, _from, state) do
    title = title |> to_string() |> String.trim() |> String.slice(0, @title_limit)

    if title == "" do
      {:reply, {:error, :empty}, state}
    else
      state = emit(%{state | title: title, title_by: by}, :renamed, %{title: title})
      persist_meta(state)
      {:reply, :ok, state}
    end
  end

  def handle_call({:pin, pinned?}, _from, state) do
    state = %{state | pinned: pinned? == true}
    persist_meta(state)
    {:reply, :ok, state}
  end

  def handle_call({:archive, archived?}, _from, state) do
    at = if archived? == true, do: System.system_time(:millisecond)
    state = %{state | archived_at: at}
    persist_meta(state)
    {:reply, :ok, state}
  end

  def handle_call({:done, done?}, _from, state) do
    at = if done? == true, do: System.system_time(:millisecond)
    state = %{state | done_at: at}
    persist_meta(state)
    {:reply, :ok, state}
  end

  def handle_call(:tidied, _from, state) do
    state = %{state | tidied_at: System.system_time(:millisecond)}
    persist_meta(state)
    {:reply, :ok, state}
  end

  def handle_call({:seed, display, prompt, origin}, _from, state) do
    if state.turns > 0 or state.status in [:starting, :running] do
      {:reply, {:error, :busy}, state}
    else
      state =
        emit(state, :user, %{
          text: display,
          files: [],
          origin: origin,
          client_msg_id: nil,
          status: :sent
        })

      state = %{
        state
        | notice: if(state.notice, do: state.notice <> "\n\n" <> prompt, else: prompt)
      }

      persist_meta(state)
      {:reply, :ok, state}
    end
  end

  def handle_call({:note, text}, _from, state) do
    {:reply, :ok, emit(state, :loom_note, %{text: text})}
  end

  def handle_call({:tell, text}, _from, state) do
    state = %{state | notice: if(state.notice, do: state.notice <> "\n\n" <> text, else: text)}
    persist_meta(state)
    {:reply, :ok, state}
  end

  def handle_call({:seen, seq}, _from, state) when is_integer(seq) do
    seen = seq |> min(state.seq) |> max(state.seen_seq)

    if seen == state.seen_seq do
      {:reply, :ok, state}
    else
      state = %{state | seen_seq: seen}
      persist_meta(state)
      {:reply, :ok, state}
    end
  end

  def handle_call({:seen, _seq}, _from, state), do: {:reply, {:error, :not_a_seq}, state}

  def handle_call({:effort, effort}, _from, state) do
    if effort == nil or effort in Backend.efforts(state.backend) do
      state = %{state | effort: effort}
      persist_meta(state)
      {:reply, :ok, state}
    else
      {:reply, {:error, "not a thinking level for this agent"}, state}
    end
  end

  def handle_call({:model, model}, _from, state) do
    if model == nil or model?(model) do
      state = %{state | model: model}
      persist_meta(state)
      {:reply, :ok, state}
    else
      {:reply, {:error, "not a model id"}, state}
    end
  end

  def handle_call({:move, _project_id}, _from, %{status: status} = state)
      when status in [:starting, :running] do
    {:reply, {:error, :busy}, state}
  end

  def handle_call(:promote, _from, %{kind: kind} = state) when kind != "incognito",
    do: {:reply, :ok, state}

  def handle_call(:promote, _from, %{status: status} = state)
      when status in [:starting, :running] do
    {:reply, {:error, :busy}, state}
  end

  def handle_call(:promote, _from, state) do
    state = cancel_release(state)
    handle = Map.put(state.handle, :sandbox, false)
    {:ok, handle} = Backend.impl(state.backend).relocate(handle, nil, instructions(state.id, nil))

    state =
      %{
        state
        | kind: nil,
          handle: handle,
          notice: promoted_notice(Map.get(handle, :cwd), Loom.Agent.Sandbox.workspace(state.id))
      }
      |> emit(:loom_note, %{text: "Saved to Recents"})

    persist_meta(state)
    {:reply, :ok, state}
  end

  def handle_call({:move, _project_id}, _from, %{kind: "incognito"} = state),
    do: {:reply, {:error, :incognito}, state}

  def handle_call({:move, project_id}, _from, state) do
    case requested_project(project: project_id) do
      {:ok, project} -> {:reply, :ok, relocate_to(state, project, false)}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:attach, since_seq}, _from, state) do
    events =
      state.transcript
      |> Enum.take_while(&(&1.seq > since_seq))
      |> Enum.reverse()

    {:reply,
     {:ok,
      %{
        meta: meta(state),
        events: events,
        last_seq: state.seq,
        truncated_before: state.truncated_before
      }}, state}
  end

  def handle_call(:info, _from, state), do: {:reply, meta(state), state}

  def handle_call(:turn_seq, _from, state),
    do: {:reply, Enum.find_value(state.transcript, &(&1.kind == :user && &1.seq)), state}

  defp take(text, opts, state) do
    text = to_string(text)

    # The client sends back paths that `Files.store/2` handed it. Checking them
    # against this session's own directory is the one validation that matters:
    # the model reads whatever path we name. See `Loom.Agent.Files`.
    case Files.verify(state.id, Keyword.get(opts, :files, [])) do
      {:error, reason} ->
        {:reply, {:error, reason}, state}

      {:ok, files} ->
        # An attachment on its own is a message. Dragging in a screenshot and
        # pressing send, with nothing typed, is a normal way to ask about it.
        cond do
          String.trim(text) == "" and files == [] -> {:reply, {:error, :empty}, state}
          reload?(text) and files == [] -> reload(state, text, opts)
          command?(text, "/cron") and files == [] -> list_cron(state, text, opts)
          true -> accept(state, text, files, opts)
        end
    end
  end

  defp delivered?(_state, nil), do: false

  defp delivered?(state, client_msg_id) do
    Enum.any?(state.transcript, fn event ->
      event.kind == :user and event.payload[:client_msg_id] == client_msg_id
    end)
  end

  # ── Backend output ──────────────────────────────────────────────────────

  @impl true
  def handle_info(:warm_backend, %{status: :idle, handle: handle} = state) when handle != nil do
    handle = Backend.set_effort(state.backend, handle, state.effort)
    handle = Backend.set_model(state.backend, handle, state.model)

    case Backend.warm(state.backend, handle) do
      {:ok, handle} ->
        {:noreply, schedule_release(%{state | handle: handle})}

      {:error, reason} ->
        Logger.warning("Session #{state.id}: could not warm the backend: #{inspect(reason)}")
        {:noreply, state}
    end
  end

  def handle_info(:warm_backend, state), do: {:noreply, state}

  # Five minutes after it was made, still empty: deleted, unless something is
  # typed and not yet sent (the draft), which gives it another five.
  def handle_info(:expire_unused, state) do
    cond do
      not unused?(state) ->
        {:noreply, state}

      String.trim(Loom.Agent.Draft.read(state.id).text) != "" ->
        {:noreply, expire_if_unused(state, @unused_ms)}

      true ->
        Logger.info("Session #{state.id}: deleted, nothing written in it for five minutes")
        id = state.id
        Task.Supervisor.start_child(Loom.Agent.TaskSupervisor, fn -> Loom.Agent.delete_session(id) end)
        {:noreply, state}
    end
  end

  def handle_info(:release_backend, %{status: status} = state)
      when status in [:starting, :running] do
    # A turn started between the timer firing and this landing. Leave it alone
    # and try again when that turn ends.
    {:noreply, %{state | release_timer: nil}}
  end

  def handle_info(:release_backend, state) do
    {:noreply, release_backend(state)}
  end

  def handle_info(:reload_backend, %{status: status} = state)
      when status in [:starting, :running] do
    {:noreply, %{state | reload_after_turn: true}}
  end

  def handle_info(:reload_backend, state) do
    {:noreply, release_backend(state)}
  end

  # The project's name or instructions changed. Mid-turn, the new text goes
  # into the handle and Claude Code lets its process go once the turn ends, as
  # `/reload` would; Codex reads it at its next resume.
  def handle_info(:refresh_instructions, %{handle: handle, status: status} = state)
      when is_map(handle) and status in [:starting, :running] do
    project = project_of(state.project_id)
    text = instructions(state.id, project)

    state = %{
      state
      | handle: Map.replace(handle, :instructions, text),
        notice: edited_notice(project)
    }

    write_meta(state)
    handle_info(:reload_backend, state)
  end

  # Between turns, the same as a move to where it already is.
  def handle_info(:refresh_instructions, %{handle: handle} = state) when is_map(handle) do
    project = project_of(state.project_id)
    cwd = project && Loom.Projects.workspace(project)
    state = cancel_release(state)

    {:ok, handle} =
      Backend.impl(state.backend).relocate(handle, cwd, instructions(state.id, project))

    state = %{state | handle: handle, notice: edited_notice(project)}
    write_meta(state)
    {:noreply, state}
  end

  def handle_info(:refresh_instructions, state), do: {:noreply, state}

  def handle_info({:EXIT, _from, _reason}, state), do: {:noreply, state}

  # The first message's project, or the timeout: whichever comes first starts
  # the turn. The other finds the token gone and is dropped.
  def handle_info({:classified, token, project_id}, %{classifying: token} = state) do
    state = %{state | classifying: nil}

    state =
      case project_of(project_id) do
        nil -> state
        project -> relocate_to(state, project, true)
      end

    # Interrupted while it waited: the message stays parked, like any other.
    {:noreply, if(state.status == :starting, do: drain(state), else: state)}
  end

  def handle_info({:classified, _token, _project_id}, state), do: {:noreply, state}

  # Recapped only if nothing has happened since the turn ended (`seq` is
  # where it was) and the user has not set it aside as done.
  def handle_info({:recap, seq}, %{seq: seq, status: :idle, done_at: nil} = state) do
    session = self()
    module = recapper()
    messages = recap_messages(state.transcript)

    Task.Supervisor.start_child(Loom.Agent.TaskSupervisor, fn ->
      send(session, {:recapped, seq, module.recap(messages)})
    end)

    {:noreply, state}
  end

  def handle_info({:recap, _seq}, state), do: {:noreply, state}

  def handle_info({:recapped, seq, recap}, %{seq: seq} = state) when is_binary(recap) do
    state = %{state | recap: recap}
    persist_meta(state)
    {:noreply, state}
  end

  def handle_info({:recapped, _seq, _recap}, state), do: {:noreply, state}

  def handle_info(message, state) do
    case Backend.impl(state.backend).decode(state.handle, message) do
      {:ok, handle, out} ->
        # Saved only once every event it produced is on disk: a node killed
        # in between then reads that output again rather than losing it.
        {:noreply, checkpoint(consume(%{state | handle: handle}, out))}

      :ignore ->
        Logger.debug("Loom.Agent.Session #{state.id} ignoring #{inspect(message)}")
        {:noreply, state}
    end
  end

  @impl true
  def terminate(_reason, state) do
    if detach?(state) do
      # The node is stopping, not the session: the process carries on — a
      # turn under way included — and the next node adopts it. So the status
      # stays what it is; `restore/2` reads it.
      Backend.impl(state.backend).detach(state.handle)
      write_meta(state)
    else
      # Take the backend down with us: a `claude` process left running would
      # keep editing files for a conversation nobody is watching, and a codex
      # thread left claimed cannot be reopened.
      if state.handle, do: Backend.impl(state.backend).stop(state.handle)

      # Record that we are not mid-turn, so a restart does not report a
      # deliberately stopped session as interrupted. A hard crash skips this
      # and leaves `status` as it was — which is what makes the restart notice.
      write_meta(%{state | status: settled_status(state)})
    end

    Store.close_logs(state.logs)
    :ok
  catch
    _, _ -> :ok
  end

  # A session being deleted is stopped while the node runs on; one the node
  # takes down with it is not.
  defp detach?(state) do
    state.handle != nil and match?({:stopping, _}, :init.get_status()) and
      Backend.detachable?(state.backend)
  end

  # An interrupted session stays interrupted across a restart: its queue is
  # parked and the user has not continued yet.
  defp settled_status(%{status: :interrupted}), do: :interrupted
  defp settled_status(_state), do: :idle

  # ── The turn ────────────────────────────────────────────────────────────

  # Loom's own command, never sent to a backend. Only the whole message counts,
  # so a sentence that mentions /reload is still a sentence.
  defp reload?(text), do: command?(text, "/reload")

  defp command?(text, command), do: String.trim(text) == command

  # Shown like any message (the client is waiting for its `:user` event to
  # replace the optimistic bubble), then answered by loom itself. The backend
  # never sees it, so the turn state and the queue are untouched.
  defp reload(state, text, opts) do
    Loom.Agent.reload_backends()
    state = state |> echo(text, opts) |> emit(:reload_requested, %{})
    {:reply, {:ok, :reloaded}, state}
  end

  # `/cron` lists every scheduled job, in whichever session it is typed. Jobs
  # are made by an agent over `bin/loom rpc`; see `Loom.Cron`.
  defp list_cron(state, text, opts) do
    jobs =
      try do
        Loom.Cron.list()
      catch
        :exit, _ -> []
      end

    state = state |> echo(text, opts) |> emit(:cron_jobs, %{jobs: jobs})
    {:reply, {:ok, :listed}, state}
  end

  defp echo(state, text, opts) do
    emit(state, :user, %{
      text: text,
      files: [],
      origin: Keyword.get(opts, :origin, "unknown"),
      client_msg_id: Keyword.get(opts, :client_msg_id),
      status: :sent
    })
  end

  # A submitted message, once its attachments have been vouched for.
  defp accept(state, text, files, opts) do
    state =
      state
      |> maybe_title(if String.trim(text) == "", do: Files.title(files), else: text)
      # Writing in it again means it is not done after all, and its recap
      # is out of date.
      |> Map.merge(%{done_at: nil, recap: nil})
      |> emit(:user, %{
        text: text,
        # Structured rather than folded into `text`, so a bubble can show
        # `shot.png` as a chip instead of an absolute path.
        files: files,
        origin: Keyword.get(opts, :origin, "unknown"),
        client_msg_id: Keyword.get(opts, :client_msg_id),
        status: :sent
      })

    # What the backend receives differs from what is displayed: it needs the
    # paths, the user does not want to read them. A caller with a long prompt
    # of its own (`Loom.Dream`) shows a line and sends the whole of it.
    message = Keyword.get(opts, :prompt) || Files.prompt(text, files)

    cond do
      state.classifying != nil ->
        # No turn yet to steer into: it goes out with the first message.
        state = Map.update!(state, :queue, &(&1 ++ [message]))
        {:reply, {:ok, :queued}, persist_and_broadcast_queue(state)}

      state.status in [:starting, :running] ->
        # Hand it straight over: both backends inject it into the turn that is
        # running. Queuing it would waste the one thing that makes typing
        # mid-turn useful. It only joins the queue if steering is refused.
        steer(state, message)

      true ->
        # Covers `:interrupted` as well as `:idle`: typing is how an
        # interrupted session continues, and anything parked goes out merged
        # with this message.
        state = Map.update!(state, :queue, &(&1 ++ [message]))

        if classify?(state, text),
          do: {:reply, {:ok, :started}, classify(state, text)},
          else: {:reply, {:ok, :started}, drain(state)}
    end
  end

  # A session's first message, outside any project, while there are projects
  # it could belong to: asked which, before the turn starts, so that the
  # session begins in the right place. See `Loom.Projects.Classifier`.
  defp classify?(state, text) do
    state.project_id == nil and state.kind == nil and state.turns == 0 and
      String.trim(text) != "" and
      classifier() != nil and Loom.Projects.list() != []
  end

  # Only the user's own conversations are in Working.
  defp schedule_recap(%{kind: nil} = state) do
    if recapper(), do: Process.send_after(self(), {:recap, state.seq}, @recap_after_ms)
    state
  end

  defp schedule_recap(state), do: state

  defp recapper, do: Application.get_env(:loom, :recap, Loom.Agent.Recap)

  # The conversation, oldest first, as the recap reads it.
  defp recap_messages(transcript) do
    transcript
    |> Enum.flat_map(fn
      %{kind: :user, payload: %{text: text}} when is_binary(text) -> [{"user", text}]
      %{kind: :assistant_text, payload: %{text: text}} when is_binary(text) -> [{"agent", text}]
      _ -> []
    end)
    |> Enum.reverse()
  end

  defp classifier,
    do:
      Keyword.get(
        Application.get_env(:loom, Loom.Projects, []),
        :classifier,
        Loom.Projects.Classifier
      )

  defp classify(state, text) do
    token = make_ref()
    session = self()
    module = classifier()
    projects = Loom.Projects.list()

    Task.Supervisor.start_child(Loom.Agent.TaskSupervisor, fn ->
      send(session, {:classified, token, module.classify(text, projects)})
    end)

    Process.send_after(self(), {:classified, token, nil}, @classify_timeout_ms)
    set_status(%{state | classifying: token}, :starting)
  end

  # Into `project`, or out of any with nil: the backend carries on from the
  # new cwd, is told what changed ahead of its next message, and the transcript
  # says where the session went — and whether it was Loom that put it there.
  defp relocate_to(state, project, auto?) do
    cwd = project && Loom.Projects.workspace(project)
    if cwd, do: File.mkdir_p!(cwd)
    state = cancel_release(state)

    {:ok, handle} =
      Backend.impl(state.backend).relocate(state.handle, cwd, instructions(state.id, project))

    state =
      %{
        state
        | handle: handle,
          project_id: project && project.id,
          notice: moved_notice(project, Map.get(handle, :cwd))
      }
      |> emit(:project_moved, %{
        project_id: project && project.id,
        name: project && project.name,
        auto: auto?
      })

    persist_meta(state)
    state
  end

  defp consume(state, out), do: Enum.reduce(out, state, &apply_out(&2, &1))

  defp apply_out(state, {:delta, delta}) do
    # Not persisted — deltas are a typewriter effect and the authoritative event
    # follows under the same `block_id`. But numbered, so a client can drop one
    # it has already applied; see the moduledoc.
    delta_seq = state.delta_seq + 1
    delta = Map.put(delta, :delta_seq, delta_seq)

    Phoenix.PubSub.broadcast(Loom.PubSub, topic(state.id), {:agent_delta, state.id, delta})
    %{state | delta_seq: delta_seq}
  end

  defp apply_out(state, {:event, :status, %{status: :running}}) do
    set_status(state, :running)
  end

  defp apply_out(state, {:event, :turn_done, payload}) do
    state
    |> record_usage(payload)
    |> collect_outputs()
    |> emit(
      :turn_done,
      Map.take(payload, [:stop_reason, :context_tokens, :context_window, :model, :expected])
    )
    |> finish_turn()
  end

  defp apply_out(state, {:event, :turn_failed, payload}) do
    state
    |> collect_outputs()
    |> emit(:error, %{message: failure_message(payload)})
    |> finish_turn()
  end

  # What a turn cost, for budgets (`Loom.Employees`): told, not kept.
  defp apply_out(state, {:event, :cost, %{usd: usd}}) do
    Phoenix.PubSub.broadcast(
      Loom.PubSub,
      Loom.Agent.turns_topic(),
      {:turn_cost, state.id, usd}
    )

    state
  end

  defp apply_out(state, {:event, kind, payload}), do: emit(state, kind, payload)

  defp failure_message(%{reason: reason}) when is_binary(reason), do: reason
  defp failure_message(payload), do: inspect(payload)

  # A finished turn drains the queue. This is the only place a turn starts on
  # its own, and the reason `:interrupted` has to be a distinct status: it must
  # not reach here.
  defp finish_turn(state) do
    state = %{state | turns: state.turns + 1}

    if state.queue == [] do
      state |> set_status(:idle) |> announce_turn_end() |> schedule_release() |> schedule_recap()
    else
      drain(state)
    end
  end

  # Hand a message to the turn that is running. On failure it goes into the
  # queue instead — Codex refuses to steer a turn that ended under us, and a
  # message delivered late is better than one dropped.
  defp steer(state, text) do
    case Backend.impl(state.backend).steer(state.handle, text) do
      {:ok, handle} ->
        {:reply, {:ok, :steered}, cancel_release(%{state | handle: handle})}

      {:error, _reason} ->
        state = Map.update!(state, :queue, &(&1 ++ [text]))
        {:reply, {:ok, :queued}, persist_and_broadcast_queue(state)}
    end
  end

  defp drain(%{queue: []} = state), do: set_status(state, :idle)

  defp drain(state) do
    # The whole queue becomes one message. See the moduledoc.
    queue = state.queue
    text = with_notice(state.notice, Enum.join(queue, "\n\n"))

    state = cancel_release(state)
    handle = Backend.set_effort(state.backend, state.handle, state.effort)
    handle = Backend.set_model(state.backend, handle, state.model)

    case Backend.impl(state.backend).run_turn(handle, text) do
      {:ok, handle} ->
        # `:starting` rather than `:running`: Claude Code takes seconds to boot
        # before it says anything, and a UI with no state for that gap looks
        # hung. The backend's own status event moves us to `:running`.
        set_status(checkpoint(%{state | handle: handle, queue: [], notice: nil}), :starting)

      {:error, reason} ->
        # The queue is cleared only on success. Dropping the user's message
        # because the backend hiccuped loses work they cannot get back, and
        # leaving it queued means the next submit carries it along.
        state
        |> emit(:error, %{message: "could not start the turn: #{inspect(reason)}"})
        |> persist_and_broadcast_queue()
        |> set_status(:idle)
    end
  end

  defp interrupted(state, message) do
    state
    |> emit(:status, %{status: :interrupted, queued: length(state.queue), message: message})
    |> set_status(:interrupted)
    |> schedule_release()
  end

  # For notifications (`Loom.Push`). The reply is the turn's last text, found by
  # reading back to the message that started it; an error after it wins, since
  # that is how the turn actually ended.
  defp announce_turn_end(state) do
    outcome =
      Enum.find_value(state.transcript, {:ok, nil}, fn
        %{kind: :error, payload: %{message: message}} -> {:error, message}
        %{kind: :assistant_text, payload: %{text: text}} -> {:ok, text}
        %{kind: :user} -> {:ok, nil}
        _ -> nil
      end)

    Phoenix.PubSub.broadcast(
      Loom.PubSub,
      Loom.Agent.turns_topic(),
      {:turn_ended, state.id, %{title: state.title, outcome: outcome, kind: state.kind}}
    )

    state
  end

  # Announce what the turn left in the output directory. Before the turn's own
  # closing event, so the card sits with the reply that made the files.
  defp collect_outputs(state) do
    now = Output.snapshot(state.id)

    case Output.changes(state.outputs, now) do
      %{files: []} -> %{state | outputs: now}
      payload -> emit(%{state | outputs: now}, :output_files, payload)
    end
  end

  # ── Keeping the backend warm ────────────────────────────────────────────

  # A chat the user opened and never wrote in: nothing sent, nothing seeded,
  # not named or pinned. Only the user's own kinds; employees, tasks, Dream
  # and the bell make theirs on purpose.
  defp unused?(state) do
    state.kind in [nil, "incognito"] and state.employee_id == nil and state.turns == 0 and
      state.notice == nil and state.title_by != "user" and not state.pinned and
      state.status == :idle and not Enum.any?(state.transcript, &(&1.kind == :user))
  end

  defp expire_if_unused(state, after_ms) do
    if unused?(state), do: Process.send_after(self(), :expire_unused, after_ms)
    state
  end

  defp cancel_release(%{release_timer: nil} = state), do: state

  defp cancel_release(state) do
    Process.cancel_timer(state.release_timer)
    %{state | release_timer: nil}
  end

  defp release_backend(%{handle: nil} = state), do: %{state | reload_after_turn: false}

  defp release_backend(state) do
    state = cancel_release(state)
    {:ok, handle} = Backend.impl(state.backend).release(state.handle)
    %{state | handle: handle, reload_after_turn: false}
  end

  defp schedule_release(%{reload_after_turn: true} = state), do: release_backend(state)

  defp schedule_release(state) do
    state = cancel_release(state)
    %{state | release_timer: Process.send_after(self(), :release_backend, @idle_release_ms)}
  end

  defp record_usage(state, payload) do
    %{
      state
      | usage: payload[:usage] || state.usage,
        context_tokens: payload[:context_tokens] || state.context_tokens,
        context_window: payload[:context_window] || state.context_window
    }
  end

  # ── Events ──────────────────────────────────────────────────────────────

  defp emit(state, kind, payload) do
    seq = state.seq + 1

    event = %{
      seq: seq,
      at: System.system_time(:millisecond),
      kind: kind,
      payload: payload
    }

    Store.append_event(state.logs, event)
    Phoenix.PubSub.broadcast(Loom.PubSub, topic(state.id), {:agent_event, state.id, event})

    {transcript, truncated_before} = retain([event | state.transcript], state.truncated_before)
    state = %{state | seq: seq, transcript: transcript, truncated_before: truncated_before}
    state = if kind in @replies, do: %{state | reply_seq: seq}, else: state

    cond do
      kind not in @activity ->
        state

      # A message moves the session to the top of the list at once. Turn ends
      # change the status and are announced by that anyway.
      kind == :user ->
        state = %{state | last_active_at: event.at}
        announce(state)
        state

      true ->
        %{state | last_active_at: event.at}
    end
  end

  # The header's, or a reply in the log past it: a node killed outright left
  # the header behind. A session from before the mark has none in its header,
  # so its old replies are not all marked unread at once.
  defp reply_seq(meta, transcript) do
    after_header = meta[:seq] || 0

    logged =
      Enum.find_value(transcript, 0, fn event ->
        event.kind in @replies && event.seq > after_header && event.seq
      end)

    max(if(is_integer(meta[:reply_seq]), do: meta[:reply_seq], else: 0), logged)
  end

  defp last_active(transcript) do
    Enum.find_value(transcript, fn event -> event.kind in @activity && event.at end)
  end

  defp retain(transcript, truncated_before) do
    if length(transcript) > @transcript_limit do
      kept = Enum.take(transcript, @transcript_limit)
      oldest = List.last(kept)
      {kept, max(truncated_before || 0, oldest.seq - 1)}
    else
      {transcript, truncated_before}
    end
  end

  # Every transition is broadcast and written to the header.
  #
  # The broadcast is what lets a second device show the right thing: a phone
  # that joins mid-turn learns the status from the snapshot, but from then on
  # `starting → running → idle` only reaches it as events. The header write is
  # what a restart reads to decide whether the session was mid-turn.
  defp set_status(state, status) do
    if state.status == status do
      state
    else
      state =
        emit(%{state | status: status}, :status, %{status: status, queued: length(state.queue)})

      persist_meta(state)
      state
    end
  end

  # Queue changes are not status changes, but clients still have to see them —
  # a queued bubble has to stop looking pending once it goes out.
  defp persist_and_broadcast_queue(state) do
    state = emit(state, :queue, %{queued: length(state.queue), messages: state.queue})
    persist_meta(state)
    state
  end

  # Every header write is also a sidebar update: the header is exactly what
  # the session list shows, so the two change together. See `announce/1`.
  defp persist_meta(state) do
    write_meta(state)
    announce(state)
  end

  # Not from `terminate/2`, which only writes. A session going away is announced
  # by `Loom.Agent.stop_session/1` as a removal, and a summary sent on the way
  # out would race it.
  defp announce(state) do
    Phoenix.PubSub.broadcast(
      Loom.PubSub,
      Loom.Agent.lobby_topic(),
      {:agent_summary, meta(state)}
    )
  end

  # The start of the last reply, as a line of text: what a Working card on the
  # phone shows, to recall where the session got to.
  defp preview(transcript) do
    Enum.find_value(transcript, fn
      %{kind: :assistant_text, payload: %{text: text}} when is_binary(text) ->
        text =
          text
          |> String.replace(~r/<!--.*?(-->|$)/su, " ")
          |> String.replace(~r/\|?(\s*:?-{3,}:?\s*\|)+/u, " ")
          |> String.replace(~r/\[([^\]]*)\]\([^)]*\)/u, "\\1")
          |> String.replace(~r/[*`~]+/u, "")
          |> String.replace(~r/[#>|]+/u, " ")
          |> String.replace(~r/\s+/u, " ")
          |> String.trim()

        if text != "", do: String.slice(text, 0, 160)

      _ ->
        nil
    end)
  end

  defp write_meta(state) do
    base = %{
      id: state.id,
      backend: state.backend,
      project_id: state.project_id,
      pinned: state.pinned,
      archived_at: state.archived_at,
      done_at: state.done_at,
      recap: state.recap,
      tidied_at: state.tidied_at,
      kind: state.kind,
      employee_id: state.employee_id,
      seen_seq: state.seen_seq,
      reply_seq: state.reply_seq,
      effort: state.effort,
      model: state.model,
      notice: state.notice,
      # Pending in `notice` until sent, which counts as told.
      replies_told: true,
      title: state.title,
      title_by: state.title_by,
      created_at: state.created_at,
      status: state.status,
      seq: state.seq,
      queue: state.queue,
      usage: state.usage,
      context_tokens: state.context_tokens,
      context_window: state.context_window,
      turns: state.turns
    }

    # The handle is opaque, so the backend decides what identifies its
    # conversation. Whatever it returns comes straight back on resume.
    backend_fields =
      if state.handle, do: Backend.impl(state.backend).persist(state.handle), else: %{}

    Store.write_meta(state.id, Map.merge(base, backend_fields))
  end

  # ── Helpers ─────────────────────────────────────────────────────────────

  # What a conversation already under way is told when its project changes.
  # A system prompt cannot carry it: Claude Code keeps the one a conversation
  # started with across `--resume` and ignores a new `--append-system-prompt`
  # (measured, 2.1.312). So it goes ahead of the next message the backend
  # gets, marked as Loom's, and is not shown in the transcript.
  defp promoted_notice(cwd, old) do
    "[Note from Loom, not written by the user: the user kept this incognito chat. " <>
      "It is an ordinary session now, with no sandbox and no incognito rules; your " <>
      "working directory is now #{cwd}. Files made so far stay in #{old}.]"
  end

  defp moved_notice(nil, cwd) do
    "[Note from Loom, not written by the user: this conversation is no longer in a " <>
      "Loom project. Your working directory is now #{cwd}. Earlier project " <>
      "instructions no longer apply.]"
  end

  defp moved_notice(project, _cwd) do
    "[Note from Loom, not written by the user: this conversation has been moved " <>
      "into a Loom project, and your working directory is now its workspace.]\n\n" <>
      Loom.Projects.instructions(project)
  end

  defp edited_notice(nil), do: nil

  defp edited_notice(project) do
    "[Note from Loom, not written by the user: the project's details have changed. " <>
      "They now read as follows, and replace what you were told before.]\n\n" <>
      Loom.Projects.instructions(project)
  end

  # One saved before the session kept its own: the backend's pinned model
  # (a virtual employee's), so the first turn does not drop it.
  defp restored_model(meta) do
    model =
      if Map.has_key?(meta, :model),
        do: meta[:model],
        else: Backend.meta_get(meta, :cc_model) || Backend.meta_get(meta, :kiro_model)

    if model?(model), do: model
  end

  # Passed to the agent as a flag's value, so never one that reads as a flag.
  defp model?(model),
    do: is_binary(model) and model =~ ~r/^[A-Za-z0-9][A-Za-z0-9._:\/\[\]-]{0,99}$/

  # A conversation that began before suggested replies existed was never told
  # about them, and its system prompt cannot be changed (see above). Told once,
  # ahead of its next message; `replies_told` keeps it to once. One with no
  # turns yet will be told by its system prompt.
  defp restored_notice(meta) do
    notice = if is_binary(meta[:notice]), do: meta[:notice]

    if meta[:replies_told] == true or (meta[:turns] || 0) == 0 do
      notice
    else
      replies =
        "[Note from Loom, not written by the user: something new applies from now on.]\n\n" <>
          Output.replies_instructions()

      if notice, do: notice <> "\n\n" <> replies, else: replies
    end
  end

  defp with_notice(nil, text), do: text
  defp with_notice(notice, text), do: notice <> "\n\n---\n\n" <> text

  # Name the session after its first message. Without this a session list shows
  # nothing but opaque ids, and the alternative — joining every session to read
  # its transcript — defeats the point of a cheap header read.
  defp maybe_title(%{title: nil} = state, text) when is_binary(text) do
    title =
      text
      |> String.split("\n", parts: 2)
      |> List.first()
      |> String.trim()
      |> String.slice(0, @title_limit)

    if title == "", do: state, else: %{state | title: title, title_by: "auto"}
  end

  defp maybe_title(state, _text), do: state

  defp meta(state) do
    %{
      id: state.id,
      backend: state.backend,
      backend_label: Backend.label(state.backend),
      project_id: state.project_id,
      pinned: state.pinned,
      archived_at: state.archived_at,
      done_at: state.done_at,
      recap: state.recap,
      tidied_at: state.tidied_at,
      kind: state.kind,
      employee_id: state.employee_id,
      seen_seq: state.seen_seq,
      reply_seq: state.reply_seq,
      effort: state.effort,
      model: state.model,
      title: state.title,
      title_by: state.title_by,
      created_at: state.created_at,
      last_active_at: state.last_active_at,
      preview: preview(state.transcript),
      status: state.status,
      queued: length(state.queue),
      queue: state.queue,
      usage: state.usage,
      context_tokens: state.context_tokens,
      context_window: state.context_window,
      turns: state.turns,
      # Orders summaries: the lobby can deliver one that is older than the
      # list a client just joined with, and `seq` says which is newer.
      seq: state.seq
    }
  end
end
