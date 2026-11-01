defmodule Loom.Agent.Sandbox do
  @moduledoc """
  The walls of an incognito session (`kind: "incognito"`): the agent reads
  everything it normally could — skills, CLAUDE.md, code, other files — and
  writes only its own workspace, its output, `/tmp`, caches and its backend's
  own conversation store. So a quick question leaves no memory, skill or
  project file changed. Hygiene, not security: nothing is hidden, and the
  network is open.

  Claude Code and Kiro run under `bwrap` (bubblewrap): the whole filesystem
  bound read-only, the writable paths bound over it. Ubuntu 24.04 only lets
  bwrap make the user namespace it needs with an AppArmor profile,
  `/etc/apparmor.d/bwrap` (`userns,` for `/usr/bin/bwrap`). Codex runs its
  commands in its own `workspace-write` sandbox instead, which the shared
  app-server applies per thread (`Loom.Agent.Codex.Server`).

  Measured 2026-11-01 (CC 2.1.312, Kiro 1.28.1, Codex 0.166): all three
  answer and write their workspace; writes to `~/.claude`, `~/.kiro` and
  `~/.codex` fail with "Read-only file system". Claude Code runs fine with
  `~/.claude.json` read-only, and its auto memory is switched off outright.
  """

  @doc "Where an incognito session works: inside its own directory, gone with it."
  def workspace(session_id), do: Path.join(Loom.Agent.Store.session_dir(session_id), "workspace")

  @doc """
  `exe args` as they should be spawned: unchanged outside a sandbox, otherwise
  under `bwrap`, writable only in `writable` (made first) and `/tmp`, except
  for `readonly` inside them.
  """
  def wrap(sandbox?, exe, args, writable, readonly \\ [])
  def wrap(false, exe, args, _writable, _readonly), do: {exe, args}
  def wrap(nil, exe, args, _writable, _readonly), do: {exe, args}

  def wrap(true, exe, args, writable, readonly) do
    binds =
      writable
      |> Enum.uniq()
      |> Enum.flat_map(fn dir ->
        File.mkdir_p(dir)
        if File.dir?(dir), do: ["--bind", dir, dir], else: []
      end)

    {bwrap(),
     ["--ro-bind", "/", "/", "--dev-bind", "/dev", "/dev", "--proc", "/proc"] ++
       ["--bind", "/tmp", "/tmp"] ++
       binds ++
       Enum.flat_map(Enum.filter(readonly, &File.exists?/1), &["--ro-bind", &1, &1]) ++
       ["--setenv", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1", "--", exe | args]}
  end

  @doc "Caches every tool may fill (uv, npm, pip): not pollution, and MCP servers start from them."
  def caches, do: [Path.expand("~/.cache")]

  @doc "Claude Code's directory for conversations started in `cwd`."
  def claude_project_dir(cwd) do
    base = System.get_env("CLAUDE_CONFIG_DIR") || Path.expand("~/.claude")
    Path.join([base, "projects", String.replace(cwd, ~r/[^a-zA-Z0-9]/, "-")])
  end

  defp bwrap, do: System.find_executable("bwrap") || "bwrap"

  @doc "Told to the agent in its system prompt, so a read-only error is no surprise."
  def instructions do
    """
    This is an incognito chat: quick, one-off questions the user does not want \
    in their memory or projects. Everything is readable as usual, but files \
    outside your working directory, the output directory and /tmp are \
    read-only, and you have no memory: save nothing to memory, skills or \
    project files, and do not try to work around the read-only filesystem. \
    It is not listed in the user's Recents and is deleted 30 days after its \
    last message unless the user pins or keeps it.\
    """
  end
end
