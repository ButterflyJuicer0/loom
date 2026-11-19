defmodule LoomWeb.AgentBtwControllerTest do
  @moduledoc "A session's side questions over HTTP; see `Loom.Agent.BtwTest` for the rest."
  # Not async: the stub has a fixed name and the backend map is global config.
  use LoomWeb.ConnCase, async: false

  alias Loom.Agent
  alias Loom.BackendStub

  setup %{conn: conn} do
    data_dir = Path.join(System.tmp_dir!(), "loom-btw-#{System.unique_integer([:positive])}")
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

    id = "a_bt#{System.unique_integer([:positive])}"
    {:ok, _pid} = Agent.start_session(id, backend: :claude_code)

    conn = put_req_header(conn, "authorization", "Bearer " <> Loom.Auth.mint_token())
    %{conn: conn, id: id}
  end

  test "an empty panel, and one that stays empty when cleared or stopped", %{conn: conn, id: id} do
    assert %{"items" => []} = conn |> get("/api/agents/#{id}/btw") |> json_response(200)
    assert %{"items" => []} = conn |> post("/api/agents/#{id}/btw/stop") |> json_response(200)
    assert %{"items" => []} = conn |> delete("/api/agents/#{id}/btw") |> json_response(200)
  end

  test "a question has to be one, and the agent one that can be copied", %{conn: conn, id: id} do
    assert conn |> post("/api/agents/#{id}/btw", %{text: 3}) |> json_response(422)
    assert conn |> post("/api/agents/#{id}/btw", %{text: "  "}) |> json_response(422)

    # The stub has no `fork_spec/1`, as Kiro has none.
    assert %{"error" => error} = conn |> post("/api/agents/#{id}/btw", %{text: "why?"}) |> json_response(422)
    assert error =~ "cannot be asked on the side"
  end

  test "an unknown session is not a path", %{conn: conn} do
    assert conn |> get("/api/agents/..%2F..%2Fetc/btw") |> json_response(404)
    assert conn |> post("/api/agents/a_nope/btw", %{text: "x"}) |> json_response(404)
    assert conn |> delete("/api/agents/a_nope/btw") |> json_response(404)
  end
end
