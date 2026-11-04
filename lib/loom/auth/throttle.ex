defmodule Loom.Auth.Throttle do
  @moduledoc """
  Brute-force brake for `POST /api/login`.

  Wrong passwords are counted per client address and globally inside a
  sliding window. Past `@per_client` misses a client is locked out with
  exponential backoff (capped at `@max_lock`); past `@global` misses from
  everyone together, all logins pause for `@global_lock`. A success clears
  that client's count. State is an ETS table owned by this process; a
  restart forgets it, which is fine for a brake.
  """
  use GenServer

  @table :loom_login_misses
  @window :timer.minutes(15)
  @per_client 5
  @base_lock :timer.seconds(30)
  @max_lock :timer.minutes(15)
  @global 50
  @global_lock :timer.minutes(1)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @doc "`:ok`, or `{:locked, seconds}` if `client` may not try now."
  def check(client) do
    now = now()

    with :ok <- locked?(:global, now) do
      locked?({:client, client}, now)
    end
  end

  @doc "Count a wrong password from `client`."
  def failure(client), do: GenServer.call(__MODULE__, {:failure, client})

  @doc "Forget `client`'s misses after it got the password right."
  def success(client), do: GenServer.call(__MODULE__, {:success, client})

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :public, :set, read_concurrency: true])
    :timer.send_interval(@window, :sweep)
    {:ok, nil}
  end

  @impl true
  def handle_call({:failure, client}, _from, state) do
    now = now()
    bump(:global, now, fn n -> if n >= @global, do: @global_lock, else: 0 end)

    bump({:client, client}, now, fn n ->
      if n >= @per_client,
        do: min(@base_lock * Integer.pow(2, n - @per_client), @max_lock),
        else: 0
    end)

    {:reply, :ok, state}
  end

  def handle_call({:success, client}, _from, state) do
    :ets.delete(@table, {:client, client})
    {:reply, :ok, state}
  end

  @impl true
  def handle_info(:sweep, state) do
    now = now()

    for {key, _n, first, until} <- :ets.tab2list(@table),
        now - first > @window and until <= now,
        do: :ets.delete(@table, key)

    {:noreply, state}
  end

  defp locked?(key, now) do
    case :ets.lookup(@table, key) do
      [{^key, _n, _first, until}] when until > now -> {:locked, div(until - now, 1000) + 1}
      _ -> :ok
    end
  end

  # Rows are {key, misses, first_miss_at, locked_until}; a row whose window
  # has passed (and is not locked) starts over.
  defp bump(key, now, lock_for) do
    {n, first} =
      case :ets.lookup(@table, key) do
        [{^key, n, first, until}] when now - first <= @window or until > now -> {n + 1, first}
        _ -> {1, now}
      end

    lock = lock_for.(n)
    :ets.insert(@table, {key, n, first, if(lock > 0, do: now + lock, else: 0)})
  end

  defp now, do: System.system_time(:millisecond)
end
