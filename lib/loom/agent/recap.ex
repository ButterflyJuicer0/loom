defmodule Loom.Agent.Recap do
  @moduledoc """
  Where a session got to, in a sentence or two, for its card in the sidebar's
  Working group: written when the user has let it sit for a while after a
  turn, so a glance brings it back to mind. A `Loom.OneShot` on the end of the
  conversation. Anything that goes wrong is no recap; the card keeps showing
  the start of the last reply. See `Loom.Agent.Session`.
  """

  require Logger

  # The end of the conversation is what matters; enough of it to see the task.
  @shown 6000
  @longest 160

  @system """
  You summarize a conversation between a user and an AI agent for a card in a
  list of the user's sessions that are in progress. Write one or two short
  sentences, at most 80 characters in total if the conversation is in Chinese
  (at most 25 words otherwise), in the language the user writes in: what the
  session has done so far and what it is waiting for from the user, if
  anything. No preamble, no quotes, no Markdown, no title.
  """

  @doc "A recap of `messages` (`{\"user\" | \"agent\", text}`, oldest first), or nil."
  def recap(messages) do
    text =
      messages
      |> Enum.map_join("\n\n", fn {who, text} -> "#{who}: #{text}" end)
      |> String.slice(-@shown, @shown)

    case Loom.OneShot.ask(@system, text) do
      {:ok, reply} ->
        reply = reply |> String.replace(~r/\s+/u, " ") |> String.trim()
        if reply != "", do: String.slice(reply, 0, @longest)

      {:error, reason} ->
        Logger.warning("Loom.Agent.Recap: no answer (#{inspect(reason) |> String.slice(0, 200)})")
        nil
    end
  end
end
