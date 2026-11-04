defmodule Loom.Agent.CarryTest do
  @moduledoc """
  "Continue in a new chat": which way a session is carried on, and that only
  the sidebar's own chats can be.
  """
  # Not async: the stub has a fixed name and the backend map is global config.
  use ExUnit.Case, async: false

  alias Loom.Agent
  alias Loom.Agent.{Carry, Store}
  alias Loom.BackendStub

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    previous = Application.get_env(:loom, Loom.Agent, [])

    Application.put_env(
      :loom,
      Loom.Agent,
      previous
      |> Keyword.put(:data_dir, dir)
      |> Keyword.put(:backends, %{claude_code: BackendStub, codex: BackendStub})
    )

    start_supervised!({BackendStub, notify: self()})

    on_exit(fn ->
      for %{id: id} <- Agent.list_sessions(), do: Agent.stop_session(id)
      Process.sleep(50)
      Application.put_env(:loom, Loom.Agent, previous)
    end)

    :ok
  end

  # A Claude Code session on disk: its meta, and its events by kind.
  defp past(id, meta, kinds) do
    :ok = Store.write_meta(id, Map.merge(%{id: id, backend: :claude_code}, meta))

    body =
      kinds
      |> Enum.with_index(1)
      |> Enum.map_join("", fn {kind, seq} ->
        Jason.encode!(%{at: seq, seq: seq, kind: kind, payload: %{}}) <> "\n"
      end)

    File.write!(Store.events_path(id), body)
  end

  @ok %{cc_started: true, cc_session_id: "cc-1"}
  @info %{backend: :claude_code, status: :idle, context_tokens: 1000, context_window: 200_000}

  describe "how/2" do
    test "a healthy, short Claude Code session is forked" do
      past("a_ok", @ok, ["user", "assistant", "turn_done"])
      assert Carry.how("a_ok", @info) == {:fork, "cc-1"}
    end

    test "one that ended in an error is read, not copied" do
      past("a_err", @ok, ["user", "assistant", "turn_done", "user", "error"])
      assert Carry.how("a_err", @info) == {:read, :error}
    end

    test "an error earlier on, then a good turn, is forked" do
      past("a_mend", @ok, ["user", "error", "user", "assistant", "turn_done"])
      assert Carry.how("a_mend", @info) == {:fork, "cc-1"}
    end

    test "past 60% of its window it is read" do
      past("a_long", @ok, ["user", "turn_done"])
      assert Carry.how("a_long", %{@info | context_tokens: 130_000}) == {:read, :long}
    end

    test "never started, mid-turn, or not Claude Code: read" do
      past("a_empty", %{}, [])
      assert Carry.how("a_empty", @info) == {:read, :empty}

      past("a_busy", @ok, ["user"])
      assert Carry.how("a_busy", %{@info | status: :running}) == {:read, :busy}

      past("a_codex", @ok, ["user", "turn_done"])
      assert Carry.how("a_codex", %{@info | backend: :codex}) == {:read, :backend}
    end
  end

  describe "continue/1" do
    test "a new session with the old one's title, told to read it and summarise" do
      {:ok, _} = Agent.start_session("a_old", backend: :claude_code, title: "Trip plan")

      assert {:ok, new} = Carry.continue("a_old")
      assert new != "a_old"

      prompt = BackendStub.await_turn()
      assert prompt =~ "loom-session read a_old --files"
      assert prompt =~ "at most five lines"
      assert prompt =~ "do not quote passwords"

      info = Agent.info(new)
      assert info.title == "Trip plan"
      assert info.kind == nil

      # On the user's own model, not one pinned from the old session.
      assert {:ok, meta} = Store.read_meta(new)
      assert meta[:cc_model] == nil

      # The old one is left as it was.
      assert Agent.info("a_old").title == "Trip plan"
    end

    test "onto another backend: a new session there, which reads the old one" do
      {:ok, _} = Agent.start_session("a_cc", backend: :claude_code, title: "Port it")

      assert {:ok, new} = Carry.continue("a_cc", :codex)
      assert BackendStub.await_turn() =~ "loom-session read a_cc --files"
      assert Agent.info(new).backend == :codex
      assert Agent.info("a_cc").backend == :claude_code
    end

    test "not an employee's, Dream's or the bell's session" do
      {:ok, _} =
        Agent.start_session("a_emp", backend: :claude_code, employee: "e_1", kind: "work")

      assert {:error, reason} = Carry.continue("a_emp")
      assert reason =~ "not a chat of yours"

      assert {:error, reason} = Carry.continue("a_nope")
      assert reason =~ "no such session"
      assert Agent.list_sessions() |> length() == 1
    end
  end
end
