import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'

export default function FlowFeedback({ data }: { data: FlowWorkspaceData }) {
  const busy = data.phase === 'loading' || data.phase === 'recovering'
  return <>
    {data.notice && <p role="status">{data.notice}</p>}
    {data.error && <div className="recovery-message" role="alert"><p>{data.error}</p>
      <div className="subject-actions"><button type="button" disabled={busy} onClick={() => void data.reload()}>Hent status</button>
        {data.pending && <button type="button" className="secondary-button" disabled={busy} onClick={() => void data.retry()}>Prøv samme handling igjen</button>}
      </div></div>}
  </>
}
