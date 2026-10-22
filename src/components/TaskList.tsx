import { useRef, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import type { FlowTask } from '../types/flow'
import { activityUsable } from '../lib/flow-work'
import { startActivityCommand } from '../lib/flow-activity'
import { deadlineLabel, taskOverdue } from '../lib/flow-tasks'
import { taskArea } from '../lib/flow-task-list'

export function TaskStart({ data, task }: { data: FlowWorkspaceData; task: FlowTask }) {
  const [error, setError] = useState<string | null>(null)
  const status = useRef<HTMLSpanElement | null>(null)
  const current = data.data?.current?.segments.find(segment => segment.ended_at === null)?.task_id === task.id
  const usable = activityUsable({ areaId: task.area_id, taskId: task.id }, data.catalog)
  const action = data.phase === 'running' ? 'Bytt til' : 'Start'
  if (task.status !== 'active') return null
  if (current) return <span className="task-running" role="status" tabIndex={-1} ref={status}>Pågår</span>
  if (!usable) return null
  return <>
    <button type="button" className="secondary-button" aria-label={`${action} ${task.title}`}
      disabled={!['idle', 'running', 'paused'].includes(data.phase) || data.pending !== null || (!data.data?.current && !data.data?.next_boundary_at)}
      onClick={async event => {
        const opener = event.currentTarget
        setError(null)
        try {
          await data.dispatch(startActivityCommand({ areaId: task.area_id, taskId: task.id }, data.data, data.catalog))
          requestAnimationFrame(() => {
            // Start becomes a status label. Keep keyboard context without stealing
            // focus if the user navigated or moved to another control meanwhile.
            if ((document.activeElement === opener || document.activeElement === document.body)
              && status.current?.getClientRects().length) status.current.focus()
          })
        }
        catch (error) { setError(error instanceof Error ? error.message : 'Kunne ikke starte oppgaven.') }
      }}>{action}</button>
    {error && <p className="auth-error" role="alert">{error}</p>}
  </>
}

export default function TaskList({ data, tasks, onDetails, label }: {
  data: FlowWorkspaceData; tasks: readonly FlowTask[]; onDetails: (id: string) => void; label: string
}) {
  const list = useRef<HTMLUListElement | null>(null)
  const disabled = !['idle', 'running', 'paused'].includes(data.phase) || data.pending !== null
  return <ul className="task-list" ref={list} tabIndex={-1} aria-label={label}>{tasks.map(task => {
    const area = taskArea(task, data.catalog)
    return <li key={task.id} className={`task-row${taskOverdue(task, data.now) ? ' is-overdue' : ''}`}>
      <div className="task-summary">
        <h4><button type="button" className="task-title" onClick={() => onDetails(task.id)}>{task.title}</button></h4>
        <div className="task-metadata"><p className="task-area">{area.name}{area.archived && ' · Arkivert område'}</p>
          <p className="task-deadline">{task.status === 'completed' ? `Fullført ${new Date(task.completed_at!).toLocaleDateString('nb-NO')}` : deadlineLabel(task, data.now)}</p></div>
      </div>
      <div className="task-actions">
        <TaskStart data={data} task={task} />
        <button type="button" className="text-button" disabled={disabled}
          aria-label={`${task.status === 'active' ? 'Fullfør' : 'Gjenåpne'} ${task.title}`}
          onClick={async () => {
            await data.dispatch({ kind: 'status-task', taskId: task.id, expected: task.updated_at, status: task.status === 'active' ? 'completed' : 'active' })
            requestAnimationFrame(() => (list.current ?? document.getElementById('tasks-list-title'))?.focus())
          }}>{task.status === 'active' ? 'Fullfør' : 'Gjenåpne'}</button>
      </div>
    </li>
  })}</ul>
}
