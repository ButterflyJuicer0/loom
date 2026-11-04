defmodule Loom.Agent.StoreIdTest do
  use ExUnit.Case, async: true

  alias Loom.Agent.Store

  test "real ids pass, paths do not" do
    assert Store.valid_id?("a_a6iA259nc1y5")
    assert Store.valid_id?("a__pg3XyYGcrDo")
    for bad <- ["..", "../x", "a/b", "", ".", "a.b", nil, "a\0b"], do: refute(Store.valid_id?(bad))
  end

  test "a traversal id reaches neither read nor delete" do
    assert :error = Store.read_meta("../..")
    assert_raise ArgumentError, fn -> Store.delete_session("..") end
  end
end
