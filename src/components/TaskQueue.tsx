import { useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import type { FlowTask } from '../types/flow'
import { startActivityCommand } from '../lib/flow-activity'
import { deadlineLabel } from '../lib/flow-tasks'
import { workRecommendations } from '../lib/flow-recommendations'


export default function TaskQueue({ data, onOpen, onCreate }: {
  data: FlowWorkspaceData; onOpen: (id: string | null, opener: HTMLElement) => void; onCreate: () => void
}) {
  const queue = workRecommendations(data.catalog, data.data?.current ?? null, data.phase, data.now)
  const [error, setError] = useState<string | null>(null)
  const ready = ['idle', 'running', 'paused'].includes(data.phase)
  const disabled = !ready || data.pending !== null || (!data.data?.current && !data.data?.next_boundary_at)
  const action = data.phase === 'running' ? 'Bytt til' : 'Start'
  async function start(task: FlowTask) {
    setError(null)
    try {
      await data.dispatch(startActivityCommand({ areaId: task.area_id, taskId: task.id }, data.data, data.catalog))
      const heading = document.getElementById('flow-timer-title')
      if (heading?.getClientRects().length) heading.focus()
    } catch (error) { setError(error instanceof Error ? error.message : 'Kunne ikke starte oppgaven.') }
  }
  function summary(task: FlowTask) {
    const area = data.catalog.areas.find(area => area.id === task.area_id)
    return <>
      <h4><button type="button" className="task-title" aria-controls="tasks-view"
        onClick={event => onOpen(task.id, event.currentTarget)}>{task.title}</button></h4>
      <p className="task-area">{area?.name ?? 'Annet'}</p>
      <p className="task-deadline">{deadlineLabel(task, data.now)}</p>
    </>
  }
  return <section className="dashboard-panel task-queue" aria-labelledby="task-queue-title">
    <header className="queue-heading"><div><p className="section-label">Fristbasert kø</p><h2 id="task-queue-title">Neste arbeid</h2></div>
      {ready && queue.overdueCount > 0 && <button type="button" className="text-button queue-overdue" aria-controls="tasks-view"
        aria-label={`${queue.overdueCount} ${queue.overdueCount === 1 ? 'forfalt oppgave' : 'forfalte oppgaver'} →`}
        title="Alle aktive oppgaver med passert frist, også i arkiverte områder."
        onClick={event => onOpen(null, event.currentTarget)}>{queue.overdueCount} {queue.overdueCount === 1 ? 'forfalt' : 'forfalte'} →</button>}
    </header>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!ready ? <p role="status">{data.phase === 'loading' ? 'Henter oppgaver …' : data.phase === 'recovering'
      ? 'Kontrollerer arbeidsstatus …' : 'Hent status ved timeren for å vise neste oppgave.'}</p> : <>
      {queue.next ? <>
        <section className={`queue-next${queue.next.deadline_at && Date.parse(queue.next.deadline_at) < data.now ? ' is-overdue' : ''}`} aria-labelledby="queue-next-title">
          <h3 id="queue-next-title">Neste</h3>{summary(queue.next)}
          <button type="button" disabled={disabled} aria-label={`${action} ${queue.next.title}`} onClick={() => void start(queue.next!)}>{action}</button>
        </section>
        {queue.later.length > 0 && <section className="queue-later" aria-labelledby="queue-later-title">
          <h3 id="queue-later-title">Etterpå</h3><ul>{queue.later.map(task => <li key={task.id}
            className={task.deadline_at && Date.parse(task.deadline_at) < data.now ? 'is-overdue' : undefined}>{summary(task)}</li>)}</ul>
        </section>}
        <p className="timer-meta">Forfalte først, så nærmeste frist og oppgaver uten frist.</p>
      </> : <p className="queue-empty">{queue.activeCount === 0 ? data.catalog.tasks.length ? 'Alle oppgavene er fullført.' : 'Du har ingen aktive oppgaver ennå.'
        : queue.now?.activity.taskId && queue.activeCount === 1 ? 'Ingen andre oppgaver akkurat nå.'
        : 'Ingen startbare oppgaver akkurat nå. Oppgaver i arkiverte eller utilgjengelige områder finnes fortsatt under Oppgaver.'}</p>}
    </>}
    <div className="queue-links">
      <button type="button" className="secondary-button" aria-controls="tasks-view" onClick={event => onOpen(null, event.currentTarget)}>Se alle oppgaver</button>
      <button type="button" className="text-button" aria-controls="tasks-view" disabled={!ready} onClick={onCreate}>{queue.next ? 'Ny oppgave' : 'Opprett oppgave'}</button>
    </div>
  </section>
}
