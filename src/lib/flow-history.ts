import type { SupabaseClient } from '@supabase/supabase-js'
import { mapFlowSnapshot, flowDurations } from './flow-work.ts'
import type { FlowSnapshot } from './flow-work.ts'
import { createHistoryApi, mapHistoryEntry } from './study-history.ts'
import type { HistoryEntry, HistoryEdit } from './study-history.ts'
import { absoluteTime, invalid, record, uuid } from './flow-statistics.ts'
import { timestampMicroseconds as micros } from './time-precision.ts'
import { correctionMatches } from './native-period.ts'
import type { NativeSegmentCorrection } from './native-period.ts'
export type { NativeSegmentCorrection } from './native-period.ts'

export class NativeCorrectionError extends Error {
  kind: 'conflict' | 'validation' | 'unknown'
  constructor(kind: NativeCorrectionError['kind'], message: string) { super(message); this.kind = kind }
}
function correctionError(code?: string) {
  if (code === '40001' || code === '42501') return new NativeCorrectionError('conflict', 'Arbeidsperioden er endret eller utilgjengelig. Hent på nytt og åpne editoren igjen.')
  const messages: Record<string, string> = { '22023': 'Tidspunktene må ligge innenfor arbeidsdagen, med slutt lik eller etter start.',
    '22007': 'Kontroller dato og klokkeslett.', '22008': 'Sluttid kan ikke være i fremtiden.', '23P01': 'Perioden overlapper annet registrert arbeid.',
    '23503': 'Området eller oppgaven er ikke gyldig for denne perioden.', '23514': 'Perioden bryter arbeidsdagens grenser eller tilknytningsregler.' }
  return messages[code ?? ''] ? new NativeCorrectionError('validation', messages[code!])
    : new NativeCorrectionError('unknown', 'Korrigeringen kunne ikke bekreftes. Hent status før du prøver igjen.')
}

