defmodule LoomWeb.AgentImageControllerTest do
  @moduledoc "Share image: a rendered page of the conversation drawn by headless Chrome."
  use LoomWeb.ConnCase, async: false

  alias Loom.Agent
  alias Loom.BackendStub

  setup %{conn: conn} do
    data_dir = Path.join(System.tmp_dir!(), "loom-img-#{System.unique_integer([:positive])}")
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

    id = "a_img#{System.unique_integer([:positive])}"
    {:ok, _pid} = Agent.start_session(id, backend: :claude_code)

    conn = put_req_header(conn, "authorization", "Bearer " <> Loom.Auth.mint_token())
    %{conn: conn, id: id}
  end

  defp page(html) do
    path = Path.join(System.tmp_dir!(), "page-#{System.unique_integer([:positive])}.html")
    File.write!(path, html)
    %Plug.Upload{path: path, filename: "page.html", content_type: "text/html"}
  end

  test "the document locks out network, and script but the measuring line" do
    doc = Loom.Snapshot.document("<p>hi</p>", "p{color:red}</style><script>", nil)
    assert doc =~ "default-src 'none'; img-src data:"
    refute doc =~ "script-src"
    refute doc =~ "</style><script>"
    assert Loom.Snapshot.document("<p>hi</p>", "", "n0nce") =~ "script-src 'nonce-n0nce'"
  end

  @tag :chrome
  test "draws a PNG as tall as the page", %{conn: conn, id: id} do
    if System.find_executable("google-chrome") || System.find_executable("chromium") do
      conn = post(conn, "/api/agents/#{id}/image", %{"page" => page(~s(<div style="height:1500px">你好 Loom</div>)), "css" => ""})
      assert ["image/png" <> _] = get_resp_header(conn, "content-type")
      assert <<0x89, "PNG", _::binary-size(12), w::32, h::32, _::binary>> = conn.resp_body
      assert {w, h} == {880, 3000}
    end
  end

  test "an unknown session or a missing page is refused", %{conn: conn, id: id} do
    assert conn |> post("/api/agents/a_nope/image", %{"page" => page("x")}) |> json_response(404)
    assert conn |> post("/api/agents/#{id}/image", %{"css" => ""}) |> json_response(422)
  end
end
