defmodule Loom.Agent.ManifestTest do
  use ExUnit.Case, async: false

  alias Loom.Agent.{Manifest, Store}

  @moduletag :tmp_dir

  setup %{tmp_dir: dir} do
    previous = Application.get_env(:loom, Loom.Agent, [])
    Application.put_env(:loom, Loom.Agent, Keyword.put(previous, :data_dir, dir))
    on_exit(fn -> Application.put_env(:loom, Loom.Agent, previous) end)
    :ok
  end

  defp events(id, list) do
    File.mkdir_p!(Path.dirname(Store.events_path(id)))

    body =
      list
      |> Enum.with_index(1)
      |> Enum.map_join("", fn {{kind, payload}, seq} ->
        Jason.encode!(%{at: seq, seq: seq, kind: kind, payload: payload}) <> "\n"
      end)

    File.write!(Store.events_path(id), body)
  end

  defp use(id, name, input), do: {"tool_use", %{id: id, name: name, input: input, block_id: id}}

  defp result(id, output),
    do: {"tool_result", %{id: id, name: "Bash", output: output, status: "ok"}}

  test "files, device paths, downloads, commits and shares — paths only" do
    events("a_m", [
      {"user", %{text: "go"}},
      use("1", "Write", %{"file_path" => "/w/notes.md", "content" => "secret=hunter2"}),
      use("2", "Edit", %{"file_path" => "/w/app.ex", "old_string" => "a", "new_string" => "b"}),
      use("3", "Bash", %{
        "command" =>
          ~s(loom-node exec HomeWindows -- powershell -c "Invoke-WebRequest https://x.example/app.apk?token=abc -OutFile C:\\Users\\me\\Downloads\\app.apk")
      }),
      use("4", "Bash", %{"command" => "loom-node read HomeWindows 'C:\\logs\\a.txt' > /tmp/a.txt"}),
      use("5", "Bash", %{"command" => "curl -sL https://x.example/f.tgz?key=zzz -o /tmp/f.tgz"}),
      use("6", "Bash", %{"command" => "git commit -m 'x'"}),
      result("6", "[batch8/continue 1a2b3c4] x\n 1 file changed"),
      use("7", "Bash", %{"command" => "loom-share publish out/"}),
      result("7", "published: https://k3j2.share.quanai.space/ password set"),
      use("8", "Read", %{"file_path" => "/w/other.md"})
    ])

    lines = Manifest.lines("a_m")

    assert lines == [
             "wrote: /w/notes.md",
             "edited: /w/app.ex",
             "downloaded on HomeWindows: C:\\Users\\me\\Downloads\\app.apk",
             "read on HomeWindows: C:\\logs\\a.txt",
             "downloaded: /tmp/f.tgz",
             "commit: 1a2b3c4 on batch8/continue",
             "shared: https://k3j2.share.quanai.space/"
           ]

    refute Enum.any?(lines, &(&1 =~ ~r/hunter2|token|key=/))
  end

  test "a quiet commit by its subject and repo; a path ending a command" do
    events("a_q", [
      use("1", "Bash", %{
        "command" =>
          ~s(cd /home/u/loom && git add a.ex && git commit -q -m "Fix the header\n\nWhy")
      }),
      result("1", ""),
      use("2", "Bash", %{"command" => "git -C /w/site commit -qm 'Landing copy'"}),
      use("3", "Bash", %{"command" => "curl -sL https://x.example/a.cpp -o /tmp/a.cpp; ls"})
    ])

    assert Manifest.lines("a_q") == [
             "commit in /home/u/loom: Fix the header",
             "commit in /w/site: Landing copy",
             "downloaded: /tmp/a.cpp"
           ]
  end

  test "a session with nothing behind it" do
    events("a_e", [{"user", %{text: "hi"}}])
    assert Manifest.lines("a_e") == []
  end
end
