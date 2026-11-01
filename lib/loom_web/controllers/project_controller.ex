defmodule LoomWeb.ProjectController do
  @moduledoc """
  Projects: what `Loom.Projects` keeps, over HTTP. The list itself reaches the
  sidebar on the lobby channel; these return the one project they touched so
  the caller need not wait for the push.
  """
  use LoomWeb, :controller

  alias Loom.Agent
  alias Loom.Projects

  # GET /api/projects
  def index(conn, _params) do
    json(conn, %{projects: Enum.map(Projects.list(), &Projects.view/1)})
  end

  # POST /api/projects {name, dir?, instructions?}
  def create(conn, params) do
    case Projects.create(params) do
      {:ok, project} -> conn |> put_status(:created) |> json(Projects.view(project))
      {:error, reason} -> refuse(conn, reason)
    end
  end

  # PATCH /api/projects/:id {name?, instructions?}
  def update(conn, %{"id" => id} = params) do
    case Projects.update(id, Map.take(params, ["name", "instructions"])) do
      {:ok, project} -> json(conn, Projects.view(project))
      {:error, reason} -> refuse(conn, reason)
    end
  end

  # DELETE /api/projects/:id — the project, every session in it, and its
  # workspace. Sessions first: one left behind would point at a cwd that is
  # about to go.
  def delete(conn, %{"id" => id}) do
    case Projects.get(id) do
      {:ok, _project} ->
        for meta <- Agent.list_persisted(),
            meta[:project_id] == id,
            do: Agent.delete_session(meta.id)

        :ok = Projects.delete(id)
        send_resp(conn, :no_content, "")

      :error ->
        refuse(conn, :not_found)
    end
  end

  # GET /api/projects/:id/tree — the workspace's files, for the project's
  # page. Listed, not read; each comes down by the route below.
  def tree(conn, %{"id" => id}) do
    case Projects.get(id) do
      {:ok, project} ->
        {files, truncated} = Projects.list_files(project)
        json(conn, %{files: files, truncated: truncated})

      :error ->
        refuse(conn, :not_found)
    end
  end

  # GET /api/projects/:id/files/*path — one workspace file, by the same rules
  # as the listing.
  def file(conn, %{"id" => id, "path" => parts}) do
    with {:ok, project} <- Projects.get(id),
         {:ok, path} <- Projects.resolve_file(project, Path.join(parts)) do
      send_download(conn, {:file, path}, filename: Path.basename(path))
    else
      _ -> conn |> put_status(:not_found) |> json(%{error: "no such workspace file"})
    end
  end

  defp refuse(conn, :not_found),
    do: conn |> put_status(:not_found) |> json(%{error: "no such project"})

  defp refuse(conn, reason),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: reason})
end
