import { useEffect, useRef, useState } from 'react'
import type { useSubjects } from '../hooks/useSubjects'
import type { useStudyHistory } from '../hooks/useStudyHistory'
import { localWeek, shiftWeek, weekLabel, workMilliseconds } from '../lib/history-time'
import { summarizeWeek } from '../lib/study-history'
import type { HistoryEntry } from '../lib/study-history'
import { formatDuration } from '../lib/study-sessions'
import HistoryForm from './HistoryForm'

type Props = { data: ReturnType<typeof useStudyHistory>; subjects: ReturnType<typeof useSubjects> }
const localTime = (iso: string) => new Date(iso).toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })
export default function StudyHistory({ data, subjects }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const busy = data.mutation !== null
  const disabled = busy || data.status !== 'ready' || data.loadingMore
  const totals = summarizeWeek(data.weekRows, data.week)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  useEffect(() => {
    if (data.status === 'ready' && editing && !data.rows.some(entry => entry.session.id === editing)) {
      setEditing(null); heading.current?.focus()
    }
  }, [data.status, data.rows, editing])
  function closeForm() { setEditing(null); heading.current?.focus() }
  async function remove(entry: HistoryEntry) {
    if (!window.confirm(`Slett økten i ${entry.subject?.name ?? 'uten fag'} fra ${localTime(entry.session.started_at)}? Dette kan ikke angres.`)) return
    await data.remove(entry.session.id)
    heading.current?.focus()
  }
  return <>
    <section className="history-section" aria-labelledby="week-title" aria-busy={data.weekStatus === 'loading'}>
      <h2 id="week-title">Ukestatistikk</h2>
      <p className="week-label">{weekLabel(data.week)}</p>
      <p className="timer-meta">Mandag til søndag · {zone || 'Lokal tidssone'} · Kun ferdige økter</p>
      <div className="subject-actions">
        <button type="button" className="text-button" disabled={busy} onClick={() => void data.selectWeek(shiftWeek(data.week, -1))}>← Forrige uke</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => void data.selectWeek(localWeek())}>Denne uken</button>
        <button type="button" className="text-button" disabled={busy} onClick={() => void data.selectWeek(shiftWeek(data.week, 1))}>Neste uke →</button>
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
    <section className="history-section" aria-labelledby="history-title" aria-busy={busy || data.status === 'loading' || data.loadingMore}>
      <header className="subjects-heading">
        <h2 id="history-title" ref={heading} tabIndex={-1}>Studiehistorikk</h2>
        <button type="button" className="text-button" disabled={busy || editing !== null}
          onClick={() => void data.reload()}>Hent på nytt</button>
      </header>
      <p className="timer-meta">Alle ferdige økter, nyeste først. Arbeidstid summeres fra arbeidsperiodene, uten pauser.</p>
      <p role="status">{data.status === 'loading' ? 'Henter historikk …' : data.mutation === 'saving' ? 'Lagrer og kontrollerer …'
        : data.mutation === 'deleting' ? 'Sletter og kontrollerer …' : data.loadingMore ? 'Henter flere økter …' : data.notice}</p>
      {data.error && <p className="auth-error" role="alert">{data.error}</p>}
      {data.listError && <div role="alert"><p className="auth-error">{data.listError}</p>
        <button type="button" className="text-button" disabled={busy} onClick={() => { closeForm(); void data.reload() }}>Prøv igjen</button></div>}
      {data.status === 'ready' && !data.rows.length && <p>Ingen ferdige studieøkter ennå. Stopp en økt for å lagre den her.</p>}
      <ul className="history-list">{data.rows.map(entry => <li key={entry.session.id}>
        <article aria-labelledby={'history-' + entry.session.id}>
          {entry.subject?.code && <p className="subject-code">{entry.subject.code}</p>}
          <h3 id={'history-' + entry.session.id}>{entry.subject?.name ?? 'Uten fag / tidligere fag er slettet'}</h3>
          <p className="history-date"><time dateTime={entry.session.started_at}>{localTime(entry.session.started_at)}</time>
            {' → '}<time dateTime={entry.session.ended_at}>{localTime(entry.session.ended_at)}</time></p>
          {entry.session.description && <p className="timer-description">{entry.session.description}</p>}
          <p className="history-work">Arbeidstid: {formatDuration(workMilliseconds(entry.segments))}</p>
          {!entry.segments.length ? <p className="timer-meta">Ingen registrerte arbeidsperioder. Arbeidstid vises som 0.</p>
            : <details className="history-periods"><summary>{entry.segments.length} {entry.segments.length === 1 ? 'arbeidsperiode' : 'arbeidsperioder'}</summary>
              <ol>{entry.segments.map(segment => <li key={segment.id}>
                <time dateTime={segment.started_at}>{localTime(segment.started_at)}</time>{' → '}
                <time dateTime={segment.ended_at}>{localTime(segment.ended_at)}</time>
              </li>)}</ol>
            </details>}
          {editing === entry.session.id ? <HistoryForm key={entry.session.id} entry={entry} subjects={subjects.subjects}
            busy={busy} disabled={disabled || subjects.status !== 'ready' || subjects.busy}
            onSave={input => data.edit(entry.session.id, input)} onClose={closeForm} />
            : <div className="subject-actions">
              <button type="button" className="text-button" disabled={disabled || editing !== null || subjects.status !== 'ready'}
                aria-label={`Rediger økt fra ${localTime(entry.session.started_at)}`} onClick={() => setEditing(entry.session.id)}>Rediger økt</button>
              <button type="button" className="text-button" disabled={disabled || editing !== null}
                aria-label={`Slett økt fra ${localTime(entry.session.started_at)}`} onClick={() => void remove(entry)}>Slett økt</button>
            </div>}
        </article>
      </li>)}</ul>
      {data.hasMore && <button type="button" disabled={disabled || editing !== null} onClick={() => void data.more()}>
        {data.loadingMore ? 'Henter flere …' : 'Vis flere'}</button>}
    </section>
  </>
}
