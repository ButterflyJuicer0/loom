defmodule LoomWeb.NoticeController do
  @moduledoc """
  The bell (`Loom.Notices`), two ways in.

  For the page: the list, and the user opening, approving, rejecting or
  dismissing one.

  For the `loom-notice` command an agent runs (behind `LoomWeb.Plugs.NodeCliAuth`,
  like `loom-node`): post, withdraw, and list its own; the user's to-dos; and,
  for the bell's own chat session only, every open notice and acting on them
  for the user. Who is posting comes from
  the `x-loom-session` header, the `LOOM_SESSION_ID` Loom gives every session
  it starts; a session belonging to a virtual employee posts as that employee,
  a sleep session as Dream, any other as itself.
  """
  use LoomWeb, :controller

  alias Loom.Notices

  # GET /api/notices
  def index(conn, _params), do: json(conn, %{notices: Notices.list()})

  # POST /api/notices/:id/read
  def read(conn, %{"id" => id}), do: reply(conn, Notices.read(id))

  # POST /api/notices/:id/answer — `approve`: true or false.
  def answer(conn, %{"id" => id} = params),
    do: reply(conn, Notices.answer(id, params["approve"] == true))

  # POST /api/notices/:id/reply — `text`, sent to its session as the user's.
  def respond(conn, %{"id" => id} = params), do: reply(conn, Notices.reply(id, params["text"]))

  # POST /api/notices/:id/dismiss
  def dismiss(conn, %{"id" => id}), do: reply(conn, Notices.dismiss(id))

  # POST /api/notices/:id/later — `until`, ms.
  def later(conn, %{"id" => id} = params), do: reply(conn, Notices.later(id, params["until"]))

  # GET /api/todos
  def todos(conn, _params), do: json(conn, %{todos: Notices.todos()})

  # POST /api/todos — `text`, and optionally `due`.
  def add_todo(conn, params),
    do: todo(conn, Notices.add_todo(Map.take(params, ["text", "due"]), "you"))

  # PATCH /api/todos/:id — any of `done`, `text`, `due`.
  def update_todo(conn, %{"id" => id} = params),
    do: todo(conn, Notices.update_todo(id, Map.take(params, ["done", "text", "due"])))

  # DELETE /api/todos/:id
  def delete_todo(conn, %{"id" => id}) do
    case Notices.delete_todo(id) do
      :ok -> send_resp(conn, :no_content, "")
      error -> todo(conn, error)
    end
  end

  # POST /api/notices/session — the bell's chat, made on first use.
  def session(conn, _params) do
    case Notices.session() do
      {:ok, id} -> json(conn, %{session: id})
      error -> reply(conn, error)
    end
  end

  # ── loom-notice ─────────────────────────────────────────────────────────

  # POST /api/notice/post — `summary`, `priority`, and optionally `key`,
  # `needs`, `detail` (the brief its own session opens on), `options`.
  def post(conn, params) do
    with {:ok, session, source} <- source(conn) do
      attrs =
        params
        |> Map.take(["summary", "priority", "key", "needs", "detail", "options"])
        |> Map.put("session", session)

      reply(conn, Notices.post(source, attrs))
    else
      error -> reply(conn, error)
    end
  end

  # POST /api/notice/withdraw — `key`.
  def withdraw(conn, params) do
    with {:ok, _session, source} <- source(conn),
         :ok <- Notices.withdraw(source.id, params["key"]) do
      json(conn, %{ok: true})
    else
      error -> reply(conn, error)
    end
  end

  # GET /api/notice/mine
  def mine(conn, _params) do
    case source(conn) do
      {:ok, _session, source} -> json(conn, %{notices: Notices.open_of(source.id)})
      error -> reply(conn, error)
    end
  end

  # GET /api/notice/todos
  def cli_todos(conn, _params) do
    with {:ok, _session, _source} <- source(conn),
         do: json(conn, %{todos: Notices.todos()}),
         else: (error -> reply(conn, error))
  end

  # POST /api/notice/todo — `op`: add (`text`, `due`), done, undo or rm (`id`).
  def cli_todo(conn, params) do
    with {:ok, session, source} <- source(conn) do
      case params["op"] do
        "add" ->
          todo(
            conn,
            Notices.add_todo(
              params |> Map.take(["text", "due"]) |> Map.put("session", session),
              source.name
            )
          )

        op when op in ["done", "undo"] ->
          todo(conn, Notices.update_todo(params["id"], %{"done" => op == "done"}))

        "rm" ->
          case Notices.delete_todo(params["id"]) do
            :ok -> json(conn, %{ok: true})
            error -> todo(conn, error)
          end

        _ ->
          reply(conn, {:error, "op is add, done, undo or rm"})
      end
    else
      error -> reply(conn, error)
    end
  end

  # GET /api/notice/all — every open notice, for the bell's chat.
  def all(conn, _params) do
    with {:ok, _session, _source} <- bell(conn) do
      json(conn, %{notices: Enum.filter(Notices.list(), &(&1["status"] == "open"))})
    else
      error -> reply(conn, error)
    end
  end

  # POST /api/notice/act — `id`, `action`: approve, reject, reply (`text`) or done.
  # From a notice's own session, on that notice only, passed to its source.
  def act(conn, %{"id" => id} = params) do
    with [session | _] <- get_req_header(conn, "x-loom-session"),
         {:ok, %{kind: "notice"}} <- Loom.Agent.Store.read_meta(session) do
      reply(conn, Notices.relay(id, session, params["action"], params["text"]))
    else
      _ -> act_for_user(conn, id, params)
    end
  end

  defp act_for_user(conn, id, params) do
    with {:ok, _session, _source} <- bell(conn) do
      case params["action"] do
        "approve" -> reply(conn, Notices.answer(id, true))
        "reject" -> reply(conn, Notices.answer(id, false))
        "reply" -> reply(conn, Notices.reply(id, params["text"]))
        "done" -> reply(conn, Notices.dismiss(id))
        _ -> reply(conn, {:error, "action is approve, reject, reply or done"})
      end
    else
      error -> reply(conn, error)
    end
  end

  # Acting for the user is the bell's chat's alone. Soft, like the rest: the
  # session id is whatever the process says it is.
  defp bell(conn) do
    with [session | _] <- get_req_header(conn, "x-loom-session"),
         {:ok, %{kind: "bell"} = meta} <- Loom.Agent.Store.read_meta(session) do
      {:ok, session, source_of(session, meta)}
    else
      _ -> {:error, "only the bell's own chat can act on notices for the user"}
    end
  end

  defp source(conn) do
    with [session | _] <- get_req_header(conn, "x-loom-session"),
         {:ok, meta} <- Loom.Agent.Store.read_meta(session) do
      {:ok, session, source_of(session, meta)}
    else
      _ -> {:error, "run this from a Loom session: LOOM_SESSION_ID is missing or unknown"}
    end
  end

  defp source_of(_session, %{employee_id: id}) when is_binary(id) do
    name =
      case Loom.Employees.get(id) do
        {:ok, e} -> e["name"]
        _ -> id
      end

    %{kind: "employee", id: id, name: name}
  end

  defp source_of(_session, %{kind: "dream"} = meta) do
    scope = meta[:project_id] || "home"

    name =
      with id when is_binary(id) <- meta[:project_id],
           {:ok, project} <- Loom.Projects.get(id) do
        "Dream · " <> project.name
      else
        _ -> "Dream"
      end

    %{kind: "dream", id: "dream:" <> scope, name: name}
  end

  defp source_of(session, meta),
    do: %{kind: "session", id: session, name: meta[:title] || "A session"}

  defp todo(conn, {:ok, todo}), do: json(conn, %{todo: todo})

  defp todo(conn, {:error, :not_found}),
    do: conn |> put_status(:not_found) |> json(%{error: "no such to-do"})

  defp todo(conn, error), do: reply(conn, error)

  defp reply(conn, {:ok, notice}), do: json(conn, %{notice: notice})

  defp reply(conn, {:error, :not_found}),
    do: conn |> put_status(:not_found) |> json(%{error: "no such notice"})

  defp reply(conn, {:error, reason}) when is_binary(reason),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: reason})

  defp reply(conn, {:error, reason}),
    do: conn |> put_status(:unprocessable_entity) |> json(%{error: inspect(reason)})
end
