defmodule LoomWeb.DeviceSessionsControllerTest do
  use ExUnit.Case, async: true

  alias LoomWeb.DeviceSessionsController, as: C

  @sessions [
    %{"file" => "a", "title" => "AWS internal mcp 部署", "first" => "部署 mcp", "live" => true},
    %{"file" => "b", "title" => "简历生成", "first" => "按 JD 写简历"},
    %{"file" => "c", "title" => "unrelated", "first" => "hello"}
  ]

  test "matching words picks the session that shares the most, CJK included" do
    assert [%{file: "a"} | _] = C.by_words("继续部署 mcp 服务", @sessions)
    assert [%{file: "b"}] = C.by_words("改一下简历", @sessions)
    assert [] = C.by_words("zzz", @sessions)
  end

  test "the brief points the agent at the device, the folder and the original session" do
    node = %{name: "mac", os: "darwin", arch: "arm64"}

    s = %{
      "agent" => "claude",
      "id" => "abc",
      "cwd" => "/Users/me/it's here",
      "title" => "T",
      "messages" => 3,
      "updated" => "now",
      "file" => "/f.jsonl",
      "live" => false
    }

    tail = %{
      "messages" => [
        %{"role" => "user", "text" => "hi"},
        %{"role" => "assistant", "text" => "", "tools" => ["Bash ls"]}
      ]
    }

    {display, prompt} = C.brief(node, %{}, s, tail, "go on")

    assert display =~ "**T**"
    assert display =~ "> go on"
    assert prompt =~ ~s(loom-node exec mac --cwd '/Users/me/it'\\''s here')
    assert prompt =~ "claude -p --resume abc"
    assert prompt =~ "**User:** hi"
    assert prompt =~ "▸ Bash ls"
    assert prompt =~ "## What the user wants now\ngo on"

    {_, idle} = C.brief(node, %{}, s, tail, "")
    assert idle =~ "Nothing yet"
  end

  describe "the script's delete op" do
    # Runs priv/device_sessions/sessions.py for real against a made-up home.
    defp run_script(home, args) do
      source = C.source(args)

      {out, 0} =
        System.cmd("python3", ["-c", source],
          env: [{"HOME", home}, {"XDG_DATA_HOME", Path.join(home, ".local/share")}]
        )

      Jason.decode!(out)
    end

    setup do
      home = Path.join(System.tmp_dir!(), "dsess-#{System.unique_integer([:positive])}")
      on_exit(fn -> File.rm_rf(home) end)
      project = Path.join(home, ".claude/projects/-work")
      File.mkdir_p!(Path.join(project, "abc/subagents"))
      file = Path.join(project, "abc.jsonl")
      File.write!(file, ~s({"type":"user","sessionId":"abc"}\n))
      %{home: home, path: file}
    end

    test "moves the transcript and its folder into the trash together", %{home: home, path: file} do
      assert %{"deleted" => true, "trashed_to" => dest, "files" => ["abc.jsonl", "abc"]} =
               run_script(home, %{"op" => "delete", "agent" => "claude", "file" => file, "id" => "abc"})

      refute File.exists?(file)
      refute File.exists?(Path.rootname(file))
      assert String.starts_with?(dest, Path.join(home, ".local/share/Trash/files/claude-abc-"))
      assert File.exists?(Path.join(dest, "abc.jsonl"))
      assert File.dir?(Path.join(dest, "abc/subagents"))
      assert [info] = Path.wildcard(Path.join(home, ".local/share/Trash/info/*.trashinfo"))
      assert File.read!(info) =~ "Path=#{Path.dirname(file)}"
    end

    test "refuses a running session", %{home: home, path: file} do
      File.mkdir_p!(Path.join(home, ".claude/sessions"))
      pid = System.pid() |> String.to_integer()

      File.write!(
        Path.join(home, ".claude/sessions/#{pid}.json"),
        Jason.encode!(%{sessionId: "abc", pid: pid})
      )

      assert %{"error" => "that session is still running" <> _} =
               run_script(home, %{"op" => "delete", "agent" => "claude", "file" => file})

      assert File.exists?(file)

      # Loom vouches for one of its own: it has just stopped it.
      assert %{"deleted" => true} =
               run_script(home, %{"op" => "delete", "agent" => "claude", "file" => file, "checked" => true})
    end

    test "touches nothing outside the agent's own store", %{home: home} do
      outside = Path.join(home, "notes.jsonl")
      File.write!(outside, "{}\n")

      assert %{"error" => "not a session file"} =
               run_script(home, %{"op" => "delete", "agent" => "claude", "file" => outside})

      sneaky = Path.join(home, ".claude/projects/-work/../../../notes.jsonl")

      assert %{"error" => "not a session file"} =
               run_script(home, %{"op" => "delete", "agent" => "claude", "file" => sneaky})

      assert File.exists?(outside)
    end
  end
end
