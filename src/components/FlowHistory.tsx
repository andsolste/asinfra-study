import { useEffect, useRef, useState } from 'react'
import type { FlowHistoryData } from '../hooks/useFlowHistory'
import type { useSubjects } from '../hooks/useSubjects'
import type { FlowCatalog, FlowSnapshot } from '../lib/flow-work'
import type { NativeSegmentCorrection } from '../lib/native-period'
import { activityName } from '../lib/flow-work'
import { dateLabel, validZone } from '../lib/flow-statistics'
import { dayTimeline, nativeHistoryWork } from '../lib/flow-history'
import type { FlowHistoryEntry } from '../lib/flow-history'
import type { FlowWorkSegment } from '../types/flow'
import { formatDuration } from '../lib/study-sessions'
import { durationMilliseconds, timestampMicroseconds } from '../lib/time-precision'
import { workMilliseconds } from '../lib/history-time'
import HistoryForm from './HistoryForm'
import NativePeriodForm from './NativePeriodForm'

const localTime = (iso: string, zone?: string) => new Date(iso).toLocaleString('nb-NO', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' })
function dayAreas(segments: readonly FlowWorkSegment[], catalog: FlowCatalog) {
  const names = [...new Set(segments.map(s => s.area_id))].map(areaId => activityName({ areaId, taskId: null }, catalog).area)
  return names.slice(0, 2).join(' · ') + (names.length > 2 ? ` · +${names.length - 2} andre` : '')
}
export default function FlowHistory({ data, subjects, catalog, onCorrect = data.correctNative, correctionUnavailable = false }: {
  data: FlowHistoryData; subjects: ReturnType<typeof useSubjects>; catalog: FlowCatalog; onCorrect?: (input: NativeSegmentCorrection) => Promise<boolean>; correctionUnavailable?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [segment, setSegment] = useState<{ key: string; value: FlowWorkSegment; snapshot: FlowSnapshot } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const editorOpener = useRef<HTMLElement | null>(null)
  const editorRow = useRef<string | null>(null)
  const busy = data.mutation !== null, disabled = busy || data.status !== 'ready' || data.loadingMore
  const legacyTime = (iso: string) => validZone(data.timezone) ? localTime(iso, data.timezone!) : iso
  function close() {
    setEditing(null); setSegment(null)
    requestAnimationFrame(() => {
      const opener = editorOpener.current
      if (opener?.isConnected && opener.getClientRects().length && !opener.matches(':disabled')) opener.focus()
      else (document.getElementById('history-' + editorRow.current) ?? heading.current)?.focus()
    })
  }
  useEffect(() => { if (editing && data.status === 'ready' && !data.rows.some(r => r.key === editing)) close() }, [editing, data.status, data.rows])
  async function remove(entry: FlowHistoryEntry) {
    if (entry.source !== 'legacy-study' || !window.confirm(`Slett den eldre registreringen fra ${localTime(entry.started_at)}? Dette kan ikke angres.`)) return
    await data.removeLegacy(entry.id); close()
  }
  return <section className="dashboard-panel history-section" aria-labelledby="history-title" aria-busy={busy || data.status === 'loading' || data.loadingMore}>
    <header className="panel-heading"><div><p className="section-label">Konkrete arbeidsdager</p><h2 id="history-title" ref={heading} tabIndex={-1}>Arbeidslogg</h2></div>
      <button type="button" className="text-button" disabled={busy || !!editing || !!segment} onClick={() => void data.reload()}>Hent på nytt</button></header>
    <p className="timer-meta">Avsluttet arbeid, nyeste først. Åpne en dag for arbeidsperioder og korrigering. Pågående arbeid finner du under Arbeid.</p>
    <p role="status">{data.status === 'loading' ? data.rows.length ? 'Oppdaterer arbeidsloggen …' : 'Henter arbeidslogg …' : busy ? 'Lagrer og kontrollerer …' : data.loadingMore ? 'Henter flere …' : data.notice}</p>
    {data.error && <p role="alert" className="auth-error">{data.error}</p>}
    {data.listError && <div role="alert"><p className="auth-error">{data.listError}</p><button type="button" disabled={busy} onClick={() => { close(); void data.reload() }}>Prøv igjen</button></div>}
    {data.status === 'ready' && !data.rows.length && <p>Ingen avsluttede arbeidsdager eller tidligere registreringer ennå.</p>}
    <ul className="history-list" ref={list}>{data.rows.map(entry => <li key={entry.key}><article aria-labelledby={'history-' + entry.key}>
      {entry.source === 'flow' ? <>
        <header className="history-entry-heading"><div className="history-entry-info"><h3 id={'history-' + entry.key} tabIndex={-1}>{dateLabel(entry.snapshot.work_day.logical_date)}</h3>
          <p className="history-date">Flow-dag{entry.snapshot.segments.length > 0 && ` · ${dayAreas(entry.snapshot.segments, catalog)}`}</p>
        </div><p className="history-work"><span>Arbeidstid</span><strong>{formatDuration(nativeHistoryWork(entry.snapshot))}</strong></p></header>
        <details className="history-periods"><summary>Vis tidslinje · {entry.snapshot.segments.length} arbeidsperioder</summary>
          <p className="history-date">{entry.snapshot.work_day.timezone} · Første aktivitet {localTime(entry.started_at, entry.snapshot.work_day.timezone)}<br />Avsluttet {localTime(entry.snapshot.work_day.ended_at ?? entry.snapshot.work_day.cutoff_at, entry.snapshot.work_day.timezone)}</p>
          <ol className="flow-history-timeline">{dayTimeline(entry.snapshot).map(period => {
            const labels = activityName({ areaId: period.areaId, taskId: period.taskId }, catalog)
            const original = entry.snapshot.segments.find(s => s.id === period.segmentId)
            return <li key={period.key} className={period.kind === 'pause' ? 'is-pause' : ''}>
              <p><time dateTime={period.start}>{localTime(period.start, entry.snapshot.work_day.timezone)}</time> → <time dateTime={period.end}>{localTime(period.end, entry.snapshot.work_day.timezone)}</time></p>
              {period.kind === 'pause' ? <span>Pause · {formatDuration(durationMilliseconds(timestampMicroseconds(period.end) - timestampMicroseconds(period.start)))}</span> : <><span className="history-period-kind">Arbeidsperiode</span><strong>{labels.area}</strong><p>{period.taskId ? labels.task : 'Uten oppgave'}</p>
                {original && <button type="button" className="text-button" disabled={disabled || correctionUnavailable || !!editing || !!segment}
                  aria-label={`Rediger arbeidsperiode fra ${localTime(period.start, entry.snapshot.work_day.timezone)}`}
                  onClick={event => { editorOpener.current = event.currentTarget; editorRow.current = entry.key; data.prepareCorrection(); setSegment({ key: entry.key, value: original, snapshot: entry.snapshot }) }}>Rediger arbeidsperiode</button>}
              </>}
              {segment?.key === entry.key && segment.value.id === period.segmentId && <NativePeriodForm key={segment.value.id} snapshot={segment.snapshot} segment={segment.value}
                catalog={catalog} now={data.now} busy={busy} blocked={data.correctionBlocked === segment.value.id} disabled={correctionUnavailable || data.status !== 'ready'} error={data.error} onSave={onCorrect} onClose={close} />}
            </li>
          })}</ol>
          <p className="timer-meta">Pause før første aktivitet telles ikke. Eventuell siste pause varer til lagret slutt/dagsgrense. Korriger arbeidsperioder uten å endre arbeidsdagens identitet.</p>
        </details>
      </> : <>
        <header className="history-entry-heading"><div className="history-entry-info"><p className="section-label">Eldre registrering</p>
          {entry.snapshot.subject?.code && <p className="subject-code">{entry.snapshot.subject.code}</p>}
          <h3 id={'history-' + entry.key} tabIndex={-1}>{entry.snapshot.subject?.name ?? 'Annet / tidligere område er slettet'}</h3>
          <p className="history-date">{legacyTime(entry.started_at)} → {legacyTime(entry.snapshot.session.ended_at)}</p>
          {entry.snapshot.session.description && <p className="history-description">{entry.snapshot.session.description}</p>}
        </div><p className="history-work"><span>Arbeidstid</span><strong>{formatDuration(workMilliseconds(entry.snapshot.segments))}</strong></p></header>
        <div className="history-entry-footer"><details className="history-periods"><summary>{entry.snapshot.segments.length} arbeidsperioder</summary><ol>{entry.snapshot.segments.map(s => <li key={s.id}>{legacyTime(s.started_at)} → {legacyTime(s.ended_at)}</li>)}</ol></details>
          {editing !== entry.key && <div className="subject-actions"><button type="button" className="text-button" disabled={disabled || !!editing || !!segment || subjects.status !== 'ready'} onClick={event => { editorOpener.current = event.currentTarget; editorRow.current = entry.key; setEditing(entry.key) }}>Rediger registrering</button>
            <button type="button" className="text-button danger-text" disabled={disabled || !!editing || !!segment} onClick={event => { editorOpener.current = event.currentTarget; editorRow.current = entry.key; void remove(entry) }}>Slett registrering</button></div>}
        </div>
        {editing === entry.key && <HistoryForm entry={entry.snapshot} subjects={subjects.subjects} busy={busy} disabled={disabled || subjects.status !== 'ready' || subjects.busy} onSave={input => data.editLegacy(entry.id, input)} onClose={close} />}
      </>}
    </article></li>)}</ul>
    {data.cursor && <button type="button" className="secondary-button history-more" disabled={disabled || !!editing || !!segment} onClick={async () => {
      const count = data.rows.length
      await data.more()
      requestAnimationFrame(() => (list.current?.children[count]?.querySelector('h3') ?? heading.current)?.focus())
    }}>{data.loadingMore ? 'Henter flere …' : 'Vis flere'}</button>}
    <details className="statistics-policy history-policy"><summary>Om arbeidsloggen og eldre registreringer</summary>
      <p>Listen er paginert, ikke filtrert etter perioden i Oversikt. Flow-dager bruker lagret dato og tidssone. Eldre klokkeslett vises i {validZone(data.timezone) ? data.timezone : 'absolutt ISO-format'}; de har ikke lagret historisk tidssone.</p>
      <p>Native arbeidsperioder kan få korrigert start, slutt, område og oppgave. Samme start og slutt gir 0 min, uten sletting. Eldre registreringer har egen redigering og sletting.</p>
    </details>
  </section>
}
