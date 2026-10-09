import type { useStudyHistory } from '../hooks/useStudyHistory'
import { localWeek, shiftWeek, weekLabel } from '../lib/history-time'
import { summarizeWeek } from '../lib/study-history'
import { formatDuration } from '../lib/study-sessions'

export default function StudyStatistics({ data }: { data: ReturnType<typeof useStudyHistory> }) {
  const busy = data.mutation !== null
  const totals = summarizeWeek(data.weekRows, data.week)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return <section className="dashboard-panel week-panel" aria-labelledby="week-title" aria-busy={data.weekStatus === 'loading'}>
    <header className="panel-heading"><div><p className="section-label">Denne perioden</p><h2 id="week-title">Ukestatistikk</h2></div></header>
    <p className="week-label">{weekLabel(data.week)}</p>
    <p className="timer-meta">Mandag til søndag · {zone || 'Lokal tidssone'} · Kun ferdige økter</p>
    <div className="week-controls" role="group" aria-label="Velg uke">
      <button type="button" className="secondary-button" aria-label="Forrige uke" disabled={busy} onClick={() => void data.selectWeek(shiftWeek(data.week, -1))}>←</button>
      <button type="button" className="secondary-button" aria-pressed={data.week.from === localWeek().from} disabled={busy} onClick={() => void data.selectWeek(localWeek())}>Denne uken</button>
      <button type="button" className="secondary-button" aria-label="Neste uke" disabled={busy} onClick={() => void data.selectWeek(shiftWeek(data.week, 1))}>→</button>
    </div>
    {data.weekStatus === 'loading' && <p role="status">Henter ukestatistikk …</p>}
    {data.weekError && <div role="alert"><p className="auth-error">{data.weekError}</p>
      <button type="button" className="text-button" disabled={busy} onClick={() => void data.selectWeek(data.week)}>Prøv igjen</button></div>}
    {data.weekStatus === 'ready' && <div className="week-summary">
      <dl><div className="week-total"><dt>Total arbeidstid</dt><dd>{formatDuration(totals.total)}</dd></div>
        {totals.subjects.map(subject => <div key={subject.id ?? 'none'}>
          <dt>{subject.code && <span className="subject-code">{subject.code} · </span>}{subject.name}</dt>
          <dd>{formatDuration(subject.work)}</dd>
        </div>)}</dl>
      {!totals.total && <p>Ingen registrert arbeidstid denne uken.</p>}
    </div>}
  </section>
}
