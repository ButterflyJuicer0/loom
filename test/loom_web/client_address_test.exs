defmodule LoomWeb.ClientAddressTest do
  use ExUnit.Case, async: true

  alias LoomWeb.ClientAddress

  defp nets(text), do: text |> ClientAddress.parse() |> elem(0)

  test "with no trusted proxies the last hop is the client" do
    assert ClientAddress.pick(["10.9.9.1", "198.51.100.4"], []) == "198.51.100.4"
    assert ClientAddress.pick([], []) == nil
  end

  test "a trusted outer proxy is skipped, a made-up hop left of the client is not reached" do
    trusted = nets("15.158.0.0/16, 2600:9000::/28")
    assert ClientAddress.pick(["203.0.113.9", "15.158.54.48"], trusted) == "203.0.113.9"
    assert ClientAddress.pick(["10.9.9.1", "203.0.113.9", "15.158.54.48"], trusted) == "203.0.113.9"
    assert ClientAddress.pick(["203.0.113.9", "2600:9000:201e::1"], trusted) == "203.0.113.9"
  end

  test "one proxy only: the last hop still wins though the list is set" do
    trusted = nets("15.158.0.0/16")
    assert ClientAddress.pick(["15.158.1.1", "203.0.113.9"], trusted) == "203.0.113.9"
  end

  test "every hop trusted: the leftmost; a hop that is no address is a client" do
    trusted = nets("15.158.0.0/16 130.176.0.0/17")
    assert ClientAddress.pick(["130.176.1.1", "15.158.54.48"], trusted) == "130.176.1.1"
    assert ClientAddress.pick(["unknown", "15.158.54.48"], trusted) == "unknown"
  end

  test "parsing: single addresses, both families, bad entries reported" do
    assert {[{{192, 0, 2, 7}, 32}, {{10, 0, 0, 0}, 8}], ["nope", "10.0.0.0/33"]} =
             ClientAddress.parse("192.0.2.7, nope 10.0.0.0/8\n10.0.0.0/33")

    assert {[], []} = ClientAddress.parse(nil)
    refute ClientAddress.pick(["10.1.2.3"], nets("10.0.0.0/8")) != "10.1.2.3"
    assert ClientAddress.pick(["203.0.113.9", "11.0.0.1"], nets("10.0.0.0/8")) == "11.0.0.1"
    assert ClientAddress.pick(["203.0.113.9", "10.255.0.1"], nets("10.0.0.0/8 0.0.0.0/0")) == "203.0.113.9"
  end
end
