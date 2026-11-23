defmodule Loom.Agent.TasksTest do
  @moduledoc """
  A session and its backend's tasks: sending one to the background, stopping
  one, and keeping the process while background work is under way.
  """
  # Not async: the stub has a fixed name and the backend map is global config.
  use ExUnit.Case, async: false

  alias Loom.Agent
  alias Loom.BackendStub

  defmodule WithTasks do
    @moduledoc "`Loom.BackendStub`, as a backend that has tasks."
    alias Loom.BackendStub

    defdelegate start(id, meta), to: BackendStub
    defdelegate resume(id, meta), to: BackendStub
    defdelegate run_turn(handle, text), to: BackendStub
    defdelegate steer(handle, text), to: BackendStub
    defdelegate interrupt(handle), to: BackendStub
    defdelegate decode(handle, message), to: BackendStub
    defdelegate persist(handle), to: BackendStub
    defdelegate release(handle), to: BackendStub
    defdelegate relocate(handle, cwd, instructions), to: BackendStub
    defdelegate stop(handle), to: BackendStub

    def background(handle, tool_use_id) do
      send(Application.fetch_env!(:loom, :tasks_test_pid), {:asked_background, tool_use_id})
      {:ok, handle}
    end

    def stop_task(handle, task_id) do
      send(Application.fetch_env!(:loom, :tasks_test_pid), {:asked_stop, task_id})
      {:ok, handle}
    end

    def busy?(_handle), do: Application.get_env(:loom, :tasks_test_busy, false)
  end

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    previous = Application.get_env(:loom, Loom.Agent, [])

    Application.put_env(
      :loom,
      Loom.Agent,
      previous
      |> Keyword.put(:data_dir, dir)
      |> Keyword.put(:backends, %{claude_code: WithTasks, codex: BackendStub})
    )

    Application.put_env(:loom, :tasks_test_pid, self())
    Application.put_env(:loom, :tasks_test_busy, false)
    start_supervised!({BackendStub, notify: self()})

    on_exit(fn ->
      for %{id: id} <- Agent.list_sessions(), do: Agent.stop_session(id)
      Process.sleep(50)
      Application.put_env(:loom, Loom.Agent, previous)
      Application.delete_env(:loom, :tasks_test_pid)
      Application.delete_env(:loom, :tasks_test_busy)
    end)

    id = "a_tk#{System.unique_integer([:positive])}"
    {:ok, pid} = Agent.start_session(id, backend: :claude_code)
    %{id: id, pid: pid}
  end

  defp backend_sends(id, pid, out) do
    send(pid, {:stub, out})
    _ = Agent.info(id)
    :ok
  end

  describe "asking the backend" do
    test "one tool call's task, or every one, goes to the background", %{id: id} do
      assert :ok = Agent.background(id, "toolu_bdrk_011XRTVYDhCpbByX3o9iLZiA")
      assert_receive {:asked_background, "toolu_bdrk_011XRTVYDhCpbByX3o9iLZiA"}

      assert :ok = Agent.background(id)
      assert_receive {:asked_background, nil}
    end

    test "a task is stopped by its id", %{id: id} do
      assert :ok = Agent.stop_task(id, "ae69038040e2062b1")
      assert_receive {:asked_stop, "ae69038040e2062b1"}
    end

    test "only an id goes into the backend's stdin", %{id: id} do
      for bad <- ["", "a b", ~s("} {"type":"user"), String.duplicate("x", 129), 7, %{}] do
        assert {:error, _} = Agent.background(id, bad)
        assert {:error, _} = Agent.stop_task(id, bad)
      end

      refute_receive {:asked_background, _}
      refute_receive {:asked_stop, _}
    end

    test "a backend with no tasks says so" do
      id = "a_tkx#{System.unique_integer([:positive])}"
      {:ok, _pid} = Agent.start_session(id, backend: :codex)
      assert {:error, :unsupported} = Agent.background(id, "toolu_1")
      assert {:error, :unsupported} = Agent.stop_task(id, "task_1")
    end
  end

  describe "a task's events" do
    test "are the transcript's, in order, like any other", %{id: id, pid: pid} do
      Phoenix.PubSub.subscribe(Loom.PubSub, Agent.topic(id))

      backend_sends(id, pid, [
        {:event, :task, %{id: "t1", kind: "agent", description: "look it up", background: false, status: "running"}},
        {:delta, %{type: :task_progress, block_id: "t1", activity: "Running a search", tools: 2}},
        {:event, :task, %{id: "t1", background: true}}
      ])

      assert_receive {:agent_event, ^id, %{kind: :task, payload: %{id: "t1", status: "running"}}}
      assert_receive {:agent_delta, ^id, %{type: :task_progress, block_id: "t1", tools: 2}}
      assert_receive {:agent_event, ^id, %{kind: :task, payload: %{id: "t1", background: true}}}

      {:ok, snapshot} = Agent.attach(id, 0)
      assert [%{payload: %{status: "running"}}, %{payload: %{background: true}}] = Enum.filter(snapshot.events, &(&1.kind == :task))
    end
  end

  describe "the process, with work in the background" do
    test "is kept past the idle timer, and let go once the work is done", %{id: id, pid: pid} do
      Agent.submit(id, "go")
      BackendStub.await_turn()
      backend_sends(id, pid, [{:event, :turn_done, %{}}])

      Application.put_env(:loom, :tasks_test_busy, true)
      send(pid, :release_backend)
      refute_receive :stub_released, 200
      # The timer started over: it will look again.
      assert :sys.get_state(pid).release_timer != nil

      Application.put_env(:loom, :tasks_test_busy, false)
      send(pid, :release_backend)
      assert_receive :stub_released, 500
    end

    test "/reload waits for it too", %{id: id, pid: pid} do
      Agent.submit(id, "go")
      BackendStub.await_turn()
      backend_sends(id, pid, [{:event, :turn_done, %{}}])

      Application.put_env(:loom, :tasks_test_busy, true)
      send(pid, :reload_backend)
      refute_receive :stub_released, 200
      assert :sys.get_state(pid).reload_after_turn

      Application.put_env(:loom, :tasks_test_busy, false)
      send(pid, :release_backend)
      assert_receive :stub_released, 500
      refute :sys.get_state(pid).reload_after_turn
    end
  end
end
