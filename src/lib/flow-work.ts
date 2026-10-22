import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlowArea, FlowTask, FlowWorkDay, FlowWorkSegment } from '../types/flow.ts'
import { createTaskApi } from './flow-tasks.ts'
import { timestampMicroseconds as micros, serverClockMicroseconds, minMicroseconds, positiveMicroseconds, durationMilliseconds as milliseconds, segmentMicroseconds } from './time-precision.ts'

export type FlowActivity = { areaId: string | null; taskId: string | null }
export type FlowSnapshot = { work_day: FlowWorkDay; segments: FlowWorkSegment[]; server_time: string }
export type FlowState = { current: FlowSnapshot | null; server_time: string; next_boundary_at: string | null; next_cutoff_at: string | null; legacy_active: boolean }
export type FlowCatalog = { areas: FlowArea[]; tasks: FlowTask[] }
export class FlowActionError extends Error {
  constructor(reason: 'legacy-time' | 'boundary' | 'ended-day' | 'unknown') {
    super({ 'legacy-time': 'En tidligere registrering har tid i fremtiden. Korriger den i Historikk før du starter Flow.',
      boundary: 'Flow-dagens grense er endret. Velg aktiviteten på nytt etter statuskontrollen.',
      'ended-day': 'Denne logiske Flow-dagen er allerede avsluttet og kan ikke gjenåpnes. Kontroller den lokale tidssonen.',
      unknown: 'Aktiviteten kunne ikke bekreftes. Kontroller status før du prøver igjen.' }[reason])
  }
}
export type FlowCommand =
  | ({ kind: 'start'; dayId: string; segmentId: string; timezone: string; boundary: string } & FlowActivity)
  | ({ kind: 'activity'; dayId: string; expectedId: string | null; expectedCount: number; nextId: string | null } & FlowActivity)

