import type { SupabaseClient } from '@supabase/supabase-js'
import { absoluteTime, addDays, invalid, logicalDate, mapFlowStatistics, optionalId, periodDates, record, uuid, validZone } from './flow-statistics.ts'
import type { FlowPeriod, FlowStatistics } from './flow-statistics.ts'

export type ExportRow = {
  source: 'flow' | 'legacy-study'; segment_id: string; ordinal: number; flow_date: string; timezone: string
  started_at: string; ended_at: string; work_microseconds: string
  area_id: string | null; area_name: string; area_code: string | null; area_archived: boolean
  task_id: string | null; task_title: string | null; task_status: 'active' | 'completed' | null; task_deadline: string | null; description: string
}
export type ExportCursor = { job: string; after: number }
export type ExportPage = {
  job_id: string; period: FlowStatistics['period']; server_time: string; expires_at: string; total_rows: number
  rows: ExportRow[]; next_cursor: ExportCursor | null; statistics?: FlowStatistics
}
const text = (value: unknown): string => { if (typeof value !== 'string') throw invalid(); return value }
const optionalText = (value: unknown) => value === null ? null : text(value)
const integer = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(); return value }
export function timestampMicroseconds(value: string) {
  absoluteTime(value)
  const fraction = /\.(\d{1,6})/.exec(value)?.[1] ?? ''
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3))
}
export function mapExportPage(value: unknown): ExportPage {
  const data = record(value), p = record(data.period)
  const period: ExportPage['period'] = { kind: p.kind as FlowPeriod['kind'], anchor: p.anchor === null ? null : logicalDate(p.anchor),
    from_date: p.from_date === null ? null : logicalDate(p.from_date), to_date: p.to_date === null ? null : logicalDate(p.to_date), timezone: text(p.timezone) }
  if (!['day', 'week', 'month', 'total'].includes(period.kind) || !validZone(period.timezone)) throw invalid()
  const dates = periodDates(period)
  if (period.kind === 'total' ? period.anchor !== null || period.from_date !== null || period.to_date !== null
    : !dates || dates.from !== period.from_date || dates.to !== period.to_date) throw invalid()
  const job = uuid(data.job_id), server = absoluteTime(data.server_time), expires = absoluteTime(data.expires_at), count = integer(data.total_rows)
  if (Date.parse(expires) <= Date.parse(server) || !Array.isArray(data.rows) || data.rows.length > 500) throw invalid()
  const rows: ExportRow[] = data.rows.map(value => {
    const r = record(value), start = absoluteTime(r.started_at), end = absoluteTime(r.ended_at), date = logicalDate(r.flow_date)
    if (r.source !== 'flow' && r.source !== 'legacy-study' || typeof r.area_archived !== 'boolean' || !validZone(text(r.timezone))
      || typeof r.work_microseconds !== 'string' || !/^[1-9]\d*$/.test(r.work_microseconds)) throw invalid()
    const work = BigInt(r.work_microseconds)
    if (timestampMicroseconds(end) - timestampMicroseconds(start) !== work || timestampMicroseconds(end) > timestampMicroseconds(server)
      || dates && (date < dates.from || date >= dates.to)) throw invalid()
    const taskId = optionalId(r.task_id), status = r.task_status
    if (status !== null && status !== 'active' && status !== 'completed'
      || r.source === 'legacy-study' && (taskId !== null || r.task_title !== null || status !== null || r.task_deadline !== null)) throw invalid()
    return { source: r.source, segment_id: uuid(r.segment_id), ordinal: integer(r.ordinal), flow_date: date, timezone: text(r.timezone),
      started_at: start, ended_at: end, work_microseconds: r.work_microseconds, area_id: optionalId(r.area_id), area_name: text(r.area_name),
      area_code: optionalText(r.area_code), area_archived: r.area_archived, task_id: taskId, task_title: optionalText(r.task_title),
      task_status: status, task_deadline: r.task_deadline === null ? null : absoluteTime(r.task_deadline), description: text(r.description) }
  })
  if (rows.some((r, i) => !r.ordinal || r.ordinal > count || i > 0 && r.ordinal !== rows[i - 1].ordinal + 1)) throw invalid()
  let cursor: ExportCursor | null = null
  if (data.next_cursor !== null) {
    const c = record(data.next_cursor); cursor = { job: uuid(c.job), after: integer(c.after) }
    if (Object.keys(c).length !== 2 || cursor.job !== job || !rows.length || cursor.after !== rows.at(-1)!.ordinal || cursor.after >= count) throw invalid()
  } else if (count && rows.at(-1)?.ordinal !== count) throw invalid()
  if (!rows.length && count) throw invalid()
  const statistics = data.statistics === undefined ? undefined : mapFlowStatistics(data.statistics)
  if (statistics && (JSON.stringify(statistics.period) !== JSON.stringify(period) || statistics.server_time !== server)) throw invalid()
  return { job_id: job, period, server_time: server, expires_at: expires, total_rows: count, rows, next_cursor: cursor, statistics }
}

