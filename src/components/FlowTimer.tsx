import { useEffect, useRef, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import { activityName, activityUsable, flowDurations } from '../lib/flow-work'
import type { FlowActivity } from '../lib/flow-work'
import { startActivityCommand } from '../lib/flow-activity'
import { formatDuration } from '../lib/study-sessions'
import DetailPanel from './DetailPanel'
import FlowFeedback from './FlowFeedback'

export default function FlowTimer({ data, organizationVersion, onCutover }: {
  data: FlowWorkspaceData; organizationVersion: readonly { id: string }[]; onCutover: () => void
}) {
  const current = data.data?.current ?? null
  const open = current?.segments.find(s => s.ended_at === null)
  const last = open ?? current?.segments.at(-1)
  const lastActivity: FlowActivity = { areaId: last?.area_id ?? null, taskId: last?.task_id ?? null }
  const names = activityName(lastActivity, data.catalog)
  const serverNow = Math.max(data.now, data.data ? Date.parse(data.data.server_time) : 0)
  const totals = current ? flowDurations(current, serverNow) : { work: 0, elapsed: 0, pause: 0, current: 0 }
  const detailDay = current ?? data.closed
  const detailTotals = detailDay ? flowDurations(detailDay, serverNow) : totals
  const busy = data.phase === 'loading' || data.phase === 'recovering'
  const disabled = busy || data.phase === 'error'
  const [panel, setPanel] = useState<'activity' | 'day' | null>(null)
  const [areaId, setAreaId] = useState('')
  const [taskId, setTaskId] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const legacyWasActive = useRef(false)
  const activeAreas = data.catalog.areas.filter(a => !a.is_archived)
  const tasks = data.catalog.tasks.filter(t => t.status === 'active' && t.area_id === (areaId || null))
  const local = (timestamp: string) => new Date(timestamp).toLocaleString(undefined, {
    timeZone: detailDay?.work_day.timezone, dateStyle: 'short', timeStyle: 'medium',
  })
  useEffect(() => { void data.reload() }, [organizationVersion, data.reload])
  useEffect(() => {
    if (data.data?.legacy_active) legacyWasActive.current = true
    else if (current && legacyWasActive.current) { legacyWasActive.current = false; onCutover() }
  }, [data.data, current, onCutover])

  function showActivity(element: HTMLElement) {
    opener.current = element; setValidation(null)
    const usable = activityUsable(lastActivity, data.catalog)
    setAreaId(usable ? lastActivity.areaId ?? '' : '')
    setTaskId(usable ? lastActivity.taskId ?? '' : '')
    setPanel('activity')
  }
  async function choose(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); setValidation(null)
    try {
      const activity = { areaId: areaId || null, taskId: taskId || null }
      if (!activityUsable(activity, data.catalog)) throw new Error('Aktiviteten er ikke tilgjengelig. Velg et aktivt område eller en aktiv oppgave.')
      if (await data.dispatch(startActivityCommand(activity, data.data, data.catalog))) setPanel(null)
    } catch (error) { setValidation(error instanceof Error ? error.message : 'Kontroller aktiviteten.') }
  }
  async function pause() {
    if (!current || !open) return
    await data.dispatch({ kind: 'activity', dayId: current.work_day.id, expectedId: open.id,
      expectedCount: current.segments.length, nextId: null, areaId: null, taskId: null })
    heading.current?.focus()
  }
  async function resume(element: HTMLElement) {
    if (!last || !activityUsable(lastActivity, data.catalog)) { showActivity(element); return }
    await data.dispatch(startActivityCommand(lastActivity, data.data, data.catalog)); heading.current?.focus()
  }
  const status = { loading: 'Henter Flow-dagen …', idle: 'Klar til å arbeide', running: 'Arbeider',
    paused: 'Pauset', recovering: 'Kontrollerer status …', error: 'Status må kontrolleres' }[data.phase]
  const notice = <FlowFeedback data={data} />

  return <>
    <section className="dashboard-panel timer-section flow-timer" aria-labelledby="flow-timer-title" aria-busy={busy}>
      <header className="panel-heading"><div><p className="section-label">Din Flow-dag</p>
        <h2 id="flow-timer-title" ref={heading} tabIndex={-1}>Arbeid i dag</h2></div>
        <p className={`timer-status is-${data.phase === 'error' ? 'error' : data.phase === 'running' ? 'running' : data.phase === 'paused' ? 'paused' : disabled ? 'loading' : 'ready'}`} role="status">{status}</p>
      </header>
      {notice}
      <button type="button" className="flow-total" aria-haspopup="dialog" aria-controls="flow-details"
        aria-label={`Vis dagsdetaljer. Arbeid i dag ${formatDuration(totals.work)}`} disabled={!data.data}
        onClick={event => { opener.current = event.currentTarget; setPanel('day') }}>
        <span className="clock-value">{formatDuration(totals.work)}</span><span className="clock-label">Faktisk arbeidstid · Vis dagsdetaljer</span>
      </button>
      {current ? <div className="flow-current">
        <p className="section-label">{open ? 'Nå' : 'Sist'}</p><h3 className="timer-subject">{names.area}</h3>
        <p className="timer-description">{names.task}</p>
        {open && <p className="flow-period"><strong>{formatDuration(totals.current)}</strong><span>denne arbeidsperioden</span></p>}
        {!open && !activityUsable(lastActivity, data.catalog) && <p className="timer-meta">Siste aktivitet er ikke lenger tilgjengelig. Velg en annen aktivitet.</p>}
        <div className="subject-actions timer-controls">
          <button type="button" disabled={disabled} onClick={event => showActivity(event.currentTarget)}>{open ? 'Bytt aktivitet' : 'Velg annen aktivitet'}</button>
          <button type="button" className="secondary-button" disabled={disabled} onClick={event => { if (open) void pause(); else void resume(event.currentTarget) }}>{open ? 'Pause' : 'Fortsett'}</button>
        </div>
        <p className="timer-meta">{current.work_day.logical_date} · {current.work_day.timezone}<br />Dagen avsluttes ved {local(current.work_day.cutoff_at)}. Pause er nok når du er ferdig for nå.</p>
      </div> : <div className="flow-idle">
        <p>Ingen tid teller før du velger en aktivitet.</p>
        <button type="button" disabled={disabled || !data.data?.next_boundary_at} onClick={event => showActivity(event.currentTarget)}>Velg hva du skal jobbe med</button>
        {data.data && !data.data.next_boundary_at && <p role="alert">Tidssonen kan ikke brukes. Kontroller systemets tidssone og hent status på nytt.</p>}
        {data.data?.legacy_active && <p className="timer-meta">Du har en tidligere økt som fortsatt pågår eller er pauset. Den avsluttes og lagres atomisk når du begynner med en Flow-aktivitet.</p>}
      </div>}
      <button type="button" className="text-button timer-refresh" disabled={busy} onClick={() => void data.reload()}>Hent status på nytt</button>
    </section>
    <DetailPanel id="flow-details" open={panel !== null} title={panel === 'day' ? 'Dagsdetaljer' : 'Velg aktivitet'}
      busy={busy} hasForms={false} returnFocus={opener.current} fallbackFocus={heading.current} onClose={() => setPanel(null)}>
      {panel === 'activity' && <form className="flow-picker" onSubmit={choose}>
        {notice}
        <fieldset disabled={disabled}><legend className="sr-only">Velg hva du skal jobbe med</legend>
          <div className="auth-field"><label htmlFor="flow-area">Område</label>
            <select id="flow-area" value={areaId} onChange={event => { setAreaId(event.target.value); setTaskId('') }}>
              <option value="">Annet</option>{activeAreas.map(a => <option key={a.id} value={a.id}>{a.code ? a.code + ' – ' : ''}{a.name}</option>)}
            </select></div>
          {data.catalog.tasks.some(t => t.status === 'active') && <div className="auth-field"><label htmlFor="flow-task">Oppgave (valgfri)</label>
            <select id="flow-task" value={taskId} onChange={event => setTaskId(event.target.value)}>
              <option value="">Ingen spesifikk oppgave</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select></div>}
          <p className="timer-meta">Oppgave er valgfritt. Annet registrerer arbeid uten et navngitt område.</p>
          {data.data?.legacy_active && <p>Den tidligere økten lagres før Flow-arbeidet begynner. Eksisterende arbeid beholdes.</p>}
          <button type="submit">{current ? 'Arbeid med valgt aktivitet' : 'Begynn å arbeide'}</button>
        </fieldset>
        {validation && <p className="auth-error" role="alert">{validation}</p>}
      </form>}
      {panel === 'day' && <div className="flow-day-details">
        {detailDay ? <>
          <p>{detailDay.work_day.logical_date} · {detailDay.work_day.timezone}{detailDay.work_day.ended_at && ' · Sist avsluttede dag i denne fanen'}</p>
          <dl className="flow-day-metrics"><div><dt>Faktisk arbeidstid</dt><dd>{formatDuration(detailTotals.work)}</dd></div>
            <div><dt>Dagen startet</dt><dd>{local(detailDay.work_day.started_at)}</dd></div>
            <div><dt>Total klokketid</dt><dd>{formatDuration(detailTotals.elapsed)}</dd></div>
            <div><dt>Pause</dt><dd>{formatDuration(detailTotals.pause)}</dd></div></dl>
          <h3>Arbeidsperioder</h3><p className="timer-meta">Gap mellom arbeidsperiodene er pauser. Tiden før første aktivitet teller ikke.</p>
          <ol className="flow-period-list">{detailDay.segments.map(s => {
            const label = activityName({ areaId: s.area_id, taskId: s.task_id }, data.catalog)
            return <li key={s.id}><p><time dateTime={s.started_at}>{local(s.started_at)}</time> → {s.ended_at ? <time dateTime={s.ended_at}>{local(s.ended_at)}</time> : 'Pågår'}</p>
              <strong>{label.area}</strong>{s.task_id && <p>{label.task}</p>}</li>
          })}</ol>
        </> : <p>Ingen aktiv Flow-dag. Arbeid i dag er 00:00:00. En ny dag opprettes først når du begynner å arbeide.</p>}
      </div>}
    </DetailPanel>
  </>
}
