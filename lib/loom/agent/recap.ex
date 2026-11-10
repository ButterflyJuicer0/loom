defmodule Loom.Agent.Recap do
  @moduledoc """
  Where a session got to, in a sentence or two, for its card in the sidebar's
  Working group: written when the user has let it sit for a while after a
  turn, so a glance brings it back to mind. The same call titles the session
  for its row (old topic · new topic once it moves on), unless the user named
  it. A `Loom.OneShot` on the end of the conversation. Anything that goes
  wrong is no recap and the title stays; the card keeps showing the start of
  the last reply. See `Loom.Agent.Session`.
  """

  require Logger

  # The end of the conversation is what matters; enough of it to see the task.
  # The first message goes in too, whatever the length: the title keeps the
  # topic the session began with.
  @shown 6000
  @longest 160
  @title_longest 40

  @system """
  You write two things for a card in a list of the user's sessions that are in
  progress, from a conversation between the user and an AI agent, in the
  language the user writes in. Answer in exactly two lines and nothing else:

  TITLE: <title>
  RECAP: <recap>

  The title is what the user reads on a phone to pick this session. It names
  the thing, not the request: "域名续费 Route53", not "我想挂个域名了"; no "我想",
  "帮我", "一下", no question form, no quotes. At most 12 Chinese characters
  (about 20 Latin ones), the word that tells it apart first. If the
  conversation has moved on to a new topic, the title names both: first what
  the first message was about, then the latest topic, after a " · ":
  "旧话题 · 新话题", each part a few words, at most 20 Chinese characters in
  all, both named as things ("Slack MCP · 客户分析", not "slack mcp接了吗 · …").
  Never drop the first topic: the user remembers the session by it.
  The current title is given: keep it word for word unless it is the user's
  first message verbatim, does not say what the session is about, or misses a
  topic the conversation moved on to.

  The recap: one or two short sentences, at most 80 characters in total if the
  conversation is in Chinese (at most 25 words otherwise): what the session
  has done so far and what it is waiting for from the user, if anything. No
  preamble, no Markdown.
  """

  @doc """
  The recap and a title for `messages` (`{"user" | "agent", text}`, oldest
  first) of a session now titled `title`: `%{recap: recap | nil, title: title
  | nil}`, nil for what did not come back.
  """
  def recap(messages, title) do
    conversation =
      messages
      |> Enum.map_join("\n\n", fn {who, text} -> "#{who}: #{text}" end)
      |> String.slice(-@shown, @shown)

    first =
      case messages do
        [{"user", text} | _] -> String.slice(text, 0, 500)
        _ -> ""
      end

    text = """
    Current title: #{title || "(none)"}

    First message: #{first}

    The conversation (its end, if long):

    #{conversation}
    """

    case Loom.OneShot.ask(@system, text) do
      {:ok, reply} ->
        %{recap: field(reply, "RECAP", @longest), title: field(reply, "TITLE", @title_longest)}

      {:error, reason} ->
        Logger.warning("Loom.Agent.Recap: no answer (#{inspect(reason) |> String.slice(0, 200)})")
        %{recap: nil, title: nil}
    end
  end

  defp field(reply, name, longest) do
    case Regex.run(~r/^\s*\**#{name}\**\s*[:：]\s*(.+)$/mu, reply) do
      [_, value] ->
        value =
          value
          |> String.replace(~r/\s+/u, " ")
          |> String.trim()
          |> String.trim("\"")
          |> String.trim()

        if value != "", do: String.slice(value, 0, longest)

      _ ->
        nil
    end
  end
end
