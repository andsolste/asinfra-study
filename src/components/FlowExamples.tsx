import { publicWeekExample } from '../lib/public-flow-example'
import { formatDuration } from '../lib/study-sessions'
import StatisticsChart, { StatisticsLegend } from './StatisticsChart'

// Illustrations only: no session props, data hooks, effects, timers or app actions.
export function TimerExample() {
  return <figure className="public-demo public-timer" aria-labelledby="timer-example-caption">
    <figcaption id="timer-example-caption" className="public-example-label">Statisk eksempel · ingen tid registreres</figcaption>
    <div className="panel-heading"><p className="section-label">Arbeid i dag</p><p className="timer-status is-running">Arbeider · eksempel</p></div>
    <p className="public-demo-clock"><strong className="clock-value">3 t 18 min</strong><span className="clock-label">Faktisk arbeidstid, uten pauser</span></p>
    <div className="public-demo-activity"><p className="section-label">Jobber med</p><h3>Nettverk</h3><p>Forbered lab</p></div>
    <dl className="public-period"><div><dt>Nåværende arbeidsperiode</dt><dd>37 min</dd></div></dl>
    <div className="public-illustrative-controls" aria-hidden="true"><span>Bytt aktivitet</span><span>Pause</span></div>
    <p className="timer-meta">Kontrollene er kun en illustrasjon.</p>
  </figure>
}

export function TasksExample() {
  return <figure className="public-demo" aria-labelledby="tasks-example-caption">
    <figcaption id="tasks-example-caption" className="public-example-label">Statisk eksempel · oppgavekø</figcaption>
    <ul className="public-task-list">
      <li><p className="task-area">Nettverk</p><h3>Forbered lab</h3><p className="task-deadline">I morgen · Aktiv</p></li>
      <li><p className="task-area">Operativsystemer</p><h3>Les om prosesser</h3><p className="task-deadline">Fredag · Aktiv</p></li>
      <li><p className="task-area">Prosjekt</p><h3>Dokumenter løsningen</h3><p className="task-deadline">Fullført</p></li>
    </ul>
    <p className="timer-meta">Du kan også arbeide med Annet, uten eget område eller oppgave.</p>
  </figure>
}

export function StatisticsExample() {
  return <div className="public-demo public-statistics" aria-label="Statisk statistikkeksempel">
    <p className="public-example-label">Konstruerte eksempeltall · 12.–18. oktober</p>
    <dl className="public-week-total"><div><dt>Arbeid denne uken</dt><dd>{formatDuration(publicWeekExample.total)}</dd></div></dl>
    <StatisticsChart summary={publicWeekExample} period={publicWeekExample.period}
      description="Konstruerte eksempeltall, ikke brukerdata. Daglige summer vises under Vis tallgrunnlag, og områdelisten viser eksakt tid per område." />
    <StatisticsLegend subjects={publicWeekExample.areas} />
    <details className="statistics-data"><summary>Vis tallgrunnlag</summary>
      <dl className="public-day-totals">{publicWeekExample.days.map(day => <div key={day.date}><dt>{day.label}</dt><dd>{formatDuration(day.total)}</dd></div>)}</dl>
    </details>
  </div>
}

export function HistoryExample() {
  return <figure className="public-demo" aria-labelledby="history-example-caption">
    <figcaption id="history-example-caption" className="public-example-label">Statisk eksempel · en tidligere arbeidsdag</figcaption>
    <div className="panel-heading"><h3>18. oktober</h3><p className="public-history-total">Arbeidstid <strong>2 t 55 min</strong></p></div>
    <ol className="public-history-list">
      <li><span>08:35 → 09:42</span><strong>Nettverk</strong></li>
      <li className="public-pause"><span>09:42 → 10:03</span><span>Pause · teller ikke</span></li>
      <li><span>10:03 → 11:18</span><strong>Operativsystemer</strong></li>
      <li><span>11:18 → 11:51</span><strong>Prosjekt</strong></li>
    </ol>
  </figure>
}
