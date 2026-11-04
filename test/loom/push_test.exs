defmodule Loom.PushTest do
  use ExUnit.Case, async: false

  alias Loom.Push

  setup do
    path = Path.join(System.tmp_dir!(), "loom-push-#{System.unique_integer([:positive])}.json")
    test = self()

    deliver = fn sub, payload, _keys, subject ->
      send(test, {:delivered, sub.endpoint, Jason.decode!(payload), subject})
      {:ok, 201, ""}
    end

    name = :"push_#{System.unique_integer([:positive])}"
    pid = start_supervised!({Push, name: name, path: path, deliver: deliver})
    on_exit(fn -> File.rm(path) end)
    {:ok, server: name, pid: pid, path: path}
  end

  defp subscription(n) do
    %{
      "endpoint" => "https://push.example/#{n}",
      "keys" => %{"p256dh" => "BCVxsr7N_eNgVRqvHtD0zQ", "auth" => "BTBZMqHH6r4Tts7J_aSIgg"}
    }
  end

  defp notify(server, id, body), do: Push.notify("周报", body, id, server)

  test "makes a key pair once and keeps it", %{server: server, path: path} do
    key = Push.public_key(server)
    assert byte_size(Loom.Push.WebPush.decode!(key)) == 65
    assert %{"public" => ^key} = path |> File.read!() |> Jason.decode!()
    assert File.stat!(path).mode |> Bitwise.band(0o777) == 0o600
  end

  test "a turn end sends nothing: only the bell notifies", %{server: server, pid: pid} do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], server)
    send(pid, {:turn_ended, "a_1", %{title: "周报", outcome: {:ok, "Done"}}})
    refute_receive {:delivered, _, _, _}, 100
  end

  test "a notice reaches every device, linking back to the session", %{server: server} do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], server)
    :ok = Push.subscribe(subscription(2), "https://loom.example/", [], server)

    notify(server, "a_1", "**Done**: wrote `W42.md`\n\nsee [it](x)")

    for n <- [1, 2] do
      endpoint = "https://push.example/#{n}"

      assert_receive {:delivered, ^endpoint,
                      %{
                        "web_push" => 8030,
                        "notification" => %{
                          "title" => "周报",
                          "body" => "Done: wrote W42.md see it",
                          "navigate" => "https://loom.example/?session=a_1",
                          "tag" => "a_1"
                        }
                      }, "https://loom.example"}
    end
  end

  test "the suggested replies are not part of the body", %{server: server} do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], server)

    notify(server, "a_1", "Deploy now?\n\n<!-- loom:replies\nYes\nNot yet\n-->")

    assert_receive {:delivered, _, %{"notification" => %{"body" => "Deploy now?"}}, _}
  end

  test "a long body is cut", %{server: server} do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], server)

    notify(server, "a_1", String.duplicate("字", 500))
    assert_receive {:delivered, _, %{"notification" => %{"body" => body}}, _}
    assert String.length(body) == 180
    assert String.ends_with?(body, "…")
  end

  test "a device looking at the session is left alone, until it looks away", %{
    server: server
  } do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], server)
    :ok = Push.subscribe(subscription(2), "https://loom.example", [], server)
    channel = spawn(fn -> Process.sleep(:infinity) end)

    Push.watching("https://push.example/1", "a_1", channel, server)
    notify(server, "a_1", "x")
    assert_receive {:delivered, "https://push.example/2", _, _}
    refute_receive {:delivered, "https://push.example/1", _, _}, 100

    # Another session still reaches it.
    notify(server, "a_2", "x")
    assert_receive {:delivered, "https://push.example/1", _, _}
    assert_receive {:delivered, "https://push.example/2", _, _}

    # Its channel going away is the device going away.
    Process.exit(channel, :kill)
    _ = Push.list(server)
    notify(server, "a_1", "x")
    assert_receive {:delivered, "https://push.example/1", _, _}
  end

  test "hidden counts as not looking", %{server: server} do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], server)
    Push.watching("https://push.example/1", "a_1", self(), server)
    Push.watching("https://push.example/1", nil, self(), server)
    notify(server, "a_1", "x")
    assert_receive {:delivered, "https://push.example/1", _, _}
  end

  test "a subscription the push service says is gone is dropped", %{path: path} do
    test = self()

    gone = fn sub, _payload, _keys, _subject ->
      send(test, {:tried, sub.endpoint})
      {:ok, 410, ""}
    end

    name = :"push_gone_#{System.unique_integer([:positive])}"
    other = Path.rootname(path) <> "-gone.json"
    start_supervised!({Push, name: name, path: other, deliver: gone}, id: :gone)
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], name)

    notify(name, "a_1", "x")
    assert_receive {:tried, _}
    Process.sleep(50)
    assert Push.list(name) == []
    File.rm(other)
  end

  test "turning on can ask for a notification straight away", %{server: server} do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [test: true], server)
    assert_receive {:delivered, _, %{"notification" => %{"body" => "Notifications are on."}}, _}
  end

  test "signs as the origin, or a stand-in where Apple would refuse it", %{server: server} do
    :ok = Push.subscribe(subscription(1), "http://localhost:4000", [test: true], server)

    assert_receive {:delivered, _, %{"notification" => %{"navigate" => "http://localhost:4000/"}},
                    "mailto:" <> _}
  end

  test "refuses what is not a subscription", %{server: server} do
    assert {:error, :invalid} =
             Push.subscribe(%{"endpoint" => "http://x"}, "https://l", [], server)

    assert {:error, :invalid} =
             Push.subscribe(
               put_in(subscription(1)["endpoint"], "http://x/1"),
               "https://l",
               [],
               server
             )

    assert {:error, :invalid} = Push.subscribe(subscription(1), "javascript:x", [], server)
    assert Push.list(server) == []
  end

  test "subscriptions survive a restart", %{server: server, path: path} do
    :ok = Push.subscribe(subscription(1), "https://loom.example", [], server)
    key = Push.public_key(server)
    stop_supervised!(Push)

    name = :"push_again_#{System.unique_integer([:positive])}"

    start_supervised!(
      {Push, name: name, path: path, deliver: fn _, _, _, _ -> {:ok, 201, ""} end}
    )

    assert Push.public_key(name) == key

    assert [%{endpoint: "https://push.example/1", origin: "https://loom.example"}] =
             Push.list(name)
  end
end
