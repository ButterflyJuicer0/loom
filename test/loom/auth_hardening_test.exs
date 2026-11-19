defmodule Loom.AuthHardeningTest do
  # Not async: changes the configured password and the login brake's table.
  use LoomWeb.ConnCase, async: false

  alias Loom.Auth

  setup do
    original = Application.get_env(:loom, :password)
    :ets.delete_all_objects(:loom_login_misses)

    on_exit(fn ->
      Application.put_env(:loom, :password, original)
      :ets.delete_all_objects(:loom_login_misses)
    end)

    :ok
  end

  test "an empty password never matches, even when none is configured" do
    Application.put_env(:loom, :password, "")
    refute Auth.valid_password?("")
    refute Auth.valid_password?("anything")
    Application.delete_env(:loom, :password)
    refute Auth.valid_password?("")
  end

  test "changing the password retires tokens minted under the old one" do
    Application.put_env(:loom, :password, "first-password")
    token = Auth.mint_token()
    assert {:ok, _} = Auth.verify_token(token)
    Application.put_env(:loom, :password, "second-password")
    assert {:error, _} = Auth.verify_token(token)
  end

  test "a token without the password fingerprint is refused" do
    # Anyone holding the signing key (dev's is in the repo) could mint this.
    legacy = Phoenix.Token.sign(LoomWeb.Endpoint, "loom auth token", %{ok: true})
    assert {:error, :invalid} = Auth.verify_token(legacy)
  end

  test "five wrong passwords lock the client out; the right one then waits too", %{conn: conn} do
    Application.put_env(:loom, :password, "right-password")
    ip = "203.0.113.7"

    for _ <- 1..5 do
      conn = conn |> put_req_header("x-forwarded-for", ip) |> post("/api/login", %{password: "wrong"})
      assert conn.status == 401
    end

    locked = build_conn() |> put_req_header("x-forwarded-for", ip) |> post("/api/login", %{password: "right-password"})
    assert locked.status == 429
    assert [_] = get_resp_header(locked, "retry-after")

    other = build_conn() |> put_req_header("x-forwarded-for", "203.0.113.8") |> post("/api/login", %{password: "right-password"})
    # In (200) or waiting for a signed-in device's yes (202), but not braked.
    assert other.status in [200, 202]
  end

  test "the password then waits for a signed-in device, which can allow it", %{conn: conn} do
    Application.put_env(:loom, :password, "right-password")
    mac = Auth.mint_token("Mac · Chrome")

    pending =
      conn
      |> put_req_header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140")
      |> post("/api/login", %{password: "right-password"})

    assert %{"pending" => id, "poll" => poll} = json_response(pending, 202)
    assert json_response(build_conn() |> post("/api/login/poll", %{id: id, poll: poll}), 202)

    legacy = Phoenix.Token.sign(LoomWeb.Endpoint, "loom auth token", %{ok: true})
    refused = build_conn() |> put_req_header("authorization", "Bearer " <> legacy) |> post("/api/auth/pending/#{id}/approve")
    assert refused.status == 401

    shown = build_conn() |> put_req_header("authorization", "Bearer " <> mac) |> get("/api/auth")
    assert Enum.any?(json_response(shown, 200)["pending"], &(&1["id"] == id and &1["name"] == "Windows · Chrome"))

    ok = build_conn() |> put_req_header("authorization", "Bearer " <> mac) |> post("/api/auth/pending/#{id}/approve")
    assert ok.status == 204

    assert %{"token" => token} = json_response(build_conn() |> post("/api/login/poll", %{id: id, poll: poll}), 200)
    assert {:ok, _} = Auth.verify_token(token)
  end

  test "adding a passkey needs the password again", %{conn: conn} do
    Application.put_env(:loom, :password, "right-password")
    token = Auth.mint_token("Mac")

    res =
      conn
      |> put_req_header("authorization", "Bearer " <> token)
      |> post("/api/auth/passkeys", %{id: "x", password: "wrong"})

    assert res.status == 401
  end

  test "signing a device out ends its token", %{conn: conn} do
    token = Auth.mint_token("Mac")
    {:ok, id} = Auth.verify_token(token)
    other = Auth.mint_token("Phone")
    res = conn |> put_req_header("authorization", "Bearer " <> other) |> delete("/api/auth/logins/#{id}")
    assert res.status == 204
    assert {:error, :revoked} = Auth.verify_token(token)
  end

  test "the last X-Forwarded-For hop is the client, not one the caller made up", %{conn: conn} do
    Application.put_env(:loom, :password, "right-password")

    for n <- 1..5 do
      conn
      |> put_req_header("x-forwarded-for", "10.9.9.#{n}, 198.51.100.4")
      |> post("/api/login", %{password: "wrong"})
    end

    locked = build_conn() |> put_req_header("x-forwarded-for", "198.51.100.4") |> post("/api/login", %{password: "right-password"})
    assert locked.status == 429
  end
end
