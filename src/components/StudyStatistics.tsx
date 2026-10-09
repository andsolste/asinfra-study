import { useMemo } from 'react'
import type { useStudyHistory } from '../hooks/useStudyHistory'
import { changePeriodKind, localPeriod, periodLabel, shiftPeriod, summarizeStatistics } from '../lib/statistics'
import type { PeriodKind } from '../lib/statistics'
import { formatDuration } from '../lib/study-sessions'
import StatisticsChart, { StatisticsLegend, StatisticsTable } from './StatisticsChart'

const kinds: { kind: PeriodKind; label: string; current: string; unit: string }[] = [
  { kind: 'day', label: 'Dag', current: 'I dag', unit: 'dag' },
  { kind: 'week', label: 'Uke', current: 'Denne uken', unit: 'uke' },
  { kind: 'month', label: 'Måned', current: 'Denne måneden', unit: 'måned' },
]

export default function StudyStatistics({ data }: { data: ReturnType<typeof useStudyHistory> }) {
  const busy = data.mutation !== null
  const period = data.period
  const selected = kinds.find(value => value.kind === period.kind)!
  const totals = useMemo(() => summarizeStatistics(data.statisticsRows, period), [data.statisticsRows, period])
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return <section className="dashboard-panel statistics-panel" aria-labelledby="statistics-title" aria-busy={data.statisticsStatus === 'loading'}>
    <header className="panel-heading"><div><p className="section-label">Faktisk studiearbeid</p><h2 id="statistics-title">Arbeidstid</h2></div>
      <div className="statistics-kinds" role="group" aria-label="Statistikkperiode">
        {kinds.map(value => <button key={value.kind} type="button" className="secondary-button" aria-pressed={value.kind === period.kind}
          disabled={busy} onClick={() => void data.selectPeriod(changePeriodKind(period, value.kind))}>{value.label}</button>)}
      </div>
    </header>
    <div className="statistics-period">
      <p className="statistics-period-label" aria-live="polite">{periodLabel(period)}</p>
      <div className="statistics-period-controls" role="group" aria-label="Velg periode">
        <button type="button" className="secondary-button" aria-label={`Forrige ${selected.unit}`} disabled={busy} onClick={() => void data.selectPeriod(shiftPeriod(period, -1))}>←</button>
        <button type="button" className="secondary-button" aria-pressed={period.from === localPeriod(period.kind).from} disabled={busy} onClick={() => void data.selectPeriod(localPeriod(period.kind))}>{selected.current}</button>
        <button type="button" className="secondary-button" aria-label={`Neste ${selected.unit}`} disabled={busy} onClick={() => void data.selectPeriod(shiftPeriod(period, 1))}>→</button>
      </div>
    </div>
    <p className="timer-meta">{zone || 'Lokal tidssone'} · Kun ferdige økter · Pauser er ikke arbeidstid</p>
    {data.statisticsStatus === 'loading' && <p className="statistics-state" role="status">Henter statistikk …</p>}
    {data.statisticsError && <div role="alert"><p className="auth-error">{data.statisticsError}</p>
      <button type="button" className="text-button" disabled={busy} onClick={() => void data.selectPeriod(period)}>Prøv igjen</button></div>}
    {data.statisticsStatus === 'ready' && <>
      <dl className="statistics-summary">
        <div className="statistics-total"><dt>Total arbeidstid</dt><dd>{formatDuration(totals.total)}</dd></div>
        <div><dt>Mest studert fag</dt><dd>{totals.mostStudied ? <>{totals.mostStudied.code ?? totals.mostStudied.name}<span>{formatDuration(totals.mostStudied.work)}</span></> : 'Ingen ennå'}</dd></div>
        {period.kind !== 'day' && <div><dt>Mest aktive dag</dt><dd>{totals.busiestDay ? <>{new Date(totals.busiestDay.from).toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}<span>{formatDuration(totals.busiestDay.total)}</span></> : 'Ingen ennå'}</dd></div>}
      </dl>
      {!totals.total && <p className="statistics-state">Ingen registrert arbeidstid i denne perioden.</p>}
      {period.kind !== 'day' || totals.total > 0 ? <StatisticsChart summary={totals} period={period} /> : null}
      {totals.subjects.length > 0 && <StatisticsLegend subjects={totals.subjects} />}
      <StatisticsTable summary={totals} period={period} />
    </>}
  </section>
}
