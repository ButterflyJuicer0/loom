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
    assert :ok = Auth.verify_token(token)
    Application.put_env(:loom, :password, "second-password")
    assert {:error, _} = Auth.verify_token(token)
  end

  test "tokens from before the password fingerprint still verify" do
    legacy = Phoenix.Token.sign(LoomWeb.Endpoint, "loom auth token", %{ok: true})
    assert :ok = Auth.verify_token(legacy)
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
    assert %{"token" => _} = json_response(other, 200)
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