// CSV quoting is not a formula defence by itself. Neutralize dangerous text,
// including whitespace/control/full-width prefixes. Apostrophe + tab stays data
// in spreadsheet imports (not a promise about arbitrary later save/re-import).
export function csvText(value: string): string {
  const probe = value.normalize('NFKC').replace(/^[\s\p{Cf}\x00-\x1f]+/u, '')
  const dangerous = /^[=+\-@]/.test(probe) || /^[\t\r\n]/.test(value)
  return '"' + (dangerous ? "'\t" + value : value).replaceAll('"', '""') + '"'
}
export const csvHeaders = ['Kilde', 'Flow-dato', 'Tidssone', 'Tidssonegrunnlag', 'Start', 'Slutt', 'Arbeidstid', 'Arbeidstid sekunder',
  'Område', 'Områdekode', 'Områdestatus', 'Oppgave', 'Oppgavestatus', 'Oppgavefrist', 'Beskrivelse'] as const
export const csvHeader = '\uFEFF' + csvHeaders.map(csvText).join(',') + '\r\n'
export function durationSeconds(microseconds: bigint) {
  const fraction = String(microseconds % 1000000n).padStart(6, '0').replace(/0+$/, '')
  return String(microseconds / 1000000n) + (fraction ? '.' + fraction : '')
}
export function durationClock(microseconds: bigint) {
  const seconds = microseconds / 1000000n
  return [seconds / 3600n, seconds / 60n % 60n, seconds % 60n].map(n => String(n).padStart(2, '0')).join(':')
}
export function csvRow(r: ExportRow): string {
  const work = BigInt(r.work_microseconds)
  const values = [r.source === 'flow' ? 'Flow' : 'Eldre registrering', r.flow_date, r.timezone,
    r.source === 'flow' ? 'Lagret Flow-tidssone' : 'Visningstidssone, ikke historisk metadata', r.started_at, r.ended_at, durationClock(work),
    durationSeconds(work), r.area_id === null ? 'Annet' : r.area_name, r.area_code ?? '', r.area_archived ? 'Arkivert' : 'Aktivt',
    r.source === 'legacy-study' ? 'Uten oppgave / eldre registrering' : r.task_id ? r.task_title ?? 'Utilgjengelig oppgave' : 'Uten oppgave',
    r.task_status === 'completed' ? 'Fullført' : r.task_status === 'active' ? 'Aktiv' : '', r.task_deadline ?? '', r.description]
  return values.map((v, i) => i === 7 ? v : csvText(v)).join(',') + '\r\n'
}
export function exportFilename(period: FlowPeriod) {
  const dates = periodDates(period)
  const name = period.kind === 'total' ? 'total' : !dates ? (() => { throw invalid() })()
    : period.kind === 'month' ? dates.from.slice(0, 7) : period.kind === 'week' ? `${dates.from}_til_${addDays(dates.to, -1)}` : dates.from
  return `flow-${name}.csv`
}
export type CsvFile = { content: string; filename: string; count: number }
export function downloadCsv(file: CsvFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = file.filename
  document.body.append(link)
  try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
function exportError(error: { code?: string } | null) {
  return new Error(error?.code === '40001' ? 'Dataene ble endret under eksporten. Start på nytt. Ingen delvis fil er lastet ned.'
    : error?.code === '22023' ? 'Kontroller periode og gyldig visningstidssone. Ingen delvis fil er lastet ned.'
    : 'Eksporten kunne ikke fullføres eller er utløpt. Prøv igjen. Ingen delvis fil er lastet ned.')
}
export function createExportApi(client: Pick<SupabaseClient, 'rpc'>) {
  return {
    async start(period: FlowPeriod, timezone: string | null, signal: AbortSignal) {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('flow_export_start', { p_kind: period.kind, p_date: period.anchor, p_timezone: timezone }).abortSignal(signal)
      signal.throwIfAborted(); if (error) throw exportError(error)
      const page = mapExportPage(data)
      if (!page.statistics || page.period.kind !== period.kind || period.anchor && periodDates(period)?.from !== page.period.from_date) throw invalid()
      return page
    },
    async page(cursor: ExportCursor, signal: AbortSignal) {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('flow_export_rows', { p_cursor: cursor, p_limit: 500 }).abortSignal(signal)
      signal.throwIfAborted(); if (error) throw exportError(error)
      const page = mapExportPage(data)
      if (page.job_id !== cursor.job || page.rows[0]?.ordinal !== cursor.after + 1) throw invalid()
      return page
    },
    async discard(id: string) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000)
      try { await client.rpc('flow_export_discard', { p_job_id: id }).abortSignal(controller.signal) } catch { /* TTL + next start also clean up. */ }
      finally { clearTimeout(timeout) }
    },
  }
}
