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
end
