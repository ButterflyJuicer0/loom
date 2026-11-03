import Config

config :loom, :password, "test-password"

# Each test owns its session data under a temp dir, so the boot-time restore
# would only race with that. Tests that exercise restore drive it directly.
config :loom, :restore_agents, false

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :loom, LoomWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "VzA3sG+8Akz5Fqb3nrSRbR1nYdOqxDUe+C0WVeltx5CWLkUBeHm4nY8EcosHe6pv",
  server: false

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true

# No real `codex app-server`: the suite drives the JSON-RPC protocol directly,
# and spawning one would make every run slow and dependent on a working login.
config :loom, :codex_server, false

# Never the real `~/.loom/cron.json`: a test run must not fire, or rewrite, the
# user's jobs.
config :loom, Loom.Cron, path: Path.join(System.tmp_dir!(), "loom-test-#{System.pid()}/cron.json")

# Nor the real device registry and CLI key.
config :loom, Loom.Push, path: Path.join(System.tmp_dir!(), "loom-test-#{System.pid()}/push.json")
config :loom, Loom.Nodes, dir: Path.join(System.tmp_dir!(), "loom-test-#{System.pid()}")
config :loom, LoomWeb.NodeController, await_ms: 200

# Nor the real projects and their workspaces. No classifier either: it would
# call the real `claude`; tests that need one put a stand-in here.
config :loom, Loom.Projects,
  dir: Path.join(System.tmp_dir!(), "loom-test-#{System.pid()}"),
  classifier: nil

# Nor the real sleep schedule, and no sleeping on its own during a run.
config :loom, Loom.Dream,
  path: Path.join(System.tmp_dir!(), "loom-test-#{System.pid()}/dream.json"),
  tick: :timer.hours(24)

# Nor the real bell, and no digest on its own during a run.
config :loom, Loom.Notices,
  path: Path.join(System.tmp_dir!(), "loom-test-#{System.pid()}/notices.json"),
  tick: :timer.hours(24),
  ring: fn _, _, _, _ -> :ok end

# Nor employees waking on their own; the tests drive them by hand.
config :loom, Loom.Employees,
  path: Path.join(System.tmp_dir!(), "loom-test-#{System.pid()}/employees.json"),
  tick: :timer.hours(24),
  run: false

# No recaps of finished turns either: each would be a real model call.
config :loom, recap: nil
