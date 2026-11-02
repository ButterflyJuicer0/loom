import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Channel } from "phoenix"
import { getSocket } from "./socket"
import type { AgentInfo, Device, Employee, Notice, Project, Todo } from "./api"
import { stillCreating } from "./api"

export type Watching = { endpoint: string; session: string | null }

type Lobby = {
  sessions: AgentInfo[]
  // The user's machines, in the order they were added. Online state is pushed
  // as they connect and drop.
  devices: Device[]
  upsertDevice: (device: Device) => void
  // Oldest first; pushed as they are made, edited and deleted.
  projects: Project[]
  upsertProject: (project: Project) => void
  dropProject: (id: string) => void
  // Virtual employees, oldest first; see `Employees.tsx`.
  employees: Employee[]
  upsertEmployee: (employee: Employee) => void
  dropEmployee: (id: string) => void
  // The bell, newest first, pushed whole whenever it changes; see `Notices.tsx`.
  notices: Notice[]
  upsertNotice: (notice: Notice) => void
  // The user's to-dos, open first, pushed whole likewise.
  todos: Todo[]
  loaded: boolean
  // For the caller's own create/delete, so the sidebar does not wait for the
  // push. The push still arrives and is merged by `seq`.
  upsert: (session: AgentInfo) => void
  drop: (id: string) => void
}

/**
 * The session list, pushed over the `agents` channel instead of polled.
 *
 * The join reply is the whole list, and phoenix.js fires the join's "ok" again
 * on every rejoin — so a reconnect replaces the list wholesale and nothing
 * missed while offline needs replaying. Between joins, each session pushes its
 * summary whenever its header changes.
 *
 * A summary can arrive older than the copy we hold (the server subscribes
 * before it reads the list), so the higher `seq` wins.
 *
 * `watching` goes the other way: which session this device is showing, for a
 * device with notifications on, so the server holds back the ones for what is
 * already on screen. Sent on every join too, as the server forgets it with the
 * channel.
 */
export function useLobby(enabled: boolean, watching: Watching | null = null): Lobby {
  const [byId, setById] = useState<Map<string, AgentInfo>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [devices, setDevices] = useState<Map<string, Device>>(new Map())
  const [projects, setProjects] = useState<Map<string, Project>>(new Map())
  const [employees, setEmployees] = useState<Map<string, Employee>>(new Map())
  const [notices, setNotices] = useState<Notice[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  // The caller's own answer, before the push: the list comes again anyway.
  const upsertNotice = useCallback(
    (n: Notice) => setNotices((list) => list.map((x) => (x.id === n.id ? n : x))),
    [],
  )
  const joinedChannel = useRef<Channel | null>(null)
  const watchingRef = useRef(watching)
  watchingRef.current = watching

  // No `seq` to compare: a device's summary is only ever sent from the one
  // process that owns the registry, in order.
  const upsertDevice = useCallback((device: Device) => {
    setDevices((current) => new Map(current).set(device.id, device))
  }, [])

  const dropDevice = useCallback((id: string) => {
    setDevices((current) => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])

  // Like a device: one process owns them and sends them in order.
  const upsertProject = useCallback((project: Project) => {
    setProjects((current) => new Map(current).set(project.id, project))
  }, [])

  const dropProject = useCallback((id: string) => {
    setProjects((current) => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])

  // Like a project: one process owns them and sends them in order.
  const upsertEmployee = useCallback((employee: Employee) => {
    setEmployees((current) => new Map(current).set(employee.id, employee))
  }, [])

  const dropEmployee = useCallback((id: string) => {
    setEmployees((current) => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])

  const upsert = useCallback((session: AgentInfo) => {
    setById((current) => {
      const known = current.get(session.id)
      if (known && known.seq > session.seq) return current
      const next = new Map(current)
      next.set(session.id, session)
      return next
    })
  }, [])

  const drop = useCallback((id: string) => {
    setById((current) => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (!enabled) return

    let joined = false
    // Torn down before the join resolved. phoenix.js skips the leave push for a
    // channel still joining, which would leave the server side subscribed; see
    // the same dance in `useAgent`.
    let leaveWhenJoined = false

    const channel = getSocket().channel("agents")
    channel.on("session", upsert)
    channel.on("removed", ({ id }: { id: string }) => drop(id))
    channel.on("node", upsertDevice)
    channel.on("node_removed", ({ id }: { id: string }) => dropDevice(id))
    channel.on("project", upsertProject)
    channel.on("project_removed", ({ id }: { id: string }) => dropProject(id))
    channel.on("employee", upsertEmployee)
    channel.on("employee_removed", ({ id }: { id: string }) => dropEmployee(id))
    channel.on("notices", ({ notices }: { notices: Notice[] }) => setNotices(notices))
    channel.on("todos", ({ todos }: { todos: Todo[] }) => setTodos(todos))

    channel
      .join()
      .receive(
        "ok",
        ({
          sessions,
          nodes,
          projects,
          employees,
          notices,
          todos,
        }: {
          sessions: AgentInfo[]
          nodes: Device[]
          projects?: Project[]
          employees?: Employee[]
          notices?: Notice[]
          todos?: Todo[]
        }) => {
        joined = true
        if (leaveWhenJoined) {
          channel.leave()
          return
        }
        joinedChannel.current = channel
        if (watchingRef.current) channel.push("watching", watchingRef.current)
        // A chat only just opened here and not yet on the server stays.
        const fresh = new Map(sessions.map((s) => [s.id, s]))
        for (const s of stillCreating()) if (!fresh.has(s.id)) fresh.set(s.id, s)
        setById(fresh)
        setDevices(new Map((nodes ?? []).map((d) => [d.id, d])))
        setProjects(new Map((projects ?? []).map((p) => [p.id, p])))
        setEmployees(new Map((employees ?? []).map((e) => [e.id, e])))
        setNotices(notices ?? [])
        setTodos(todos ?? [])
        setLoaded(true)
        },
      )
      // Nothing to show either way; an empty list beats "connecting…" forever.
      .receive("error", () => setLoaded(true))

    return () => {
      joinedChannel.current = null
      if (joined) channel.leave()
      else leaveWhenJoined = true
    }
  }, [enabled, upsert, drop, upsertDevice, dropDevice, upsertProject, dropProject, upsertEmployee, dropEmployee])

  const endpoint = watching?.endpoint
  const session = watching?.session
  useEffect(() => {
    if (endpoint) joinedChannel.current?.push("watching", { endpoint, session })
  }, [endpoint, session])

  // Most recently active first, so the conversation you are in stays on top.
  const sessions = useMemo(
    () => [...byId.values()].sort((a, b) => lastActive(b) - lastActive(a)),
    [byId],
  )
  const deviceList = useMemo(
    () => [...devices.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [devices],
  )
  const projectList = useMemo(
    () => [...projects.values()].sort((a, b) => a.created_at - b.created_at),
    [projects],
  )
  const employeeList = useMemo(
    () => [...employees.values()].sort((a, b) => a.created_at - b.created_at),
    [employees],
  )
  return {
    sessions,
    employees: employeeList,
    upsertEmployee,
    dropEmployee,
    notices,
    upsertNotice,
    todos,
    devices: deviceList,
    upsertDevice,
    projects: projectList,
    upsertProject,
    dropProject,
    loaded,
    upsert,
    drop,
  }
}

export const lastActive = (s: AgentInfo) => s.last_active_at ?? s.created_at
