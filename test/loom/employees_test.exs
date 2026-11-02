defmodule Loom.EmployeesTest do
  # Not async: sessions, the backend map and Loom's home are global.
  use ExUnit.Case, async: false

  alias Loom.Agent
  alias Loom.BackendStub
  alias Loom.Employees
  alias Loom.Employees.Card

  setup do
    dir = Path.join(System.tmp_dir!(), "loom-employees-#{System.unique_integer([:positive])}")
    previous = Application.get_env(:loom, Loom.Agent, [])
    previous_home = Application.get_env(:loom, :home)

    Application.put_env(
      :loom,
      Loom.Agent,
      previous
      |> Keyword.put(:data_dir, Path.join(dir, "sessions"))
      |> Keyword.put(:workspace, Path.join(dir, "home"))
      |> Keyword.put(:backends, %{claude_code: BackendStub, codex: BackendStub, kiro: BackendStub})
    )

    Application.put_env(:loom, :home, dir)
    start_supervised!({BackendStub, notify: self()})

    name = :"employees_#{System.unique_integer([:positive])}"

    start_supervised!(
      {Employees,
       name: name, path: Path.join(dir, "employees.json"), tick: :timer.hours(24), run: true},
      id: name
    )

    on_exit(fn ->
      for %{id: id} <- Agent.list_sessions(), do: Agent.stop_session(id)
      Process.sleep(50)
      Application.put_env(:loom, Loom.Agent, previous)

      if previous_home,
        do: Application.put_env(:loom, :home, previous_home),
        else: Application.delete_env(:loom, :home)

      File.rm_rf(dir)
    end)

    {:ok, server: name, dir: dir}
  end

  # The session says `text` and the turn ends, as Claude Code would.
  defp end_turn(session, text, server) do
    [{pid, _}] = Registry.lookup(Loom.Agent.Registry, session)

    send(
      pid,
      {:stub, [{:event, :assistant_text, %{text: text}}, {:event, :turn_done, %{}}]}
    )

    :sys.get_state(pid)
    :sys.get_state(server)
  end

  defp card(map), do: "Done for now.\n\n```employee-card\n#{Jason.encode!(map)}\n```"

  describe "the card" do
    test "the last block is the card, and only what is shaped right is kept" do
      text = """
      Earlier: ```employee-card
      {"next": "continue"}
      ```
      Later:
      ```employee-card
      {"next": "nap", "summary": "read the docs", "sleep_minutes": 30,
       "report": {"level": "loud", "text": "x"}}
      ```
      """

      assert Card.parse(text) == %{"summary" => "read the docs", "sleep_minutes" => 30}
      assert Card.parse("no card") == %{}
      assert Card.parse("```employee-card\nnot json\n```") == %{}
    end

    test "a wall-clock time is read in the boss's time zone" do
      assert Card.local_time("2026-10-29 09:00", 480) ==
               DateTime.to_unix(~U[2026-10-29 01:00:00Z], :millisecond)

      assert Card.local_time("tomorrow", 480) == nil
    end
  end

  test "hiring makes two hidden sessions in its own workspace, with its standing orders",
       %{server: server, dir: dir} do
    {:ok, e} = Employees.create(%{"name" => "小研", "role" => "researcher"}, server)

    for {key, kind} <- [{"chat_session", "employee_chat"}, {"work_session", "employee_work"}] do
      info = Agent.info(e[key])
      assert info.kind == kind
      assert info.employee_id == e["id"]
    end

    assert e["workspace"] == Path.join([dir, "employees", e["id"], "workspace"])
    assert File.read!(Path.join(e["workspace"], ".employee/status.md")) =~ "小研"
    assert BackendStub.last_meta().instructions =~ "You are 小研, a virtual employee"
    assert BackendStub.last_meta().cc_model == "opus"
    assert e["status"] == "sleeping"
  end

  test "a wake-up is a turn of the work session; its card says what comes next",
       %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小码"}, server)
    {:ok, e} = Employees.add_kpi(e["id"], %{"title" => "Ship the parser"}, server)
    [kpi] = e["kpis"]

    {:ok, _} = Employees.wake(e["id"], "start with the tests", server)
    text = BackendStub.await_turn()
    assert text =~ "[Wake-up from Loom"
    assert text =~ "start with the tests"
    assert text =~ "Ship the parser"

    end_turn(
      e["work_session"],
      card(%{
        "next" => "sleep",
        "sleep_minutes" => 30,
        "summary" => "wrote the tests",
        "kpis" => [%{"id" => kpi["id"], "progress" => 100, "status" => "done"}],
        "report" => %{"level" => "important", "text" => "ready for review"}
      }),
      server
    )

    {:ok, e} = Employees.get(e["id"], server)
    [kpi] = e["kpis"]
    # Done is the boss's to say.
    assert kpi["status"] == "review"
    assert kpi["progress"] == 100
    assert e["attention"]["level"] == "important"
    assert [%{"summary" => "wrote the tests"}] = e["log"]
    # Thirty minutes, as asked: more than the gap, less than the heartbeat.
    assert_in_delta e["wake_at"] - System.system_time(:millisecond), 30 * 60_000, 5_000

    {:ok, e} = Employees.review_kpi(e["id"], kpi["id"], true, nil, server)
    assert [%{"status" => "done"}] = e["kpis"]

    # A later turn with nothing to report leaves the report up until it is seen.
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()
    end_turn(e["work_session"], card(%{"summary" => "daily report"}), server)
    {:ok, e} = Employees.get(e["id"], server)
    assert e["attention"]["text"] == "ready for review"
    {:ok, e} = Employees.seen(e["id"], server)
    assert e["attention"] == nil
  end

  test "a report goes to the bell by its priority, and is listed in later wake-ups",
       %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小报"}, server)
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()

    end_turn(
      e["work_session"],
      card(%{
        "report" => %{
          "priority" => 3,
          "text" => "要不要换供应商？",
          "key" => "supplier",
          "needs" => "reply"
        }
      }),
      server
    )

    assert [n] = Loom.Notices.open_of(e["id"])
    assert n["priority"] == 3 and n["needs"] == "reply" and n["session"] == e["work_session"]
    # Opening it lands on the wake-up that started the turn.
    {:ok, %{events: events}} = Agent.attach(e["work_session"])
    assert %{kind: :user} = Enum.find(events, &(&1.seq == n["anchor"]))
    {:ok, e2} = Employees.get(e["id"], server)
    assert e2["attention"]["level"] == "important"

    {:ok, _} = Employees.wake(e["id"], nil, server)
    assert BackendStub.await_turn() =~ "[supplier] priority 3"
    end_turn(e["work_session"], card(%{"withdraw" => ["supplier"]}), server)
    assert Loom.Notices.open_of(e["id"]) == []
  end

  test "a weekly report's turn rings no bell", %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小日"}, server)
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()

    :sys.replace_state(server, fn st ->
      put_in(st.employees[e["id"]]["turn_reason"], "weekly_report")
    end)

    end_turn(
      e["work_session"],
      card(%{"report" => %{"priority" => 3, "text" => "周报写好了"}}),
      server
    )

    assert Loom.Notices.open_of(e["id"]) == []
    {:ok, e} = Employees.get(e["id"], server)
    assert e["attention"] == nil
  end

  test "a long work session is turned over, once there is a handoff to carry it",
       %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小轮"}, server)
    first = e["work_session"]
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()
    end_turn(first, card(%{}), server)

    grow = fn ->
      meta = Path.join(Agent.Store.session_dir(first), "meta.json")
      raw = meta |> File.read!() |> Jason.decode!()
      File.write!(meta, Jason.encode!(Map.merge(raw, %{"context_tokens" => 70_000})))
    end

    # No HANDOFF.md yet: it is asked to write one, in the session it has.
    grow.()
    {:ok, _} = Employees.wake(e["id"], nil, server)
    assert BackendStub.await_turn() =~ "write HANDOFF.md"
    end_turn(first, card(%{}), server)
    {:ok, e} = Employees.get(e["id"], server)
    assert e["work_session"] == first

    File.write!(Path.join(Employees.workspace(e["id"]), "HANDOFF.md"), "# Handoff")
    grow.()
    {:ok, _} = Employees.wake(e["id"], nil, server)
    assert BackendStub.await_turn() =~ "A fresh session"
    {:ok, e} = Employees.get(e["id"], server)
    assert e["work_session"] != first
    assert e["past_work"] == [first]
  end

  test "a flagged work session is turned over at the next wake-up, handoff or not",
       %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小拦"}, server)
    first = e["work_session"]
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()
    [{pid, _}] = Registry.lookup(Loom.Agent.Registry, first)
    send(pid, {:stub, [{:event, :flagged, %{category: "cyber", fell_back: false}}]})
    end_turn(first, card(%{}), server)

    {:ok, _} = Employees.wake(e["id"], nil, server)
    prompt = BackendStub.await_turn()
    assert prompt =~ "a safety classifier stopped the model"
    {:ok, e} = Employees.get(e["id"], server)
    assert e["work_session"] != first
    assert e["past_work"] == [first]
  end

  test "the chat is new each day, and at once when flagged; not mid-conversation",
       %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小聊"}, server)
    # Paused, so no wake-up's turn gets in the way; the chat turns over anyway.
    {:ok, e} = Employees.pause(e["id"], true, server)
    first = e["chat_session"]
    run = fn now -> :sys.replace_state(server, &Employees.run(&1, e["id"], now)) end
    chat = fn -> elem(Employees.get(e["id"], server), 1)["chat_session"] end

    # Unused: kept, whatever the day.
    run.(System.system_time(:millisecond) + :timer.hours(48))
    assert chat.() == first

    {:ok, _} = Agent.submit(first, "hi")
    BackendStub.await_turn()
    end_turn(first, "hello boss", server)

    # The same day: kept. The next: a new one, which may look back.
    run.(System.system_time(:millisecond) + :timer.minutes(40))
    assert chat.() == first
    run.(System.system_time(:millisecond) + :timer.hours(24))
    second = chat.()
    assert second != first
    {:ok, e} = Employees.get(e["id"], server)
    assert e["past_chat"] == [first]

    {:ok, _} = Agent.submit(second, "and now?")
    prompt = BackendStub.await_turn()
    assert prompt =~ "loom-session read #{first}"
    [{pid, _}] = Registry.lookup(Loom.Agent.Registry, second)
    send(pid, {:stub, [{:event, :flagged, %{category: nil, fell_back: true}}]})
    end_turn(second, "ok", server)

    # Flagged: new at once, told not to look back.
    run.(System.system_time(:millisecond))
    third = chat.()
    assert third not in [first, second]
    {:ok, _} = Agent.submit(third, "again")
    prompt = BackendStub.await_turn()
    assert prompt =~ "Do not read that earlier session"
  end

  test "a turn's end still in the mailbox is read before waking again", %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小码"}, server)
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()
    # Asked again mid-turn: due as soon as this turn is over.
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.refute_turn()

    # The cost lands first, and the end just after it, as a session sends them.
    :sys.suspend(server)
    send(server, {:turn_cost, e["work_session"], 0.01})
    [{pid, _}] = Registry.lookup(Loom.Agent.Registry, e["work_session"])

    send(
      pid,
      {:stub,
       [
         {:event, :assistant_text, %{text: card(%{"sleep_minutes" => 30})}},
         {:event, :turn_done, %{}}
       ]}
    )

    :sys.get_state(pid)
    :sys.resume(server)
    :sys.get_state(server)

    # The card said sleep, and was read before deciding: no turn on stale state.
    BackendStub.refute_turn()
    {:ok, e} = Employees.get(e["id"], server)
    assert_in_delta e["wake_at"] - System.system_time(:millisecond), 30 * 60_000, 5_000
  end

  test "a turn with no card sleeps until the heartbeat", %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小测", "heartbeat_min" => 90}, server)
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()
    end_turn(e["work_session"], "Nothing to do.", server)

    {:ok, e} = Employees.get(e["id"], server)
    assert_in_delta e["wake_at"] - System.system_time(:millisecond), 90 * 60_000, 5_000
  end

  test "the chat writes down KPIs and can wake the work session", %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小研"}, server)
    {:ok, _} = Agent.submit(e["chat_session"], "please research X by Friday")
    BackendStub.await_turn()

    end_turn(
      e["chat_session"],
      card(%{
        "kpi_add" => [%{"title" => "Research X", "due" => "2026-10-30", "priority" => "high"}],
        "note_for_work" => "focus on the 2026 papers",
        "wake_now" => true
      }),
      server
    )

    {:ok, e} = Employees.get(e["id"], server)
    assert [%{"title" => "Research X", "priority" => "high", "status" => "todo"}] = e["kpis"]
    assert e["pending_notes"] == 1
    assert e["wake_at"] <= System.system_time(:millisecond)
  end

  test "the boss profile: heard by one, followed by all, kept by the boss", %{
    server: server,
    dir: dir
  } do
    {:ok, a} = Employees.create(%{"name" => "钱多多"}, server)
    {:ok, b} = Employees.create(%{"name" => "狄仁杰"}, server)

    # Told once, in one chat; job rules stay out because the employee leaves them out.
    {:ok, _} = Agent.submit(a["chat_session"], "以后回复都用中文")
    BackendStub.await_turn()
    end_turn(a["chat_session"], card(%{"boss" => ["回复一律用中文", "  "]}), server)

    assert [%{"text" => "回复一律用中文", "by_name" => "钱多多", "id" => id} = line] =
             Employees.boss(server)

    assert is_integer(line["at"])
    assert File.read!(Path.join(dir, "boss.md")) =~ "回复一律用中文"

    # The same line again is nothing new.
    {:ok, _} = Agent.submit(a["chat_session"], "记住了吗")
    BackendStub.await_turn()
    end_turn(a["chat_session"], card(%{"boss" => ["回复一律用中文。"]}), server)
    assert [_] = Employees.boss(server)

    # The other one wakes with it; its chat is told ahead of the next message.
    {:ok, _} = Employees.wake(b["id"], nil, server)
    text = BackendStub.await_turn()
    assert text =~ "## The boss profile"
    assert text =~ "回复一律用中文 ("
    assert text =~ "told 钱多多"
    end_turn(b["work_session"], card(%{}), server)

    {:ok, _} = Agent.submit(b["chat_session"], "hi")
    assert BackendStub.await_turn() =~ "added: 回复一律用中文"

    # Someone hired later has it from the start.
    {:ok, c} = Employees.create(%{"name" => "姬大力"}, server)
    assert File.read!(Path.join(Employees.dir(c["id"]), "system_employee_chat.md")) =~ "回复一律用中文"

    assert File.read!(Path.join([Employees.workspace(c["id"]), ".employee", "status.md"])) =~
             "回复一律用中文"

    # The boss changes, adds, deletes; the next wake-up has it so.
    {:ok, _} = Employees.update_boss(id, "回复用简体中文", server)
    {:ok, _} = Employees.add_boss("默认用 Opus", server)

    assert [%{"id" => ^id, "text" => "回复用简体中文", "by" => nil}, %{"text" => "默认用 Opus"} = opus] =
             Employees.boss(server)

    :ok = Employees.delete_boss(opus["id"], server)
    {:ok, _} = Employees.wake(c["id"], nil, server)
    text = BackendStub.await_turn()
    assert text =~ "回复用简体中文"
    refute text =~ "默认用 Opus"

    # A line replaced by the employee keeps its place.
    end_turn(
      c["work_session"],
      card(%{"boss" => [%{"text" => "回复用中文，术语可留英文", "replaces" => id}]}),
      server
    )

    assert [%{"id" => ^id, "text" => "回复用中文，术语可留英文", "by_name" => "姬大力"}] = Employees.boss(server)

    # And it survives a restart.
    assert [%{"id" => ^id}] =
             Path.join(dir, "employees.json")
             |> File.read!()
             |> Jason.decode!()
             |> Map.get("boss")
  end

  test "a workstation: its sessions are guarded, offline it does not wake, refusals show in Updates",
       %{server: server} do
    {:ok, node, _code} = Loom.Nodes.create("emp-ws-#{System.unique_integer([:positive])}")
    on_exit(fn -> Loom.Nodes.delete(node.id) end)

    {:ok, e} = Employees.create(%{"name" => "钱多多"}, server)
    # None by default, as before: no guard, no hook.
    refute Loom.Agent.Guard.guarded?(e["chat_session"])

    assert {:error, "no such device"} =
             Employees.update(e["id"], %{"workstation" => "n_nope"}, server)

    {:ok, e} = Employees.update(e["id"], %{"workstation" => node.id}, server)
    assert e["workstation_name"] == node.name
    assert e["status"] == "offline"

    for s <- [e["chat_session"], e["work_session"]] do
      rules = Loom.Agent.Guard.path(s) |> File.read!() |> Jason.decode!()
      assert rules["workstation"] == node.name
      assert rules["workspace"] == Employees.workspace(e["id"])
    end

    # Offline: woken, it does not start a turn.
    {:ok, _} = Employees.wake(e["id"], nil, server)
    refute_receive {:stub_turn, _}, 200

    # Online: it wakes, told where it works; what the guard refused shows in Updates.
    channel = spawn(fn -> Process.sleep(:infinity) end)
    {:ok, _} = Loom.Nodes.connected(node.id, channel, %{})
    {:ok, _} = Employees.wake(e["id"], nil, server)
    text = BackendStub.await_turn()
    assert text =~ "## Your workstation: #{node.name}"
    assert text =~ "loom-node exec #{node.name}"

    File.write!(
      Path.join(Employees.dir(e["id"]), "blocked.jsonl"),
      Jason.encode!(%{at: 1, tool: "Bash", what: "rm -rf build", why: "x"}) <> "\n"
    )

    end_turn(e["work_session"], card(%{}), server)
    {:ok, %{events: events}} = Agent.attach(e["work_session"])
    assert Enum.any?(events, &(&1.kind == :loom_note and &1.payload.text =~ "rm -rf build"))

    # Taken away: as before.
    {:ok, e} = Employees.update(e["id"], %{"workstation" => nil}, server)
    refute Loom.Agent.Guard.guarded?(e["work_session"])
    assert e["workstation_name"] == nil
    Process.exit(channel, :kill)
  end

  @mail_only %{
    "tools" => ["Bash", "Read", "Write", "Skill"],
    "allow" => ["Bash(m365 email_inbox:*)", "Bash(m365 email_read:*)"],
    "deny" => ["Bash(m365 * --confirm*)"],
    "summary" => "只能读工作邮件"
  }

  # A setup chat: the boss and an agent agree, its reply ends with the block.
  defp setup_chat(server) do
    id = Agent.new_id()
    {:ok, _} = Agent.start_session(id, backend: :claude_code, kind: "employee_setup")

    {id,
     fn block ->
       end_turn(id, "Here it is.\n\n```loom-employee\n#{Jason.encode!(block)}\n```", server)
     end}
  end

  defp notes(session) do
    Process.sleep(50)
    {:ok, %{events: events}} = Agent.attach(session)
    for %{kind: :loom_note, payload: %{text: t}} <- events, do: t
  end

  test "permissions: set only from a setup chat, enforced by Claude Code's flags, shown in words",
       %{server: server} do
    {chat, say} = setup_chat(server)
    say.(%{"name" => "分拣员", "role" => "读工作邮件", "permissions" => @mail_only})
    assert Enum.any?(notes(chat), &(&1 =~ "Saved: 分拣员" and &1 =~ "restricted"))

    [e] = for e <- Employees.list(server), e["name"] == "分拣员", do: e
    assert e["permissions"]["summary"] == "只能读工作邮件"

    # The chat is the boss talking to it: an ordinary session.
    refute Loom.Agent.Guard.guarded?(e["chat_session"])

    assert Loom.Agent.Guard.claude_args(e["chat_session"]) == [
             "--permission-mode",
             "bypassPermissions"
           ]

    for s <- [e["work_session"]] do
      args = Loom.Agent.Guard.claude_args(s)
      assert ["--permission-mode", "dontAsk"] = Enum.slice(args, 0, 2)
      assert "Bash,Read,Write,Skill" in args
      assert "--strict-mcp-config" in args
      assert "Bash(m365 * --confirm*)" in args
      # Its own notes, and the bell; never Loom's own tools.
      assert "Write(/#{Employees.workspace(e["id"])}/**)" in args
      assert "Bash(loom-notice:*)" in args
      # Claude Code's memory directory: every character but letters and digits is a dash.
      memory = String.replace(Employees.workspace(e["id"]), ~r/[^a-zA-Z0-9]/, "-")
      assert "Write(/#{Path.expand("~/.claude/projects/" <> memory)}/**)" in args
      refute Enum.any?(args, &(&1 =~ "loom rpc" or &1 =~ "curl" or &1 == "Bash"))
    end

    assert File.read!(Path.join([Employees.workspace(e["id"]), ".employee", "status.md"])) =~
             "## Your permissions (enforced in your work session)\n\n只能读工作邮件"

    # MCP tools one by one: with one allowed, the servers load, and the rest
    # of their tools are refused by dontAsk.
    say.(%{
      "id" => e["id"],
      "permissions" =>
        Map.update!(@mail_only, "allow", &(&1 ++ ["mcp__aws-docs__search_documentation"]))
    })

    args = Loom.Agent.Guard.claude_args(e["work_session"])
    assert "mcp__aws-docs__search_documentation" in args
    refute "--strict-mcp-config" in args
    refute Loom.Agent.Guard.guarded?(e["chat_session"])

    # The settings page cannot set them.
    {:ok, same} = Employees.update(e["id"], %{"permissions" => nil, "role" => "x"}, server)
    assert same["permissions"]["summary"] == "只能读工作邮件"

    # A refusal is a line in its Updates.
    Loom.Agent.Guard.denied(e["work_session"], "Bash", %{"command" => "curl evil.example"})
    end_turn(e["work_session"], card(%{}), server)

    assert Enum.any?(
             notes(e["work_session"]),
             &(&1 =~ "Refused by its permissions: Bash curl evil.example")
           )

    # Lifted from a setup chat: every tool again, as any session.
    say.(%{"id" => e["id"], "permissions" => nil})
    {:ok, e} = Employees.get(e["id"], server)
    assert e["permissions"] == nil
    refute Loom.Agent.Guard.guarded?(e["chat_session"])

    assert Loom.Agent.Guard.claude_args(e["chat_session"]) == [
             "--permission-mode",
             "bypassPermissions"
           ]
  end

  test "permissions are checked, and only for Claude Code", %{server: server} do
    {chat, say} = setup_chat(server)
    say.(%{"name" => "k", "backend" => "kiro", "permissions" => @mail_only})
    assert Enum.any?(notes(chat), &(&1 =~ "Not saved: permissions need a Claude Code employee"))

    say.(%{"name" => "k", "permissions" => Map.delete(@mail_only, "summary")})
    assert Enum.any?(notes(chat), &(&1 =~ "need a summary"))

    say.(%{"name" => "k", "permissions" => Map.put(@mail_only, "tools", "Bash")})
    assert Enum.any?(notes(chat), &(&1 =~ "permissions.tools"))
    assert Employees.list(server) == []
  end

  test "spent, it stops and waits for the boss; what they approve counts for today",
       %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小码", "budget_usd" => 50}, server)
    send(server, {:turn_cost, e["work_session"], 51.5})
    :sys.get_state(server)

    {:ok, e} = Employees.get(e["id"], server)
    assert e["status"] == "approval"
    assert e["spent_today"] == 51.5

    # Due, but over budget: no wake-up.
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.refute_turn()

    {:ok, e} = Employees.approve(e["id"], 20, server)
    assert e["cap_today"] == 70.0
    assert e["status"] == "sleeping"
  end

  test "a backend that reports no cost is held to turns a day", %{server: server} do
    {:ok, e} =
      Employees.create(%{"name" => "小基", "backend" => "kiro", "budget_turns" => 2}, server)

    assert Agent.info(e["work_session"]).backend == :kiro
    assert BackendStub.last_meta().kiro_model == "claude-opus-5.5"
    assert e["budget_unit"] == "turns"
    assert e["cap_today"] == 2.0

    for _ <- 1..2 do
      {:ok, _} = Employees.wake(e["id"], nil, server)
      BackendStub.await_turn()
      end_turn(e["work_session"], "Done.", server)
    end

    {:ok, e} = Employees.get(e["id"], server)
    assert e["spent_today"] == 2.0
    assert e["status"] == "approval"
    {:ok, e} = Employees.approve(e["id"], 5, server)
    assert e["cap_today"] == 7.0
  end

  test "the backend is chosen at hiring, and only from those there are", %{server: server} do
    assert {:error, _} = Employees.create(%{"name" => "a", "backend" => "gpt"}, server)
    {:ok, e} = Employees.create(%{"name" => "a"}, server)
    assert e["backend"] == "claude_code" and e["budget_unit"] == "usd"
  end

  test "paused, it does not wake", %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小测"}, server)
    {:ok, e} = Employees.pause(e["id"], true, server)
    assert e["status"] == "paused"
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.refute_turn()
  end

  test "settings are checked", %{server: server} do
    assert {:error, "an employee needs a name"} = Employees.create(%{"role" => "x"}, server)

    assert {:error, "no such project"} =
             Employees.create(%{"name" => "a", "project_ids" => ["p_nope"]}, server)

    assert {:error, _} =
             Employees.create(
               %{"name" => "a", "weekly_report" => %{"day" => 5, "time" => "25:00"}},
               server
             )
  end

  test "an employee from before the daily report went: the setting is dropped, it is told once",
       %{server: server, dir: dir} do
    {:ok, e} = Employees.create(%{"name" => "老员工"}, server)
    path = Path.join(dir, "employees.json")
    stop_supervised!(server)

    all = path |> File.read!() |> Jason.decode!()

    old =
      Enum.map(
        all["employees"],
        &Map.merge(&1, %{"daily_report" => "18:00", "last_daily" => nil})
      )

    File.write!(path, Jason.encode!(%{all | "employees" => old}))

    name = :"employees_#{System.unique_integer([:positive])}"

    start_supervised!({Employees, name: name, path: path, tick: :timer.hours(24), run: true},
      id: name
    )

    {:ok, e2} = Employees.get(e["id"], name)
    refute Map.has_key?(e2, "daily_report") or Map.has_key?(e2, "last_daily")
    {:ok, _} = Employees.wake(e["id"], nil, name)
    assert BackendStub.await_turn() =~ "The boss dropped the daily report"
  end

  test "no daily report: an evening wakes no one; Friday's weekly report still comes",
       %{server: server} do
    {:ok, e} = Employees.create(%{"name" => "小周"}, server)
    {:ok, _} = Employees.wake(e["id"], nil, server)
    BackendStub.await_turn()
    end_turn(e["work_session"], card(%{"next" => "sleep", "sleep_minutes" => 10_000}), server)

    {:ok, e} = Employees.get(e["id"], server)
    refute Map.has_key?(e, "daily_report")

    # 18:30 in the boss's time (UTC+8): Thursday 2026-10-29, then Friday.
    at = fn date ->
      DateTime.new!(date, ~T[10:30:00], "Etc/UTC") |> DateTime.to_unix(:millisecond)
    end

    run = fn now -> :sys.replace_state(server, &Employees.run(&1, e["id"], now)) end

    run.(at.(~D[2026-10-29]))
    refute_receive {:stub_turn, _}, 200

    run.(at.(~D[2026-10-30]))
    text = BackendStub.await_turn()
    assert text =~ "time for your weekly report"
    refute text =~ ~r/daily report/i
  end
end
