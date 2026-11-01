defmodule Loom.Dream do
  @moduledoc """
  Sleep: a pass over Claude Code's memory, by night, after the brain's.

  Claude Code keeps a memory directory per working directory, so each project
  has its own, and every session outside a project shares the home one. Each of
  those is a *scope* here: a project id, or `"home"`. Claude Code's own
  consolidation ("auto-dream") is gated by a server-side flag that a Bedrock
  login never receives (measured, 2.1.312), so Loom does it instead, and does
  more: replays every session since the last night, scores what mattered,
  archives what went unused, looks for patterns across sessions, and asks
  before anything it should not decide alone. The prompt is `Loom.Dream.Prompt`.

  - **One hidden session per scope does the sleeping.** An ordinary Claude Code
    session with `kind: "dream"`, in the scope's working directory so it gets
    the same memory directory and Claude Code's own memory instructions. The
    sidebar keeps it out of its lists and opens it from the moon. Each night is
    one turn: the report is its reply, and the user can answer in it.
  - **When:** in the night window (03:00–06:00 by default, in the user's
    wall-clock time), at least 12 hours after the last sleep, with at least
    one session in the scope active since then, none of them mid-turn, and none
    touched for 30 minutes. One scope at a time. Or now, by hand.
  - **Undoable.** The memory directory is a git repository, committed before
    each sleep and after each turn of the sleep session. Undo restores the
    directory as it was before the last sleep, as a new commit.
  - **Truth is `~/.loom/dream.json`**: settings, and when each scope last slept.
  """
  use GenServer

  require Logger

  alias Loom.Agent
  alias Loom.Dream.Prompt

  @name __MODULE__
  @tick :timer.minutes(10)
  @quiet_ms :timer.minutes(30)
  @gap_ms :timer.hours(12)
  @runs_kept 30
  @default_window [3, 6]
  @default_offset 480

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, @name))
  end

  @doc "Every scope that has slept or could: the home one and each project's."
  def list(server \\ @name), do: GenServer.call(server, :list)

  @doc "One scope's status: settings, last sleep, what it would go over now."
  def status(scope, server \\ @name), do: GenServer.call(server, {:status, scope})

  @doc "The scope's sleep session, made if there is none yet. `{:ok, id}`."
  def open(scope, server \\ @name), do: GenServer.call(server, {:open, scope}, 30_000)

  @doc "Sleep now, whatever the hour. `{:ok, status}` or `{:error, reason}`."
  def run(scope, server \\ @name), do: GenServer.call(server, {:run, scope}, 30_000)

  @doc """
  Change `enabled` for a scope, or, for every scope, `window` (`[start, end]`,
  local hours) and `utc_offset` (minutes east of UTC).
  """
  def update(scope, attrs, server \\ @name), do: GenServer.call(server, {:update, scope, attrs})

  @doc "Put the memory back as it was before the last sleep."
  def undo(scope, server \\ @name), do: GenServer.call(server, {:undo, scope}, 30_000)

  @doc "Where the jobs are kept."
  def path, do: Application.get_env(:loom, __MODULE__, [])[:path] || default_path()
  defp default_path, do: Path.join(Loom.Agent.Store.home(), "dream.json")

  # ── Where things are ────────────────────────────────────────────────────

  @doc "The working directory of a scope's sessions."
  def cwd("home"),
    do: Application.get_env(:loom, Loom.Agent, [])[:workspace] || System.user_home!()

  def cwd(project_id) do
    case Loom.Projects.get(project_id) do
      {:ok, project} -> Loom.Projects.workspace(project)
      :error -> nil
    end
  end

  @doc """
  Claude Code's memory directory for a working directory:
  `~/.claude/projects/<cwd with every non-alphanumeric as ->/memory`.
  """
  def memory_dir(scope) do
    case cwd(scope) do
      nil -> nil
      cwd -> Path.join([claude_dir(), "projects", slug(cwd), "memory"])
    end
  end

  @doc false
  def slug(cwd), do: String.replace(Path.expand(cwd), ~r/[^a-zA-Z0-9]/, "-")

  defp claude_dir, do: System.get_env("CLAUDE_CONFIG_DIR") || Path.expand("~/.claude")

  @doc """
  The memory files of a scope, index first: `%{file:, name:, description:,
  type:, mtime:, archived:}`, from each file's frontmatter.
  """
  def memories(scope) do
    case memory_dir(scope) do
      nil ->
        []

      dir ->
        top = Path.wildcard(Path.join(dir, "*.md"))
        archived = Path.wildcard(Path.join([dir, "archive", "*.md"]))

        (Enum.map(top, &memory(&1, false)) ++ Enum.map(archived, &memory(&1, true)))
        |> Enum.reject(&is_nil/1)
        |> Enum.sort_by(&{&1.file != "MEMORY.md", &1.archived, -&1.mtime})
    end
  end

  defp memory(path, archived?) do
    with {:ok, body} <- File.read(path),
         {:ok, %{mtime: mtime}} <- File.stat(path, time: :posix) do
      front = frontmatter(body)

      %{
        file: if(archived?, do: "archive/" <> Path.basename(path), else: Path.basename(path)),
        name: front["name"] || Path.rootname(Path.basename(path)),
        description: front["description"],
        type: front["type"],
        mtime: mtime * 1000,
        archived: archived?
      }
    else
      _ -> nil
    end
  end

  # Only the keys that matter, at any depth (`type` sits under `metadata`).
  # Not a YAML parser: a value is the rest of its line, quotes trimmed.
  defp frontmatter("---\n" <> rest) do
    case String.split(rest, "\n---", parts: 2) do
      [head, _] ->
        for line <- String.split(head, "\n"),
            [_, key, value] <- [Regex.run(~r/^\s*(name|description|type):\s*(.*)$/, line)],
            into: %{},
            do: {key, value |> String.trim() |> String.trim("\"")}

      _ ->
        %{}
    end
  end

  defp frontmatter(_body), do: %{}

  # ── GenServer ───────────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    path = Keyword.get(opts, :path, path())
    Phoenix.PubSub.subscribe(Loom.PubSub, Agent.turns_topic())
    tick = Keyword.get(opts, :tick) || Application.get_env(:loom, __MODULE__, [])[:tick] || @tick
    state = Map.merge(%{path: path, timer: nil, tick: tick}, load(path))
    {:ok, arm(state)}
  end

  @impl true
  def handle_call(:list, _from, state) do
    scopes = ["home" | Enum.map(Loom.Projects.list(), & &1.id)]
    {:reply, Enum.map(scopes, &view(state, &1)), state}
  end

  def handle_call({:status, scope}, _from, state) do
    case known(scope) do
      :ok -> {:reply, {:ok, view(state, scope)}, state}
      error -> {:reply, error, state}
    end
  end

  def handle_call({:open, scope}, _from, state) do
    with :ok <- known(scope),
         {:ok, state} <- set_aside(state, scope),
         {:ok, id, state} <- ensure_session(state, scope) do
      {:reply, {:ok, id}, save(state)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:run, scope}, _from, state) do
    with :ok <- known(scope),
         {:ok, state} <- sleep(state, scope) do
      {:reply, {:ok, view(state, scope)}, state}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:update, scope, attrs}, _from, state) do
    attrs = Map.new(attrs, fn {k, v} -> {to_string(k), v} end)

    with :ok <- known(scope),
         {:ok, state} <- change(state, scope, attrs) do
      state = save(state)
      {:reply, {:ok, view(state, scope)}, state}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:undo, scope}, _from, state) do
    with :ok <- known(scope),
         :ok <- not_sleeping(state, scope),
         {:ok, state} <- restore(state, scope) do
      {:reply, {:ok, view(state, scope)}, state}
    else
      error -> {:reply, error, state}
    end
  end

  @impl true
  def handle_info(:tick, state) do
    sessions = Agent.list_sessions()
    now = System.system_time(:millisecond)
    candidates = ["home" | Enum.map(Loom.Projects.list(), & &1.id)]

    state =
      case Enum.find(candidates, &due?(state, &1, sessions, now)) do
        nil ->
          state

        scope ->
          case sleep(state, scope) do
            {:ok, state} ->
              state

            {:error, reason} ->
              Logger.warning("Loom.Dream: #{scope} did not sleep: #{inspect(reason)}")
              state
          end
      end

    {:noreply, arm(state)}
  end

  # Every turn of a sleep session ends with its memory committed: the night's
  # work, or what the user's answer changed the morning after.
  def handle_info({:turn_ended, id, _summary}, state) do
    case Enum.find(state.scopes, fn {_scope, s} -> id in [s["session"] | s["past"] || []] end) do
      {scope, _} ->
        if dir = memory_dir(scope), do: commit(dir, "after a sleep turn")
        {:noreply, state}

      nil ->
        {:noreply, state}
    end
  end

  def handle_info(_message, state), do: {:noreply, state}

  # ── Deciding ────────────────────────────────────────────────────────────

  @doc false
  # Whether `scope` should sleep now. Public for the tests.
  def due?(state, scope, sessions, now) do
    s = scope_state(state, scope)
    last = s["last_run_at"] || 0
    mine = Enum.filter(sessions, &(scope_of(&1) == scope))
    awake = Enum.filter(mine, &(&1[:kind] != "dream"))

    s["enabled"] != false and
      in_window?(local_hour(now, state.utc_offset), state.window) and
      now - last >= @gap_ms and
      Enum.any?(awake, &(active_at(&1) > last)) and
      not Enum.any?(mine, &(&1.status in [:starting, :running])) and
      Enum.all?(awake, &(now - active_at(&1) >= @quiet_ms))
  end

  @doc false
  def in_window?(hour, [from, to]) when from <= to, do: hour >= from and hour < to
  def in_window?(hour, [from, to]), do: hour >= from or hour < to

  defp local_hour(now_ms, offset) do
    now_ms |> div(1000) |> Kernel.+(offset * 60) |> DateTime.from_unix!() |> Map.fetch!(:hour)
  end

  # A virtual employee's sessions are in a workspace, and a memory, of their
  # own (`Loom.Employees`): no scope's.
  defp scope_of(%{kind: "employee_" <> _}), do: :employee
  # An incognito session must leave no memory behind: no scope's either.
  defp scope_of(%{kind: "incognito"}), do: :incognito
  defp scope_of(%{project_id: id}) when is_binary(id), do: id
  defp scope_of(_session), do: "home"

  defp active_at(session), do: session[:last_active_at] || session[:created_at] || 0

  defp known("home"), do: :ok

  defp known(scope) do
    case Loom.Projects.get(scope) do
      {:ok, _} -> :ok
      :error -> {:error, :unknown_scope}
    end
  end

  defp not_sleeping(state, scope) do
    with id when is_binary(id) <- scope_state(state, scope)["session"],
         true <- Agent.exists?(id),
         %{status: status} when status in [:starting, :running] <- Agent.info(id) do
      {:error, :sleeping}
    else
      _ -> :ok
    end
  end

  # ── Sleeping ────────────────────────────────────────────────────────────

  defp sleep(state, scope) do
    with :ok <- not_sleeping(state, scope),
         {:ok, id, state} <- new_night(state, scope),
         dir when is_binary(dir) <- memory_dir(scope) || {:error, :no_memory_dir} do
      File.mkdir_p!(dir)
      s = scope_state(state, scope)
      sessions = replay(scope, s["last_run_at"])
      before = commit(dir, "before sleep")

      prompt =
        Prompt.build(%{
          memory_dir: dir,
          scope_name: scope_name(scope),
          sessions: sessions,
          last_run_at: s["last_run_at"],
          utc_offset: state.utc_offset,
          others: others(scope)
        })

      case Agent.submit(id, display(sessions), origin: "dream", prompt: prompt) do
        {:ok, _} ->
          now = System.system_time(:millisecond)
          run = %{"at" => now, "sessions" => length(sessions), "before" => before}

          s =
            s
            |> Map.put("last_run_at", now)
            |> Map.update("runs", [run], &Enum.take([run | &1], @runs_kept))

          {:ok, save(put_in(state.scopes[scope], s))}

        {:error, reason} ->
          {:error, reason}
      end
    end
  catch
    :exit, reason -> {:error, {:exit, reason}}
  end

  defp display([]), do: "Dream · nothing new, tidying what is there"
  defp display([_]), do: "Dream · 1 session since the last one"
  defp display(sessions), do: "Dream · #{length(sessions)} sessions since the last one"

  # What the night goes over: every session in the scope active since the last
  # sleep, with where Claude Code keeps its transcript.
  defp replay(scope, since) do
    Agent.list_sessions()
    |> Enum.filter(&(scope_of(&1) == scope and &1[:kind] != "dream"))
    |> Enum.filter(&(active_at(&1) > (since || 0)))
    |> Enum.sort_by(&active_at/1)
    |> Enum.map(fn s ->
      %{
        id: s.id,
        title: s.title || s.id,
        backend: s.backend,
        last_active_at: active_at(s),
        turns: s.turns,
        transcript: transcript(s)
      }
    end)
  end

  defp transcript(%{id: id, backend: :claude_code}) do
    with {:ok, meta} <- Loom.Agent.Store.read_meta(id),
         cc when is_binary(cc) <- meta[:cc_session_id],
         [path | _] <- Path.wildcard(Path.join([claude_dir(), "projects", "*", cc <> ".jsonl"])) do
      path
    else
      _ -> nil
    end
  end

  defp transcript(_session), do: nil

  # Read-only, for noticing what recurs across projects.
  defp others(scope) do
    ["home" | Enum.map(Loom.Projects.list(), & &1.id)]
    |> Enum.reject(&(&1 == scope))
    |> Enum.map(&{scope_name(&1), memory_dir(&1)})
    |> Enum.filter(fn {_, dir} -> dir && File.dir?(dir) end)
  end

  defp scope_name("home"), do: "sessions outside any project"

  defp scope_name(id) do
    case Loom.Projects.get(id) do
      {:ok, project} -> ~s(the project "#{project.name}")
      :error -> id
    end
  end

  # Each night in a session of its own: last night's conversation is no help
  # tonight (the memory directory and its git log are), and only makes every
  # sleep read more. The one on record is kept, for the user to answer in, as
  # long as it has not slept yet.
  defp new_night(state, scope) do
    s = scope_state(state, scope)

    with id when is_binary(id) <- s["session"],
         {:ok, %{turns: turns}} when is_integer(turns) and turns > 0 <- Agent.Store.read_meta(id),
         {:ok, new} <- start_session(scope) do
      s =
        s
        |> Map.put("session", new)
        |> Map.update("past", [id], &Enum.take([id | &1], @runs_kept))

      {:ok, new, put_in(state.scopes[scope], s)}
    else
      {:error, _} = error -> error
      _ -> ensure_session(state, scope)
    end
  end

  # A safety classifier stopped the model in the scope's session: what tripped
  # it would trip every answer there, so the user's next word goes to a fresh
  # one, told the report it would have answered. Not while it is still at it.
  defp set_aside(state, scope) do
    s = scope_state(state, scope)

    with id when is_binary(id) <- s["session"],
         true <- Agent.flagged?(id),
         false <- Agent.busy?(id),
         report = Agent.last_reply(id),
         what = report && "The last sleep's report, which the user may answer here:\n\n" <> report,
         {:ok, new} <- start_session(scope, Agent.set_aside_opts(id, what)) do
      s =
        s
        |> Map.put("session", new)
        |> Map.update("past", [id], &Enum.take([id | &1], @runs_kept))

      {:ok, put_in(state.scopes[scope], s)}
    else
      {:error, _} = error -> error
      _ -> {:ok, state}
    end
  end

  # The scope's sleep session: the one on record if it is still there, else one
  # already marked as such (a lost dream.json), else a new one.
  defp ensure_session(state, scope) do
    s = scope_state(state, scope)

    id =
      with id when is_binary(id) <- s["session"],
           {:ok, _} <- Loom.Agent.Store.read_meta(id) do
        id
      else
        _ ->
          Enum.find_value(Agent.list_sessions(), fn x ->
            if x[:kind] == "dream" and scope_of(x) == scope, do: x.id
          end)
      end

    result =
      cond do
        id && Agent.exists?(id) -> {:ok, id}
        id -> with {:ok, _} <- Agent.restore_session(id), do: {:ok, id}
        true -> start_session(scope)
      end

    case result do
      {:ok, id} -> {:ok, id, put_in(state.scopes[scope], Map.put(s, "session", id))}
      error -> error
    end
  end

  defp start_session(scope, extra \\ []) do
    id = Agent.new_id()
    project = if scope == "home", do: nil, else: scope

    opts = [backend: :claude_code, kind: "dream", title: "Sleep"] ++ extra
    opts = if project, do: [{:project, project} | opts], else: opts

    case Agent.start_session(id, opts) do
      {:ok, _pid} -> {:ok, id}
      error -> error
    end
  end

  defp restore(state, scope) do
    s = scope_state(state, scope)
    dir = memory_dir(scope)

    case Enum.split_while(s["runs"] || [], &(&1["undone"] || is_nil(&1["before"]))) do
      {_, []} ->
        {:error, :nothing_to_undo}

      {skipped, [run | rest]} ->
        commit(dir, "before undo")

        case git(dir, [
               "restore",
               "--source=" <> run["before"],
               "--staged",
               "--worktree",
               "--",
               "."
             ]) do
          {:ok, _} ->
            at = run["at"] |> DateTime.from_unix!(:millisecond) |> DateTime.to_iso8601()
            commit(dir, "undo the sleep of #{at}")
            s = Map.put(s, "runs", skipped ++ [Map.put(run, "undone", true) | rest])
            {:ok, save(put_in(state.scopes[scope], s))}

          error ->
            error
        end
    end
  end

  # ── git ─────────────────────────────────────────────────────────────────

  # Everything in the directory as one commit, and its sha. nil when git
  # cannot be used: sleeping goes ahead, it just cannot be undone.
  defp commit(dir, message) do
    with :ok <- git_init(dir),
         {:ok, _} <- git(dir, ["add", "-A"]),
         {:ok, _} <-
           git(dir, [
             "-c",
             "user.name=Loom",
             "-c",
             "user.email=loom@localhost",
             "commit",
             "-q",
             "--allow-empty",
             "-m",
             message
           ]),
         {:ok, sha} <- git(dir, ["rev-parse", "HEAD"]) do
      String.trim(sha)
    else
      error ->
        Logger.warning("Loom.Dream: cannot commit #{dir}: #{inspect(error)}")
        nil
    end
  end

  defp git_init(dir) do
    if File.dir?(Path.join(dir, ".git")) do
      :ok
    else
      File.mkdir_p!(dir)

      with {:ok, _} <- git(dir, ["init", "-q"]), do: :ok
    end
  end

  defp git(dir, args) do
    case System.cmd("git", ["-C", dir | args], stderr_to_stdout: true) do
      {out, 0} -> {:ok, out}
      {out, status} -> {:error, {:git, status, String.trim(out)}}
    end
  rescue
    e -> {:error, {:git, Exception.message(e)}}
  end

  # ── Settings ────────────────────────────────────────────────────────────

  defp change(state, scope, attrs) do
    with {:ok, state} <- change_enabled(state, scope, attrs),
         {:ok, state} <- change_window(state, attrs) do
      change_offset(state, attrs)
    end
  end

  defp change_enabled(state, scope, %{"enabled" => on}) when is_boolean(on),
    do: {:ok, put_in(state.scopes[scope], Map.put(scope_state(state, scope), "enabled", on))}

  defp change_enabled(_state, _scope, %{"enabled" => _}), do: {:error, "enabled is true or false"}
  defp change_enabled(state, _scope, _attrs), do: {:ok, state}

  defp change_window(state, %{"window" => [from, to]})
       when from in 0..23 and to in 0..23 and from != to,
       do: {:ok, %{state | window: [from, to]}}

  defp change_window(_state, %{"window" => _}),
    do: {:error, "window is [start, end], two different hours from 0 to 23"}

  defp change_window(state, _attrs), do: {:ok, state}

  defp change_offset(state, %{"utc_offset" => n}) when is_integer(n) and n >= -720 and n <= 840,
    do: {:ok, %{state | utc_offset: n}}

  defp change_offset(_state, %{"utc_offset" => _}),
    do: {:error, "utc_offset is minutes east of UTC, -720 to 840"}

  defp change_offset(state, _attrs), do: {:ok, state}

  # ── State ───────────────────────────────────────────────────────────────

  defp scope_state(state, scope), do: Map.get(state.scopes, scope, %{})

  defp view(state, scope) do
    s = scope_state(state, scope)
    since = s["last_run_at"]
    dir = memory_dir(scope)

    pending =
      Agent.list_sessions()
      |> Enum.count(
        &(scope_of(&1) == scope and &1[:kind] != "dream" and active_at(&1) > (since || 0))
      )

    %{
      scope: scope,
      session: s["session"],
      enabled: s["enabled"] != false,
      last_run_at: since,
      runs: Enum.map(s["runs"] || [], &Map.take(&1, ["at", "sessions", "undone"])),
      can_undo: Enum.any?(s["runs"] || [], &(&1["undone"] != true and is_binary(&1["before"]))),
      pending_sessions: pending,
      memory_dir: dir,
      memories: if(dir, do: length(Path.wildcard(Path.join(dir, "*.md"))), else: 0),
      window: state.window,
      utc_offset: state.utc_offset
    }
  end

  defp load(path) do
    with {:ok, body} <- File.read(path),
         {:ok, %{} = raw} <- Jason.decode(body) do
      %{
        scopes: if(is_map(raw["scopes"]), do: raw["scopes"], else: %{}),
        window: valid_window(raw["window"]),
        utc_offset:
          if(is_integer(raw["utc_offset"]), do: raw["utc_offset"], else: @default_offset)
      }
    else
      {:error, :enoent} ->
        fresh()

      other ->
        Logger.error("Loom.Dream cannot read #{path} (#{inspect(other)}); starting over")
        fresh()
    end
  end

  defp fresh, do: %{scopes: %{}, window: @default_window, utc_offset: @default_offset}

  defp valid_window([from, to]) when from in 0..23 and to in 0..23 and from != to, do: [from, to]
  defp valid_window(_other), do: @default_window

  defp save(state) do
    File.mkdir_p!(Path.dirname(state.path))
    tmp = state.path <> ".tmp"
    body = Map.take(state, [:scopes, :window, :utc_offset])
    File.write!(tmp, Jason.encode_to_iodata!(body, pretty: true))
    File.rename!(tmp, state.path)
    state
  end

  defp arm(state) do
    if state.timer, do: Process.cancel_timer(state.timer)
    %{state | timer: Process.send_after(self(), :tick, state.tick)}
  end
end
