import { X } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { createProject, deleteProject, updateProject, type Project } from "./api"
import { Confirm } from "./Confirm"
import { t } from "./i18n"

/**
 * Make a project, or edit one: its name and the instructions every session in
 * it is given. Where it lives is not asked: Loom gives every project a
 * workspace of its own, shown once it exists.
 *
 * Deleting takes the project's sessions and its workspace with it, so it asks
 * first.
 */
export function ProjectDialog({
  project,
  sessionCount,
  onSaved,
  onClose,
}: {
  // null to make a new one.
  project: Project | null
  sessionCount: number
  onSaved: (project: Project) => void
  onClose: () => void
}) {
  const [name, setName] = useState(project?.name ?? "")
  const [instructions, setInstructions] = useState(project?.instructions ?? "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (asking) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose, asking])

  const save = async () => {
    if (name.trim() === "" || busy) return
    setBusy(true)
    try {
      const saved = project
        ? await updateProject(project.id, { name, instructions })
        : await createProject({ name, instructions })
      onSaved(saved)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return createPortal(
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal project-dialog" role="dialog" aria-label={project ? t("Project") : t("New project")}>
        <div className="modal-head">
          <span>{project ? t("Project") : t("New project")}</span>
          <button className="icon-btn" onClick={onClose} title={t("Close")}>
            <X />
          </button>
        </div>

        <form
          className="project-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label>
            <span>{t("Name")}</span>
            <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Blog")} />
          </label>

          {project && (
            <label>
              <span>{t("Workspace")}</span>
              <code className="project-path">{project.workspace}</code>
              <small>{t("Every session in the project starts here.")}</small>
            </label>
          )}

          <label>
            <span>{t("Instructions")}</span>
            <textarea
              value={instructions}
              rows={7}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t("What every session in this project should know or do.")}
            />
            <small>{t("Added to each session's system prompt. Claude Code sessions pick up a change on their next turn.")}</small>
          </label>

          {error && <div className="device-error">{error}</div>}

          <div className="confirm-actions">
            {project && (
              <button type="button" className="text-btn danger project-delete" onClick={() => setAsking(true)}>
                {t("Delete")}
              </button>
            )}
            <button type="button" className="text-btn" onClick={onClose}>
              {t("Cancel")}
            </button>
            <button type="submit" className="text-btn primary" disabled={name.trim() === "" || busy}>
              {project ? t("Save") : t("Create")}
            </button>
          </div>
        </form>
      </div>

      {asking && project && (
        <Confirm
          title={t("Delete {name}?", { name: project.name })}
          detail={t(
            sessionCount === 1
              ? "Its {n} session and their history, and the workspace {workspace} with everything in it. This cannot be undone."
              : "Its {n} sessions and their history, and the workspace {workspace} with everything in it. This cannot be undone.",
            { n: sessionCount, workspace: project.workspace },
          )}
          onYes={async () => {
            await deleteProject(project.id)
            onClose()
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </div>,
    document.body,
  )
}
