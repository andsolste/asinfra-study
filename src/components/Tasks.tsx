import { useEffect, useRef, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import { supabase } from '../lib/supabase'
import { deadlineLabel, taskDayTime } from '../lib/flow-tasks'
import { taskArea, taskOverview } from '../lib/flow-task-list'
import { createStatisticsApi } from '../lib/flow-statistics'
import type { FlowStatistics } from '../lib/flow-statistics'
import { formatDuration } from '../lib/study-sessions'
import TaskList, { TaskStart } from './TaskList'
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
  const area = taskArea(task, data.catalog)
  return <section className="task-details" aria-labelledby="task-detail-title">
    <h3 id="task-detail-title" tabIndex={-1}>{task.title}</h3>
    <p className="task-area">{area.name}{area.archived && ' · Arkivert område'}</p>
    <p>{task.status === 'active' ? 'Aktiv' : 'Fullført'} · {deadlineLabel(task, data.now)}</p>
    {task.description && <p className="task-description">{task.description}</p>}
    {area.unavailable && task.status === 'active' && <p className="task-attention">Området er {area.archived ? 'arkivert' : 'utilgjengelig'}. Flytt oppgaven til et aktivt område eller fjern området for å starte den. Oppgaven kan fortsatt redigeres og fullføres.</p>}
    <dl className="flow-day-metrics">
      {data.data?.current?.segments.some(s => s.task_id === id && s.ended_at === null) && <div><dt>Denne arbeidsperioden</dt><dd>{formatDuration(day.current)}</dd></div>}
      <div><dt>Oppgaven i dag</dt><dd>{data.data?.current ? formatDuration(day.work) : total ? formatDuration(total.task_today ?? 0) : error ? 'Utilgjengelig' : 'Henter …'}</dd></div>
      <div><dt>Oppgaven totalt</dt><dd>{total ? formatDuration(total.total) : error ? 'Utilgjengelig' : 'Henter …'}</dd></div>
    </dl>
    {total && <p className="timer-meta">Totalen ble kontrollert {new Date(total.server_time).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Pauser teller ikke.</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="subject-actions"><TaskStart data={data} task={task} />
      <button type="button" className="secondary-button" onClick={onEdit} disabled={!['idle', 'running', 'paused'].includes(data.phase)}>Rediger oppgave</button>
      <button type="button" className="text-button" disabled={!['idle', 'running', 'paused'].includes(data.phase)}
        onClick={() => void data.dispatch({ kind: 'status-task', taskId: id, expected: task.updated_at, status: task.status === 'active' ? 'completed' : 'active' })}>{task.status === 'active' ? 'Fullfør oppgave' : 'Gjenåpne oppgave'}</button>
    </div>
    <button type="button" className="text-button task-total-refresh" onClick={() => setReload(x => x + 1)}>Oppdater total</button>
  </section>
}

export default function Tasks({ data, initialId, request, onEditingChange }: {
  data: FlowWorkspaceData; initialId: string | null; request?: TaskRequest | null; onEditingChange?: (editing: boolean) => void
}) {
  const [selected, setSelected] = useState(initialId)
  const [editing, setEditing] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [areaFilter, setAreaFilter] = useState('all')
  const heading = useRef<HTMLHeadingElement | null>(null)
  function focusView(id: string | null) {
    requestAnimationFrame(() => (id ? document.getElementById('task-detail-title') : heading.current)?.focus())
  }
  useEffect(() => { if (request) {
    setSelected(request.id); setEditing(Boolean(request.create)); setFormVersion(version => version + 1)
    if (!request.create) focusView(request.id)
  } }, [request])
  useEffect(() => { onEditingChange?.(editing) }, [editing, onEditingChange])
  const { groups, completed, activeCount } = taskOverview(data.catalog.tasks, data.now, areaFilter)
  const missingAreas = [...new Set(data.catalog.tasks.map(task => task.area_id).filter((id): id is string => id !== null
    && !data.catalog.areas.some(area => area.id === id)))]
  const task = data.catalog.tasks.find(t => t.id === selected) ?? null
  function view(id: string | null) { setSelected(id); setEditing(false); focusView(id) }
  return <div className="tasks-panel">
    <FlowFeedback data={data} />
    {editing ? <TaskForm key={`${selected ?? 'new'}:${formVersion}`} data={data} task={task} onSaved={view} onCancel={() => view(selected)} />
      : selected ? <><button type="button" className="text-button" onClick={() => view(null)}>← Alle oppgaver</button>
        <TaskDetails id={selected} data={data} onEdit={() => setEditing(true)} /></>
      : <>
        <div className="tasks-toolbar">
          <button type="button" disabled={!['idle', 'running', 'paused'].includes(data.phase)} onClick={() => { setSelected(null); setEditing(true) }}>Ny oppgave</button>
          <div className="tasks-filter"><label htmlFor="tasks-area-filter">Vis område</label>
            <select id="tasks-area-filter" value={areaFilter} onChange={event => setAreaFilter(event.target.value)}>
              <option value="all">Alle områder</option><option value="none">Annet · uten område</option>
              {data.catalog.areas.map(area => <option key={area.id} value={area.id}>{area.name}{area.is_archived ? ' · Arkivert' : ''}</option>)}
              {missingAreas.map(id => <option key={id} value={id}>Utilgjengelig område</option>)}
            </select>
          </div>
        </div>
        <h3 id="tasks-list-title" className="sr-only" ref={heading} tabIndex={-1}>Aktive oppgaver ({activeCount})</h3>
        <p className="timer-meta">Frister viser når arbeidet må være ferdig, ikke når det er planlagt.</p>
        {data.phase === 'loading' && <p role="status">Henter oppgaver …</p>}
        {groups.filter(group => group.tasks.length > 0).map(group => <section key={group.id} className={`task-group task-group-${group.id}`} aria-labelledby={`tasks-${group.id}`}>
          <h3 id={`tasks-${group.id}`}>{group.title} <span>({group.tasks.length})</span></h3>
          <TaskList data={data} tasks={group.tasks} label={group.title} onDetails={view} />
        </section>)}
        {!activeCount && data.data && data.phase !== 'loading' && <p>{areaFilter === 'all' ? 'Du har ingen aktive oppgaver.' : 'Ingen aktive oppgaver i dette området.'}</p>}
        <details className="completed-tasks"><summary><h3>Fullførte oppgaver ({completed.length})</h3></summary>
          <TaskList data={data} tasks={completed} label="Fullførte oppgaver" onDetails={view} />
          {!completed.length && <p>Ingen fullførte oppgaver ennå.</p>}
        </details>
      </>}
  </div>
}
