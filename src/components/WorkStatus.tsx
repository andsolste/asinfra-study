import type { FlowWorkspaceData } from '../hooks/useFlowWorkDay'
import type { FlowLocation } from '../lib/flow-navigation'
import { flowLocationUrl } from '../lib/flow-navigation'
import { activityName } from '../lib/flow-work'
import { followFlowLink } from './FlowNavigation'

export default function WorkStatus({ data, location, navigate }: {
  data: FlowWorkspaceData; location: FlowLocation; navigate: (next: FlowLocation) => void
}) {
  if (location.view === 'work') return null
  const current = data.data?.current
  const segment = current?.segments.find(s => s.ended_at === null)
    ?? (data.phase === 'paused' ? current?.segments.at(-1) : undefined)
  let label: string
  if (data.phase === 'recovering') label = 'Kontrollerer arbeidsstatus …'
  else if (data.phase === 'error') label = 'Arbeidsstatus må kontrolleres'
  else if (segment) {
    const names = activityName({ areaId: segment.area_id, taskId: segment.task_id }, data.catalog)
    label = `${data.phase === 'paused' ? 'Pauset · Siste aktivitet' : 'Arbeider'} · ${names.area}${segment.task_id ? ` · ${names.task}` : ''}`
  } else return null
  const next = { ...location, view: 'work' } as const
  return <p className="work-status" role="status">
    <a href={flowLocationUrl(window.location.href, next)} onClick={event => followFlowLink(event, () => navigate(next))}>
      <span className="work-status-label">{label}</span><span className="work-status-link">Til Arbeid →</span>
    </a>
  </p>
}
