import type { SupabaseClient } from '@supabase/supabase-js'
import { mapFlowSnapshot, flowDurations } from './flow-work.ts'
import type { FlowSnapshot } from './flow-work.ts'
import { createHistoryApi, mapHistoryEntry } from './study-history.ts'
import type { HistoryEntry, HistoryEdit } from './study-history.ts'
import { absoluteTime, invalid, record, uuid } from './flow-statistics.ts'

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
  const end = Math.min(Date.parse(d.ended_at ?? d.cutoff_at), Date.parse(d.cutoff_at), Date.parse(snapshot.server_time))
  let previous = Date.parse(d.started_at)
  for (const s of snapshot.segments) {
    const start = Date.parse(s.started_at), stop = Math.min(Date.parse(s.ended_at ?? d.cutoff_at), end)
    if (start > previous) periods.push({ key: 'pause:' + s.id, kind: 'pause', start: new Date(previous).toISOString(), end: s.started_at, areaId: null, taskId: null })
    if (stop >= start) periods.push({ key: 'work:' + s.id, kind: 'work', start: s.started_at, end: s.ended_at && Date.parse(s.ended_at) <= end ? s.ended_at : new Date(stop).toISOString(), areaId: s.area_id, taskId: s.task_id, segmentId: s.id })
    previous = Math.max(previous, stop)
  }
  if (snapshot.segments.length && previous < end) periods.push({ key: 'trailing-pause', kind: 'pause', start: new Date(previous).toISOString(), end: new Date(end).toISOString(), areaId: null, taskId: null })
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
    async attribute(input: AttributionEdit, signal: AbortSignal) {
      signal.throwIfAborted()
      const { data, error } = await client.rpc('flow_history_attribute', { p_segment_id: input.segmentId, p_area_id: input.areaId, p_task_id: input.taskId,
        p_expected_area_id: input.expectedAreaId, p_expected_task_id: input.expectedTaskId }).abortSignal(signal)
      signal.throwIfAborted()
      if (error || uuid(data) !== input.segmentId) throw new Error('Kunne ikke bekrefte korrigeringen. Hent historikken på nytt.')
    },
  }
}
