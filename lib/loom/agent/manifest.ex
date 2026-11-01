defmodule Loom.Agent.Manifest do
  @moduledoc """
  What a session left behind, for `loom-session read --files`: the files it
  wrote or edited, what it read from, wrote to or downloaded on the user's
  devices (`loom-node`), the commits it made, the pages it shared, and what is
  in its output directory. So a session carrying another one on knows where
  its things are, which the conversation alone does not say: those steps are
  tool calls, and `read` leaves tool calls out.

  Taken from the tool calls as they were made, not judged: which of these
  matter is for the agent reading it. Paths and actions only — never a file's
  contents or a command's output, which is where passwords and keys would be.
  Commands are recognised by their usual shapes (`curl -o`, `wget -O`,
  `Invoke-WebRequest -OutFile`, `aws s3 cp`, `scp`, `git commit`); others are
  not listed.
  """

  alias Loom.Agent.{Output, Store}

  @limit 120

  @doc "One line per thing, oldest first, without repeats."
  def lines(id) do
    {uses, results} = calls(id)

    from_calls =
      Enum.flat_map(uses, fn {use_id, name, input} ->
        of_call(name, input, Map.get(results, use_id, ""))
      end)

    outputs =
      id
      |> Output.list()
      |> Enum.map(&"output: #{Path.join(Store.output_dir(id), &1.path)}")

    (from_calls ++ outputs)
    |> Enum.uniq()
    |> Enum.take(-@limit)
  end

  # Tool calls in order, and each one's result by id.
  defp calls(id) do
    Store.events_path(id)
    |> File.stream!()
    |> Enum.reduce({[], %{}}, fn line, {uses, results} = acc ->
      cond do
        String.contains?(line, ~s("kind":"tool_use")) ->
          case Jason.decode(line) do
            {:ok, %{"payload" => %{"id" => u, "name" => n, "input" => i}}} when is_map(i) ->
              {[{u, n, i} | uses], results}

            _ ->
              acc
          end

        # Only those that can name a commit or a share.
        String.contains?(line, ~s("kind":"tool_result")) and
            (String.contains?(line, "share.") or String.contains?(line, "] ")) ->
          case Jason.decode(line) do
            {:ok, %{"payload" => %{"id" => u, "output" => out}}} when is_binary(out) ->
              {uses, Map.put(results, u, out)}

            _ ->
              acc
          end

        true ->
          acc
      end
    end)
    |> then(fn {uses, results} -> {Enum.reverse(uses), results} end)
  rescue
    _ -> {[], %{}}
  end

  defp of_call(name, %{"file_path" => path}, _out)
       when name in ["Write", "Edit", "MultiEdit"] and is_binary(path),
       do: ["#{if name == "Write", do: "wrote", else: "edited"}: #{path}"]

  defp of_call("NotebookEdit", %{"notebook_path" => path}, _out) when is_binary(path),
    do: ["edited: #{path}"]

  defp of_call("Bash", %{"command" => command}, out) when is_binary(command),
    do: of_command(command) ++ of_result(command, out)

  defp of_call(_name, _input, _out), do: []

  # ── Commands ────────────────────────────────────────────────────────────

  defp of_command(command) do
    case Regex.run(~r/\bloom-node\s+(read|write|exec)\s+(\S+)\s*(.*)/s, command) do
      [_, "read", device, rest] ->
        ["read on #{device}: #{first_word(rest)}"]

      [_, "write", device, rest] ->
        ["wrote on #{device}: #{first_word(rest)}"]

      [_, "exec", device, rest] ->
        rest |> after_dashes() |> downloads() |> Enum.map(&"downloaded on #{device}: #{&1}")

      nil ->
        command |> downloads() |> Enum.map(&"downloaded: #{&1}")
    end
  end

  defp after_dashes(rest) do
    case String.split(rest, ~r/(^|\s)--\s/, parts: 2) do
      [_, command] -> command
      _ -> rest
    end
  end

  # Where a download landed: the path, not the URL (which may carry a token).
  @downloads [
    ~r/\bcurl\b[^\n|;&]*?\s(?:-o|--output)\s+("[^"]+"|'[^']+'|\S+)/,
    ~r/\bwget\b[^\n|;&]*?\s(?:-O|--output-document)\s+("[^"]+"|'[^']+'|\S+)/,
    ~r/\b(?:Invoke-WebRequest|iwr|curl\.exe)\b[^\n|;&]*?\s-OutFile\s+("[^"]+"|'[^']+'|\S+)/i,
    ~r/\baws\s+s3\s+cp\s+\S+\s+("[^"]+"|'[^']+'|\S+)/,
    ~r/\bscp\b(?:\s+-\S+)*\s+\S+\s+("[^"]+"|'[^']+'|\S+)/
  ]

  defp downloads(command) do
    @downloads
    |> Enum.flat_map(&Regex.scan(&1, command, capture: :all_but_first))
    |> Enum.map(fn [path] ->
      path |> String.trim_trailing(";") |> String.trim("\"") |> String.trim("'")
    end)
    |> Enum.reject(&(&1 in ["-", "/dev/null", "NUL"]))
  end

  defp first_word(rest) do
    case Regex.run(~r/^\s*("[^"]+"|'[^']+'|\S+)/, rest, capture: :all_but_first) do
      [path] -> path |> String.trim("\"") |> String.trim("'")
      _ -> "?"
    end
  end

  # ── Results ─────────────────────────────────────────────────────────────

  @commit ~r/\bgit(?:\s+-C\s+\S+)?\s+commit\b/

  defp of_result(command, out) do
    commits =
      if Regex.match?(@commit, command) do
        case Regex.scan(~r/^\[([\w.\/-]+)(?: \(root-commit\))? ([0-9a-f]{7,})\]/m, out) do
          [] -> quiet_commit(command)
          found -> Enum.map(found, fn [_, b, c] -> "commit: #{c} on #{b}" end)
        end
      else
        []
      end

    shares =
      ~r/https:\/\/[a-z0-9-]+\.share\.quanai\.space\/?/
      |> Regex.scan(out)
      |> Enum.map(fn [url] -> "shared: #{url}" end)

    commits ++ shares
  end

  # `git commit -q` says nothing: its subject, and where, from the command.
  defp quiet_commit(command) do
    subject =
      case Regex.run(~r/\s-\w*m\s*(?:"([^"\n]*)|'([^'\n]*))/, command, capture: :all_but_first) do
        [s] -> s
        [_, s] -> s
        _ -> nil
      end

    dir =
      case Regex.run(~r/\bgit\s+-C\s+(\S+)/, command) ||
             Regex.run(~r/(?:^|&&|;)\s*cd\s+(\S+)[^\n]*?\bgit\s+commit/, command) do
        [_, dir] -> " in #{dir}"
        _ -> ""
      end

    if subject, do: ["commit#{dir}: #{String.slice(subject, 0, 80)}"], else: ["commit#{dir}"]
  end
end
