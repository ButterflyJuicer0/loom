defmodule Loom.Pdf do
  @moduledoc """
  A page of HTML printed to PDF by headless Chrome: how a conversation is
  shared ("Share PDF" in the chat's menu).

  The browser renders the conversation — markdown and all — and sends the
  markup; this wraps it in a document whose Content-Security-Policy allows no
  script and no network (images must come as `data:` URLs), so what is printed
  is exactly what was sent. Each print gets its own profile directory, so
  prints can run side by side and never touch loom's shared browser.
  """

  @timeout 60_000
  @csp "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

  @doc "Print `body` (HTML) styled by `css` to a PDF; `{:ok, binary}` or `{:error, reason}`."
  def render(body, css, title) do
    case chrome() do
      nil ->
        {:error, "no Chrome on the server to print with"}

      exe ->
        dir = Path.join(System.tmp_dir!(), "loom-pdf-" <> Base.url_encode64(:crypto.strong_rand_bytes(9)))
        File.mkdir_p!(dir)

        try do
          html = Path.join(dir, "page.html")
          pdf = Path.join(dir, "page.pdf")
          File.write!(html, document(body, css, title))
          print(exe, dir, html, pdf)
        after
          File.rm_rf(dir)
        end
    end
  end

  defp print(exe, dir, html, pdf) do
    args = [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--user-data-dir=" <> Path.join(dir, "profile"),
      "--no-pdf-header-footer",
      "--print-to-pdf=" <> pdf,
      "file://" <> html
    ]

    task = Task.async(fn -> System.cmd(exe, args, stderr_to_stdout: true, cd: dir) end)

    case Task.yield(task, @timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, {_, 0}} ->
        case File.read(pdf) do
          {:ok, bin} when byte_size(bin) > 0 -> {:ok, bin}
          _ -> {:error, "Chrome printed nothing"}
        end

      {:ok, {out, code}} ->
        {:error, "Chrome failed (#{code}): " <> String.slice(out, -300, 300)}

      nil ->
        {:error, "Chrome took too long"}
    end
  end

  @doc false
  def document(body, css, title) do
    """
    <!doctype html>
    <html><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="#{@csp}">
    <title>#{escape(title)}</title>
    <style>#{String.replace(css, "</", "<\\/")}</style>
    </head><body>#{body}</body></html>
    """
  end

  defp escape(text) do
    text
    |> String.replace("&", "&amp;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
  end

  defp chrome do
    [System.get_env("LOOM_CHROME"), "google-chrome", "chromium", "chromium-browser"]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.find_value(&System.find_executable/1)
  end
end
