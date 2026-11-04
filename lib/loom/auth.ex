defmodule Loom.Auth do
  @moduledoc """
  Minimal single-password auth. The password is configured via `LOOM_PASSWORD`.
  On success we mint a signed token (no DB, no expiry logic beyond the signing
  max_age); the client keeps it in localStorage, so a device stays logged in
  until the token expires — closing an iOS home-screen app is how it reloads,
  and a password prompt on every reload was the alternative.

  The token carries a short fingerprint of the password it was minted under,
  so changing `LOOM_PASSWORD` retires every token minted under the old one.
  Tokens minted before the fingerprint existed (`%{ok: true}`) are still
  accepted until their max_age runs out, so a deploy logs nobody out.
  """

  @salt "loom auth token"
  # The only expiry there is: the client keeps the token until this runs out
  # (or a 401 clears it).
  @max_age 60 * 60 * 24 * 30

  @doc """
  Verify a plaintext password against the configured one (constant-time).
  Fails closed: an empty password, or no configured password, never matches.
  """
  def valid_password?(password) when is_binary(password) and password != "" do
    case configured() do
      "" -> false
      configured -> Plug.Crypto.secure_compare(password, configured)
    end
  end

  def valid_password?(_), do: false

  @doc "Mint a signed token for an authenticated client."
  def mint_token do
    Phoenix.Token.sign(LoomWeb.Endpoint, @salt, %{ok: true, pw: fingerprint()})
  end

  @doc "Verify a token minted by `mint_token/0`."
  def verify_token(token) when is_binary(token) do
    case Phoenix.Token.verify(LoomWeb.Endpoint, @salt, token, max_age: @max_age) do
      {:ok, %{pw: pw}} ->
        if Plug.Crypto.secure_compare(pw, fingerprint()), do: :ok, else: {:error, :invalid}

      {:ok, _legacy} ->
        :ok

      {:error, reason} ->
        {:error, reason}
    end
  end

  def verify_token(_), do: {:error, :missing}

  defp configured do
    case Application.get_env(:loom, :password) do
      p when is_binary(p) -> p
      _ -> ""
    end
  end

  # Not the password: 8 bytes of an HMAC keyed by the endpoint secret, so the
  # (signed, not encrypted) token reveals nothing usable about it.
  defp fingerprint do
    key = LoomWeb.Endpoint.config(:secret_key_base) || ""

    :crypto.mac(:hmac, :sha256, key, "loom-password:" <> configured())
    |> binary_part(0, 8)
    |> Base.url_encode64(padding: false)
  end
end
