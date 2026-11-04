defmodule Loom.Snapshot do
  @moduledoc """
  A page of HTML as one long PNG, by headless Chrome: how a conversation is
  shared as an image ("Share…" in the chat's menu).

  The browser renders the conversation — markdown and all — and sends the
  markup; this wraps it in a document whose Content-Security-Policy allows no
  network (images must come as `data:` URLs) and no script but its own one
  line. Two runs: the first measures the page (that line writes its height into
  the title, read back with `--dump-dom`), the second screenshots a window
  exactly that tall. Each run gets its own profile directory, so shares can
  run side by side and never touch loom's shared browser.
  """

  @timeout 60_000
  # CSS pixels across, like a phone; rendered at up to 2× for a crisp image.
  @width 440
  # Past this many device pixels tall the image is drawn at a lower scale;
  # past @max_height CSS pixels it is refused — untick something.
  @max_pixels 32_000
  @max_height 40_000

  @doc "Render `body` (HTML) styled by `css`; `{:ok, png}` or `{:error, reason}`."
  def render(body, css) do
    case chrome() do
      nil ->
        {:error, "no Chrome on the server to draw with"}

      exe ->
        dir = Path.join(System.tmp_dir!(), "loom-snap-" <> Base.url_encode64(:crypto.strong_rand_bytes(9)))
        File.mkdir_p!(dir)

        try do
          nonce = Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false)
          measure = Path.join(dir, "measure.html")
          page = Path.join(dir, "page.html")
          File.write!(measure, document(body, css, nonce))
          File.write!(page, document(body, css, nil))

          with {:ok, height} <- measure(exe, dir, measure),
               :ok <- fits(height) do
            shoot(exe, dir, page, height)
          end
        after
          File.rm_rf(dir)
        end
    end
  end

  defp fits(h) when h > @max_height, do: {:error, "too long for one image — untick some of it"}
  defp fits(_), do: :ok

  defp measure(exe, dir, html) do
    case run(exe, dir, ["--window-size=#{@width},800", "--dump-dom", "file://" <> html]) do
      {:ok, out} ->
        case Regex.run(~r/<title>H=(\d+)<\/title>/, out) do
          [_, h] -> {:ok, String.to_integer(h)}
          _ -> {:error, "could not measure the page"}
        end

      error ->
        error
    end
  end

  defp shoot(exe, dir, html, height) do
    png = Path.join(dir, "page.png")
    scale = min(2.0, @max_pixels / height) |> Float.round(3)

    args = [
      "--hide-scrollbars",
      "--force-device-scale-factor=#{scale}",
      "--window-size=#{@width},#{height}",
      "--screenshot=" <> png,
      "file://" <> html
    ]

    with {:ok, _} <- run(exe, dir, args) do
      case File.read(png) do
        {:ok, bin} when byte_size(bin) > 0 -> {:ok, bin}
        _ -> {:error, "Chrome drew nothing"}
      end
    end
  end

  defp run(exe, dir, args) do
    base = [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--user-data-dir=" <> Path.join(dir, "profile")
    ]

    task = Task.async(fn -> System.cmd(exe, base ++ args, stderr_to_stdout: false, cd: dir) end)

    case Task.yield(task, @timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, {out, 0}} -> {:ok, out}
      {:ok, {_, code}} -> {:error, "Chrome failed (#{code})"}
      nil -> {:error, "Chrome took too long"}
    end
  end

  @doc false
  # With a nonce: the measuring run, whose one script writes the height into
  # the title. Without: the drawing run, no script at all.
  def document(body, css, nonce) do
    script_src = if nonce, do: "script-src 'nonce-#{nonce}'; ", else: ""

    measure =
      if nonce,
        do:
          ~s{<script nonce="#{nonce}">document.title="H="+Math.ceil(document.documentElement.getBoundingClientRect().height)</script>},
        else: ""

    """
    <!doctype html>
    <html><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; #{script_src}img-src data:; style-src 'unsafe-inline'; font-src data:">
    <style>html,body{margin:0;width:#{@width}px}#{String.replace(css, "</", "<\\/")}</style>
    </head><body>#{body}#{measure}</body></html>
    """
  end

  defp chrome do
    [System.get_env("LOOM_CHROME"), "google-chrome", "chromium", "chromium-browser"]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.find_value(&System.find_executable/1)
  end
end
