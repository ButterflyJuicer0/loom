defmodule Loom.NoticesTest do
  use ExUnit.Case, async: true

  alias Loom.Notices

  # 2026-10-30 10:00 in Asia/Shanghai.
  @ten 1_761_789_600_000
  @hour 3_600_000

  setup do
    path = Path.join(System.tmp_dir!(), "notices-#{System.unique_integer([:positive])}.json")
    test = self()
    clock = :counters.new(1, [:atomics])
    :counters.put(clock, 1, @ten)

    name = :"notices_#{System.unique_integer([:positive])}"

    start_supervised!(
      {Notices,
       name: name,
       path: path,
       tick: :timer.hours(24),
       clock: fn -> :counters.get(clock, 1) end,
       notify: fn title, body, session -> send(test, {:notified, title, body, session}) end,
       remind: fn title, body -> send(test, {:reminded, title, body}) end,
       submit: fn session, text -> send(test, {:submitted, session, text}) end}
    )

    on_exit(fn -> File.rm(path) end)
    set = fn ms -> :counters.put(clock, 1, ms) end
    %{s: name, path: path, set: set}
  end

  @emp %{kind: "employee", id: "e_1", name: "钱多多"}

  defp post(s, attrs, source \\ @emp), do: Notices.post(source, attrs, s)

  test "0–5 notify at once; the rest do not", %{s: s} do
    {:ok, n} = post(s, %{summary: "部署要批准", priority: 1, needs: "approve", session: "a_1"})
    assert n["status"] == "open" and n["priority"] == 1
    assert_received {:notified, "钱多多 · needs your approval", "部署要批准", "a_1"}

    {:ok, _} = post(s, %{summary: "换供应商？", priority: 4}, %{kind: "session", id: "a_2", name: "x"})
    assert_received {:notified, "x · important", "换供应商？", nil}
    {:ok, _} = post(s, %{summary: "日报", priority: 7}, %{kind: "session", id: "a_3", name: "y"})
    refute_received {:notified, _, _, _}
  end

  test "one urgent a day per source; the next is posted as 3", %{s: s} do
    {:ok, _} = post(s, %{summary: "one", priority: 2})
    {:ok, n} = post(s, %{summary: "two", priority: 0})
    assert n["priority"] == 3
    assert n["note"] =~ "one urgent a day"
    # Another source is not held to this one's.
    {:ok, m} =
      post(s, %{summary: "three", priority: 1}, %{kind: "dream", id: "dream:home", name: "Dream"})

    assert m["priority"] == 1
  end

  test "the same key updates the open notice, and notifies only if more urgent", %{s: s} do
    {:ok, a} = post(s, %{summary: "止损没设", priority: 4, key: "stop"})
    assert_received {:notified, _, "止损没设", _}
    {:ok, b} = post(s, %{summary: "止损没设，收盘前要定", priority: 2, key: "stop"})
    assert a["id"] == b["id"]
    assert b["summary"] =~ "收盘前"
    assert_received {:notified, _, "止损没设，收盘前要定", _}
    {:ok, _} = post(s, %{summary: "lower again", priority: 5, key: "stop"})
    refute_received {:notified, _, _, _}
    assert length(Notices.list(s)) == 1
  end

  test "answering in its session settles it", %{s: s} do
    {:ok, n} = post(s, %{summary: "要你回复", priority: 3, needs: "reply", session: "a_9"})
    Notices.replied("a_other", s)
    Notices.replied("a_9", s)
    [m] = Notices.list(s)
    assert m["id"] == n["id"] and m["status"] == "done" and m["note"] == "Answered in chat"
  end

  test "approve tells its session, and is done", %{s: s} do
    {:ok, n} = post(s, %{summary: "部署 2b98e02", priority: 2, needs: "approve", session: "a_1"})
    {:ok, m} = Notices.answer(n["id"], true, s)
    assert m["status"] == "done" and m["answer"] == "approve"
    assert_received {:submitted, "a_1", "✅ Approved: 部署 2b98e02"}
  end

  test "a reply from the bell goes to its session as the user's, and is done", %{s: s} do
    {:ok, n} = post(s, %{summary: "要不要换？", priority: 4, needs: "reply", session: "a_7"})
    assert {:error, _} = Notices.reply(n["id"], "  ", s)
    {:ok, m} = Notices.reply(n["id"], "换，先签一个季度", s)
    assert m["status"] == "done" and m["answer"] == "换，先签一个季度"
    # Quoted, so the session knows what it answers.
    assert_received {:submitted, "a_7", "↩ 要不要换？\n\n换，先签一个季度"}
    {:ok, d} = post(s, %{summary: "日报", priority: 7}, %{kind: "session", id: "a_8", name: "q"})
    assert {:ok, %{"status" => "done", "note" => "Dismissed"}} = Notices.dismiss(d["id"], s)
  end

  test "to-dos: added, ticked off, open first by due date, kept on disk", %{s: s, path: path} do
    {:ok, a} = Notices.add_todo(%{text: "续费域名", due: "2026-11-06"}, "you", s)
    {:ok, b} = Notices.add_todo(%{text: "回复房东"}, "钱多多", s)
    {:ok, c} = Notices.add_todo(%{text: "交报销", due: "2026-11-01"}, "you", s)
    assert {:error, _} = Notices.add_todo(%{text: " "}, "you", s)
    assert {:error, _} = Notices.add_todo(%{text: "x", due: "Friday"}, "you", s)
    assert Enum.map(Notices.todos(s), & &1["id"]) == [c["id"], a["id"], b["id"]]

    {:ok, c} = Notices.update_todo(c["id"], %{done: true}, s)
    assert c["done"] and is_integer(c["done_at"])
    assert List.last(Notices.todos(s))["id"] == c["id"]
    assert :ok = Notices.delete_todo(b["id"], s)
    assert length(Notices.todos(s)) == 2
    assert File.read!(path) =~ "续费域名"
  end

  test "read settles only what asks to be read", %{s: s} do
    {:ok, r} = post(s, %{summary: "日报", priority: 7})

    {:ok, q} =
      post(s, %{summary: "问题", priority: 4, needs: "reply"}, %{
        kind: "session",
        id: "a_4",
        name: "z"
      })

    assert {:ok, %{"status" => "done"}} = Notices.read(r["id"], s)
    assert {:ok, %{"status" => "open"}} = Notices.read(q["id"], s)
  end

  test "withdraw and open_of", %{s: s} do
    {:ok, _} = post(s, %{summary: "a", priority: 4, key: "a"})
    {:ok, _} = post(s, %{summary: "b", priority: 6, key: "b"})
    assert :ok = Notices.withdraw("e_1", "a", s)
    assert [%{"key" => "b"}] = Notices.open_of("e_1", s)
    assert {:error, :not_found} = Notices.withdraw("e_1", "a", s)
  end

  test "a bad priority or empty summary is refused", %{s: s} do
    assert {:error, _} = post(s, %{summary: "x", priority: 11})
    assert {:error, _} = post(s, %{summary: " ", priority: 3})
    assert {:error, _} = post(s, %{summary: "x", priority: 3, needs: "maybe"})
  end

  test "detail and options: kept tidy", %{s: s} do
    many = for i <- 1..12, do: "选项 #{i}"

    {:ok, n} =
      post(s, %{
        summary: "换供应商？",
        priority: 4,
        detail: "  B 便宜 20%，但交期长一周。  ",
        options: ["换成 B", " ", "换成 B", 3 | many]
      })

    assert n["detail"] == "B 便宜 20%，但交期长一周。"
    assert n["options"] == ["换成 B" | Enum.take(many, 9)]
    {:ok, m} = post(s, %{summary: "x", priority: 7, detail: "", options: "nope"})
    assert m["detail"] == nil and m["options"] == []
  end

  test "later: out of the reminders until then, then back with a notification",
       %{s: s, set: set} do
    {:ok, n} = post(s, %{summary: "要不要换？", priority: 4, needs: "reply", session: "a_9"})
    assert_received {:notified, _, _, _}
    assert {:error, _} = Notices.later(n["id"], @ten - 1, s)
    assert {:error, _} = Notices.later(n["id"], @ten + 8 * 24 * @hour, s)
    # Until 21:00.
    {:ok, l} = Notices.later(n["id"], @ten + 11 * @hour, s)
    assert l["later_until"] == @ten + 11 * @hour and l["status"] == "open"

    # 20:05: no reminder for it.
    set.(@ten + 10 * @hour + 300_000)
    send(s, :tick)
    _ = Notices.list(s)
    refute_received {:notified, _, _, _}
    refute_received {:reminded, _, _}

    # 21:00: back.
    set.(@ten + 11 * @hour)
    send(s, :tick)
    [back] = Notices.list(s)
    assert back["later_until"] == nil
    assert_received {:notified, "钱多多 · reminder", "要不要换？", "a_9"}
  end

  test "put off, it comes back at once if the source makes it more urgent", %{s: s} do
    {:ok, n} = post(s, %{summary: "止损", priority: 5, key: "stop"})
    {:ok, _} = Notices.later(n["id"], @ten + @hour, s)
    {:ok, m} = post(s, %{summary: "止损，马上", priority: 2, key: "stop"})
    assert m["later_until"] == nil
  end

  test "2–5 at night wait for 07:00", %{s: s, set: set} do
    # 23:00
    set.(@ten + 13 * @hour)
    {:ok, _} = post(s, %{summary: "夜里的", priority: 2})
    {:ok, _} = post(s, %{summary: "也是夜里", priority: 4}, %{kind: "dream", id: "d", name: "Dream"})
    refute_received {:notified, _, _, _}
    # 00:00: nothing to remind of at night but 0–1.
    set.(@ten + 14 * @hour)
    send(s, :tick)
    _ = Notices.list(s)
    refute_received {:notified, _, _, _}
    refute_received {:reminded, _, _}

    # 07:10 the next day
    set.(@ten + 21 * @hour + 600_000)
    send(s, :tick)
    _ = Notices.list(s)
    assert_received {:notified, "2 from the night", "夜里的 · 也是夜里", nil}
    refute_received {:reminded, _, _}
  end

  test "a reminder every 20 minutes while 0–5 are open, counted from the last",
       %{s: s, set: set} do
    {:ok, a} = post(s, %{summary: "要批", priority: 2, session: "a_1"})
    {:ok, _} = post(s, %{summary: "看看", priority: 5}, %{kind: "session", id: "a_2", name: "w"})
    {:ok, _} = post(s, %{summary: "日报", priority: 7}, %{kind: "session", id: "a_3", name: "y"})

    tick = fn ms ->
      set.(@ten + ms)
      send(s, :tick)
      _ = Notices.list(s)
    end

    tick.(19 * 60_000)
    refute_received {:reminded, _, _}
    tick.(20 * 60_000)
    assert_received {:reminded, "2 waiting in the bell", "钱多多: 要批 · w: 看看"}
    tick.(30 * 60_000)
    refute_received {:reminded, _, _}
    tick.(40 * 60_000)
    assert_received {:reminded, _, _}

    {:ok, _} = Notices.dismiss(a["id"], s)
    tick.(60 * 60_000)
    assert_received {:reminded, "1 waiting in the bell", "w: 看看"}
  end

  test "6–10 expire after a week unread, and survive a restart", %{s: s, set: set, path: path} do
    {:ok, n} = post(s, %{summary: "日报", priority: 7})
    set.(@ten + 8 * 24 * @hour)
    send(s, :tick)
    assert [%{"status" => "expired"}] = Notices.list(s)
    assert File.read!(path) =~ n["id"]
  end
end
