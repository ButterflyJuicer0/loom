defmodule LoomWeb.ProjectControllerTest do
  # Not async: the stub has a fixed name and the backend map is global config.
  use LoomWeb.ConnCase, async: false

  alias Loom.Agent
  alias Loom.BackendStub
  alias Loom.Projects

  setup %{conn: conn} do
    data_dir = Path.join(System.tmp_dir!(), "loom-pctl-#{System.unique_integer([:positive])}")
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
      for p <- Projects.list(), do: Projects.delete(p.id)
      Process.sleep(50)
      Application.put_env(:loom, Loom.Agent, previous)
      File.rm_rf(data_dir)
    end)

    conn =
      conn
      |> put_req_header("authorization", "Bearer " <> Loom.Auth.mint_token())
      |> put_req_header("content-type", "application/json")

    {:ok, conn: conn}
  end

  defmodule PickClassifier do
    @moduledoc false
    # Answers whatever the test put in the application env, after a moment.
    def classify(_text, _projects) do
      Process.sleep(20)
      Application.get_env(:loom, :test_classifier_answer)
    end
  end

  defp with_classifier(answer) do
    previous = Application.get_env(:loom, Loom.Projects)
    Application.put_env(:loom, Loom.Projects, Keyword.put(previous, :classifier, PickClassifier))
    Application.put_env(:loom, :test_classifier_answer, answer)

    on_exit(fn ->
      Application.put_env(:loom, Loom.Projects, previous)
      Application.delete_env(:loom, :test_classifier_answer)
    end)
  end

  defp create_project(conn, attrs) do
    conn |> post(~p"/api/projects", attrs) |> json_response(201)
  end

  test "creates, lists, updates and refuses", %{conn: conn} do
    %{"id" => id, "workspace" => ws} = create_project(conn, %{name: "Blog"})
    assert File.dir?(ws)

    assert %{"projects" => [%{"id" => ^id}]} =
             conn |> get(~p"/api/projects") |> json_response(200)

    assert %{"name" => "Blog 2", "instructions" => "Short."} =
             conn
             |> patch(~p"/api/projects/#{id}", %{name: "Blog 2", instructions: "Short."})
             |> json_response(200)

    assert %{"error" => _} = conn |> post(~p"/api/projects", %{name: ""}) |> json_response(422)
    assert conn |> patch(~p"/api/projects/p_nope", %{name: "x"}) |> json_response(404)
  end

  test "a session made in a project starts in its workspace and is told so", %{conn: conn} do
    %{"id" => pid, "workspace" => ws} =
      create_project(conn, %{name: "Novel", instructions: "Use British spelling."})

    %{"id" => id, "project_id" => ^pid} =
      conn
      |> post(~p"/api/agents", %{backend: "claude_code", project_id: pid})
      |> json_response(201)

    meta = BackendStub.last_meta()
    assert meta.cc_cwd == ws
    assert meta.instructions =~ ~s("Novel")
    assert meta.instructions =~ "Use British spelling."
    assert {:ok, %{project_id: ^pid}} = Loom.Agent.Store.read_meta(id)
  end

  test "editing a project hands its sessions the new instructions", %{conn: conn} do
    %{"id" => pid, "workspace" => ws} = create_project(conn, %{name: "Live"})

    conn
    |> post(~p"/api/agents", %{backend: "claude_code", project_id: pid})
    |> json_response(201)

    conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

    conn |> patch(~p"/api/projects/#{pid}", %{instructions: "New rules."}) |> json_response(200)
    assert_receive {:stub_relocated, ^ws, instructions}
    assert instructions =~ "New rules."
    # Only the session in the project.
    refute_receive {:stub_relocated, _, _}, 100
  end

  test "a loose session moves into a project, carrying on in its workspace", %{conn: conn} do
    %{"id" => pid, "workspace" => ws} =
      create_project(conn, %{name: "Home", instructions: "Be brief."})

    %{"id" => id} = conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

    assert %{"project_id" => ^pid} =
             conn |> patch(~p"/api/agents/#{id}", %{project_id: pid}) |> json_response(200)

    assert_receive {:stub_relocated, ^ws, instructions}
    assert instructions =~ ~s("Home")
    assert instructions =~ "Be brief."
    assert {:ok, %{project_id: ^pid}} = Loom.Agent.Store.read_meta(id)

    # And out again, to the default directory and Loom's own instructions.
    assert %{"project_id" => nil} =
             conn |> patch(~p"/api/agents/#{id}", %{project_id: nil}) |> json_response(200)

    assert_receive {:stub_relocated, nil, instructions}
    refute instructions =~ "Home"
  end

  test "an incognito session starts sandboxed in its own directory, and is kept on request", %{
    conn: conn
  } do
    %{"id" => id, "kind" => "incognito"} =
      conn
      |> post(~p"/api/agents", %{backend: "claude_code", incognito: true})
      |> json_response(201)

    ws = Loom.Agent.Sandbox.workspace(id)
    assert %{sandbox: true, cc_cwd: ^ws, instructions: instructions} = BackendStub.last_meta()
    assert instructions =~ "incognito"
    assert File.dir?(ws)

    # It cannot be moved into a project before it is kept.
    %{"id" => pid} = create_project(conn, %{name: "Work"})
    conn |> patch(~p"/api/agents/#{id}", %{project_id: pid}) |> json_response(422)

    # Nor be filed by the classifier, which looks only at sessions of no kind.
    assert %{"kind" => nil} =
             conn |> patch(~p"/api/agents/#{id}", %{incognito: false}) |> json_response(200)

    assert_receive {:stub_relocated, nil, instructions}
    refute instructions =~ "incognito chat"
    assert {:ok, %{kind: nil}} = Loom.Agent.Store.read_meta(id)

    {:ok, :started} = Agent.submit(id, "hello")
    text = BackendStub.await_turn()
    assert text =~ "kept this incognito chat"
    assert String.ends_with?(text, "hello")
  end

  test "a new session nothing is written in is deleted; a draft or a message keeps it", %{
    conn: conn
  } do
    new = fn -> conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201) end
    expire = fn id ->
      [{pid, _}] = Registry.lookup(Loom.Agent.Registry, id)
      ref = Process.monitor(pid)
      send(pid, :expire_unused)
      _ = :sys.get_state(pid)
      ref
    end

    %{"id" => empty} = new.()
    ref = expire.(empty)
    assert_receive {:DOWN, ^ref, _, _, _}, 1_000
    # The directory goes just after the process.
    assert Enum.any?(1..50, fn _ ->
             Process.sleep(10)
             Loom.Agent.Store.read_meta(empty) == :error
           end)

    %{"id" => drafted} = new.()
    Loom.Agent.Draft.write(drafted, "half a thought")
    expire.(drafted)
    Process.sleep(100)
    assert Agent.exists?(drafted)

    %{"id" => used} = new.()
    {:ok, :started} = Agent.submit(used, "hello")
    BackendStub.await_turn()
    expire.(used)
    Process.sleep(100)
    assert Agent.exists?(used)
  end

  test "the next turn after a move tells the backend, once, and the transcript nothing", %{
    conn: conn
  } do
    %{"id" => pid} = create_project(conn, %{name: "Notes", instructions: "Use bullet points."})
    %{"id" => id} = conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)
    conn |> patch(~p"/api/agents/#{id}", %{project_id: pid}) |> json_response(200)

    {:ok, :started} = Agent.submit(id, "hello")
    text = BackendStub.await_turn()
    assert text =~ "Note from Loom"
    assert text =~ "Use bullet points."
    assert String.ends_with?(text, "hello")

    {:ok, %{events: events}} = Agent.attach(id)
    assert [%{payload: %{text: "hello"}}] = Enum.filter(events, &(&1.kind == :user))

    [{session, _}] = Registry.lookup(Loom.Agent.Registry, id)
    send(session, {:stub, [{:event, :turn_done, %{}}]})
    _ = Agent.info(id)
    {:ok, _} = Agent.submit(id, "again")
    assert BackendStub.await_turn() == "again"
  end

  describe "filing a new session's first message" do
    test "into the project it belongs to, before the turn starts", %{conn: conn} do
      %{"id" => pid, "workspace" => ws} =
        create_project(conn, %{name: "Blog", instructions: "Casual."})

      with_classifier(pid)

      %{"id" => id} =
        conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

      {:ok, :started} = Agent.submit(id, "five titles for a post on hiking")
      # Typed while it waits: goes out with the first.
      {:ok, :queued} = Agent.submit(id, "and keep them short")

      assert_receive {:stub_relocated, ^ws, instructions}
      assert instructions =~ "Casual."
      text = BackendStub.await_turn()
      assert text =~ "five titles for a post on hiking"
      assert text =~ "and keep them short"
      assert Agent.info(id).project_id == pid

      {:ok, %{events: events}} = Agent.attach(id)

      assert %{payload: %{project_id: ^pid, name: "Blog", auto: true}} =
               Enum.find(events, &(&1.kind == :project_moved))
    end

    test "nowhere when no project fits, and only for the first message", %{conn: conn} do
      create_project(conn, %{name: "Blog"})
      with_classifier(nil)

      %{"id" => id} =
        conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

      {:ok, :started} = Agent.submit(id, "what is 2 + 2")
      assert BackendStub.await_turn() == "what is 2 + 2"
      refute_received {:stub_relocated, _, _}
      assert Agent.info(id).project_id == nil
    end

    test "not for a session made in a project", %{conn: conn} do
      %{"id" => pid} = create_project(conn, %{name: "Blog"})
      %{"id" => other} = create_project(conn, %{name: "Other"})
      with_classifier(other)

      %{"id" => id} =
        conn
        |> post(~p"/api/agents", %{backend: "claude_code", project_id: pid})
        |> json_response(201)

      {:ok, :started} = Agent.submit(id, "hello")
      assert BackendStub.await_turn() == "hello"
      assert Agent.info(id).project_id == pid
    end
  end

  test "a move is refused mid-turn, and to a project that does not exist", %{conn: conn} do
    %{"id" => pid} = create_project(conn, %{name: "Busy"})
    %{"id" => id} = conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

    assert %{"error" => "no such project"} =
             conn |> patch(~p"/api/agents/#{id}", %{project_id: "p_nope"}) |> json_response(422)

    {:ok, :started} = Agent.submit(id, "work")
    BackendStub.await_turn()

    assert %{"error" => "the session is in the middle of a turn"} =
             conn |> patch(~p"/api/agents/#{id}", %{project_id: pid}) |> json_response(422)

    assert Agent.info(id).project_id == nil
  end

  test "pinning is kept in the header", %{conn: conn} do
    %{"id" => id, "pinned" => false} =
      conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

    assert %{"pinned" => true} =
             conn |> patch(~p"/api/agents/#{id}", %{pinned: true}) |> json_response(200)

    assert {:ok, %{pinned: true}} = Loom.Agent.Store.read_meta(id)

    assert %{"pinned" => false} =
             conn |> patch(~p"/api/agents/#{id}", %{pinned: false}) |> json_response(200)
  end

  test "a session outside any project has no project and no cwd", %{conn: conn} do
    %{"project_id" => nil} =
      conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

    assert BackendStub.last_meta().cc_cwd == nil
  end

  test "an unknown project is refused", %{conn: conn} do
    assert %{"error" => "no such project"} =
             conn
             |> post(~p"/api/agents", %{backend: "claude_code", project_id: "p_nope"})
             |> json_response(422)

    assert Agent.list_sessions() == []
  end

  test "the tree lists the workspace, and its files download", %{conn: conn} do
    %{"id" => pid, "workspace" => ws} = create_project(conn, %{name: "Data"})
    File.write!(Path.join(ws, "data.csv"), "a,b\n")

    %{"id" => id} =
      conn
      |> post(~p"/api/agents", %{backend: "claude_code", project_id: pid})
      |> json_response(201)

    assert %{"workspace" => [%{"path" => "data.csv"}], "workspace_truncated" => false} =
             conn |> get(~p"/api/agents/#{id}/tree") |> json_response(200)

    assert conn |> get(~p"/api/agents/#{id}/workspace/data.csv") |> response(200) == "a,b\n"
    assert conn |> get(~p"/api/agents/#{id}/workspace/nope.csv") |> json_response(404)
  end

  test "the project's own tree lists its workspace, and its files download", %{conn: conn} do
    %{"id" => pid, "workspace" => ws} = create_project(conn, %{name: "Notes"})
    File.mkdir_p!(Path.join(ws, "drafts"))
    File.write!(Path.join(ws, "drafts/a.md"), "# a\n")
    File.write!(Path.join(ws, ".secret"), "x")

    assert %{"files" => [%{"path" => "drafts/a.md"}], "truncated" => false} =
             conn |> get(~p"/api/projects/#{pid}/tree") |> json_response(200)

    assert conn |> get(~p"/api/projects/#{pid}/files/drafts/a.md") |> response(200) == "# a\n"
    assert conn |> get(~p"/api/projects/#{pid}/files/.secret") |> json_response(404)
    assert conn |> get(~p"/api/projects/#{pid}/files/../x") |> json_response(404)
    assert conn |> get(~p"/api/projects/nope/tree") |> json_response(404)
  end

  test "a session outside a project has no workspace in its tree", %{conn: conn} do
    %{"id" => id} = conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

    refute Map.has_key?(
             conn |> get(~p"/api/agents/#{id}/tree") |> json_response(200),
             "workspace"
           )
  end

  test "deleting a project deletes its sessions, not others", %{conn: conn} do
    %{"id" => pid, "workspace" => ws} = create_project(conn, %{name: "Gone"})

    %{"id" => inside} =
      conn
      |> post(~p"/api/agents", %{backend: "claude_code", project_id: pid})
      |> json_response(201)

    %{"id" => outside} =
      conn |> post(~p"/api/agents", %{backend: "claude_code"}) |> json_response(201)

    assert conn |> delete(~p"/api/projects/#{pid}") |> response(204)
    refute Agent.exists?(inside)
    assert Loom.Agent.Store.read_meta(inside) == :error
    assert Agent.exists?(outside)
    refute File.exists?(ws)
  end
end