export type HistoryCursor = { at: string; source: 'flow' | 'legacy-study'; id: string }
export type FlowHistoryEntry = { key: string; started_at: string } & (
  | { source: 'flow'; id: string; snapshot: FlowSnapshot }
  | { source: 'legacy-study'; id: string; snapshot: HistoryEntry }
)
export type FlowHistoryPage = { rows: FlowHistoryEntry[]; next_cursor: HistoryCursor | null; server_time: string }
export type AttributionEdit = { segmentId: string; areaId: string | null; taskId: string | null; expectedAreaId: string | null; expectedTaskId: string | null }
export function mapFlowHistoryPage(value: unknown): FlowHistoryPage {
  const row = record(value), server = absoluteTime(row.server_time)
  if (!Array.isArray(row.rows)) throw invalid()
  const rows: FlowHistoryEntry[] = row.rows.map(value => {
    const entry = record(value), id = uuid(entry.id), started = absoluteTime(entry.started_at)
    const common = { id, started_at: started, key: `${entry.source}:${id}` }
    if (entry.source === 'flow') {
      const snapshot = mapFlowSnapshot(entry.snapshot)
      if (!snapshot || snapshot.work_day.id !== id || snapshot.work_day.started_at !== started || !snapshot.work_day.ended_at && Date.parse(snapshot.work_day.cutoff_at) > Date.parse(server)) throw invalid()
      return { ...common, source: 'flow', snapshot }
    }
    if (entry.source !== 'legacy-study') throw invalid()
    const snapshot = mapHistoryEntry(entry.snapshot)
    if (snapshot.session.id !== id || snapshot.session.started_at !== started) throw invalid()
    return { ...common, source: 'legacy-study', snapshot }
  })
  if (new Set(rows.map(r => r.key)).size !== rows.length || rows.some((r, i) => i > 0 && Date.parse(r.started_at) > Date.parse(rows[i - 1].started_at))) throw invalid()
  let cursor: HistoryCursor | null = null
  if (row.next_cursor !== null) {
    const c = record(row.next_cursor), last = rows.at(-1)
    if (c.source !== 'flow' && c.source !== 'legacy-study') throw invalid()
    cursor = { at: absoluteTime(c.at), source: c.source, id: uuid(c.id) }
    if (!last || last.source !== cursor.source || last.id !== cursor.id || last.started_at !== cursor.at) throw invalid()
  }
  return { rows, next_cursor: cursor, server_time: server }
}
export type TimelinePeriod = { key: string; kind: 'work' | 'pause'; start: string; end: string; areaId: string | null; taskId: string | null; segmentId?: string }
export function dayTimeline(snapshot: FlowSnapshot): TimelinePeriod[] {
  const periods: TimelinePeriod[] = [], d = snapshot.work_day
  const earlier = (a: string, b: string) => micros(a) <= micros(b) ? a : b
  const end = [d.ended_at ?? d.cutoff_at, d.cutoff_at, snapshot.server_time].reduce(earlier)
  let previous = d.started_at
  for (const s of snapshot.segments) {
    const start = s.started_at, stop = earlier(s.ended_at ?? d.cutoff_at, end)
    if (micros(start) > micros(previous)) periods.push({ key: 'pause:' + s.id, kind: 'pause', start: previous, end: start, areaId: null, taskId: null })
    if (micros(stop) >= micros(start)) periods.push({ key: 'work:' + s.id, kind: 'work', start, end: stop, areaId: s.area_id, taskId: s.task_id, segmentId: s.id })
    if (micros(stop) > micros(previous)) previous = stop
  }
  if (snapshot.segments.length && micros(previous) < micros(end)) periods.push({ key: 'trailing-pause', kind: 'pause', start: previous, end, areaId: null, taskId: null })
  return periods
}
export const nativeHistoryWork = (snapshot: FlowSnapshot) => flowDurations(snapshot, Date.parse(snapshot.server_time)).work
export function createFlowHistoryApi(client: Pick<SupabaseClient, 'rpc'>) {
  const legacy = createHistoryApi(client, 'flow_history_edit_legacy')
  return {
    async list(cursor: HistoryCursor | null, signal: AbortSignal): Promise<FlowHistoryPage> {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('flow_history', { p_limit: 25, p_cursor: cursor }).abortSignal(signal)
      signal.throwIfAborted()
      if (error) throw new Error('Kunne ikke hente Flow-historikken.')
      const page = mapFlowHistoryPage(data)
      if (page.rows.length > 25) throw invalid()
      return page
    },
    editLegacy: (id: string, input: HistoryEdit, signal: AbortSignal) => legacy.edit(id, input, signal),
    removeLegacy: (id: string, signal: AbortSignal) => legacy.remove(id, signal),
    async nativeSnapshot(dayId: string, signal: AbortSignal) {
      const { data, error } = await client.rpc('flow_work_day_snapshot', { p_work_day_id: dayId }).abortSignal(signal)
      signal.throwIfAborted()
      if (error) throw correctionError()
      const snapshot = mapFlowSnapshot(data)
      if (!snapshot || snapshot.work_day.id !== dayId) throw correctionError()
      return snapshot
    },
    async correctNative(input: NativeSegmentCorrection, signal: AbortSignal) {
      signal.throwIfAborted()
      const { expected: e, desired: d } = input
      const { data, error } = await client.rpc('flow_work_segment_correct', { p_segment_id: input.segmentId, p_work_day_id: input.dayId,
        p_expected_started_at: e.started_at, p_expected_ended_at: e.ended_at, p_expected_area_id: e.area_id, p_expected_task_id: e.task_id,
        p_started_at: d.started_at, p_ended_at: d.ended_at, p_area_id: d.area_id, p_task_id: d.task_id }).abortSignal(signal)
      signal.throwIfAborted()
      if (error) throw correctionError(error.code)
      const snapshot = mapFlowSnapshot(data)
      if (!correctionMatches(snapshot, input)) throw correctionError()
      return snapshot
    },
    async attribute(input: AttributionEdit, signal: AbortSignal) {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('flow_history_attribute', { p_segment_id: input.segmentId, p_area_id: input.areaId, p_task_id: input.taskId,
        p_expected_area_id: input.expectedAreaId, p_expected_task_id: input.expectedTaskId }).abortSignal(signal)
      signal.throwIfAborted()
      if (error || uuid(data) !== input.segmentId) throw new Error('Kunne ikke bekrefte korrigeringen. Hent historikken på nytt.')
    },
  }
}
