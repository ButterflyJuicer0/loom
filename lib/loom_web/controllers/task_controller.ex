defmodule LoomWeb.TaskController do
  @moduledoc """
  Tasks — `Loom.Cron`'s jobs — for the Tasks page.

  A task made here gets a session of its own, named after it, unless it names
  one to go to, where every run's reply lands. One of its own is
  `kind: "task"`, kept out of the sidebar's lists and opened from the task,
  and is new for every run, the runs before shown above it (`Loom.Cron`).
  Deleting the task leaves those sessions.

  Times are the user's wall clock: `utc_offset`, minutes east of UTC, Shanghai
  (480) unless the request or `config :loom, Loom.Cron, utc_offset:` says
  otherwise.
  """
  use LoomWeb, :controller

  alias Loom.Agent
  alias Loom.Cron

  # GET /api/tasks
  def index(conn, _params) do
    json(conn, %{tasks: Enum.map(Cron.list(), &view/1), utc_offset: default_offset()})
  end

  # POST /api/tasks — `{text}`, said in words and read by `Loom.Cron.Describe`,
  # or `{name?, prompt, cron}`; either with `target?`, `backend?`, `utc_offset?`.
  def create(conn, %{"text" => text} = params) when is_binary(text) do
    offset = offset(params)
    now = NaiveDateTime.utc_now() |> NaiveDateTime.add(offset, :minute)

    case Cron.Describe.describe(text, now) do
      {:ok, task} ->
        params
        |> Map.delete("text")
        |> Map.merge(%{"name" => task.name, "prompt" => task.prompt, "cron" => task.cron})
        |> then(&create(conn, &1))

      {:error, sentence} ->
        refuse(conn, sentence)
    end
  end

  def create(conn, params) do
    case target(params) do
      {:ok, target, made?} ->
        attrs =
          params
          |> Map.take(["name", "prompt", "cron"])
          |> Map.merge(%{"target" => target, "utc_offset" => offset(params)})

        case Cron.add(attrs) do
          {:ok, job} ->
            conn |> put_status(:created) |> json(view(job))

          {:error, reason} ->
            # A session made for a task that was then refused is nobody's.
            if made?, do: Agent.delete_session(target)
            refuse(conn, reason)
        end

      {:error, reason} ->
        refuse(conn, reason)
    end
  end

  # PATCH /api/tasks/:id — any of name, prompt, cron, utc_offset, paused.
  def update(conn, %{"id" => id} = params) do
    attrs = Map.take(params, ["name", "prompt", "cron", "utc_offset", "paused"])

    case Cron.update(id, attrs) do
      {:ok, job} -> json(conn, view(job))
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "no such task"})
      {:error, reason} -> refuse(conn, reason)
    end
  end

  # POST /api/tasks/:id/run — now, off schedule.
  def run(conn, %{"id" => id}) do
    case Cron.run(id) do
      {:ok, job} -> json(conn, view(job))
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "no such task"})
    end
  end

  # DELETE /api/tasks/:id — the task; its session stays.
  def delete(conn, %{"id" => id}) do
    case Cron.delete(id) do
      :ok -> send_resp(conn, :no_content, "")
      {:error, :not_found} -> conn |> put_status(:not_found) |> json(%{error: "no such task"})
    end
  end

  # The session runs go to: the one named, or a new one for this task alone.
  defp target(%{"target" => target}) when is_binary(target) and target != "",
    do: {:ok, target, false}

  defp target(params) do
    id = Agent.new_id()
    name = params["name"] || params["prompt"] |> to_string() |> String.slice(0, 40)

    backend =
      case Loom.Agent.Backend.parse(params["backend"] || "claude_code") do
        {:ok, backend} -> backend
        :error -> :claude_code
      end

    case Agent.start_session(id, backend: backend, title: name, kind: "task") do
      {:ok, _pid} -> {:ok, id, true}
      {:error, reason} -> {:error, inspect(reason)}
    end
  end

  defp offset(%{"utc_offset" => n}) when is_integer(n), do: n
  defp offset(_params), do: default_offset()

  defp default_offset, do: Application.get_env(:loom, Cron, [])[:utc_offset] || 480

  defp refuse(conn, reason),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: to_string(reason)})

  defp view(job) do
    job
    |> Map.take(~w(id name prompt cron target target_title paused last_run_at last_error)a)
    |> Map.merge(%{
      utc_offset: job[:utc_offset] || 0,
      paused: job[:paused] == true,
      next_at: job[:next_at] && DateTime.to_iso8601(job.next_at)
    })
  end
end
