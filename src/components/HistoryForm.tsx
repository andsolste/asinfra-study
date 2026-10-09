import { useId, useRef, useState } from 'react'
import type { Subject } from '../lib/subjects'
import { splitSubjects } from '../lib/subjects'
import { addDraftSegment, createHistoryDraft, prepareHistoryEdit, removeDraftSegment } from '../lib/study-history'
import type { HistoryEdit, HistoryEntry } from '../lib/study-history'

type Props = {
  entry: HistoryEntry; subjects: Subject[]; disabled: boolean; busy: boolean
  onSave: (input: HistoryEdit) => Promise<boolean>; onClose: () => void
}
export default function HistoryForm({ entry, subjects, disabled, busy, onSave, onClose }: Props) {
  const id = useId()
  const [draft, setDraft] = useState(() => createHistoryDraft(entry))
  const [error, setError] = useState<string | null>(null)
  const segmentsHeading = useRef<HTMLHeadingElement>(null)
  const { active, archived } = splitSubjects(subjects)
  function options(rows: Subject[]) {
    return rows.map(subject => <option key={subject.id} value={subject.id}>
      {subject.code ? subject.code + ' – ' : ''}{subject.name}
    </option>)
  }
  function changeSegment(key: string, field: 'start' | 'end', value: string) {
    setDraft(current => ({ ...current, segments: current.segments.map(segment =>
      segment.key === key ? { ...segment, [field]: value } : segment) }))
  }
  return <form className="history-form" aria-busy={busy} onSubmit={async event => {
    event.preventDefault(); setError(null)
    let input: HistoryEdit
    try { input = prepareHistoryEdit(draft, subjects) }
    catch (error) { setError(error instanceof Error ? error.message : 'Kontroller feltene.'); return }
    // Even an uncertain write closes the draft. Re-open the freshly fetched row
    // instead of blindly re-submitting stale segment times.
    await onSave(input)
    onClose()
  }}>
    <fieldset disabled={disabled}>
      <legend>Rediger ferdig økt</legend>
      <div className="auth-field">
        <label htmlFor={id + '-subject'}>Fag</label>
        <select id={id + '-subject'} autoFocus value={draft.subjectId}
          onChange={event => setDraft({ ...draft, subjectId: event.target.value })}>
          <option value="">Uten fag / tidligere fag er slettet</option>
          <optgroup label="Aktive fag">{options(active)}</optgroup>
          <optgroup label="Arkiverte fag">{options(archived)}</optgroup>
        </select>
      </div>
      <div className="auth-field">
        <label htmlFor={id + '-description'}>Beskrivelse (valgfri)</label>
        <textarea id={id + '-description'} rows={2} value={draft.description} aria-describedby={id + '-help'}
          onChange={event => setDraft({ ...draft, description: event.target.value })} />
        <small id={id + '-help'}>Maks 500 tegn. Tidspunktene nedenfor er i din lokale tidssone.</small>
      </div>
      <div className="history-times">
        <div className="auth-field"><label htmlFor={id + '-start'}>Økten startet</label>
          <input id={id + '-start'} type="datetime-local" step="0.001" required value={draft.start}
            onInput={event => setDraft({ ...draft, start: event.currentTarget.value })}
            onChange={event => setDraft({ ...draft, start: event.target.value })} /></div>
        <div className="auth-field"><label htmlFor={id + '-end'}>Økten sluttet</label>
          <input id={id + '-end'} type="datetime-local" step="0.001" required value={draft.end}
            onInput={event => setDraft({ ...draft, end: event.currentTarget.value })}
            onChange={event => setDraft({ ...draft, end: event.target.value })} /></div>
      </div>
      <h4 ref={segmentsHeading} tabIndex={-1}>Arbeidsperioder</h4>
      <p className="timer-meta">Mellomrom mellom periodene er pauser. Periodene må stå kronologisk og være innenfor økten.</p>
      <ol className="history-segments">{draft.segments.map((segment, index) => <li key={segment.key}>
        <p>Arbeidsperiode {index + 1}</p>
        <div className="history-times">
          <div className="auth-field"><label htmlFor={id + segment.key + '-start'}>Fra</label>
            <input id={id + segment.key + '-start'} type="datetime-local" step="0.001" required autoFocus={!segment.originalStart} value={segment.start}
              onInput={event => changeSegment(segment.key, 'start', event.currentTarget.value)}
              onChange={event => changeSegment(segment.key, 'start', event.target.value)} /></div>
          <div className="auth-field"><label htmlFor={id + segment.key + '-end'}>Til</label>
            <input id={id + segment.key + '-end'} type="datetime-local" step="0.001" required value={segment.end}
              onInput={event => changeSegment(segment.key, 'end', event.currentTarget.value)}
              onChange={event => changeSegment(segment.key, 'end', event.target.value)} /></div>
        </div>
        <button type="button" className="text-button" aria-label={`Fjern arbeidsperiode ${index + 1}`}
          onClick={() => { setDraft(removeDraftSegment(draft, segment.key)); segmentsHeading.current?.focus() }}>Fjern periode</button>
      </li>)}</ol>
      {!draft.segments.length && <p>Ingen registrert arbeidstid. Legg til en periode hvis du faktisk jobbet.</p>}
      <button type="button" className="text-button"
        onClick={() => setDraft(addDraftSegment(draft))}>Legg til arbeidsperiode</button>
    </fieldset>
    {error && <p role="alert" className="auth-error">{error}</p>}
    <div className="subject-actions">
      <button type="submit" disabled={disabled}>{busy ? 'Lagrer …' : 'Lagre endringer'}</button>
      <button type="button" className="text-button" disabled={busy} onClick={onClose}>Avbryt</button>
    </div>
  </form>
}
