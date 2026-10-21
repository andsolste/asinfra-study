import { useRef, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import type { FlowTask } from '../types/flow'
import { activityUsable } from '../lib/flow-work'
import { startActivityCommand } from '../lib/flow-activity'
import { deadlineLabel, taskQueue } from '../lib/flow-tasks'

export function TaskList({ data, tasks, onDetails, inPanel = false }: {
  data: FlowWorkspaceData; tasks: readonly FlowTask[]; onDetails: (id: string, opener: HTMLElement) => void; inPanel?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const list = useRef<HTMLUListElement | null>(null)
  const disabled = !['idle', 'running', 'paused'].includes(data.phase)
  const currentTask = data.data?.current?.segments.find(s => s.ended_at === null)?.task_id
  async function start(task: FlowTask) {
    setError(null)
    try { await data.dispatch(startActivityCommand({ areaId: task.area_id, taskId: task.id }, data.data, data.catalog)) }
    catch (error) { setError(error instanceof Error ? error.message : 'Kunne ikke starte oppgaven.') }
  }
  async function changeStatus(task: FlowTask) {
    await data.dispatch({ kind: 'status-task', taskId: task.id, expected: task.updated_at, status: task.status === 'active' ? 'completed' : 'active' })
    requestAnimationFrame(() => list.current?.focus())
  }
  return <>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <ul className="task-list" ref={list} tabIndex={-1} aria-label="Oppgaver">{tasks.map(task => {
      const area = data.catalog.areas.find(a => a.id === task.area_id)
      const overdue = task.status === 'active' && task.deadline_at !== null && Date.parse(task.deadline_at) < data.now
      const usable = activityUsable({ areaId: task.area_id, taskId: task.id }, data.catalog)
      return <li key={task.id} className={overdue ? 'task-row is-overdue' : 'task-row'}>
        <div className="task-summary"><p className="task-area">{area?.name ?? (task.area_id ? 'Utilgjengelig område' : 'Annet')}{area?.is_archived && ' · Arkivert område'}</p>
          <h3><button type="button" className="task-title" aria-controls={inPanel ? undefined : 'tasks-view'}
            onClick={event => onDetails(task.id, event.currentTarget)}>{task.title}</button></h3>
          <p className="task-deadline">{task.status === 'completed' ? `Fullført ${new Date(task.completed_at).toLocaleDateString('nb-NO')}` : deadlineLabel(task, data.now)}</p>
        </div>
        <div className="task-actions">
          {task.status === 'active' && <button type="button" className="secondary-button" disabled={disabled || !usable || currentTask === task.id}
            aria-label={`Start ${task.title}`} onClick={() => void start(task)}>{currentTask === task.id ? 'Pågår' : 'Start'}</button>}
          <button type="button" className="text-button" disabled={disabled} aria-label={`${task.status === 'active' ? 'Fullfør' : 'Gjenåpne'} ${task.title}`}
            onClick={() => void changeStatus(task)}>
            {task.status === 'active' ? 'Fullfør' : 'Gjenåpne'}</button>
        </div>
      </li>
    })}</ul>
  </>
}

export default function TaskQueue({ data, onOpen }: {
  data: FlowWorkspaceData; onOpen: (id: string | null, opener: HTMLElement) => void
}) {
  const tasks = taskQueue(data.catalog.tasks, data.now)
  return <section className="dashboard-panel task-queue" aria-labelledby="task-queue-title">
    <header className="panel-heading"><div><p className="section-label">Neste arbeid</p><h2 id="task-queue-title">Oppgavekø</h2></div></header>
    <p className="timer-meta">Forfalte først, deretter nærmeste frist og oppgaver uten frist.</p>
    {data.phase === 'loading' ? <p role="status">Henter oppgaver …</p> : <>
      <TaskList data={data} tasks={tasks.slice(0, 5)} onDetails={onOpen} />
      {!tasks.length && <p>{!data.data ? 'Hent status for å vise oppgavekøen.' : data.catalog.tasks.length ? 'Alle oppgavene er fullført.' : 'Du har ingen aktive oppgaver ennå.'}</p>}
    </>}
    <button type="button" className="secondary-button" aria-controls="tasks-view"
      onClick={event => onOpen(null, event.currentTarget)}>{tasks.length ? 'Se alle oppgaver' : 'Opprett oppgave'}</button>
  </section>
}
