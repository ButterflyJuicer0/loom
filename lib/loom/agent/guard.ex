defmodule Loom.Agent.Guard do
  @moduledoc """
  Rules a session's tool calls are checked against before they run, for the
  virtual employees given a workstation (`Loom.Employees`). A session has
  rules when `~/.loom/guards/<id>.json` exists; its backend then installs
  `loom-guard` (`rel/loom-guard`) as the hook that runs before every tool —
  Claude Code's `PreToolUse` through `--settings`, Kiro's `preToolUse` in its
  agent — at each spawn. The hook reads the file at every call, so the rules
  can change under a running process; without a workstation in them it lets
  everything through.

  The same file carries an employee's `permissions`, when it has them: the
  tools Claude Code is started with and the rules it checks every call
  against itself (`claude_args/1`). Those are flags, so they hold from the
  next spawn; a refusal is a line in the same log as the hook's (`denied/2`).
  """

  alias Loom.Agent.Store

  def dir, do: Path.join(Store.home(), "guards")
  def path(session_id), do: Path.join(dir(), "#{session_id}.json")

  def guarded?(session_id), do: is_binary(session_id) and File.exists?(path(session_id))

  @doc """
  The hook's command, as installed by `rel/deploy.sh`, told where the rules
  are: an agent's environment does not carry Loom's home.
  """
  def command do
    exe =
      Application.get_env(:loom, __MODULE__, [])[:command] ||
        Path.expand("~/.local/bin/loom-guard")

    "#{exe} #{dir()}"
  end

  @doc "Write a session's rules (a map), or with nil take them away."
  def put(session_id, nil), do: File.rm(path(session_id))

  def put(session_id, rules) do
    File.mkdir_p!(dir())
    tmp = path(session_id) <> ".tmp"
    File.write!(tmp, Jason.encode!(rules, pretty: true))
    File.rename!(tmp, path(session_id))
  end

  @doc "A session's rules, or nil."
  def rules(session_id) do
    with true <- guarded?(session_id),
         {:ok, body} <- File.read(path(session_id)),
         {:ok, %{} = rules} <- Jason.decode(body) do
      rules
    else
      _ -> nil
    end
  end

  @doc """
  Claude Code's flags for a session: the hook when it has a workstation, and
  its permissions as Claude Code's own (`--tools`, `--allowedTools`,
  `--disallowedTools`), under `dontAsk`, where a call no rule allows is
  refused rather than asked about. MCP tools are allowed one by one
  (`mcp__server__tool`, or `mcp__server` for all of one); with none allowed,
  `--strict-mcp-config` loads no server at all. Every other session runs
  under `bypassPermissions`.
  """
  def claude_args(session_id) do
    rules = rules(session_id) || %{}
    hook =
      case claude_settings(rules) do
        nil -> []
        settings -> ["--settings", settings]
      end

    case rules["permissions"] do
      %{} = p ->
        hook ++
          ["--permission-mode", "dontAsk"] ++
          flag("--tools", [Enum.join(p["tools"] || [], ",")]) ++
          flag("--allowedTools", (p["allow"] || []) ++ (rules["allow_own"] || [])) ++
          flag("--disallowedTools", p["deny"] || []) ++
          if(Enum.any?(p["allow"] || [], &String.starts_with?(&1, "mcp__")),
            do: [],
            else: ["--strict-mcp-config"]
          )

      _ ->
        hook ++ ["--permission-mode", "bypassPermissions"]
    end
  end

  # `--tools ""` is no tools at all, which is what an empty list means.
  defp flag("--tools", values), do: ["--tools" | values]
  defp flag(_name, []), do: []
  defp flag(name, values), do: [name | values]

  @doc """
  Claude Code refused a call under the session's permissions: a line in its
  log, for the employee's Updates. Nothing without permissions.
  """
  def denied(session_id, tool, input) do
    with %{"permissions" => %{}, "log" => log} when is_binary(log) <- rules(session_id) do
      what = tool <> " " <> describe(input)

      File.write!(
        log,
        Jason.encode!(%{at: System.system_time(:millisecond), what: what, by: "permissions"}) <>
          "\n",
        [:append]
      )
    end

    :ok
  rescue
    _ -> :ok
  end

  defp describe(%{"command" => c}) when is_binary(c), do: c
  defp describe(%{"file_path" => f}) when is_binary(f), do: f
  defp describe(%{"url" => u}) when is_binary(u), do: u
  defp describe(%{} = input), do: input |> Jason.encode!() |> String.slice(0, 200)
  defp describe(_), do: ""

  # Both names: the first for the Anthropic API, the second for Bedrock.
  @cache_1h_env %{"ENABLE_PROMPT_CACHING_1H" => "1", "ENABLE_PROMPT_CACHING_1H_BEDROCK" => "1"}

  @doc """
  Claude Code's `--settings` for a session's rules, or nil: the hook when it
  has a workstation; the hour-long prompt cache when it asks for one
  (`cache_1h`, an employee whose heartbeat outlasts the 5-minute default, so
  each wake-up reads the cache instead of writing the whole context again).
  """
  def claude_settings(rules) do
    %{}
    |> then(&if(rules["workstation"], do: Map.put(&1, :hooks, hooks()), else: &1))
    |> then(&if(rules["cache_1h"], do: Map.put(&1, :env, @cache_1h_env), else: &1))
    |> case do
      empty when map_size(empty) == 0 -> nil
      settings -> Jason.encode!(settings)
    end
  end

  defp hooks,
    do: %{"PreToolUse" => [%{matcher: "", hooks: [%{type: "command", command: command()}]}]}

  @doc "A Kiro agent's `hooks`."
  def kiro_hooks, do: %{"preToolUse" => [%{matcher: "*", command: command()}]}
end
