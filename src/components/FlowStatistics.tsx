import { useEffect, useRef, useState } from 'react'
import type { FlowHistoryData } from '../hooks/useFlowHistory'
import { changeFlowKind, currentPeriod, dateLabel, flowPeriodLabel, periodDates, shiftFlowPeriod } from '../lib/flow-statistics'
import type { PeriodKind } from '../lib/flow-statistics'
import type { FlowCatalog } from '../lib/flow-work'
import { formatDuration } from '../lib/study-sessions'
import StatisticsChart, { StatisticsLegend, StatisticsTable } from './StatisticsChart'

const kinds: { kind: PeriodKind; label: string; current?: string; unit?: string }[] = [
  { kind: 'day', label: 'Dag', current: 'I dag', unit: 'dag' }, { kind: 'week', label: 'Uke', current: 'Denne uken', unit: 'uke' },
  { kind: 'month', label: 'Måned', current: 'Denne måneden', unit: 'måned' }, { kind: 'total', label: 'Totalt' },
]
export default function FlowStatistics({ data, catalog }: { data: FlowHistoryData; catalog: FlowCatalog }) {
  const busy = data.mutation !== null, period = data.period, totals = data.statistics
  const selected = kinds.find(value => value.kind === period.kind)!
  const [zone, setZone] = useState(data.timezone ?? '')
  const heading = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => setZone(data.timezone ?? ''), [data.timezone])
  function area(id: string | null | undefined) { void data.selectArea(id); requestAnimationFrame(() => heading.current?.focus()) }
  const activeArea = data.selectedArea
  const metadata = activeArea ? catalog.areas.find(a => a.id === activeArea.id) : null
  const areaName = metadata?.name ?? (activeArea?.id ? 'Utilgjengelig område' : 'Annet')
  return <section className="dashboard-panel statistics-panel" aria-labelledby="statistics-title" aria-busy={activeArea ? data.areaStatus === 'loading' : data.statisticsStatus === 'loading'}>
    <header className="panel-heading"><div><p className="section-label">Faktisk arbeid</p><h2 id="statistics-title" ref={heading} tabIndex={-1}>{activeArea ? areaName : 'Arbeidstid'}</h2></div>
      {!activeArea && <div className="statistics-kinds" role="group" aria-label="Statistikkperiode">{kinds.map(value => <button key={value.kind} type="button" className="secondary-button" aria-pressed={value.kind === period.kind}
        disabled={busy} onClick={() => void data.selectPeriod(period.kind === 'total' ? { kind: value.kind, anchor: null } : changeFlowKind(period, value.kind, data.now(), data.timezone, totals?.task_date))}>{value.label}</button>)}</div>}
    </header>
    {activeArea && <><button type="button" className="text-button" onClick={() => area(undefined)}>← Samlet statistikk</button><p className="task-area">{metadata?.code}{metadata?.code ? ' · ' : ''}{metadata?.is_archived ? 'Arkivert område' : 'Område'}</p></>}
    <details className="statistics-policy"><summary>Tidssoner og gruppering</summary>
      <p>Native Flow-dager bruker lagret dato og tidssone. Eldre registreringer mangler lagret tidssone og grupperes etter visningstidssonen nedenfor, med dagsgrense kl. 04:00. Dette beskriver visningen, ikke opprinnelig registreringstidssone. Totalt er uavhengig av tidssone.</p>
      <form className="statistics-zone" onSubmit={event => { event.preventDefault(); void data.setTimezone(zone.trim() || null) }}>
        <div className="auth-field"><label htmlFor="statistics-zone">Visningstidssone for eldre registreringer</label><input id="statistics-zone" value={zone} placeholder="IANA-tidssone" onChange={e => setZone(e.target.value)} /></div>
        <button type="submit" className="secondary-button" disabled={busy}>Bruk tidssone</button>
      </form>
    </details>
    {activeArea ? <>
      {data.areaStatus === 'loading' && <p role="status">Henter områdestatistikk …</p>}
      {data.areaError && <div role="alert"><p>{data.areaError}</p><button type="button" onClick={() => area(activeArea.id)}>Prøv igjen</button></div>}
      {data.areaStatus === 'ready' && data.area && <>
        {(!data.area.day || data.area.day.legacy_timezone_error) && <p role="alert">Eldre arbeid kunne ikke grupperes. Velg en gyldig visningstidssone. Native data og totalen beholdes.</p>}
        <dl className="flow-area-metrics">{kinds.map(value => <div key={value.kind}><dt>{value.current ?? 'Totalt'}</dt><dd>{data.area![value.kind] ? formatDuration(data.area![value.kind]!.total) : 'Velg tidssone'}</dd></div>)}</dl>
        <h3>Oppgaver og arbeid</h3><p className="timer-meta">All registrert tid i dette området. Tid følger området som var lagret på hver arbeidsperiode.</p>
        <ul className="area-contributions">{data.area.total.contributions.map(c => <li key={`${c.source}:${c.task_id ?? 'none'}`}>
          <span>{c.task_id ? c.title ?? 'Utilgjengelig oppgave' : c.source === 'legacy-study' ? 'Uten oppgave / eldre registrering' : 'Uten oppgave'}{c.status === 'completed' && <small> · Fullført</small>}</span><strong>{formatDuration(c.work)}</strong>
        </li>)}</ul>
        {!data.area.total.total && <p>Ingen registrert arbeidstid i dette området.</p>}
        <p className="timer-meta">Kontrollert {new Date(data.area.total.server_time).toLocaleTimeString('nb-NO')}. Pauser teller ikke.</p>
        <button type="button" className="text-button" onClick={() => area(activeArea.id)}>Oppdater område</button>
      </>}
    </> : <>
      <div className="statistics-period"><p className="statistics-period-label" aria-live="polite">{flowPeriodLabel(period)}</p>
        {period.kind !== 'total' && <div className="statistics-period-controls" role="group" aria-label="Velg periode">
          <button type="button" className="secondary-button" aria-label={`Forrige ${selected.unit}`} disabled={busy || !period.anchor} onClick={() => void data.selectPeriod(shiftFlowPeriod(period, -1))}>←</button>
          <button type="button" className="secondary-button" aria-pressed={periodDates(period)?.from === periodDates(totals?.task_date ? { kind: period.kind, anchor: totals.task_date } : currentPeriod(period.kind, data.now(), data.timezone))?.from} disabled={busy} onClick={() => void data.selectPeriod({ kind: period.kind, anchor: null })}>{selected.current}</button>
          <button type="button" className="secondary-button" aria-label={`Neste ${selected.unit}`} disabled={busy || !period.anchor} onClick={() => void data.selectPeriod(shiftFlowPeriod(period, 1))}>→</button>
        </div>}
      </div>
      <p className="timer-meta">Logiske Flow-datoer · kl. 04:00 til neste kl. 04:00 · Pauser teller ikke</p>
      <button type="button" className="text-button" disabled={busy} onClick={() => void data.selectPeriod(period)}>Hent statistikk på nytt</button>
      {data.statisticsStatus === 'loading' && <p className="statistics-state" role="status">Henter statistikk …</p>}
      {data.statisticsError && <div role="alert"><p className="auth-error">{data.statisticsError}</p><button type="button" disabled={busy} onClick={() => void data.selectPeriod(period)}>Prøv igjen</button></div>}
      {data.statisticsStatus === 'ready' && totals && <>
        {totals.legacy_timezone_error && <p role="alert">Eldre registreringer kunne ikke grupperes i denne tidssonen. Velg en gyldig IANA-tidssone under Tidssoner og gruppering. Native Flow-data vises fortsatt; Totalt inkluderer begge kilder.</p>}
        <dl className="statistics-summary"><div className="statistics-total"><dt>Total arbeidstid</dt><dd>{formatDuration(totals.total)}</dd></div>
          <div><dt>Mest aktive område</dt><dd>{totals.mostActive ? <><button type="button" className="statistics-area-link" onClick={() => area(totals.mostActive!.id)}>{totals.mostActive.code ?? totals.mostActive.name}</button><span>{formatDuration(totals.mostActive.work)}</span></> : 'Ingen ennå'}</dd></div>
          {(period.kind === 'week' || period.kind === 'month') && <div><dt>Mest aktive dag</dt><dd>{totals.busiestDay ? <>{dateLabel(totals.busiestDay.date, { weekday: 'short', day: 'numeric', month: 'short' })}<span>{formatDuration(totals.busiestDay.total)}</span></> : 'Ingen ennå'}</dd></div>}
        </dl>
        {!totals.total && <p className="statistics-state">Ingen registrert arbeidstid i denne perioden.</p>}
        {period.kind === 'week' || period.kind === 'month' || totals.total > 0 ? <StatisticsChart summary={totals} period={period} /> : null}
        {totals.areas.length > 0 && <StatisticsLegend subjects={totals.areas} onArea={id => area(id)} />}
        <StatisticsTable summary={totals} period={period} />
        <p className="timer-meta">Inkluderer pågående arbeid ved serverkontroll {new Date(totals.server_time).toLocaleTimeString('nb-NO')}. Åpne panelet eller hent på nytt for oppdatert tid.</p>
      </>}
    </>}
  </section>
}
