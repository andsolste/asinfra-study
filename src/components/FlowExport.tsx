import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FlowHistoryData } from '../hooks/useFlowHistory'
import { useFlowExport } from '../hooks/useFlowExport'
import { changeFlowKind, currentPeriod, flowPeriodLabel, shiftFlowPeriod } from '../lib/flow-statistics'
import type { FlowPeriod, PeriodKind } from '../lib/flow-statistics'
import FlowReport from './FlowReport'

const kinds: { kind: PeriodKind; label: string; current: string; unit: string }[] = [
  { kind: 'day', label: 'Dag', current: 'I dag', unit: 'dag' }, { kind: 'week', label: 'Uke', current: 'Denne uken', unit: 'uke' },
  { kind: 'month', label: 'Måned', current: 'Denne måneden', unit: 'måned' }, { kind: 'total', label: 'Totalt', current: '', unit: '' },
]
export default function FlowExport({ history }: { history: FlowHistoryData }) {
  const data = useFlowExport(), [period, setPeriod] = useState<FlowPeriod>(history.period), [zone, setZone] = useState(history.timezone ?? '')
  const [lastAction, setLastAction] = useState<'csv' | 'preview'>('csv')
  const busy = data.phase === 'csv' || data.phase === 'report', reportHeading = useRef<HTMLHeadingElement>(null)
  const displayed = data.resolvedPeriod ?? period, selected = kinds.find(k => k.kind === displayed.kind)!
  useEffect(() => { data.cancel() }, [period, history.timezone, data.cancel])
  useEffect(() => { if (data.report) reportHeading.current?.focus() }, [data.report])
  function select(next: FlowPeriod) { data.cancel(); setPeriod(next) }
  async function generate(action: 'csv' | 'preview') { setLastAction(action); await data[action](period, history.timezone) }
  return <section className="dashboard-panel export-panel" aria-labelledby="export-title">
    <header className="panel-heading"><div><p className="section-label">Lokalt på din enhet</p><h2 id="export-title">Eksport</h2></div>
      <div className="statistics-kinds" role="group" aria-label="Eksportperiode">{kinds.map(k => <button type="button" key={k.kind} className="secondary-button" aria-pressed={period.kind === k.kind}
        onClick={() => select(changeFlowKind(displayed, k.kind, history.now(), history.timezone, history.statistics?.task_date))}>{k.label}</button>)}</div></header>
    <div className="statistics-period"><p className="statistics-period-label">{flowPeriodLabel(displayed)}</p>{displayed.kind !== 'total' && <div className="statistics-period-controls" role="group" aria-label="Velg eksportperiode">
      <button type="button" className="secondary-button" aria-label={`Forrige ${selected.unit}`} disabled={!displayed.anchor} onClick={() => select(shiftFlowPeriod(displayed, -1))}>←</button>
      <button type="button" className="secondary-button" onClick={() => select(currentPeriod(period.kind, history.now(), history.timezone, history.statistics?.task_date))}>{selected.current}</button>
      <button type="button" className="secondary-button" aria-label={`Neste ${selected.unit}`} disabled={!displayed.anchor} onClick={() => select(shiftFlowPeriod(displayed, 1))}>→</button>
    </div>}</div>
    <details className="statistics-policy"><summary>Tidssone og datagrunnlag</summary>
      <p>Samme visningstidssone som i Statistikk: {history.timezone ?? 'ikke valgt'}. Native bruker lagrede Flow-dager. Eldre perioder deles ved kl. 04:00 i valgt visningstidssone; dette er ikke historiske tidssonemetadata.</p>
      <form className="statistics-zone" onSubmit={event => { event.preventDefault(); data.cancel(); void history.setTimezone(zone.trim() || null) }}>
        <div className="auth-field"><label htmlFor="export-zone">Visningstidssone</label><input id="export-zone" value={zone} onChange={e => setZone(e.target.value)} placeholder="IANA-tidssone" /></div>
        <button type="submit" className="secondary-button">Bruk tidssone</button>
      </form>
      <p>Områdenavn, oppgavetittel/status/frist og beskrivelser er dagens tilgjengelige metadata. Historisk områdetilknytning følger segmentet. CSV krever gyldig visningstidssone, også for Totalt.</p>
    </details>
    <p className="export-privacy">Eksport kan inneholde områdenavn, oppgaver, frister og beskrivelser. Filen lastes bare ned til enheten din; den lastes ikke opp eller deles. E-post, innloggingsdata og interne ID-er er ikke med.</p>
    <div className="export-options"><section><h3>CSV</h3><p>Faktiske arbeidsperioder, én rad per logisk dag. UTF-8 med BOM, komma som skilletegn og entydige ISO-tidsstempler.</p>
      <button type="button" disabled={busy} onClick={() => void generate('csv')}>Last ned CSV</button></section>
      <section><h3>Arbeidsrapport</h3><p>Forhåndsvis arbeidstid, områder og oppgavebidrag. Skriv ut eller lagre som PDF fra nettleseren.</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void generate('preview')}>Vis rapport</button></section></div>
    <p role="status" aria-live="polite">{data.phase === 'csv' ? data.total === null ? 'Forbereder eksport …' : `Henter eksport … ${data.count} av ${data.total} arbeidsrader.`
      : data.phase === 'report' ? 'Henter rapport …' : data.notice}</p>
    {busy && <button type="button" className="text-button" onClick={data.cancel}>Avbryt eksport</button>}
    {data.error && <div role="alert"><p className="auth-error">{data.error}</p><button type="button" onClick={() => void generate(lastAction)}>Prøv igjen</button></div>}
    {data.report && <section className="report-preview" aria-labelledby="report-preview-title"><div className="panel-heading"><h3 id="report-preview-title" tabIndex={-1} ref={reportHeading}>Forhåndsvisning</h3>
      <button type="button" onClick={() => window.print()}>Skriv ut / Lagre som PDF</button></div><FlowReport data={data.report} /></section>}
    {data.report && createPortal(<div className="flow-print-root"><FlowReport data={data.report} /></div>, document.body)}
  </section>
}
