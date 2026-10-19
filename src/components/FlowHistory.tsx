import { useEffect, useRef, useState } from 'react'
import type { FlowHistoryData } from '../hooks/useFlowHistory'
import type { useSubjects } from '../hooks/useSubjects'
import type { FlowCatalog } from '../lib/flow-work'
import { activityName } from '../lib/flow-work'
import { dateLabel, validZone } from '../lib/flow-statistics'
import { dayTimeline, nativeHistoryWork } from '../lib/flow-history'
import type { FlowHistoryEntry } from '../lib/flow-history'
import type { FlowWorkSegment } from '../types/flow'
import { formatDuration } from '../lib/study-sessions'
import { workMilliseconds } from '../lib/history-time'
import HistoryForm from './HistoryForm'

const localTime = (iso: string, zone?: string) => new Date(iso).toLocaleString('nb-NO', { timeZone: zone, dateStyle: 'short', timeStyle: 'medium' })
function AttributionForm({ segment, catalog, data, onClose }: { segment: FlowWorkSegment; catalog: FlowCatalog; data: FlowHistoryData; onClose: () => void }) {
  const [area, setArea] = useState(segment.area_id ?? ''), [task, setTask] = useState(segment.task_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const busy = data.mutation !== null
  const tasks = catalog.tasks.filter(t => t.area_id === (area || null) || t.id === task)
  return <form className="history-form" onSubmit={async event => {
    event.preventDefault(); setError(null)
    if (task && (area !== (segment.area_id ?? '') || task !== (segment.task_id ?? '')) && !catalog.tasks.some(t => t.id === task && t.area_id === (area || null))) {
      setError('Velg en oppgave som nå tilhører området, eller fjern oppgaven.'); return
    }
    const saved = await data.attribute({ segmentId: segment.id, areaId: area || null, taskId: task || null, expectedAreaId: segment.area_id, expectedTaskId: segment.task_id })
    if (saved) onClose()
  }}>
    <fieldset disabled={busy || data.status !== 'ready'}><legend>Korriger tilknytning</legend>
      <p className="timer-meta">Bare område og oppgave endres. Tidspunkter og arbeidsdag beholdes.</p>
      <div className="auth-field"><label htmlFor="history-area">Område</label><select autoFocus id="history-area" value={area} onChange={e => { setArea(e.target.value); setTask('') }}>
        <option value="">Annet</option>{catalog.areas.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_archived ? ' · Arkivert' : ''}</option>)}
      </select></div>
      <div className="auth-field"><label htmlFor="history-task">Oppgave</label><select id="history-task" value={task} onChange={e => setTask(e.target.value)}>
        <option value="">Uten oppgave</option>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === 'completed' ? ' · Fullført' : ''}</option>)}
      </select></div>
      {error && <p role="alert" className="auth-error">{error}</p>}
      <div className="subject-actions"><button type="submit">Lagre tilknytning</button><button type="button" className="secondary-button" onClick={onClose}>Avbryt</button></div>
    </fieldset>
  </form>
}
export default function FlowHistory({ data, subjects, catalog }: { data: FlowHistoryData; subjects: ReturnType<typeof useSubjects>; catalog: FlowCatalog }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [segment, setSegment] = useState<{ key: string; value: FlowWorkSegment } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = data.mutation !== null, disabled = busy || data.status !== 'ready' || data.loadingMore
  const legacyTime = (iso: string) => validZone(data.timezone) ? localTime(iso, data.timezone!) : iso
  function close() { setEditing(null); setSegment(null); heading.current?.focus() }
  useEffect(() => { if (editing && data.status === 'ready' && !data.rows.some(r => r.key === editing)) close() }, [editing, data.status, data.rows])
  async function remove(entry: FlowHistoryEntry) {
    if (entry.source !== 'legacy-study' || !window.confirm(`Slett den eldre registreringen fra ${localTime(entry.started_at)}? Dette kan ikke angres.`)) return
    await data.removeLegacy(entry.id); close()
  }
  return <section className="dashboard-panel history-section" aria-labelledby="history-title" aria-busy={busy || data.status === 'loading' || data.loadingMore}>
    <header className="subjects-heading"><div><p className="section-label">Arbeidsdager og tidligere registreringer</p><h2 id="history-title" ref={heading} tabIndex={-1}>Flow-historikk</h2></div>
      <button type="button" className="text-button" disabled={busy || !!editing || !!segment} onClick={() => void data.reload()}>Hent på nytt</button></header>
    <p className="timer-meta">Nyeste først. Dagens pågående arbeid ligger i dagsdetaljene ved timeren. Pauser vises som gap mellom periodene.</p>
    <p className="timer-meta">Eldre klokkeslett vises i {validZone(data.timezone) ? data.timezone : 'absolutt ISO-format'}. Eldre registreringer har ikke lagret historisk tidssone.</p>
    <p role="status">{data.status === 'loading' ? 'Henter historikk …' : busy ? 'Lagrer og kontrollerer …' : data.loadingMore ? 'Henter flere …' : data.notice}</p>
    {data.error && <p role="alert" className="auth-error">{data.error}</p>}
    {data.listError && <div role="alert"><p className="auth-error">{data.listError}</p><button type="button" disabled={busy} onClick={() => { close(); void data.reload() }}>Prøv igjen</button></div>}
    {data.status === 'ready' && !data.rows.length && <p>Ingen avsluttede arbeidsdager eller tidligere registreringer ennå.</p>}
    <ul className="history-list">{data.rows.map(entry => <li key={entry.key}><article aria-labelledby={'history-' + entry.key}>
      {entry.source === 'flow' ? <>
        <header className="history-entry-heading"><div className="history-entry-info"><h3 id={'history-' + entry.key}>{dateLabel(entry.snapshot.work_day.logical_date)}</h3>
          <p className="history-date">{entry.snapshot.work_day.timezone} · Flow-dag</p>
          <p className="history-date">Første aktivitet {localTime(entry.started_at, entry.snapshot.work_day.timezone)}<br />Avsluttet {localTime(entry.snapshot.work_day.ended_at ?? entry.snapshot.work_day.cutoff_at, entry.snapshot.work_day.timezone)}</p>
        </div><p className="history-work"><span>Arbeidstid</span><strong>{formatDuration(nativeHistoryWork(entry.snapshot))}</strong></p></header>
        <details className="history-periods"><summary>Vis tidslinje · {entry.snapshot.segments.length} arbeidsperioder</summary>
          <ol className="flow-history-timeline">{dayTimeline(entry.snapshot).map(period => {
            const labels = activityName({ areaId: period.areaId, taskId: period.taskId }, catalog)
            const original = entry.snapshot.segments.find(s => s.id === period.segmentId)
            return <li key={period.key} className={period.kind === 'pause' ? 'is-pause' : ''}>
              <p><time dateTime={period.start}>{localTime(period.start, entry.snapshot.work_day.timezone)}</time> → <time dateTime={period.end}>{localTime(period.end, entry.snapshot.work_day.timezone)}</time></p>
              {period.kind === 'pause' ? <span>Pause · {formatDuration(Date.parse(period.end) - Date.parse(period.start))}</span> : <><strong>{labels.area}</strong><p>{period.taskId ? labels.task : 'Uten oppgave'}</p>
                {original && <button type="button" className="text-button" disabled={disabled || !!editing || !!segment} onClick={() => setSegment({ key: entry.key, value: original })}>Korriger tilknytning</button>}
              </>}
              {segment?.key === entry.key && segment.value.id === period.segmentId && <AttributionForm key={segment.value.id} segment={segment.value} catalog={catalog} data={data} onClose={close} />}
            </li>
          })}</ol>
          <p className="timer-meta">Pause før første aktivitet telles ikke. Eventuell siste pause varer til lagret slutt/dagsgrense. Tidsredigering av native dager tilbys ikke her.</p>
        </details>
      </> : <>
        <header className="history-entry-heading"><div className="history-entry-info"><p className="section-label">Eldre registrering</p>
          {entry.snapshot.subject?.code && <p className="subject-code">{entry.snapshot.subject.code}</p>}
          <h3 id={'history-' + entry.key}>{entry.snapshot.subject?.name ?? 'Annet / tidligere område er slettet'}</h3>
          <p className="history-date">{legacyTime(entry.started_at)} → {legacyTime(entry.snapshot.session.ended_at)}</p>
          {entry.snapshot.session.description && <p className="history-description">{entry.snapshot.session.description}</p>}
        </div><p className="history-work"><span>Arbeidstid</span><strong>{formatDuration(workMilliseconds(entry.snapshot.segments))}</strong></p></header>
        <div className="history-entry-footer"><details className="history-periods"><summary>{entry.snapshot.segments.length} arbeidsperioder</summary><ol>{entry.snapshot.segments.map(s => <li key={s.id}>{legacyTime(s.started_at)} → {legacyTime(s.ended_at)}</li>)}</ol></details>
          {editing !== entry.key && <div className="subject-actions"><button type="button" className="text-button" disabled={disabled || !!editing || !!segment || subjects.status !== 'ready'} onClick={() => setEditing(entry.key)}>Rediger registrering</button>
            <button type="button" className="text-button danger-text" disabled={disabled || !!editing || !!segment} onClick={() => void remove(entry)}>Slett registrering</button></div>}
        </div>
        {editing === entry.key && <HistoryForm entry={entry.snapshot} subjects={subjects.subjects} busy={busy} disabled={disabled || subjects.status !== 'ready' || subjects.busy} onSave={input => data.editLegacy(entry.id, input)} onClose={close} />}
      </>}
    </article></li>)}</ul>
    {data.cursor && <button type="button" disabled={disabled || !!editing || !!segment} onClick={async () => { await data.more(); heading.current?.focus() }}>{data.loadingMore ? 'Henter flere …' : 'Vis flere'}</button>}
  </section>
}
