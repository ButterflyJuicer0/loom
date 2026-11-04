defmodule LoomWeb.Router do
  use LoomWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :browser do
    plug :accepts, ["html"]
  end

  pipeline :authed_api do
    plug :accepts, ["json"]
    plug LoomWeb.Plugs.RequireAuth
  end

  scope "/api", LoomWeb do
    pipe_through :api

    post "/login", AuthController, :login
  end

  scope "/api", LoomWeb do
    pipe_through :authed_api

    get "/sessions", SessionController, :index
    post "/sessions", SessionController, :create
    delete "/sessions/:id", SessionController, :delete

    get "/agents", AgentSessionController, :index
    get "/search", SearchController, :index
    post "/agents", AgentSessionController, :create
    patch "/agents/:id", AgentSessionController, :update
    post "/agents/:id/continue", AgentSessionController, :continue
    delete "/agents/:id", AgentSessionController, :delete
    get "/agents/:id/meeting", MeetingController, :show
    post "/agents/:id/meeting", MeetingController, :update
    get "/meeting/models", MeetingController, :models
    get "/meeting/hotwords", MeetingController, :hotwords
    post "/meeting/models", MeetingController, :fetch
    get "/meeting/models/:bundle/:name", MeetingController, :file
    get "/agents/:id/draft", AgentDraftController, :show
    put "/agents/:id/draft", AgentDraftController, :update

    post "/agents/:id/files", AgentFileController, :create
    get "/agents/:id/files/:name", AgentFileController, :show
    patch "/agents/:id/files/:name", AgentFileController, :update
    delete "/agents/:id/files/:name", AgentFileController, :delete
    get "/agents/:id/output/*path", AgentOutputController, :show
    patch "/agents/:id/output/*path", AgentOutputController, :update
    delete "/agents/:id/output/*path", AgentOutputController, :delete
    get "/agents/:id/zip/*path", AgentOutputController, :zip
    get "/agents/:id/tree", AgentOutputController, :tree
    get "/agents/:id/workspace/*path", AgentOutputController, :workspace
    post "/agents/:id/image", AgentImageController, :create

    get "/tasks", TaskController, :index
    post "/tasks", TaskController, :create
    patch "/tasks/:id", TaskController, :update
    post "/tasks/:id/run", TaskController, :run
    delete "/tasks/:id", TaskController, :delete

    get "/dreams", DreamController, :index
    get "/dreams/:scope", DreamController, :show
    patch "/dreams/:scope", DreamController, :update
    post "/dreams/:scope/session", DreamController, :session
    post "/dreams/:scope/run", DreamController, :run
    post "/dreams/:scope/undo", DreamController, :undo
    get "/dreams/:scope/memories", DreamController, :memories

    get "/employees", EmployeeController, :index
    post "/employees", EmployeeController, :create
    post "/employees/setup", EmployeeController, :setup
    get "/employees/:id", EmployeeController, :show
    patch "/employees/:id", EmployeeController, :update
    delete "/employees/:id", EmployeeController, :delete
    post "/employees/:id/pause", EmployeeController, :pause
    post "/employees/:id/wake", EmployeeController, :wake
    post "/employees/:id/approve", EmployeeController, :approve
    post "/employees/:id/seen", EmployeeController, :seen
    post "/employees/:id/kpis", EmployeeController, :add_kpi
    patch "/employees/:id/kpis/:kpi", EmployeeController, :update_kpi
    delete "/employees/:id/kpis/:kpi", EmployeeController, :delete_kpi
    post "/employees/:id/kpis/:kpi/review", EmployeeController, :review_kpi
    get "/employees/:id/reports", EmployeeController, :reports
    get "/employees/:id/reports/:file", EmployeeController, :report
    get "/boss", EmployeeController, :boss
    post "/boss", EmployeeController, :add_boss
    patch "/boss/:id", EmployeeController, :update_boss
    delete "/boss/:id", EmployeeController, :delete_boss

    get "/projects", ProjectController, :index
    post "/projects", ProjectController, :create
    patch "/projects/:id", ProjectController, :update
    delete "/projects/:id", ProjectController, :delete
    get "/projects/:id/tree", ProjectController, :tree
    get "/projects/:id/files/*path", ProjectController, :file
    post "/agents/:id/canvas", CanvasController, :token

    get "/layout", LayoutController, :show
    put "/layout", LayoutController, :update

    get "/devices", DevicesController, :index
    post "/devices", DevicesController, :create
    patch "/devices/:id", DevicesController, :update
    delete "/devices/:id", DevicesController, :delete
    post "/devices/:id/install", DevicesController, :install
    get "/devices/:id/sessions", DeviceSessionsController, :index
    get "/devices/:id/sessions/transcript", DeviceSessionsController, :show
    post "/devices/:id/sessions/continue", DeviceSessionsController, :continue
    post "/devices/:id/sessions/pick", DeviceSessionsController, :pick
    delete "/devices/:id/sessions", DeviceSessionsController, :delete

    get "/notices", NoticeController, :index
    post "/notices/:id/read", NoticeController, :read
    post "/notices/:id/answer", NoticeController, :answer
    post "/notices/:id/reply", NoticeController, :respond
    post "/notices/:id/dismiss", NoticeController, :dismiss
    post "/notices/:id/later", NoticeController, :later
    post "/notices/session", NoticeController, :session
    get "/todos", NoticeController, :todos
    post "/todos", NoticeController, :add_todo
    patch "/todos/:id", NoticeController, :update_todo
    delete "/todos/:id", NoticeController, :delete_todo

    get "/push", PushController, :show
    post "/push/subscriptions", PushController, :create
    delete "/push/subscriptions", PushController, :delete
  end

  # The `loom-node` CLI on this host, relaying to a device. Not the browser's
  # token: a key only this user can read, and never anything that came through
  # Cloudflare. See `LoomWeb.Plugs.NodeCliAuth`.
  pipeline :node_cli do
    plug LoomWeb.Plugs.NodeCliAuth
  end

  scope "/api/node", LoomWeb do
    pipe_through :node_cli

    get "/list", NodeController, :list
    post "/exec", NodeController, :exec
    get "/read", NodeController, :read
    post "/write", NodeController, :write
  end

  # `loom-notice`, which an agent runs to post to the bell. The same key as
  # `loom-node`; the session it comes from is in `x-loom-session`.
  scope "/api/notice", LoomWeb do
    pipe_through :node_cli

    post "/post", NoticeController, :post
    post "/withdraw", NoticeController, :withdraw
    get "/mine", NoticeController, :mine
    get "/todos", NoticeController, :cli_todos
    post "/todo", NoticeController, :cli_todo
    get "/all", NoticeController, :all
    post "/act", NoticeController, :act
  end

  # `loom-session`, which an agent runs to tidy the user's sessions; see
  # `LoomWeb.TidyController`. Same key and header as `loom-notice`.
  scope "/api/tidy", LoomWeb do
    pipe_through :node_cli

    get "/list", TidyController, :list
    get "/read", TidyController, :read
    get "/search", TidyController, :search
    post "/archive", TidyController, :archive
    post "/merge", TidyController, :merge
    post "/retitle", TidyController, :retitle
    post "/keep", TidyController, :keep
    post "/handoff", TidyController, :handoff
  end

  # A device joining: the install script (its one-time code is the credential)
  # and the binary it downloads. See `LoomWeb.NodeInstallController`.
  scope "/node", LoomWeb do
    get "/install/:code", NodeInstallController, :script
    get "/install/:code/ps1", NodeInstallController, :powershell
    get "/download/:target", NodeInstallController, :download
    get "/app/:code", NodeInstallController, :app
  end

  # The user taking over loom's browser; see `LoomWeb.VncSocket`. Checks the
  # token itself, as a WebSocket can't carry the header `RequireAuth` reads.
  scope "/browser", LoomWeb do
    get "/vnc", BrowserController, :vnc
  end

  # The UI itself. Last so it can never shadow an API route, and only `/` —
  # see `LoomWeb.SpaController`. Unauthenticated on purpose: the app shell is
  # a login form until the password is entered, and every route that touches a
  # session is behind `RequireAuth` or the socket's token check.
  # No bearer token and no `accepts`: an iframe asks for whatever the page
  # references. The signed path is the credential; see `CanvasController`.
  scope "/canvas", LoomWeb do
    get "/:id/:token", CanvasController, :show
    get "/:id/:token/*path", CanvasController, :show
  end

  # The same signed token, for what the user attached rather than what the
  # agent wrote: a separate prefix, since any name could be a directory in
  # `output/`.
  scope "/canvas-files", LoomWeb do
    get "/:id/:token/:name", CanvasController, :attachment
  end

  scope "/", LoomWeb do
    pipe_through :browser

    get "/", SpaController, :index
  end
end
