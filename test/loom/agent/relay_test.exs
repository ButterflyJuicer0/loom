defmodule Loom.Agent.RelayTest do
  @moduledoc """
  A message into a session that is already there (`Loom.Agent.Relay`): it waits
  for the target's turn, says where it came from, and goes only to the user's
  own conversations.
  """
  use ExUnit.Case, async: false

  alias Loom.Agent
  alias Loom.Agent.Relay
  alias Loom.BackendStub

  setup do
    data_dir = Path.join(System.tmp_dir!(), "loom-relay-#{System.unique_integer([:positive])}")
    previous = Application.get_env(:loom, Loom.Agent, [])

    Application.put_env(
      :loom,
      Loom.Agent,
      previous
      |> Keyword.put(:data_dir, data_dir)
      |> Keyword.put(:backends, %{claude_code: BackendStub, codex: BackendStub})
    )

    start_supervised!({BackendStub, notify: self()})

    on_exit(fn ->
      for %{id: id} <- Agent.list_sessions(), do: Agent.stop_session(id)
      Process.sleep(50)
      Application.put_env(:loom, Loom.Agent, previous)
      File.rm_rf(data_dir)
    end)

    :ok
  end

  defp new_session(opts \\ []) do
    id = "a_r#{System.unique_integer([:positive])}"
    {:ok, _pid} = Agent.start_session(id, Keyword.merge([backend: :claude_code], opts))
    id
  end

  defp user_events(id) do
    {:ok, %{events: events}} = Agent.attach(id)
    for %{kind: :user, payload: p} <- events, do: p
  end

  test "the user's message goes in as it is, tagged as sent from elsewhere" do
    id = new_session()
    assert {:ok, :started} = Relay.deliver(id, "  check the build  ", :user)
    assert BackendStub.await_turn() == "check the build"
    assert [%{text: "check the build", origin: "relay"}] = user_events(id)
  end

  test "a session mid-turn finishes first: it is queued, not steered in" do
    id = new_session()
    Agent.submit(id, "long job")
    BackendStub.await_turn()

    assert {:ok, :queued} = Relay.deliver(id, "when you're done, also this", :user)
    BackendStub.refute_steer()
    assert Agent.info(id).queue == ["when you're done, also this"]
  end

  test "from another session's agent: named, and the target is told it is not the user" do
    from = new_session(title: "Router setup")
    to = new_session()

    assert {:ok, :started} = Relay.deliver(to, "the new IP is 10.0.0.2", {:session, Agent.info(from)})

    prompt = BackendStub.await_turn()
    assert prompt =~ "It is not the user typing"
    assert prompt =~ ~s("Router setup")
    assert prompt =~ "loom-session send #{from}"
    assert prompt =~ "the new IP is 10.0.0.2"

    assert [%{text: "↪ From **Router setup**\n\nthe new IP is 10.0.0.2"}] = user_events(to)
  end

  test "only the user's own sessions, never itself, never empty" do
    me = new_session()
    other = new_session(kind: "incognito")

    assert {:error, "a session cannot send to itself"} =
             Relay.deliver(me, "hi", {:session, Agent.info(me)})

    assert {:error, "a_nope: no such session"} = Relay.deliver("a_nope", "hi", :user)
    assert {:error, msg} = Relay.deliver(other, "hi", :user)
    assert msg =~ "not one of the user's own sessions"
    assert {:error, "the message is empty"} = Relay.deliver(me, "   ", :user)
    BackendStub.refute_turn()
  end
end
