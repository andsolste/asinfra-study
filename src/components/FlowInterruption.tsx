import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'

export default function FlowInterruption({ data }: { data: FlowWorkspaceData }) {
  if (!data.interruption) return null
  const disabled = data.phase !== 'running' || Boolean(data.pending)
  return <section className="flow-interruption" aria-labelledby="flow-interruption-title">
    <div role="status" aria-atomic="true">
      <h2 id="flow-interruption-title">Kontroller timeren</h2>
      <p>Flow fikk ikke oppdatert seg på en stund. Timeren kan ha fortsatt mens appen var inaktiv. Jobbet du hele perioden?</p>
    </div>
    <p className="timer-meta">Tid som allerede er registrert, endres ikke.</p>
    <div className="subject-actions">
      <button type="button" disabled={disabled} onClick={data.dismissInterruption}>Jeg jobbet videre</button>
      <button type="button" className="secondary-button" disabled={disabled} onClick={() => void data.pauseInterruption()}>Pause nå</button>
    </div>
  </section>
}
