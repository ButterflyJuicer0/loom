defmodule Loom.OneShot do
  @moduledoc """
  The model calls Loom makes of its own, rather than through a session: a
  one-shot `claude -p` on the smallest model, with no tools, no MCP servers, no
  settings or memory and nothing persisted. About two seconds and a fifth of a
  cent (measured).

  Used to file a new session into a project (`Loom.Projects.Classifier`) and
  to read a task the user described in words (`Loom.Cron.Describe`).

  No settings, but their `env`: on a host logged in through Bedrock that is
  where the login is (`CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION` in
  `~/.claude/settings.json`), and the service's own environment has none of
  it. Without them every call answered "Not logged in" and each new session
  was quietly left out of its project.

  The model is `LOOM_ONESHOT_MODEL` (default `haiku`). Some gateways offer
  only some models (a Bedrock proxy that maps just opus, say), and there
  `haiku` is refused: then the call is made once more with no `--model`, so
  the CLI's own default answers, slower but answered.
  """

  @doc "The model's reply to `text` under `system`: `{:ok, reply}` or `{:error, reason}`."
  def ask(system, text) do
    model = model()

    case ask(system, text, model) do
      {:error, _} = error when not is_nil(model) ->
        case ask(system, text, nil) do
          {:ok, _} = ok -> ok
          _ -> error
        end

      result ->
        result
    end
  end

  defp model do
    case Application.get_env(:loom, __MODULE__, [])[:model] do
      nil -> "haiku"
      "" -> nil
      m -> m
    end
  end

  defp ask(system, text, model) do
    with {:ok, exe} <- executable(),
         {out, 0} <-
           System.cmd(exe, args(system, text, model), cd: System.tmp_dir!(), env: env()),
         {:ok, %{"result" => reply} = answer} when is_binary(reply) <- Jason.decode(out),
         false <- answer["is_error"] == true do
      {:ok, reply}
    else
      {:error, reason} -> {:error, reason}
      other -> {:error, other}
    end
  rescue
    error -> {:error, error}
  end

  defp args(system, text, model) do
    if(model, do: ["--model", model], else: []) ++
      [
        "-p",
        "--no-session-persistence",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--output-format",
        "json",
        "--system-prompt",
        system,
        # Ends the options: text that starts with "-" is still the prompt.
        "--",
        text
      ]
  end

  defp executable do
    configured = Application.get_env(:loom, Loom.Agent, [])[:claude_cli] || "claude"

    case System.find_executable(configured) do
      nil -> {:error, :no_claude}
      path -> {:ok, path}
    end
  end

  # What every child gets (`Loom.ChildEnv`), plus the `env` of Claude Code's
  # user settings, which `--setting-sources ""` would otherwise drop; with
  # loom's own variables unset rather than merely left out: `System.cmd` adds
  # to the environment.
  @doc false
  def env do
    keep = Map.merge(Loom.ChildEnv.map(), settings_env())
    drop = for {key, _} <- System.get_env(), not Map.has_key?(keep, key), do: {key, nil}
    Enum.to_list(keep) ++ drop
  end

  # Settings win, as they do in Claude Code itself.
  defp settings_env do
    dir = System.get_env("CLAUDE_CONFIG_DIR") || Path.expand("~/.claude")

    with {:ok, body} <- File.read(Path.join(dir, "settings.json")),
         {:ok, %{"env" => env}} when is_map(env) <- Jason.decode(body) do
      for {key, value} <- env,
          is_binary(key),
          value != nil,
          into: %{},
          do: {key, to_string(value)}
    else
      _ -> %{}
    end
  end
end
