import { useRef, useState } from 'react'
import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import type { FlowHistoryData } from '../hooks/useFlowHistory'
import type { FlowSnapshot } from '../lib/flow-work'
import type { FlowWorkSegment } from '../types/flow'
import type { NativeSegmentCorrection } from '../lib/native-period'
import { interruptedPeriod, sameNativeValues } from '../lib/native-period'
import NativePeriodForm from './NativePeriodForm'

export default function FlowInterruption({ data, history, onCorrect }: {
  data: FlowWorkspaceData; history: FlowHistoryData; onCorrect: (input: NativeSegmentCorrection) => Promise<boolean>
}) {
  const [editor, setEditor] = useState<{ snapshot: FlowSnapshot; segment: FlowWorkSegment; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const busy = history.mutation !== null
  const disabled = data.phase !== 'running' || Boolean(data.pending) || busy
  const current = data.data?.current
  const original = editor && current?.work_day.id === editor.snapshot.work_day.id && current.segments.length === editor.count
    ? current.segments.find(s => s.id === editor.segment.id) : null
  const stale = Boolean(editor && ['running', 'paused', 'idle'].includes(data.phase) && (!original || !sameNativeValues(original, editor.segment)))
  function close() {
    setEditor(null); setError(null)
    requestAnimationFrame(() => {
      const target = opener.current?.isConnected && opener.current.getClientRects().length ? opener.current : document.getElementById('study-content')
      target?.focus()
    })
  }
  function open() {
    const notice = data.interruption, segment = interruptedPeriod(current, notice)
    if (disabled || !notice || !current || !segment) {
      setError('Aktiviteten er endret. Henter status; dette varslet kan ikke korrigere en ny periode.'); void data.reload(); return
    }
    history.prepareCorrection(); setError(null); setEditor({ snapshot: current, segment, count: notice.count })
  }
  if (!data.interruption && !editor && !error) return null
  return <section className="flow-interruption" aria-labelledby="flow-interruption-title">
    <div role="status" aria-atomic="true">
      <h2 id="flow-interruption-title">Kontroller timeren</h2>
      <p>Flow fikk ikke oppdatert seg på en stund. Timeren kan ha fortsatt mens appen var inaktiv. Jobbet du hele perioden?</p>
    </div>
    <p className="timer-meta">Pause nå stopper på serverens nåtid. Tid som allerede er registrert, endres ikke av Pause nå. Korriger tid lar deg velge når du faktisk sluttet.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {editor ? <NativePeriodForm snapshot={editor.snapshot} segment={editor.segment} catalog={data.catalog} now={() => data.now} finishOnly
      busy={busy} blocked={stale || history.correctionBlocked === editor.segment.id} disabled={data.phase !== 'running' || !!data.pending || history.status !== 'ready'} error={stale ? 'Arbeidsperioden er endret. Avbryt og kontroller oppdatert status.' : history.error}
      onClose={close} onSave={async input => {
        if (stale || data.phase !== 'running' || data.pending) { void data.reload(); return false }
        return onCorrect(input)
      }} /> : <div className="subject-actions">
      <button type="button" disabled={disabled} onClick={data.dismissInterruption}>Jeg jobbet videre</button>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => void data.pauseInterruption()}>Pause nå</button>
      <button ref={opener} type="button" className="secondary-button" disabled={disabled} onClick={open}>Korriger tid</button>
    </div>}
  </section>
}
