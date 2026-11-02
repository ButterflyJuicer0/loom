defmodule Loom.Meeting do
  @moduledoc """
  Meeting mode: the page transcribes a meeting in the browser (see
  `Loom.Meeting.Models`) and posts finished sentences here; this hands them to
  the session's agent in batches, so the agent can give live hints.

  The agent cannot take audio or a stream, only messages, and each turn takes
  10–20 s. So sentences are batched: a batch goes out once there is new text,
  at least `@every` has passed since the last one, and the session is idle —
  while the agent is thinking, sentences pile up instead of steering into its
  turn. "Ask now" from the page sends at once, whatever the clock says.

  Turning meeting mode on sends the meeting prompt (`prompt/0`, which the user
  can replace with `~/.loom/meeting/prompt.md`); turning it off sends what is
  left and asks for the minutes. Every sentence also goes to a transcript file
  in the session's directory, so the minutes come from the whole meeting, not
  from what is left of the conversation after compaction.

  Works for any backend: it only uses `Loom.Agent.Session.submit/3`.
  """
  use GenServer

  alias Loom.Agent.Session

  @every 30_000
  @tick 3_000
  @origin "meeting"

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @doc "`title`: what to call the chat if it has no title yet (the page's local time)."
  def start(id, title \\ nil), do: GenServer.call(__MODULE__, {:start, id, title})
  def stop(id), do: GenServer.call(__MODULE__, {:stop, id})
  def ask(id), do: GenServer.call(__MODULE__, {:ask, id})
  def lines(id, lines), do: GenServer.call(__MODULE__, {:lines, id, lines})
  def info(id), do: GenServer.call(__MODULE__, {:info, id})

  @default_prompt """
  【会议模式开始】我正在开会。接下来我会每隔约 30 秒把会议的实时转写发给你，格式是 `[时间] 说话人: 内容`。
  - 「我」是我本人（麦克风）；「对方1」「对方2」… 是按音色分出的其他人（系统声音），标签可能串，你根据参会人、称呼和上下文判断真实身份，并在提示里用名字称呼。我说「对方2 是张总」时，以后都这样对应。
  - 每次收到转写，只在值得时给我 1–3 条很短的提示（每条一行，≤30 字）：该追问的点、对方说法里要核对的数字或事实、我答应过的事、可以补充的背景或数据、风险。需要时可以用工具查（邮件、日历、SFDC、wiki、网页），但别拖慢。
  - 没有值得说的，只回一个「·」，什么都不加。
  - 不要复述转写，不要寒暄。
  - 收到【会议结束】时，读完整转写文件，出会议纪要：参会人、要点、决定、待办（谁/什么/何时）、未决问题。
  如果你能从我的日历或上下文判断这是哪个会、和谁开，先用一两句话告诉我；判断不了就回「·」。
  """

  @doc "The prompt that opens meeting mode: `~/.loom/meeting/prompt.md`, or the default."
  def prompt do
    path = Path.join([Loom.Agent.Store.home(), "meeting", "prompt.md"])

    case File.read(path) do
      {:ok, text} -> if String.trim(text) == "", do: @default_prompt, else: text
      _ -> @default_prompt
    end
  end

  @impl true
  def init(_) do
    :timer.send_interval(@tick, :tick)
    {:ok, %{}}
  end

  @impl true
  def handle_call({:start, id, title}, _from, state) do
    case state[id] do
      %{} = m ->
        {:reply, {:ok, view(m)}, state}

      nil ->
        file = transcript_path(id)
        File.mkdir_p!(Path.dirname(file))
        File.write!(file, "# Meeting #{stamp(:full)}\n\n", [:append])
        text = prompt() <> "\n完整转写文件：`#{file}`"
        _ = Session.submit(id, text, origin: @origin)
        name_it(id, title)
        m = %{file: file, pending: [], last: now(), count: 0, started: now()}
        {:reply, {:ok, view(m)}, Map.put(state, id, m)}
    end
  end

  def handle_call({:stop, id}, _from, state) do
    case Map.pop(state, id) do
      {nil, state} ->
        {:reply, :ok, state}

      {m, state} ->
        tail = if m.pending == [], do: "", else: Enum.join(Enum.reverse(m.pending), "\n") <> "\n\n"
        _ = Session.submit(id, tail <> "【会议结束】完整转写在 `#{m.file}`。", origin: @origin)
        {:reply, :ok, state}
    end
  end

  def handle_call({:ask, id}, _from, state) do
    case state[id] do
      nil -> {:reply, {:error, :not_running}, state}
      m -> {:reply, :ok, Map.put(state, id, flush(id, m, true))}
    end
  end

  def handle_call({:lines, id, lines}, _from, state) do
    case state[id] do
      nil ->
        {:reply, {:error, :not_running}, state}

      m ->
        text =
          for %{"text" => t} = l <- lines, is_binary(t), String.trim(t) != "" do
            "[#{l["at"] || stamp(:time)}] #{l["speaker"] || "?"}: #{String.trim(t)}"
          end

        if text != [], do: File.write!(m.file, Enum.join(text, "\n") <> "\n", [:append])
        m = %{m | pending: Enum.reverse(text) ++ m.pending, count: m.count + length(text)}
        {:reply, {:ok, view(m)}, Map.put(state, id, m)}
    end
  end

  def handle_call({:info, id}, _from, state) do
    {:reply, if(m = state[id], do: view(m), else: nil), state}
  end

  @impl true
  def handle_info(:tick, state) do
    {:noreply, Map.new(state, fn {id, m} -> {id, flush(id, m, false)} end)}
  end

  # Send the pending sentences if it is time and the agent is free. `now?`
  # skips the clock, not the wait for the agent: a batch typed into a running
  # turn would steer it.
  defp flush(_id, %{pending: []} = m, _now?), do: m

  defp flush(id, m, now?) do
    due = now() - m.last >= @every

    if (now? or due) and idle?(id) do
      # In time order: a sentence that waited for its speaker label arrives
      # after later ones from the microphone. "[HH:MM:SS]" sorts as text.
      batch = m.pending |> Enum.reverse() |> Enum.sort() |> Enum.join("\n")
      _ = Session.submit(id, batch, origin: @origin)
      %{m | pending: [], last: now()}
    else
      m
    end
  end

  defp idle?(id) do
    try do
      Session.info(id).status in [:idle, :interrupted]
    catch
      :exit, _ -> false
    end
  end

  # A new chat would be titled with the meeting prompt, its first message.
  # Named as tidying names, so a title the user gave is never replaced.
  defp name_it(id, title) do
    title = if is_binary(title) and title != "", do: String.slice(title, 0, 80), else: "Meeting " <> stamp(:full)

    try do
      # "auto" is the first message — here, the prompt just sent.
      if Session.info(id).title_by in [nil, "auto"], do: Session.retitle(id, title)
    catch
      :exit, _ -> :ok
    end
  end

  defp view(m), do: %{file: m.file, lines: m.count, pending: length(m.pending), started: m.started}

  defp transcript_path(id),
    do: Path.join([Loom.Agent.Store.session_dir(id), "meeting", "#{stamp(:file)}.md"])

  defp now, do: System.system_time(:millisecond)

  defp stamp(kind) do
    # UTC: the server's clock says nothing about where the user is. Sentences
    # carry the browser's own local time.
    t = DateTime.utc_now()

    case kind do
      :full -> Calendar.strftime(t, "%Y-%m-%d %H:%M UTC")
      :file -> Calendar.strftime(t, "%Y%m%d-%H%M%S")
      :time -> Calendar.strftime(t, "%H:%M:%S")
    end
  end
end
