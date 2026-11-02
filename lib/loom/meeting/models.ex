defmodule Loom.Meeting.Models do
  @moduledoc """
  The speech models meeting mode runs in the browser: sherpa-onnx's own
  WebAssembly builds (https://github.com/k2-fsa/sherpa-onnx, Apache-2.0), one
  for streaming Chinese+English recognition and one for speaker diarization.

  Nothing is fetched until the user asks: the first time they turn meeting mode
  on, the page offers the download, and this module pulls the release tarballs
  from GitHub onto the server, then serves the files to the page. Going through
  the server means a phone or a laptop on a network that can't reach GitHub
  still gets them, and the page shows progress for both legs.

  Kept under `~/.loom/models/sherpa/<bundle>/`, outside the release, so a deploy
  doesn't throw 250 MB away.
  """
  use GenServer

  @version "v1.13.7"
  @bundles %{
    "asr" => "zh-en-asr-zipformer",
    "diar" => "speaker-diarization"
  }

  def bundles, do: Map.keys(@bundles)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  def dir, do: Path.join([Loom.Agent.Store.home(), "models", "sherpa"])
  def bundle_dir(bundle), do: Path.join(dir(), bundle)

  @doc "Ready, or downloading with how far it got, or missing."
  def status, do: GenServer.call(__MODULE__, :status)

  @doc "Start fetching whatever is missing. Returns the status."
  def fetch, do: GenServer.call(__MODULE__, :fetch)

  @doc "A file of a ready bundle, as a path, or nil — only names the bundle lists."
  def file(bundle, name) do
    with true <- Map.has_key?(@bundles, bundle),
         true <- name == Path.basename(name),
         path = Path.join(bundle_dir(bundle), name),
         true <- File.regular?(path) do
      path
    else
      _ -> nil
    end
  end

  @doc "The files the page loads, with their sizes, per bundle."
  def manifest do
    for {bundle, _} <- @bundles, into: %{} do
      files =
        case File.ls(bundle_dir(bundle)) do
          {:ok, names} ->
            for n <- Enum.sort(names), String.starts_with?(n, "sherpa-onnx"),
                into: %{},
                do: {n, File.stat!(Path.join(bundle_dir(bundle), n)).size}

          _ ->
            %{}
        end

      {bundle, files}
    end
  end

  @impl true
  def init(_), do: {:ok, %{task: nil, got: 0, total: 0, error: nil, unpacking: false}}

  @impl true
  def handle_call(:status, _from, state), do: {:reply, view(state), state}

  def handle_call(:fetch, _from, %{task: nil} = state) do
    if ready?() do
      {:reply, view(state), state}
    else
      me = self()
      task = Task.start(fn -> send(me, {:done, download(me)}) end) |> elem(1)
      state = %{state | task: task, got: 0, total: 0, error: nil, unpacking: false}
      {:reply, view(state), state}
    end
  end

  def handle_call(:fetch, _from, state), do: {:reply, view(state), state}

  @impl true
  def handle_info({:progress, got, total}, state),
    do: {:noreply, %{state | got: got, total: total, unpacking: false}}

  def handle_info(:unpacking, state), do: {:noreply, %{state | unpacking: true}}
  def handle_info({:done, :ok}, state), do: {:noreply, %{state | task: nil}}
  def handle_info({:done, {:error, why}}, state), do: {:noreply, %{state | task: nil, error: why}}

  defp view(state) do
    cond do
      ready?() -> %{state: "ready", files: manifest()}
      state.task -> %{state: "downloading", got: state.got, total: state.total, unpacking: state.unpacking}
      true -> %{state: "missing", error: state.error, size: 228_000_000}
    end
  end

  defp ready?, do: Enum.all?(@bundles, fn {b, _} -> File.exists?(Path.join(bundle_dir(b), ".ok")) end)

  # Both tarballs, one after the other, progress summed over both. Each is
  # unpacked into a temporary directory and renamed into place only once whole.
  defp download(me) do
    sizes = for {_, name} <- @bundles, do: head_size(url(name))
    total = Enum.sum(sizes)

    Enum.zip(@bundles, sizes)
    |> Enum.reduce_while({:ok, 0}, fn {{bundle, name}, size}, {:ok, done} ->
      case fetch_bundle(me, bundle, name, done, total) do
        :ok -> {:cont, {:ok, done + size}}
        {:error, _} = e -> {:halt, e}
      end
    end)
    |> case do
      {:ok, _} -> :ok
      e -> e
    end
  end

  defp url(name),
    do: "https://github.com/k2-fsa/sherpa-onnx/releases/download/#{@version}/sherpa-onnx-wasm-simd-#{@version}-#{name}.tar.bz2"

  defp head_size(url) do
    case System.cmd("curl", ["-sIL", url], stderr_to_stdout: true) do
      {out, 0} ->
        Regex.scan(~r/content-length:\s*(\d+)/i, out)
        |> List.last()
        |> case do
          [_, n] -> String.to_integer(n)
          _ -> 0
        end

      _ ->
        0
    end
  end

  defp fetch_bundle(me, bundle, name, done, total) do
    File.mkdir_p!(dir())
    tar = Path.join(dir(), "#{bundle}.tar.bz2")
    tmp = Path.join(dir(), "#{bundle}.tmp")
    File.rm_rf!(tmp)
    File.rm(tar)

    port =
      Port.open({:spawn_executable, System.find_executable("curl")}, [
        :binary,
        :exit_status,
        args: ["-sfL", "--retry", "3", "-o", tar, url(name)]
      ])

    watch(me, port, tar, done, total)
    |> case do
      :ok ->
        # bunzip2 of ~200 MB takes longer than the download itself.
        send(me, {:progress, done + File.stat!(tar).size, total})
        send(me, :unpacking)
        File.mkdir_p!(tmp)

        case System.cmd("tar", ["xjf", tar, "-C", tmp, "--strip-components=2"], stderr_to_stdout: true) do
          {_, 0} ->
            File.rm(tar)
            File.rm_rf!(bundle_dir(bundle))
            File.rename!(tmp, bundle_dir(bundle))
            File.write!(Path.join(bundle_dir(bundle), ".ok"), @version)
            :ok

          {out, _} ->
            {:error, "unpack failed: " <> String.slice(out, 0, 200)}
        end

      e ->
        e
    end
  end

  defp watch(me, port, tar, done, total) do
    receive do
      {^port, {:exit_status, 0}} -> :ok
      {^port, {:exit_status, s}} -> {:error, "download failed (curl #{s})"}
      {^port, _} -> watch(me, port, tar, done, total)
    after
      500 ->
        got = case File.stat(tar) do
          {:ok, %{size: s}} -> s
          _ -> 0
        end

        send(me, {:progress, done + got, total})
        watch(me, port, tar, done, total)
    end
  end
end
