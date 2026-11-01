defmodule Loom.Agent.Incognito do
  @moduledoc """
  Deletes incognito sessions 30 days after their last message, as ChatGPT
  does its temporary chats. Checked at boot and hourly; one mid-turn waits for
  the next check. A kept session is no longer incognito, so it stays.
  """
  use GenServer

  require Logger

  @max_age_ms 30 * 24 * 60 * 60 * 1000
  @every_ms 60 * 60 * 1000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc false
  # The sessions to delete at `now`. Public for the tests.
  def expired(sessions, now) do
    for s <- sessions,
        s.kind == "incognito",
        s.status not in [:starting, :running],
        now - (s[:last_active_at] || s[:created_at] || now) >= @max_age_ms,
        do: s.id
  end

  @impl true
  def init(_opts) do
    Process.send_after(self(), :sweep, 60_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:sweep, state) do
    now = System.system_time(:millisecond)

    for id <- expired(Loom.Agent.list_sessions(), now) do
      Logger.info("Loom.Agent.Incognito: deleting #{id}, 30 days without a message")
      Loom.Agent.delete_session(id)
    end

    Process.send_after(self(), :sweep, @every_ms)
    {:noreply, state}
  end
end
