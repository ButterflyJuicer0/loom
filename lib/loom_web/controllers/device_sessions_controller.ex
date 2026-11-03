defmodule LoomWeb.DeviceSessionsController do
  @moduledoc """
  The agent sessions on a device — Claude Code and Codex, running or past —
  for the Devices dialog's Sessions view.

  Nothing is kept on this side: each request runs
  `priv/device_sessions/sessions.py` on the device through its channel (the
  same path as `loom-node exec`, see `LoomWeb.NodeController`) and returns what
  it prints. The script only reads `~/.claude` and `~/.codex` there, and a
  transcript is only ever read from inside those.

  The device needs `python3`, so macOS and Linux/WSL; others get a 422.

  Two actions build on that:

    - `continue/2` carries a device session on in a new Loom session: its
      first message is the device session's gist and recent turns, and the
      agent works where the original did — the device, through `loom-node` —
      and may resume the original there (`claude --resume`) when the whole
      history matters.
    - `pick/2` reads a task the user described and names the device sessions
      most likely to be that work (`Loom.OneShot`), with a reason each; when
      the model cannot be reached it falls back to matching words.
  """
  use LoomWeb, :controller

  alias Loom.Agent
  alias Loom.Nodes

  @await_ms 5_000
  @timeout_s 60
  @max_out 8 * 1024 * 1024

  def index(conn, %{"id" => id} = params) do
    limit = params |> Map.get("limit", "40") |> to_int(40) |> min(200) |> max(1)
    run(conn, id, %{"op" => "list", "limit" => limit})
  end

  def show(conn, %{"id" => id, "agent" => agent, "file" => file} = params)
      when agent in ~w(claude codex) do
    limit = params |> Map.get("limit", "120") |> to_int(120) |> min(500) |> max(1)
    run(conn, id, %{"op" => "transcript", "agent" => agent, "file" => file, "limit" => limit})
  end

  def show(conn, _params),
    do: conn |> put_status(400) |> json(%{error: "agent (claude or codex) and file are required"})

  # POST /api/devices/:id/sessions/continue — `agent`, `file`, and optional
  # `instruction` (what to do next; with one the new session starts at once)
  # and `backend` (the Loom session's engine, `claude_code` by default).
  def continue(conn, %{"id" => id, "agent" => agent, "file" => file} = params)
      when agent in ~w(claude codex) and is_binary(file) do
    instruction = params |> Map.get("instruction", "") |> to_string() |> String.trim()

    with {:ok, backend} <- backend(params["backend"]),
         {:ok, node} <- find(id),
         {:ok, list} <- scan(node, %{"op" => "list", "limit" => 200}),
         {:ok, session} <- find_session(list, file),
         {:ok, tail} <-
           scan(node, %{"op" => "transcript", "agent" => agent, "file" => file, "limit" => 30}),
         {:ok, new_id} <- start_continuation(node, list, session, tail, instruction, backend) do
      json(conn, %{id: new_id, started: instruction != ""})
    else
      {:error, status, message} -> conn |> put_status(status) |> json(%{error: message})
    end
  end

  def continue(conn, _params),
    do: conn |> put_status(400) |> json(%{error: "agent (claude or codex) and file are required"})

  # POST /api/devices/:id/sessions/pick — `task`, in the user's words.
  def pick(conn, %{"id" => id, "task" => task}) when is_binary(task) and task != "" do
    with {:ok, node} <- find(id),
         {:ok, list} <- scan(node, %{"op" => "list", "limit" => 60}) do
      sessions = list["sessions"] || []
      {picks, by} = choose(String.trim(task), sessions)
      json(conn, %{picks: picks, by: by})
    else
      {:error, status, message} -> conn |> put_status(status) |> json(%{error: message})
    end
  end

  def pick(conn, _params), do: conn |> put_status(400) |> json(%{error: "task is required"})

  defp run(conn, id, args) do
    with {:ok, node} <- find(id),
         {:ok, result} <- scan(node, args) do
      json(conn, result)
    else
      {:error, status, message} -> conn |> put_status(status) |> json(%{error: message})
    end
  end

  defp scan(node, args) do
    with :ok <- supported(node),
         {:ok, pid} <- reach(node),
         {:ok, out} <- exec(pid, command(args)),
         {:ok, result} <- decode(out) do
      case result do
        %{"error" => message} -> {:error, 422, message}
        _ -> {:ok, result}
      end
    end
  end

  # ── Continuing ──────────────────────────────────────────────────────────

  defp backend(nil), do: {:ok, :claude_code}

  defp backend(given) do
    case Loom.Agent.Backend.parse(given) do
      {:ok, b} -> {:ok, b}
      :error -> {:error, 422, "backend must be claude_code, codex or kiro"}
    end
  end

  defp find_session(list, file) do
    case Enum.find(list["sessions"] || [], &(&1["file"] == file)) do
      nil -> {:error, 404, "that session is no longer on the device"}
      s -> {:ok, s}
    end
  end

  defp start_continuation(node, list, s, tail, instruction, backend) do
    new_id = Agent.new_id()
    title = "↪ " <> String.slice(s["title"] || s["first"] || s["id"], 0, 60)
    {display, prompt} = brief(node, list, s, tail, instruction)

    with {:ok, _pid} <-
           Agent.start_session(new_id, backend: backend, title: title, title_by: "tidy"),
         {:ok, _} <-
           if(instruction != "",
             do: Agent.submit(new_id, display, origin: "handoff", prompt: prompt),
             else: with(:ok <- Agent.seed(new_id, display, prompt, "handoff"), do: {:ok, :seeded})
           ) do
      {:ok, new_id}
    else
      {:error, reason} -> {:error, 422, "could not start the session: #{inspect(reason)}"}
    end
  end

  # What the user sees (`display`) and what the agent is given (`prompt`).
  @doc false
  def brief(node, list, s, tail, instruction) do
    agent = if s["agent"] == "codex", do: "Codex", else: "Claude Code"
    cwd = s["cwd"] || list["home"] || "~"
    title = s["title"] || s["first"] || s["id"]

    display =
      [
        "↪ Continuing **#{title}** — a #{agent} session on **#{node.name}**",
        "",
        "`#{cwd}` · `#{s["id"]}` · #{s["messages"]} messages · last active #{s["updated"]}",
        if(instruction != "", do: "\n" <> quote_lines(instruction))
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("\n")

    resume =
      if s["agent"] == "codex",
        do: "codex exec resume #{s["id"]} \"<message>\"",
        else: "claude -p --resume #{s["id"]} \"<message>\""

    turns =
      (tail["messages"] || [])
      |> Enum.map(&turn/1)
      |> Enum.join("\n\n")
      |> then(
        &if(byte_size(&1) > 24_000,
          do: "…" <> binary_part(&1, byte_size(&1) - 24_000, 24_000),
          else: &1
        )
      )

    prompt = """
    [Loom: the user picked a #{agent} session on their device "#{node.name}" and wants it carried on from here, in this Loom session. The work lives on that device, not on this host.]

    ## The session being continued
    - Device: #{node.name} (#{node.os}/#{node.arch}), reached with `loom-node exec #{node.name} --cwd #{shell(cwd)} -- '<command>'` (see the loom-node skill; `loom-node read`/`write` for files)
    - Working directory there: #{cwd}
    - #{agent} session id: #{s["id"]}#{if s["branch"], do: " · git branch #{s["branch"]}", else: ""}#{if s["model"], do: " · model #{s["model"]}", else: ""}
    - Transcript file there: #{s["file"]} (#{tail["total"] || s["messages"]} messages in all)
    - Title: #{title}
    - It began with: #{s["first"] || "(unknown)"}
    - Still running there: #{if s["live"], do: "yes (#{s["status"] || "running"}#{if s["pid"], do: ", pid #{s["pid"]}", else: ""}) — the user may be at that terminal; do not resume it in parallel without asking", else: "no"}

    ## Its most recent turns (oldest first; tool calls as ▸ lines)
    #{turns}

    ## How to carry on
    - Work on #{node.name} in #{cwd} through loom-node, as that session did. Check the current state there before changing anything: files may have moved on since.
    - If the full history is needed, the original session can be resumed on the device itself: `loom-node exec #{node.name} --cwd #{shell(cwd)} --timeout 1800 -- '#{resume}'`. Say so before doing it.
    - Reply in the user's language.

    ## What the user wants now
    #{if instruction != "", do: instruction, else: "(Nothing yet: in a few lines, say where that session stands and what the natural next step is, then wait for the user.)"}
    """

    {display, prompt}
  end

  defp turn(%{"role" => "user", "text" => t}), do: "**User:** " <> clip(t, 1_500)

  defp turn(%{"role" => _} = m) do
    text =
      if (m["text"] || "") |> String.trim() == "",
        do: nil,
        else: "**Assistant:** " <> clip(m["text"], 1_500)

    tools = Enum.map(m["tools"] || [], &("▸ " <> &1))
    [text | tools] |> Enum.reject(&is_nil/1) |> Enum.join("\n")
  end

  defp clip(t, n), do: if(String.length(t) > n, do: String.slice(t, 0, n) <> "…", else: t)

  defp quote_lines(t), do: t |> String.split("\n") |> Enum.map_join("\n", &("> " <> &1))

  defp shell(path), do: "'" <> String.replace(path, "'", "'\\''") <> "'"

  # ── Picking ─────────────────────────────────────────────────────────────

  @pick_system """
  You match a task a user describes to the coding-agent sessions on their computer that are most likely the same work, so they can continue it.
  You get the task and a numbered list of sessions (title, first message, last reply, folder, when, whether running).
  Answer with JSON only, no prose, no code fence: {"picks":[{"i":<number>,"score":<0-100>,"reason":"<one short sentence, in the task's language, why this session fits>"}]}
  At most 3 picks, best first, only ones with a real connection (score 40+). If none fits, {"picks":[]}.
  """

  defp choose(task, sessions) do
    candidates = Enum.take(sessions, 60)

    case ask_model(task, candidates) do
      {:ok, picks} -> {picks, "model"}
      :error -> {by_words(task, candidates), "words"}
    end
  end

  defp ask_model(_task, []), do: {:ok, []}

  defp ask_model(task, candidates) do
    listing =
      candidates
      |> Enum.with_index()
      |> Enum.map_join("\n", fn {s, i} ->
        "#{i}. [#{s["agent"]}#{if s["live"], do: ", running", else: ""}] " <>
          "title: #{s["title"] || "-"} | first: #{short(s["first"], 160)} | last: #{short(s["last"], 200)} | " <>
          "folder: #{s["cwd"]} | updated: #{s["updated"]} | #{s["messages"]} msgs"
      end)

    with {:ok, reply} <- Loom.OneShot.ask(@pick_system, "Task: #{task}\n\nSessions:\n#{listing}"),
         [json] <- Regex.run(~r/\{.*\}/s, reply),
         {:ok, %{"picks" => picks}} when is_list(picks) <- Jason.decode(json) do
      {:ok,
       picks
       |> Enum.filter(&(is_integer(&1["i"]) and &1["i"] >= 0 and &1["i"] < length(candidates)))
       |> Enum.uniq_by(& &1["i"])
       |> Enum.take(3)
       |> Enum.map(fn p ->
         %{file: Enum.at(candidates, p["i"])["file"], score: p["score"], reason: p["reason"]}
       end)}
    else
      _ -> :error
    end
  end

  defp short(nil, _), do: "-"
  defp short(t, n), do: clip(t, n)

  # Without the model: shared words (and, for CJK, shared character pairs).
  @doc false
  def by_words(task, sessions) do
    want = terms(task)

    sessions
    |> Enum.map(fn s ->
      have =
        terms(
          Enum.join([s["title"], s["first"], s["last"], s["cwd"]] |> Enum.reject(&is_nil/1), " ")
        )

      hits = MapSet.intersection(want, have) |> MapSet.size()
      {s, hits}
    end)
    |> Enum.filter(fn {_, hits} -> hits > 0 end)
    |> Enum.sort_by(fn {s, hits} -> {-hits, if(s["live"], do: 0, else: 1)} end)
    |> Enum.take(3)
    |> Enum.map(fn {s, hits} ->
      %{
        file: s["file"],
        score: min(100, round(100 * hits / max(MapSet.size(want), 1))),
        reason: "#{hits} matching terms"
      }
    end)
  end

  defp terms(text) do
    text = String.downcase(text)
    words = Regex.scan(~r/[a-z0-9][a-z0-9_.-]{2,}/u, text) |> List.flatten()

    cjk =
      Regex.scan(~r/\p{Han}+/u, text)
      |> List.flatten()
      |> Enum.flat_map(fn run ->
        chars = String.graphemes(run)

        if length(chars) < 2,
          do: [],
          else: chars |> Enum.chunk_every(2, 1, :discard) |> Enum.map(&Enum.join/1)
      end)

    MapSet.new(words ++ cjk)
  end

  defp find(id) do
    case Enum.find(Nodes.list(), &(&1.id == id)) do
      nil -> {:error, 404, "no such device"}
      node -> {:ok, node}
    end
  end

  defp supported(%{os: os}) when os in ["windows", "android"],
    do: {:error, 422, "listing sessions needs python3, so macOS or Linux for now"}

  defp supported(_node), do: :ok

  defp reach(node) do
    case Nodes.await(node.name, @await_ms) do
      {:ok, pid} -> {:ok, pid}
      {:offline, _} -> {:error, 503, "#{node.name} is offline"}
      :unknown -> {:error, 404, "no such device"}
    end
  end

  # The script travels as an argument, base64'd, so no shell quoting can touch it.
  defp command(args) do
    source = "ARGS = " <> Jason.encode!(args) <> "\n" <> script()
    b64 = Base.encode64(source)

    ~s|python3 -c "import base64,sys;exec(compile(base64.b64decode(sys.argv[1]),'loom-sessions','exec'))" #{b64}|
  end

  defp script do
    :loom |> :code.priv_dir() |> Path.join("device_sessions/sessions.py") |> File.read!()
  end

  defp exec(pid, cmd) do
    id = Base.url_encode64(:crypto.strong_rand_bytes(9), padding: false)
    ref = Process.monitor(pid)
    send(pid, {:node_send, self(), id, "exec", %{"cmd" => cmd, "timeout" => @timeout_s}})
    collect(pid, ref, id, [], [], System.monotonic_time(:millisecond) + (@timeout_s + 15) * 1000)
  end

  defp collect(pid, ref, id, out, err, deadline) do
    left = deadline - System.monotonic_time(:millisecond)

    receive do
      {:node_reply, ^id, "out", %{"stream" => stream, "data" => data}} ->
        bytes = Base.decode64!(data)

        if IO.iodata_length(out) > @max_out do
          send(pid, {:node_cancel, id})
          Process.demonitor(ref, [:flush])
          {:error, 502, "the device sent too much"}
        else
          if stream == "stderr",
            do: collect(pid, ref, id, out, [err, bytes], deadline),
            else: collect(pid, ref, id, [out, bytes], err, deadline)
        end

      {:node_reply, ^id, "exit", %{"code" => 0}} ->
        Process.demonitor(ref, [:flush])
        {:ok, IO.iodata_to_binary(out)}

      {:node_reply, ^id, "exit", %{"code" => 127}} ->
        Process.demonitor(ref, [:flush])
        {:error, 422, "python3 is not installed on the device"}

      {:node_reply, ^id, "exit", payload} ->
        Process.demonitor(ref, [:flush])
        tail = err |> IO.iodata_to_binary() |> String.slice(-600..-1//1)
        {:error, 502, "the scan failed on the device (exit #{payload["code"]}): #{tail}"}

      {:node_reply, ^id, "error", payload} ->
        Process.demonitor(ref, [:flush])
        {:error, 502, payload["message"] || "the device refused"}

      {:DOWN, ^ref, :process, _, _} ->
        {:error, 503, "the device disconnected"}
    after
      max(left, 0) ->
        send(pid, {:node_cancel, id})
        Process.demonitor(ref, [:flush])
        {:error, 504, "the device did not answer in time"}
    end
  end

  defp decode(out) do
    case Jason.decode(out) do
      {:ok, map} when is_map(map) -> {:ok, map}
      _ -> {:error, 502, "the device's answer was not readable"}
    end
  end

  defp to_int(v, _d) when is_integer(v), do: v

  defp to_int(v, d) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      :error -> d
    end
  end

  defp to_int(_, d), do: d
end
