defmodule Loom.Agent.RefsTest do
  @moduledoc "Earlier sessions a message points at: which may be named, and what the model is told."
  use ExUnit.Case, async: false

  alias Loom.Agent.Refs
  alias Loom.Agent.Store

  setup do
    data_dir = Path.join(System.tmp_dir!(), "loom-refs-#{System.unique_integer([:positive])}")
    previous = Application.get_env(:loom, Loom.Agent, [])
    Application.put_env(:loom, Loom.Agent, Keyword.put(previous, :data_dir, data_dir))

    on_exit(fn ->
      Application.put_env(:loom, Loom.Agent, previous)
      File.rm_rf(data_dir)
    end)

    meta = fn id, extra ->
      File.mkdir_p!(Store.session_dir(id))
      File.write!(Path.join(Store.session_dir(id), "meta.json"), Jason.encode!(Map.merge(%{id: id, title: "T #{id}"}, extra)))
    end

    meta.("a_plain", %{kind: nil})
    meta.("a_other", %{})
    meta.("a_incog", %{kind: "incognito"})
    meta.("a_emp", %{employee_id: "e_1"})
    :ok
  end

  test "describes ordinary sessions, drops itself and repeats" do
    assert {:ok, [%{id: "a_plain", title: "T a_plain"}, %{id: "a_other"}]} =
             Refs.verify("a_self", ["a_plain", "a_self", "a_other", "a_plain"])
  end

  test "refuses what is not an ordinary session" do
    assert {:error, {:not_a_session, "a_incog"}} = Refs.verify("a_self", ["a_incog"])
    assert {:error, {:not_a_session, "a_emp"}} = Refs.verify("a_self", ["a_emp"])
    assert {:error, {:not_a_session, "a_gone"}} = Refs.verify("a_self", ["a_gone"])
    assert {:error, {:not_a_session, "../x"}} = Refs.verify("a_self", ["../x"])
  end

  test "the prompt names the directory and how to read it, after the text" do
    {:ok, refs} = Refs.verify("a_self", ["a_plain"])
    prompt = Refs.prompt("look at this", refs)
    assert prompt =~ ~r/\Alook at this\n\n/
    assert prompt =~ "loom-session read ID"
    assert prompt =~ "「T a_plain」 id a_plain — #{Store.session_dir("a_plain")}"
    assert Refs.prompt("hi", []) == "hi"
  end
end
