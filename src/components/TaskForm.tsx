import { useEffect, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import type { FlowTask } from '../types/flow'
import { taskApplied, taskFields } from '../lib/flow-tasks'
import type { TaskCommand } from '../lib/flow-tasks'
import { toLocalDateTime } from '../lib/history-time'

export default function TaskForm({ data, task, onSaved, onCancel }: {
  data: FlowWorkspaceData; task: FlowTask | null; onSaved: (id: string) => void; onCancel: () => void
}) {
  // Preserve the original revision/deadline while editing; background reads must
  // not erase unsaved input or silently promote a stale form to a newer version.
  const [original] = useState(task)
  const [id] = useState(() => task?.id ?? crypto.randomUUID())
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [area, setArea] = useState(task?.area_id ?? '')
  const [deadline, setDeadline] = useState(() => task?.deadline_at ? toLocalDateTime(task.deadline_at) : '')
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ command: TaskCommand; draft: string[] } | null>(null)
  const disabled = !['idle', 'running', 'paused'].includes(data.phase)
  const currentTask = data.data?.current?.segments.find(s => s.ended_at === null)?.task_id
  const oldArea = data.catalog.areas.find(a => a.id === area)
  useEffect(() => {
    // A retry/status refresh may confirm an earlier save after this form's
    // original request returned. Navigate only if no newer draft was typed.
    if (submitted && !disabled && [title, description, area, deadline].every((value, i) => value === submitted.draft[i])
      && taskApplied(submitted.command, data.catalog.tasks)) onSaved(id)
  }, [submitted, disabled, title, description, area, deadline, data.catalog.tasks, id, onSaved])
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    try {
      const fields = taskFields(title, description, area, deadline, original?.deadline_at ?? undefined)
      const command: TaskCommand = { kind: 'save-task', taskId: id, expected: original?.updated_at ?? null, ...fields }
      setSubmitted({ command, draft: [title, description, area, deadline] })
      if (await data.dispatch(command)) onSaved(id)
    } catch (error) { setError(error instanceof Error ? error.message : 'Kontroller oppgaven.') }
  }
  return <form className="task-form" onSubmit={save}>
    <h3>{task ? 'Rediger oppgave' : 'Ny oppgave'}</h3>
    <fieldset disabled={disabled}><legend className="sr-only">Oppgavedetaljer</legend>
      <div className="auth-field"><label htmlFor="task-title">Tittel</label><input id="task-title" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="auth-field"><label htmlFor="task-area">Område (valgfritt)</label>
        <select id="task-area" value={area} disabled={currentTask === id} onChange={e => setArea(e.target.value)}>
          <option value="">Annet · uten område</option>
          {oldArea?.is_archived && <option value={oldArea.id}>{oldArea.name} · Arkivert</option>}
          {data.catalog.areas.filter(a => !a.is_archived).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {currentTask === id && <p className="timer-meta">Pause eller bytt aktivitet før du endrer området.</p>}
      </div>
      <div className="auth-field"><label htmlFor="task-description">Beskrivelse (valgfritt)</label><textarea id="task-description" rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="auth-field"><label htmlFor="task-deadline">Frist (valgfritt, lokal tid)</label>
        <input id="task-deadline" type="datetime-local" step="1" value={deadline} onChange={e => setDeadline(e.target.value)} aria-describedby="task-deadline-hint" />
        <p id="task-deadline-hint" className="timer-meta">Fristen følger klokkeslettet du velger, uavhengig av arbeidsdagens grense.</p>
        {deadline && <button type="button" className="text-button" onClick={() => setDeadline('')}>Fjern frist</button>}
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="subject-actions"><button type="submit">Lagre oppgave</button><button type="button" className="secondary-button" onClick={onCancel}>Avbryt</button></div>
    </fieldset>
  </form>
}
