import { useEffect, useId, useRef, useState } from 'react'
import type { FlowCatalog, FlowSnapshot } from '../lib/flow-work'
import type { FlowWorkSegment } from '../types/flow'
import { activityName } from '../lib/flow-work'
import { buildNativeCorrection, nativeCorrectionWork, nativeDraft, nativeLocalMinute } from '../lib/native-period'
import type { NativeSegmentCorrection } from '../lib/native-period'
import { formatDuration } from '../lib/study-sessions'

export default function NativePeriodForm({ snapshot, segment, catalog, now, busy, blocked, disabled = false, error, finishOnly = false, onSave, onClose }: {
  snapshot: FlowSnapshot; segment: FlowWorkSegment; catalog: FlowCatalog; now: () => number
  busy: boolean; blocked: boolean; disabled?: boolean; error: string | null; finishOnly?: boolean
  onSave: (input: NativeSegmentCorrection) => Promise<boolean>; onClose: () => void
}) {
  // Frozen original snapshot: a refresh must never silently rebase this draft.
  const [draft, setDraft] = useState(() => nativeDraft(snapshot, segment))
  const [validation, setValidation] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null), submitting = useRef(false), prefix = useId()
  useEffect(() => { first.current?.focus() }, [])
  const tasks = catalog.tasks.filter(t => t.area_id === (draft.area || null) || t.id === draft.task)
  const names = activityName({ areaId: segment.area_id, taskId: segment.task_id }, catalog)
  let preview: string | null = null
  try { preview = formatDuration(nativeCorrectionWork(buildNativeCorrection(snapshot, segment, draft, now(), catalog))) } catch { /* Show validation after explicit submit. */ }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || busy || blocked || disabled) return
    setValidation(null)
    let input: NativeSegmentCorrection
    try { input = buildNativeCorrection(snapshot, segment, draft, now(), catalog) }
    catch (error) { setValidation(error instanceof Error ? error.message : 'Kontroller perioden.'); return }
    submitting.current = true
    try { if (await onSave(input)) onClose() }
    finally { submitting.current = false }
  }
  return <form className="history-form native-period-form" onSubmit={submit}>
    <fieldset disabled={busy || blocked || disabled} aria-describedby={prefix + '-zone'}>
      <legend>{finishOnly ? 'Når sluttet du å jobbe?' : 'Rediger arbeidsperiode'}</legend>
      <p id={prefix + '-zone'} className="timer-meta">Tidssone: {snapshot.work_day.timezone} (lagret for arbeidsdagen). Hele minutter; urørte tidspunkt beholder full presisjon.</p>
      {finishOnly ? <p><strong>{segment.task_id ? names.task : names.area}</strong><br />Start: {nativeLocalMinute(segment.started_at, snapshot.work_day.timezone).replace('T', ' ')}</p> : <>
        <div className="auth-field"><label htmlFor={prefix + '-area'}>Område</label><select id={prefix + '-area'} value={draft.area} onChange={e => setDraft({ ...draft, area: e.target.value, task: '' })}>
          <option value="">Annet</option>{draft.area && !catalog.areas.some(a => a.id === draft.area) && <option value={draft.area}>Utilgjengelig historisk område</option>}
          {catalog.areas.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_archived ? ' · Arkivert' : ''}</option>)}
        </select></div>
        <div className="auth-field"><label htmlFor={prefix + '-task'}>Oppgave</label><select id={prefix + '-task'} value={draft.task} onChange={e => setDraft({ ...draft, task: e.target.value })}>
          <option value="">Uten oppgave</option>{draft.task && !tasks.some(t => t.id === draft.task) && <option value={draft.task}>Utilgjengelig historisk oppgave</option>}
          {tasks.map(t => <option key={t.id} value={t.id}>{t.title}{t.status === 'completed' ? ' · Fullført' : ''}</option>)}
        </select></div>
        <div className="auth-field"><label htmlFor={prefix + '-from'}>Fra</label><input ref={first} id={prefix + '-from'} type="datetime-local" step="60" required value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></div>
      </>}
      <div className="auth-field"><label htmlFor={prefix + '-to'}>{finishOnly ? 'Sluttet å jobbe' : 'Til'}</label>
        <input ref={finishOnly ? first : undefined} id={prefix + '-to'} type="datetime-local" step="60" required value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></div>
      <p className="timer-meta" role="status">Arbeidstid etter endring: {preview ?? 'Velg gyldige tidspunkt'}</p>
      <p className="timer-meta">Samme start og slutt gir 0 min. Arbeidsdagen og dagsgrensen endres ikke.{finishOnly && ' Etter lagring er Flow pauset. Fortsett må velges eksplisitt.'}</p>
      <button type="submit">{busy ? 'Lagrer og kontrollerer …' : 'Lagre korrigering'}</button>
    </fieldset>
    {(validation || error) && <p role="alert" className="auth-error">{validation ?? error}</p>}
    {disabled && !blocked && !busy && <p role="status">Lagring venter på oppdatert status.</p>}
    {blocked && <p role="alert">Grunnlaget må kontrolleres på nytt. Avbryt og åpne editoren fra oppdatert status før ny lagring.</p>}
    <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Avbryt</button>
  </form>
}
