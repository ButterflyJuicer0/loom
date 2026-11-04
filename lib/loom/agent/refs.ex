defmodule Loom.Agent.Refs do
  @moduledoc """
  Earlier sessions a user message points at — picked from the composer's
  + menu ("Recent chats").

  Nothing of them is loaded into the message. The model gets each one's
  title, id and directory, and the command that reads it, and reads it only
  if the question needs it: a reference costs a few lines, not a transcript.
  The displayed message keeps them as structured data (`refs` on the `:user`
  event), shown as chips, the way `Loom.Agent.Files` keeps attachments.

  Checked from the store's meta file, not by asking the other session's
  process: two sessions pointing at each other in the same instant would
  otherwise call each other from inside `handle_call` and deadlock. Only an
  ordinary conversation may be named — not an employee's, a Dream, a task's
  or an incognito one — the same set `loom-session read` reads.
  """

  alias Loom.Agent.Store

  @max 5

  @doc "Check the ids and describe each: `%{id, title}`. Duplicates and itself drop out."
  def verify(_self, []), do: {:ok, []}

  def verify(self, ids) when is_list(ids) do
    ids = ids |> Enum.map(&to_string/1) |> Enum.uniq() |> Enum.reject(&(&1 == self))

    if length(ids) > @max do
      {:error, :too_many_refs}
    else
      Enum.reduce_while(ids, {:ok, []}, fn id, {:ok, acc} ->
        case describe(id) do
          nil -> {:halt, {:error, {:not_a_session, id}}}
          ref -> {:cont, {:ok, [ref | acc]}}
        end
      end)
      |> case do
        {:ok, refs} -> {:ok, Enum.reverse(refs)}
        error -> error
      end
    end
  end

  def verify(_self, _), do: {:error, :bad_refs}

  defp describe(id) do
    with true <- Regex.match?(~r/\A[A-Za-z0-9_-]{1,64}\z/, id),
         {:ok, meta} <- Store.read_meta(id),
         nil <- meta[:kind],
         nil <- meta[:employee_id] do
      %{id: id, title: meta[:title] || id}
    else
      _ -> nil
    end
  end

  @doc "What the model is told after the message: where each one is, and how to read it."
  def prompt(text, []), do: text

  def prompt(text, refs) do
    lines =
      Enum.map_join(refs, "\n", fn r ->
        "- 「#{r.title}」 id #{r.id} — #{Store.session_dir(r.id)}"
      end)

    header =
      "The user referenced #{length(refs)} earlier Loom session#{if length(refs) == 1, do: "", else: "s"}. " <>
        "Not loaded here: read only what the request needs, with " <>
        "`loom-session read ID` (add --files for files, paths and commits it touched, " <>
        "--full for every reply); its raw transcript is events.jsonl in that directory."

    [String.trim(text), header, lines]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end
end
