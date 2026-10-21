import { useEffect, useRef, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import { supabase } from '../lib/supabase'
import { deadlineLabel, taskDayTime, taskQueue } from '../lib/flow-tasks'
import { createStatisticsApi } from '../lib/flow-statistics'
import type { FlowStatistics } from '../lib/flow-statistics'
import { formatDuration } from '../lib/study-sessions'
import { TaskList } from './TaskQueue'
import TaskForm from './TaskForm'
import FlowFeedback from './FlowFeedback'

export type TaskRequest = { id: string | null; create?: boolean }

function TaskDetails({ id, data, onEdit }: { id: string; data: FlowWorkspaceData; onEdit: () => void }) {
  const [total, setTotal] = useState<FlowStatistics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const task = data.catalog.tasks.find(t => t.id === id)
  useEffect(() => {
    const controller = new AbortController()
    setTotal(null); setError(null)
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    let active = true
    void createStatisticsApi(supabase!).statistics({ kind: 'total', anchor: null }, null, controller.signal, id).then(value => { if (active) setTotal(value) })
      .catch(() => { if (active) setError('Kunne ikke hente total oppgavetid.') }).finally(() => clearTimeout(timeout))
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [id, data.data, reload])
  if (!task) return <p>Oppgaven er ikke tilgjengelig. Hent status på nytt.</p>
  const day = taskDayTime(data.data?.current ?? null, id, data.now)
  const area = data.catalog.areas.find(a => a.id === task.area_id)
  return <section className="task-details" aria-labelledby="task-detail-title">
    <h3 id="task-detail-title">{task.title}</h3>
    <p className="task-area">{area?.name ?? 'Annet'}{area?.is_archived && ' · Arkivert område'}</p>
    <p>{task.status === 'active' ? 'Aktiv' : 'Fullført'} · {deadlineLabel(task, data.now)}</p>
    {task.description && <p className="task-description">{task.description}</p>}
    {area?.is_archived && task.status === 'active' && <p>Flytt oppgaven til et aktivt område eller fjern området for å starte den.</p>}
    <dl className="flow-day-metrics">
      {data.data?.current?.segments.some(s => s.task_id === id && s.ended_at === null) && <div><dt>Denne arbeidsperioden</dt><dd>{formatDuration(day.current)}</dd></div>}
      <div><dt>Oppgaven i dag</dt><dd>{data.data?.current ? formatDuration(day.work) : total ? formatDuration(total.task_today ?? 0) : error ? 'Utilgjengelig' : 'Henter …'}</dd></div>
      <div><dt>Oppgaven totalt</dt><dd>{total ? formatDuration(total.total) : error ? 'Utilgjengelig' : 'Henter …'}</dd></div>
    </dl>
    {total && <p className="timer-meta">Totalen ble kontrollert {new Date(total.server_time).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Pauser teller ikke.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="subject-actions"><button type="button" onClick={onEdit} disabled={!['idle', 'running', 'paused'].includes(data.phase)}>Rediger oppgave</button>
      <button type="button" className="secondary-button" onClick={() => setReload(x => x + 1)}>Oppdater total</button>
      <button type="button" className="text-button" disabled={!['idle', 'running', 'paused'].includes(data.phase)}
        onClick={() => void data.dispatch({ kind: 'status-task', taskId: id, expected: task.updated_at, status: task.status === 'active' ? 'completed' : 'active' })}>{task.status === 'active' ? 'Fullfør oppgave' : 'Gjenåpne oppgave'}</button>
    </div>
  </section>
}

export default function Tasks({ data, initialId, request, onEditingChange }: {
  data: FlowWorkspaceData; initialId: string | null; request?: TaskRequest | null; onEditingChange?: (editing: boolean) => void
}) {
  const [selected, setSelected] = useState(initialId)
  const [editing, setEditing] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const heading = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => { if (request) { setSelected(request.id); setEditing(Boolean(request.create)); setFormVersion(version => version + 1) } }, [request])
  useEffect(() => { onEditingChange?.(editing) }, [editing, onEditingChange])
  const tasks = taskQueue(data.catalog.tasks, data.now)
  const completed = data.catalog.tasks.filter(t => t.status === 'completed').sort((a, b) =>
    Date.parse(b.completed_at!) - Date.parse(a.completed_at!) || a.id.localeCompare(b.id))
  const task = data.catalog.tasks.find(t => t.id === selected) ?? null
  function view(id: string | null) { setSelected(id); setEditing(false); requestAnimationFrame(() => heading.current?.focus()) }
  return <div className="tasks-panel">
    <h3 className="sr-only" ref={heading} tabIndex={-1}>Oppgavevisning</h3>
    <FlowFeedback data={data} />
    {editing ? <TaskForm key={`${selected ?? 'new'}:${formVersion}`} data={data} task={task} onSaved={view} onCancel={() => setEditing(false)} />
      : selected ? <><button type="button" className="text-button" onClick={() => view(null)}>← Alle oppgaver</button>
        <TaskDetails id={selected} data={data} onEdit={() => setEditing(true)} /></>
      : <>
        <button type="button" disabled={!['idle', 'running', 'paused'].includes(data.phase)} onClick={() => { setSelected(null); setEditing(true) }}>Ny oppgave</button>
        <p className="timer-meta">Forfalte først, så nærmeste frist. Uten frist sorteres etter opprettelse.</p>
        <TaskList data={data} tasks={tasks} inPanel onDetails={id => view(id)} />
        {!tasks.length && <p>Du har ingen aktive oppgaver.</p>}
        <details className="completed-tasks"><summary>Fullførte oppgaver ({completed.length})</summary>
          <TaskList data={data} tasks={completed} inPanel onDetails={id => view(id)} />
          {!completed.length && <p>Ingen fullførte oppgaver ennå.</p>}
        </details>
      </>}
  </div>
}
