defmodule Loom.Agent.SandboxTest do
  use ExUnit.Case, async: true

  alias Loom.Agent.{Incognito, Sandbox}

  test "outside a sandbox the command is unchanged" do
    assert Sandbox.wrap(false, "claude", ["-p"], ["/x"]) == {"claude", ["-p"]}
  end

  test "inside, everything is read-only but the writable paths and /tmp" do
    dir = Path.join(System.tmp_dir!(), "loom-sandbox-#{System.unique_integer([:positive])}")
    ro = Path.join(dir, "kb")
    File.mkdir_p!(ro)
    {exe, args} = Sandbox.wrap(true, "claude", ["-p"], [dir, dir], [ro, "/no/such"])

    assert exe =~ "bwrap"
    assert Enum.take(args, 3) == ["--ro-bind", "/", "/"]
    assert Enum.chunk_every(args, 3, 1) |> Enum.count(&(&1 == ["--bind", dir, dir])) == 1
    assert Enum.chunk_every(args, 3, 1) |> Enum.member?(["--ro-bind", ro, ro])
    refute "/no/such" in args
    assert Enum.take(args, -3) == ["--", "claude", "-p"]
    assert ["--setenv", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1"] in Enum.chunk_every(args, 3, 1)
    File.rm_rf!(dir)
  end

  test "Claude Code's project directory is the cwd with every other character a dash" do
    assert Sandbox.claude_project_dir("/home/u/.loom/sessions/a_x-1/workspace") =~
             ~r{/projects/-home-u--loom-sessions-a-x-1-workspace$}
  end

  test "incognito sessions go 30 days after their last message, unless busy or pinned" do
    now = 100 * 24 * 3600 * 1000
    old = now - 31 * 24 * 3600 * 1000

    sessions = [
      %{id: "a", kind: "incognito", status: :idle, last_active_at: old},
      %{id: "b", kind: "incognito", status: :running, last_active_at: old},
      %{id: "c", kind: "incognito", status: :idle, last_active_at: now - 1000},
      %{id: "d", kind: nil, status: :idle, last_active_at: old},
      %{id: "e", kind: "incognito", status: :idle, last_active_at: old, pinned: true}
    ]

    assert Incognito.expired(sessions, now) == ["a"]
  end
end
