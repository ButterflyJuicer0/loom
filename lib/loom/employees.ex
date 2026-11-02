defmodule Loom.Employees do
  @moduledoc """
  Virtual employees: an agent that keeps working while Loom is up, on projects
  it is given, toward KPIs the user sets, and says when it needs them.

  - **Two sessions each**, hidden from the lists and opened from the
    employee's page: `employee_chat`, where the user talks to it, and
    `employee_work`, where it works. Every turn of the work session is either
    a wake-up from here or the user answering a report, so the work session
    *is* the report: what it did, and what it asked. Both start in the
    employee's own workspace, so they share Claude Code's memory and files.
  - **A heartbeat, not a loop.** A tick every minute wakes an employee whose
    time has come: the hour it asked for, its heartbeat, the user's "wake
    now", the weekly report. Each wake-up is one turn, which ends with
    a work card (`Loom.Employees.Card`): when to wake next, KPI progress, and
    whether there is something to report. No card is a sleep until the next
    heartbeat.
  - **Within its hours** (all day unless set), except for the reports.
  - **A budget per day**, in the user's wall-clock day. Every turn of either
    session counts (`{:turn_cost, id, usd}` from the sessions). Spent, the
    work stops — a turn running is interrupted — and the user is asked once;
    what they approve on top counts for that day only.
  - **Permissions are soft, unless it is given some.** The projects it is
    given are named in its instructions with their workspaces, and it is told
    to stay in them; it runs as the same user as every other agent, so
    nothing enforces it. `permissions` (Claude Code only) are hard: the tools
    it has and the rules each call must match, which Claude Code itself
    enforces, under `dontAsk` (`Loom.Agent.Guard`). Set and changed only from
    a setup chat, with a summary in words, which is all the page shows; its
    sessions start again with them. What is refused is a line in its Updates.
  - **Setup chats** (`employee_setup`, in Recents): the user tells an agent
    what employee they want, or what to change in one; it ends with a
    `loom-employee` block, which is saved when the turn ends.
  - **A workstation**, if it is given one: a device (`Loom.Nodes`) where
    what it does happens. Its sessions stay here, but every tool call is
    checked first (`Loom.Agent.Guard`, `rel/loom-guard`): commands, files,
    browsing and the web only through `loom-node` on that device; here, only
    its own notes. What is refused is a line in its Updates. While the device
    is offline it does not wake, so it spends nothing; offline past a
    heartbeat, the user is told once; back online, it carries on.
  - **Reports** go three ways: `info` is only written down, `important` is a
    notification, `urgent` a notification and the employee marked as blocked
    until a later turn says otherwise. Weekly reports are files it writes
    under `reports/`, listed on its page; there is no daily one (the boss
    reviews employees when they choose, and is not told every evening).
    Daily ones written before stay listed.
  - **The boss profile**, one for all of them: facts and rules about the user
    that hold whatever the job ("reply in Chinese", "no finance work on
    AWS"), a sentence each with who heard it and when. An employee adds one
    through its card's `boss` and it applies at once, to every employee, with
    no one asked; the user adds, edits and deletes them in Settings. Every
    wake-up and `.employee/status.md` carry it whole; a chat is told what
    changed ahead of its next message. Rules for one employee's job stay with
    that employee. Mirrored to `~/.loom/boss.md` for Sleep, which leaves its
    facts there rather than storing them again.

  Truth is `~/.loom/employees.json`. What the agents should be able to read
  without asking — profile, KPIs, status — is mirrored into `.employee/` in
  the workspace on every change.
  """
  use GenServer

  require Logger

  alias Loom.Agent
  alias Loom.Agent.Guard
  alias Loom.Employees.{Card, Prompt}

  @name __MODULE__
  @tick :timer.minutes(1)
  @offset 480
  @log_kept 100
  @past_kept 60
  @fresh_tokens 60_000
  @fresh_turns 12
  @chat_quiet_ms :timer.minutes(30)
  @write_handoff "Loom starts your work session afresh from your next wake-up. Before this turn ends, write HANDOFF.md as the rules say, so the new session can carry on."
  @spend_days_kept 60

  @defaults %{
    "role" => "",
    "persona" => "",
    "language" => "简体中文",
    "project_ids" => [],
    "hours" => nil,
    "heartbeat_min" => 120,
    "min_gap_min" => 15,
    "max_turn_min" => 60,
    "budget_usd" => 50,
    # For a backend that reports no cost (Codex, Kiro): turns a day instead.
    "budget_turns" => 40,
    "weekly_report" => %{"day" => 5, "time" => "18:00"},
    "ask_first" => [
      "deploying anything",
      "deleting files or data that are not your own scratch work",
      "git push, merging, or opening a pull request",
      "publishing or sending anything outside this machine"
    ],
    # Chosen at hiring, for good, as for any session.
    "backend" => "claude_code",
    "model" => "opus",
    "paused" => false,
    # A device's id: where it works (nil: here).
    "workstation" => nil,
    # What it may do, enforced by Claude Code (`Loom.Agent.Guard`); nil: anything.
    "permissions" => nil
  }

  # Each backend's own name for its best model, which an employee starts on.
  @models %{"claude_code" => "opus", "kiro" => "claude-opus-5.5", "codex" => ""}

  @editable ~w(name role persona language project_ids hours heartbeat_min min_gap_min
               max_turn_min budget_usd budget_turns weekly_report ask_first model
               workstation)

  # Set only from a setup chat (`setup/2`), never from the settings page, so the
  # rules and the summary the user reads change together and in one place.
  @setup @editable ++ ~w(permissions)
  @setup_fence ~r/```loom-employee[ \t]*\n(.*?)\n?```/s

  # Settings no longer kept: the daily report (2026-10-31).
  @dropped ~w(daily_report last_daily)
  @daily_gone "The boss dropped the daily report (2026-10-31): Loom no longer wakes you for one, and you write none. The boss reviews your work when they choose. The weekly report, your worklog and reports to the bell stay as they were. Take the daily report out of your notes (HANDOFF.md)."

  @boss_kept 100
  @boss_chars 300

  @kpi_statuses ~w(todo doing review done parked)
  @priorities ~w(high normal low)

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, @name))
  end

  # ── API ─────────────────────────────────────────────────────────────────

  @doc "Every employee, oldest first, as the page shows them."
  def list(server \\ @name), do: GenServer.call(server, :list)

  def get(id, server \\ @name), do: GenServer.call(server, {:get, id})

  @doc "Hire: `name` at least, and any of the settings. Its sessions are made at once."
  def create(attrs, server \\ @name), do: GenServer.call(server, {:create, attrs}, 30_000)

  def update(id, attrs, server \\ @name), do: GenServer.call(server, {:update, id, attrs})

  @doc "Let go: its sessions, its workspace and its record."
  def delete(id, server \\ @name), do: GenServer.call(server, {:delete, id}, 30_000)

  @doc "Stop it (a turn running is interrupted), or let it carry on."
  def pause(id, paused?, server \\ @name), do: GenServer.call(server, {:pause, id, paused?})

  @doc "Wake it now, whatever it planned; a note goes with the wake-up."
  def wake(id, note \\ nil, server \\ @name),
    do: GenServer.call(server, {:wake, id, note}, 30_000)

  @doc "The boss has seen what it reported: the banner goes."
  def seen(id, server \\ @name), do: GenServer.call(server, {:seen, id})

  @doc "More budget, for today only, on top of the daily one."
  def approve(id, usd, server \\ @name), do: GenServer.call(server, {:approve, id, usd})

  def add_kpi(id, attrs, server \\ @name), do: GenServer.call(server, {:add_kpi, id, attrs})

  def update_kpi(id, kpi_id, attrs, server \\ @name),
    do: GenServer.call(server, {:update_kpi, id, kpi_id, attrs})

  def delete_kpi(id, kpi_id, server \\ @name),
    do: GenServer.call(server, {:delete_kpi, id, kpi_id})

  @doc "The user's verdict on a KPI the employee put up for review."
  def review_kpi(id, kpi_id, accept?, note, server \\ @name),
    do: GenServer.call(server, {:review_kpi, id, kpi_id, accept?, note})

  @doc "The boss profile: `%{\"id\", \"text\", \"by\", \"by_name\", \"at\"}`, oldest first."
  def boss(server \\ @name), do: GenServer.call(server, :boss)

  @doc "The user adds to it themselves."
  def add_boss(text, server \\ @name), do: GenServer.call(server, {:add_boss, text})

  def update_boss(id, text, server \\ @name), do: GenServer.call(server, {:update_boss, id, text})

  def delete_boss(id, server \\ @name), do: GenServer.call(server, {:delete_boss, id})

  @doc """
  Start a setup chat: one to hire an employee in conversation, or, given an
  id, to change that one. It is in Recents like any chat; what it agrees on
  is saved when its turns end (see the moduledoc).
  """
  def setup_chat(employee_id \\ nil) do
    with {:ok, e} <- if(employee_id, do: get(employee_id), else: {:ok, nil}) do
      id = Agent.new_id()
      title = if e, do: "Set up #{e["name"]}", else: "Hire an employee"

      with {:ok, _} <-
             Agent.start_session(id, backend: :claude_code, kind: "employee_setup", title: title) do
        devices = Loom.Nodes.list() |> Enum.map(&%{id: &1.id, name: &1.name})
        projects = Loom.Projects.list() |> Enum.map(&%{id: &1.id, name: &1.name})
        Agent.tell(id, Prompt.setup_context(e, projects, devices))
        {:ok, id}
      end
    end
  end

  @doc "Its mirror, for Sleep to read."
  def boss_path, do: Path.join(Agent.Store.home(), "boss.md")

  def path, do: Application.get_env(:loom, __MODULE__, [])[:path] || default_path()
  defp default_path, do: Path.join(Agent.Store.home(), "employees.json")

  @doc "Where an employee's own things are: its system prompts, and its workspace."
  def dir(id), do: Path.join([Agent.Store.home(), "employees", id])
  def workspace(id), do: Path.join(dir(id), "workspace")

  @doc "Its reports (weekly, and daily ones from before), newest first: `%{file:, kind:, title:, mtime:, size:}`."
  def reports(id) do
    Path.wildcard(Path.join([workspace(id), "reports", "*.md"]))
    |> Enum.map(fn path ->
      name = Path.basename(path)
      {:ok, stat} = File.stat(path, time: :posix)

      %{
        file: name,
        kind: if(String.starts_with?(name, "weekly"), do: "weekly", else: "daily"),
        title: Path.rootname(name),
        mtime: stat.mtime * 1000,
        size: stat.size
      }
    end)
    |> Enum.sort_by(& &1.mtime, :desc)
  end

  @doc "One report's text, by file name."
  def report(id, file) do
    if file =~ ~r/^[\w.-]+\.md$/,
      do: File.read(Path.join([workspace(id), "reports", file])),
      else: {:error, :enoent}
  end

  # ── GenServer ───────────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    path = Keyword.get(opts, :path, path())
    Phoenix.PubSub.subscribe(Loom.PubSub, Agent.turns_topic())
    tick = Keyword.get(opts, :tick) || Application.get_env(:loom, __MODULE__, [])[:tick] || @tick
    {employees, boss} = load(path)

    state = %{
      path: path,
      tick: tick,
      timer: nil,
      employees: employees,
      boss: boss,
      # Off under test, where the tick is driven by hand.
      run: Keyword.get(opts, :run, Application.get_env(:loom, __MODULE__, [])[:run] != false)
    }

    {:ok, arm(state)}
  end

  @impl true
  def handle_call(:list, _from, state) do
    views =
      state.employees |> Map.values() |> Enum.sort_by(& &1["created_at"]) |> Enum.map(&view/1)

    {:reply, views, state}
  end

  def handle_call(:boss, _from, state), do: {:reply, state.boss, state}

  def handle_call({:add_boss, text}, _from, state) do
    case boss_text(text) do
      nil ->
        {:reply, {:error, "a line of text"}, state}

      text ->
        {state, entry} = learn(state, %{"text" => text}, nil, nil)
        {:reply, {:ok, entry}, state}
    end
  end

  def handle_call({:update_boss, id, text}, _from, state) do
    with %{} <- Enum.find(state.boss, &(&1["id"] == id)),
         text when is_binary(text) <- boss_text(text) do
      {state, entry} = learn(state, %{"text" => text, "replaces" => id}, nil, nil)
      {:reply, {:ok, entry}, state}
    else
      nil -> {:reply, {:error, :not_found}, state}
    end
  end

  def handle_call({:delete_boss, id}, _from, state) do
    case Enum.find(state.boss, &(&1["id"] == id)) do
      nil ->
        {:reply, {:error, :not_found}, state}

      old ->
        state =
          boss_changed(
            %{state | boss: List.delete(state.boss, old)},
            ["- removed: " <> old["text"]],
            nil
          )

        {:reply, :ok, state}
    end
  end

  def handle_call({:get, id}, _from, state) do
    case state.employees[id] do
      nil -> {:reply, {:error, :not_found}, state}
      e -> {:reply, {:ok, view(e)}, state}
    end
  end

  def handle_call({:create, attrs}, _from, state) do
    {reply, state} = hire(state, attrs, @editable)
    {:reply, reply, state}
  end

  def handle_call({:update, id, attrs}, _from, state) do
    {reply, state} = change(state, id, attrs, @editable)
    {:reply, reply, state}
  end

  def handle_call({:delete, id}, _from, state) do
    with {:ok, e} <- fetch(state, id) do
      for s <- [
            e["chat_session"],
            e["work_session"] | (e["past_work"] || []) ++ (e["past_chat"] || [])
          ],
          is_binary(s),
          do: Agent.delete_session(s)

      for s <- [e["chat_session"], e["work_session"]], is_binary(s), do: Guard.put(s, nil)
      File.rm_rf(dir(id))
      state = %{state | employees: Map.delete(state.employees, id)}
      save(state)
      Phoenix.PubSub.broadcast(Loom.PubSub, Agent.lobby_topic(), {:employee_removed, id})
      {:reply, :ok, state}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:pause, id, paused?}, _from, state) do
    with {:ok, e} <- fetch(state, id) do
      if paused?, do: stop_work(e)
      e = Map.put(e, "paused", paused? == true)
      e = if paused?, do: e, else: Map.put(e, "wake_at", now())
      {:reply, {:ok, view(e)}, put(state, e)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:wake, id, note}, _from, state) do
    with {:ok, e} <- fetch(state, id) do
      e = if blank?(note), do: e, else: note(e, "From the boss: " <> String.trim(note))
      e = Map.merge(e, %{"wake_at" => now(), "wake_reason" => "the boss asked you to"})
      state = put(state, e)
      state = if state.run, do: run(state, id, now()), else: state
      {:reply, {:ok, view(state.employees[id])}, state}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:seen, id}, _from, state) do
    with {:ok, e} <- fetch(state, id) do
      e = Map.put(e, "attention", nil)
      {:reply, {:ok, view(e)}, put(state, e)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:approve, id, usd}, _from, state) do
    with {:ok, e} <- fetch(state, id),
         {:ok, usd} <- positive(usd) do
      day = today(now())

      e =
        e
        |> update_in(["extra"], &Map.update(&1 || %{}, day, usd, fn x -> x + usd end))
        |> Map.merge(%{"approval_asked" => nil, "wake_at" => now()})
        |> note("The boss approved #{amount(e, usd)} more for today. Carry on.")

      {:reply, {:ok, view(e)}, put(state, e)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:add_kpi, id, attrs}, _from, state) do
    with {:ok, e} <- fetch(state, id),
         {:ok, kpi} <- new_kpi(attrs) do
      e =
        e
        |> Map.update!("kpis", &(&1 ++ [kpi]))
        |> note("A new KPI from the boss: #{kpi["title"]} (#{kpi["id"]}).")

      {:reply, {:ok, view(e)}, put(state, e)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:update_kpi, id, kpi_id, attrs}, _from, state) do
    with {:ok, e} <- fetch(state, id),
         {:ok, e} <- change_kpi(e, kpi_id, attrs, true) do
      {:reply, {:ok, view(e)}, put(state, e)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:delete_kpi, id, kpi_id}, _from, state) do
    with {:ok, e} <- fetch(state, id) do
      e = Map.update!(e, "kpis", fn kpis -> Enum.reject(kpis, &(&1["id"] == kpi_id)) end)
      {:reply, {:ok, view(e)}, put(state, e)}
    else
      error -> {:reply, error, state}
    end
  end

  def handle_call({:review_kpi, id, kpi_id, accept?, note}, _from, state) do
    status = if accept?, do: "done", else: "doing"
    attrs = %{"status" => status}
    attrs = if accept?, do: Map.put(attrs, "progress", 100), else: attrs

    with {:ok, e} <- fetch(state, id),
         {:ok, e} <- change_kpi(e, kpi_id, attrs, true) do
      title = Enum.find_value(e["kpis"], kpi_id, &(&1["id"] == kpi_id && &1["title"]))
      why = if blank?(note), do: "", else: " The boss says: " <> String.trim(note)

      e =
        if accept?,
          do: note(e, "The boss accepted KPI #{kpi_id} (#{title}) as done.#{why}"),
          else:
            note(e, "The boss sent KPI #{kpi_id} (#{title}) back: not done yet.#{why}")
            |> Map.put("wake_at", now())

      {:reply, {:ok, view(e)}, put(state, e)}
    else
      error -> {:reply, error, state}
    end
  end

  @impl true
  def handle_info(:tick, state) do
    now = now()

    state =
      if state.run,
        do: Enum.reduce(Map.keys(state.employees), state, &run(&2, &1, now)),
        else: state

    {:noreply, arm(state)}
  end

  def handle_info({:turn_cost, session, usd}, state) when is_number(usd) and usd > 0 do
    case by_session(state, session) do
      {e, _kind} ->
        e = add_cost(e, usd, now())
        state = put(state, e)
        # Over the line mid-turn: stopped now, not at the next tick.
        {:noreply, if(state.run, do: run(state, e["id"], now()), else: state)}

      nil ->
        {:noreply, state}
    end
  end

  def handle_info({:turn_ended, session, %{kind: "employee_setup"} = summary}, state) do
    text =
      case summary[:outcome] do
        {:ok, text} -> text
        _ -> nil
      end

    {:noreply, setup(state, session, text)}
  end

  def handle_info({:turn_ended, session, summary}, state) do
    case by_session(state, session) do
      {e, kind} -> {:noreply, put(state, ended(e, kind, summary, now()))}
      nil -> {:noreply, state}
    end
  end

  def handle_info(_message, state), do: {:noreply, state}

  # ── Working ─────────────────────────────────────────────────────────────

  @doc false
  # One employee, now: stop it if it has to stop, wake it if it is due.
  # Public for the tests, which drive it with their own clock.
  def run(state, id, now) do
    case state.employees[id] do
      nil -> state
      e -> put(state, e |> turn_over_chat(now) |> step(now, state.boss))
    end
  end

  defp step(%{"paused" => true} = e, _now, _boss), do: e

  defp step(e, now, boss) do
    e = refresh_station(e)
    busy = working?(e)

    cond do
      e["workstation"] && e["station_online"] != true ->
        if busy, do: stop_work(e)
        offline(e, now)

      over_budget?(e, now) ->
        if busy, do: stop_work(e)
        ask_approval(e, now)

      busy and too_long?(e, now) ->
        stop_work(e)

        e
        |> note(
          "Your last turn ran past #{e["max_turn_min"]} minutes and was stopped. Work in smaller steps."
        )
        |> Map.merge(%{"turn_started_at" => nil, "wake_at" => now + min_gap(e)})

      busy ->
        e

      reason = due(e, now) ->
        # A turn that just ended may have said so already, in a message
        # still in the mailbox: its card decides what comes next, and what
        # the wake-up is told.
        e = settle(e, now)
        if due(e, now) == reason and not working?(e), do: wake_up(e, reason, now, boss), else: e

      true ->
        e
    end
    |> back_online()
  end

  # The turn ends and costs of this employee's sessions that arrived while
  # deciding, taken now rather than after: a session announces a turn's end
  # just after it goes idle, so the idle can be seen first.
  defp settle(e, now) do
    chat = e["chat_session"]
    work = e["work_session"]

    receive do
      {:turn_ended, ^work, summary} ->
        settle(ended(e, "employee_work", summary, now), now)

      {:turn_ended, ^chat, summary} ->
        settle(ended(e, "employee_chat", summary, now), now)

      {:turn_cost, s, usd} when (s == work or s == chat) and is_number(usd) ->
        settle(add_cost(e, usd, now), now)
    after
      0 -> e
    end
  end

  # Why it should wake now, or nil.
  defp due(e, now) do
    cond do
      report_due?(e, :weekly, now) -> :weekly_report
      is_integer(e["wake_at"]) and now >= e["wake_at"] and in_hours?(e, now) -> :wake
      true -> nil
    end
  end

  defp wake_up(e, reason, now, boss) do
    with {:ok, e} <- e |> turn_over(now) |> ensure_sessions(),
         prompt = Prompt.wake(e, reason, context(e, boss, now)),
         {:ok, _} <-
           Agent.submit(e["work_session"], Prompt.display(e, reason, now, @offset),
             origin: "employee",
             prompt: prompt
           ) do
      e
      |> Map.merge(%{
        "turn_started_at" => now,
        "turn_reason" => to_string(reason),
        "last_wake_at" => now,
        "wake_at" => nil,
        "wake_reason" => nil,
        "inbox" => [],
        "fresh" => false
      })
      |> mark_report(reason, now)
    else
      error ->
        Logger.warning("Loom.Employees: #{e["id"]} could not wake: #{inspect(error)}")
        Map.put(e, "wake_at", now + min_gap(e))
    end
  catch
    :exit, reason ->
      Logger.warning("Loom.Employees: #{e["id"]} could not wake: #{inspect(reason)}")
      Map.put(e, "wake_at", now + min_gap(e))
  end

  defp open_notices(e) do
    Loom.Notices.open_of(e["id"])
  catch
    :exit, _ -> []
  end

  defp mark_report(e, :weekly_report, now), do: Map.put(e, "last_weekly", week(now))
  defp mark_report(e, _reason, _now), do: e

  # A fresh work session each day, and sooner once one has grown past
  # @fresh_tokens (or @fresh_turns, for a backend that does not say): a long
  # context costs on every wake-up and drags yesterday's reasoning into
  # today's. What carries over is in its files, `HANDOFF.md` above all. The
  # page shows the old ones above the new as one thread.
  defp turn_over(e, now) do
    id = e["work_session"]

    with true <- is_binary(id),
         {:ok, meta} <- Agent.Store.read_meta(id),
         flagged = is_integer(meta[:flagged_at]),
         true <- flagged or stale?(meta, now) do
      cond do
        # A safety classifier stopped the model there, and what tripped it
        # would trip every wake-up after: it goes now, with what its files hold.
        flagged ->
          e
          |> Map.put("work_session", nil)
          |> Map.put("fresh", "flagged")
          |> Map.update("past_work", [id], &Enum.take([id | &1], @past_kept))

        # The first time, there is nothing to carry over yet: it writes one in
        # the session it has, and moves on at the wake-up after.
        File.exists?(Path.join(workspace(e["id"]), "HANDOFF.md")) ->
          e
          |> Map.put("work_session", nil)
          |> Map.put("fresh", true)
          |> Map.update("past_work", [id], &Enum.take([id | &1], @past_kept))

        true ->
          note(e, @write_handoff)
      end
    else
      _ -> e
    end
  end

  # The chat goes the same way: afresh each day, between conversations (not
  # within @chat_quiet_ms of the last word), and as soon as a turn is over when
  # a safety classifier stopped the model in it. A new day's chat may look back
  # at yesterday's; one set aside is not read again.
  defp turn_over_chat(e, now) do
    id = e["chat_session"]

    with true <- is_binary(id),
         {:ok, meta} <- Agent.Store.read_meta(id),
         flagged = is_integer(meta[:flagged_at]),
         true <- (meta[:turns] || 0) > 0,
         true <- flagged or today(meta[:created_at] || now) != today(now),
         false <- Agent.busy?(id),
         true <- flagged or quiet?(id, now),
         {:ok, new} <- start_session(e, "employee_chat", chat_carry(id, flagged)) do
      e
      |> Map.put("chat_session", new)
      |> Map.update("past_chat", [id], &Enum.take([id | &1], @past_kept))
    else
      _ -> e
    end
  catch
    :exit, _ -> e
  end

  defp chat_carry(id, true), do: Agent.set_aside_opts(id, nil)

  defp chat_carry(id, false) do
    [
      notice:
        "[Note from Loom, not written by the user: Loom starts your chat with the boss " <>
          "afresh each day. Earlier days' chat is session #{id} (`loom-session read #{id}`), " <>
          "if you need something that was said there and is not in your notes.]"
    ]
  end

  defp quiet?(id, now) do
    case Agent.exists?(id) && Agent.info(id) do
      %{last_active_at: at} when is_integer(at) -> now - at >= @chat_quiet_ms
      _ -> true
    end
  end

  defp stale?(meta, now) do
    turns = meta[:turns] || 0
    tokens = meta[:context_tokens]

    turns > 0 and
      (today(meta[:created_at] || now) != today(now) or
         if(is_integer(tokens), do: tokens > @fresh_tokens, else: turns >= @fresh_turns))
  end

  defp context(e, boss, now) do
    %{
      fresh: if(e["fresh"] in [true, "flagged"], do: e["fresh"], else: false),
      notices: open_notices(e),
      now: now,
      offset: @offset,
      today: today(now),
      week: week(now),
      spent: spent(e, now),
      spent_text: amount(e, spent(e, now)),
      cap: cap(e, now),
      projects: projects(e),
      workspace: workspace(e["id"]),
      boss: boss
    }
  end

  # A turn of either session is over. The work card says what comes next.
  defp ended(e, kind, summary, now) do
    text =
      case summary[:outcome] do
        {:ok, text} when is_binary(text) -> text
        _ -> ""
      end

    card = Card.parse(text)
    e = e |> count_turn(now) |> apply_kpis(card) |> apply_added(card) |> heard(card, kind)

    blocked(e)

    case kind do
      "employee_work" -> work_ended(e, card, summary, now)
      _ -> chat_ended(e, card, now)
    end
  end

  # What the guard refused in the turn, a line each in its Updates.
  defp blocked(e) do
    path = Path.join(dir(e["id"]), "blocked.jsonl")

    with {:ok, body} <- File.read(path),
         :ok <- File.rm(path),
         s when is_binary(s) <- e["work_session"] do
      lines =
        for line <- String.split(body, "\n", trim: true),
            {:ok, %{"what" => what} = entry} <- [Jason.decode(line)],
            do: {entry["by"] == "permissions", what}

      for {by_permissions?, whats} <- Enum.group_by(lines, &elem(&1, 0), &elem(&1, 1)) do
        {shown, rest} = Enum.split(whats, 5)
        more = if rest == [], do: "", else: " (and #{length(rest)} more)"

        lead =
          if by_permissions?,
            do: "Refused by its permissions: ",
            else: "Blocked on this server, off its workstation: "

        Agent.note(s, lead <> Enum.map_join(shown, " · ", &String.slice(&1, 0, 120)) <> more)
      end
    end
  catch
    :exit, _ -> :ok
  end

  defp work_ended(e, card, summary, now) do
    {next, why} = next_wake(e, card, now)
    report = card["report"]

    entry =
      %{
        "at" => now,
        "summary" =>
          card["summary"] ||
            case summary[:outcome] do
              {:error, message} -> "The turn failed: " <> to_string(message)
              _ -> nil
            end,
        "report" => report
      }
      |> Map.reject(fn {_, v} -> is_nil(v) end)

    # A report goes to the bell, which notifies by its priority; what it took
    # back is withdrawn there. A new important or urgent report takes the
    # place of the last. Without one, an important report stays until the
    # boss has seen it; an urgent one was answered, or is moot, once the
    # employee has worked again.
    # Not from a weekly report's turn: those are read on its page, and a
    # bell rung by every employee at once is one nobody hears.
    report =
      if e["turn_reason"] == "weekly_report",
        do: nil,
        else: report && Map.put(report, "level", level(report))

    if report && (report["level"] != "info" or is_integer(report["priority"])),
      do: post(e, report)

    for key <- card["withdraw"] || [], do: Loom.Notices.withdraw(e["id"], key)

    attention =
      case report do
        %{"level" => level} = r when level in ["important", "urgent"] -> Map.put(r, "at", now)
        _ -> if(match?(%{"level" => "important"}, e["attention"]), do: e["attention"])
      end

    e
    |> Map.merge(%{
      "turn_started_at" => nil,
      "turn_reason" => nil,
      "wake_at" => next,
      "wake_reason" => why,
      "attention" => attention,
      "last_card_at" => if(card == %{}, do: e["last_card_at"], else: now)
    })
    |> Map.update("log", [entry], &Enum.take([entry | &1], @log_kept))
  end

  # A priority (0 most urgent … 10), given or read from the old three levels;
  # and the level the page's banner goes by, read from the priority.
  defp level(%{"priority" => p}) when is_integer(p) and p <= 2, do: "urgent"
  defp level(%{"priority" => p}) when is_integer(p) and p <= 5, do: "important"
  defp level(%{"priority" => p}) when is_integer(p), do: "info"
  defp level(%{"level" => level}), do: level

  defp priority(%{"priority" => p}) when is_integer(p), do: p
  defp priority(%{"level" => "urgent"}), do: 2
  defp priority(%{"level" => "important"}), do: 4
  defp priority(_), do: 7

  defp post(e, report) do
    p = priority(report)

    Loom.Notices.post(%{kind: "employee", id: e["id"], name: e["name"]}, %{
      summary: report["text"],
      detail: report["detail"],
      options: report["options"],
      priority: p,
      key: report["key"],
      needs: report["needs"] || if(p <= 2, do: "reply", else: "read"),
      session: e["work_session"]
    })
  catch
    :exit, reason -> Logger.warning("Loom.Employees: #{e["id"]} cannot post: #{inspect(reason)}")
  end

  defp chat_ended(e, card, now) do
    e =
      if blank?(card["note_for_work"]),
        do: e,
        else: note(e, "From your chat with the boss: " <> card["note_for_work"])

    if card["wake_now"] == true,
      do: Map.merge(e, %{"wake_at" => now, "wake_reason" => "the boss asked in chat"}),
      else: e
  end

  # When to wake next: as the card says, but no sooner than the minimum gap
  # (a "continue" is a minute), and no later than the heartbeat.
  defp next_wake(e, card, now) do
    heartbeat = now + e["heartbeat_min"] * 60_000

    cond do
      card["next"] == "continue" ->
        {now + 60_000, "carrying on"}

      at = Card.local_time(card["wake_at"], @offset) ->
        {at |> max(now + min_gap(e)) |> min(heartbeat), "as planned"}

      is_number(card["sleep_minutes"]) ->
        {(now + round(card["sleep_minutes"] * 60_000)) |> max(now + min_gap(e)) |> min(heartbeat),
         "as planned"}

      true ->
        {heartbeat, "heartbeat"}
    end
  end

  # The KPIs it moved on, by id; only what it may change, and never to done:
  # done is the boss's to say.
  defp apply_kpis(e, %{"kpis" => updates}) when is_list(updates) do
    Enum.reduce(updates, e, fn
      %{"id" => id} = u, e ->
        u = Map.take(u, ["progress", "status", "note"])
        u = if u["status"] == "done", do: Map.put(u, "status", "review"), else: u

        case change_kpi(e, id, u, false) do
          {:ok, e} -> e
          _ -> e
        end

      _, e ->
        e
    end)
  end

  defp apply_kpis(e, _card), do: e

  # KPIs the boss gave it in chat, written down by the chat session.
  defp apply_added(e, %{"kpi_add" => added}) when is_list(added) do
    kpis =
      for attrs <- added, is_map(attrs), {:ok, kpi} <- [new_kpi(attrs)], do: kpi

    Map.update!(e, "kpis", &(&1 ++ kpis))
  end

  defp apply_added(e, _card), do: e

  # What it learned about the boss, held on the record until `put/2` adds it
  # to the profile: a turn's end is read where there is only the employee.
  defp heard(e, %{"boss" => items}, kind) do
    session = if kind == "employee_work", do: e["work_session"], else: e["chat_session"]

    new =
      for item <- items,
          item = if(is_binary(item), do: %{"text" => item}, else: item),
          is_map(item),
          text = boss_text(item["text"]),
          text != nil,
          do: %{"text" => text, "replaces" => item["replaces"], "session" => session}

    Map.update(e, "boss_new", new, &(&1 ++ new))
  end

  defp heard(e, _card, _kind), do: e

  # Kept for every backend, so the page can show it; the budget only where
  # there is no cost to go by.
  defp count_turn(e, now) do
    turns =
      (e["turns"] || %{})
      |> Map.update(today(now), 1, &(&1 + 1))
      |> Enum.sort_by(fn {d, _} -> d end, :desc)
      |> Enum.take(@spend_days_kept)
      |> Map.new()

    Map.put(e, "turns", turns)
  end

  defp add_cost(e, usd, now) do
    spend =
      (e["spend"] || %{})
      |> Map.update(today(now), usd, &(&1 + usd))
      |> Enum.sort_by(fn {d, _} -> d end, :desc)
      |> Enum.take(@spend_days_kept)
      |> Map.new()

    Map.put(e, "spend", spend)
  end

  defp ask_approval(e, now) do
    day = today(now)

    if e["approval_asked"] == day do
      e
    else
      post(e, %{
        "priority" => 2,
        "key" => "budget",
        "text" =>
          "Budget reached: #{amount(e, spent(e, now))} of #{amount(e, cap(e, now))} used today. Approve more on its page, or it rests until tomorrow."
      })

      Map.put(e, "approval_asked", day)
    end
  end

  defp stop_work(e) do
    if working?(e), do: Agent.interrupt(e["work_session"])
  catch
    :exit, _ -> :ok
  end

  defp working?(e) do
    with id when is_binary(id) <- e["work_session"],
         true <- Agent.exists?(id),
         %{status: status} <- Agent.info(id) do
      status in [:starting, :running]
    else
      _ -> false
    end
  catch
    :exit, _ -> false
  end

  defp too_long?(e, now),
    do:
      is_integer(e["turn_started_at"]) and now - e["turn_started_at"] > e["max_turn_min"] * 60_000

  defp min_gap(e), do: e["min_gap_min"] * 60_000

  # ── Sessions ────────────────────────────────────────────────────────────

  defp ensure_sessions(e) do
    Enum.reduce_while(
      [{"chat_session", "employee_chat"}, {"work_session", "employee_work"}],
      {:ok, e},
      fn
        {key, kind}, {:ok, e} ->
          id = e[key]

          result =
            cond do
              is_binary(id) and Agent.exists?(id) ->
                {:ok, id}

              is_binary(id) and match?({:ok, _}, Agent.Store.read_meta(id)) ->
                with {:ok, _} <- Agent.restore_session(id), do: {:ok, id}

              true ->
                start_session(e, kind)
            end

          case result do
            {:ok, id} -> {:cont, {:ok, Map.put(e, key, id)}}
            error -> {:halt, error}
          end
      end
    )
  end

  defp start_session(e, kind, extra \\ []) do
    id = Agent.new_id()
    # Before it starts: its first spawn already has the hook, or not.
    write_guard(e, id)
    title = if kind == "employee_chat", do: "#{e["name"]} · chat", else: "#{e["name"]} · work"

    {:ok, backend} = Agent.Backend.parse(e["backend"] || "claude_code")
    model = if e["model"] in [nil, ""], do: nil, else: e["model"]

    opts =
      [backend: backend, kind: kind, employee: e["id"], title: title, cwd: workspace(e["id"])] ++
        extra ++
        case backend do
          :claude_code -> [model: model]
          :kiro -> [kiro_model: model]
          :codex -> []
        end

    case Agent.start_session(id, opts) do
      {:ok, _pid} -> {:ok, id}
      error -> error
    end
  end

  defp by_session(state, session) do
    Enum.find_value(state.employees, fn {_, e} ->
      cond do
        e["work_session"] == session -> {e, "employee_work"}
        e["chat_session"] == session -> {e, "employee_chat"}
        true -> nil
      end
    end)
  end

  # ── Time and money ──────────────────────────────────────────────────────

  defp now, do: System.system_time(:millisecond)

  defp local(now), do: DateTime.from_unix!(div(now, 1000) + @offset * 60)

  @doc false
  def today(now), do: now |> local() |> DateTime.to_date() |> Date.to_iso8601()

  @doc false
  def week(now) do
    {year, week} =
      now |> local() |> DateTime.to_date() |> Date.to_erl() |> :calendar.iso_week_number()

    "#{year}-W#{String.pad_leading(to_string(week), 2, "0")}"
  end

  defp minutes_today(now) do
    t = local(now)
    t.hour * 60 + t.minute
  end

  defp clock(text) when is_binary(text) do
    with [_, h, m] <- Regex.run(~r/^(\d{1,2}):(\d{2})$/, text),
         {h, m} when h < 24 and m < 60 <- {String.to_integer(h), String.to_integer(m)} do
      h * 60 + m
    else
      _ -> nil
    end
  end

  defp clock(_), do: nil

  defp past_today?(time, now), do: (m = clock(time)) != nil and minutes_today(now) >= m

  defp report_due?(e, :weekly, now) do
    w = e["weekly_report"] || %{}
    day = now |> local() |> DateTime.to_date() |> Date.day_of_week()

    day == w["day"] and past_today?(w["time"], now) and e["last_weekly"] != week(now) and
      e["last_wake_at"] != nil
  end

  defp in_hours?(%{"hours" => [from, to]}, now) when from != to do
    h = local(now).hour
    if from < to, do: h >= from and h < to, else: h >= from or h < to
  end

  defp in_hours?(_e, _now), do: true

  # Dollars where the backend says what a turn cost (Claude Code); turns where
  # it does not. What the boss approves on top is in the same unit.
  @doc false
  def unit(e), do: if((e["backend"] || "claude_code") == "claude_code", do: "usd", else: "turns")

  defp spent(e, now) do
    case unit(e) do
      "usd" -> Map.get(e["spend"] || %{}, today(now), 0) * 1.0
      "turns" -> Map.get(e["turns"] || %{}, today(now), 0) * 1.0
    end
  end

  defp cap(e, now) do
    budget = if unit(e) == "usd", do: e["budget_usd"], else: e["budget_turns"]
    budget * 1.0 + Map.get(e["extra"] || %{}, today(now), 0)
  end

  defp over_budget?(e, now), do: spent(e, now) >= cap(e, now)

  @doc false
  # An amount in the employee's budget unit, for people and prompts.
  def amount(e, n) do
    case unit(e) do
      "usd" -> "$" <> :erlang.float_to_binary(n * 1.0, decimals: 2)
      "turns" -> "#{round(n)} turns"
    end
  end

  # ── KPIs ────────────────────────────────────────────────────────────────

  defp new_kpi(attrs) do
    attrs = Map.new(attrs, fn {k, v} -> {to_string(k), v} end)
    title = attrs["title"]

    if blank?(title) do
      {:error, "a KPI needs a title"}
    else
      kpi = %{
        "id" => "k_" <> (:crypto.strong_rand_bytes(4) |> Base.url_encode64(padding: false)),
        "title" => String.trim(title),
        "detail" => text(attrs["detail"]),
        "criteria" => text(attrs["criteria"]),
        "due" => text(attrs["due"]),
        "priority" => if(attrs["priority"] in @priorities, do: attrs["priority"], else: "normal"),
        "progress" => 0,
        "status" => "todo",
        "note" => nil,
        "created_at" => now(),
        "updated_at" => now()
      }

      {:ok, kpi}
    end
  end

  # `boss?`: the user may change anything; the employee only its progress,
  # status (short of done) and note.
  defp change_kpi(e, kpi_id, attrs, boss?) do
    attrs = Map.new(attrs, fn {k, v} -> {to_string(k), v} end)

    keys =
      if boss?,
        do: ~w(title detail criteria due priority progress status note),
        else: ~w(progress status note)

    case Enum.find_index(e["kpis"], &(&1["id"] == kpi_id)) do
      nil ->
        {:error, :not_found}

      i ->
        kpi = Enum.at(e["kpis"], i)

        kpi =
          Enum.reduce(Map.take(attrs, keys), kpi, fn
            {"progress", p}, k when is_number(p) ->
              Map.put(k, "progress", p |> round() |> max(0) |> min(100))

            {"status", s}, k when s in @kpi_statuses ->
              Map.put(k, "status", s)

            {"priority", p}, k when p in @priorities ->
              Map.put(k, "priority", p)

            {"title", t}, k when is_binary(t) and t != "" ->
              Map.put(k, "title", String.trim(t))

            {key, v}, k when key in ~w(detail criteria due note) ->
              Map.put(k, key, text(v))

            _, k ->
              k
          end)
          |> Map.put("updated_at", now())

        {:ok, Map.put(e, "kpis", List.replace_at(e["kpis"], i, kpi))}
    end
  end

  # ── Hiring and changing ─────────────────────────────────────────────────

  # `keys`: what `attrs` may set — the settings page's, or a setup chat's.
  defp hire(state, attrs, keys) do
    now = now()
    id = "e_" <> (:crypto.strong_rand_bytes(6) |> Base.url_encode64(padding: false))

    with {:ok, backend} <- hire_backend(attrs),
         base =
           Map.merge(@defaults, %{
             "name" => nil,
             "backend" => backend,
             "model" => @models[backend]
           }),
         {:ok, settings} <- settings(base, attrs, keys),
         :ok <- if(blank?(settings["name"]), do: {:error, "an employee needs a name"}, else: :ok) do
      e =
        settings
        |> Map.merge(%{
          "id" => id,
          "created_at" => now,
          "kpis" => [],
          "log" => [],
          "inbox" => [],
          "spend" => %{},
          "turns" => %{},
          "extra" => %{},
          # The first wake-up is right away: it introduces itself and looks around.
          "wake_at" => now,
          "wake_reason" => "first day",
          "last_weekly" => nil
        })

      File.mkdir_p!(workspace(id))
      write_files(e, state.boss)

      with {:ok, chat} <- start_session(e, "employee_chat"),
           {:ok, work} <- start_session(e, "employee_work") do
        e = Map.merge(e, %{"chat_session" => chat, "work_session" => work})
        {{:ok, view(e)}, put(state, e)}
      else
        error -> {error, state}
      end
    else
      error -> {error, state}
    end
  end

  defp change(state, id, attrs, keys) do
    with {:ok, e} <- fetch(state, id),
         {:ok, settings} <- settings(e, attrs, keys) do
      changed = Map.take(settings, @setup) != Map.take(e, @setup)
      moved = settings["workstation"] != e["workstation"]
      bound = settings["permissions"] != e["permissions"]
      e = Map.merge(e, settings)
      e = if moved, do: e |> Map.merge(%{"offline_since" => nil}) |> refresh_station(), else: e

      e =
        if changed,
          do: note(e, "Your settings were changed by the boss; see the wake-up below."),
          else: e

      state = put(state, e)
      if moved, do: moved_station(e)
      if bound and not moved, do: new_permissions(e)
      {{:ok, view(e)}, state}
    else
      error -> {error, state}
    end
  end

  # Its sessions start again with the new flags; both hear what they are.
  defp new_permissions(e) do
    text =
      case e["permissions"] do
        %{"summary" => summary} ->
          "[Loom: the boss changed your permissions. From now on: #{summary} Loom enforces them; what they refuse shows in your updates. See .employee/status.md.]"

        _ ->
          "[Loom: the boss lifted your permissions: you may use every tool again.]"
      end

    for s <- [e["chat_session"], e["work_session"]], is_binary(s) do
      try do
        if Agent.exists?(s) do
          Agent.tell(s, text)
          Agent.reload_backend(s)
        end
      catch
        :exit, _ -> :ok
      end
    end
  end

  # A setup chat's turn ended: the last `loom-employee` block in its reply is
  # an employee to hire, or with an `id`, the settings to change in one.
  # Saved or not, the chat says so, to the user and to the agent.
  defp setup(state, session, text) do
    with [_ | _] = blocks <- Regex.scan(@setup_fence, text || ""),
         [_, body] = List.last(blocks) do
      {reply, state} =
        case Jason.decode(body) do
          {:ok, %{"id" => id} = attrs} when is_binary(id) -> change(state, id, attrs, @setup)
          {:ok, %{} = attrs} -> hire(state, attrs, @setup)
          _ -> {{:error, "the loom-employee block is not a JSON object"}, state}
        end

      {note, tell} =
        case reply do
          {:ok, v} ->
            {"Saved: #{v["name"]} (#{v["id"]})#{if v["permissions"], do: ", restricted", else: ""}",
             "[Loom: saved #{v["name"]}, id #{v["id"]}.]"}

          {:error, why} ->
            why = if is_binary(why), do: why, else: inspect(why)
            {"Not saved: " <> why, "[Loom: the loom-employee block was not saved: #{why}]"}
        end

      Task.start(fn ->
        try do
          Agent.note(session, note)
          Agent.tell(session, tell)
        catch
          :exit, _ -> :ok
        end
      end)

      state
    else
      _ -> state
    end
  end

  # ── Settings ────────────────────────────────────────────────────────────

  defp settings(base, attrs, keys) do
    attrs = Map.new(attrs, fn {k, v} -> {to_string(k), v} end) |> Map.take(keys)

    attrs
    |> Enum.reduce_while({:ok, base}, fn {key, value}, {:ok, acc} ->
      case setting(key, value) do
        {:ok, v} -> {:cont, {:ok, Map.put(acc, key, v)}}
        {:error, why} -> {:halt, {:error, why}}
      end
    end)
    |> case do
      {:ok, %{"permissions" => %{}, "backend" => b}} when b != "claude_code" ->
        {:error,
         "permissions need a Claude Code employee: Kiro and Codex cannot be held to them, so Loom will not pretend"}

      result ->
        result
    end
  end

  defp setting(key, v) when key in ~w(name role persona language model) do
    cond do
      is_binary(v) and String.length(v) <= 20_000 -> {:ok, String.trim(v)}
      true -> {:error, "#{key} is text"}
    end
  end

  defp setting("workstation", w) when w in [nil, ""], do: {:ok, nil}

  defp setting("workstation", id) when is_binary(id) do
    if Enum.any?(Loom.Nodes.list(), &(&1.id == id)),
      do: {:ok, id},
      else: {:error, "no such device"}
  catch
    :exit, _ -> {:error, "devices are not available"}
  end

  defp setting("project_ids", ids) when is_list(ids) do
    if Enum.all?(ids, &match?({:ok, _}, Loom.Projects.get(&1))),
      do: {:ok, Enum.uniq(ids)},
      else: {:error, "no such project"}
  end

  defp setting("hours", nil), do: {:ok, nil}

  defp setting("hours", [from, to] = h) when from in 0..23 and to in 0..24 and from != to,
    do: {:ok, h}

  defp setting(key, n)
       when key in ~w(heartbeat_min min_gap_min max_turn_min) and is_integer(n) and n >= 1 and
              n <= 10_080,
       do: {:ok, n}

  defp setting("budget_usd", n) when is_number(n) and n >= 0, do: {:ok, n}
  defp setting("budget_turns", n) when is_integer(n) and n >= 0, do: {:ok, n}

  defp setting("weekly_report", %{"day" => d, "time" => t}) when d in 1..7 do
    if clock(t),
      do: {:ok, %{"day" => d, "time" => t}},
      else: {:error, "weekly_report time is HH:MM"}
  end

  defp setting("ask_first", list) when is_list(list),
    do:
      {:ok,
       list |> Enum.filter(&is_binary/1) |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))}

  defp setting("permissions", nil), do: {:ok, nil}

  defp setting("permissions", %{} = p) do
    strings? = fn key -> is_list(p[key] || []) and Enum.all?(p[key] || [], &is_binary/1) end

    cond do
      not (is_list(p["tools"]) and strings?.("tools")) ->
        {:error, "permissions.tools is a list of Claude Code tool names"}

      not (strings?.("allow") and strings?.("deny")) ->
        {:error, "permissions.allow and .deny are lists of rules"}

      not is_boolean(Map.get(p, "mcp", false)) ->
        {:error, "permissions.mcp is true or false"}

      blank?(p["summary"]) ->
        {:error, "permissions need a summary for the boss, in words"}

      true ->
        {:ok,
         %{
           "tools" => Enum.uniq(p["tools"]),
           "allow" => p["allow"] || [],
           "deny" => p["deny"] || [],
           "mcp" => Map.get(p, "mcp", false),
           "summary" => String.trim(p["summary"])
         }}
    end
  end

  defp setting(key, _v), do: {:error, "#{key} is not valid"}

  # The backend, at hiring only: the sessions are bound to it for good.
  defp hire_backend(attrs) do
    case attrs["backend"] || attrs[:backend] || "claude_code" do
      b when b in ["claude_code", "kiro", "codex"] -> {:ok, b}
      _ -> {:error, "backend is claude_code, kiro or codex"}
    end
  end

  defp positive(n) when is_number(n) and n > 0, do: {:ok, n}

  defp positive(n) when is_binary(n) do
    case Float.parse(n) do
      {f, _} when f > 0 -> {:ok, f}
      _ -> {:error, "an amount in dollars"}
    end
  end

  defp positive(_), do: {:error, "an amount in dollars"}

  # ── State ───────────────────────────────────────────────────────────────

  defp fetch(state, id) do
    case state.employees[id] do
      nil -> {:error, :not_found}
      e -> {:ok, e}
    end
  end

  # Kept, written, mirrored for the agents, and told to the sidebar.
  defp put(state, %{"boss_new" => [_ | _] = new} = e) do
    state = put(state, Map.delete(e, "boss_new"))

    Enum.reduce(new, state, fn item, state ->
      {state, _entry} = learn(state, item, e, item["session"])
      state
    end)
  end

  defp put(state, e) do
    old = state.employees[e["id"]]
    e = Map.delete(e, "boss_new")
    state = %{state | employees: Map.put(state.employees, e["id"], e)}

    if old != e do
      save(state)
      write_files(e, state.boss)
      Phoenix.PubSub.broadcast(Loom.PubSub, Agent.lobby_topic(), {:employee_summary, view(e)})
    end

    state
  end

  # ── The workstation ─────────────────────────────────────────────────────

  # Its device's name and whether it is online, from `Loom.Nodes`; a device
  # removed keeps the name it had, and is offline for good.
  defp refresh_station(%{"workstation" => nil} = e),
    do: Map.merge(e, %{"workstation_name" => nil, "station_online" => nil})

  defp refresh_station(e) do
    node =
      try do
        Enum.find(Loom.Nodes.list(), &(&1.id == e["workstation"]))
      catch
        :exit, _ -> nil
      end

    Map.merge(e, %{
      "workstation_name" => (node && node.name) || e["workstation_name"],
      "station_online" => node != nil and node.online == true
    })
  end

  # Not woken, so nothing spent; the boss told once it has been a heartbeat.
  defp offline(e, now) do
    since = e["offline_since"] || now
    e = Map.put(e, "offline_since", since)

    if now - since >= e["heartbeat_min"] * 60_000 and e["offline_told"] != since do
      post(e, %{
        "priority" => 4,
        "key" => "workstation",
        "text" =>
          "Its workstation #{e["workstation_name"] || "?"} has been offline for #{div(now - since, 60_000)} min, so #{e["name"]} has stopped. It carries on once the device is back."
      })

      Map.put(e, "offline_told", since)
    else
      e
    end
  end

  defp back_online(%{"offline_since" => since} = e) when is_integer(since) do
    if e["station_online"] or e["workstation"] == nil do
      if e["offline_told"] == since, do: withdraw(e, "workstation")
      Map.merge(e, %{"offline_since" => nil, "offline_told" => nil})
    else
      e
    end
  end

  defp back_online(e), do: e

  defp withdraw(e, key) do
    Loom.Notices.withdraw(e["id"], key)
  catch
    :exit, _ -> :ok
  end

  # Its sessions start again with the hook, or without; the chat hears of it.
  defp moved_station(e) do
    text =
      if e["workstation"],
        do:
          "[Loom: your workstation is now #{e["workstation_name"]}. You have the run of it, through loom-node; on this server, only your own notes and looking things up (web search and fetch, MCP tools). See .employee/status.md.]",
        else: "[Loom: you no longer have a workstation; you work on this server again.]"

    for s <- [e["chat_session"], e["work_session"]], is_binary(s) do
      try do
        if Agent.exists?(s) do
          Agent.tell(s, text)
          Agent.reload_backend(s)
        end
      catch
        :exit, _ -> :ok
      end
    end
  end

  # The guard's rules for one of its sessions: none without a workstation or
  # permissions.
  defp write_guard(%{"workstation" => nil, "permissions" => nil}, session),
    do: Guard.put(session, nil)

  defp write_guard(e, session) do
    ws = workspace(e["id"])
    # Claude Code keeps its memory for a directory under ~/.claude/projects.
    memory = Path.expand("~/.claude/projects/" <> String.replace(ws, ~r/[^a-zA-Z0-9]/, "-"))
    skills = Path.expand("~/.claude/skills")

    Guard.put(session, %{
      workstation: e["workstation_name"],
      workspace: ws,
      writes: [memory],
      reads: [memory, skills, Path.expand("~/.kiro/skills"), dir(e["id"])],
      log: Path.join(dir(e["id"]), "blocked.jsonl"),
      permissions: e["permissions"],
      # What every employee with permissions may do whatever they say: keep
      # its notes and memory, read its skills and its own files, and post to
      # the bell. Nothing that could change its own settings.
      allow_own:
        for(d <- [ws, memory], t <- ~w(Read Write Edit), do: "#{t}(/#{d}/**)") ++
          for(d <- [dir(e["id"]), skills], do: "Read(/#{d}/**)") ++
          ["Bash(loom-notice:*)"]
    })
  rescue
    error -> Logger.warning("Loom.Employees: cannot write #{session}'s guard: #{inspect(error)}")
  end

  defp learn(state, item, e, session) do
    now = now()
    norm = &(&1 |> String.downcase() |> String.replace(~r/[\s[:punct:]。，、；：！？]+/u, ""))
    old = item["replaces"] && Enum.find(state.boss, &(&1["id"] == item["replaces"]))

    case Enum.find(state.boss, &(norm.(&1["text"]) == norm.(item["text"]))) do
      %{} = same ->
        {state, same}

      nil ->
        entry = %{
          "id" =>
            (old && old["id"]) ||
              "b_" <> (:crypto.strong_rand_bytes(4) |> Base.url_encode64(padding: false)),
          "text" => item["text"],
          "by" => e && e["id"],
          "by_name" => e && e["name"],
          "at" => now
        }

        {boss, change} =
          if old,
            do:
              {List.replace_at(state.boss, Enum.find_index(state.boss, &(&1 == old)), entry),
               "- changed: " <> old["text"] <> " → " <> entry["text"]},
            else: {Enum.take(state.boss ++ [entry], -@boss_kept), "- added: " <> entry["text"]}

        {boss_changed(%{state | boss: boss}, [change], session), entry}
    end
  end

  # Saved, mirrored into every employee's status and for Sleep, and told to
  # the chats (but the one it was heard in), which see no wake-up.
  defp boss_changed(state, changes, from) do
    save(state)
    Enum.each(Map.values(state.employees), &write_files(&1, state.boss))
    write_boss(state.boss)

    text =
      "[Loom: the boss profile, shared by all employees, changed. Follow it from now on:]\n" <>
        Enum.join(changes, "\n")

    for {_, e} <- state.employees, s = e["chat_session"], is_binary(s), s != from do
      try do
        if Agent.exists?(s), do: Agent.tell(s, text)
      catch
        :exit, _ -> :ok
      end
    end

    state
  end

  defp write_boss(boss) do
    File.write!(
      boss_path(),
      "# The boss profile\n\nKept by Loom for the virtual employees; edit it in Loom's Settings, not here.\n\n" <>
        Enum.map_join(boss, "\n", &("- " <> &1["text"])) <> "\n"
    )
  rescue
    error -> Logger.warning("Loom.Employees: cannot write #{boss_path()}: #{inspect(error)}")
  end

  defp boss_text(text) when is_binary(text) do
    case text |> String.trim() |> String.replace(~r/\s*\n\s*/, " ") do
      "" -> nil
      t -> String.slice(t, 0, @boss_chars)
    end
  end

  defp boss_text(_), do: nil

  defp note(e, text), do: Map.update(e, "inbox", [text], &(&1 ++ [text]))

  defp projects(e) do
    for id <- e["project_ids"] || [], {:ok, p} <- [Loom.Projects.get(id)] do
      %{
        id: p.id,
        name: p.name,
        workspace: Loom.Projects.workspace(p),
        instructions: p.instructions
      }
    end
  end

  @doc false
  # What the page shows: the record, less its bookkeeping, plus where it stands.
  def view(e) do
    now = now()

    status =
      cond do
        e["paused"] -> "paused"
        e["workstation"] && e["station_online"] != true -> "offline"
        over_budget?(e, now) -> "approval"
        working?(e) -> "working"
        match?(%{"level" => "urgent"}, e["attention"]) -> "blocked"
        true -> "sleeping"
      end

    e
    |> Map.drop(["inbox", "spend", "turns", "extra", "approval_asked", "fresh", "turn_reason"])
    |> Map.merge(%{
      "status" => status,
      "spent_today" => spent(e, now),
      "cap_today" => cap(e, now),
      "budget_unit" => unit(e),
      # Dollars, where the backend reports them, whatever the unit.
      "usd_today" => Map.get(e["spend"] || %{}, today(now), 0) * 1.0,
      "spend_days" => e["spend"] || %{},
      "turn_days" => e["turns"] || %{},
      "projects" => Enum.map(projects(e), &Map.take(&1, [:id, :name])),
      "workspace" => workspace(e["id"]),
      "pending_notes" => length(e["inbox"] || [])
    })
    |> Map.drop(["station_online", "offline_since", "offline_told"])
  end

  # Its system prompts, which a session reads as it starts (see
  # `Loom.Employees.Prompt.system/2`), and the mirror of where it stands.
  defp write_files(e, boss) do
    File.mkdir_p!(Path.join(workspace(e["id"]), ".employee"))
    for s <- [e["chat_session"], e["work_session"]], is_binary(s), do: write_guard(e, s)

    File.write!(
      Path.join(dir(e["id"]), "system_employee_work.md"),
      Prompt.system_text(e, "employee_work", boss)
    )

    File.write!(
      Path.join(dir(e["id"]), "system_employee_chat.md"),
      Prompt.system_text(e, "employee_chat", boss)
    )

    now = now()

    File.write!(
      Path.join([workspace(e["id"]), ".employee", "status.md"]),
      Prompt.status(e, %{
        now: now,
        offset: @offset,
        spent: spent(e, now),
        spent_text: amount(e, spent(e, now)),
        cap: cap(e, now),
        projects: projects(e),
        workspace: workspace(e["id"]),
        today: today(now),
        week: week(now),
        boss: boss
      })
    )
  rescue
    error -> Logger.warning("Loom.Employees: cannot write #{e["id"]}'s files: #{inspect(error)}")
  end

  defp load(path) do
    with {:ok, body} <- File.read(path),
         {:ok, %{"employees" => list} = all} when is_list(list) <- Jason.decode(body) do
      {Map.new(list, fn e -> {e["id"], upgrade(Map.merge(@defaults, e))} end), all["boss"] || []}
    else
      {:error, :enoent} ->
        {%{}, []}

      other ->
        Logger.error("Loom.Employees cannot read #{path} (#{inspect(other)}); starting over")
        {%{}, []}
    end
  end

  # The daily report, dropped 2026-10-31: its setting goes, and the employee
  # is told once, since its own notes may still plan one.
  defp upgrade(%{"daily_report" => _} = e) do
    e = Map.drop(e, @dropped)
    if @daily_gone in (e["inbox"] || []), do: e, else: note(e, @daily_gone)
  end

  defp upgrade(e), do: e

  defp save(state) do
    File.mkdir_p!(Path.dirname(state.path))
    tmp = state.path <> ".tmp"
    list = state.employees |> Map.values() |> Enum.sort_by(& &1["created_at"])
    File.write!(tmp, Jason.encode_to_iodata!(%{employees: list, boss: state.boss}, pretty: true))
    File.rename!(tmp, state.path)
    state
  end

  defp arm(state) do
    if state.timer, do: Process.cancel_timer(state.timer)
    %{state | timer: Process.send_after(self(), :tick, state.tick)}
  end

  defp blank?(v), do: not is_binary(v) or String.trim(v) == ""
  defp text(v) when is_binary(v), do: if(String.trim(v) == "", do: nil, else: String.trim(v))
  defp text(_), do: nil
end
