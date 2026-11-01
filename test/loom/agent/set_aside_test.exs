defmodule Loom.Agent.SetAsideTest do
  # A session a safety classifier stopped is set aside by what runs it for a
  # fixed job: Dream, the bell, a task. Not async: sessions, the backend map
  # and CLAUDE_CONFIG_DIR are global.
  use ExUnit.Case, async: false

  alias Loom.Agent
  alias Loom.BackendStub

  setup do
    dir = Path.join(System.tmp_dir!(), "loom-aside-#{System.unique_integer([:positive])}")
    previous = Application.get_env(:loom, Loom.Agent, [])
    previous_claude = System.get_env("CLAUDE_CONFIG_DIR")

    Application.put_env(
      :loom,
      Loom.Agent,
      previous
      |> Keyword.put(:data_dir, Path.join(dir, "sessions"))
      |> Keyword.put(:workspace, Path.join(dir, "home"))
      |> Keyword.put(:backends, %{claude_code: BackendStub, codex: BackendStub})
    )

    System.put_env("CLAUDE_CONFIG_DIR", Path.join(dir, "claude"))
    start_supervised!({BackendStub, notify: self()})

    on_exit(fn ->
      for %{id: id} <- Agent.list_sessions(), do: Agent.stop_session(id)
      Process.sleep(50)
      Application.put_env(:loom, Loom.Agent, previous)

      if previous_claude,
        do: System.put_env("CLAUDE_CONFIG_DIR", previous_claude),
        else: System.delete_env("CLAUDE_CONFIG_DIR")

      File.rm_rf(dir)
    end)

    {:ok, dir: dir}
  end

  defp stub(id, out) do
    [{pid, _}] = Registry.lookup(Loom.Agent.Registry, id)
    send(pid, {:stub, out})
    :sys.get_state(pid)
  end

  # A turn that a classifier stopped, and that ended with `reply`.
  defp flagged_turn(id, reply) do
    {:ok, _} = Agent.submit(id, "go")
    BackendStub.await_turn()

    stub(id, [
      {:event, :flagged, %{category: "cyber", fell_back: true}},
      {:event, :assistant_text, %{text: reply, block_id: "b1"}},
      {:event, :turn_done, %{}}
    ])
  end

  defp plain_turn(id) do
    {:ok, _} = Agent.submit(id, "go")
    BackendStub.await_turn()
    stub(id, [{:event, :turn_done, %{}}])
  end

  describe "a session" do
    test "is flagged by the classifier's notice, says so, and stays flagged" do
      {:ok, _} = Agent.start_session("a_f1", backend: :claude_code)
      refute Agent.flagged?("a_f1")
      flagged_turn("a_f1", "done")

      assert Agent.flagged?("a_f1")
      assert %{flagged_category: "cyber", flagged_at: at} = Agent.info("a_f1")
      assert is_integer(at)
      {:ok, %{events: events}} = Agent.attach("a_f1")

      assert Enum.any?(
               events,
               &(&1.kind == :loom_note and &1.payload.text =~ "safety classifier")
             )

      Agent.stop_session("a_f1")
      {:ok, _} = Agent.restore_session("a_f1")
      assert %{flagged_category: "cyber"} = Agent.info("a_f1")
    end

    test "is flagged by a turn that ended in the classifier's refusal, from any backend" do
      {:ok, _} = Agent.start_session("a_f2", backend: :codex)
      {:ok, _} = Agent.submit("a_f2", "go")
      BackendStub.await_turn()

      stub("a_f2", [
        {:event, :turn_failed,
         %{
           reason:
             "API Error: Opus 5.5's safeguards flagged this session (https://www.anthropic.com/legal/aup)."
         }}
      ])

      assert Agent.flagged?("a_f2")
    end

    test "is not flagged by an ordinary failure" do
      {:ok, _} = Agent.start_session("a_f3", backend: :claude_code)
      {:ok, _} = Agent.submit("a_f3", "go")
      BackendStub.await_turn()
      stub("a_f3", [{:event, :turn_failed, %{reason: "API Error: 503 overloaded"}}])
      refute Agent.flagged?("a_f3")
    end
  end

  describe "Dream" do
    setup %{dir: dir} do
      name = :"dream_#{System.unique_integer([:positive])}"

      start_supervised!(
        {Loom.Dream, name: name, path: Path.join(dir, "dream.json"), tick: :timer.hours(24)},
        id: name
      )

      {:ok, dream: name}
    end

    test "a flagged sleep session gives way to a fresh one, told the report", %{dream: dream} do
      {:ok, old} = Loom.Dream.open("home", dream)
      # Unflagged, it is the same one.
      plain_turn(old)
      assert {:ok, ^old} = Loom.Dream.open("home", dream)

      flagged_turn(old, "## Dream report\nTwo memories updated.")
      assert {:ok, new} = Loom.Dream.open("home", dream)
      assert new != old
      assert %{kind: "dream", earlier: [^old]} = Agent.info(new)
      assert {:ok, ^new} = Loom.Dream.open("home", dream)

      {:ok, _} = Agent.submit(new, "hello")
      prompt = BackendStub.await_turn()
      assert prompt =~ "a safety classifier stopped"
      assert prompt =~ "Two memories updated."
      assert prompt =~ "hello"
    end
  end

  describe "the bell's chat" do
    setup do
      clock = :counters.new(1, [:atomics])
      :counters.put(clock, 1, System.system_time(:millisecond))
      name = :"notices_#{System.unique_integer([:positive])}"
      path = Path.join(System.tmp_dir!(), "notices-#{System.unique_integer([:positive])}.json")

      start_supervised!(
        {Loom.Notices,
         name: name,
         path: path,
         tick: :timer.hours(24),
         clock: fn -> :counters.get(clock, 1) end,
         notify: fn _, _, _ -> :ok end,
         submit: fn _, _ -> :ok end}
      )

      on_exit(fn -> File.rm(path) end)
      {:ok, bell: name, clock: clock}
    end

    test "is new once flagged", %{bell: bell} do
      {:ok, old} = Loom.Notices.session(bell)
      plain_turn(old)
      assert {:ok, ^old} = Loom.Notices.session(bell)

      flagged_turn(old, "ok")
      assert {:ok, new} = Loom.Notices.session(bell)
      assert new != old
      assert %{kind: "bell", earlier: [^old]} = Agent.info(new)
    end

    test "is new each day", %{bell: bell, clock: clock} do
      {:ok, old} = Loom.Notices.session(bell)
      plain_turn(old)
      assert {:ok, ^old} = Loom.Notices.session(bell)

      :counters.add(clock, 1, :timer.hours(25))
      assert {:ok, new} = Loom.Notices.session(bell)
      assert new != old
      assert %{earlier: [^old]} = Agent.info(new)
    end
  end

  describe "a task" do
    setup %{dir: dir} do
      name = :"cron_#{System.unique_integer([:positive])}"
      start_supervised!({Loom.Cron, name: name, path: Path.join(dir, "cron.json")}, id: name)
      {:ok, cron: name}
    end

    test "runs in a session of its own each time, the runs before above it", %{cron: cron} do
      {:ok, _} = Agent.start_session("a_t1", backend: :claude_code, kind: "task", title: "Daily")
      {:ok, job} = Loom.Cron.add(%{cron: "0 4 * * *", target: "a_t1", prompt: "tidy"}, cron)

      # The first run goes to the session the task was made with.
      {:ok, %{target: "a_t1"}} = Loom.Cron.run(job.id, cron)
      assert BackendStub.await_turn() =~ "tidy"
      stub("a_t1", [{:event, :turn_done, %{}}])

      {:ok, %{target: second}} = Loom.Cron.run(job.id, cron)
      assert second != "a_t1"
      assert BackendStub.await_turn() =~ "tidy"
      assert %{kind: "task", title: "Daily", earlier: ["a_t1"]} = Agent.info(second)
      stub(second, [{:event, :turn_done, %{}}])

      {:ok, %{target: third}} = Loom.Cron.run(job.id, cron)
      BackendStub.await_turn()
      assert %{earlier: [^second, "a_t1"]} = Agent.info(third)
    end

    test "pointed at the user's own session, stays there", %{cron: cron} do
      {:ok, _} = Agent.start_session("a_u1", backend: :claude_code)
      {:ok, job} = Loom.Cron.add(%{cron: "0 4 * * *", target: "a_u1", prompt: "news"}, cron)

      {:ok, _} = Loom.Cron.run(job.id, cron)
      BackendStub.await_turn()
      stub("a_u1", [{:event, :turn_done, %{}}])
      assert {:ok, %{target: "a_u1"}} = Loom.Cron.run(job.id, cron)
      BackendStub.await_turn()
    end
  end
end
