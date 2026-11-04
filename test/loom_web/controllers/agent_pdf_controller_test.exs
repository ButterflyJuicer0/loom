defmodule LoomWeb.AgentPdfControllerTest do
  @moduledoc "Share PDF: a rendered page of the conversation printed by headless Chrome."
  use LoomWeb.ConnCase, async: false

  alias Loom.Agent
  alias Loom.BackendStub

  setup %{conn: conn} do
    data_dir = Path.join(System.tmp_dir!(), "loom-pdf-#{System.unique_integer([:positive])}")
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

    id = "a_pdf#{System.unique_integer([:positive])}"
    {:ok, _pid} = Agent.start_session(id, backend: :claude_code)

    conn = put_req_header(conn, "authorization", "Bearer " <> Loom.Auth.mint_token())
    %{conn: conn, id: id}
  end

  defp page(html) do
    path = Path.join(System.tmp_dir!(), "page-#{System.unique_integer([:positive])}.html")
    File.write!(path, html)
    %Plug.Upload{path: path, filename: "page.html", content_type: "text/html"}
  end

  test "the document locks out script and network" do
    doc = Loom.Pdf.document("<p>hi</p>", "p{color:red}</style><script>", "a <b>")
    assert doc =~ "default-src 'none'; img-src data:"
    assert doc =~ "<title>a &lt;b&gt;</title>"
    refute doc =~ "</style><script>"
  end

  @tag :chrome
  test "prints a PDF", %{conn: conn, id: id} do
    if System.find_executable("google-chrome") || System.find_executable("chromium") do
      conn = post(conn, "/api/agents/#{id}/pdf", %{"page" => page("<h1>你好 Loom</h1>"), "css" => "", "title" => "t"})
      assert ["application/pdf" <> _] = get_resp_header(conn, "content-type")
      assert "%PDF" <> _ = conn.resp_body
    end
  end

  test "an unknown session or a missing page is refused", %{conn: conn, id: id} do
    assert conn |> post("/api/agents/a_nope/pdf", %{"page" => page("x")}) |> json_response(404)
    assert conn |> post("/api/agents/#{id}/pdf", %{"css" => ""}) |> json_response(422)
  end
end
