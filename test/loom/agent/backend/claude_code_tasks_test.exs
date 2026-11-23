defmodule Loom.Agent.Backend.ClaudeCodeTasksTest do
  @moduledoc """
  Tasks: the subagents and shell commands a Claude Code turn waits on, as
  the CLI reports them, and what becomes of one sent to the background.

  The lines are what `claude -p --output-format stream-json` (2.1.317) wrote
  while a foreground Agent call was moved to the background with a
  `background_tasks` control request, less their `uuid` and `session_id`.
  """
  use ExUnit.Case, async: true

  alias Loom.Agent.Backend.ClaudeCode

  @agent "toolu_bdrk_011XRTVYDhCpbByX3o9iLZiA"
  @task "ae69038040e2062b1"

  defp handle(overrides \\ %{}) do
    Map.merge(
      %{
        session_id: "f9c5596e-333d-4e1f-b434-aa044ae76532",
        cwd: "/tmp",
        started?: true,
        booting: nil,
        loom_id: "a_test",
        proc: :fake_proc,
        saved: nil,
        message_id: "msg_one",
        pending_blocks: [],
        buffer: "",
        tools: %{},
        interrupted?: false,
        next_control_id: 1,
        context_tokens: 0,
        context_window: nil,
        tasks: %{},
        lost: []
      },
      overrides
    )
  end

  defp feed(handle, lines),
    do: ClaudeCode.feed(handle, Enum.map_join(lines, "", &(Jason.encode!(&1) <> "\n")))

  defp events(out), do: for({:event, kind, payload} <- out, do: {kind, payload})
  defp deltas(out), do: for({:delta, delta} <- out, do: delta)

  @started %{
    "type" => "system",
    "subtype" => "task_started",
    "task_id" => @task,
    "run_id" => "0mwt0p8gp-1c90250d",
    "tool_use_id" => @agent,
    "description" => "sleep test",
    "subagent_type" => "general-purpose",
    "is_backgrounded" => false,
    "spawn_depth" => 1,
    "task_type" => "local_agent"
  }

  @progress %{
    "type" => "system",
    "subtype" => "task_progress",
    "task_id" => @task,
    "tool_use_id" => @agent,
    "description" => "Running Wait 40 seconds, then print a completion marker",
    "subagent_type" => "general-purpose",
    "usage" => %{"total_tokens" => 13058, "tool_uses" => 1, "duration_ms" => 5316},
    "last_tool_name" => "Bash"
  }

  @backgrounded %{
    "type" => "system",
    "subtype" => "task_updated",
    "task_id" => @task,
    "patch" => %{"is_backgrounded" => true}
  }

  @completed %{
    "type" => "system",
    "subtype" => "task_updated",
    "task_id" => @task,
    "patch" => %{"status" => "completed", "end_time" => 1_795_423_397_805}
  }

  @notification %{
    "type" => "system",
    "subtype" => "task_notification",
    "task_id" => @task,
    "tool_use_id" => @agent,
    "status" => "completed",
    "output_file" => "/tmp/claude-1000/-tmp-cc-work/e70ff42f/tasks/ae69038040e2062b1.output",
    "summary" => "agent-done",
    "usage" => %{"total_tokens" => 18258, "tool_uses" => 4, "duration_ms" => 56473}
  }

  defp sub_tool_use(id),
    do: %{
      "type" => "assistant",
      "parent_tool_use_id" => @agent,
      "message" => %{
        "model" => "claude-fable-5-2",
        "content" => [%{"type" => "tool_use", "id" => id, "name" => "Bash", "input" => %{"command" => "true"}}]
      }
    }

  defp sub_tool_result(id),
    do: %{
      "type" => "user",
      "parent_tool_use_id" => @agent,
      "message" => %{"content" => [%{"type" => "tool_result", "tool_use_id" => id, "content" => "agent-done"}]}
    }

  describe "a task's life" do
    test "it starts in the foreground: an event that says what it is" do
      {handle, out} = feed(handle(), [@started])

      assert [
               {:task,
                %{
                  id: @task,
                  tool_use_id: @agent,
                  kind: "agent",
                  agent: "general-purpose",
                  description: "sleep test",
                  background: false,
                  status: "running"
                }}
             ] = events(out)

      # The turn is waiting on it: nothing outlasts the turn yet.
      refute ClaudeCode.busy?(handle)
    end

    test "what it is doing now is transient, keyed by its id" do
      {handle, _} = feed(handle(), [@started])
      {_handle, out} = feed(handle, [@progress])

      assert events(out) == []

      assert [
               %{
                 type: :task_progress,
                 block_id: @task,
                 activity: "Running Wait 40 seconds, then print a completion marker",
                 last_tool: "Bash",
                 tokens: 13058,
                 tools: 1,
                 ms: 5316
               }
             ] = deltas(out)
    end

    test "sent to the background, it outlasts the turn until it says how it ended" do
      {handle, _} = feed(handle(), [@started])
      {handle, out} = feed(handle, [@backgrounded])
      assert [{:task, %{id: @task, background: true} = patch}] = events(out)
      refute Map.has_key?(patch, :status)
      assert ClaudeCode.busy?(handle)

      {handle, out} = feed(handle, [@completed])
      assert [{:task, %{id: @task, status: "completed"}}] = events(out)
      refute ClaudeCode.busy?(handle)

      {handle, out} = feed(handle, [@notification])
      assert [{:task, %{id: @task, status: "completed", summary: "agent-done", tools: 4, ms: 56473}}] = events(out)
      assert handle.tasks == %{}
    end

    test "killed is stopped, in the three words there are" do
      {handle, _} = feed(handle(), [@started])
      killed = put_in(@completed, ["patch", "status"], "killed")
      {_handle, out} = feed(handle, [killed])
      assert [{:task, %{status: "stopped"}}] = events(out)
    end

    test "what a subagent starts in turn, and housekeeping, are not the conversation's tasks" do
      own = %{
        @started
        | "task_id" => "bee3itybt",
          "tool_use_id" => "toolu_bdrk_01Wn6tXzZeSw6R9gGVG4CDhQ",
          "task_type" => "local_bash"
      }

      for extra <- [%{"parent_task_id" => @task, "owned_by_subagent" => true}, %{"ambient" => true}, %{"skip_transcript" => true}] do
        {handle, out} = feed(handle(), [Map.merge(own, extra)])
        assert out == []
        assert handle.tasks == %{}

        # Nor anything said about one later.
        {_handle, out} = feed(handle, [%{@notification | "task_id" => "bee3itybt"}])
        assert out == []
      end
    end

    test "a shell command is a task too" do
      shell = %{@started | "task_type" => "local_bash", "subagent_type" => nil, "description" => "Sleep 45 seconds then print a marker"}
      {_handle, out} = feed(handle(), [shell])
      assert [{:task, %{kind: "shell", agent: nil}}] = events(out)
    end
  end

  describe "what a subagent itself does" do
    test "in the foreground its calls show among the turn's, taking no block of the conversation's" do
      pending = [{"msg_one.0", nil}]
      {handle, _} = feed(handle(%{pending_blocks: pending}), [@started])
      {handle, out} = feed(handle, [sub_tool_use("toolu_sub_1"), sub_tool_result("toolu_sub_1")])

      assert [
               {:tool_use, %{id: "toolu_sub_1", block_id: "sub.toolu_sub_1", name: "Bash", parent: @agent}},
               {:tool_result, %{id: "toolu_sub_1", name: "Bash", status: :ok, output: "agent-done", parent: @agent}}
             ] = events(out)

      # The conversation's own text, still streaming, keeps its placeholder.
      assert handle.pending_blocks == pending
    end

    test "in the background they stay out of the conversation" do
      {handle, _} = feed(handle(), [@started, sub_tool_use("toolu_sub_1"), @backgrounded])

      said = %{
        "type" => "assistant",
        "parent_tool_use_id" => @agent,
        "message" => %{"model" => "claude-fable-5-2", "content" => [%{"type" => "text", "text" => "agent-done"}]}
      }

      {_handle, out} = feed(handle, [sub_tool_use("toolu_sub_2"), sub_tool_result("toolu_sub_2"), said])
      assert out == []
    end

    test "a call shown before it went to the background still gets its result" do
      {handle, _} = feed(handle(), [@started, sub_tool_use("toolu_sub_1"), @backgrounded])
      {_handle, out} = feed(handle, [sub_tool_result("toolu_sub_1")])
      assert [{:tool_result, %{id: "toolu_sub_1", name: "Bash"}}] = events(out)
    end
  end

  describe "asking" do
    test "with no process there is nothing to send on or stop" do
      idle = handle(%{proc: nil})
      assert {:error, _} = ClaudeCode.background(idle, @agent)
      assert {:error, _} = ClaudeCode.stop_task(idle, @task)
    end
  end

  describe "a process let go" do
    test "takes its tasks with it, and says so with the next output" do
      {handle, _} = feed(handle(), [@started, @backgrounded])
      assert ClaudeCode.busy?(handle)

      # As `release/1` leaves it (the kill itself needs a real process).
      gone = %{handle | tasks: %{}, lost: [@task], proc: nil}
      refute ClaudeCode.busy?(gone)
      assert gone.lost == [@task]
    end
  end
end
