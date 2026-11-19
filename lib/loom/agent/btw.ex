defmodule Loom.Agent.Btw do
  @moduledoc """
  BTW: a question asked on the side of a session, while its turn carries on.

  Typing in the chat mid-turn either waits for the turn or steers it; both
  change what the agent does next. A side question does neither. It is put to
  a *copy* of the conversation as it stands that moment — the turn under way
  included — which answers once and is thrown away. The session's own
  conversation never hears of it: no event, nothing in the backend's history,
  no change of status, and the queue is not touched.

  ## How the copy is made

  By the backend (`Loom.Agent.Backend.fork_spec/1`), so that it begins with the
  very request the session has been sending and is read from its prompt cache:

    * Claude Code — a one-off `claude -p --resume <id> --fork-session
      --no-session-persistence`, on the session's own flags, with a hook that
      refuses every tool call;
    * Codex — `thread/fork` on the shared app-server, ephemeral and read-only.

  Kiro's ACP has no fork, so a Kiro session has no side questions.

  Every question is a fresh copy, so a later one sees how far the turn has got
  by then. What ties the questions together is this module's own list: the
  earlier ones and their answers go along in the prompt.

  ## What is kept

  `<session_dir>/btw.json`: the questions and their answers, newest last, so
  another device (or this one after a reload) shows the same panel. It goes
  with the session's directory. An answer under way lives in its
  `Loom.Agent.Btw.Worker` until it is finished; a restart ends it, and the
  item is then shown as stopped.

  Changes are announced on the session's topic as `{:agent_btw, id, payload}`:
  `%{type: "items", items: [...]}` whenever the list changes, and
  `%{type: "text", id:, seq:, text:}` for each chunk of an answer. Chunks are
  numbered from 1, and an item still being answered says in `seq` how many of
  them its `answer` already holds — the list and the chunks travel separately,
  so a page appends a chunk only when it is the next one, and asks again for
  the list when one went missing.
  """

  alias Loom.Agent
  alias Loom.Agent.{Session, Store}
  alias Loom.Agent.Btw.Worker

  @btw_file "btw.json"

  # Longer than a question is; a pasted error message still fits.
  @question_limit 20_000

  # The panel is a scratchpad, not a second transcript.
  @kept 40

  # How much of the panel goes along with a new question.
  @earlier 6
  @earlier_chars 2_000

  @doc "The session's side questions, oldest first."
  def list(id) do
    id |> read() |> Enum.map(&live(id, &1))
  end

  @doc """
  Ask `question` on the side of session `id`. `{:ok, item}` once the copy is
  on its way; the answer arrives on the session's topic.
  """
  def ask(id, question) when is_binary(question) do
    question = String.trim(question)

    cond do
      question == "" -> {:error, :empty}
      byte_size(question) > @question_limit -> {:error, :too_long}
      not Agent.exists?(id) -> {:error, :not_found}
      Worker.whereis(id) != nil -> {:error, :busy}
      true -> start(id, question)
    end
  end

  defp start(id, question) do
    with {:ok, spec} <- fork_spec(id) do
      item = %{
        "id" => "b_" <> Base.url_encode64(:crypto.strong_rand_bytes(6), padding: false),
        "question" => question,
        "answer" => "",
        "status" => "answering",
        "error" => nil,
        "at" => System.system_time(:millisecond)
      }

      earlier = update(id, fn items -> settle(items) ++ [item] end) |> List.delete_at(-1)

      case DynamicSupervisor.start_child(
             Loom.Agent.BtwSupervisor,
             {Worker, id: id, item: item["id"], spec: spec, prompt: prompt(question, earlier)}
           ) do
        {:ok, _pid} ->
          announce(id)
          {:ok, item}

        {:error, reason} ->
          update(id, fn items -> Enum.reject(items, &(&1["id"] == item["id"])) end)
          {:error, if(match?({:already_started, _}, reason), do: :busy, else: reason)}
      end
    end
  end

  defp fork_spec(id) do
    Session.fork_spec(id)
  catch
    :exit, _ -> {:error, :not_found}
  end

  @doc "Stop the answer under way, if there is one. What it had said is kept."
  def stop(id) do
    Worker.stop(id)
    :ok
  end

  @doc "Empty the panel, stopping the answer under way."
  def clear(id) do
    Worker.stop(id)
    lock(id, fn -> File.rm(path(id)) end)
    announce(id)
    :ok
  end

  @doc "The session is being deleted: its answer under way ends with it."
  def forget(id) do
    Worker.stop(id)
    :ok
  end

  # ── For the worker ────────────────────────────────────────────────────────

  @doc false
  def text(id, item, seq, chunk) do
    broadcast(id, %{type: "text", id: item, seq: seq, text: chunk})
  end

  @doc false
  def finished(id, item, %{} = outcome) do
    update(id, fn items ->
      Enum.map(items, fn
        %{"id" => ^item} = it -> Map.merge(it, outcome)
        it -> it
      end)
    end)

    announce(id)
  end

  # ── The prompt ────────────────────────────────────────────────────────────

  @framing "[Loom BTW — a side question. The user asks this while the work above carries on " <>
             "in the original conversation; you are a copy of that conversation made only to " <>
             "answer it, and nothing said here is added to it. Answer directly and briefly, in " <>
             "the language the user writes in, from what the conversation holds and what you " <>
             "know. Do not carry on with the task or redo any of it, and do not call tools or " <>
             "run commands: this copy is read-only. If the answer needs something looked up or " <>
             "run, say so in a sentence instead. No files, and no suggested-replies block.]"

  @doc false
  def prompt(question, earlier) do
    earlier =
      earlier
      |> Enum.filter(&(&1["status"] == "done" and &1["answer"] not in [nil, ""]))
      |> Enum.take(-@earlier)

    history =
      case earlier do
        [] ->
          ""

        items ->
          "\n\nEarlier side questions, oldest first, which the user still has on screen:\n" <>
            Enum.map_join(items, "\n", fn it ->
              "Q: #{it["question"]}\nA: #{clip(it["answer"])}"
            end)
      end

    @framing <> history <> "\n\nQuestion: " <> question
  end

  defp clip(text) do
    if String.length(text) > @earlier_chars,
      do: String.slice(text, 0, @earlier_chars) <> "…",
      else: text
  end

  # ── The list ──────────────────────────────────────────────────────────────

  defp path(id), do: Path.join(Store.session_dir(id), @btw_file)

  defp read(id) do
    with {:ok, body} <- File.read(path(id)),
         {:ok, %{"items" => items}} when is_list(items) <- Jason.decode(body) do
      Enum.filter(items, &is_map/1)
    else
      _ -> []
    end
  end

  # One writer at a time: the page asking and a worker finishing both rewrite
  # the file. Returns the list as written.
  defp update(id, fun) do
    lock(id, fn ->
      items = id |> read() |> fun.() |> Enum.take(-@kept)

      # A deleted session's directory is not made again by a late answer.
      if File.dir?(Store.session_dir(id)) do
        tmp = path(id) <> ".tmp"
        File.write!(tmp, Jason.encode_to_iodata!(%{items: items}))
        File.rename!(tmp, path(id))
      end

      items
    end)
  end

  defp lock(id, fun), do: :global.trans({{__MODULE__, id}, self()}, fun)

  # What a restart, or a crash, left "answering" with nobody answering.
  defp settle(items) do
    Enum.map(items, fn
      %{"status" => "answering"} = it -> %{it | "status" => "stopped"}
      it -> it
    end)
  end

  # An answer under way is in its worker, not in the file. `seq` is its last
  # chunk's, so a page that has this much knows which chunk comes next.
  defp live(id, %{"status" => "answering", "id" => item} = it) do
    case Worker.text(id, item) do
      {:ok, text, seq} -> Map.merge(it, %{"answer" => text, "seq" => seq})
      :error -> %{it | "status" => "stopped"}
    end
  end

  defp live(_id, it), do: it

  defp announce(id), do: broadcast(id, %{type: "items", items: list(id)})

  defp broadcast(id, payload),
    do: Phoenix.PubSub.broadcast(Loom.PubSub, Session.topic(id), {:agent_btw, id, payload})
end
