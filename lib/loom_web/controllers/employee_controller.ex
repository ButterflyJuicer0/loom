defmodule LoomWeb.EmployeeController do
  @moduledoc """
  Virtual employees (`Loom.Employees`), for their page: hiring and settings,
  pause and wake, the day's budget, KPIs, and the reports they write; and the
  boss profile they share.
  """
  use LoomWeb, :controller

  alias Loom.Employees

  # GET /api/employees
  def index(conn, _params), do: json(conn, %{employees: Employees.list()})

  # GET /api/employees/:id
  def show(conn, %{"id" => id}), do: reply(conn, Employees.get(id))

  # POST /api/employees — `name`, and any of the settings.
  def create(conn, params), do: reply(conn, Employees.create(params))

  # POST /api/employees/setup — a setup chat, to hire in conversation, or with
  # `employee_id` to change that one (`Employees.setup_chat/1`).
  def setup(conn, params) do
    case Employees.setup_chat(params["employee_id"]) do
      {:ok, id} -> json(conn, %{session: id})
      error -> reply(conn, error)
    end
  end

  # PATCH /api/employees/:id — any of the settings (not `permissions`: those
  # are set from a setup chat only).
  def update(conn, %{"id" => id} = params),
    do: reply(conn, Employees.update(id, Map.delete(params, "id")))

  # DELETE /api/employees/:id
  def delete(conn, %{"id" => id}) do
    case Employees.delete(id) do
      :ok -> send_resp(conn, :no_content, "")
      error -> reply(conn, error)
    end
  end

  # POST /api/employees/:id/pause — `paused`: true or false.
  def pause(conn, %{"id" => id} = params),
    do: reply(conn, Employees.pause(id, params["paused"] == true))

  # POST /api/employees/:id/wake — an optional `note` goes with it.
  def wake(conn, %{"id" => id} = params), do: reply(conn, Employees.wake(id, params["note"]))

  # POST /api/employees/:id/seen — what it reported has been read.
  def seen(conn, %{"id" => id}), do: reply(conn, Employees.seen(id))

  # POST /api/employees/:id/approve — `usd` more, for today.
  def approve(conn, %{"id" => id} = params), do: reply(conn, Employees.approve(id, params["usd"]))

  # POST /api/employees/:id/kpis
  def add_kpi(conn, %{"id" => id} = params),
    do: reply(conn, Employees.add_kpi(id, Map.delete(params, "id")))

  # PATCH /api/employees/:id/kpis/:kpi
  def update_kpi(conn, %{"id" => id, "kpi" => kpi} = params),
    do: reply(conn, Employees.update_kpi(id, kpi, Map.drop(params, ["id", "kpi"])))

  # DELETE /api/employees/:id/kpis/:kpi
  def delete_kpi(conn, %{"id" => id, "kpi" => kpi}),
    do: reply(conn, Employees.delete_kpi(id, kpi))

  # POST /api/employees/:id/kpis/:kpi/review — `accept`, and a `note`.
  def review_kpi(conn, %{"id" => id, "kpi" => kpi} = params),
    do: reply(conn, Employees.review_kpi(id, kpi, params["accept"] == true, params["note"]))

  # GET /api/employees/:id/reports
  def reports(conn, %{"id" => id}) do
    case Employees.get(id) do
      {:ok, _} -> json(conn, %{reports: Employees.reports(id)})
      error -> reply(conn, error)
    end
  end

  # GET /api/employees/:id/reports/:file
  def report(conn, %{"id" => id, "file" => file}) do
    with {:ok, _} <- Employees.get(id),
         {:ok, text} <- Employees.report(id, file) do
      json(conn, %{file: file, text: text})
    else
      {:error, :enoent} -> conn |> put_status(:not_found) |> json(%{error: "no such report"})
      error -> reply(conn, error)
    end
  end

  # GET /api/boss — the boss profile, all employees' one.
  def boss(conn, _params), do: json(conn, %{boss: Employees.boss()})

  # POST /api/boss — `text`.
  def add_boss(conn, params), do: boss_reply(conn, Employees.add_boss(params["text"]))

  # PATCH /api/boss/:id — `text`.
  def update_boss(conn, %{"id" => id} = params),
    do: boss_reply(conn, Employees.update_boss(id, params["text"]))

  # DELETE /api/boss/:id
  def delete_boss(conn, %{"id" => id}) do
    case Employees.delete_boss(id) do
      :ok -> json(conn, %{boss: Employees.boss()})
      error -> boss_reply(conn, error)
    end
  end

  defp boss_reply(conn, {:ok, _entry}), do: json(conn, %{boss: Employees.boss()})

  defp boss_reply(conn, {:error, :not_found}),
    do: conn |> put_status(:not_found) |> json(%{error: "no such line"})

  defp boss_reply(conn, error), do: reply(conn, error)

  defp reply(conn, {:ok, employee}), do: json(conn, %{employee: employee})

  defp reply(conn, {:error, :not_found}),
    do: conn |> put_status(:not_found) |> json(%{error: "no such employee"})

  defp reply(conn, {:error, reason}) when is_binary(reason),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: reason})

  defp reply(conn, {:error, reason}),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
end
