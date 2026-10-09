import { localWeek, weekLabel, workMilliseconds } from './history-time.ts'
import type { TimeInterval } from './history-time.ts'
import type { HistoryEntry } from './study-history.ts'

export type PeriodKind = 'day' | 'week' | 'month'
export type StatisticsPeriod = TimeInterval & { kind: PeriodKind }
export type SubjectWork = { id: string | null; name: string; code: string | null; work: number }
export type DayWork = TimeInterval & { label: string; total: number; subjects: SubjectWork[] }

// All boundaries are browser-local calendar boundaries, sent to the RPC as absolute ISO times.
export function localPeriod(kind: PeriodKind, date = new Date()): StatisticsPeriod {
  if (kind === 'week') return { kind, ...localWeek(date) }
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  if (kind === 'month') start.setDate(1)
  const end = new Date(start)
  if (kind === 'month') end.setMonth(end.getMonth() + 1)
  else end.setDate(end.getDate() + 1)
  return { kind, from: start.toISOString(), to: end.toISOString() }
}

export function shiftPeriod(period: StatisticsPeriod, direction: -1 | 1) {
  const date = new Date(period.from)
  if (period.kind === 'month') date.setMonth(date.getMonth() + direction)
  else date.setDate(date.getDate() + direction * (period.kind === 'week' ? 7 : 1))
  return localPeriod(period.kind, date)
}

export function changePeriodKind(period: StatisticsPeriod, kind: PeriodKind, now = new Date()) {
  // Current periods switch around today; a past/future selection stays around its first day.
  const anchor = now.getTime() >= Date.parse(period.from) && now.getTime() < Date.parse(period.to)
    ? now : new Date(period.from)
  return localPeriod(kind, anchor)
}

export function periodLabel(period: StatisticsPeriod) {
  if (period.kind === 'week') return weekLabel(period)
  return new Date(period.from).toLocaleDateString('nb-NO', period.kind === 'day'
    ? { day: 'numeric', month: 'long', year: 'numeric' } : { month: 'long', year: 'numeric' })
}

export function localDays(interval: TimeInterval): DayWork[] {
  const days: DayWork[] = []
  const date = new Date(interval.from)
  while (date.getTime() < Date.parse(interval.to)) {
    const from = date.toISOString()
    date.setDate(date.getDate() + 1)
    days.push({ from, to: date.toISOString(), label: new Date(from).toLocaleDateString('nb-NO',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), total: 0, subjects: [] })
  }
  return days
}

const subjectOrder = (a: SubjectWork, b: SubjectWork) => b.work - a.work
  || a.name.localeCompare(b.name, 'nb-NO') || (a.id ?? '').localeCompare(b.id ?? '')

export function summarizeStatistics(entries: HistoryEntry[], period: StatisticsPeriod) {
  const days = localDays(period)
  const subjects = new Map<string | null, SubjectWork>()
  for (const day of days) {
    const daily = new Map<string | null, SubjectWork>()
    for (const entry of entries) {
      const work = workMilliseconds(entry.segments, day)
      if (!work) continue
      const id = entry.session.subject_id
      const subject = daily.get(id) ?? { id, name: entry.subject?.name ?? 'Uten fag', code: entry.subject?.code ?? null, work: 0 }
      subject.work += work
      daily.set(id, subject)
    }
    day.subjects = [...daily.values()].sort(subjectOrder)
    day.total = day.subjects.reduce((sum, subject) => sum + subject.work, 0)
    for (const subject of day.subjects) {
      const total = subjects.get(subject.id) ?? { ...subject, work: 0 }
      total.work += subject.work
      subjects.set(subject.id, total)
    }
  }
  const ordered = [...subjects.values()].sort(subjectOrder)
  // Strictly greater preserves the first (earliest) day in a tie. Empty periods have no winner.
  const busiestDay = days.reduce<DayWork | null>((best, day) => day.total > (best?.total ?? 0) ? day : best, null)
  return { days, subjects: ordered, total: days.reduce((sum, day) => sum + day.total, 0),
    mostStudied: ordered[0] ?? null, busiestDay }
}
export type StatisticsSummary = ReturnType<typeof summarizeStatistics>

export const subjectPalette = ['#A78BFA', '#60A5FA', '#22D3EE', '#4ADE80', '#FBBF24', '#F472B6', '#818CF8', '#2DD4BF']

export function subjectAppearance(id: string | null) {
  if (id === null) return { color: '#94A3B8', pattern: 0 }
  let hash = 2166136261
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0
  // Stable color AND texture, independent of the selected period or subject ordering.
  // Textures distinguish many palette collisions without moving existing colors around.
  return { color: subjectPalette[hash % subjectPalette.length], pattern: (hash >>> 8) % 4 }
}

export function chartScale(maximum: number) {
  const minutes = Math.max(1, maximum / 4 / 60000)
  // Clock-friendly ticks (15/30 minutes, whole hours), rather than decimal-hour clutter.
  const dayMagnitude = 10 ** Math.floor(Math.log10(minutes / 1440))
  const largeStep = ([1, 2, 5, 10].find(value => value >= minutes / 1440 / dayMagnitude) ?? 10) * dayMagnitude * 1440
  const step = ([1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].find(value => value >= minutes) ?? largeStep) * 60000
  const max = Math.max(step, Math.ceil(maximum / step) * step)
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) }
}

export function axisTime(milliseconds: number) {
  const minutes = milliseconds / 60000
  return minutes >= 60 ? `${Number((minutes / 60).toFixed(2))} t` : `${minutes} min`
}

export function dayAxisLabel(day: DayWork, kind: PeriodKind, index: number, count: number) {
  const date = new Date(day.from)
  if (kind === 'week') return date.toLocaleDateString('nb-NO', { weekday: 'short' }).replace('.', '')
  const number = date.getDate()
  return index === 0 || index === count - 1 || number % 5 === 0 ? String(number) : ''
}
