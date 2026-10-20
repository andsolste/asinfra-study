import type { FlowStatistics } from './flow-statistics'

// Entirely invented presentation data. No API, account, UUID or current clock.
const areas = [
  { id: 'example-network', name: 'Nettverk', code: null, is_archived: false, work: 18600000 },
  { id: 'example-os', name: 'Operativsystemer', code: null, is_archived: false, work: 15720000 },
  { id: 'example-project', name: 'Prosjekt', code: null, is_archived: false, work: 9060000 },
  { id: null, name: 'Annet', code: null, is_archived: false, work: 2600000 },
]
const exampleDays = [
  ['2026-10-12', 'Mandag', [3600, 3600, 1800, 600]],
  ['2026-10-13', 'Tirsdag', [5400, 1800, 1200, 300]],
  ['2026-10-14', 'Onsdag', [1800, 3600, 2400, 0]],
  ['2026-10-15', 'Torsdag', [3600, 4200, 1860, 800]],
  ['2026-10-16', 'Fredag', [4200, 2520, 1800, 900]],
  ['2026-10-17', 'Lørdag', [0, 0, 0, 0]],
  ['2026-10-18', 'Søndag', [0, 0, 0, 0]],
] as const
const days = exampleDays.map(([date, label, seconds]) => ({
  date, label, total: seconds.reduce<number>((sum, value) => sum + value, 0) * 1000,
  areas: areas.map((area, i) => ({ ...area, work: seconds[i] * 1000 })),
}))

export const publicWeekExample: FlowStatistics = {
  period: { kind: 'week', anchor: '2026-10-12', from_date: '2026-10-12', to_date: '2026-10-19', timezone: 'UTC' },
  server_time: '2026-10-19T12:00:00Z', legacy_timezone_error: null,
  total: 45980000, areas, days, contributions: [], mostActive: areas[0], busiestDay: days[3],
  task_date: null, task_today: null, task_current: null,
}
