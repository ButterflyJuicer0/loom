defmodule Loom.Agent.Trash do
  @moduledoc """
  Empties the session trash of what has been there 30 days: a deleted session
  can still be put back for a month (`Loom.Agent.Store.delete_session/1`), and
  then it stops taking up the disk. Checked a minute after boot and hourly.
  """
  use GenServer

  require Logger

  alias Loom.Agent.Store

  @max_age_ms 30 * 24 * 60 * 60 * 1000
  @every_ms 60 * 60 * 1000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    Process.send_after(self(), :sweep, 60_000)
    {:ok, %{}}
  end

  @impl true
  def handle_info(:sweep, state) do
    case Store.purge_trash(System.system_time(:millisecond), @max_age_ms) do
      [] -> :ok
      gone -> Logger.info("Loom.Agent.Trash: removed #{length(gone)} session(s) deleted over 30 days ago")
    end

    Process.send_after(self(), :sweep, @every_ms)
    {:noreply, state}
  end
end
