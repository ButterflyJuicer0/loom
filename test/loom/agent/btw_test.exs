defmodule Loom.Agent.BtwTest do
  @moduledoc """
  A side question: put to a copy of the session, answered once, and never
  part of the session's own conversation. The copy here is a shell script
  that speaks Claude Code's stream-json.
  """
  # Not async: the stub has a fixed name and the backend map is global config.
  use ExUnit.Case, async: false

  alias Loom.Agent
  alias Loom.Agent.{Btw, Session, Store}
  alias Loom.Agent.Backend.ClaudeCode
  alias Loom.BackendStub

  @moduletag :tmp_dir

  defmodule Forking do
    @moduledoc "`Loom.BackendStub`, as a backend whose conversation can be copied."
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

    def fork_spec(_handle), do: Application.fetch_env!(:loom, :btw_test_spec)
  end

  setup %{tmp_dir: dir} do
    previous = Application.get_env(:loom, Loom.Agent, [])

    Application.put_env(
      :loom,
      Loom.Agent,
      previous
      |> Keyword.put(:data_dir, Path.join(dir, "sessions"))
      |> Keyword.put(:backends, %{claude_code: Forking, codex: BackendStub})
    )

    start_supervised!({BackendStub, notify: self()})

    on_exit(fn ->
      # A copy still answering is stopped, and its files go with it.
      for %{id: id} <- Agent.list_sessions(), do: Btw.forget(id)
      for %{id: id} <- Agent.list_sessions(), do: Agent.stop_session(id)
      Process.sleep(50)
      Application.put_env(:loom, Loom.Agent, previous)
      Application.delete_env(:loom, :btw_test_spec)
    end)

    id = "a_btw#{System.unique_integer([:positive])}"
    {:ok, _pid} = Agent.start_session(id, backend: :claude_code)
    Phoenix.PubSub.subscribe(Loom.PubSub, Session.topic(id))
    %{id: id, dir: dir}
  end

  # The copy: a script that keeps what it was asked and answers in
  # stream-json, as `claude -p` would. `body` is what it does in between.
  defp copy(dir, body) do
    script = Path.join(dir, "copy-#{System.unique_integer([:positive])}.sh")
    asked = script <> ".asked"

    File.write!(script, """
    #!/bin/sh
    cat > #{asked}
    #{body}
    """)

    File.chmod!(script, 0o755)

    Application.put_env(
      :loom,
      :btw_test_spec,
      {:ok, %{engine: :claude_code, exe: script, args: ["-p"], cwd: dir}}
    )

    asked
  end

  defp delta(text),
    do:
      ~s(echo '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"#{text}"}}}')

  @result ~s(echo '{"type":"result","subtype":"success","is_error":false,"result":"Hello"}')

  defp answers(dir), do: copy(dir, Enum.join([delta("Hel"), delta("lo"), @result], "\n"))

  # The list as last announced with nothing being answered.
  defp settled(id) do
    assert_receive {:agent_btw, ^id, %{type: "items", items: items}}, 5_000
    if Enum.any?(items, &(&1["status"] == "answering")), do: settled(id), else: items
  end

  describe "prompt/2" do
    test "says what the copy is for, then the question" do
      prompt = Btw.prompt("why that file?", [])
      assert prompt =~ "side question"
      assert prompt =~ "do not call tools"
      assert String.ends_with?(prompt, "Question: why that file?")
      refute prompt =~ "Earlier side questions"
    end

    test "carries the answered ones before it, and only those" do
      earlier = [
        %{"question" => "one?", "answer" => "first", "status" => "done"},
        %{"question" => "two?", "answer" => "half", "status" => "stopped"},
        %{"question" => "three?", "answer" => "", "status" => "error"}
      ]

      prompt = Btw.prompt("four?", earlier)
      assert prompt =~ "Q: one?\nA: first"
      refute prompt =~ "two?"
      refute prompt =~ "three?"
    end

    test "a long answer goes along cut short" do
      earlier = [%{"question" => "q", "answer" => String.duplicate("x", 5_000), "status" => "done"}]
      assert String.length(Btw.prompt("next?", earlier)) < 4_000
    end
  end

  describe "ask/2" do
    test "the answer streams, is kept, and the session never hears of it", %{id: id, dir: dir} do
      asked = answers(dir)
      before = Agent.info(id)

      assert {:ok, %{"id" => item, "status" => "answering"}} = Btw.ask(id, "  what is it doing?  ")

      assert_receive {:agent_btw, ^id, %{type: "items", items: [%{"status" => "answering"}]}}
      assert_receive {:agent_btw, ^id, %{type: "text", id: ^item, seq: 1, text: "Hel"}}, 5_000
      assert_receive {:agent_btw, ^id, %{type: "text", id: ^item, seq: 2, text: "lo"}}, 5_000

      assert [%{"id" => ^item, "question" => "what is it doing?", "answer" => "Hello", "status" => "done"}] =
               settled(id)

      assert [%{"answer" => "Hello", "status" => "done"}] = Btw.list(id)
      assert File.exists?(Path.join(Store.session_dir(id), "btw.json"))
      assert File.read!(asked) =~ "Question: what is it doing?"

      # No event, no turn, no change of status: it is not in the conversation.
      now = Agent.info(id)
      assert now.seq == before.seq
      assert now.status == before.status
      BackendStub.refute_turn()
      refute_received {:agent_event, ^id, _}
    end

    test "a later question takes the earlier ones along", %{id: id, dir: dir} do
      answers(dir)
      {:ok, _} = Btw.ask(id, "first?")
      settled(id)

      asked = answers(dir)
      {:ok, _} = Btw.ask(id, "second?")
      assert [_, %{"question" => "second?", "status" => "done"}] = settled(id)
      assert File.read!(asked) =~ "Q: first?\nA: Hello"
    end

    test "one at a time; stopping keeps what was said", %{id: id, dir: dir} do
      copy(dir, Enum.join([delta("so far"), "sleep 30", @result], "\n"))

      {:ok, %{"id" => item}} = Btw.ask(id, "slow?")
      assert_receive {:agent_btw, ^id, %{type: "text", id: ^item, text: "so far"}}, 5_000
      assert {:error, :busy} = Btw.ask(id, "another?")
      # Another device opening the panel now sees the answer as far as it got.
      assert [%{"status" => "answering", "answer" => "so far", "seq" => 1}] = Btw.list(id)

      assert :ok = Btw.stop(id)
      assert [%{"status" => "stopped", "answer" => "so far"}] = Btw.list(id)
      assert {:ok, _} = Btw.ask(id, "another?")
    end

    test "a copy that fails says why", %{id: id, dir: dir} do
      copy(dir, "echo 'No conversation found with session ID: x' >&2; exit 1")
      {:ok, _} = Btw.ask(id, "anyone?")

      assert [%{"status" => "error", "error" => "No conversation found with session ID: x"}] =
               settled(id)
    end

    test "a result that is an error is one", %{id: id, dir: dir} do
      copy(dir, ~s(echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"API Error: 503"}'))
      {:ok, _} = Btw.ask(id, "anyone?")
      assert [%{"status" => "error", "error" => "API Error: 503"}] = settled(id)
    end

    test "nothing to ask, too much, nobody to ask", %{id: id, dir: dir} do
      answers(dir)
      assert {:error, :empty} = Btw.ask(id, "   ")
      assert {:error, :too_long} = Btw.ask(id, String.duplicate("x", 20_001))
      assert {:error, :not_found} = Btw.ask("a_nope", "hello?")
    end

    test "a backend that cannot be copied has no side questions" do
      id = "a_btwx#{System.unique_integer([:positive])}"
      {:ok, _pid} = Agent.start_session(id, backend: :codex)
      assert {:error, :unsupported} = Btw.ask(id, "hello?")
      assert Btw.list(id) == []
    end
  end

  describe "the list" do
    test "clearing empties it and stops what was being answered", %{id: id, dir: dir} do
      answers(dir)
      {:ok, _} = Btw.ask(id, "first?")
      settled(id)

      copy(dir, "sleep 30")
      {:ok, _} = Btw.ask(id, "slow?")
      assert :ok = Btw.clear(id)
      assert Btw.list(id) == []
      refute File.exists?(Path.join(Store.session_dir(id), "btw.json"))
      assert_receive {:agent_btw, ^id, %{type: "items", items: []}}
    end

    test "an answer nobody is giving any more is shown as stopped", %{id: id} do
      File.write!(
        Path.join(Store.session_dir(id), "btw.json"),
        Jason.encode!(%{items: [%{id: "b_x", question: "q?", answer: "", status: "answering"}]})
      )

      assert [%{"status" => "stopped"}] = Btw.list(id)
    end

    test "deleting the session ends its answer and leaves nothing behind", %{id: id, dir: dir} do
      copy(dir, "sleep 30")
      {:ok, _} = Btw.ask(id, "slow?")
      Agent.delete_session(id)
      Process.sleep(100)
      refute File.exists?(Store.session_dir(id))
      assert Loom.Agent.Btw.Worker.whereis(id) == nil
    end
  end

  describe "Claude Code's copy" do
    setup do
      previous = Application.get_env(:loom, Loom.Agent, [])
      Application.put_env(:loom, Loom.Agent, Keyword.put(previous, :claude_cli, "sh"))
      on_exit(fn -> Application.put_env(:loom, Loom.Agent, previous) end)
      :ok
    end

    defp handle(overrides) do
      Map.merge(
        %{
          loom_id: "a_none",
          session_id: "cc-1",
          cwd: "/tmp",
          started?: true,
          fork_from: nil,
          sandbox: false,
          model: "opus",
          effort: "high",
          instructions: "be kind"
        },
        overrides
      )
    end

    test "is the session's own command line, forked and kept nowhere" do
      assert {:ok, %{engine: :claude_code, cwd: "/tmp", args: args}} = ClaudeCode.fork_spec(handle(%{}))
      joined = Enum.join(args, " ")

      assert joined =~ "--resume cc-1 --fork-session --no-session-persistence"
      assert joined =~ "--model opus --effort high"
      assert joined =~ "--append-system-prompt be kind"
      assert joined =~ "--permission-mode bypassPermissions"
      # Text on stdin, so the process ends with its one turn.
      refute "--input-format" in args

      # Every tool call is turned down by a hook; the tools stay listed.
      settings = Enum.at(args, Enum.find_index(args, &(&1 == "--settings")) + 1)
      assert %{"hooks" => %{"PreToolUse" => [%{"hooks" => [%{"command" => command}]}]}} = Jason.decode!(settings)
      assert command =~ "exit 2"
      refute "--tools" in args
    end

    test "an employee's rules stay, with the hook in place of its workstation's" do
      rules = %{"workstation" => "Box", "cache_1h" => true}
      settings = Jason.decode!(Loom.Agent.Guard.claude_settings(rules, :no_tools))

      assert %{"PreToolUse" => [%{"hooks" => [%{"command" => command}]}]} = settings["hooks"]
      assert command =~ "exit 2"
      refute command =~ "loom-guard"
      assert settings["env"]["ENABLE_PROMPT_CACHING_1H"] == "1"
    end

    test "with nothing said yet there is nothing to copy" do
      assert {:ok, %{args: args}} = ClaudeCode.fork_spec(handle(%{started?: false}))
      refute "--resume" in args
      assert "--no-session-persistence" in args
    end
  end
end
