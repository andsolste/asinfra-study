import { useRef, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import type { FlowTask } from '../types/flow'
import { currentWeek, moveToWeek, priorityLabels, shiftWeek, weeklyTasks, weekLabel, weekRange } from '../lib/task-planning'
import { taskArea } from '../lib/flow-task-list'
import { TaskStart as StartTask } from './TaskList'

export default function WeeklyTasks({ data, onOpen }: { data: FlowWorkspaceData; onOpen: (id: string | null) => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const current = currentWeek(data.now), week = selected ?? current
  const disabled = !['idle', 'running', 'paused'].includes(data.phase) || data.pending !== null
  const plan = week ? weeklyTasks(data.catalog.tasks, week) : null

  function changeWeek(next: string | null) { setSelected(next); setMessage(null) }
  async function move(task: FlowTask) {
    if (!week) return
    setMessage(null)
    const saved = await data.dispatch(moveToWeek(task, week))
    setMessage(saved ? `«${task.title}» er flyttet til ${weekLabel(week).toLowerCase()}.`
      : 'Flytting er ikke bekreftet. Kontroller status ved timeren før du prøver igjen.')
    // The moved row disappears from Previous weeks. Keep a visible focus target.
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
  }
  return <section className="dashboard-panel weekly-tasks" aria-labelledby="weekly-title" aria-busy={data.phase === 'recovering'}>
    <header className="queue-heading"><div><p className="section-label">Ukeplan</p>
      <h2 id="weekly-title" tabIndex={-1} ref={heading}>{week === current ? 'Denne uken' : week ? weekLabel(week) : 'Denne uken'}</h2>
      {week && <p className="timer-meta">{week === current && `${weekLabel(week)} · `}{weekRange(week)}</p>}
    </div></header>
    <nav className="weekly-navigation" aria-label="Velg planleggingsuke">
      <button type="button" className="secondary-button" disabled={disabled || !week} aria-label="Forrige planleggingsuke"
        onClick={() => week && changeWeek(shiftWeek(week, -1))}>← Forrige</button>
      <button type="button" className="text-button" disabled={disabled || !current} onClick={() => changeWeek(null)}>Denne uken</button>
      <button type="button" className="secondary-button" disabled={disabled || !week} aria-label="Neste planleggingsuke"
        onClick={() => week && changeWeek(shiftWeek(week, 1))}>Neste →</button>
    </nav>
    {data.phase === 'error' && data.data && <p className="timer-meta" role="status">Viser siste bekreftede ukeplan. Hent status ved timeren før du gjør endringer.</p>}
    {!data.data || !plan ? <p role="status">{data.phase === 'error' ? 'Hent status ved timeren for å vise ukeplanen.' : 'Henter ukeplan …'}</p> : <>
      <div className="weekly-progress"><p role="status">{plan.completed} av {plan.total} fullført</p>
        <progress value={plan.completed} max={Math.max(1, plan.total)} aria-label="Fullførte oppgaver i valgt uke" />
      </div>
      {plan.total ? <ul className="weekly-list" aria-label="Oppgaver i valgt uke">{plan.tasks.map(task => <li key={task.id} className={task.status === 'completed' ? 'is-completed' : undefined}>
        <div className="weekly-summary"><button type="button" className="task-title" onClick={() => onOpen(task.id)}>{task.title}</button>
          <p className="task-area">{taskArea(task, data.catalog).name} · {priorityLabels[task.priority]} prioritet</p>
        </div>
        <div className="weekly-actions"><StartTask data={data} task={task} />
          <button type="button" className="text-button" disabled={disabled} aria-label={`${task.status === 'active' ? 'Fullfør' : 'Gjenåpne'} ${task.title}`}
            onClick={() => void data.dispatch({ kind: 'status-task', taskId: task.id, expected: task.updated_at, status: task.status === 'active' ? 'completed' : 'active' })}>
            {task.status === 'completed' ? 'Gjenåpne' : 'Fullfør'}</button>
          {task.status === 'completed' && <span className="timer-meta">Fullført</span>}
        </div>
      </li>)}</ul> : <p className="timer-meta">Ingen oppgaver planlagt denne uken. Velg uke når du oppretter eller redigerer en oppgave.</p>}
      <details className="weekly-previous"><summary>Ufullført fra tidligere uker ({plan.previous.length})</summary>
        <p className="timer-meta">Flyttes bare når du velger det. Frist, prioritet og oppgavestatus beholdes.</p>
        <ul className="weekly-list" aria-label="Ufullførte oppgaver fra tidligere uker">{plan.previous.map(task => <li key={task.id}>
          <div className="weekly-summary"><button type="button" className="task-title" onClick={() => onOpen(task.id)}>{task.title}</button>
            <p className="task-area">{weekLabel(task.week_start!)} · {priorityLabels[task.priority]} prioritet</p></div>
          <button type="button" className="secondary-button" disabled={disabled} aria-label={`Flytt ${task.title} til valgt uke`} onClick={() => void move(task)}>Flytt hit</button>
        </li>)}</ul>
        {!plan.previous.length && <p className="timer-meta">Ingen ufullførte oppgaver fra tidligere uker.</p>}
      </details>
      <button type="button" className="text-button" onClick={() => onOpen(null)}>Planlegg under Oppgaver →</button>
    </>}
    {message && <p role="status">{message}</p>}
    <p className="timer-meta weekly-policy">Uken følger lokal kalender, mandag–søndag. Oppgaver uten uke finnes som før under Oppgaver.</p>
  </section>
}
