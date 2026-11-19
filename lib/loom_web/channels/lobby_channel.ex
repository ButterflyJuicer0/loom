defmodule LoomWeb.LobbyChannel do
  @moduledoc """
  The session list, pushed instead of polled. The topic is `agents`.

  Server → client:
    - join reply : `%{sessions: [summary], nodes: [device], projects: [project],
                     employees: [employee], notices: [notice],
                     todos: [todo], auth_pending: [sign-in]}`,
                   all whole lists
    - "session"  : one summary, whenever that session's header changes
    - "removed"  : `%{id: _}`, when a session is stopped or deleted
    - "node"     : one device (`Loom.Nodes`), when it is added, renamed, or
                   comes online or goes offline
    - "node_removed" : `%{id: _}`, when a device is removed
    - "project"  : one project (`Loom.Projects.view/1`), when it is made or changed
    - "project_removed" : `%{id: _}`, when a project is deleted
    - "employee" : one virtual employee (`Loom.Employees.view/1`), when it changes
    - "employee_removed" : `%{id: _}`, when one is let go
    - "notices"  : `%{notices: [notice]}`, the whole bell (`Loom.Notices`),
                   whenever it changes
    - "todos"    : `%{todos: [todo]}`, the user's to-dos, likewise
    - "auth_pending" : `%{pending: [sign-in]}`, password sign-ins waiting for
                   a signed-in device to allow them (`Loom.Auth`)

  Client → server:
    - "watching" : `%{endpoint:, session:}`, which session this device is
                   showing (`nil` when none, or the app is hidden), so its
                   notifications for that session are held back; see
                   `Loom.Push`

  A summary is what `GET /api/agents` returns for one session, plus `seq`. The
  client keeps whichever copy of a session has the higher `seq`: the channel is
  subscribed before the list is read, so a summary broadcast in between arrives
  *after* the join reply despite being older than it.

  A reconnect rejoins and gets the whole list again, so nothing missed while
  offline needs replaying.
  """
  use Phoenix.Channel

  alias Loom.Agent

  @impl true
  def join("agents", _params, socket) do
    # Already subscribed to "agents" by `Phoenix.Channel.Server` — the session
    # broadcasts on exactly this topic, so no extra subscribe (it would deliver
    # everything twice; see `LoomWeb.AgentChannel`).
    {:ok,
     %{
       sessions: Agent.list_sessions(),
       nodes: Loom.Nodes.list(),
       projects: Enum.map(Loom.Projects.list(), &Loom.Projects.view/1),
       employees: Loom.Employees.list(),
       notices: Loom.Notices.list(),
       todos: Loom.Notices.todos(),
       auth_pending: Loom.Auth.pending()
     }, socket}
  end

  @impl true
  def handle_in("watching", %{"endpoint" => endpoint} = params, socket)
      when is_binary(endpoint) do
    Loom.Push.watching(endpoint, params["session"], self())
    {:noreply, socket}
  end

  @impl true
  def handle_info({:agent_summary, summary}, socket) do
    push(socket, "session", summary)
    {:noreply, socket}
  end

  def handle_info({:agent_removed, id}, socket) do
    push(socket, "removed", %{id: id})
    {:noreply, socket}
  end

  def handle_info({:node_summary, node}, socket) do
    push(socket, "node", node)
    {:noreply, socket}
  end

  def handle_info({:node_removed, id}, socket) do
    push(socket, "node_removed", %{id: id})
    {:noreply, socket}
  end

  def handle_info({:project_summary, project}, socket) do
    push(socket, "project", project)
    {:noreply, socket}
  end

  def handle_info({:employee_summary, employee}, socket) do
    push(socket, "employee", employee)
    {:noreply, socket}
  end

  def handle_info({:employee_removed, id}, socket) do
    push(socket, "employee_removed", %{id: id})
    {:noreply, socket}
  end

  def handle_info({:notices, list}, socket) do
    push(socket, "notices", %{notices: list})
    {:noreply, socket}
  end

  def handle_info({:todos, list}, socket) do
    push(socket, "todos", %{todos: list})
    {:noreply, socket}
  end

  def handle_info({:auth_pending, list}, socket) do
    push(socket, "auth_pending", %{pending: list})
    {:noreply, socket}
  end

  def handle_info({:project_removed, id}, socket) do
    push(socket, "project_removed", %{id: id})
    {:noreply, socket}
  end
end
