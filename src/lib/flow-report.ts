import { dateLabel, flowPeriodLabel } from './flow-statistics.ts'
import type { FlowStatistics } from './flow-statistics.ts'
import { formatDuration } from './study-sessions.ts'

// Presentation only: every total and contribution comes from flow_statistics.
export function reportModel(data: FlowStatistics) {
  const zone = data.period.timezone ?? 'UTC'
  return {
    title: 'Flow arbeidsrapport', period: flowPeriodLabel(data.period), total: formatDuration(data.total),
    generated: new Date(data.server_time).toLocaleString('nb-NO', { timeZone: zone, dateStyle: 'long', timeStyle: 'short' }) + ` (${zone})`,
    legacy: data.contributions.some(c => c.source === 'legacy-study'),
    busiest: data.busiestDay ? dateLabel(data.busiestDay.date) : 'Ingen registrert arbeidstid',
    contributions: data.contributions.map(c => ({
      area: data.areas.find(a => a.id === c.area_id)?.name ?? (c.area_id ? 'Utilgjengelig område' : 'Annet'),
      task: c.source === 'legacy-study' ? 'Uten oppgave / eldre registrering' : c.task_id ? c.title ?? 'Utilgjengelig oppgave' : 'Uten oppgave',
      status: c.status === 'completed' ? 'Fullført' : c.status === 'active' ? 'Aktiv' : '',
      time: formatDuration(c.work), key: `${c.source}:${c.area_id ?? 'none'}:${c.task_id ?? 'none'}`,
    })),
  }
}