const invalid = () => new Error('Ugyldige Flow-data. Hent status på nytt.')
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw invalid()
  return value
}
const optionalId = (value: unknown) => value === null ? null : id(value)
function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || Array.from(value).length > max || (nonempty && !value.trim())) throw invalid()
  return value
}
function timestamp(value: unknown): string {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value) : null
  if (!match || !Number.isFinite(Date.parse(value as string))) throw invalid()
  const check = new Date(0)
  check.setUTCFullYear(+match[1], +match[2] - 1, +match[3])
  if (check.getUTCMonth() !== +match[2] - 1 || check.getUTCDate() !== +match[3] || +match[4] > 23 || +match[5] > 59 || +match[6] > 59) throw invalid()
  return value as string
}
const optionalTime = (value: unknown) => value === null ? null : timestamp(value)
export function browserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone === 'UTC' || zone.includes('/') ? zone : null
  } catch { return null }
}
export function mapFlowArea(value: unknown): FlowArea {
  const source = row(value)
  if (typeof source.is_archived !== 'boolean') throw invalid()
  return { id: id(source.id), name: text(source.name, 120, true), code: source.code === null ? null : text(source.code, 32),
    is_archived: source.is_archived, created_at: timestamp(source.created_at) }
}
export function mapFlowTask(value: unknown): FlowTask {
  const source = row(value), status = source.status, completed = optionalTime(source.completed_at)
  const fields = { id: id(source.id), area_id: optionalId(source.area_id), title: text(source.title, 200, true),
    description: text(source.description, 2000), deadline_at: optionalTime(source.deadline_at), created_at: timestamp(source.created_at), updated_at: timestamp(source.updated_at) }
  if (status === 'active' && completed === null) return { ...fields, status, completed_at: null }
  if (status === 'completed' && completed !== null) return { ...fields, status, completed_at: completed }
  throw invalid()
}
export function mapFlowSnapshot(value: unknown): FlowSnapshot | null {
  if (value === null) return null
  const source = row(value), d = row(source.work_day)
  if (typeof d.logical_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.logical_date) || typeof d.timezone !== 'string') throw invalid()
  const date = new Date(d.logical_date + 'T00:00:00Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== d.logical_date) throw invalid()
  try { new Intl.DateTimeFormat('en', { timeZone: d.timezone }).format(date) } catch { throw invalid() }
  const day: FlowWorkDay = { id: id(d.id), logical_date: d.logical_date, timezone: d.timezone,
    boundary_at: timestamp(d.boundary_at), cutoff_at: timestamp(d.cutoff_at), started_at: timestamp(d.started_at),
    ended_at: optionalTime(d.ended_at), created_at: timestamp(d.created_at) }
  const start = Date.parse(day.started_at), cutoff = Date.parse(day.cutoff_at), end = day.ended_at ? Date.parse(day.ended_at) : cutoff
  if (Date.parse(day.boundary_at) > start || start >= cutoff || end < start || end > cutoff || !Array.isArray(source.segments)) throw invalid()
  const segments = source.segments.map(value => {
    const s = row(value)
    return { id: id(s.id), work_day_id: id(s.work_day_id), area_id: optionalId(s.area_id), task_id: optionalId(s.task_id),
      started_at: timestamp(s.started_at), ended_at: optionalTime(s.ended_at), created_at: timestamp(s.created_at) }
  }).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || Number(a.ended_at === null) - Number(b.ended_at === null) || a.id.localeCompare(b.id))
  let previousEnd = start
  const seen = new Set<string>()
  for (const s of segments) {
    const from = Date.parse(s.started_at), to = s.ended_at ? Date.parse(s.ended_at) : Infinity
    if (seen.has(s.id) || s.work_day_id !== day.id || from < previousEnd || from >= cutoff || to < from
      || (s.ended_at !== null && to > end) || (s.ended_at === null && day.ended_at !== null)) throw invalid()
    seen.add(s.id); previousEnd = to
  }
  return { work_day: day, segments, server_time: timestamp(source.server_time) }
}
export function mapFlowState(value: unknown): FlowState {
  const source = row(value), current = mapFlowSnapshot(source.current), boundary = optionalTime(source.next_boundary_at), cutoff = optionalTime(source.next_cutoff_at)
  const server = timestamp(source.server_time)
  if (typeof source.legacy_active !== 'boolean' || (boundary === null) !== (cutoff === null)
    || (boundary && cutoff && !(Date.parse(boundary) <= Date.parse(server) && Date.parse(server) < Date.parse(cutoff)))
    || current?.work_day.ended_at) throw invalid()
  return { current, server_time: server, next_boundary_at: boundary, next_cutoff_at: cutoff, legacy_active: source.legacy_active }
}
export function flowDurations(snapshot: FlowSnapshot, serverNow: number) {
  const d = snapshot.work_day, end = minMicroseconds(micros(d.cutoff_at), d.ended_at ? micros(d.ended_at) : serverClockMicroseconds(serverNow, snapshot.server_time))
  const work = snapshot.segments.reduce((sum, s) => sum + segmentMicroseconds(s, end), 0n)
  const elapsed = positiveMicroseconds(end - micros(d.started_at))
  const open = snapshot.segments.find(s => s.ended_at === null)
  return { work: milliseconds(work), elapsed: milliseconds(elapsed), pause: milliseconds(elapsed - work), current: open ? milliseconds(segmentMicroseconds(open, end)) : 0 }
}
export function activityUsable(activity: FlowActivity, catalog: FlowCatalog): boolean {
  if (activity.areaId !== null && !catalog.areas.some(a => a.id === activity.areaId && !a.is_archived)) return false
  if (activity.taskId !== null && !catalog.tasks.some(task => task.id === activity.taskId && task.status === 'active' && task.area_id === activity.areaId)) return false
  return true
}
export function activityName(activity: FlowActivity, catalog: FlowCatalog) {
  return { area: activity.areaId ? catalog.areas.find(a => a.id === activity.areaId)?.name ?? 'Området er ikke tilgjengelig' : 'Annet',
    task: activity.taskId ? catalog.tasks.find(t => t.id === activity.taskId)?.title ?? 'Oppgaven er ikke tilgjengelig' : 'Ingen spesifikk oppgave' }
}
export function createFlowApi(client: Pick<SupabaseClient, 'rpc' | 'from'>) {
  return {
    ...createTaskApi(client),
    async snapshot(signal: AbortSignal, dayId: string): Promise<FlowSnapshot | null> {
      const { data, error } = await client.rpc('flow_work_day_snapshot', { p_work_day_id: dayId }).abortSignal(signal)
      if (error) throw new Error('Kunne ikke hente avsluttet dagsstatus.')
      return mapFlowSnapshot(data)
    },
    async load(signal: AbortSignal, timezone: string | null): Promise<FlowState> {
      try {
        const { data, error } = await client.rpc('flow_work_state', { p_timezone: timezone }).abortSignal(signal)
        if (error) throw error
        return mapFlowState(data)
      } catch { throw new Error('Kunne ikke hente Flow-dagen. Kontroller forbindelsen og prøv igjen.') }
    },
    async catalog(signal: AbortSignal): Promise<FlowCatalog> {
      async function all(table: string, columns: string): Promise<unknown[]> {
        const rows: unknown[] = []
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await client.from(table).select(columns).order('created_at').order('id').range(offset, offset + 499).abortSignal(signal)
          if (error || !Array.isArray(data)) throw new Error('Kunne ikke hente områder og oppgaver.')
          rows.push(...data)
          if (data.length < 500) return rows
        }
      }
      const [areas, tasks] = await Promise.all([
        all('flow_areas', 'id,name,code,is_archived,created_at'),
        all('flow_tasks', 'id,area_id,title,description,deadline_at,status,completed_at,created_at,updated_at'),
      ])
      const mapped = { areas: areas.map(mapFlowArea), tasks: tasks.map(mapFlowTask) }
      if (new Set(mapped.areas.map(a => a.id)).size !== mapped.areas.length || new Set(mapped.tasks.map(t => t.id)).size !== mapped.tasks.length) throw invalid()
      return mapped
    },
    async act(command: FlowCommand, signal: AbortSignal): Promise<FlowSnapshot | null> {
      try {
        const name = command.kind === 'start' ? 'flow_work_day_start' : 'flow_work_activity'
        const args = command.kind === 'start' ? { p_work_day_id: command.dayId, p_segment_id: command.segmentId,
          p_timezone: command.timezone, p_expected_boundary_at: command.boundary, p_area_id: command.areaId, p_task_id: command.taskId }
          : { p_work_day_id: command.dayId, p_expected_segment_id: command.expectedId, p_expected_segment_count: command.expectedCount,
            p_next_segment_id: command.nextId, p_area_id: command.areaId, p_task_id: command.taskId }
        const { data, error } = await client.rpc(name, args).abortSignal(signal)
        if (error) throw error
        return mapFlowSnapshot(data)
      } catch (error) {
        const message = error && typeof error === 'object' && 'message' in error ? error.message : null
        throw new FlowActionError(message === 'Review future-dated legacy work before cutover' ? 'legacy-time'
          : message === 'Flow boundary changed; refresh before starting' ? 'boundary'
          : message === 'This logical day is already ended' ? 'ended-day' : 'unknown')
      }
    },
  }
}
