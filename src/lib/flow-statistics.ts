import type { SupabaseClient } from '@supabase/supabase-js'
import { browserTimezone } from './flow-work.ts'
import { axisTime, chartScale, subjectAppearance } from './statistics.ts'
export { axisTime, chartScale, subjectAppearance as areaAppearance }

export type PeriodKind = 'day' | 'week' | 'month' | 'total'
export type FlowPeriod = { kind: PeriodKind; anchor: string | null }
export type AreaWork = { id: string | null; name: string; code: string | null; is_archived: boolean; work: number }
export type LogicalDayWork = { date: string; label: string; total: number; areas: AreaWork[] }
export type Contribution = { area_id: string | null; task_id: string | null; source: 'flow' | 'legacy-study'; title: string | null; status: string | null; work: number }
export type FlowStatistics = {
  period: FlowPeriod & { from_date: string | null; to_date: string | null; timezone: string | null }
  server_time: string; legacy_timezone_error: string | null; total: number; areas: AreaWork[]; days: LogicalDayWork[]
  contributions: Contribution[]; mostActive: AreaWork | null; busiestDay: LogicalDayWork | null
  task_date: string | null; task_today: number | null; task_current: number | null
}
export type AreaStatistics = Record<'day' | 'week' | 'month', FlowStatistics | null> & { total: FlowStatistics }
export const invalid = () => new Error('Ugyldige historikk-/statistikkdata. Hent på nytt.')
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw invalid()
  return value
}
export const optionalId = (value: unknown) => value === null ? null : uuid(value)
export function absoluteTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid()
  return value
}
export function logicalDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) throw invalid()
  const date = new Date(value + 'T12:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw invalid()
  return value
}
export function milliseconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid()
  return value
}
const optionalDate = (value: unknown) => value === null ? null : logicalDate(value)
const optionalNumber = (value: unknown) => value === null ? null : milliseconds(value)
export function validZone(zone: string | null) {
  try { if (zone !== 'UTC' && !zone?.includes('/')) return false; new Intl.DateTimeFormat('en', { timeZone: zone! }).format(0); return true } catch { return false }
}
// Date-only arithmetic is independent of browser timezone. Absolute 04:00 bounds
// are calculated by PostgreSQL, not by adding a fixed 24-hour duration in JS.
export function addDays(date: string, count: number) {
  const value = new Date(logicalDate(date) + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + count)
  return value.toISOString().slice(0, 10)
}
export function currentLogicalDate(now = Date.now(), zone: string | null = browserTimezone()): string | null {
  if (!validZone(zone)) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone!, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const part = (name: string) => parts.find(p => p.type === name)!.value
  const date = `${part('year')}-${part('month')}-${part('day')}`
  return Number(part('hour')) < 4 ? addDays(date, -1) : date
}
export function currentPeriod(kind: PeriodKind, now = Date.now(), zone: string | null = browserTimezone()): FlowPeriod {
  return { kind, anchor: kind === 'total' ? null : currentLogicalDate(now, zone) }
}
export function periodDates(period: FlowPeriod) {
  if (period.kind === 'total') return null
  if (!period.anchor) return null
  const date = new Date(logicalDate(period.anchor) + 'T12:00:00Z')
  if (period.kind === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  if (period.kind === 'month') date.setUTCDate(1)
  const from = date.toISOString().slice(0, 10)
  if (period.kind === 'month') date.setUTCMonth(date.getUTCMonth() + 1)
  else date.setUTCDate(date.getUTCDate() + (period.kind === 'week' ? 7 : 1))
  return { from, to: date.toISOString().slice(0, 10) }
}
export function shiftFlowPeriod(period: FlowPeriod, direction: -1 | 1): FlowPeriod {
  const dates = periodDates(period)
  if (!dates) return period
  if (period.kind !== 'month') return { ...period, anchor: addDays(dates.from, direction * (period.kind === 'week' ? 7 : 1)) }
  const date = new Date(dates.from + 'T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + direction)
  return { ...period, anchor: date.toISOString().slice(0, 10) }
}
export function changeFlowKind(period: FlowPeriod, kind: PeriodKind, now = Date.now(), zone: string | null = browserTimezone(), nativeToday: string | null = null): FlowPeriod {
  if (kind === 'total') return { kind, anchor: null }
  const dates = periodDates(period), today = nativeToday ?? currentLogicalDate(now, zone)
  return { kind, anchor: !dates || (today && today >= dates.from && today < dates.to) ? today : dates.from }
}
export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Date(logicalDate(date) + 'T12:00:00Z').toLocaleDateString('nb-NO', { ...options, timeZone: 'UTC' })
}
export function flowPeriodLabel(period: FlowPeriod) {
  if (period.kind === 'total') return 'All registrert arbeidstid'
  const dates = periodDates(period)
  if (!dates) return 'Velg en gyldig visningstidssone'
  if (period.kind === 'month') return dateLabel(dates.from, { month: 'long', year: 'numeric' })
  return period.kind === 'week' ? dateLabel(dates.from) + ' – ' + dateLabel(addDays(dates.to, -1)) : dateLabel(dates.from)
}
export function logicalDayAxisLabel(day: LogicalDayWork, kind: PeriodKind, index: number, count: number) {
  if (kind === 'week') return dateLabel(day.date, { weekday: 'short' }).replace('.', '')
  const number = Number(day.date.slice(8)); return index === 0 || index === count - 1 || number % 5 === 0 ? String(number) : ''
}
export function mapFlowStatistics(value: unknown): FlowStatistics {
  const row = record(value), p = record(row.period)
  if (!['day', 'week', 'month', 'total'].includes(String(p.kind)) || !Array.isArray(row.areas) || !Array.isArray(row.days) || !Array.isArray(row.contributions)) throw invalid()
  const period = { kind: p.kind as PeriodKind, anchor: optionalDate(p.anchor), from_date: optionalDate(p.from_date), to_date: optionalDate(p.to_date),
    timezone: p.timezone === null ? null : typeof p.timezone === 'string' && validZone(p.timezone) ? p.timezone : (() => { throw invalid() })() }
  const dates = periodDates(period)
  if (period.kind === 'total' ? period.from_date !== null || period.to_date !== null || row.days.length !== 0 : !dates || dates.from !== period.from_date || dates.to !== period.to_date) throw invalid()
  const areas: AreaWork[] = row.areas.map(value => {
    const a = record(value)
    if (typeof a.name !== 'string' || typeof a.is_archived !== 'boolean' || (a.code !== null && typeof a.code !== 'string')) throw invalid()
    return { id: optionalId(a.id), name: a.name, code: a.code as string | null, is_archived: a.is_archived, work: milliseconds(a.work) }
  })
  if (new Set(areas.map(a => a.id)).size !== areas.length) throw invalid()
  const days = row.days.map((value, index) => {
    const d = record(value), date = logicalDate(d.date)
    if (!dates || date !== addDays(dates.from, index) || !Array.isArray(d.areas)) throw invalid()
    const daily = d.areas.map(value => {
      const a = record(value), id = optionalId(a.id), metadata = areas.find(a => a.id === id)
      if (!metadata) throw invalid()
      return { ...metadata, work: milliseconds(a.work) }
    })
    if (new Set(daily.map(a => a.id)).size !== daily.length) throw invalid()
    return { date, label: dateLabel(date), total: milliseconds(d.total), areas: daily }
  })
  if (dates && (days.length === 0 || addDays(days.at(-1)!.date, 1) !== dates.to)) throw invalid()
  const contributions: Contribution[] = row.contributions.map(value => {
    const c = record(value)
    if (c.source !== 'flow' && c.source !== 'legacy-study') throw invalid()
    const taskId = optionalId(c.task_id)
    if (c.source === 'legacy-study' && taskId !== null || c.title !== null && typeof c.title !== 'string' || c.status !== null && !['active', 'completed'].includes(String(c.status))) throw invalid()
    return { area_id: optionalId(c.area_id), task_id: taskId, source: c.source, title: c.title as string | null, status: c.status as string | null, work: milliseconds(c.work) }
  })
  const total = milliseconds(row.total), equal = (a: number, b: number) => Math.abs(a - b) <= Math.max(.01, a * 1e-12)
  if (!equal(total, areas.reduce((n, a) => n + a.work, 0)) || !equal(total, contributions.reduce((n, c) => n + c.work, 0))
    || (period.kind !== 'total' && !equal(total, days.reduce((n, d) => n + d.total, 0))) || days.some(d => !equal(d.total, d.areas.reduce((n, a) => n + a.work, 0)))) throw invalid()
  const busiestDay = days.reduce<LogicalDayWork | null>((best, d) => d.total > (best?.total ?? 0) ? d : best, null)
  return { period, total, areas, days, contributions, busiestDay, mostActive: areas.find(a => a.work > 0) ?? null, server_time: absoluteTime(row.server_time),
    legacy_timezone_error: row.legacy_timezone_error === null ? null : typeof row.legacy_timezone_error === 'string' ? row.legacy_timezone_error : (() => { throw invalid() })(),
    task_date: optionalDate(row.task_date), task_today: optionalNumber(row.task_today), task_current: optionalNumber(row.task_current) }
}
export function createStatisticsApi(client: Pick<SupabaseClient, 'rpc'>) {
  return {
    async statistics(period: FlowPeriod, timezone: string | null, signal: AbortSignal, taskId: string | null = null) {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('flow_statistics', { p_kind: period.kind, p_date: period.anchor, p_timezone: timezone, p_task_id: taskId }).abortSignal(signal)
      signal.throwIfAborted()
      if (error) throw new Error('Kunne ikke hente statistikken. Kontroller visningstidssonen eller prøv igjen.')
      const result = mapFlowStatistics(data)
      if (result.period.kind !== period.kind || period.anchor && periodDates(result.period)?.from !== periodDates(period)?.from) throw invalid()
      return result
    },
    async area(areaId: string | null, timezone: string | null, signal: AbortSignal): Promise<AreaStatistics> {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('flow_area_statistics', { p_area_id: areaId, p_timezone: timezone }).abortSignal(signal)
      signal.throwIfAborted()
      if (error) throw new Error('Kunne ikke hente områdestatistikken. Kontroller tidssonen eller prøv igjen.')
      const row = record(data)
      const result = { day: row.day === null ? null : mapFlowStatistics(row.day), week: row.week === null ? null : mapFlowStatistics(row.week), month: row.month === null ? null : mapFlowStatistics(row.month), total: mapFlowStatistics(row.total) }
      for (const [kind, stats] of Object.entries(result)) if (stats && (stats.period.kind !== kind || stats.areas.some(a => a.id !== areaId))) throw invalid()
      return result
    },
  }
}
