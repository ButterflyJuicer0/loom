defmodule LoomWeb.ClientAddress do
  @moduledoc """
  Which `X-Forwarded-For` hop is the client.

  Each proxy appends the address it saw, so the rightmost hop is the one the
  nearest proxy vouches for and a caller cannot forge. With one proxy in front
  that hop is the client. With two (a CDN in front of a tunnel, say) it is the
  outer proxy, and the client is one hop further left.

  `LOOM_TRUSTED_PROXIES` lists the outer proxies' addresses, as IPs or CIDR
  blocks separated by commas or spaces. Hops are read from the right, skipping
  those on the list; the first one not on it is the client. A hop a caller
  made up sits left of the client, so it is never reached. When every hop is
  on the list, the leftmost is used. With an empty list this is the last hop.
  """
  import Bitwise
  require Logger

  @type net :: {tuple(), non_neg_integer()}

  @doc """
  The configured list, parsed once per value. A bad entry is dropped with a
  warning rather than stopping the start: the worst it does is show a
  proxy's address where the client's should be.
  """
  @spec trusted() :: [net()]
  def trusted do
    raw = Application.get_env(:loom, :trusted_proxies)

    case :persistent_term.get(__MODULE__, nil) do
      {^raw, nets} ->
        nets

      _ ->
        {nets, bad} = parse(raw)

        if bad != [],
          do: Logger.warning("LOOM_TRUSTED_PROXIES: not an IP or CIDR block, ignored: #{Enum.join(bad, ", ")}")

        :persistent_term.put(__MODULE__, {raw, nets})
        nets
    end
  end

  @doc "Parses the list. An entry that is not an IP or CIDR block is dropped."
  @spec parse(String.t() | nil) :: {[net()], [String.t()]}
  def parse(nil), do: {[], []}

  def parse(value) when is_binary(value) do
    value
    |> String.split([",", " ", "\n", "\t"], trim: true)
    |> Enum.reduce({[], []}, fn entry, {nets, bad} ->
      case net(entry) do
        {:ok, net} -> {[net | nets], bad}
        :error -> {nets, [entry | bad]}
      end
    end)
    |> then(fn {nets, bad} -> {Enum.reverse(nets), Enum.reverse(bad)} end)
  end

  @doc "The client among `hops` (left to right, as in the header), or nil."
  @spec pick([String.t()], [net()]) :: String.t() | nil
  def pick([], _trusted), do: nil

  def pick(hops, trusted) do
    case hops |> Enum.reverse() |> Enum.drop_while(&trusted?(&1, trusted)) do
      [client | _] -> client
      [] -> hd(hops)
    end
  end

  defp trusted?(_hop, []), do: false

  defp trusted?(hop, trusted) do
    case address(hop) do
      {:ok, ip} -> Enum.any?(trusted, &member?(ip, &1))
      :error -> false
    end
  end

  defp net(entry) do
    with [addr | rest] <- String.split(entry, "/", parts: 2),
         {:ok, ip} <- address(addr),
         width = tuple_size(ip) * if(tuple_size(ip) == 4, do: 8, else: 16),
         {:ok, len} <- prefix(rest, width) do
      {:ok, {ip, len}}
    else
      _ -> :error
    end
  end

  defp prefix([], width), do: {:ok, width}

  defp prefix([len], width) do
    case Integer.parse(len) do
      {n, ""} when n >= 0 and n <= width -> {:ok, n}
      _ -> :error
    end
  end

  defp address(text) do
    case text |> String.trim() |> to_charlist() |> :inet.parse_address() do
      {:ok, ip} -> {:ok, ip}
      {:error, _} -> :error
    end
  end

  defp member?(ip, {base, len}) when tuple_size(ip) == tuple_size(base) do
    {a, b, width} = {number(ip), number(base), bits(ip)}
    a >>> (width - len) == b >>> (width - len)
  end

  defp member?(_ip, _net), do: false

  defp bits(ip), do: tuple_size(ip) * if(tuple_size(ip) == 4, do: 8, else: 16)

  defp number(ip) do
    part = if tuple_size(ip) == 4, do: 8, else: 16
    ip |> Tuple.to_list() |> Enum.reduce(0, &(&2 <<< part ||| &1))
  end
end
